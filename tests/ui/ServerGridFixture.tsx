import { useCallback, useState } from "react";
import type { ReportDefinition, VisualQuery, VisualResult } from "../../packages/client/src/index";
import { FloemApiError } from "../../packages/client/src/index";
import { ReportDesigner } from "../../packages/designer/src/ReportDesigner";
import { ReportViewer } from "../../packages/report/src/index";

const initial: ReportDefinition = { version: 1, pages: [{ id: "p", name: "Büyük tablo", width: 1280, height: 850, visuals: [
  { id: "large", type: "table", x: 40, y: 60, w: 1200, h: 700, group: [{ table: "F", column: "Id" }], values: [{ measure: "Net" }], filters: [], format: { gridDataMode: "server", gridPageSize: 25, gridFitColumns: true } },
] }] };
export function ServerGridFixture() {
  const [report, setReport] = useState(initial), [viewer, setViewer] = useState(false), [version, setVersion] = useState(1);
  const run = useCallback(async (q: VisualQuery): Promise<VisualResult> => {
    const w = window as unknown as { serverGridQueries: VisualQuery[]; serverGridDelay?: number };
    w.serverGridQueries ??= []; w.serverGridQueries.push(q);
    if (w.serverGridDelay) await new Promise((r) => setTimeout(r, w.serverGridDelay));
    const p = q.page!; if (!p) throw new Error("Sunucu modu eski sorguyu çalıştırdı");
    const snapshot = `snapshot${version}`;
    const revision = JSON.stringify([q.group, q.values, q.filters, q.order_by, p.search, p.column_filters, version]);
    if (p.snapshot && p.snapshot !== snapshot || p.revision && p.revision !== revision) throw new FloemApiError(400, "query_error", "Görsel sorgusu çalıştırılamadı", "Veri veya sorgu kapsamı değişti. İlk sayfadan yeniden yükleyin.");
    const tree = q.group.some((g) => g.column === "Region"), child = tree && q.group.length > 1;
    let rows: VisualResult["rows"] = tree && !child ? [["Doğu",42],["Batı",84]] : Array.from({length:12050},(_,i)=>child ? [q.filters?.find(f=>f.column==="Region")?.values[0] ?? "Doğu", i, i%3+1] : [i,i%3+1]);
    if (p.search) rows = rows.filter((r) => r.some((x)=>String(x).toLowerCase().includes(p.search!.toLowerCase())));
    for(const f of p.column_filters ?? []) rows = rows.filter((r)=>f.op === "greaterThan" ? Number(r[f.index])>Number(f.value) : f.op === "equals" ? String(r[f.index])===String(f.value) : String(r[f.index]).includes(String(f.value)));
    const sort = q.order_by?.[0]; if(sort) rows.sort((a,b)=>(Number(a[sort.index])-Number(b[sort.index]))*(sort.desc?-1:1));
    const totalRows = rows.length;
    const columns: VisualResult["columns"] = [...q.group.map(g=>({name:g.column,kind:"group" as const,type:g.column==="Id"?"int64" as const:"string" as const})), {name:"Net",kind:"value",type:"double"}];
    return { columns, rows:rows.slice(p.offset,p.offset+p.size), total:[25000], truncated:totalRows>p.size,
      page:{offset:p.offset,size:p.size,totalRows,hasMore:p.offset+p.size<totalRows,revision,snapshot,totalScope:"report_filters"} };
  },[version]);
  Object.assign(window,{serverGridViewer:setViewer,serverGridVersion:setVersion,serverGridTree:()=>setReport((r)=>({...r,pages:r.pages.map(p=>({...p,visuals:p.visuals.map(v=>({...v,type:"treegrid",group:[{table:"F",column:"Region"},{table:"F",column:"Id"}]}))}))})),savedServerGrid:report});
  return <div className="studio server-grid-fixture" style={{height:"100vh"}}>{viewer ? <ReportViewer report={report} run={run}/> : <ReportDesigner host={{report,tables:[],dataRev:"big",run,save:async(r)=>setReport(r),onError:console.error}}/>}</div>;
}
