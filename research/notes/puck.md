# Puck
- URL: https://github.com/puckeditor/puck
- Lisans: MIT (kök `LICENSE` doğrulandı, "Copyright (c) The Puck Contributors"; alt lisans yok)
- Dil: TypeScript · React 18/19 (peer)
- Son commit: 2026-11-16 · Versiyon: `packages/core/package.json` → **0.24.0** (`@puckeditor/core`)
- Önemli bağımlılıklar: `@dnd-kit/*` **0.4.0** (sabit), `zustand`, `@tiptap/*` (rich text), `@radix-ui/react-popover`, `@tanstack/react-virtual` — hepsi MIT.

## Ne yapıyor
React için görsel sayfa editörü (page builder). Geliştirici bileşenleri (`render` + `fields`) bir
`Config` içinde tanımlar; kullanıcı soldaki listeden bileşenleri sürükleyip sayfaya bırakır, sağdaki
alan panelinden prop'ları düzenler. Çıktı saf JSON (`Data`); `<Render config data>` ile editör dışında
render edilir. Blok/akış tabanlı yerleşim (slot/DropZone ile iç içe), serbest konumlama değil.

## Mimari
- `packages/core/components/Puck/` → editör kabuğu; `ComponentList`, `DropZone`, `DraggableComponent`, `AutoField`, `LayerTree`, `Render`, `ServerRender` (RSC).
- `packages/core/types/Config.tsx` → bileşen config'i: `render`, `fields`, `defaultProps`, `resolveData`, `resolveFields`, `resolvePermissions`, `inline`.
- `packages/core/types/Data.tsx` → `Data = { root, content: ComponentData[], zones? }`, `ComponentData = { type, props: { id, ... } }`.
- `packages/core/types/Fields.ts` → alan tipleri: `text, number, textarea, select, radio, checkbox, richtext, array, object, external, custom, slot`.
- `packages/core/store/` (zustand, `slices/history` → undo/redo) + `packages/core/reducer/` (insert/move/replace/remove action'ları).
- `packages/core/lib/data/` → `walk-tree.ts`, `flatten-data.ts`, `resolve-data-by-id.ts` vb. veri ağacı yardımcıları.
- `packages/core/plugins/` → `blocks`, `fields`, `outline` paneller; plugin API ile UI genişletme.

## Floem BI için kritik kısımlar
- `types/Config.tsx` → bileşen config deseni → **görsel registry** (`BarChart: { fields: { title, ... }, render }`).
- `Fields.ts` `custom` alan tipi → **field well (X/Y/Legend/Values) panelini custom field olarak gömme**; `external` → ölçü/kolon seçici (semantik modelden liste çekme).
- `resolveData` / `resolveFields` → prop değişince async veri/alan çözümleme → görsel tipine göre dinamik format paneli.
- `store/slices/history` → undo/redo deseni.
- `components/LayerTree` → "Selection pane" (Power BI katman listesi) karşılığı.
- `ServerRender` / `bundle/rsc.tsx` → raporun sunucu tarafında render edilmesi (embed/PDF) fikri.

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz. Örnek Floem BI JSON (Puck formatına uyarlanmış):
`{ root: { props: { title: "Satış" } }, content: [ { type: "BarChart", props: { id: "v1", fieldWells: { x: ["Date[Year]"], y: ["[Total Sales]"] } } } ] }`

## Sorgu nasıl üretiliyor
Uygulanamaz.

## Rapor tasarımcısı çatısı olarak uygun mu?
Kısmen. Artılar: MIT, config→JSON→render ayrımı, undo/redo, field paneli, plugin API, React-native.
Eksiler: (1) yerleşim akış/blok tabanlı — Power BI tarzı mutlak konum + boyutlandırma için `slot`
içine react-grid-layout gömmek gerekir ve iki DnD sistemi (Puck'ın dnd-kit'i + RGL'nin react-draggable'ı)
çakışabilir; (2) cross-filter gibi bileşenler arası çalışma zamanı etkileşimi Puck'ın kapsamında değil
(ayrı bir rapor state/filtre katmanı gerekir); (3) 0.x sürüm, dnd-kit 0.4.0'a sabitli.

## Alınacak fikirler
- `Config` + `Data` + `<Render>` üçlüsü: rapor tanımını saf JSON tutup editör/viewer'ı ayırma.
- `resolveData` ile görsel prop'larından sorgu tetikleme sözleşmesi.
- Plugin tabanlı sol/sağ panel kompozisyonu.

## Kaçınılacaklar / zayıf yönler
- Puck AI tarifleri (`recipes/next-ai`) `@puckeditor/cloud-client` ile harici bulut servisine bağlı → on-prem/kapalı kaynak ürün için kullanma; lisansı bu repoda doğrulanamaz.
- Tiptap bağımlılığı geniş (bundle boyutu); rich text gerekmezse ağır.
- Breaking change riski (0.x).

## Kullanım kararı: Fikir al
Rapor tasarımcısı çekirdeğini kendimiz (react-grid-layout + dnd-kit + zustand) kurmak daha uygun; Puck'ın config/data/render sözleşmesi, field tipleri ve history slice'ı tasarım referansı. Metin/landing benzeri "rapor kapak sayfası" için ileride bağımlılık olarak değerlendirilebilir.
