import type { AggOp, FilterOp, ModelTable, ResultColumn, TransformStep } from "@floem/client";
import { useMemo, useState } from "react";
import { FILTER_LABEL, NUMERIC, freeName, parseValue } from "./steps";

export type DialogKind =
  | "rename" | "filter" | "replace" | "split" | "merge_columns" | "custom" | "group" | "merge_queries" | "append";

interface Props {
  kind: DialogKind;
  columns: ResultColumn[];
  rows: unknown[][];
  selected: string[];
  table: string;
  tables: ModelTable[];
  onAdd: (step: TransformStep) => void;
  onClose: () => void;
}

const TITLE: Record<DialogKind, string> = {
  rename: "Sütunu yeniden adlandır",
  filter: "Satırları filtrele",
  replace: "Değerleri değiştir",
  split: "Sütunu sınırlayıcıya göre böl",
  merge_columns: "Sütunları birleştir",
  custom: "Özel sütun",
  group: "Gruplandırma ölçütü",
  merge_queries: "Sorguları birleştir",
  append: "Sorgu ekle",
};

const AGG_LABEL: Record<AggOp, string> = {
  toplam: "Toplam", ortalama: "Ortalama", en_kucuk: "En küçük", en_buyuk: "En büyük", say: "Satırları say",
  farkli_say: "Farklı satırları say",
};

const SEPARATORS = [
  { label: "Virgül", value: "," }, { label: "Noktalı virgül", value: ";" }, { label: "Boşluk", value: " " },
  { label: "Tire", value: "-" }, { label: "Eğik çizgi", value: "/" }, { label: "Sekme", value: "\t" },
];

/** Diğer tablonun dönüştürülmüş (fiziksel) sütun adları: birleştirme bu adlarla yapılır */
function physColumns(t: ModelTable | undefined): string[] {
  return (t?.sutunlar ?? []).filter((c) => !c.ifade).map((c) => c.kaynak ?? c.ad);
}

