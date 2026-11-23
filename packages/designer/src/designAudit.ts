import type { FieldRef, ModelTable, ReportDefinition, ValueRef, Visual, VisualAction } from "@floem/client";
import { ancestors, containerOptions, resolvePageLayout, visibleInLayout } from "../../report/src/layout";
import { resolvePageVariant } from "../../report/src/pageLayouts";
import { rowTemplate, sameValueRef } from "../../report/src/dataBindings";
import { buildQuery, MATRIX_ROW_LIMIT } from "../../report/src/useVisualData";
import { VISUAL_DEFS } from "../../report/src/reportUtils";
import { actionUrl } from "../../report/src/visualActions";
import type { ResolvedLayout } from "../../report/src/layout";
import type { VisualDiagnostic } from "../../report/src/diagnostics";

export type AuditSeverity = "error" | "warning" | "info";
export type AuditCategory = "Yerleşim" | "Okunabilirlik" | "Veri bağı" | "Anlam" | "Etkileşim" | "Veri kapsamı";
export interface AuditTarget { pageId: string; layoutId: string | null; visualId: string }
export interface DesignFinding extends AuditTarget {
  id: string; code: string; severity: AuditSeverity; category: AuditCategory;
  pageName: string; layoutName: string; visualName: string;
  message: string; evidence: string; suggestion: string;
  basis: "Tanım" | "Ölçüm" | "Çalışma zamanı";
}
export interface DesignMeasurement { visualId: string; overflow: boolean; minFont?: number }
export interface AuditRuntime extends Omit<AuditTarget, "visualId"> {
  measurements: DesignMeasurement[]; queries: VisualDiagnostic[];
  resolved?: ResolvedLayout;
}
const number = (n: number) => Math.round(n * 10) / 10;
const refName = (v: FieldRef | ValueRef) => "measure" in v ? v.measure : `${v.table}[${v.column}]`;

/** Biçimden çıkarım; alan adına bakarak para/adet tahmini yapılmaz. */
export function formatUnit(format?: string | null): string | undefined {
  if (!format) return undefined;
  const units = [/%/.test(format) && "%", /₺|\bTRY\b|\bTL\b/i.test(format) && "TRY",
    /€|\bEUR\b/i.test(format) && "EUR", /\$|\bUSD\b/i.test(format) && "USD"].filter(Boolean) as string[];
  return units.length === 1 ? units[0] : undefined;
}

