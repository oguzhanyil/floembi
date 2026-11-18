import { parseRef, type ColumnType, type ModelOp, type ModelTable, type Summarize } from "@floem/client";
import { useEffect, useState } from "react";
import { useDocument } from "../document";
import { FORMAT_PRESETS, SUMMARIZE_LABEL, TYPE_LABEL, TYPE_OPTIONS, isDate, isNumeric, nf, type Selection } from "./modelUtils";

/** Enter ya da odak kaybında kaydeden metin kutusu; Esc ile geri alır. */
function CommitInput({
  value, onCommit, multiline, placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
    else setV(value);
  };
  const props = {
    value: v,
    placeholder,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !multiline) (e.target as HTMLElement).blur();
      if (e.key === "Escape") {
        setV(value);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="prop-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/** Power BI model görünümündeki "Özellikler" bölmesi. */
export function PropertiesPane({
  selection, onSelect, onPreview, onEditRelationship, onRefresh, onTransform, onNewMeasure,
}: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPreview: (table: string) => void;
  onEditRelationship: (kimden: string, kime: string) => void;
  onRefresh: (table: string) => void;
  onTransform: (table: string) => void;
  onNewMeasure: (table: string) => void;
}) {
  const { doc, apply } = useDocument();
  if (!doc) return null;
  const model = doc.model;
  const table = (name: string): ModelTable | undefined => model.tablolar.find((t) => t.ad === name);

  const run = async (op: ModelOp, next?: Selection) => {
    if ((await apply([op])) && next !== undefined) onSelect(next);
  };

  // ------------------------------------------------------------ hiçbir şey seçili değil
  if (!selection) {
    return (
      <aside className="prop-pane">
        <h3>Özellikler</h3>
        <Section title="Model">
          <dl className="kv">
            <dt>Tablolar</dt>
            <dd>{model.tablolar.length}</dd>
            <dt>İlişkiler</dt>
            <dd>
              {model.iliskiler.length} ({model.iliskiler.filter((r) => !r.aktif).length} pasif)
            </dd>
          </dl>
        </Section>
        {model.veri_kaynaklari.length > 0 && (
          <Section title="Veri kaynakları">
            {model.veri_kaynaklari.map((k) => (
              <p key={k.id} className="small">
                SQL Server · <strong>{k.sunucu}</strong>
                {k.veritabani && ` / ${k.veritabani}`}
                <br />
                <span className="muted">{k.kimlik === "windows" ? "Windows kimliği" : k.kullanici}</span>
              </p>
            ))}
          </Section>
        )}
        {doc.warnings.length > 0 && (
          <Section title="Uyarılar">
            <ul className="warnings">
              {doc.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Section>
        )}
        <p className="hint pad">Özelliklerini görmek için bir tablo, sütun ya da ilişki seçin.</p>
      </aside>
    );
  }

  // ------------------------------------------------------------ ilişki
  if (selection.kind === "relationship") {
    const r = model.iliskiler.find((x) => x.kimden === selection.kimden && x.kime === selection.kime);
    if (!r) return <aside className="prop-pane" />;
    const base = { op: "update_relationship" as const, kimden: r.kimden, kime: r.kime };
    return (
      <aside className="prop-pane">
        <h3>İlişki</h3>
        <Section title="Uçlar">
          <dl className="kv">
            <dt>Çok tarafı</dt>
            <dd>{r.kimden}</dd>
            <dt>Bir tarafı</dt>
            <dd>{r.kime}</dd>
          </dl>
        </Section>
        <Section title="Ayarlar">
          <label>
            Kardinalite
            <select value={r.kardinalite} onChange={(e) => run({ ...base, kardinalite: e.target.value as "*:1" | "1:1" })}>
              <option value="*:1">Çoka bir (*:1)</option>
              <option value="1:1">Bire bir (1:1)</option>
            </select>
          </label>
          <label>
            Çapraz filtre yönü
            <select value={r.filtre_yonu} onChange={(e) => run({ ...base, filtre_yonu: e.target.value as "tek" | "cift" })}>
              <option value="tek">Tek</option>
              <option value="cift">İki yönlü</option>
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={r.aktif} onChange={(e) => run({ ...base, aktif: e.target.checked })} />
            Etkin
          </label>
        </Section>
        <div className="prop-actions">
          <button onClick={() => onEditRelationship(r.kimden, r.kime)}>Düzenle…</button>
          <button
            className="danger"
            onClick={() =>
              window.confirm("Bu ilişki silinsin mi?") &&
              run({ op: "delete_relationship", kimden: r.kimden, kime: r.kime }, null)
            }
          >
            Sil
          </button>
        </div>
      </aside>
    );
  }

  const t = table(selection.table);
  if (!t) return <aside className="prop-pane" />;

  // ------------------------------------------------------------ tablo
  if (selection.kind === "table") {
    const rows = doc.stats[t.ad]?.rows ?? null;
    const dateCols = t.sutunlar.filter((c) => isDate(c.tip));
    const src = t.sorgu;
    const kaynak = src ? model.veri_kaynaklari.find((k) => k.id === src.kaynak) : undefined;
    return (
      <aside className="prop-pane">
        <h3>Tablo</h3>
        <Section title="Genel">
          <label>
            Ad
            <CommitInput
              value={t.ad}
              onCommit={(v) => run({ op: "rename_table", table: t.ad, new_name: v }, { kind: "table", table: v })}
            />
          </label>
          <label>
            Açıklama
            <CommitInput
              multiline
              value={t.aciklama ?? ""}
              placeholder="Rapor yazarlarına görünür not"
              onCommit={(v) => run({ op: "update_table", table: t.ad, aciklama: v || null })}
            />
          </label>
          <label className="inline">
            <input type="checkbox" checked={t.gizli} onChange={(e) => run({ op: "update_table", table: t.ad, gizli: e.target.checked })} />
            Rapor görünümünde gizle
          </label>
          <dl className="kv">
            <dt>Satır</dt>
            <dd>{rows === null ? "—" : nf.format(rows)}</dd>
            <dt>Sütun</dt>
            <dd>{t.sutunlar.length}</dd>
            <dt>Depolama modu</dt>
            <dd>{t.mod === "import" ? "İçeri aktarma" : t.mod}</dd>
          </dl>
        </Section>
        <Section title="Tarih tablosu">
          <label>
            Tarih sütunu
            <select
              value={t.tarih_tablosu?.anahtar_sutun ?? ""}
              onChange={(e) => run({ op: "mark_date_table", table: t.ad, column: e.target.value || null })}
              disabled={dateCols.length === 0}
            >
              <option value="">{dateCols.length ? "İşaretli değil" : "Tarih sütunu yok"}</option>
              {dateCols.map((c) => (
                <option key={c.ad} value={c.ad}>
                  {c.ad}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Zaman zekâsı (Geçen yıl, YTD…) bu tabloyu kullanır. Sütundaki tarihler benzersiz olmalı.</p>
        </Section>
        {src && (
          <Section title="Kaynak">
            <dl className="kv">
              <dt>Sunucu</dt>
              <dd>{kaynak?.sunucu ?? src.kaynak}</dd>
              <dt>Veritabanı</dt>
              <dd>{src.veritabani ?? kaynak?.veritabani ?? "varsayılan"}</dd>
              {src.tablo ? (
                <>
                  <dt>Tablo</dt>
                  <dd>
                    {src.sema}.{src.tablo}
                  </dd>
                </>
              ) : (
                <>
                  <dt>SQL</dt>
                  <dd>
                    <pre className="sql-snippet">{src.sql}</pre>
                  </dd>
                </>
              )}
            </dl>
          </Section>
        )}
        <div className="prop-actions">
          <button onClick={() => onPreview(t.ad)}>Veriyi önizle</button>
          <button onClick={() => onNewMeasure(t.ad)}>Yeni ölçü</button>
          {src && <button onClick={() => onRefresh(t.ad)}>Yenile</button>}
          {src && (
            <button onClick={() => onTransform(t.ad)} title="Power Query düzenleyicisi">
              Verileri dönüştür{t.sorgu?.adimlar?.length ? ` (${t.sorgu.adimlar.length} adım)` : ""}
            </button>
          )}
          <button
            className="danger"
            onClick={() =>
              window.confirm(`'${t.ad}' tablosu ve ilişkileri modelden silinsin mi?`) &&
              run({ op: "delete_table", table: t.ad }, null)
            }
          >
            Sil
          </button>
        </div>
      </aside>
    );
  }

  // ------------------------------------------------------------ sütun
  const c = t.sutunlar.find((x) => x.ad === selection.column);
  if (!c) return <aside className="prop-pane" />;
  const base = { op: "update_column" as const, table: t.ad, column: c.ad };
  const usedIn = model.iliskiler.filter((r) =>
    [r.kimden, r.kime].some((ref) => {
      const [tt, cc] = parseRef(ref);
      return tt === t.ad && cc === c.ad;
    }),
  );
  const presetKnown = FORMAT_PRESETS.some((p) => p.value === (c.bicim ?? ""));
  return (
    <aside className="prop-pane">
      <h3>Sütun</h3>
      <Section title="Genel">
        <label>
          Ad
          <CommitInput
            value={c.ad}
            onCommit={(v) =>
              run({ op: "rename_column", table: t.ad, column: c.ad, new_name: v }, { kind: "column", table: t.ad, column: v })
            }
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={c.gizli} onChange={(e) => run({ ...base, gizli: e.target.checked })} />
          Rapor görünümünde gizle
        </label>
        <dl className="kv">
          <dt>Tablo</dt>
          <dd>{t.ad}</dd>
          {c.kaynak && (
            <>
              <dt>Kaynak sütun</dt>
              <dd>{c.kaynak}</dd>
            </>
          )}
          {c.anahtar && (
            <>
              <dt>Anahtar</dt>
              <dd>Birincil anahtar</dd>
            </>
          )}
          {usedIn.length > 0 && (
            <>
              <dt>İlişkiler</dt>
              <dd>{usedIn.length}</dd>
            </>
          )}
        </dl>
      </Section>
      <Section title="Biçimlendirme">
        <label>
          Veri tipi
          <select
            value={c.tip}
            onChange={(e) => {
              const tip = e.target.value as ColumnType;
              if (window.confirm(`${c.ad} sütununun tipi '${TYPE_LABEL[tip]}' olarak değiştirilsin mi?`)) void run({ ...base, tip });
            }}
          >
            {(TYPE_OPTIONS.includes(c.tip) ? TYPE_OPTIONS : [c.tip, ...TYPE_OPTIONS]).map((tp) => (
              <option key={tp} value={tp}>
                {TYPE_LABEL[tp]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Biçim
          <select value={presetKnown ? c.bicim ?? "" : "__custom"} onChange={(e) => e.target.value !== "__custom" && run({ ...base, bicim: e.target.value || null })}>
            {FORMAT_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            {!presetKnown && <option value="__custom">Özel: {c.bicim}</option>}
          </select>
        </label>
        <label>
          Özel biçim dizesi
          <CommitInput value={c.bicim ?? ""} placeholder="#,0.00" onCommit={(v) => run({ ...base, bicim: v || null })} />
        </label>
      </Section>
      <Section title="Gelişmiş">
        <label>
          Sütuna göre sırala
          <select value={c.siralama_sutunu ?? ""} onChange={(e) => run({ ...base, siralama_sutunu: e.target.value || null })}>
            <option value="">{c.ad} (kendisi)</option>
            {t.sutunlar
              .filter((o) => o.ad !== c.ad)
              .map((o) => (
                <option key={o.ad} value={o.ad}>
                  {o.ad}
                </option>
              ))}
          </select>
        </label>
        {isNumeric(c.tip) && (
          <label>
            Varsayılan özet
            <select value={c.ozet ?? "sum"} onChange={(e) => run({ ...base, ozet: e.target.value as Summarize })}>
              {(Object.keys(SUMMARIZE_LABEL) as Summarize[]).map((s) => (
                <option key={s} value={s}>
                  {SUMMARIZE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Veri kategorisi
          <select value={c.veri_kategorisi ?? ""} onChange={(e) => run({ ...base, veri_kategorisi: e.target.value || null })}>
            <option value="">Kategorisiz</option>
            <option value="Şehir">Şehir</option>
            <option value="İl">İl / Eyalet</option>
            <option value="Ülke">Ülke</option>
            <option value="Posta kodu">Posta kodu</option>
            <option value="Web URL">Web URL</option>
            <option value="Görüntü URL">Görüntü URL</option>
          </select>
        </label>
      </Section>
    </aside>
  );
}
