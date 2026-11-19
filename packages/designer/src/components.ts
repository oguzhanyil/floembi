import type { ComponentBinding, ComponentDefinition, ComponentInstance, ComponentSlot, ModelTable, ReportDefinition, ReportPage, ValueRef, Visual, VisualAction } from "@floem/client";
import { ancestors, descendants, lockedInLayout, resolvePageLayout } from "../../report/src/layout";
import { valueLabel, VISUAL_DEFS } from "../../report/src/reportUtils";

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
};
const clone = <T,>(v: T): T => structuredClone(v);
type Obj = Record<string, unknown>;
const at = (v: unknown, path: string[]): unknown => path.reduce<unknown>((node, key) => node && typeof node === "object" ? (node as Obj)[key] : undefined, v);
function patchAt(v: unknown, path: string[], binding: ComponentBinding) {
  const target = at(v, path) as Obj;
  if (!target || typeof target !== "object") throw new Error("Bileşen yuvasının hedefi bulunamadı.");
  for (const key of ["table", "column", "measure", "agg", "pageId", "visualId"]) delete target[key];
  Object.assign(target, binding);
}
function bindNodes(nodes: Visual[], definition: ComponentDefinition, bindings: ComponentInstance["bindings"], nodeMap?: Record<string, string>) {
  const tokens = new Map<string, Map<string, string>>();
  for (const slot of definition.slots) if (Object.hasOwn(bindings, slot.id)) for (const site of slot.sites) {
    const node = nodes.find((v) => v.id === (nodeMap ? nodeMap[site.visualId] : site.visualId));
    const before = node && at(node, site.path);
    if (!node || !before) continue; // Kullanıcının yerel olarak sildiği alan geri gelmez.
    if (node.type === "text" && site.path[0] === "values") {
      const changes = tokens.get(node.id) ?? new Map<string, string>();
      changes.set(valueLabel(before as ValueRef).toLocaleLowerCase("tr"), valueLabel(bindings[slot.id] as ValueRef)); tokens.set(node.id, changes);
    }
    patchAt(node, site.path, bindings[slot.id]);
  }
  for (const node of nodes) if (tokens.has(node.id) && typeof node.format.text === "string") node.format.text = node.format.text.replace(/\[([^\]]+)\]/g, (token, name: string) => {
    const replacement = tokens.get(node.id)!.get(name.trim().toLocaleLowerCase("tr")); return replacement ? `[${replacement}]` : token;
  });
}
function bindingOf(kind: ComponentSlot["kind"], v: unknown): ComponentBinding | undefined {
  if (!v || typeof v !== "object") return;
  const x = v as ComponentBinding;
  if (kind === "value") return x.measure ? { measure: x.measure } : x.table && x.column ? { table: x.table, column: x.column, agg: x.agg ?? "sum" } : undefined;
  if (kind === "field") return x.table && x.column ? { table: x.table, column: x.column } : undefined;
  if (kind === "measure") return x.measure ? { measure: x.measure } : undefined;
  if (kind === "page") return x.pageId ? { pageId: x.pageId } : undefined;
  return x.visualId ? { visualId: x.visualId } : undefined;
}
const nextId = (used: Set<string>) => { let n = 1; while (used.has(`v${n}`)) n++; const id = `v${n}`; used.add(id); return id; };
const keyOf = (c: ComponentDefinition) => `${c.id}:${c.version}`;
// Python'ın dosya/API doğrulamasında eklediği varsayılanlar aynı sürümü değiştirmez.
function canonicalDefinition(def: ComponentDefinition): ComponentDefinition {
  const result = clone(def);
  result.description ??= ""; result.slots ??= [];
  result.visuals = result.visuals.map(canonicalVisual);
  return result;
}
function canonicalVisual(v: Visual): Visual {
  v = clone(v);
  const node = Object.assign({ x: 0, y: 0, w: 420, h: 280, group: [], legend: [], values: [], target: [], filters: [], format: {}, state: {} }, v) as Visual;
  for (const key of ["title", "parentId", "container", "layoutItem", "component"] as const) if (node[key] == null) delete node[key];
  if (node.container) node.container = { kind: "frame", mode: "free", gap: 12, padding: 16, columns: 2, align: "stretch", justify: "start", wrap: true, autoHeight: false, overflow: "visible", ...node.container };
  if (node.layoutItem) node.layoutItem = { grow: 0, minWidth: 40, maxWidth: 20000, minHeight: 28, maxHeight: 20000, ...node.layoutItem };
  for (const refs of [node.values, node.target!]) for (const value of refs) {
    const ref = value as ComponentBinding;
    for (const key of ["table","column","measure","agg"] as const) if (ref[key] == null) delete ref[key];
    if (ref.table) ref.agg ??= "sum";
  }
  node.filters = node.filters.map((f) => ({ op: "in", ...f }));
  return node;
}
export function mergeDefinitions(...groups: ComponentDefinition[][]): ComponentDefinition[] {
  const result = new Map<string, ComponentDefinition>();
  for (const raw of groups.flat()) {
    const c = canonicalDefinition(raw);
    const old = result.get(keyOf(c));
    if (old && !same(old, c)) throw new Error(`“${c.name}” v${c.version} farklı içerikle zaten var. Yeni sürüm numarası gerekir.`);
    result.set(keyOf(c), c);
  }
  return [...result.values()];
}
export function latestDefinitions(items: ComponentDefinition[]): ComponentDefinition[] {
  const latest = new Map<string, ComponentDefinition>();
  for (const item of items) if (!latest.has(item.id) || latest.get(item.id)!.version < item.version) latest.set(item.id, item);
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Aynı model başvurusunun tüm kullanımları tek yuvaya bağlanır. */
export function discoverSlots(visuals: Visual[], previous: ComponentSlot[] = [], external = new Set<string>()): ComponentSlot[] {
  const slots: ComponentSlot[] = [], used = new Set(previous.map((s) => s.id));
  const add = (v: Visual, path: string[], kind: ComponentSlot["kind"]) => {
    const binding = bindingOf(kind, at(v, path)); if (!binding) return;
    const existing = slots.find((s) => s.kind === kind && same(s.defaultBinding, binding));
    if (existing) { existing.sites.push({ visualId: v.id, path }); return; }
    const old = previous.find((s) => s.kind === kind && s.sites.some((site) => site.visualId === v.id && same(site.path, path)));
    let id = old?.id;
    if (!id || slots.some((s) => s.id === id)) { let n = 1; while (used.has(`slot${n}`)) n++; id = `slot${n}`; used.add(id); }
    slots.push({ id, label: old?.label ?? binding.measure ?? binding.column ?? (kind === "page" ? "Hedef sayfa" : "Hedef nesne"), kind, defaultBinding: binding, sites: [{ visualId: v.id, path }] });
  };
  const actions = (v: Visual, path: string[], depth = 0) => {
    if (depth > 8) throw new Error("Bileşen menüsü en fazla 8 düzey olabilir.");
    const a = at(v, path) as VisualAction | undefined;
    if (!a) return;
    if (a.type === "page") add(v, path, "page");
    else if (a.type === "toggle" && (external.has(JSON.stringify([v.id, path])) || !visuals.some((node) => node.id === a.visualId))) add(v, path, "visual");
    else if (a.type === "function" && a.functionName === "measure") add(v, path, "measure");
    for (let i = 0; i < (a.items?.length ?? 0); i++) actions(v, [...path, "items", String(i), "action"], depth + 1);
  };
  for (const v of visuals) {
    for (const key of ["group", "legend", "values", "target", "filters"] as const) {
      for (let i = 0; i < (v[key]?.length ?? 0); i++) add(v, [key, String(i)], key === "values" || key === "target" ? "value" : "field");
    }
    actions(v, ["format", "action"]); actions(v, ["format", "rowAction", "action"]);
  }
  return slots;
}

export function captureComponent(page: ReportPage, rootId: string, name: string, description: string,
  identity: { id: string; version: number }, previous?: ComponentDefinition, resolved = resolvePageLayout(page).visuals): ComponentDefinition {
  const root = page.visuals.find((v) => v.id === rootId);
  if (!root || !name.trim()) throw new Error("Bileşene ad verin ve kaydedilecek nesneyi seçin.");
  const chosen = descendants(page, [rootId]);
  if (chosen.size > 200) throw new Error("Bir bileşen en fazla 200 nesne içerebilir.");
  const inverse = new Map(Object.entries(root.component?.nodeMap ?? {}).map(([key, value]) => [value, key]));
  const used = new Set([...(previous?.visuals.map((v) => v.id) ?? []), ...inverse.values()]);
  const map = new Map(page.visuals.filter((v) => chosen.has(v.id)).map((v) => [v.id, inverse.get(v.id) ?? nextId(used)]));
  const visuals = page.visuals.filter((v) => chosen.has(v.id)).map((v) => {
    const node = clone(v); delete node.component; node.state = {}; delete node.format.locked;
    node.id = map.get(v.id)!; node.parentId = v.id === rootId ? null : map.get(v.parentId!)!;
    if (v.id === rootId) { const placed = resolved.find((r) => r.id === rootId)!; node.x = 0; node.y = 0; node.w = placed.w; }
    const remap = (a?: VisualAction) => { if (!a) return; if (a.visualId && map.has(a.visualId)) a.visualId = map.get(a.visualId); a.items?.forEach((i) => remap(i.action)); };
    remap(node.format.action); remap(node.format.rowAction?.action);
    return node;
  });
  const external = new Set(discoverSlots(page.visuals.filter((v) => chosen.has(v.id))).filter((s) => s.kind === "visual").flatMap((s) => s.sites.map((site) => JSON.stringify([map.get(site.visualId), site.path]))));
  return { ...identity, name: name.trim(), description: description.trim(), rootId: map.get(rootId)!, visuals, slots: discoverSlots(visuals, previous?.slots, external) };
}

export function bindingChoices(slot: ComponentSlot, tables: ModelTable[], pages: ReportPage[], page: ReportPage): { label: string; binding: ComponentBinding }[] {
  if (slot.kind === "page") return pages.map((p) => ({ label: p.name, binding: { pageId: p.id } }));
  if (slot.kind === "visual") return page.visuals.map((v) => ({ label: v.title || v.id, binding: { visualId: v.id } }));
  const measures = tables.flatMap((t) => t.olculer.map((m) => ({ label: `${t.ad} · ${m.ad}`, binding: { measure: m.ad } })));
  if (slot.kind === "measure") return measures;
  const fields = tables.flatMap((t) => t.sutunlar.map((c) => ({ label: `${t.ad}[${c.ad}]`, binding: slot.kind === "field" ? { table: t.ad, column: c.ad } : { table: t.ad, column: c.ad, agg: ["int32", "int64", "decimal", "double"].includes(c.tip) ? "sum" as const : "count" as const } })));
  return slot.kind === "value" ? [...measures, ...fields] : fields;
}
export function bindingIssues(def: ComponentDefinition, bindings: ComponentInstance["bindings"], tables: ModelTable[], pages: ReportPage[], page: ReportPage): string[] {
  return def.slots.flatMap((s) => {
    const value = bindings[s.id];
    const choices = bindingChoices(s, tables, pages, page);
    const exists = value && choices.some((c) => same(c.binding, s.kind === "value" && value.table ? { ...value, agg: c.binding.agg } : value));
    const column = value?.table && tables.find((t) => t.ad === value.table)?.sutunlar.find((c) => c.ad === value.column);
    const aggOk = (!value?.agg || ["sum", "avg", "min", "max", "count", "distinctcount"].includes(value.agg)) && (!column || ["int32", "int64", "decimal", "double"].includes(column.tip) || ["min", "max", "count", "distinctcount"].includes(value.agg ?? "sum"));
    return exists && aggOk ? [] : [`“${s.label}” için bu raporda geçerli bir alan/hedef seçin.`];
  });
}
export function defaultBindings(def: ComponentDefinition, tables: ModelTable[], pages: ReportPage[], page: ReportPage) {
  return Object.fromEntries(def.slots.filter((s) => s.defaultBinding && !bindingIssues({ ...def, slots: [s] }, { [s.id]: s.defaultBinding }, tables, pages, page).length).map((s) => [s.id, clone(s.defaultBinding!)]));
}
function materialize(def: ComponentDefinition, link: ComponentInstance, placement: Pick<Visual, "x" | "y" | "parentId">): Visual[] {
  const nodes = canonicalDefinition(def).visuals;
  for (const v of nodes) {
    const remap = (a?: VisualAction) => { if (!a) return; if (a.visualId && Object.hasOwn(link.nodeMap, a.visualId)) a.visualId = link.nodeMap[a.visualId]; a.items?.forEach((i) => remap(i.action)); };
    remap(v.format.action); remap(v.format.rowAction?.action);
  }
  bindNodes(nodes, def, link.bindings);
  for (const v of nodes) {
    const id = v.id;
    v.id = link.nodeMap[id]; v.parentId = id === def.rootId ? placement.parentId ?? null : link.nodeMap[v.parentId!];
    if (id === def.rootId) { v.x = placement.x; v.y = placement.y; }
  }
  return nodes.map(canonicalVisual);
}
export function linkSource(report: ReportDefinition, pageId: string, rootId: string, definition: ComponentDefinition): ReportDefinition {
  const page = report.pages.find((p) => p.id === pageId)!, ids = descendants(page, [rootId]);
  const originals = page.visuals.filter((v) => ids.has(v.id));
  const component: ComponentInstance = { definitionId: definition.id, version: definition.version,
    nodeMap: Object.fromEntries(definition.visuals.map((v, i) => [v.id, originals[i].id])),
    bindings: Object.fromEntries(definition.slots.map((s) => [s.id, clone(s.defaultBinding!)])) };
  return { ...report, components: mergeDefinitions(report.components ?? [], [definition]), pages: report.pages.map((p) => p.id === pageId ? { ...p, visuals: p.visuals.map((v) => {
    if (v.id === rootId) return { ...v, component };
    if (!ids.has(v.id) || !v.component) return v;
    const plain = { ...v }; delete plain.component; return plain;
  }) } : p) };
}
export function insertComponent(report: ReportDefinition, pageId: string, def: ComponentDefinition, bindings: ComponentInstance["bindings"], tables: ModelTable[], x = 48, y = 48) {
  const page = report.pages.find((p) => p.id === pageId)!;
  const issues = bindingIssues(def, bindings, tables, report.pages, page); if (issues.length) throw new Error(issues.join("\n"));
  const used = new Set(report.pages.flatMap((p) => p.visuals.flatMap((v) => [v.id, ...Object.values(v.component?.nodeMap ?? {})])));
  const link: ComponentInstance = { definitionId: def.id, version: def.version, bindings: clone(bindings), nodeMap: Object.fromEntries(def.visuals.map((v) => [v.id, nextId(used)])) };
  const nodes = materialize(def, link, { x, y }); nodes.find((v) => v.id === link.nodeMap[def.rootId])!.component = link;
  return { report: { ...report, components: mergeDefinitions(report.components ?? [], [def]), pages: report.pages.map((p) => p.id === pageId ? { ...p, visuals: [...p.visuals, ...nodes] } : p) }, rootId: link.nodeMap[def.rootId] };
}

/** Derin üç yönlü birleşim: yalnız eski temelden farklı olan yerel özellikler korunur. */
function mergeLocal(base: unknown, local: unknown, incoming: unknown): unknown {
  if (same(local, base)) return clone(incoming);
  if (base && local && incoming && !Array.isArray(base) && !Array.isArray(local) && !Array.isArray(incoming) && typeof base === "object" && typeof local === "object" && typeof incoming === "object") {
    const result: Obj = {}, keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)]);
    for (const key of keys) { const value = mergeLocal((base as Obj)[key], (local as Obj)[key], (incoming as Obj)[key]); if (value !== undefined) result[key] = value; }
    return result;
  }
  return clone(local);
}
export function componentOwner(page: ReportPage, id: string): Visual | undefined {
  return [page.visuals.find((v) => v.id === id), ...ancestors(page, id)].find((v) => v?.component);
}
export function repairInstances(page: ReportPage, definitions: ComponentDefinition[]): ReportPage {
  let changed = false;
  const visuals = page.visuals.map((v) => {
    if (!v.component) return v;
    const subtree = descendants(page, [v.id]), existing = new Set(page.visuals.map((n) => n.id));
    if (Object.values(v.component.nodeMap).some((id) => existing.has(id) && !subtree.has(id))) { const next = { ...v }; delete next.component; changed = true; return next; }
    const def = definitions.find((d) => d.id === v.component!.definitionId && d.version === v.component!.version); if (!def) return v;
    const bindings = { ...v.component.bindings };
    for (const slot of def.slots) {
      const refs = slot.sites.map((s) => bindingOf(slot.kind, at(page.visuals.find((n) => n.id === v.component!.nodeMap[s.visualId]), s.path))).filter(Boolean);
      if (refs.length && refs.every((b) => same(b, refs[0]))) bindings[slot.id] = refs[0]!;
    }
    if (same(bindings, v.component.bindings)) return v;
    changed = true; return { ...v, component: { ...v.component, bindings } };
  });
  return changed ? { ...page, visuals } : page;
}

