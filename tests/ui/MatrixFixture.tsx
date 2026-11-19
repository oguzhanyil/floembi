import { useState } from "react";
import type { Visual, VisualState, VisualFormat, VisualResultColumn } from "../../packages/client/src/index";
import { MatrixVisual } from "../../packages/report/src/matrix";
import type { MatrixPart } from "../../packages/report/src/useVisualData";
import { VisualContextMenu } from "../../packages/report/src/VisualContextMenu";

const fields = ["Bölge", "Şehir", "Müşteri", "Yıl", "Ay"];
const data = [
  ["Marmara", "İstanbul", "A", 2026, "Ocak", 10, 2],
  ["Marmara", "İstanbul", "B", 2026, "Şubat", -3.5, 0],
  ["Marmara", "Bursa", null, 2027, "Ocak", 0, 4],
  ["Ege", "İzmir", "A", 2026, "Ocak", 12.75, 6],
];
const parts: MatrixPart[] = [];
for (let r = 0; r <= 3; r++) for (let c = 0; c <= 2; c++) {
  const positions = [...Array.from({ length: r }, (_, i) => i), ...Array.from({ length: c }, (_, i) => i + 3)];
  const groups = new Map<string, { path: (string | number | null)[]; sum: number; samples: number[] }>();
  for (const row of data) {
    const path = positions.map((i) => row[i]);
    const key = JSON.stringify(path);
    const group = groups.get(key) ?? { path, sum: 0, samples: [] };
    group.sum += Number(row[5]); group.samples.push(Number(row[6])); groups.set(key, group);
  }
  const columns: VisualResultColumn[] = [...positions.map((i) => ({ name: fields[i], kind: "group" as const, type: i === 3 ? "int32" as const : "string" as const })),
    { name: "Tutar", kind: "value", type: "double" }, { name: "Ortalama", kind: "value", type: "double" }];
  parts.push({ r, c, result: { columns, rows: [...groups.values()].map((g) => [...g.path, g.sum, g.samples.reduce((a, b) => a + b, 0) / g.samples.length]), total: null, truncated: false } });
}
export function MatrixFixture() {
  const [state, setState] = useState<VisualState>({ expanded: [] });
  const [format, setFormat] = useState<VisualFormat>({});
  const [tree, setTree] = useState(false);
  Object.assign(window, { setMatrixState: setState, setMatrixOptions: setFormat, setMatrixTree: setTree });
  const v: Visual = { id: "hierarchy", title: "Satış hiyerarşisi", type: tree ? "treegrid" : "matrix", x: 0, y: 0, w: 1200, h: 500,
    group: fields.slice(0, 3).map((column) => ({ table: "T", column })),
    legend: fields.slice(3).map((column) => ({ table: "T", column })),
    values: [{ table: "T", column: "Tutar", agg: "sum" }, { table: "T", column: "Ortalama", agg: "avg" }], filters: [], format };
  return <div className="matrix-fixture" style={{ padding: 20 }}>
    <h2>Satış hiyerarşisi · Bölge → Şehir → Müşteri</h2>
    <VisualContextMenu visual={v}><div className="visual" style={{ position: "relative", width: 1200, height: 500 }}>
      <MatrixVisual v={v} parts={parts} state={state} onState={setState} />
    </div></VisualContextMenu>
  </div>;
}
