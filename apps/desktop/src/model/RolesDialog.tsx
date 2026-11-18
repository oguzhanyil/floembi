import type { ModelOp, ViewAs } from "@floem/client";
import { useMemo, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "../components/ErrorBox";
import { useDocument } from "../document";

interface DraftRole {
  /** Modeldeki adı (yeni rolde null) */
  orig: string | null;
  name: string;
  filters: Record<string, string>;
}

/** Power BI "Rolleri yönet": satır düzeyi güvenlik rolleri ve tablo başına FDX filtresi. */
export function RolesDialog({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const tables = doc?.model.tablolar ?? [];
  const [roles, setRoles] = useState<DraftRole[]>(() =>
    (doc?.model.roller ?? []).map((r) => ({
      orig: r.ad,
      name: r.ad,
      filters: Object.fromEntries((r.tablo_izinleri ?? []).map((iz) => [iz.tablo, iz.filtre])),
    })),
  );
  const [picked, setPicked] = useState(0);
  const [table, setTable] = useState<string>(tables[0]?.ad ?? "");
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);
  const role = roles[picked] as DraftRole | undefined;

  const patch = (fn: (r: DraftRole) => DraftRole) =>
    setRoles((all) => all.map((r, i) => (i === picked ? fn(r) : r)));

  function addRole() {
    const used = new Set(roles.map((r) => r.name.toLowerCase()));
    let n = 1;
    while (used.has(`yeni rol ${n}`)) n++;
    setRoles([...roles, { orig: null, name: `Yeni rol ${n}`, filters: {} }]);
    setPicked(roles.length);
  }

  function deleteRole() {
    if (!role) return;
    setRoles(roles.filter((_, i) => i !== picked));
    setPicked(Math.max(0, picked - 1));
  }

  const ops = useMemo<ModelOp[]>(() => {
    const out: ModelOp[] = [];
    const kept = new Set(roles.filter((r) => r.orig).map((r) => r.orig!.toLowerCase()));
    for (const r of doc?.model.roller ?? []) {
      if (!kept.has(r.ad.toLowerCase())) out.push({ op: "delete_role", name: r.ad });
    }
    for (const r of roles) {
      const filters = Object.entries(r.filters)
        .filter(([, f]) => f.trim())
        .map(([t, f]) => ({ table: t, filtre: f }));
      out.push({
        op: "set_role",
        name: r.orig ?? r.name.trim(),
        ...(r.orig && r.name.trim() !== r.orig ? { new_name: r.name.trim() } : {}),
        filters,
      });
    }
    return out;
  }, [roles, doc]);

  async function save() {
    const names = roles.map((r) => r.name.trim().toLowerCase());
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (names.some((n) => !n) || dup !== undefined) {
      setError({ message: dup ? `"${dup}" adlı iki rol var; rol adları benzersiz olmalı` : "Rol adı boş olamaz" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (ops.length) setDoc(await client.applyOps(ops));
      onClose();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal roles-dialog" role="dialog" aria-label="Rolleri yönet">
        <header className="modal-head">
          <h2>Rolleri yönet</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">✕</button>
        </header>
        <div className="modal-body roles-body">
          <section className="roles-col">
            <div className="roles-col-head">
              <strong>Roller</strong>
              <button onClick={addRole}>＋ Yeni</button>
            </div>
            <ul className="roles-list">
              {roles.map((r, i) => (
                <li key={i}>
                  <button className={i === picked ? "active" : ""} onClick={() => setPicked(i)}>
                    {r.name || "(adsız)"}
                    {Object.values(r.filters).some((f) => f.trim()) && <span className="muted"> ⛉</span>}
                  </button>
                </li>
              ))}
              {roles.length === 0 && <li className="muted small pad">Henüz rol yok</li>}
            </ul>
          </section>
          {role ? (
            <>
              <section className="roles-col">
                <label className="roles-name">
                  Rol adı
                  <input value={role.name} onChange={(e) => patch((r) => ({ ...r, name: e.target.value }))} />
                </label>
                <strong className="roles-sub">Tablolar</strong>
                <ul className="roles-list">
                  {tables.map((t) => (
                    <li key={t.ad}>
                      <button className={t.ad === table ? "active" : ""} onClick={() => setTable(t.ad)}>
                        {t.ad}
                        {role.filters[t.ad]?.trim() && <span className="muted"> ⛉</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="roles-col roles-filter">
                <strong>{table} tablosunu filtrele</strong>
                <textarea
                  rows={6}
                  spellCheck={false}
                  value={role.filters[table] ?? ""}
                  placeholder={`Örnek: [${tables.find((t) => t.ad === table)?.sutunlar[0]?.ad ?? "Sütun"}] = "değer"`}
                  onChange={(e) => patch((r) => ({ ...r, filters: { ...r.filters, [table]: e.target.value } }))}
                />
                <p className="muted small">
                  Bu role atanan kişiler yalnızca ifadenin doğru olduğu satırları görür; filtre ilişkiler boyunca diğer
                  tablolara da yayılır. Boş bırakırsanız tablo filtrelenmez.
                </p>
                <p className="muted small">
                  Kişiye göre filtre: <code>[E-posta] = USERPRINCIPALNAME()</code> oturum açan kullanıcının e-postasını verir.
                </p>
                <div className="roles-foot-left">
                  <button onClick={deleteRole}>Rolü sil</button>
                </div>
              </section>
            </>
          ) : (
            <section className="roles-col roles-empty muted">
              Sol taraftan <strong>＋ Yeni</strong> ile bir rol oluşturun. Rollere kişileri floembi.app'te, anlam modelinin
              Güvenlik ekranında atarsınız.
            </section>
          )}
        </div>
        {error && (
          <div className="pad">
            <ErrorBox error={error} onClose={() => setError(null)} />
          </div>
        )}
        <footer className="modal-foot">
          <span className="muted small">Kaydederken filtreler denetlenir; hatalı filtre kaydedilmez.</span>
          <span className="spacer" />
          <button onClick={onClose}>İptal</button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Power BI "Farklı görüntüle": raporu seçilen rollerin gözünden gösterir (yalnızca bu bilgisayarda). */
export function ViewAsDialog({
  current, onApply, onClose,
}: {
  current: ViewAs | null;
  onApply: (v: ViewAs | null) => void;
  onClose: () => void;
}) {
  const { doc } = useDocument();
  const all = doc?.model.roller ?? [];
  const [roles, setRoles] = useState<string[]>(current?.roles ?? []);
  const [other, setOther] = useState(Boolean(current?.upn));
  const [upn, setUpn] = useState(current?.upn ?? "");
  const toggle = (name: string) =>
    setRoles((r) => (r.includes(name) ? r.filter((x) => x !== name) : [...r, name]));

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Rol olarak görüntüle">
        <header className="modal-head">
          <h2>Rol olarak görüntüle</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">✕</button>
        </header>
        <div className="modal-body viewas-body">
          {all.length === 0 ? (
            <p className="muted">Modelde rol yok. Önce <strong>Rolleri yönet</strong> ile rol oluşturun.</p>
          ) : (
            <>
              <label className="inline">
                <input type="checkbox" checked={other} onChange={(e) => setOther(e.target.checked)} />
                Diğer kullanıcı
              </label>
              {other && (
                <input
                  className="viewas-upn" placeholder="ad@sirket.com" value={upn} aria-label="Kullanıcı e-postası"
                  onChange={(e) => setUpn(e.target.value)}
                />
              )}
              {all.map((r) => (
                <label key={r.ad} className="inline">
                  <input type="checkbox" checked={roles.includes(r.ad)} onChange={() => toggle(r.ad)} />
                  {r.ad}
                </label>
              ))}
              <p className="muted small">
                Birden fazla rol seçerseniz, Power BI'daki gibi rollerin gördüğü satırların birleşimi gösterilir.
              </p>
            </>
          )}
        </div>
        <footer className="modal-foot">
          <button onClick={onClose}>İptal</button>
          <button
            className="primary"
            disabled={roles.length === 0}
            onClick={() => onApply({ roles, ...(other && upn.trim() ? { upn: upn.trim() } : {}) })}
          >
            Tamam
          </button>
        </footer>
      </div>
    </div>
  );
}
