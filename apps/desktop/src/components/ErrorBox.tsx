import { useState } from "react";
import type { UiError } from "../api";

/** Okunur hata kutusu: üstte Türkçe açıklama, altta açılır ham hata metni. */
export function ErrorBox({ error, onClose }: { error: UiError; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="error-box" role="alert">
      <div className="error-head">
        <span className="error-icon" aria-hidden>!</span>
        <span className="error-message">{error.message}</span>
        {onClose && (
          <button className="link" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        )}
      </div>
      {error.detail && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>
            {open ? "Ayrıntıları gizle" : "Ayrıntılar"}
          </button>
          {open && <pre className="error-detail">{error.detail}</pre>}
        </>
      )}
    </div>
  );
}
