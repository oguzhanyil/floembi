# dnd-kit
- URL: https://github.com/clauderic/dnd-kit
- Lisans: MIT (kök `LICENSE` doğrulandı, "Copyright (c) 2021, Claudéric Demers"; `packages/*/LICENSE` — abstract, collision, dom, geometry, helpers, react, solid, state, svelte, vue — hepsi MIT kopyası)
- Dil: TypeScript · çekirdek framework-bağımsız + React/Vue/Svelte/Solid adapter'ları
- Son commit: 2026-10-31 · Versiyon: `@dnd-kit/react` / `@dnd-kit/dom` **0.5.3**
- Not: `main` branch artık yeni katmanlı mimari (`@dnd-kit/abstract` → `@dnd-kit/dom` → `@dnd-kit/react`). Yaygın bilinen `@dnd-kit/core` 6.x + `@dnd-kit/sortable` bu branch'te yok (npm'de hâlâ mevcut, ayrı/eski hat).
- Bağımlılık: `@dnd-kit/state` → `@preact/signals-core` (MIT).

## Ne yapıyor
Erişilebilir, performanslı sürükle-bırak toolkit'i. Draggable/droppable/sortable primitifleri,
pointer/klavye sensörleri, çarpışma algoritmaları, otomatik scroll, ekran okuyucu duyuruları sağlar.
Çoklu container arası sortable (Kanban tarzı) birinci sınıf senaryo. UI içermez; stil tamamen uygulamada.

## Mimari
- `packages/abstract/` → framework/DOM-bağımsız manager, entity (`Draggable`, `Droppable`), plugin/sensor soyutlamaları.
- `packages/dom/src/core/` → DOM implementasyonu: `sensors/` (pointer, keyboard), `plugins/` (accessibility, feedback, scrolling, cursor, selection), `entities/`.
- `packages/dom/src/sortable/` → sortable katmanı.
- `packages/collision/` → çarpışma algoritmaları; `packages/helpers/src/move.ts` → `move()`/`arrayMove()` state yardımcıları.
- `packages/state/` → signals tabanlı reaktif store.
- `packages/react/src/` → `DragDropProvider`, `useDraggable`, `useDroppable`, `useSortable`, `DragOverlay`.
- Veri akışı: `DragDropProvider` olayları (`onDragStart/Over/End`) → uygulama `move(items, event)` ile kendi state'ini günceller (kontrollü).

## Floem BI için kritik kısımlar
- `apps/stories/stories/react/Sortable/MultipleLists/MultipleLists.tsx` → `Record<container, id[]>` state + `useSortable` + `move()` → **alan listesi → X / Y / Legend / Values kutuları** (her field well bir container; kutu içinde sıralama = alan sırası).
- `packages/abstract/src/core/entities/droppable/droppable.ts` → `accept` (type / fonksiyon) → **kutunun kabul ettiği alan tipi** (ör. Values yalnızca ölçü/sayısal, Legend yalnızca boyut); `type` ile ölçü vs kolon ayrımı.
- `packages/react/src/core/draggable/DragOverlay.tsx` → sürüklenen alanın "chip" önizlemesi (alan listesi kaynak öğe yerinde kalır = kopyalama semantiği).
- `packages/dom/src/core/plugins/accessibility/` (`Accessibility.ts`, `LiveRegion.ts`, `defaults.ts`) → ekran okuyucu talimatları + duyurular; Türkçe metinlerle özelleştirilebilir (`announcements`, `screenReaderInstructions`).
- `packages/dom/src/core/sensors/keyboard` → klavye ile alan taşıma (WCAG).
- Puck da sürükle-bırak için dnd-kit kullanıyor (bkz. `puck.md`) → tek DnD kütüphanesi standardı.

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz. Öneri: draggable `data = { kind: "column" | "measure", table, name, dataType }`;
field well state = `{ x: FieldRef[], y: FieldRef[], legend: FieldRef[], values: FieldRef[] }`.

## Sorgu nasıl üretiliyor
Uygulanamaz (field well state → backend sorgu isteğinin girdisi olur).

## Alınacak fikirler
- Kaynak (alan listesi) için `useDraggable` + `DragOverlay`, hedefler için `useSortable` + `accept`.
- `CollisionPriority` ile iç içe hedeflerde (görsel üzerine bırakma vs. field well) öncelik.
- Duyuru metinlerini i18n katmanına bağla.

## Kaçınılacaklar / zayıf yönler
- 0.x sürüm → API henüz kararlı değil; sürüm sabitle. Alternatif: olgun `@dnd-kit/core` 6.x hattı (aynı yazar, MIT) — ancak bu repo artık onu içermiyor, bakım durumu ayrıca kontrol edilmeli.
- HTML5 native DnD değil; işletim sistemi dosya sürükleme (Excel bırakma) için ayrı çözüm gerekir.

## Kullanım kararı: Bağımlılık olarak kullan
Field well sürükle-bırak ve rapor editörü içi DnD için standart kütüphane. 0.x vs 6.x seçimi MVP başında netleştirilmeli (Puck'ın kullandığı sürümle hizalamak avantajlı).
