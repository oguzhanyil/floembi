import { useState } from "react";
import { BRAND_NAMES, BRAND_SIZES, brandIco, brandPng, brandSvg, svgData, type BrandProduct, type BrandVariant } from "./brand";
import { LibraryDialog, downloadDesign } from "./ComponentLibraryPane";

const variants: { id: BrandVariant; label: string }[] = [{ id: "horizontal", label: "Yatay logo" }, { id: "vertical", label: "Dikey logo" }, { id: "symbol", label: "Sembol" }, { id: "mono", label: "Tek renk" }, { id: "outline", label: "Çizgisel" }, { id: "app", label: "Uygulama simgesi" }];
export function BrandLibrary({ onClose, onInsert }: { onClose: () => void; onInsert: (data: string, width: number, height: number, title: string) => void }) {
  const [product, setProduct] = useState<BrandProduct>("floembi"), [mode, setMode] = useState<"light" | "dark">("light");
  const [variant, setVariant] = useState<BrandVariant>("horizontal"), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const source = (v: BrandVariant, size = 128) => svgData(brandSvg(product, v, mode, size));
  const run = async (fn: () => Promise<void>) => { setBusy(true); setNotice(""); try { await fn(); } catch (e) { setNotice(String(e)); } finally { setBusy(false); } };
  return <LibraryDialog title="Marka ve ikon kitaplığı" onClose={onClose}>
    <p>Yıldırım Y işareti ve veri piksel uçlarından türetilen vektör ailesi. Küçük simgelerde ayrıntılar sadeleşir.</p>
    <div className="brand-options"><label>Marka<select aria-label="Marka" value={product} onChange={(e) => setProduct(e.target.value as BrandProduct)}>{Object.entries(BRAND_NAMES).map(([id,label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <label>Zemin<select aria-label="Marka zemini" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="light">Açık</option><option value="dark">Koyu</option></select></label></div>
    <div className={`brand-variants ${mode}`}>{variants.map((v) => <button type="button" key={v.id} aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}><img src={source(v.id)} alt={`${BRAND_NAMES[product]} · ${v.label}`} /><span>{v.label}</span></button>)}</div>
    <h3>Gerçek boyutta simgeler · 16–512 px</h3><p>Sayfa kaydırılabilir; her simge aşağıda belirtilen piksel boyutunda çizilir.</p>
    <div className={`brand-sizes ${mode}`}>{BRAND_SIZES.map((size) => <figure key={size}><img src={source("app", size)} width={size} height={size} alt={`${size} piksel ${BRAND_NAMES[product]} simgesi`} /><figcaption>{size} × {size}<button type="button" disabled={busy} onClick={() => void run(async () => downloadDesign(await brandPng(product, "app", mode, size), `${product}-${mode}-${size}.png`))}>PNG indir</button></figcaption></figure>)}</div>
    <footer><button type="button" disabled={busy} onClick={() => downloadDesign(new Blob([brandSvg(product, variant, mode, 512)], { type: "image/svg+xml" }), `${product}-${variant}-${mode}.svg`)}>SVG indir</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => downloadDesign(await brandPng(product, variant, mode, 512), `${product}-${variant}-${mode}.png`))}>512 px PNG indir</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => downloadDesign(await brandIco(product, mode), `${product}-${mode}.ico`))}>Windows ICO indir</button>
      <button type="button" onClick={() => onInsert(source(variant), variant === "horizontal" ? 390 : variant === "vertical" ? 240 : 128, variant === "horizontal" ? 96 : variant === "vertical" ? 165 : 128, `${BRAND_NAMES[product]} · ${variants.find((v) => v.id === variant)!.label}`)}>Logoyu sayfaya ekle</button></footer>
    {notice && <p role="alert">{notice}</p>}
  </LibraryDialog>;
}