/** Saf, salt okunur inceleme. Rapor, model veya sorgu sonucu değiştirilmez. */
export function auditDesign(report: ReportDefinition, tables: ModelTable[], runtime?: AuditRuntime): DesignFinding[] {
  const findings = new Map<string, DesignFinding>();
  // Semantik motorla aynı büyük/küçük harf duyarsızlığı.
  const columns = new Map(tables.map((t) => [t.ad.toLowerCase(), new Map(t.sutunlar.map((c) => [c.ad.toLowerCase(), c]))]));
  const measures = new Map(tables.flatMap((t) => t.olculer.map((m) => [m.ad.toLowerCase(), m] as const)));
  const column = (r: FieldRef) => columns.get(r.table.toLowerCase())?.get(r.column.toLowerCase());
  const measure = (name: string) => measures.get(name.toLowerCase());
  const exists = (r: FieldRef | ValueRef) => "measure" in r ? !!measure(r.measure) : !!column(r);
  const unit = (r: ValueRef) => "measure" in r ? formatUnit(measure(r.measure)?.bicim)
    : ["count", "distinctcount"].includes(r.agg) ? undefined : formatUnit(column(r)?.bicim);
  for (const base of report.pages) for (const variant of [null, ...(base.layouts ?? []).map((v) => v.id)]) {
    const page = resolvePageVariant(base, variant), resolved = runtime?.pageId === base.id && runtime.layoutId === variant && runtime.resolved || resolvePageLayout(page);
    const layoutName = base.layouts?.find((l) => l.id === variant)?.name ?? "Ana düzen";
    for (const visual of page.visuals) {
      const target = { pageId: page.id, layoutId: variant, visualId: visual.id };
      const add = (code: string, severity: AuditSeverity, category: AuditCategory, message: string, evidence: string, suggestion: string,
        detail = "", basis: DesignFinding["basis"] = "Tanım") => {
        const id = JSON.stringify([page.id, variant, visual.id, code, detail]);
        findings.set(id, { ...target, id, code, severity, category, pageName: page.name, layoutName,
          visualName: visual.title || `${visual.type} · ${visual.id}`, message, evidence, suggestion, basis });
      };
      const rect = resolved.visuals.find((v) => v.id === visual.id)!;
      if (visibleInLayout(page, visual)) {
        if (rect.x < -1 || rect.y < -1 || rect.x + rect.w > page.width + 1 || rect.y + rect.h > resolved.height + 1)
          add("OUTSIDE_PAGE", "warning", "Yerleşim", "Nesne sayfa sınırını aşıyor.",
            `Konum ${number(rect.x)}, ${number(rect.y)}; boyut ${number(rect.w)} × ${number(rect.h)}; sayfa ${page.width} × ${number(resolved.height)}.`,
            "Nesneyi veya sayfa boyutunu ilgili düzen için ayarlayın. Üst üste gelen nesneler tek başına sorun sayılmaz.");
        if (resolved.overflow.has(visual.id) && containerOptions(visual).mode !== "free") add("CONTAINER_OVERFLOW", "warning", "Yerleşim", "Akıştaki öğeler kapsayıcıya sığmıyor.",
          "Yerleşim motoru minimum boyutlar ve boşluklarla taşma hesapladı.", "Kapsayıcıyı genişletin; sarma, boşluk veya minimum boyutları gözden geçirin.");
        const clipping = ancestors(page, visual.id).filter((v) => containerOptions(v).overflow === "clip").some((p) => {
          const r = resolved.visuals.find((v) => v.id === p.id)!;
          return rect.x < r.x - 1 || rect.y < r.y - 1 || rect.x + rect.w > r.x + r.w + 1 || rect.y + rect.h > r.y + r.h + 1;
        });
        if (clipping) add("PARENT_CLIPS", "warning", "Yerleşim", "Üst kapsayıcı bu nesneyi kırpıyor.", "Kırpma açık ve nesne üst kapsayıcının sınırını aşıyor.", "Kırpma bilinçli değilse konumu, boyutu veya kapsayıcının taşma ayarını değiştirin.");
        const sizes = [visual.format.fontSize, ...(visual.title && visual.format.showTitle !== false ? [visual.format.titleSize] : [])].filter((n): n is number => typeof n === "number" && n > 0);
        if (sizes.some((n) => n < 12)) add("SMALL_FONT", "warning", "Okunabilirlik", "Kayıtlı yazı boyutu küçük.",
          `En küçük açık yazı ayarı ${Math.min(...sizes)} px. Tuval yakınlaştırması bu değere dahil değil.`, "12 px ve üstünü deneyin; telefon düzenini ve gerçek cihazdaki görünümü ayrıca kontrol edin.");
      }
      const checkRef = (r: FieldRef | ValueRef, path: string) => {
        if (!exists(r)) add("MISSING_FIELD", "error", "Veri bağı", "Modelde bulunmayan alan veya ölçü kullanılıyor.", `${path}: ${refName(r)}`, "Alan eşlemesini güncel modelden yeniden seçin.", `${path}:${refName(r)}`);
      };
      const checkAction = (a: VisualAction | undefined, path: string, depth = 0, localIds?: Set<string>) => {
        if (!a || depth > 8) return;
        if (a.type === "page" && !report.pages.some((p) => p.id === a.pageId))
          add("ACTION_PAGE", "error", "Etkileşim", "Eylemin hedef sayfası bulunamadı.", `${path}: hedef sayfa raporda yok.`, "Eylem için mevcut bir sayfa seçin.", path);
        if (a.type === "toggle" && !localIds?.has(a.visualId ?? "") && !page.visuals.some((v) => v.id === a.visualId))
          add("ACTION_VISUAL", "error", "Etkileşim", "Göster/gizle hedefi bulunamadı.", `${path}: hedef nesne bu sayfada yok.`, "Aynı sayfadaki bir nesneyi hedef olarak seçin.", path);
        if (a.type === "function" && a.functionName === "measure" && !measure(a.measure ?? ""))
          add("ACTION_MEASURE", "error", "Etkileşim", "Çalıştırılacak FDX ölçüsü bulunamadı.", `${path}: kayıtlı ölçü seçilmemiş veya silinmiş.`, "Modeldeki bir FDX ölçüsünü seçin.", path);
        if (a.type === "url" && !actionUrl(a.url, { value: "örnek" }))
          add("ACTION_URL", "error", "Etkileşim", "Web eylemi geçerli bir HTTP(S) adresi içermiyor.", `${path}: adres içeriği denetim çıktısına eklenmez.`, "HTTP veya HTTPS ile başlayan bir web adresi girin; satır değeri için {value} kullanabilirsiniz.", path);
        if (a.type === "menu") a.items?.forEach((item, i) => checkAction(item.action, `${path} / menü ${i + 1}`, depth + 1, localIds));
      };
      const checkNode = (v: Visual, path: string, inRow = false, localIds?: Set<string>) => {
        [...v.group, ...(v.legend ?? []), ...v.values, ...(v.target ?? []), ...v.filters].forEach((r, i) => checkRef(r, `${path} / alan ${i + 1}`));
        for (const [key, binding] of Object.entries(v.bindings ?? {})) if (binding) {
          const source = binding.source, r = source.value ?? source.field;
          if (r) checkRef(r, `${path} / ${key} bağı`);
          if (source.kind === "row") {
            if (!inRow) add("ROW_CONTEXT", "warning", "Veri bağı", "Satır bağı tekrarlayıcı dışında kullanılıyor.", `${path} / ${key}`, "Bu nesneyi satır şablonunda kullanın veya alan/ölçü kaynağı seçin.", `${path}:${key}`);
            else if (!r || (source.field ? !visual.group.some((g) => g.table === source.field!.table && g.column === source.field!.column)
              : !visual.values.some((value) => sameValueRef(value, source.value!))))
              add("ROW_MAPPING", "error", "Veri bağı", "Şablonun satır kaynağı tekrarlayıcı sorgusunda yok.", `${path} / ${key}`, "Gerekli alanı tekrarlayıcının satır veya değer bölmesine ekleyin.", `${path}:${key}`);
          }
        }
        checkAction(v.format.action, `${path} / tıklama`, 0, localIds);
        checkAction(v.format.rowAction?.action, `${path} / satır eylemi`, 0, localIds);
      };
      checkNode(visual, "Nesne");
      const sourceIndex = visual.type === "repeater" ? visual.repeater?.actionSourceIndex : visual.format.rowAction?.sourceIndex;
      if (sourceIndex != null && (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= visual.group.length + visual.values.length))
        add("ACTION_SOURCE", "error", "Etkileşim", "Satır eyleminin kaynak sütunu bulunamadı.", "Kaynak sütun sırası mevcut satır/değer alanlarının dışında.", "Satır eylemi için mevcut bir kaynak sütun seçin.");
      (page.drillthrough ?? []).forEach((r) => checkRef(r, "Sayfa detay filtresi"));
      const needsGroup = !!VISUAL_DEFS[visual.type].category || ["pie", "donut", "treemap", "waterfall", "scatter", "heatmap", "slicer", "treegrid", "repeater", "lineage"].includes(visual.type);
      if (visual.type === "signal") {
        const metric = report.analytics?.metrics.find((m) => m.id === visual.format.metricId);
        if (!metric) add("ANALYTICS_METRIC", "error", "Veri bağı", "Nesnenin katalog ölçüsü bulunamadı.", "Ölçü ve uyarı nesnesi kataloğa bağlanmamış veya ölçü kaldırılmış.", "Analytics ve uyarılar bölümünden kayıtlı bir ölçü seçin.");
        else {
          checkRef({ measure: metric.measure }, "Katalog FDX ölçüsü"); checkRef(metric.company, "Katalog firma alanı");
          metric.filters?.forEach((f) => checkRef(f, "Katalog sabit filtresi"));
          if (!report.analytics?.dataTime) add("ANALYTICS_DATA_TIME", "info", "Veri kapsamı", "Kaynak veri zamanı bildirilmemiş.", "Değerlendirme zamanı kaynak veri zamanı olarak kullanılamaz.", "Kaynağın veri zamanını biliyorsanız Analytics ve uyarılar bölümünde belirtin; bilinmiyorsa karşılaştırma doğrulanmamış kalır.");
        }
      }
      const needsValues = !["container", "text", "shape", "image", "button", "icon", "slicer", "table", "repeater", "lineage", "signal"].includes(visual.type);
      if (needsGroup && !visual.group.length || needsValues && visual.values.length < (visual.type === "scatter" ? 2 : 1) && !(["card", "ticker"].includes(visual.type) && visual.bindings?.value)
        || visual.type === "heatmap" && !visual.legend?.length || visual.type === "table" && !visual.group.length && !visual.values.length
        || visual.type === "lineage" && (visual.group.length < 2 || !visual.legend?.length) || visual.type === "tolerance" && visual.values.length < 3)
        add("EMPTY_WELL", "warning", "Veri bağı", "Görselin zorunlu veri bölmeleri eksik.", `Görsel türü: ${visual.type}.`, "Satır/eksen ve değer bölmelerini tamamlayın. Kart ve sayaçta değer bağı da kullanılabilir.");
      for (const r of [...visual.values, ...(visual.target ?? [])]) if (!("measure" in r)) {
        const c = column(r);
        if (c && r.agg === "sum" && (c.anahtar || c.ozet === "none" || c.ozet && c.ozet !== "sum"))
          add("AGGREGATION_REVIEW", "warning", "Anlam", "Toplama seçimi model tanımıyla birlikte kontrol edilmeli.",
            `${refName(r)}: SUM; model ${c.anahtar ? "anahtar sütun" : `varsayılan özet: ${c.ozet}`}. Bu bir yanlış hesap kanıtı değildir.`,
            "Anahtar için say/farklı say veya açık bir FDX ölçüsü; diğer sütunlarda iş kuralına uygun toplamayı seçin.", refName(r));
      }
      if (["table", "matrix", "treegrid"].includes(visual.type) && visual.format.showTotals !== false && visual.values.some((r) => "measure" in r
        ? /\b(AVERAGE|AVERAGEX|DISTINCTCOUNT|DIVIDE)\s*\(/i.test(measure(r.measure)?.ifade ?? "") : ["avg", "distinctcount"].includes(r.agg)))
        add("TOTAL_RECOMPUTED", "info", "Anlam", "Toplam satırı, görünen satırların toplamıyla aynı olmak zorunda değil.",
          "Örtük toplama veya FDX metni ortalama, farklı sayım ya da oran kullanımına işaret ediyor. Toplam kendi filtre bağlamında yeniden hesaplanır; bu bilgi tam ifade analizi veya hata kanıtı değildir.",
          "Beklenen iş toplamını ayrıca doğrulayın. Satırların toplanması gerekiyorsa uygun tane düzeyini kullanan açık bir FDX ölçüsü tanımlayın.");
      const compared = ["kpi", "progress", "gauge", "waterfall"].includes(visual.type) || VISUAL_DEFS[visual.type].category ? buildQuery(visual, [])?.values ?? [] : [];
      if (compared.length > 1) {
        const units = compared.map(unit), known = [...new Set(units.filter(Boolean))];
        if (known.length > 1) add("UNIT_MISMATCH", "warning", "Anlam", "Karşılaştırılan değerlerin biçimleri farklı birimler gösteriyor.",
          `Biçimden çıkarım: ${compared.map((r, i) => `${refName(r)} → ${units[i] ?? "belirsiz"}`).join("; ")}.`, "Ortak eksen/hedef için birimleri eşitleyin veya farklı görseller kullanın. Biçim bilgisi iş anlamını tek başına doğrulamaz.");
        else if (units.some((u) => !u)) add("UNIT_UNKNOWN", "info", "Anlam", "Karşılaştırmadaki tüm birimler doğrulanamıyor.", "Model biçimlerinden en az bir birim çıkarılamadı; alan adından tahmin yapılmadı.", "Ölçü biçimlerini ve hedefle aynı birimde hesaplandığını kontrol edin.");
      }
      if (visual.type === "repeater") {
        const config = visual.repeater, def = report.components?.find((d) => d.id === config?.definitionId && d.version === config.version);
        if (!config || !def || def.version !== config.version) add("REPEATER_TEMPLATE", "error", "Veri bağı", "Tekrarlayıcı şablonu yok veya sürümü eşleşmiyor.", "Gömülü bileşen tanımı ve tekrarlayıcı sürümü karşılaştırıldı.", "Kitaplıktan bir satır şablonu seçip eşlemeleri tamamlayın.");
        else {
          try { const nodes = rowTemplate(def, config), ids = new Set(nodes.map((v) => v.id)); nodes.forEach((v) => checkNode(v, `Şablon ${v.id}`, true, ids)); }
          catch { add("REPEATER_MAPPING", "error", "Veri bağı", "Satır şablonu eşlemeleri çalıştırılamıyor.", "Eksik şablon alanı, geçersiz eşleme hedefi veya desteklenmeyen nesne/bağ türü var.", "Satır şablonundaki tüm alanları eşleyin; şablonda satır kaynakları ve desteklenen tasarım nesnelerini kullanın."); }
        }
      }
      const paged = visual.type === "repeater" || ["table", "treegrid"].includes(visual.type) && visual.format.gridDataMode === "server";
      if (visual.type === "lineage") add("SUBGRAPH_SCOPE", "info", "Veri kapsamı", "Parti nesnesi yalnız seçili kökün sınırlı komşuluğunu gösterir.", "Kök parti alanındaki tek seçim başlangıçtır; adım/düğüm/bağlantı sınırı ve firma/dönem kapsamı geçerlidir. Düğüm seçimi yalnız bu nesneyi değiştirir.", "Tüm ağ veya fiziksel miktar dağılımı olarak yorumlamayın. Üretim miktarını tekil parti ölçüsünden okuyun.");
      if (visual.type === "tolerance") add("QUALITY_GRAIN", "info", "Anlam", "Tolerans satırının tek bir ölçümü temsil etmesi gerekir.", "Kabul alt–üst sınırları dahil karşılaştırılır. Ortalama sonuç, tek tek ölçümlerin uygunluğunu kanıtlamaz.", "Gruplamaya ölçüm kimliği ve birimi ekleyin; farklı ölçüm türlerini veya birimleri aynı toplamda birleştirmeyin.");
      if (paged) add("PAGED_SCOPE", "info", "Veri kapsamı", "Nesne sunucudan sayfalar halinde veri alır.",
        "Yüklü satır sayısı sonucun tamamı değildir. Genel toplam rapor filtrelerini kullanır; sonuç içi arama ve sütun filtreleri genel toplamı değiştirmez.",
        "Sonuç sayısı ile genel toplam kapsamını birlikte okuyun. CSV/Excel en fazla 100.000, PDF 2.000 satırdır. Tekrarlayıcı düz veri olarak aktarılır.");
      else {
        const q = buildQuery(visual, []), limit = ["matrix", "treegrid"].includes(visual.type) ? MATRIX_ROW_LIMIT : q?.group.length ? q.limit : undefined;
        if (limit) add("QUERY_LIMIT", "info", "Veri kapsamı", "Görsel sorgusunun sonuç sınırı var.",
          `En fazla ${limit.toLocaleString("tr-TR")} sonuç satırı; bu kaynak kayıt sayısı değildir. Sınıra sahip olmak tek başına kesilme kanıtı değildir.`,
          "Çok kategorili raporlarda filtre/drill kullanın; tablo ve ağaç tabloda sunucu sayfalamasını değerlendirin.");
      }
      if (runtime && runtime.pageId === page.id && runtime.layoutId === variant) {
        const measured = runtime.measurements.filter((m) => m.visualId === visual.id);
        if (measured.some((m) => m.overflow)) add("TEXT_OVERFLOW", visual.format.textOverflow === "scroll" ? "info" : "warning", "Okunabilirlik",
          visual.format.textOverflow === "scroll" ? "Metin kullanıcı seçimiyle kaydırılıyor." : "Görüntülenen metin kendi alanına sığmıyor.",
          "Açık düzende görünür metnin içerik boyutu ayrılan alanı aşıyor; tablo veri kaydırması bu ölçüme dahil değil.",
          "Metin alanını büyütün; satıra sarma, otomatik yükseklik veya kısaltma davranışını gözden geçirin.", "", "Ölçüm");
        const fonts = measured.flatMap((m) => m.minFont != null && m.minFont < 12 ? [m.minFont] : []);
        if (fonts.length && !sizesBelow12(visual)) add("RENDERED_SMALL_FONT", "warning", "Okunabilirlik", "Ekrandaki metin küçük boyuta düşüyor.",
          `Ölçülen en küçük boyut ${number(Math.min(...fonts))} px; tuval yakınlaştırması çıkarıldı. Satır şablonunun kendi ölçeği dahil.`,
          "Nesneyi veya şablon alanını büyütün; otomatik küçülen değerleri ve hedef ekranı kontrol edin.", "", "Ölçüm");
        const samples = runtime.queries.filter((s) => s.visualId === visual.id);
        if (samples.some((s) => s.status === "error")) add("QUERY_ERROR", "error", "Veri bağı", "Açık nesnenin sorgusu veya veri bağı hata döndürdü.", "Mevcut çalışma zamanında hata durumu bildirildi; ham hata ve kayıtlar bu rapora eklenmez.", "Nesnenin hata ayrıntısını açıp alan, FDX ölçüsü ve bağlantıyı kontrol edin; ardından yeniden deneyin.", "", "Çalışma zamanı");
        if (samples.some((s) => s.status === "empty")) add("EMPTY_RESULT", "info", "Veri kapsamı", "Açık nesne veya satır bağı boş sonuç döndürdü.", "Geçerli filtre bağlamında boş sonuç gözlendi; sıfır değer boş sayılmaz.", "Filtreleri, satır kapsamını ve boş durum tasarımını kontrol edin.", "", "Çalışma zamanı");
        const truncated = samples.filter((s) => s.truncated && !s.paged && s.status === "ready");
        if (truncated.length) add("RESULT_TRUNCATED", "warning", "Veri kapsamı", "Görselin sonucu sorgu sınırında kesildi.",
          `Çalışan sorgu kesilme bildirdi. Dönen en fazla satır: ${Math.max(...truncated.map((s) => s.rows ?? 0))}.`, "Filtreleyin veya ayrıntıyı sunucu sayfalı tabloda gösterin; ekrandaki satırları tüm veri olarak yorumlamayın.", "", "Çalışma zamanı");
      }
    }
  }
  return [...findings.values()].sort((a, b) => ({ error: 0, warning: 1, info: 2 }[a.severity] - { error: 0, warning: 1, info: 2 }[b.severity]) || a.id.localeCompare(b.id, "tr"));
}
function sizesBelow12(v: Visual) { return [v.format.fontSize, ...(v.title && v.format.showTitle !== false ? [v.format.titleSize] : [])].some((s) => typeof s === "number" && s > 0 && s < 12); }
