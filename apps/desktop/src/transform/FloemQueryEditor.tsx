import type { StepType, TransformPreview, TransformStep } from "@floem/client";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "../components/ErrorBox";
import { useDocument } from "../document";
import { StepDialog, type DialogKind } from "./StepDialog";
import { STEP_LABEL, TYPE_LABEL, describeStep, freeName, typeBadge } from "./steps";
import "./pq.css";

const nf = new Intl.NumberFormat("tr-TR");

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className="null">null</span>;
  if (typeof v === "number") return <span className="num">{nf.format(v)}</span>;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

interface Menu {
  x: number;
  y: number;
  column: string;
}

/**
 * Floem Query düzenleyicisi (Power Query karşılığı, "Verileri dönüştür"): içe aktarılan tablolara Uygulanan adımlar
 * ekler. Adımlar "Kapat ve uygula"ya kadar yalnızca bu pencerede tutulur; önizleme her
 * değişiklikte yerel serviste (DuckDB) hesaplanır. Yenilemede adımlar ham veriye yeniden uygulanır.
 */
export function FloemQueryEditor({ initialTable, onClose }: { initialTable?: string; onClose: () => void }) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const tables = useMemo(() => (doc?.model.tablolar ?? []).filter((t) => t.sorgu), [doc]);
  const original = useMemo(
    () => Object.fromEntries(tables.map((t) => [t.ad, t.sorgu?.adimlar ?? []])) as Record<string, TransformStep[]>,
    // yalnızca açılıştaki durum: "Kapat ve uygula" bununla karşılaştırır
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [steps, setSteps] = useState<Record<string, TransformStep[]>>(original);
  const [current, setCurrent] = useState(
    initialTable && tables.some((t) => t.ad === initialTable) ? initialTable : tables[0]?.ad ?? "",
  );
  const [position, setPosition] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<TransformPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [applying, setApplying] = useState(false);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  // önizleme ortadaki bir adımdaysa: zincirin tamamı hâlâ çalışıyor mu (sonraki adımlar bozuldu mu)
  const [chainError, setChainError] = useState<TransformPreview["error"]>(null);
  const request = useRef(0);

  const list = steps[current] ?? [];
  const pos = Math.min(position[current] ?? list.length, list.length);    // önizlemede uygulanan adım sayısı
  const changed = tables.filter((t) => JSON.stringify(steps[t.ad] ?? []) !== JSON.stringify(original[t.ad] ?? []));
  const columns = preview?.columns ?? [];
  const names = columns.map((c) => c.name);

  useEffect(() => {
    if (!current) return;
    const id = ++request.current;
    setLoading(true);
    client
      .transformPreview(current, list, pos)
      .then((p) => {
        if (id !== request.current) return;
        setPreview(p);
        setError(null);
        setSelected((sel) => sel.filter((s) => p.columns.some((c) => c.name === s)));
      })
      .catch((e) => id === request.current && setError(toUiError(e)))
      .finally(() => id === request.current && setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, current, JSON.stringify(list), pos]);

  useEffect(() => {
    if (!current || pos >= list.length) {
      setChainError(null);
      return;
    }
    let live = true;
    client
      .transformPreview(current, list, null, 1)
      .then((p) => live && setChainError(p.error))
      .catch(() => live && setChainError(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, current, JSON.stringify(list), pos]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  function addStep(step: TransformStep) {
    const next = [...list.slice(0, pos), step, ...list.slice(pos)];
    setSteps({ ...steps, [current]: next });
    setPosition({ ...position, [current]: pos + 1 });
    setDialog(null);
    setMenu(null);
  }

  function removeStep(i: number) {
    const next = list.filter((_, j) => j !== i);
    setSteps({ ...steps, [current]: next });
    setPosition({ ...position, [current]: Math.min(pos > i ? pos - 1 : pos, next.length) });
  }

  function selectColumn(name: string, e: MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));
    } else if (e.shiftKey && selected.length) {
      const a = names.indexOf(selected[selected.length - 1]);
      const b = names.indexOf(name);
      setSelected(names.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      setSelected([name]);
    }
  }

  const sel = selected.length ? selected : [];
  const one = sel[0];
  const need = (n = 1) => sel.length >= n;

  const actions = {
    remove: () => need() && addStep({ tur: "sutun_kaldir", sutunlar: sel }),
    keep: () => need() && addStep({ tur: "sutun_sec", sutunlar: sel }),
    dedupe: () => addStep({ tur: "yinelenenleri_kaldir", sutunlar: sel }),
    type: (tip: StepType) => one && addStep({ tur: "tip_degistir", sutun: one, tip }),
    text: (islem: "kirp" | "buyuk" | "kucuk") => one && addStep({ tur: "metin", sutun: one, islem }),
    unpivot: () =>
      need() && addStep({ tur: "ters_ozet", sutunlar: sel, nitelik_adi: freeName("Nitelik", names), deger_adi: freeName("Değer", names) }),
    unpivotOthers: () => {
      const rest = names.filter((n) => !sel.includes(n));
      if (need() && rest.length)
        addStep({ tur: "ters_ozet", sutunlar: rest, nitelik_adi: freeName("Nitelik", names), deger_adi: freeName("Değer", names) });
    },
  };

  async function applyAll() {
    setApplying(true);
    setError(null);
    const all: string[] = [];
    try {
      // birleştirme/ekleme ile başka tabloya başvuran tablolar sona
      const refs = (t: string) =>
        (steps[t] ?? []).some((s) => s.tur === "sorgu_birlestir" || s.tur === "sorgu_ekle");
      const order = [...changed].sort((a, b) => Number(refs(a.ad)) - Number(refs(b.ad)));
      let last = null;
      for (const t of order) {
        const r = await client.applySteps(t.ad, steps[t.ad] ?? []);
        all.push(...r.warnings);
        last = r.document;
      }
      if (last) setDoc(last);
      if (all.length) setWarnings(all);
      else onClose();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setApplying(false);
    }
  }

  function cancel() {
    if (changed.length && !window.confirm("Uygulanmamış değişiklikler silinsin mi?")) return;
    onClose();
  }

  const stepError = preview?.error ?? null;
  const typeOf = (c: string) => columns.find((x) => x.name === c)?.type ?? "";

  const ribbonButton = (label: string, ico: string, onClick: () => void, disabled = false, title?: string) => (
    <button className="ribbon-btn" onClick={onClick} disabled={disabled || !current} title={title ?? label}>
      <span className="ribbon-ico">{ico}</span>
      {label}
    </button>
  );

  return (
    <div className="pq" role="dialog" aria-label="Floem Query düzenleyicisi" onKeyDown={(e) => e.key === "Escape" && !dialog && cancel()}>
      <header className="pq-title">
        <strong>Verileri dönüştür</strong>
        <span className="muted">Floem Query düzenleyicisi</span>
        <span className="pq-title-actions">
          <button onClick={cancel} disabled={applying}>
            İptal
          </button>
          <button className="primary" onClick={() => void applyAll()} disabled={applying || !changed.length}>
            {applying ? "Uygulanıyor…" : "Kapat ve uygula"}
          </button>
        </span>
      </header>

      <nav className="ribbon pq-ribbon" aria-label="Dönüştür">
        <div className="ribbon-group">
          {ribbonButton("Sütunları kaldır", "✕", actions.remove, !need(), "Seçili sütunları kaldır")}
          {ribbonButton("Diğerlerini kaldır", "▣", actions.keep, !need(), "Seçili sütunlar dışındakileri kaldır")}
          {ribbonButton("Yeniden adlandır", "✎", () => setDialog("rename"), !one)}
          <span className="ribbon-label">Sütunları yönet</span>
        </div>
        <div className="ribbon-group">
          {ribbonButton("Filtrele", "⏷", () => setDialog("filter"), !names.length)}
          {ribbonButton("Yinelenenleri kaldır", "⧉", actions.dedupe, !names.length, sel.length ? "Seçili sütunlara göre" : "Tüm sütunlara göre")}
          <span className="ribbon-label">Satırları azalt</span>
        </div>
        <div className="ribbon-group">
          <label className="ribbon-select">
            Veri türü
            <select value="" disabled={!one} onChange={(e) => e.target.value && actions.type(e.target.value as StepType)}>
              <option value="">{one ? TYPE_LABEL[(typeOf(one) === "int32" ? "int64" : typeOf(one)) as StepType] ?? "—" : "—"}</option>
              {(Object.keys(TYPE_LABEL) as StepType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="ribbon-select">
            Biçim
            <select value="" disabled={!one} onChange={(e) => e.target.value && actions.text(e.target.value as "kirp")}>
              <option value="">Metin…</option>
              <option value="kirp">Kırp</option>
              <option value="buyuk">BÜYÜK HARF</option>
              <option value="kucuk">küçük harf</option>
            </select>
          </label>
          {ribbonButton("Değerleri değiştir", "⇄", () => setDialog("replace"), !one)}
          {ribbonButton("Sütunu böl", "⫼", () => setDialog("split"), !one)}
          {ribbonButton("Birleştir", "⊕", () => setDialog("merge_columns"), !need(2), "Seçili sütunları tek sütunda birleştir")}
          {ribbonButton("Grupla", "Σ", () => setDialog("group"), !names.length)}
          {ribbonButton("Ters özet", "⤓", actions.unpivot, !need(), "Seçili sütunları satırlara çevir (unpivot)")}
          <span className="ribbon-label">Dönüştür</span>
        </div>
        <div className="ribbon-group">
          {ribbonButton("Özel sütun", "ƒ", () => setDialog("custom"), !names.length)}
          <span className="ribbon-label">Sütun ekle</span>
        </div>
        <div className="ribbon-group">
          {ribbonButton("Sorguları birleştir", "⋈", () => setDialog("merge_queries"), tables.length < 2)}
          {ribbonButton("Sorgu ekle", "⊞", () => setDialog("append"), tables.length < 2)}
          <span className="ribbon-label">Birleştir</span>
        </div>
      </nav>

      <div className="pq-body">
        <aside className="pq-queries">
          <div className="pq-pane-title">Sorgular [{tables.length}]</div>
          {tables.map((t) => (
            <button
              key={t.ad}
              className={`pq-query ${t.ad === current ? "active" : ""}`}
              onClick={() => {
                setCurrent(t.ad);
                setSelected([]);
              }}
            >
              <span className="ico-table" /> {t.ad}
              {changed.includes(t) && <span className="pq-changed" title="Uygulanmamış değişiklik">●</span>}
            </button>
          ))}
          {tables.length === 0 && <p className="hint pad">Dönüştürülecek tablo yok. Önce "Veri al" ile tablo yükleyin.</p>}
        </aside>

        <section className="pq-center">
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
          {stepError && (
            <div className="pq-step-error">
              <strong>⚠ {stepError.message}</strong>
              {stepError.detail && <span className="muted"> — {stepError.detail}</span>}
              <div className="small muted">Önizleme, hatalı adımdan önceki son geçerli sonucu gösteriyor. Adımı silin ya da öncesine dönüp düzeltin.</div>
            </div>
          )}
          <div className={`grid-wrap ${loading ? "pq-loading" : ""}`}>
            {preview && (
              <table className="grid pq-grid">
                <thead>
                  <tr>
                    <th className="rownum" />
                    {columns.map((c) => (
                      <th
                        key={c.name}
                        className={selected.includes(c.name) ? "pq-sel" : ""}
                        onClick={(e) => selectColumn(c.name, e)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!selected.includes(c.name)) setSelected([c.name]);
                          setMenu({ x: e.clientX, y: e.clientY, column: c.name });
                        }}
                        onDoubleClick={() => {
                          setSelected([c.name]);
                          setDialog("rename");
                        }}
                        title="Tıkla: seç · Ctrl: çoklu seçim · Sağ tık: menü · Çift tık: yeniden adlandır"
                      >
                        <span className="pq-type" title={c.type}>
                          {typeBadge(c.type)}
                        </span>
                        {c.name}
                        <button
                          className="pq-head-menu"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!selected.includes(c.name)) setSelected([c.name]);
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenu({ x: r.left, y: r.bottom, column: c.name });
                          }}
                          aria-label={`${c.name} menüsü`}
                        >
                          ▾
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, r) => (
                    <tr key={r}>
                      <td className="rownum">{r + 1}</td>
                      {row.map((v, i) => (
                        <td key={i} className={selected.includes(names[i]) ? "pq-sel" : ""}>
                          {cell(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <footer className="pq-status">
            {preview && (
              <>
                {columns.length} sütun · {nf.format(preview.rows.length)} satır
                {preview.truncated ? " (önizleme: ilk 1000 satır)" : ""}
                {sel.length > 0 && <> · seçili: {sel.join(", ")}</>}
              </>
            )}
            {loading && <span className="muted"> · hesaplanıyor…</span>}
          </footer>
        </section>

        <aside className="pq-steps">
          <div className="pq-pane-title">Uygulanan adımlar</div>
          <ol>
            <li className={pos === 0 ? "active" : ""} onClick={() => setPosition({ ...position, [current]: 0 })}>
              <span className="pq-step-name">Kaynak</span>
            </li>
            {list.map((s, i) => {
              const bad = stepError?.step === i || chainError?.step === i;
              const after = i >= pos;
              return (
                <li
                  key={i}
                  className={`${pos === i + 1 ? "active" : ""} ${bad ? "bad" : ""} ${after ? "after" : ""}`}
                  onClick={() => setPosition({ ...position, [current]: i + 1 })}
                  title={describeStep(s)}
                >
                  <span className="pq-step-name">
                    {bad && "⚠ "}
                    {STEP_LABEL[s.tur]}
                  </span>
                  <span className="pq-step-desc">{describeStep(s)}</span>
                  <button
                    className="link pq-step-del"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeStep(i);
                    }}
                    aria-label="Adımı sil"
                    title="Adımı sil"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
          {chainError && pos < list.length && (
            <p className="hint warn small pq-chain-warn">
              ⚠ {chainError.message}
            </p>
          )}
          {pos < list.length && !chainError && (
            <p className="hint small pad">
              Yeni adımlar seçili adımın arkasına eklenir. Sonraki adımlar etkilenebilir.
            </p>
          )}
        </aside>
      </div>

      {menu && (
        <div className="pq-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={actions.remove}>Kaldır</button>
          <button onClick={actions.keep}>Diğer sütunları kaldır</button>
          <button onClick={() => (setMenu(null), setDialog("rename"))} disabled={sel.length !== 1}>
            Yeniden adlandır…
          </button>
          <hr />
          <button onClick={() => (setMenu(null), setDialog("filter"))}>Filtrele…</button>
          <button onClick={actions.dedupe}>Yinelenenleri kaldır</button>
          <hr />
          <div className="pq-menu-sub">
            <span>Türü değiştir</span>
            <div>
              {(Object.keys(TYPE_LABEL) as StepType[]).map((t) => (
                <button key={t} onClick={() => actions.type(t)} disabled={sel.length !== 1}>
                  {TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="pq-menu-sub">
            <span>Dönüştür</span>
            <div>
              <button onClick={() => actions.text("kirp")}>Kırp</button>
              <button onClick={() => actions.text("buyuk")}>BÜYÜK HARF</button>
              <button onClick={() => actions.text("kucuk")}>küçük harf</button>
            </div>
          </div>
          <button onClick={() => (setMenu(null), setDialog("replace"))} disabled={sel.length !== 1}>
            Değerleri değiştir…
          </button>
          <button onClick={() => (setMenu(null), setDialog("split"))} disabled={sel.length !== 1}>
            Sütunu böl…
          </button>
          <button onClick={() => (setMenu(null), setDialog("merge_columns"))} disabled={sel.length < 2}>
            Sütunları birleştir…
          </button>
          <button onClick={() => (setMenu(null), setDialog("group"))}>Grupla…</button>
          <hr />
          <button onClick={actions.unpivot}>Ters özet</button>
          <button onClick={actions.unpivotOthers}>Diğer sütunları ters özetle</button>
        </div>
      )}

      {dialog && preview && (
        <StepDialog
          kind={dialog}
          columns={columns}
          rows={preview.rows}
          selected={sel}
          table={current}
          tables={doc?.model.tablolar ?? []}
          onAdd={addStep}
          onClose={() => setDialog(null)}
        />
      )}

      {warnings && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Uygulandı">
            <header className="modal-head">
              <h2>Değişiklikler uygulandı</h2>
            </header>
            <div className="modal-body">
              <ul className="warnings">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
            <footer className="modal-foot">
              <button className="primary" onClick={onClose}>
                Tamam
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
