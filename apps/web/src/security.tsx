import { FloemApiError, type DatasetSecurity } from "@floem/client";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSession } from "./session";

interface Err {
  message: string;
  detail?: string;
}

const toErr = (e: unknown): Err =>
  e instanceof FloemApiError ? { message: e.message, detail: e.detail } : { message: String(e) };

/** Power BI: anlam modeli → Güvenlik. Roller ve filtreleri Desktop'ta tanımlanır; burada kişiler atanır. */
export function SecurityPage({ id }: { id: number }) {
  const { client, guard } = useSession();
  const [data, setData] = useState<DatasetSecurity | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err | null>(null);

  useEffect(() => {
    guard(client.datasetSecurity(id))
      .then((d) => {
        setData(d);
        setPicked(d.roles[0]?.name ?? null);
      })
      .catch((e) => setError(toErr(e)));
  }, [client, guard, id]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!picked || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setData(await guard(client.addRoleMember(id, picked, email.trim())));
      setEmail("");
    } catch (err) {
      setError(toErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberId: number) {
    setError(null);
    try {
      setData(await guard(client.removeRoleMember(id, memberId)));
    } catch (err) {
      setError(toErr(err));
    }
  }

  if (!data) {
    return (
      <div className="page-wrap">
        {error ? <ErrorLine error={error} /> : <p className="muted">Yükleniyor…</p>}
      </div>
    );
  }
  const role = data.roles.find((r) => r.name === picked) ?? null;
  return (
    <div className="page-wrap security">
      <p className="muted small">
        <Link to={`/workspaces/${data.workspace.id}`}>{data.workspace.name}</Link> › {data.dataset.name}
      </p>
      <h1>Satır düzeyi güvenlik</h1>
      <p className="muted">
        Rolleri ve filtrelerini Floem BI Desktop'ta <strong>Rolleri yönet</strong> ile tanımlarsınız; burada her role
        kişi atarsınız. Filtreler yalnızca <strong>İzleyicilere</strong> ve raporu paylaşımla görenlere uygulanır.
        Modelde rol varsa, hiçbir role atanmamış izleyici rapor verisini göremez.
      </p>
      {error && <ErrorLine error={error} />}
      {data.roles.length === 0 ? (
        <div className="empty">
          <p>Bu anlam modelinde rol tanımlı değil; rapordaki tüm veri, erişimi olan herkese açık.</p>
          <p className="muted">
            Desktop'ta <strong>Modelleme → Rolleri yönet</strong> ile rol ekleyip yeniden yayımlayın.
          </p>
        </div>
      ) : (
        <div className="sec-grid">
          <ul className="sec-roles" aria-label="Roller">
            {data.roles.map((r) => (
              <li key={r.name}>
                <button className={r.name === picked ? "active" : ""} onClick={() => setPicked(r.name)}>
                  {r.name} <span className="muted">({r.members.length})</span>
                </button>
              </li>
            ))}
          </ul>
          {role && (
            <section className="sec-detail">
              <h2>{role.name}</h2>
              <div className="sec-filters">
                {role.filters.length === 0 ? (
                  <span className="muted small">Bu rolde tablo filtresi yok: üyeleri tüm veriyi görür.</span>
                ) : (
                  role.filters.map((f) => (
                    <div key={f.table} className="small">
                      <strong>{f.table}</strong> <code>{f.filtre}</code>
                    </div>
                  ))
                )}
              </div>
              <form className="sec-add" onSubmit={add}>
                <input
                  type="email" placeholder="ad@sirket.com" value={email} aria-label="Eklenecek kişinin e-postası"
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button className="primary" disabled={busy || !email.trim()}>Ekle</button>
              </form>
              {role.members.length === 0 ? (
                <p className="muted small">Bu role henüz kimse atanmadı.</p>
              ) : (
                <table className="items">
                  <tbody>
                    {role.members.map((m) => (
                      <tr key={m.id} className="static">
                        <td>{m.name}</td>
                        <td className="muted">{m.email}</td>
                        <td className="right">
                          <button className="link" onClick={() => void remove(m.id)}>Kaldır</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>
      )}
      {data.orphans.length > 0 && (
        <section>
          <h2>Modelde artık olmayan roller</h2>
          <p className="muted small">
            Bu atamalar son yayımlamada modelden kaldırılan rollere ait ve etkisiz. Temizleyebilirsiniz.
          </p>
          <table className="items">
            <tbody>
              {data.orphans.map((o) => (
                <tr key={o.id} className="static">
                  <td>{o.role}</td>
                  <td>{o.name}</td>
                  <td className="muted">{o.email}</td>
                  <td className="right">
                    <button className="link" onClick={() => void remove(o.id)}>Kaldır</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function ErrorLine({ error }: { error: Err }) {
  return (
    <div className="error-box" role="alert">
      <strong>{error.message}</strong>
      {error.detail && <span className="small"> {error.detail}</span>}
    </div>
  );
}