export function updateInstances(report: ReportDefinition, incoming: ComponentDefinition, rootIds: string[], tables: ModelTable[], extraBindings: ComponentInstance["bindings"] = {}) {
  let changed = 0, localProperties = 0;
  const used = new Set(report.pages.flatMap((p) => p.visuals.flatMap((v) => [v.id, ...Object.values(v.component?.nodeMap ?? {})])));
  const pages = report.pages.map((page) => {
    let visuals = page.visuals;
    for (const root of page.visuals.filter((v) => rootIds.includes(v.id) && v.component?.definitionId === incoming.id)) {
      if (lockedInLayout(page, root.id)) throw new Error(`“${root.title || root.id}” kilitli; önce kilidini açın.`);
      const link = root.component!, old = report.components?.find((d) => d.id === link.definitionId && d.version === link.version);
      if (!old) throw new Error("Bileşenin önceki sürümü dosyada bulunamadı.");
      const bindings = Object.fromEntries(incoming.slots.map((s) => [s.id, extraBindings[s.id] ?? link.bindings[s.id] ?? s.defaultBinding]));
      const issues = bindingIssues(incoming, bindings, tables, report.pages, page); if (issues.length) throw new Error(issues.join("\n"));
      const nodeMap = Object.fromEntries(incoming.visuals.map((v) => [v.id, link.nodeMap[v.id] ?? nextId(used)]));
      const nextLink: ComponentInstance = { definitionId: incoming.id, version: incoming.version, bindings, nodeMap };
      const base = materialize(old, link, root), next = materialize(incoming, nextLink, root);
      const rootSubtree = descendants({ ...page, visuals }, [root.id]);
      const mappedOld = new Set(Object.values(link.nodeMap));
      const additions = visuals.filter((v) => rootSubtree.has(v.id) && !mappedOld.has(v.id)).map(clone);
      const merged: Visual[] = [];
      const removed = descendants({ ...page, visuals: next }, base.filter((v) => !visuals.some((actual) => actual.id === v.id)).map((v) => v.id));
      for (const node of next) {
        const before = base.find((v) => v.id === node.id), actual = visuals.find((v) => v.id === node.id);
        if (removed.has(node.id)) continue; // Yerel silme ve alt dalları korunur.
        let result = node;
        if (before && actual) {
          const plain = canonicalVisual(actual); delete plain.component;
          if (!same(before, plain)) localProperties++;
          result = mergeLocal(before, plain, node) as Visual;
        }
        if (node.id === root.id) result = { ...result, x: root.x, y: root.y, parentId: root.parentId, component: nextLink };
        merged.push(result);
      }
      // Kaynaktan kaldırılmış ama yerelde özelleştirilmiş nesneler korunur.
      for (const before of base) if (!next.some((v) => v.id === before.id)) {
        const actual = visuals.find((v) => v.id === before.id);
        if (actual && !same(before, canonicalVisual(actual))) { merged.push(clone(actual)); localProperties++; }
      }
      merged.push(...additions);
      bindNodes(merged, incoming, extraBindings, nodeMap);
      const retained = new Set(merged.map((v) => v.id));
      // Üst nesne kaldırıldıysa kalan yerel nesne köke çıkar; yerel silinen dal canlanmaz.
      for (const node of merged) if (node.id !== root.id && node.parentId && !retained.has(node.parentId)) node.parentId = root.id;
      const index = visuals.findIndex((v) => v.id === root.id);
      const rest = visuals.filter((v) => !rootSubtree.has(v.id)); rest.splice(Math.min(index, rest.length), 0, ...merged); visuals = rest; changed++;
    }
    return visuals === page.visuals ? page : { ...page, visuals };
  });
  return { report: { ...report, components: mergeDefinitions(report.components ?? [], [incoming]), pages }, changed, localProperties };
}