export function StepDialog({ kind, columns, rows, selected, table, tables, onAdd, onClose }: Props) {
  const names = columns.map((c) => c.name);
  const first = selected[0] ?? names[0] ?? "";
  const typeOf = (c: string) => columns.find((x) => x.name === c)?.type ?? "string";
  const [col, setCol] = useState(first);
  const [text, setText] = useState(kind === "rename" ? first : "");
  const [text2, setText2] = useState("");
  const [op, setOp] = useState<FilterOp>("icinde");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sep, setSep] = useState(kind === "merge_columns" ? " " : ",");
  const [count, setCount] = useState(2);
  const [groups, setGroups] = useState<string[]>(selected.length ? selected : first ? [first] : []);
  const [aggs, setAggs] = useState<{ sutun: string | null; islem: AggOp; ad: string }[]>([
    { sutun: null, islem: "say", ad: "Sayı" },
  ]);
  const others = tables.filter((t) => t.ad !== table && t.kaynak.katman === "veri");
  const [other, setOther] = useState(others[0]?.ad ?? "");
  const otherCols = physColumns(others.find((t) => t.ad === other));
  const [rightKey, setRightKey] = useState("");
  const [join, setJoin] = useState<"sol" | "ic">("sol");
  const [bring, setBring] = useState<Set<string>>(new Set());
  const [appendTables, setAppendTables] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  const idx = names.indexOf(col);
  // Filtre listesi ve bölme için önizlemedeki değerler (Power Query de ilk 1000 satıra bakar)
  const distinct = useMemo(() => {
    if (idx < 0) return [];
    const seen = new Map<string, unknown>();
    for (const r of rows) {
      const val = r[idx];
      const key = val === null || val === undefined ? "\u0000null" : String(val);
      if (!seen.has(key)) seen.set(key, val);
      if (seen.size >= 300) break;
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
  }, [rows, idx]);

  function toggle(set: Set<string>, key: string, fn: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    fn(next);
  }

  function submit() {
    setError("");
    const t = typeOf(col);
    const fail = (m: string) => setError(m);
    switch (kind) {
      case "rename":
        if (!text.trim()) return fail("Yeni adı yazın");
        return onAdd({ tur: "yeniden_adlandir", sutun: col, yeni_ad: text.trim() });
      case "filter": {
        if (op === "icinde" || op === "icinde_degil") {
          if (!picked.size) return fail("En az bir değer seçin");
          const vals = distinct.filter(([k]) => picked.has(k)).map(([k, val]) => (k === "\u0000null" ? null : val));
          const hasNull = vals.includes(null);
          const nonNull = vals.filter((x) => x !== null) as (string | number | boolean)[];
          if (hasNull && op === "icinde" && nonNull.length === 0)
            return onAdd({ tur: "satir_filtrele", sutun: col, islem: "bos", degerler: [] });
          return onAdd({ tur: "satir_filtrele", sutun: col, islem: op, degerler: nonNull });
        }
        if (op === "bos" || op === "bos_degil") return onAdd({ tur: "satir_filtrele", sutun: col, islem: op, degerler: [] });
        if (!text.trim()) return fail("Bir değer yazın");
        if (op === "arasinda") {
          if (!text2.trim()) return fail("İkinci değeri yazın");
          return onAdd({ tur: "satir_filtrele", sutun: col, islem: op, degerler: [parseValue(text, t), parseValue(text2, t)] });
        }
        const textOps: FilterOp[] = ["icerir", "icermez", "ile_baslar", "ile_biter"];
        return onAdd({
          tur: "satir_filtrele", sutun: col, islem: op, degerler: [textOps.includes(op) ? text : parseValue(text, t)],
        });
      }
      case "replace":
        return onAdd({
          tur: "deger_degistir", sutun: col,
          bul: text === "" && t !== "string" ? null : parseValue(text, t), yerine: parseValue(text2, t),
        });
      case "split":
        if (!sep) return fail("Sınırlayıcıyı yazın");
        return onAdd({ tur: "sutun_bol", sutun: col, ayirici: sep, adet: Math.min(20, Math.max(2, count)) });
      case "merge_columns":
        if (selected.length < 2) return fail("Birleştirmek için en az iki sütun seçin (Ctrl ile)");
        if (!text.trim()) return fail("Yeni sütunun adını yazın");
        return onAdd({ tur: "sutun_birlestir", sutunlar: selected, ayirici: sep, yeni_ad: text.trim() });
      case "custom":
        if (!text.trim()) return fail("Sütun adını yazın");
        if (!text2.trim()) return fail("Formülü yazın");
        return onAdd({ tur: "ozel_sutun", ad: text.trim(), ifade: text2.trim() });
      case "group":
        if (!groups.length) return fail("En az bir gruplama sütunu seçin");
        if (aggs.some((a) => !a.ad.trim() || (a.islem !== "say" && !a.sutun))) return fail("Her toplama için ad ve sütun seçin");
        return onAdd({ tur: "grupla", gruplar: groups, toplamalar: aggs.map((a) => ({ ...a, ad: a.ad.trim() })) });
      case "merge_queries":
        if (!other || !rightKey) return fail("Birleştirilecek tabloyu ve eşleşen sütunu seçin");
        if (!bring.size) return fail("Getirilecek en az bir sütun seçin");
        return onAdd({
          tur: "sorgu_birlestir", tablo: other, sol: [col], sag: [rightKey], birlesim: join, sutunlar: [...bring],
          onek: text,
        });
      case "append":
        if (!appendTables.size) return fail("Eklenecek en az bir tablo seçin");
        return onAdd({ tur: "sorgu_ekle", tablolar: [...appendTables] });
    }
  }

  const columnSelect = (value: string, onChange: (v: string) => void, list = names) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {list.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  // Bölme: önizlemedeki en çok parça sayısını öner
  function suggestCount(s: string) {
    if (!s || idx < 0) return;
    const max = Math.max(2, ...rows.slice(0, 1000).map((r) => String(r[idx] ?? "").split(s).length));
    setCount(Math.min(20, max));
  }

  return (
    <div className="modal-backdrop pq-dialog-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal pq-dialog" role="dialog" aria-label={TITLE[kind]}>
        <header className="modal-head">
          <h2>{TITLE[kind]}</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body form">
          {["rename", "filter", "replace", "split"].includes(kind) && (
            <label>
              Sütun
              {columnSelect(col, (c) => {
                setCol(c);
                setPicked(new Set());
                if (kind === "rename") setText(c);
              })}
            </label>
          )}

          {kind === "rename" && (
            <label>
              Yeni ad
              <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          )}

          {kind === "filter" && (
            <>
              <label>
                Koşul
                <select value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
                  {(Object.keys(FILTER_LABEL) as FilterOp[])
                    .filter((o) => !["icerir", "icermez", "ile_baslar", "ile_biter"].includes(o) || !NUMERIC.has(typeOf(col)))
                    .map((o) => (
                      <option key={o} value={o}>
                        {FILTER_LABEL[o]}
                      </option>
                    ))}
                </select>
              </label>
              {(op === "icinde" || op === "icinde_degil") && (
                <div className="pq-values">
                  <div className="pq-values-head">
                    <button className="link" onClick={() => setPicked(new Set(distinct.map(([k]) => k)))}>
                      Tümünü seç
                    </button>
                    <button className="link" onClick={() => setPicked(new Set())}>
                      Temizle
                    </button>
                    <span className="muted small">önizlemedeki ilk değerler</span>
                  </div>
                  {distinct.map(([k, val]) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(picked, k, setPicked)} />
                      {k === "\u0000null" ? <em className="muted">(boş)</em> : String(val)}
                    </label>
                  ))}
                </div>
              )}
              {!["icinde", "icinde_degil", "bos", "bos_degil"].includes(op) && (
                <label>
                  Değer
                  <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
                </label>
              )}
              {op === "arasinda" && (
                <label>
                  ve
                  <input type="text" value={text2} onChange={(e) => setText2(e.target.value)} />
                </label>
              )}
              {["icerir", "icermez", "ile_baslar", "ile_biter"].includes(op) && (
                <p className="hint">Büyük/küçük harf ayrımı yapılmaz.</p>
              )}
            </>
          )}

          {kind === "replace" && (
            <>
              <label>
                Aranan değer
                <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
              </label>
              <label>
                Yerine konacak
                <input type="text" value={text2} onChange={(e) => setText2(e.target.value)} />
              </label>
              <p className="hint">
                {typeOf(col) === "string"
                  ? "Metin sütununda değerin içindeki her geçiş değiştirilir."
                  : "Değerin tamamı eşleşirse değiştirilir. Aranan değer boş bırakılırsa boş (null) hücreler doldurulur."}
              </p>
            </>
          )}

          {(kind === "split" || kind === "merge_columns") && (
            <label>
              Sınırlayıcı
              <span className="row">
                <select
                  value={SEPARATORS.some((s) => s.value === sep) ? sep : "__custom"}
                  onChange={(e) => {
                    const next = e.target.value === "__custom" ? "" : e.target.value;
                    setSep(next);
                    if (kind === "split") suggestCount(next);
                  }}
                >
                  {kind === "merge_columns" && <option value="">Yok</option>}
                  {SEPARATORS.map((s) => (
                    <option key={s.label} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                  <option value="__custom">Özel…</option>
                </select>
                {!SEPARATORS.some((s) => s.value === sep) && (
                  <input type="text" value={sep} placeholder="ör. |" onChange={(e) => setSep(e.target.value)} />
                )}
              </span>
            </label>
          )}
          {kind === "split" && (
            <label>
              Sütun sayısı
              <input type="number" min={2} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </label>
          )}
          {kind === "merge_columns" && (
            <>
              <p className="hint">Birleştirilecek sütunlar (seçim sırasıyla): {selected.join(", ") || "—"}</p>
              <label>
                Yeni sütun adı
                <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Birleştirilmiş" />
              </label>
            </>
          )}

          {kind === "custom" && (
            <>
              <label>
                Yeni sütun adı
                <input type="text" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={freeName("Özel", names)} />
              </label>
              <div className="pq-custom">
                <label>
                  Özel sütun formülü
                  <textarea
                    rows={5}
                    value={text2}
                    spellCheck={false}
                    onChange={(e) => setText2(e.target.value)}
                    placeholder={'"Quantity" * "Price"'}
                  />
                </label>
                <div className="pq-custom-cols">
                  <span className="muted small">Kullanılabilir sütunlar</span>
                  {names.map((n) => (
                    <button key={n} className="link" onClick={() => setText2((v) => `${v}"${n}"`)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hint">
                Formül bir SQL ifadesidir (DuckDB): sütun adları çift tırnakla, metinler tek tırnakla yazılır. Örnekler:{" "}
                <code>"Quantity" * "Price"</code>, <code>CASE WHEN "Tutar" &gt; 1000 THEN 'Büyük' ELSE 'Küçük' END</code>,{" "}
                <code>year("DocDate")</code>, <code>upper(left("CardName", 3))</code>.
              </p>
            </>
          )}

          {kind === "group" && (
            <>
              <div className="pq-checks">
                <span className="muted small">Gruplama sütunları</span>
                {names.map((n) => (
                  <label key={n} className="check">
                    <input
                      type="checkbox"
                      checked={groups.includes(n)}
                      onChange={() => setGroups((g) => (g.includes(n) ? g.filter((x) => x !== n) : [...g, n]))}
                    />
                    {n}
                  </label>
                ))}
              </div>
              <table className="pq-aggs">
                <thead>
                  <tr>
                    <th>Yeni sütun adı</th>
                    <th>İşlem</th>
                    <th>Sütun</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {aggs.map((a, i) => {
                    const set = (patch: Partial<typeof a>) => setAggs((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                    return (
                      <tr key={i}>
                        <td>
                          <input type="text" value={a.ad} onChange={(e) => set({ ad: e.target.value })} />
                        </td>
                        <td>
                          <select value={a.islem} onChange={(e) => set({ islem: e.target.value as AggOp })}>
                            {(Object.keys(AGG_LABEL) as AggOp[]).map((o) => (
                              <option key={o} value={o}>
                                {AGG_LABEL[o]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={a.sutun ?? ""}
                            disabled={a.islem === "say"}
                            onChange={(e) => set({ sutun: e.target.value || null })}
                          >
                            <option value="">—</option>
                            {names
                              .filter((n) => !["toplam", "ortalama"].includes(a.islem) || NUMERIC.has(typeOf(n)))
                              .map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td>
                          <button className="link" onClick={() => setAggs((l) => l.filter((_, j) => j !== i))} disabled={aggs.length === 1}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                className="link"
                onClick={() =>
                  setAggs((l) => [...l, { sutun: names.find((n) => NUMERIC.has(typeOf(n))) ?? null, islem: "toplam", ad: freeName("Toplam", l.map((x) => x.ad)) }])
                }
              >
                ＋ Toplama ekle
              </button>
            </>
          )}

          {kind === "merge_queries" && (
            <>
              {others.length === 0 ? (
                <p className="hint warn">Birleştirilecek başka tablo yok.</p>
              ) : (
                <>
                  <div className="pq-merge">
                    <label>
                      {table} sütunu
                      {columnSelect(col, setCol)}
                    </label>
                    <label>
                      Birleştirilecek tablo
                      <select
                        value={other}
                        onChange={(e) => {
                          setOther(e.target.value);
                          setRightKey("");
                          setBring(new Set());
                        }}
                      >
                        {others.map((t) => (
                          <option key={t.ad} value={t.ad}>
                            {t.ad}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Eşleşen sütun
                      <select value={rightKey} onChange={(e) => setRightKey(e.target.value)}>
                        <option value="">Seçin…</option>
                        {otherCols.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Birleşim türü
                      <select value={join} onChange={(e) => setJoin(e.target.value as "sol" | "ic")}>
                        <option value="sol">Sol dış (ilk tablonun tümü, eşleşenler)</option>
                        <option value="ic">İç (yalnızca eşleşen satırlar)</option>
                      </select>
                    </label>
                  </div>
                  <div className="pq-checks">
                    <span className="muted small">Getirilecek sütunlar</span>
                    {otherCols.filter((n) => n !== rightKey).map((n) => (
                      <label key={n} className="check">
                        <input type="checkbox" checked={bring.has(n)} onChange={() => toggle(bring, n, setBring)} />
                        {n}
                      </label>
                    ))}
                  </div>
                  <label>
                    Sütun adı öneki
                    <input type="text" value={text} placeholder={`${other}.`} onChange={(e) => setText(e.target.value)} />
                  </label>
                  <p className="hint">
                    Power BI'daki "Sorguları birleştir" + "Genişlet" karşılığı. İlişki kurmak çoğu zaman daha iyidir; bunu
                    sütunları tek tabloda toplamak istediğinizde kullanın. Eşleşme birden çok satır bulursa satırlar çoğalır.
                  </p>
                </>
              )}
            </>
          )}

          {kind === "append" && (
            <div className="pq-checks">
              <span className="muted small">{table} tablosunun altına eklenecek tablolar (sütunlar adlarına göre eşlenir)</span>
              {others.map((t) => (
                <label key={t.ad} className="check">
                  <input type="checkbox" checked={appendTables.has(t.ad)} onChange={() => toggle(appendTables, t.ad, setAppendTables)} />
                  {t.ad}
                </label>
              ))}
            </div>
          )}

          {error && <p className="hint warn">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button onClick={onClose}>İptal</button>
          <button className="primary" onClick={submit}>
            Tamam
          </button>
        </footer>
      </div>
    </div>
  );
}
