import { useEffect, useState, type RefObject } from "react";
import type { DesignMeasurement } from "./designAudit";

/** Veri hücrelerinin doğal kaydırmasını değil, tasarım metnini ölçer. */
export function measureDesign(root: HTMLElement): DesignMeasurement[] {
  const result = new Map<string, DesignMeasurement>();
  for (const element of root.querySelectorAll<HTMLElement>(".v-text,.v-card-value,.v-ticker-value,.v-card-label,.visual-title,.v-action-button > span,.v-template-label")) {
    const owner = element.closest<HTMLElement>("[data-visual-id]");
    if (!owner || !element.getClientRects().length || element.closest('[hidden],[data-rule-hidden="true"],.v-runtime-state,.v-text-empty,.v-template')) continue;
    if (element.closest(".visual-head") && owner.matches(".no-title,.shape-frame")) continue;
    if ([owner, element].some((node) => getComputedStyle(node).opacity === "0")) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const id = owner.dataset.visualId!, record = result.get(id) ?? { visualId: id, overflow: false };
    // Tuval her üst nesneyi CSS scale ile çizer; sayfa kutusunun kendisi ölçekli değildir.
    const zoom = owner.getBoundingClientRect().width / owner.offsetWidth || 1;
    // Kaydırma ölçüleri CSS pikselidir; DPR ve tuval yakınlaştırması etkilemez.
    const nodes = [element, ...element.querySelectorAll<HTMLElement>("span,p,div")];
    record.overflow ||= nodes.some((n) => n.clientWidth > 0 && n.clientHeight > 0 && (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1));
    for (const node of nodes) {
      if (!node.textContent?.trim() || !node.offsetWidth || !node.getClientRects().length) continue;
      const size = parseFloat(getComputedStyle(node).fontSize) * node.getBoundingClientRect().width / node.offsetWidth / zoom;
      if (Number.isFinite(size) && size > 0) record.minFont = Math.min(record.minFont ?? Infinity, Math.round(size * 10) / 10);
    }
    result.set(id, record);
  }
  return [...result.values()];
}

export function useDesignMeasurements(root: RefObject<HTMLDivElement | null>, scope: string) {
  const [snapshot, setSnapshot] = useState<{ scope: string; items: DesignMeasurement[] }>({ scope, items: [] });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>, disposed = false;
    const measure = () => {
      if (disposed) return;
      const items = measureDesign(element);
      setSnapshot((before) => before.scope === scope && JSON.stringify(before.items) === JSON.stringify(items) ? before : { scope, items });
    };
    const schedule = () => { if (!disposed) { clearTimeout(timer); timer = setTimeout(measure, 120); } };
    const resize = new ResizeObserver(schedule);
    const observe = () => { resize.disconnect(); resize.observe(element); element.querySelectorAll("[data-visual-id]").forEach((v) => resize.observe(v)); };
    const mutation = new MutationObserver((entries) => { if (entries.some((e) => e.type === "childList")) observe(); schedule(); });
    mutation.observe(element, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden", "data-design-state", "data-rule-hidden"] });
    observe(); schedule(); void document.fonts.ready.then(schedule);
    return () => { disposed = true; clearTimeout(timer); resize.disconnect(); mutation.disconnect(); };
  }, [root, scope]);
  return snapshot.scope === scope ? snapshot.items : [];
}