/** JSON kitaplığını çizmeden önce şekil, yol ve ağaç sınırlarını doğrular. Sunucu da bağımsız doğrular. */
export function parseComponentFile(text: string): ComponentDefinition[] {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error("Kitaplık dosyası 10 MB sınırını aşıyor.");
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Bileşen dosyası geçerli JSON değil."); }
  if (data?.version !== 1 || !Array.isArray(data.components) || data.components.length > 500) throw new Error("Geçerli bir Floem bileşen kitaplığı seçin.");
  for (const d of data.components as ComponentDefinition[]) {
    if (!d || typeof d.id !== "string" || !d.id || d.id.length > 80 || typeof d.name !== "string" || !d.name.trim() || d.name.length > 120 || typeof d.description !== "string" || d.description.length > 1000 || !Number.isInteger(d.version) || d.version < 1 || d.version > 100000 || !Array.isArray(d.visuals) || !d.visuals.length || d.visuals.length > 200 || !Array.isArray(d.slots) || d.slots.length > 200) throw new Error("Bileşen tanımı geçersiz.");
    if (d.visuals.some((v) => !v || typeof v !== "object")) throw new Error("Bileşendeki nesne tanımı geçersiz.");
    const ids = new Set(d.visuals.map((v) => v.id));
    if (ids.size !== d.visuals.length || d.visuals.filter((v) => !v.parentId).length !== 1 || !d.visuals.some((v) => v.id === d.rootId && !v.parentId)) throw new Error("Bileşenin tek ve benzersiz bir kökü olmalı.");
    for (const v of d.visuals) {
      if (typeof v.id !== "string" || !v.id || v.id.length > 64 || ["__proto__", "constructor", "prototype"].includes(v.id) || !Object.hasOwn(VISUAL_DEFS, v.type) || ![v.x,v.y,v.w,v.h].every(Number.isFinite) || v.w <= 0 || v.h <= 0 || !v.format || typeof v.format !== "object" || Array.isArray(v.format) || !Array.isArray(v.group) || !Array.isArray(v.values) || !Array.isArray(v.filters) || v.component) throw new Error("Bileşendeki nesne tanımı geçersiz.");
      for (const key of ["group","legend","values","target","filters"] as const) {
        if (v[key] !== undefined && !Array.isArray(v[key])) throw new Error("Bileşen alan listesi geçersiz.");
        for (const ref of v[key] ?? []) if (!bindingOf(key === "values" || key === "target" ? "value" : "field", ref)) throw new Error("Bileşen alan başvurusu geçersiz.");
      }
      if (v.container && (v.type !== "container" || !["free","horizontal","vertical","grid"].includes(v.container.mode ?? "free"))) throw new Error("Bileşen kapsayıcı düzeni geçersiz.");
      for (const [key, min, max] of [["gap",0,128],["padding",0,128],["columns",1,12]] as const) if (v.container?.[key] !== undefined && (!Number.isFinite(v.container[key]) || v.container[key]! < min || v.container[key]! > max)) throw new Error("Bileşen düzen ölçüsü geçersiz.");
      const actionCheck = (a: VisualAction | undefined, depth = 0) => {
        if (a === undefined || a === null) return;
        if (typeof a !== "object" || depth > 8 || !["none","page","next","previous","reset","toggle","url","function","menu"].includes(a.type) || a.items && !Array.isArray(a.items)) throw new Error("Bileşen eylemi geçersiz.");
        for (const item of a.items ?? []) { if (!item || typeof item.label !== "string") throw new Error("Bileşen menüsü geçersiz."); actionCheck(item.action, depth + 1); }
      };
      actionCheck(v.format.action); actionCheck(v.format.rowAction?.action);
      const seen = new Set([v.id]); let current = v;
      while (current.parentId) { const parent = d.visuals.find((p) => p.id === current.parentId); if (!parent || parent.type !== "container" || seen.has(parent.id) || seen.size >= 16) throw new Error("Bileşen ağacı geçersiz."); seen.add(parent.id); current = parent; }
    }
    const paths = new Set<string>();
    for (const s of d.slots) {
      if (!s || typeof s.id !== "string" || !s.id || s.id.length > 80 || ["__proto__", "constructor", "prototype"].includes(s.id) || typeof s.label !== "string" || !s.label.trim() || s.label.length > 120 || !["field","value","measure","page","visual"].includes(s.kind) || !Array.isArray(s.sites) || !s.sites.length || s.sites.length > 400) throw new Error("Bileşen yuvası geçersiz.");
      if (s.defaultBinding && !same(bindingOf(s.kind, s.defaultBinding), s.defaultBinding)) throw new Error("Bileşen varsayılan eşlemesi geçersiz.");
      for (const site of s.sites) {
        if (!Array.isArray(site.path) || !site.path.every((p) => typeof p === "string") || site.path.length > 20 || !/^(?:(?:group|legend|values|target|filters)\.[0-9]{1,3}|format\.(?:rowAction\.)?action(?:\.items\.[0-9]{1,3}\.action)*)$/.test(site.path.join(".")) || !at(d.visuals.find((v) => v.id === site.visualId), site.path)) throw new Error("Bileşen hedef yolu geçersiz.");
        const target = at(d.visuals.find((v) => v.id === site.visualId), site.path) as VisualAction;
        const expected = ["group","legend","filters"].includes(site.path[0]) ? "field" : ["values","target"].includes(site.path[0]) ? "value" : target.type === "page" ? "page" : target.type === "toggle" ? "visual" : target.type === "function" && target.functionName === "measure" ? "measure" : null;
        if (s.kind !== expected) throw new Error("Bileşen yuvası hedef türüyle uyuşmuyor.");
        const key = `${site.visualId}:${site.path.join(".")}`; if (paths.has(key)) throw new Error("Bileşen yuvası yineleniyor."); paths.add(key);
      }
    }
    if (new Set(d.slots.map((s) => s.id)).size !== d.slots.length) throw new Error("Bileşen yuvası yineleniyor.");
  }
  return mergeDefinitions([], data.components);
}
