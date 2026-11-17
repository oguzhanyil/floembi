import type { Relationship } from "@floem/client";
import { BaseEdge, useInternalNode, type Edge, type EdgeProps, type InternalNode } from "@xyflow/react";
import { memo } from "react";

export type RelEdgeData = { rel: Relationship; parallel: number; selectedRel: boolean };
export type RelEdgeT = Edge<RelEdgeData, "rel">;

type Box = { x: number; y: number; w: number; h: number };

function box(n: InternalNode): Box {
  const w = n.measured.width ?? 0;
  const h = n.measured.height ?? 0;
  return { x: n.internals.positionAbsolute.x + w / 2, y: n.internals.positionAbsolute.y + h / 2, w, h };
}

/** Kutu merkezinden diğer kutunun merkezine giden doğrunun kutu kenarını kestiği nokta. */
function border(from: Box, to: Box) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return { x: from.x, y: from.y };
  const sx = dx !== 0 ? from.w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? from.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: from.x + dx * s, y: from.y + dy * s };
}

const ARROW = "M -6,-5 L 5,0 L -6,5 Z";

/**
 * Power BI ilişki çizgisi: çok tarafında "*", bir tarafında "1", ortada filtre yönü oku
 * (filtre "bir" tarafından "çok" tarafına akar), pasif ilişki kesik çizgi.
 * Kaynak düğüm = çok tarafı, hedef düğüm = bir tarafı.
 */
function RelationshipEdgeImpl({ id, source, target, data, selected }: EdgeProps<RelEdgeT>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t || !data) return null;
  const cs = box(s);
  const ct = box(t);
  const len = Math.hypot(ct.x - cs.x, ct.y - cs.y) || 1;
  // Aynı iki tablo arasındaki paralel ilişkiler yana kaydırılır
  const nx = -(ct.y - cs.y) / len;
  const ny = (ct.x - cs.x) / len;
  const off = data.parallel * 14;
  const a0 = border(cs, ct);
  const b0 = border(ct, cs);
  const a = { x: a0.x + nx * off, y: a0.y + ny * off };
  const b = { x: b0.x + nx * off, y: b0.y + ny * off };
  const seg = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / seg;
  const uy = (b.y - a.y) / seg;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const toMany = (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI;
  const { rel } = data;
  const cls = ["rel-edge", !rel.aktif && "inactive", (selected || data.selectedRel) && "active"].filter(Boolean).join(" ");
  const label = (p: { x: number; y: number }, dir: number) => ({ x: p.x + ux * 14 * dir + nx * 9, y: p.y + uy * 14 * dir + ny * 9 });
  const la = label(a, 1);
  const lb = label(b, -1);

  return (
    <g className={cls}>
      <BaseEdge id={id} path={`M ${a.x},${a.y} L ${b.x},${b.y}`} interactionWidth={18} />
      <text x={la.x} y={la.y} className="rel-card" textAnchor="middle" dominantBaseline="central">
        {rel.kardinalite === "1:1" ? "1" : "*"}
      </text>
      <text x={lb.x} y={lb.y} className="rel-card" textAnchor="middle" dominantBaseline="central">
        1
      </text>
      {rel.filtre_yonu === "cift" ? (
        <>
          <path d={ARROW} className="rel-arrow" transform={`translate(${mx + ux * 8},${my + uy * 8}) rotate(${toMany + 180})`} />
          <path d={ARROW} className="rel-arrow" transform={`translate(${mx - ux * 8},${my - uy * 8}) rotate(${toMany})`} />
        </>
      ) : (
        <path d={ARROW} className="rel-arrow" transform={`translate(${mx},${my}) rotate(${toMany})`} />
      )}
    </g>
  );
}

export const RelationshipEdge = memo(RelationshipEdgeImpl);
