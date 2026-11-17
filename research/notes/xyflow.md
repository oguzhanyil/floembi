# xyflow (React Flow)
- URL: https://github.com/xyflow/xyflow
- Lisans: MIT (kök `LICENSE` doğrulandı, "Copyright (c) 2019-2025 webkid GmbH"; repoda başka LICENSE dosyası yok)
- Dil: TypeScript (React, Svelte, Vue paketleri + framework-agnostik `@xyflow/system`)
- Son commit: 2026-11-17 · Versiyon: `@xyflow/react` 13.0.1, `@xyflow/system` 1.0.0
- Bağımlılıklar (`packages/react/package.json`): `@xyflow/system`, `zustand`, `classcat`, `react-compiler-runtime` (hepsi MIT)

## Ne yapıyor
Node + edge tabanlı etkileşimli diyagram/graph editörü çatısı. Pan/zoom, node sürükleme, seçim,
handle'lar arasında bağlantı kurma, minimap, controls, node resizer/toolbar sağlar. Node ve edge'ler
tamamen custom React bileşeni olabilir. Otomatik yerleşim (layout) motoru İÇERMEZ; dagre/elkjs gibi
harici kütüphanelerle kullanılması bekleniyor.

## Mimari
- `packages/system/src/` → framework-bağımsız çekirdek: `xypanzoom` (d3-zoom tabanlı), `xydrag`, `xyhandle` (bağlantı), `xyresizer`, `xyminimap`, `utils/edges/` (bezier/smoothstep/straight path hesapları).
- `packages/react/src/container/` → `ReactFlow`, `GraphView`, `NodeRenderer`, `EdgeRenderer`, `ZoomPane`.
- `packages/react/src/store/` → zustand store (nodes, edges, viewport); dışarıya `onNodesChange`/`onEdgesChange` ile kontrollü akış.
- `packages/react/src/additional-components/` → `Background`, `Controls`, `MiniMap`, `NodeResizer`, `NodeToolbar`, `EdgeToolbar`.
- Veri akışı: `nodes[]`/`edges[]` state (uygulamada) → `<ReactFlow>` → kullanıcı etkileşimi → `NodeChange`/`EdgeChange` → `applyNodeChanges` → state.

## Floem BI için kritik kısımlar
- `packages/react/src/components/Handle/index.tsx` → `<Handle id=... type="source|target">`; bir node'da birden çok id'li handle → **kolon bazlı handle** (her kolon satırına bir handle; edge `sourceHandle`/`targetHandle` = kolon adı).
- `packages/react/src/hooks/useUpdateNodeInternals.ts` → handle sayısı/konumu değiştiğinde (kolon ekle/gizle, tablo kutusunu daralt) yeniden ölçüm → model görünümünde kolon listesi dinamik olduğu için şart.
- `examples/react/src/examples/Edges/CustomEdge*.tsx` + `packages/react/src/components/EdgeLabelRenderer` → custom edge + HTML label → **kardinalite etiketi (1 / *), filtre yönü oku**; `BaseEdge` + `getSmoothStepPath`.
- `examples/react/src/examples/CustomNode/` → custom node → **tablo kutusu** (başlık + kolon listesi + ölçü ikonları).
- `examples/react/src/examples/Layouting/index.tsx` → `dagre` ile otomatik yerleşim örneği → model görünümünde "Auto layout" butonu.
- `examples/react/src/examples/FloatingEdges/` → node kenarına yapışan edge'ler → tablo-düzeyi ilişki görünümü (kolon seçmeden).
- `packages/react/src/components/A11yDescriptions/` → aria-live mesajları, klavye ile node taşıma.
- `examples/react/src/examples/SaveRestore/` → `toObject()` ile viewport + node pozisyonlarını JSON kaydetme → model diyagram yerleşimini semantik model meta verisinde saklama.

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz (yalnızca görsel katman). Floem BI önerisi: `Node.data = { table, columns[], measures[] }`,
`Edge = { source: tableA, sourceHandle: colA, target: tableB, targetHandle: colB, data: { cardinality: "1:*", crossFilter: "single|both", active: true } }`.

## Sorgu nasıl üretiliyor
Uygulanamaz.

## Alınacak fikirler
- Semantik model → nodes/edges dönüşümünü saf fonksiyon yap; diyagram yalnızca projeksiyon, kaynak gerçek semantik model JSON'u.
- Kolon bazlı handle + `isValidConnection` ile tip uyumsuz kolonları bağlamayı engelleme (`examples/.../Validation`).
- Onlarca tablo için `onlyRenderVisibleElements` ve `useVisibleNodeIds` (performans).

## Kaçınılacaklar / zayıf yönler
- Otomatik yerleşim yok. `dagre` (MIT) uygun; **`elkjs` EPL-2.0 → izin verilen lisans listesinde değil, kullanma.**
- Attribution: canvas köşesinde "React Flow" linki gösteriliyor (`components/Attribution`). `proOptions.hideAttribution` ile gizlenebilir; README: bu yasal zorunluluk değil, ancak gizlenirse Pro aboneliği "bekleniyor" (MIT gereği zorunlu değil).
- React Flow Pro: Pro örnekler/şablonlar (ör. gelişmiş auto-layout, helper lines) bu repoda değil, abonelikle ayrı veriliyor; kütüphanenin kendisi tamamen MIT, Pro'ya bağımlılık yok. Pro kodunu kopyalamayın (repoda olmadığı için lisansı doğrulanamadı).
- Major versiyon sıçramaları (v13) → API değişikliklerine karşı sürüm sabitle.

## Kullanım kararı: Bağımlılık olarak kullan
`@xyflow/react` + `dagre` (veya `@dagrejs/dagre`) → model görünümü. Ticari ürün için Pro aboneliği opsiyonel (attribution gizlenecekse etik olarak önerilir).
