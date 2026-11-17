import type { Relationship } from "@floem/client";
import { useState } from "react";
import { toUiError, useClient, type UiError } from "../api";
import { ErrorBox } from "../components/ErrorBox";
import { useDocument } from "../document";
import { relId } from "./modelUtils";
import type { RelationshipDraft } from "./RelationshipDialog";

/** Power BI'daki "İlişkileri yönet" penceresi. */
export function ManageRelationships({
  onClose, onEdit, onNew,
}: {
  onClose: () => void;
  onEdit: (r: Relationship) => void;
  onNew: (draft: RelationshipDraft) => void;
}) {
  const client = useClient();
  const { doc, setDoc } = useDocument();
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const rels = doc?.model.iliskiler ?? [];
  const current = rels.find((r) => relId(r) === picked) ?? null;

  async function run(op: Parameters<typeof client.applyOps>[0][number]) {
    setError(null);
    try {
      setDoc(await client.applyOps([op]));
    } catch (e) {
      setError(toUiError(e));
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal manage-rel" role="dialog" aria-label="İlişkileri yönet">
        <header className="modal-head">
          <h2>İlişkileri yönet</h2>
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        </header>
        <div className="modal-body">
          {rels.length === 0 ? (
            <p className="muted">Modelde henüz ilişki yok.</p>
          ) : (
            <table className="list-table">
              <thead>
                <tr>
                  <th>Etkin</th>
                  <th>Kimden (çok)</th>
                  <th>Kime (bir)</th>
                  <th>Kardinalite</th>
                  <th>Filtre</th>
                </tr>
              </thead>
              <tbody>
                {rels.map((r) => (
                  <tr
                    key={relId(r)}
                    className={picked === relId(r) ? "picked" : ""}
                    onClick={() => setPicked(relId(r))}
                    onDoubleClick={() => onEdit(r)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={r.aktif}
                        aria-label="Etkin"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          run({ op: "update_relationship", kimden: r.kimden, kime: r.kime, aktif: e.target.checked })
                        }
                      />
                    </td>
                    <td>{r.kimden}</td>
                    <td>{r.kime}</td>
                    <td>{r.kardinalite === "1:1" ? "Bire bir" : "Çoka bir"}</td>
                    <td>{r.filtre_yonu === "cift" ? "İki yönlü" : "Tek"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {error && <ErrorBox error={error} onClose={() => setError(null)} />}
        </div>
        <footer className="modal-foot">
          <button onClick={() => onNew({})}>Yeni…</button>
          <button disabled={!current} onClick={() => current && onEdit(current)}>
            Düzenle…
          </button>
          <button
            disabled={!current}
            onClick={() => {
              if (current && window.confirm(`${current.kimden} → ${current.kime} ilişkisi silinsin mi?`)) {
                void run({ op: "delete_relationship", kimden: current.kimden, kime: current.kime });
                setPicked(null);
              }
            }}
          >
            Sil
          </button>
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            Kapat
          </button>
        </footer>
      </div>
    </div>
  );
}
