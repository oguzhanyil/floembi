import { parseRef, type DiagramPosition, type Relationship } from "@floem/client";
import {
  Background, Controls, Panel, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow,
  type EdgeTypes, type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./model.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toUiError, useClient } from "../api";
import { useDocument } from "../document";
import { DataPane } from "./DataPane";
import { ManageRelationships } from "./ManageRelationships";
import { ModelViewContext, type ColumnPick, type ModelViewApi } from "./ModelContext";
import { NODE_WIDTH, autoLayout, nodeHeight, relId, relTables, type Selection } from "./modelUtils";
import { PropertiesPane } from "./PropertiesPane";
import { RelationshipDialog, type RelationshipDraft } from "./RelationshipDialog";
import { RelationshipEdge, type RelEdgeT } from "./RelationshipEdge";
import { TableNode, type TableNodeT } from "./TableNode";
import { TablePreviewDialog } from "./TablePreviewDialog";

const nodeTypes = { table: TableNode } as unknown as NodeTypes;
const edgeTypes = { rel: RelationshipEdge } as unknown as EdgeTypes;

type Dialog =
  | { kind: "rel"; draft: RelationshipDraft; editing?: { kimden: string; kime: string } }
  | { kind: "manage" }
  | { kind: "preview"; table: string }
  | null;

