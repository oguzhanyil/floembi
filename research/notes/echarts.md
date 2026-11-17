# Apache ECharts
- URL: https://github.com/apache/echarts
- Lisans: Apache 2.0 (kök `LICENSE` doğrulandı; `NOTICE` "Copyright 2017-2026 The Apache Software Foundation"). Alt lisans: `licenses/LICENSE-d3` (BSD-3-Clause, d3'ten uyarlanan kod — `src/chart/graph/forceHelper.ts`, `src/chart/tree/layoutHelper.ts`, `src/chart/treemap/treemapLayout.ts`). Dağıtımda LICENSE + NOTICE dosyalarını ürünle birlikte taşı.
- Dil: TypeScript · Canvas/SVG render motoru `zrender` (aynı ekip, BSD-3-Clause; doğrulanmadı — klonlanmadı)
- Son commit: 2026-10-04 · Versiyon: **6.1.0** · Runtime bağımlılık: `zrender 6.1.0`, `tslib`

## Ne yapıyor
Deklaratif `option` objesiyle yapılandırılan, 20+ seri tipli (bar, line, pie, scatter, heatmap, treemap,
sunburst, sankey, gauge, funnel, map, candlestick, boxplot, custom...) grafik kütüphanesi. Canvas ve SVG
renderer, dataset/encode ile veri-görsel eşleme, dataZoom/brush/legend/visualMap etkileşimleri,
sunucu tarafı SVG render (SSR) ve büyük veri (progressive, sampling, large mode) destekler.

## Mimari
- `src/core/echarts.ts` → `init`, `setOption`, `dispatchAction` (~1574), olay sistemi, `connect(groupId)` (~2994), `renderToSVGString` (~940), `ssr` opsiyonu.
- `src/model/` → option → `GlobalModel`/`SeriesModel` ağacı; `src/data/` → `Source`, `DataStore`, `SeriesData` (kolon bazlı veri deposu).
- `src/chart/<tip>/` + `src/chart/<tip>.ts` → her seri tipi ayrı install modülü (tree-shaking birimi).
- `src/component/` → axis, legend, tooltip, dataZoom, brush, dataset, `transform/` (filter, sort), toolbox, aria.
- `src/processor/dataSample.ts` → `sampling: 'lttb' | 'minmax' | 'average' ...` downsampling.
- `src/animation/universalTransition.ts` → `dataGroupId` / `childGroupId` ile seriler arası morph animasyonu (drill-down geçişi).
- `src/export/` → `core.ts`, `charts.ts`, `components.ts`, `features.ts`, `renderers.ts` → `echarts/core` vb. alt yollar (package.json `exports`).
- `ssr/client/src/index.ts` → SSR ile üretilen SVG'ye hafif istemci etkileşimi (hover/click) ekleyen küçük paket.

## Floem BI için kritik kısımlar
- `src/component/dataset` + seri `encode: { x: 'Year', y: 'Sales', itemName, seriesName }` → **field well → encode eşlemesi**: backend sorgu sonucu (kolon başlıklı tablo) doğrudan `dataset.source` olur; X/Y/Legend kutuları `encode`'a dönüşür. Legend çoklu seri için `seriesLayoutBy` veya pivot.
- `chart.on('click', params)` → `params.name / dataIndex / data` → **cross-filter**: tıklanan kategoriyi rapor filtre store'una yaz, diğer görselleri yeniden sorgula. `dispatchAction({type:'highlight'|'select'})` ile görsel vurgulama; `selectchanged` olayı çoklu seçim için.
- `universalTransition` + `dataGroupId/childGroupId` → **drill-down** animasyonu; drill state (hiyerarşi seviyesi) uygulamada tutulur, ECharts yalnızca geçişi çizer (yerleşik drill-down/hiyerarşi yok — treemap/sunburst hariç).
- `connect(groupId)` → aynı gruptaki grafiklerde tooltip/dataZoom senkronu (sayfa içi tutarlılık).
- Büyük veri: `large: true`, `progressive`, `sampling: 'lttb'` (`src/processor/dataSample.ts`) → yüz binlerce nokta; asıl agregasyon backend'de yapılmalı.
- SSR: `init(null, null, { renderer: 'svg', ssr: true, width, height })` + `renderToSVGString()` → **Node.js'te PDF/PNG export, e-posta abonelik raporları, embed önizleme**.
- `src/component/aria` → otomatik erişilebilir açıklama ve decal (desen) desteği.

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz (yalnızca görselleştirme). `dataset.dimensions` ile kolon tipleri (`ordinal`, `number`, `time`) bildirilebilir → semantik model veri tiplerinden üretilebilir.

## Sorgu nasıl üretiliyor
Uygulanamaz. `dataset.transform` (filter/sort) yalnızca istemci tarafı küçük dönüşümler için; agregasyon/filtre SQL'de yapılmalı.

## Paket boyutu / tree-shaking
`dist/echarts.esm.min.js` ≈ 1.12 MB, `dist/echarts.common.min.js` ≈ 715 KB (minified, gzip öncesi; repodaki dist'ten ölçüldü). `echarts/core` + `use([BarChart, LineChart, GridComponent, TooltipComponent, DatasetComponent, CanvasRenderer])` ile yalnızca kullanılan seri/bileşen paketlenir; görsel tipleri lazy-load (dinamik import) edilmeli.

## Alınacak fikirler
- Görsel tanımı = Floem visual JSON → `option` builder (saf fonksiyon, test edilebilir; SSR'da da aynı builder).
- Tema sistemi (`theme/`) → rapor teması (Power BI JSON theme karşılığı).

## Kaçınılacaklar / zayıf yönler
- `option` çok geniş ve gevşek tipli; kullanıcıya ham option açma (XSS: `formatter` HTML string'leri, `tooltip.formatter` sanitize edilmeli).
- Matrix/pivot tablo görseli yok → tablo/matrix için ayrı grid (ör. TanStack Table, MIT) gerekir.
- Slicer bileşeni yok → React ile ayrı yazılmalı.
- React wrapper resmi değil; ince kendi wrapper'ımızı yazmak (init/dispose/resize/setOption notMerge) önerilir.

## Kullanım kararı: Bağımlılık olarak kullan
Ana grafik motoru. Apache 2.0 → ticari kapalı kaynakta serbest; NOTICE/LICENSE (+ d3 BSD bildirimi) üçüncü taraf lisans sayfasında yer almalı.
