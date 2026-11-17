# gridstack.js
- URL: https://github.com/gridstack/gridstack.js
- Lisans: MIT (kök `LICENSE` doğrulandı, "Copyright (c) 2019-2026 Alain Dumesny; v0.4.0 ve öncesi Pavel Reznikov, Dylan Weiss"; alt lisans yok)
- Dil: TypeScript (vanilla DOM çekirdek) + Angular / React / Vue wrapper'ları
- Son commit: 2026-11-16 · Versiyon: 14.1.1
- Çekirdek runtime bağımlılığı yok (`"dependencies": {}`); kendi drag-drop katmanı (`src/dd-*.ts`).

## Ne yapıyor
Framework-bağımsız, mobil uyumlu dashboard grid kütüphanesi. Widget'lar kolon/satır birimiyle
konumlanır; sürükle, boyutlandır, iç içe grid (`subGridOpts`), grid'ler arası taşıma, dış kaynaktan
widget bırakma, `save()`/`load()` ile JSON serileştirme destekler. React desteği DOM'u gridstack'in
sahiplendiği, React içeriğin `createPortal` ile yerleştirildiği bir wrapper ile sağlanır.

## Mimari
- `src/gridstack.ts` → `GridStack` sınıfı: init, `addWidget`, `save`/`load`, olaylar (`change`, `added`, `dropped`).
- `src/gridstack-engine.ts` → saf yerleşim motoru (çakışma, packing, kolon değişiminde yeniden yerleşim).
- `src/dd-*.ts` → HTML5/mouse/touch tabanlı kendi drag-drop & resize implementasyonu (`dd-touch.ts` mobil).
- `src/types.ts` → `GridStackOptions`, `GridStackWidget`, responsive `columnOpts` (breakpoint'ler).
- `react/projects/lib/src/` → React wrapper: `gridstack.tsx`, `gridstack-item.tsx`, `registry.ts` (component map), `hooks.ts`.
- `react/DESIGN-DECISIONS.md` → wrapper tasarımı: JSON (`options.children`) + `component`/`props` map; gridstack DOM'un sahibidir.
- Veri akışı: JSON children → `grid.load()` → engine → DOM; değişiklik → olay → `grid.save()` → JSON.

## Floem BI için kritik kısımlar
- `src/types.ts` `GridStackWidget` (~satır 460) → `{ id, x, y, w, h, minW, maxW, minH, maxH, noMove, noResize, locked, autoPosition, sizeToContent, subGridOpts, content }` → görsel konum JSON'u.
- `src/types.ts` `GridStackMode` (`'top' | 'float'`) → `float` = Power BI benzeri serbest yerleşim (yerçekimsiz).
- `src/types.ts` `columnOpts` (`columnWidth`, `columnMax`, breakpoint listesi) → responsive.
- `subGridOpts` → **iç içe grid = görsel gruplama** (Power BI "group" karşılığı); react-grid-layout'ta yok.
- `src/gridstack.ts` `save()` (~667) / `load()` → rapor sayfası kaydet/yükle.
- `react/projects/lib/src/registry.ts` → widget tipi → React bileşeni eşlemesi (görsel registry fikri).

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz.

## Sorgu nasıl üretiliyor
Uygulanamaz.

## react-grid-layout ile karşılaştırma
| Kriter | react-grid-layout 2.3.0 | gridstack.js 14.1.1 |
|---|---|---|
| React entegrasyonu | Native, kontrollü state (`layout` prop) | Wrapper; DOM gridstack'te, React portal ile |
| Serbest yerleşim | `noCompactor` | `float` modu |
| İç içe grid / gruplama | Yok | Var (`subGridOpts`) |
| Grid'ler arası taşıma | Yok | Var |
| Mobil/touch | `react-draggable` üzerinden | Kendi `dd-touch.ts` |
| Saf algoritma ayrı paketi | `react-grid-layout/core` | `gridstack-engine.ts` (sınıf içinde) |
| Bağımlılık | 4 küçük MIT paket | 0 |

## Alınacak fikirler
- Widget JSON + `component`/`props` registry deseni (görsel tipi → bileşen).
- Nested grid ile görsel gruplama; `sizeToContent` ile tablo/metin kutularının otomatik yüksekliği.

## Kaçınılacaklar / zayıf yönler
- React wrapper resmi ama ince; "React state tek doğruluk kaynağı" ilkesiyle çatışıyor (`DESIGN-DECISIONS.md` bunu açıkça önermiyor). Undo/redo, Zustand/Redux store entegrasyonu zorlaşır.
- React wrapper `react/projects/lib` altında ayrı build gerektiriyor (`gridstack/dist/react`).
- Sık major sürüm (v14) → API kırılmaları.

## Kullanım kararı: Fikir al
React-first Floem BI için react-grid-layout tercih edilmeli; gruplama/nested grid ihtiyacı kritikleşirse gridstack yedek aday (MIT, bağımlılık olarak kullanılabilir).