/** Power BI'daki model görünümü: tablo kartları, ilişki çizgileri, Özellikler ve Veri bölmeleri. */
export function ModelView({ onGetData, onRefreshTable }: { onGetData: () => void; onRefreshTable: (t: string) => void }) {
  const { doc } = useDocument();
  if (!doc) return null;
  if (doc.model.tablolar.length === 0) {
    return (
      <div className="empty-state">
        <h2>Model görünümü</h2>
        <p>Modelde henüz tablo yok. Veri al → SQL Server ile tabloları seçip yükleyin.</p>
        <button className="primary" onClick={onGetData}>
          Veri al
        </button>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <ModelCanvas onRefreshTable={onRefreshTable} />
    </ReactFlowProvider>
  );
}

function ModelCanvas({ onRefreshTable }: { onRefreshTable: (t: string) => void }) {
  const client = useClient();
  const { doc, reload, apply, setError } = useDocument();
  const rf = useReactFlow();
  const [selection, setSelection] = useState<Selection>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<TableNodeT>([]);
  // Düğümler yerleşince diyagram kaydedilecek mi: "auto" (açılışta) belgeyi değişti saymaz
  const persistPending = useRef<null | "auto" | "user">(null);

  const tables = doc!.model.tablolar;
  const rels = doc!.model.iliskiler;
  const diagram = doc!.diagram.tables ?? {};
  const stats = doc!.stats;

  // Seçili öğe modelden kalktıysa (silme, yeniden adlandırma) seçimi temizle
  useEffect(() => {
    if (!selection) return;
    const t = selection.kind === "relationship" ? null : tables.find((x) => x.ad === selection.table);
    const ok =
      selection.kind === "relationship"
        ? rels.some((r) => r.kimden === selection.kimden && r.kime === selection.kime)
        : !!t && (selection.kind === "table" || t.sutunlar.some((c) => c.ad === selection.column));
    if (!ok) setSelection(null);
  }, [tables, rels, selection]);

  // Model değişince düğümleri yeniden kur; mevcut konumları koru, yeni tabloları yerleştir
  useEffect(() => {
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      const collapsed = Object.fromEntries(Object.entries(diagram).map(([k, v]) => [k, !!v.collapsed]));
      const missing = tables.filter((t) => !prevPos.has(t.ad) && !diagram[t.ad]);
      let placed: Record<string, { x: number; y: number }> = {};
      if (missing.length === tables.length) {
        placed = autoLayout(tables, rels, collapsed);
      } else if (missing.length) {
        // Yeni gelen tablolar mevcut diyagramın sağına sütun halinde dizilir
        const known = tables.filter((t) => !missing.includes(t)).map((t) => prevPos.get(t.ad) ?? diagram[t.ad]);
        const right = Math.max(...known.map((p) => p.x)) + NODE_WIDTH + 120;
        let y = Math.min(...known.map((p) => p.y));
        for (const t of missing) {
          placed[t.ad] = { x: right, y };
          y += nodeHeight(t, false) + 40;
        }
      }
      // Hiç konum yoksa (dosyada diyagram yok) "auto"; yeni tablolar eklendiyse model zaten değişti
      if (missing.length) persistPending.current = missing.length === tables.length ? "auto" : "user";
      return tables.map((t) => ({
        id: t.ad,
        type: "table" as const,
        position: prevPos.get(t.ad) ?? (diagram[t.ad] ? { x: diagram[t.ad].x, y: diagram[t.ad].y } : placed[t.ad]),
        data: { table: t, rows: stats[t.ad]?.rows ?? null, collapsed: !!diagram[t.ad]?.collapsed },
      }));
    });
  }, [tables, rels, diagram, stats, setNodes]);

  const persist = useCallback(
    async (overrides?: Record<string, Partial<DiagramPosition>>, auto = false) => {
      const map: Record<string, DiagramPosition> = {};
      for (const n of rf.getNodes()) {
        map[n.id] = {
          x: n.position.x,
          y: n.position.y,
          collapsed: !!(n.data as TableNodeT["data"]).collapsed,
          ...(overrides?.[n.id] ?? {}),
        };
      }
      try {
        await client.setDiagram(map, auto);
        await reload();
      } catch (e) {
        setError(toUiError(e));
      }
    },
    [rf, client, reload, setError],
  );

  useEffect(() => {
    if (persistPending.current && nodes.length) {
      const auto = persistPending.current === "auto";
      persistPending.current = null;
      void persist(undefined, auto);
    }
  }, [nodes, persist]);

  const edges: RelEdgeT[] = useMemo(() => {
    const groups = new Map<string, Relationship[]>();
    for (const r of rels) {
      const k = relTables(r).map((x) => x.toLowerCase()).sort().join("|");
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return rels.map((r) => {
      const [a, b] = relTables(r);
      const g = groups.get([a, b].map((x) => x.toLowerCase()).sort().join("|"))!;
      let parallel = g.indexOf(r) - (g.length - 1) / 2;
      if (a.toLowerCase() > b.toLowerCase()) parallel = -parallel; // ters yönlü ilişkiler üst üste binmesin
      const selectedRel = selection?.kind === "relationship" && selection.kimden === r.kimden && selection.kime === r.kime;
      return { id: relId(r), source: a, target: b, type: "rel" as const, data: { rel: r, parallel, selectedRel }, zIndex: selectedRel ? 1 : 0 };
    });
  }, [rels, selection]);

  const highlighted = useMemo(() => {
    if (selection?.kind !== "relationship") return new Set<string>();
    return new Set([selection.kimden, selection.kime].map((ref) => {
      const [t, c] = parseRef(ref);
      return `${t}[${c}]`.toLowerCase();
    }));
  }, [selection]);

  const api: ModelViewApi = useMemo(
    () => ({
      selection,
      select: setSelection,
      highlighted,
      columnDrop: (from: ColumnPick, to: ColumnPick) =>
        setDialog({ kind: "rel", draft: { kimden: `${from.table}[${from.column}]`, kime: `${to.table}[${to.column}]` } }),
      toggleCollapsed: (table: string) => {
        const n = rf.getNode(table);
        if (n) void persist({ [table]: { collapsed: !(n.data as TableNodeT["data"]).collapsed } });
      },
    }),
    [selection, highlighted, rf, persist],
  );

  function editRelationship(kimden: string, kime: string) {
    const r = rels.find((x) => x.kimden === kimden && x.kime === kime);
    if (r) setDialog({ kind: "rel", draft: r, editing: { kimden, kime } });
  }

  async function deleteSelected() {
    if (selection?.kind === "relationship") {
      if (window.confirm(`${selection.kimden} → ${selection.kime} ilişkisi silinsin mi?`)) {
        if (await apply([{ op: "delete_relationship", kimden: selection.kimden, kime: selection.kime }])) setSelection(null);
      }
    } else if (selection?.kind === "table") {
      if (window.confirm(`'${selection.table}' tablosu ve ilişkileri modelden silinsin mi?`)) {
        if (await apply([{ op: "delete_table", table: selection.table }])) setSelection(null);
      }
    }
  }

  function arrange() {
    const collapsed = Object.fromEntries(rf.getNodes().map((n) => [n.id, !!(n.data as TableNodeT["data"]).collapsed]));
    const pos = autoLayout(tables, rels, collapsed);
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos[n.id] ?? n.position })));
    persistPending.current = "user";
    setTimeout(() => void rf.fitView({ duration: 300 }), 50);
  }

  function selectFromPane(s: Selection) {
    setSelection(s);
    if (s && s.kind !== "relationship") void rf.fitView({ nodes: [{ id: s.table }], duration: 300, maxZoom: 1.1 });
  }

  return (
    <ModelViewContext.Provider value={api}>
      <div className="model-view">
        <div
          className="model-canvas"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Delete" && !(e.target as HTMLElement).closest("input,select,textarea")) void deleteSelected();
          }}
        >
          <ReactFlow<TableNodeT, RelEdgeT>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={() => void persist()}
            onEdgeClick={(_, e) => setSelection({ kind: "relationship", kimden: e.data!.rel.kimden, kime: e.data!.rel.kime })}
            onEdgeDoubleClick={(_, e) => editRelationship(e.data!.rel.kimden, e.data!.rel.kime)}
            onPaneClick={() => setSelection(null)}
            nodesConnectable={false}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            minZoom={0.15}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <Panel position="top-left" className="model-toolbar">
              <button onClick={() => setDialog({ kind: "rel", draft: {} })}>Yeni ilişki</button>
              <button onClick={() => setDialog({ kind: "manage" })}>İlişkileri yönet</button>
              <button onClick={arrange} title="Tabloları ilişkilere göre yeniden yerleştir">
                Otomatik yerleştir
              </button>
            </Panel>
          </ReactFlow>
        </div>
        <PropertiesPane
          selection={selection}
          onSelect={setSelection}
          onPreview={(t) => setDialog({ kind: "preview", table: t })}
          onEditRelationship={editRelationship}
          onRefresh={onRefreshTable}
        />
        <DataPane tables={tables} selection={selection} onSelect={selectFromPane} />
      </div>
      {dialog?.kind === "rel" && (
        <RelationshipDialog draft={dialog.draft} editing={dialog.editing} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "manage" && (
        <ManageRelationships
          onClose={() => setDialog(null)}
          onEdit={(r) => setDialog({ kind: "rel", draft: r, editing: { kimden: r.kimden, kime: r.kime } })}
          onNew={(d) => setDialog({ kind: "rel", draft: d })}
        />
      )}
      {dialog?.kind === "preview" && (
        <TablePreviewDialog table={dialog.table} rows={stats[dialog.table]?.rows ?? null} onClose={() => setDialog(null)} />
      )}
    </ModelViewContext.Provider>
  );
}
