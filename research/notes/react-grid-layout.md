# react-grid-layout
- URL: https://github.com/react-grid-layout/react-grid-layout
- Lisans: MIT (kök `LICENSE` doğrulandı, "Copyright (c) 2016 Samuel Reed"; alt lisans yok)
- Dil: TypeScript (v2 tam TS yeniden yazımı) · React
- Son commit: 2026-11-04 · Versiyon: 2.3.0
- Bağımlılıklar: `react-draggable`, `react-resizable`, `fast-equals`, `clsx` (hepsi MIT)

## Ne yapıyor
React için sürüklenebilir/boyutlandırılabilir, kolon tabanlı grid layout. Öğeler grid birimlerinde
(`x, y, w, h`) konumlanır; çakışmalar "compactor" algoritmalarıyla çözülür (dikey/yatay/yok).
Breakpoint bazlı responsive layout ve dışarıdan (palette) grid'e öğe bırakma (`onDrop`) destekler.
Grafana dashboard grid'inin de temelidir (bilinen kullanım; bu repoda doğrulanmadı).

## Mimari
- `src/core/` → framework-bağımsız saf algoritmalar (`react-grid-layout/core` olarak export): `layout.ts`, `collision.ts`, `compactors.ts` + `compaction/`, `responsive.ts`, `constraints.ts`, `position.ts`, `interaction/resolveDrag.ts`.
- `src/react/components/` → `GridLayout.tsx`, `ResponsiveGridLayout.tsx`, `GridItem.tsx`, `dropMath.ts`, `edgeScroll.ts`.
- `src/react/hooks/` → `useContainerWidth`, `useGridLayout`, `useResponsiveLayout`.
- `src/legacy/` → v1 düz props API (geçiş için). `src/extras/` → `GridBackground`, hızlı compactor'lar.
- Veri akışı: kontrollü `layout` prop → kullanıcı drag/resize → core compaction → `onLayoutChange(layout)` → uygulama state'i kaydeder.

## Floem BI için kritik kısımlar
- `src/core/types.ts` (`LayoutItem`, satır ~37) → `{ i, x, y, w, h, minW, minH, maxW, maxH, static, isDraggable, isResizable, resizeHandles, constraints }` → **dashboard/rapor sayfasındaki görsel kutusunun konum JSON'u**; `i` = visual id.
- `ResponsiveLayouts` (`src/core/types.ts` ~648) = `Partial<Record<Breakpoint, Layout>>` → masaüstü/mobil layout ayrımı (Power BI "mobile layout" karşılığı).
- `src/core/responsive.ts` → breakpoint seçimi, eksik breakpoint için layout türetme.
- `src/core/compactors.ts` → `verticalCompactor`, `noCompactor`, `noOverlapCompactor` → **Power BI tarzı serbest yerleşim için `noCompactor`**, dashboard için `verticalCompactor`.
- `src/react/components/GridLayout.tsx` → `dropConfig`, `droppingItem`, `onDrop` → **görsel paletinden tuvale yeni grafik sürükleme**.
- `src/extras/GridBackground.tsx` → editör modunda grid çizgileri.

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz. Önerilen rapor sayfası şeması:
`{ pageId, layouts: { lg: LayoutItem[], sm: LayoutItem[] }, visuals: { [i]: { type, fieldWells, options } } }`.

## Sorgu nasıl üretiliyor
Uygulanamaz.

## Alınacak fikirler
- Layout (konum) ile görsel konfigürasyonunu ayrı tut; `i` ile birleştir.
- `core` paketini backend/SSR'da (PDF export, layout doğrulama) React'siz kullanma imkânı.
- `constraints` ile görsel tipine göre min boyut (ör. KPI kartı 2x2, tablo 4x4).

## Kaçınılacaklar / zayıf yönler
- Grid birimli; piksel-hassas serbest yerleşim (Power BI rapor tuvali gibi) için ince grid (ör. 96 kolon, küçük rowHeight) gerekiyor.
- Grup/iç içe container, z-index katmanlama, döndürme yok.
- v1 → v2 breaking change'ler; internet örneklerinin çoğu v1 API'si (`/legacy`).

## Kullanım kararı: Bağımlılık olarak kullan
Dashboard tuvali için birincil aday (React-native, kontrollü state, TS, saf core). Rapor tuvali için `noCompactor` + ince grid ile değerlendirilmeli.
