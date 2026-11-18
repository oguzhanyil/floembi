import { useMemo, useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { useDocument } from "../document";
import { ErrorBox } from "./ErrorBox";

/** "Yeni tablo → Tarih tablosu": takvim tablosu oluşturur ve tarih sütunlarına bağlar. */
export function DateTableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const dateCols = useMemo(
    () =>
      (doc?.model.tablolar ?? []).flatMap((t) =>
        t.sutunlar.filter((c) => (c.tip === "date" || c.tip === "datetime") && !c.ifade).map((c) => ({
          ref: `${t.ad}[${c.ad}]`, table: t.ad, column: c.ad, tip: c.tip,
        })),
      ),
    [doc],
  );
  const existing = doc?.model.tablolar.find((t) => t.tarih_tablosu);
  const [name, setName] = useState(existing ? "Takvim" : "Tarih");
  const [picked, setPicked] = useState<Set<string>>(new Set(dateCols.filter((c) => c.tip === "date").slice(0, 1).map((c) => c.ref)));
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<UiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setDoc(await client.applyOps([{
        op: "create_date_table", name, start: start || null, end: end || null, relate: [...picked],
      }]));
      onDone();
    } catch (e) {
      setError(toUiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-label="Tarih tablosu oluştur">
        <header className="modal-head">
          <h2>Tarih tablosu oluştur</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body form">
          <p className="hint">
            Yıl, Çeyrek, Ay, Gün ve Haftanın Günü sütunları; Ay ve gün adları doğru sırayla; Yıl → Çeyrek → Ay → Tarih
            hiyerarşisi. Tablo "tarih tablosu" olarak işaretlenir; Geçen Yıl ve YTD gibi zaman zekâsı ölçüleri bunu kullanır.
          </p>
          {existing && <p className="hint warn">Modelde zaten bir tarih tablosu var ({existing.ad}); yenisi işaretlenince eskisinin işareti kalkar.</p>}
          <label>
            Tablo adı
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset>
            <legend>Bağlanacak tarih sütunları</legend>
            {dateCols.length === 0 && <span className="muted">Modelde tarih sütunu yok; tablo yalnızca oluşturulur.</span>}
            {dateCols.map((c) => (
              <label key={c.ref} className="inline" title={c.tip === "datetime" ? "Tarih/saat sütunu: önce tipini 'Tarih' yapın" : ""}>
                <input
                  type="checkbox"
                  disabled={c.tip !== "date"}
                  checked={picked.has(c.ref)}
                  onChange={(e) => {
                    const n = new Set(picked);
                    if (e.target.checked) n.add(c.ref);
                    else n.delete(c.ref);
                    setPicked(n);
                  }}
                />
                {c.table} · {c.column}
                {c.tip === "datetime" && <span className="muted"> (tarih/saat; önce tipi "Tarih" yapılmalı)</span>}
              </label>
            ))}
          </fieldset>
          <div className="row2">
            <label>
              Başlangıç (isteğe bağlı)
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label>
              Bitiş (isteğe bağlı)
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <p className="hint">Boş bırakılırsa aralık seçilen sütunlardaki en eski ve en yeni tarihten bulunur ve tam yıllara genişletilir.</p>
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
        </div>
        <footer className="modal-foot">
          <button className="primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            {busy ? "Oluşturuluyor…" : "Oluştur"}
          </button>
          <button onClick={onClose}>İptal</button>
        </footer>
      </div>
    </div>
  );
}
