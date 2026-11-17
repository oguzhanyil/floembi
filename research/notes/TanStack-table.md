# TanStack Table (TanStack/table)
- **URL:** https://github.com/TanStack/table
- **Lisans:** MIT. **Doğrulandı** (kök `LICENSE`, "Copyright (c) 2016 Tanner Linsley"; `find` başka lisans dosyası döndürmedi; `packages/table-core/package.json` ve `packages/react-table/package.json` → `"license": "MIT"`)
- **Dil:** TypeScript. Framework adapter'ları: React, Vue, Svelte, Solid, Angular, Lit, Preact, Ember, Alpine, Octane
- **Sürüm / son commit:** `@tanstack/table-core` ve `@tanstack/react-table` **9.3.1** (v9 major; son tag'ler `@tanstack/table-devtools@9.3.2`); son commit 2026-11-14
- **TanStack Virtual:** ayrı repo (`TanStack/virtual`), bu analizde klonlanmadı. Örnekler `@tanstack/react-virtual ^3.14.26` kullanıyor (`examples/react/virtualized-rows/package.json`)

## Ne yapıyor (3-5 cümle)
Headless tablo/datagrid kütüphanesi: DOM veya stil üretmez, sadece satır/sütun/hücre modelini ve state'i yönetir. Filtreleme, sıralama, gruplama, aggregation, expand, pagination, pinning, resize, seçim gibi özellikler ayrı "feature" modülleri olarak gelir ve tree-shake edilebilir. Render tamamen uygulamaya aittir, bu nedenle Floem tasarım sistemiyle birebir uyumlu görsel çizilebilir. Her özellik `manual*` bayrağıyla sunucuya delege edilebilir (server-side sorting/grouping/pagination).

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Yol | Sorumluluk |
|---|---|
| `packages/table-core/src/core/` | Table, column, row, cell, header nesneleri ve row model pipeline'ı |
| `packages/table-core/src/features/` | Her özellik ayrı klasör: `column-grouping/`, `row-aggregation/`, `row-expanding/`, `cell-spanning/`, `column-pinning/`, `column-sizing/`, `row-sorting/`, `column-filtering/`, `row-pagination/`... `stockFeatures.ts` hepsini toplar |
| `packages/table-core/src/worker/` | Row model hesaplarını Web Worker'a taşıma (`tableWorkerProtocol.ts`: pipeline `filtered → grouped → sorted → expanded`) |
| `packages/react-table/` vb. | Framework adapter'ları |
| `examples/react/` | `grouping`, `grouped-aggregation`, `expanding`, `header-groups`, `virtualized-rows`, `virtualized-columns`, `virtualized-infinite-scrolling` |

**Akış:** `data` + `columns` (ColumnDef) + `state` → core row model → filtered → grouped (aggregation) → sorted → expanded → paginated → uygulama `getRowModel().rows`'u render eder (sanal kaydırmada sadece görünür dilim).

## Floem BI için kritik kısımlar
- `features/column-grouping/createGroupedRowModel.ts` → satır gruplama ağacı → Tablo görselinde gruplu satırlar; küçük veri için Matrix'in client-side satır hiyerarşisi
- `features/row-aggregation/aggregationFns.ts` → `sum`, `min`, `max`, `extent`, `mean`, `median`, `unique`, `uniqueCount`, `count`, `first`, `last`; her fonksiyonda `aggregate` + `merge` (alt grup sonuçlarını birleştirme) → subtotal/total satırları
- `features/column-grouping/columnGroupingFeature.types.ts` `manualGrouping` (ve diğer `manual*` bayrakları) → gruplama/sıralamayı Floem sorgu motoruna (SQL) bırakma
- `features/row-expanding/` → drill-down / expand-collapse → Matrix "+/-" davranışı
- `features/cell-spanning/` → aynı değerli hücreleri birleştirme → Matrix satır başlığı görünümü
- `examples/react/header-groups` → çok seviyeli sütun başlıkları → Matrix'in `Columns` alanı (split_by)
- `examples/react/virtualized-rows`, `virtualized-columns` → TanStack Virtual ile büyük tablo render'ı
- `worker/` → ağır gruplama hesabını ana thread dışına alma

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Semantik model yok. Sütun tanımı `ColumnDef` (accessor, header, cell render, `aggregationFn`, `enableGrouping`...). Floem görsel JSON'undaki her alan bir `ColumnDef`'e map edilebilir; ölçünün hesaplanması sunucuda kalmalı.

## Sorgu nasıl üretiliyor
Uygulanamaz (veri istemcide hazır gelir veya `manual*` modda uygulama getirir).

## Alınacak fikirler
- Feature-tabanlı, tree-shakable mimari: görsel özelliklerini (sort, group, pin, resize) bağımsız modüller olarak tasarlamak
- `aggregate` + `merge` ayrımı: alt toplamları yeniden hesaplamadan birleştirme (sadece toplanabilir ölçüler için)
- State'i (`sorting`, `grouping`, `expanded`, `columnSizing`, `columnPinning`) serileştirilebilir tutup rapor JSON'una ve URL/bookmark'a yazmak
- Worker pipeline ile UI donmasını engellemek

## Kaçınılacaklar / zayıf yönler
- Client-side aggregation non-additive ölçülerde (distinct count, ratio, DAX ölçüleri) yanlış sonuç verir; Floem'de toplamlar SQL'den gelmeli
- Headless olduğundan grid UX'i (klavye navigasyonu, kopyalama, koşullu biçimlendirme, sticky header) bizim yazmamız gerekir
- v9 yeni major; v8'den API farkları var, örnek/blog içeriklerinin çoğu v8'e göre

## Kullanım kararı: Bağımlılık olarak kullan
Floem BI tablo görseli (ve küçük/orta boy matris) için `@tanstack/react-table` (veya kullanılan framework adapter'ı) + `@tanstack/react-virtual`, `manual*` modda sunucu tarafı gruplama/sıralama ile. Tamamen MIT.
