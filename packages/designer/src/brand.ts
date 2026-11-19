export type BrandProduct = "yildirim" | "floemdata" | "floembi" | "floemway";
export type BrandVariant = "horizontal" | "vertical" | "symbol" | "mono" | "outline" | "app";
export const BRAND_NAMES: Record<BrandProduct, string> = { yildirim: "YILDIRIM", floemdata: "FloemData", floembi: "Floem BI", floemway: "Floemway" };
export const BRAND_SIZES = [16, 32, 48, 64, 128, 256, 512] as const;

/** Mevcut Y/veri-piksel işaretinin vektör ailesi. Dış font veya ağ kaynağı gerektirmez. */
export function brandSvg(product: BrandProduct, variant: BrandVariant, mode: "light" | "dark", size = 128): string {
  const dark = mode === "dark", ink = dark ? "#F5F8FF" : "#172033";
  const mono = variant === "mono", outline = variant === "outline", small = size <= 32;
  const left = mono || outline ? ink : "#0866E8", right = mono || outline ? ink : "#00A8E8";
  const path = (d: string, fill: string) => `<path d="${d}" fill="${outline ? 'none' : fill}"${outline ? ` stroke="${fill}" stroke-width="2.8" stroke-linejoin="round"` : ''}/>`;
  const symbol = small ? path("M25 26 62 53 62 113 48 100 48 66 25 49Z", left) + path("M103 26 66 53 66 113 80 100 80 66 103 49Z", right) : path("M24 25 58 50 58 68 24 43Z", left) + path("M104 25 70 50 70 68 104 43Z", right)
    + path("M58 57 64 62 64 111 53 101 53 69 24 48 24 58 45 74 45 104 62 120 62 64Z", left)
    + path("M70 57 64 62 64 111 75 101 75 69 104 48 104 58 83 74 83 104 66 120 66 64Z", right)
    + (small ? '' : `<g fill="${left}"><rect x="13" y="17" width="7" height="7"/><rect x="22" y="9" width="5" height="5"/></g><g fill="${right}"><rect x="108" y="17" width="7" height="7"/><rect x="101" y="9" width="5" height="5"/></g>`);
  const title = BRAND_NAMES[product], sub = product === "yildirim" ? "TECHNOLOGIES" : product === "floemdata" ? "ANALYTICS PLATFORM" : product === "floembi" ? "DESKTOP" : "DATA GATEWAY";
  let width = 128, height = 128, body = symbol;
  if (variant === "horizontal") {
    width = 520; body = `<g transform="translate(0 -1)">${symbol}</g><text x="148" y="64" font-size="42" font-weight="700" fill="${ink}">${title}</text><text x="150" y="94" font-size="14" letter-spacing="3" fill="${dark ? '#67D9F0' : '#0866E8'}">${sub}</text>`;
  } else if (variant === "vertical") {
    width = 320; height = 220; body = `<g transform="translate(96 0)">${symbol}</g><text x="160" y="166" text-anchor="middle" font-size="36" font-weight="700" fill="${ink}">${title}</text><text x="160" y="195" text-anchor="middle" font-size="12" letter-spacing="3" fill="${dark ? '#67D9F0' : '#0866E8'}">${sub}</text>`;
  } else if (variant === "app") {
    body = `<rect x="3" y="3" width="122" height="122" rx="26" fill="${dark ? '#0B1628' : '#EDF5FF'}" stroke="${dark ? '#40546B' : '#BCD5F5'}"/><g transform="translate(8 -2) scale(.875)">${symbol}</g>`;
    if (!small && product === "floembi") body += '<g fill="#00A8E8"><rect x="88" y="91" width="5" height="13" rx="1"/><rect x="96" y="84" width="5" height="20" rx="1"/><rect x="104" y="77" width="5" height="27" rx="1"/></g>';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(size * width / height)}" height="${size}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}" font-family="Segoe UI,Arial,sans-serif">${body}</svg>`;
}
export const svgData = (svg: string) => `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(svg), (n) => String.fromCharCode(n)).join(''))}`;
export async function brandPng(product: BrandProduct, variant: BrandVariant, mode: "light" | "dark", size: number): Promise<Blob> {
  const image = new Image(); image.src = svgData(brandSvg(product, variant, mode, size)); await image.decode();
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Simge oluşturulamadı.")), "image/png"));
}
export async function brandIco(product: BrandProduct, mode: "light" | "dark"): Promise<Blob> {
  const sizes = [16,32,48,64,128,256], chunks = await Promise.all(sizes.map(async (size) => new Uint8Array(await (await brandPng(product, "app", mode, size)).arrayBuffer())));
  const header = new ArrayBuffer(6 + sizes.length * 16), view = new DataView(header); view.setUint16(2, 1, true); view.setUint16(4, sizes.length, true);
  let offset = header.byteLength;
  chunks.forEach((bytes, i) => { const at = 6 + i * 16; view.setUint8(at, sizes[i] === 256 ? 0 : sizes[i]); view.setUint8(at+1, sizes[i] === 256 ? 0 : sizes[i]); view.setUint16(at+4, 1, true); view.setUint16(at+6, 32, true); view.setUint32(at+8, bytes.length, true); view.setUint32(at+12, offset, true); offset += bytes.length; });
  return new Blob([header, ...chunks], { type: "image/vnd.microsoft.icon" });
}
