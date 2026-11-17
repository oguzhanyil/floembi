import { colRef, parseRef, type ModelOp, type ModelTable, type Relationship, type RelationshipProfile } from "@floem/client";
import { useEffect, useMemo, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "../components/ErrorBox";
import { useDocument } from "../document";
import { nf } from "./modelUtils";

type Card = "*:1" | "1:1" | "1:*";

export interface RelationshipDraft {
  kimden?: string;
  kime?: string;
  kardinalite?: Relationship["kardinalite"];
  filtre_yonu?: Relationship["filtre_yonu"];
  aktif?: boolean;
}

const CARD_LABEL: Record<Card, string> = {
  "*:1": "Çoka bir (*:1)",
  "1:1": "Bire bir (1:1)",
  "1:*": "Bire çok (1:*)",
};

function Side({
  title, tables, table, column, onTable, onColumn, profile,
}: {
  title: string;
  tables: ModelTable[];
  table: string;
  column: string;
  onTable: (t: string) => void;
  onColumn: (c: string) => void;
  profile?: RelationshipProfile["from"];
}) {
  const cols = tables.find((t) => t.ad === table)?.sutunlar ?? [];
  return (
    <fieldset className="rel-side">
      <legend>{title}</legend>
      <label>
        Tablo
        <select value={table} onChange={(e) => onTable(e.target.value)}>
          <option value="">Seçin…</option>
          {tables.map((t) => (
            <option key={t.ad} value={t.ad}>
              {t.ad}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sütun
        <select value={column} onChange={(e) => onColumn(e.target.value)} disabled={!table}>
          <option value="">Seçin…</option>
          {cols.map((c) => (
            <option key={c.ad} value={c.ad}>
              {c.ad}
            </option>
          ))}
        </select>
      </label>
      {profile && (
        <p className="hint">
          {nf.format(profile.rows)} satır · {nf.format(profile.distinct)} farklı değer
          {profile.nulls ? ` · ${nf.format(profile.nulls)} boş` : ""} ·{" "}
          {profile.unique ? <strong className="ok">benzersiz</strong> : "yinelenen değerler var"}
        </p>
      )}
    </fieldset>
  );
}

/** Power BI'daki "İlişki oluştur / düzenle" penceresi. */
export function RelationshipDialog({
  draft, editing, onClose,
}: {
  draft: RelationshipDraft;
  /** Düzenlenen ilişkinin mevcut uçları; yoksa yeni ilişki */
  editing?: { kimden: string; kime: string };
  onClose: () => void;
}) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const tables = doc?.model.tablolar ?? [];
  const split = (ref?: string) => (ref ? parseRef(ref) : ["", ""]);
  const [[t1, c1], setA] = useState<[string, string]>(split(draft.kimden) as [string, string]);
  const [[t2, c2], setB] = useState<[string, string]>(split(draft.kime) as [string, string]);
  const [card, setCard] = useState<Card>(draft.kardinalite ?? "*:1");
  const [cardTouched, setCardTouched] = useState(!!editing);
  const [dir, setDir] = useState<Relationship["filtre_yonu"]>(draft.filtre_yonu ?? "tek");
  const [active, setActive] = useState(draft.aktif ?? true);
  const [profile, setProfile] = useState<RelationshipProfile | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [saving, setSaving] = useState(false);

  const ready = !!(t1 && c1 && t2 && c2);
  const from = ready ? colRef(t1, c1) : "";
  const to = ready ? colRef(t2, c2) : "";

  useEffect(() => {
    setProfile(null);
    if (!ready || t1 === t2) return;
    let alive = true;
    client
      .relationshipProfile(from, to)
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        if (!cardTouched && p.suggested !== "*:*") setCard(p.suggested);
      })
      .catch((e) => alive && setError(toUiError(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, ready, client]);

  const problem = useMemo(() => {
    if (!ready) return "İki tablodan birer sütun seçin.";
    if (t1 === t2) return "İlişki iki farklı tablo arasında olmalı.";
    if (!profile) return null;
    if (profile.suggested === "*:*")
      return "İki sütunda da yinelenen değerler var. Çoka çok ilişki henüz desteklenmiyor; bir tarafı benzersiz bir sütun seçin.";
    const needTo = card === "*:1" || card === "1:1";
    const needFrom = card === "1:*" || card === "1:1";
    if (needTo && !profile.to.unique) return `${t2}[${c2}] benzersiz değil; bu kardinalite kullanılamaz.`;
    if (needFrom && !profile.from.unique) return `${t1}[${c1}] benzersiz değil; bu kardinalite kullanılamaz.`;
    return null;
  }, [ready, t1, t2, c1, c2, profile, card]);

  async function save() {
    // "1:*" seçilirse uçlar çevrilir: modelde kimden her zaman çok tarafıdır
    const [many, one] = card === "1:*" ? [to, from] : [from, to];
    const kardinalite = card === "1:1" ? "1:1" : "*:1";
    const op: ModelOp = editing
      ? {
          op: "update_relationship", kimden: editing.kimden, kime: editing.kime,
          yeni_kimden: many, yeni_kime: one, kardinalite, filtre_yonu: dir, aktif: active,
        }
      : { op: "add_relationship", kimden: many, kime: one, kardinalite, filtre_yonu: dir, aktif: active };
    setSaving(true);
    setError(null);
    try {
      setDoc(await client.applyOps([op]));
      onClose();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal rel-dialog" role="dialog" aria-label={editing ? "İlişkiyi düzenle" : "Yeni ilişki"}>
        <header className="modal-head">
          <h2>{editing ? "İlişkiyi düzenle" : "Yeni ilişki"}</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body form">
          <div className="row2">
            <Side
              title="Tablo 1" tables={tables} table={t1} column={c1} profile={profile?.from}
              onTable={(t) => setA([t, ""])} onColumn={(c) => setA([t1, c])}
            />
            <Side
              title="Tablo 2" tables={tables} table={t2} column={c2} profile={profile?.to}
              onTable={(t) => setB([t, ""])} onColumn={(c) => setB([t2, c])}
            />
          </div>
          {profile && profile.matched !== null && (
            <p className="hint">
              Tablo 1'deki {nf.format(profile.from.distinct)} farklı değerin {nf.format(profile.matched)} tanesi Tablo
              2'de bulunuyor.
            </p>
          )}
          <div className="row2">
            <label>
              Kardinalite
              <select
                value={card}
                onChange={(e) => {
                  setCard(e.target.value as Card);
                  setCardTouched(true);
                }}
              >
                {(Object.keys(CARD_LABEL) as Card[]).map((k) => (
                  <option key={k} value={k}>
                    {CARD_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Çapraz filtre yönü
              <select value={dir} onChange={(e) => setDir(e.target.value as Relationship["filtre_yonu"])}>
                <option value="tek">Tek</option>
                <option value="cift">İki yönlü</option>
              </select>
            </label>
          </div>
          {dir === "cift" && (
            <p className="hint">İki yönlü filtre modelde saklanır; MVP sorgu motoru şimdilik tek yön olarak uygular.</p>
          )}
          <label className="inline">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Bu ilişkiyi etkin yap
          </label>
          {problem && <p className="hint warn">{problem}</p>}
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
        </div>
        <footer className="modal-foot">
          <button className="primary" onClick={save} disabled={!!problem || saving || !profile}>
            {saving ? "Kaydediliyor…" : "Tamam"}
          </button>
          <button onClick={onClose}>İptal</button>
        </footer>
      </div>
    </div>
  );
}
