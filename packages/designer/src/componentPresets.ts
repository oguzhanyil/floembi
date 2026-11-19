import type { ComponentDefinition, Visual } from "@floem/client";
import { discoverSlots } from "./components";

const v = (id: string, type: Visual["type"], x: number, y: number, w: number, h: number, more: Partial<Visual> = {}): Visual => ({ id, type, x, y, w, h, group: [], values: [], filters: [], format: { showTitle: false }, ...more });
const kpi: Visual[] = [
  v("root", "container", 0, 0, 340, 220, { title: "Karşılaştırmalı KPI", container: { mode: "vertical", padding: 20, gap: 12, autoHeight: true }, format: { showTitle: false, padding: 0, shadow: true, radius: 12 } }),
  v("heading", "text", 20, 20, 300, 32, { parentId: "root", format: { showTitle: false, text: "Performans özeti", fontSize: 20, padding: 0, backgroundColor: "transparent", borderWidth: 0 } }),
  v("metric", "kpi", 20, 64, 300, 120, { parentId: "root", values: [{ measure: "Ölçü" }], target: [{ measure: "Hedef" }], format: { showTitle: false, padding: 0, borderWidth: 0 } }),
];
const menu: Visual[] = [
  v("root", "container", 0, 0, 320, 220, { title: "Gezinme ve filtre", container: { mode: "vertical", padding: 20, gap: 12, autoHeight: true }, format: { showTitle: false, padding: 0, radius: 12, shadow: true } }),
  v("heading", "text", 20, 20, 280, 32, { parentId: "root", format: { showTitle: false, text: "Hızlı işlemler", fontSize: 20, padding: 0, borderWidth: 0 } }),
  v("go", "button", 20, 64, 280, 48, { parentId: "root", format: { showTitle: false, text: "Detay raporunu aç", padding: 0, action: { type: "page", pageId: "Hedef sayfa" }, buttonStyle: "solid" } }),
  v("reset", "button", 20, 124, 280, 48, { parentId: "root", format: { showTitle: false, text: "Filtreleri temizle", padding: 0, buttonIcon: "refresh", buttonStyle: "outline", action: { type: "reset" } } }),
];
const step: Visual[] = [
  v("root", "container", 0, 0, 340, 200, { title: "Süreç adımı", container: { mode: "vertical", padding: 20, gap: 10, autoHeight: true }, format: { showTitle: false, padding: 0, radius: 12 } }),
  v("status", "text", 20, 20, 300, 28, { parentId: "root", format: { showTitle: false, text: "01 / SÜREÇ ADIMI", fontSize: 12, padding: 0, borderWidth: 0 } }),
  v("heading", "text", 20, 58, 300, 34, { parentId: "root", format: { showTitle: false, text: "Siparişten teslimata", fontSize: 22, padding: 0, borderWidth: 0 } }),
  v("description", "text", 20, 102, 300, 66, { parentId: "root", format: { showTitle: false, text: "Durumu ve sorumlu ekibi kendi sürecinize göre düzenleyin.", textOverflow: "grow", fontSize: 14, padding: 0, borderWidth: 0 } }),
];
export const COMPONENT_PRESETS: ComponentDefinition[] = [
  { id: "floem.kpi", name: "Karşılaştırmalı KPI", description: "Güncel değer ve hedef ölçüsünü eşleyin; renk ve yazıları kendi tasarımınıza göre düzenleyin.", version: 1, rootId: "root", visuals: kpi, slots: discoverSlots(kpi) },
  { id: "floem.navigation", name: "Gezinme ve filtre", description: "Sayfa geçişi ve filtre sıfırlama düğmelerini birlikte kullanın.", version: 1, rootId: "root", visuals: menu, slots: discoverSlots(menu) },
  { id: "floem.process", name: "Süreç adımı", description: "Operasyon, kalite ve onay akışları için metinlerini ve biçimini düzenleyebileceğiniz süreç kartı.", version: 1, rootId: "root", visuals: step, slots: [] },
];
