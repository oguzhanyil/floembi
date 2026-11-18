import type { FilterOp, Scalar, StepType, TransformStep } from "@floem/client";

export const STEP_LABEL: Record<TransformStep["tur"], string> = {
  yeniden_adlandir: "Yeniden adlandırılan sütun",
  sutun_kaldir: "Kaldırılan sütunlar",
  sutun_sec: "Diğer sütunlar kaldırıldı",
  tip_degistir: "Değiştirilen tür",
  satir_filtrele: "Filtrelenen satırlar",
  deger_degistir: "Değiştirilen değer",
  metin: "Biçimlendirilen metin",
  sutun_bol: "Bölünen sütun",
  sutun_birlestir: "Birleştirilen sütunlar",
  ozel_sutun: "Eklenen özel sütun",
  yinelenenleri_kaldir: "Kaldırılan yinelenenler",
  grupla: "Gruplandırılan satırlar",
  ters_ozet: "Ters özetlenen sütunlar",
  sorgu_birlestir: "Birleştirilen sorgular",
  sorgu_ekle: "Eklenen sorgu",
};

export const TYPE_LABEL: Record<StepType, string> = {
  int64: "Tam sayı",
  decimal: "Sabit ondalık sayı",
  double: "Ondalık sayı",
  string: "Metin",
  date: "Tarih",
  datetime: "Tarih/Saat",
  bool: "Doğru/Yanlış",
};

/** Sütun başlığındaki tür simgesi (Power Query'deki ABC / 123 / 1.2 karşılığı) */
export function typeBadge(t: string): string {
  switch (t) {
    case "int32":
    case "int64":
      return "123";
    case "decimal":
      return "$";
    case "double":
      return "1.2";
    case "date":
      return "▦";
    case "datetime":
      return "◷";
    case "bool":
      return "✓✗";
    default:
      return "ABC";
  }
}

export const NUMERIC = new Set(["int32", "int64", "decimal", "double"]);

export const FILTER_LABEL: Record<FilterOp, string> = {
  icinde: "Listeden seç",
  icinde_degil: "Listedekiler hariç",
  esit: "Eşittir",
  esit_degil: "Eşit değildir",
  buyuk: "Büyüktür",
  buyuk_esit: "Büyük veya eşittir",
  kucuk: "Küçüktür",
  kucuk_esit: "Küçük veya eşittir",
  arasinda: "Arasında",
  icerir: "İçerir",
  icermez: "İçermez",
  ile_baslar: "İle başlar",
  ile_biter: "İle biter",
  bos: "Boş (null)",
  bos_degil: "Boş değil",
};

const OP_SIGN: Partial<Record<FilterOp, string>> = {
  esit: "=", esit_degil: "≠", buyuk: ">", buyuk_esit: "≥", kucuk: "<", kucuk_esit: "≤",
};

function v(x: Scalar) {
  return x === null ? "null" : typeof x === "string" ? `"${x}"` : String(x);
}

/** Adım listesinde araç ipucu: adımın ne yaptığı */
export function describeStep(s: TransformStep): string {
  switch (s.tur) {
    case "yeniden_adlandir":
      return `${s.sutun} → ${s.yeni_ad}`;
    case "sutun_kaldir":
    case "sutun_sec":
      return s.sutunlar.join(", ");
    case "tip_degistir":
      return `${s.sutun}: ${TYPE_LABEL[s.tip]}`;
    case "satir_filtrele": {
      const sign = OP_SIGN[s.islem];
      if (sign) return `${s.sutun} ${sign} ${v(s.degerler[0] ?? null)}`;
      if (s.islem === "icinde" || s.islem === "icinde_degil")
        return `${s.sutun} ${s.islem === "icinde" ? "∈" : "∉"} {${s.degerler.map(v).join(", ")}}`;
      if (s.islem === "arasinda") return `${v(s.degerler[0])} ≤ ${s.sutun} ≤ ${v(s.degerler[1])}`;
      return `${s.sutun}: ${FILTER_LABEL[s.islem].toLowerCase()} ${s.degerler.map(v).join(" ")}`.trim();
    }
    case "deger_degistir":
      return `${s.sutun}: ${v(s.bul)} → ${v(s.yerine)}`;
    case "metin":
      return `${s.sutun}: ${{ kirp: "kırp", buyuk: "BÜYÜK HARF", kucuk: "küçük harf" }[s.islem]}`;
    case "sutun_bol":
      return `${s.sutun}, "${s.ayirici}" ile ${s.adet} parçaya`;
    case "sutun_birlestir":
      return `${s.sutunlar.join(" + ")} → ${s.yeni_ad}`;
    case "ozel_sutun":
      return `${s.ad} = ${s.ifade}`;
    case "yinelenenleri_kaldir":
      return s.sutunlar.length ? s.sutunlar.join(", ") : "tüm sütunlar";
    case "grupla":
      return `${s.gruplar.join(", ")} → ${s.toplamalar.map((a) => a.ad).join(", ")}`;
    case "ters_ozet":
      return s.sutunlar.join(", ");
    case "sorgu_birlestir":
      return `${s.tablo} (${s.sol.join(", ")} = ${s.sag.join(", ")}), ${s.birlesim === "sol" ? "sol dış" : "iç"} birleşim`;
    case "sorgu_ekle":
      return s.tablolar.join(", ");
  }
}

/** Kullanıcının yazdığı değeri sütun tipine göre çevirir (sayı sütununa "10" → 10) */
export function parseValue(text: string, colType: string): Scalar {
  const t = text.trim();
  if (t === "") return colType === "string" ? "" : null;
  if (NUMERIC.has(colType)) {
    const n = Number(t.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : t;
  }
  if (colType === "bool") return /^(true|doğru|1|evet)$/i.test(t);
  return t;
}

/** Var olan adlarla çakışmayan yeni sütun adı */
export function freeName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  let name = base;
  for (let i = 2; lower.has(name.toLowerCase()); i++) name = `${base} (${i})`;
  return name;
}
