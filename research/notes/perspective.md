# Perspective (finos/perspective)
- **URL:** https://github.com/finos/perspective (README ve npm paketleri artık `perspective-dev` adı altında: `@perspective-dev/client`, `@perspective-dev/server`, `@perspective-dev/viewer`, `@perspective-dev/viewer-datagrid`)
- **Lisans:** Apache 2.0. **Doğrulandı** (kök `LICENSE.md`; `find` başka lisans dosyası döndürmedi; `packages/*/package.json` ve `rust/*/package.json` hepsi `"license": "Apache-2.0"`). Grid render katmanı `regular-table =0.9.2` (`pnpm-workspace.yaml`) ayrı bir paket; lisansı bu analizde doğrulanmadı
- **Dil:** C++ (sorgu motoru, `rust/perspective-server/cpp`) → WASM; Rust (client, viewer UI, virtual server); TypeScript (viewer plugin'leri)
- **Sürüm / son commit:** `5.9.2` (kök `package.json`, son tag `v5.9.2`); son commit 2026-11-15
- **Paket boyutu (npm registry, unpacked):** `@perspective-dev/server` 5.9.2 ≈ 5.4 MB, `@perspective-dev/viewer` 5.9.2 ≈ 5.8 MB. Gzip'li transfer boyutu ölçülmedi (build yasak)

## Ne yapıyor (3-5 cümle)
Büyük ve streaming veri için data grid, pivot tablo ve grafik bileşeni. C++ ile yazılmış sütunsal sorgu motoru WASM olarak tarayıcıda, ya da Python/Node/Rust ile sunucuda çalışır. Kullanıcı `<perspective-viewer>` web component'inde sürükle-bırak ile `group_by` (satır), `split_by` (sütun), `aggregates`, `filter`, `sort`, `expressions` seçer; motor sonucu artımlı günceller. Apache Arrow, CSV ve JSON okur/yazar. "Virtual server" ile kendi motoru yerine DuckDB/ClickHouse/PostgreSQL/Polars'a SQL üreterek sorgu atabilir.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Yol | Sorumluluk |
|---|---|
| `rust/perspective-server/cpp/` | C++ sorgu motoru (table, view, pivot, aggregate), WASM ve native build |
| `rust/perspective-client/src/rust/config/view_config.rs` | `ViewConfig` (sorgu tanımı, JSON serileştirilebilir) |
| `rust/perspective-client/src/rust/virtual_server/` | `handler.rs` (`VirtualServerHandler` trait), `generic_sql_model.rs` (dialect ayarları), `generic_sql_model/table_make_view.rs` (ViewConfig → SQL) |
| `rust/perspective-js/src/ts/virtual_servers/` | `duckdb.ts`, `clickhouse.ts` JS virtual server'ları |
| `rust/perspective-viewer/src/rust/` | Viewer UI (Rust/Yew → WASM): config paneli, session, renderer |
| `packages/viewer-datagrid/` | Sanal kaydırmalı grid/pivot plugin'i (`regular-table` üzerinde) |
| `packages/viewer-charts/` | WebGL grafik plugin'i |
| `docs/md/explanation/virtual_servers.md` | Virtual server mimarisi |

**Akış:** veri (Arrow) → `Table` → `table.view(ViewConfig)` → motor pivot hesaplar → viewer plugin yalnızca görünür hücreleri `view_get_data` ile ister. Virtual server modunda motor yerine handler SQL çalıştırır.

## Floem BI için kritik kısımlar
- `rust/perspective-client/src/rust/config/view_config.rs::ViewConfig` → `group_by`, `split_by`, `aggregates`, `filter`, `sort`, `expressions`, `group_by_depth`, `group_rollup_mode` → Power BI Matrix'in Rows/Columns/Values alanlarına birebir karşılık; Floem matris görsel tanımı için şema modeli
- `.../virtual_server/generic_sql_model/table_make_view.rs` → `GROUP BY ROLLUP(...)`, `GROUPING_ID`, `PIVOT` ile subtotal/grand total üretimi → Floem matris sorgusunun SQL'e derlenmesi (subtotal satırları)
- `.../virtual_server/handler.rs` → `table_make_view`, `view_get_data`, `view_expand`/`view_collapse`, `view_set_depth`, `get_features` → Floem semantik katmanının grid'e "sunucu tarafı pivot" API'si olarak uyması gereken arayüz
- `.../virtual_server/generic_sql_model.rs` → `grouping_fn`, LIKE escape, identifier case folding gibi dialect bayrakları → SQL Server dialect'i eklenecek noktalar
- `packages/viewer-datagrid/` → sanal kaydırmalı, satır expand/collapse destekli pivot grid → Matrix görseli renderer'ı

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Semantik model yok; sütunlar düz tablo alanları. Ölçü = sütun + `Aggregate` (sum, avg, count, distinct count...) veya ExprTK tabanlı `expressions`. Örnek:
```json
{"group_by":["Region","City"],"split_by":["Year"],"columns":["Sales"],
 "aggregates":{"Sales":"sum"},"filter":[["Segment","==","Retail"]],"sort":[["Sales","desc"]]}
```

## Sorgu nasıl üretiliyor
Virtual server: `ViewConfig` → `table_make_view.rs` → `SELECT ... GROUP BY ROLLUP(group_by)` + `split_by` için `PIVOT` + pencere fonksiyonları (`window_sql`) → dialect'e göre düzeltme → sonuç sütunsal olarak viewer'a. Mevcut dialect'ler DuckDB ve ClickHouse; SQL Server yok (`PIVOT`/`EXCLUDE` sözdizimi DuckDB'ye özgü).

## Alınacak fikirler
- Matris görsel tanımını `rows`/`columns`/`values` + `rollup_mode` + `depth` şeklinde JSON'da tutmak
- `GROUP BY ROLLUP` + `GROUPING_ID` ile subtotal'leri tek sorguda üretmek
- `get_features` ile backend yeteneğine göre UI kontrollerini kapatmak
- Sadece görünen pencereyi (viewport) çekme; expand/collapse'ı sunucuya delege etme

## Kaçınılacaklar / zayıf yönler
- Toplam ~11 MB unpacked (server + viewer); BI raporundaki tek bir görsel için ağır. Lazy load şart
- Kendi motoru semantik model, ilişki, filtre bağlamı bilmez; DAX benzeri ölçüler (CALCULATE, zaman zekâsı) desteklenmez
- Viewer kendi config paneli ve temasıyla gelir; Floem rapor tasarımcısının alan kuyruklarıyla (field wells) entegrasyon iş ister
- Matrix'e özgü özellikler (koşullu biçimlendirme kuralları, hiyerarşi drill-down, değerleri satıra çevirme) sınırlı

## Kullanım kararı: Fikir al (opsiyonel: bağımlılık olarak kullan)
Matris görselinin hem JSON şeması hem de ROLLUP tabanlı SQL üretimi için çok iyi referans. Yüksek hacimli "analiz/explore" ekranı için `@perspective-dev/viewer` + Floem virtual server handler olarak bağımlılık kullanılabilir; standart rapor matrisi için daha hafif kendi grid'imiz (TanStack Table + Virtual) tercih edilmeli.
