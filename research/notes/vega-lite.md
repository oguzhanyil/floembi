# Vega-Lite (vega/vega-lite)
- **URL:** https://github.com/vega/vega-lite
- **Lisans:** BSD-3-Clause. **Doğrulandı** (kök `LICENSE`, "Copyright (c) 2015, University of Washington Interactive Data Lab"; `find` başka lisans dosyası döndürmedi; `package.json` → `"license": "BSD-3-Clause"`). Peer dependency `vega ^6.4.0` (Vega da BSD-3, bu analizde klonlanmadı)
- **Dil:** TypeScript. Bağımlılıklar: `vega-expression`, `vega-event-selector`, `vega-util`, `json-stringify-pretty-compact`
- **Sürüm / son commit:** `package.json` → **6.5.0**; şema `$schema: https://vega.github.io/schema/vega-lite/v6.json`; son commit 2026-11-13

## Ne yapıyor (3-5 cümle)
Etkileşimli grafikleri kısa bir JSON spesifikasyonu ile tanımlayan "grammar of graphics". Bir spec `data`, `transform`, `mark`, `encoding`, `params` (selection) ve kompozisyon (`layer`, `concat`, `facet`, `repeat`) alanlarından oluşur. Derleyici bu spec'i varsayılanları (scale, axis, legend) doldurarak çok daha ayrıntılı bir Vega spec'ine çevirir; render'ı Vega runtime yapar. Tüm spec yapısı TypeScript tiplerinden üretilen bir JSON Schema (`build/vega-lite-schema.json`, ~1.9 MB) ile doğrulanır.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Yol | Sorumluluk |
|---|---|
| `src/spec/` | Spec tipleri: `unit.ts` (`GenericUnitSpec`: mark + encoding + params), `layer.ts`, `concat.ts`, `facet.ts`, `repeat.ts`, `toplevel.ts` |
| `src/encoding.ts`, `src/channeldef.ts`, `src/channel.ts` | Kanal (x, y, color, size, tooltip...) ve alan tanımı (`field`, `type`, `aggregate`, `bin`, `timeUnit`, `sort`, `condition`) |
| `src/mark.ts` | Mark tipleri (bar, line, area, point, arc, rect, text...) |
| `src/transform.ts` | `filter`, `calculate`, `aggregate`, `joinaggregate`, `window`, `bin`, `timeUnit`, `lookup`, `fold`, `pivot`, `stack`, `impute` |
| `src/parameter.ts`, `src/selection.ts` | `params`: değişkenler ve `select: point/interval` seçimleri |
| `src/normalize/` | Kısayolları (ör. encoding içindeki aggregate) kanonik forma çevirme |
| `src/compile/compile.ts` | `compile(spec)` giriş noktası → model ağacı (`buildmodel.ts`, `unit.ts`, `layer.ts`, `concat.ts`, `facet.ts`) |
| `src/compile/data/` | Dataflow grafiği (`dataflow.ts`, `parse.ts`) ve optimizer (`optimize.ts`, `optimizers.ts`); her transform bir düğüm |
| `src/compile/selection/` | Seçimlerin sinyal ve predicate'lere derlenmesi (`point.ts`, `interval.ts`, `toggle.ts`) |
| `examples/specs/*.vl.json` | Yüzlerce örnek spec (ör. `interactive_crossfilter.vl.json`, `interactive_bar_select_highlight.vl.json`) |

**Akış:** spec → normalize → model ağacı → scale/axis/legend parse → dataflow (transform düğümleri) → optimize → Vega spec → Vega runtime.

## Floem BI için kritik kısımlar
- `src/spec/unit.ts` + `src/encoding.ts` → `mark` + `encoding{x,y,color,...}` → Floem görsel tanımının çekirdeği: görsel tipi + "field well" (Axis, Legend, Values) bağları
- `src/channeldef.ts` → `field` + `type` (nominal/ordinal/quantitative/temporal) + `aggregate` + `timeUnit` + `sort` → Floem'de alanın semantik model referansı (`{"measure":"Sales[Total]"}` gibi) ile değiştirilecek kısım
- `src/parameter.ts`, `src/selection.ts`, `examples/specs/interactive_crossfilter.vl.json` → `params: [{name, select:{type:"interval", encodings:["x"]}}]` + `transform: [{filter:{param:"brush"}}]` → Power BI cross-filter / cross-highlight ve slicer'ın deklaratif temsili
- `src/transform.ts` → client-side transform'lar → Floem'de bunların çoğu sunucuya (semantik katmana) itilmeli
- `src/compile/data/optimizers.ts` → dataflow düğümlerini birleştirme/taşıma → görsel sorgu planı optimizasyonu fikri
- `build/vega-lite-schema.json` → TS tiplerinden JSON Schema üretimi → Floem rapor formatı için şema-öncelikli yaklaşım ve editör otomatik tamamlama

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Semantik model yok; ölçü = `field` + `aggregate` (sum, mean, count, distinct...). Floem için önerilen uyarlama:
```json
{"visual":"bar",
 "encoding":{"x":{"dimension":"Product[Category]"},
             "y":{"measure":"Sales[Total Revenue]"},
             "color":{"dimension":"Date[Year]"}},
 "params":[{"name":"sel","select":{"type":"point","fields":["Product[Category]"]}}],
 "filters":[{"dimension":"Region[Name]","in":["TR"]}]}
```

## Sorgu nasıl üretiliyor
Vega-Lite SQL üretmez; transform'lar Vega dataflow'unda tarayıcıda çalışır. Floem için akış: görsel spec'teki `encoding` boyutları = GROUP BY, ölçüler = semantik katmandan derlenen agregasyon, `filters` + aktif `params` seçimleri = WHERE → semantik katman SQL üretir → sonuç Vega-Lite'a `data.values` olarak (veya named dataset) verilir.

## Alınacak fikirler
- Görsel tanımında "ne" (encoding) ile "nasıl" (config/theme) ayrımı; varsayılanlar derleyicide
- `params` + `condition` ile seçim, highlight ve cross-filter'ı deklaratif tanımlamak
- Kompozisyon (`layer`, `concat`, `facet`) → combo grafik, small multiples
- TS tipi → JSON Schema → doğrulama ve sürümleme (`$schema` URL'inde major sürüm)
- `normalize` katmanı: kısa yazımı kanonik forma çevirip saklamak

## Kaçınılacaklar / zayıf yönler
- Tüm veriyi tarayıcıya çekip transform etme modeli büyük veride çalışmaz; aggregation sunucuda olmalı
- Tablo/matris, KPI kartı, slicer gibi BI görselleri yok; bunlar Floem'e özgü tipler olmalı
- Spec çok esnek; rapor formatında serbest Vega-Lite izin vermek UI tasarımcısıyla geri dönüşümü (round-trip) zorlaştırır. Floem formatı kısıtlı bir alt küme olmalı
- Vega runtime + Vega-Lite derleyicisi bundle boyutu büyük (ölçülmedi)

## Kullanım kararı: Fikir al (render için bağımlılık olarak kullan)
Floem BI rapor/görsel JSON formatı Vega-Lite'ın `mark`/`encoding`/`params` grameri örnek alınarak, alan referansları semantik model nesneleriyle değiştirilmiş kısıtlı bir şema olarak tasarlanmalı. Grafik render'ı için `vega-lite` + `vega` (BSD-3) bağımlılık olarak kullanılabilir (Rill de böyle yapıyor).
