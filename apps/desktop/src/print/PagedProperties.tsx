import type { Calculation, Condition, PagedReport, PrintBand, PrintFormat, PrintItem } from "@floem/client";
import { paperWidth, tools } from "./pagedModel";

export function Choice({
  label,
  value,
  options,
  change,
  empty,
}: {
  label: string;
  value?: string | null;
  options: (string | [string, string])[];
  change: (s: string) => void;
  empty?: string;
}) {
  return (
    <label>
      {label}
      <select value={value ?? ""} onChange={(e) => change(e.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((v) => {
          const [k, l] = typeof v === "string" ? [v, v] : v;
          return (
            <option key={k} value={k}>
              {l}
            </option>
          );
        })}
      </select>
    </label>
  );
}
export function Num({
  label,
  value,
  change,
  min = 0,
  max = 420,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step=".1"
        min={min}
        max={max}
        value={Math.round(value * 100) / 100}
        onChange={(e) => {
          if (Number.isFinite(e.target.valueAsNumber))
            change(Math.max(min, Math.min(max, e.target.valueAsNumber)));
        }}
      />
    </label>
  );
}
const operations: Record<Calculation["op"], string> = {
  field: "Alan değeri",
  add: "Topla",
  subtract: "Çıkar",
  multiply: "Çarp",
  divide: "Böl",
  round: "Yuvarla",
  abs: "Mutlak değer",
  year: "Yıl",
  month: "Ay",
  day: "Gün",
  daysBetween: "İki tarih arası gün",
  if: "Eğer",
  count: "Kayıt sayısı",
  sum: "Toplam",
  running: "Yürüyen toplam",
};
const formats: [PrintFormat, string][] = [
  ["auto", "Otomatik"],
  ["money", "Tutar (TL)"],
  ["decimal", "Ondalık"],
  ["integer", "Tam sayı"],
  ["date", "Tarih"],
];
function RuleFields({
  rule,
  fields,
  change,
}: {
  rule: Condition;
  fields: string[];
  change: (r: Condition) => void;
}) {
  return (
    <>
      <Choice
        label="Karşılaştırma alanı"
        value={rule.field}
        options={fields}
        change={(field) => change({ ...rule, field })}
      />
      <Choice
        label="Karşılaştırma"
        value={rule.op}
        options={[
          ["eq", "Eşit"],
          ["ne", "Farklı"],
          ["gt", "Büyük"],
          ["ge", "Büyük veya eşit"],
          ["lt", "Küçük"],
          ["le", "Küçük veya eşit"],
          ["contains", "İçerir"],
        ]}
        change={(op) => change({ ...rule, op: op as Condition["op"] })}
      />
      <label>
        Karşılaştırılan değer
        <input
          value={String(rule.value ?? "")}
          onChange={(e) => change({ ...rule, value: e.target.value })}
        />
      </label>
    </>
  );
}
export function PagedProperties({
  t,
  b,
  o,
  fields,
  library,
  tableFields,
  edit,
  remove,
}: {
  t: PagedReport;
  b: PrintBand;
  o: PrintItem;
  fields: string[];
  library: PagedReport[];
  tableFields: (t: string) => string[];
  edit: (v: Partial<PrintItem>) => void;
  remove: () => void;
}) {
  const width = paperWidth(t),
    f = o.formula ?? { op: "field", field: fields[0] },
    calc = (p: Partial<Calculation>) => edit({ formula: { ...f, ...p } });
  const defRule: Condition = { field: fields[0], op: "eq", value: "" };
  return (
    <fieldset>
      <legend>{tools[o.kind]}</legend>
      <div className="pg-pair">
        <Num label="X (mm)" value={o.x} max={width - o.w} change={(x) => edit({ x })} />
        <Num label="Y (mm)" value={o.y} max={b.height - o.h} change={(y) => edit({ y })} />
        <Num label="Genişlik" min={0.3} value={o.w} max={width - o.x} change={(w) => edit({ w })} />
        <Num label="Yükseklik" min={0.3} value={o.h} max={b.height - o.y} change={(h) => edit({ h })} />
      </div>
      <div className="pg-actions">
        {["Sola", "Ortala", "Sağa"].map((s, i) => (
          <button key={s} onClick={() => edit({ x: ((width - o.w) * i) / 2 })}>
            {s}
          </button>
        ))}
      </div>
      {o.kind === "text" && (
        <label>
          Metin
          <textarea value={o.text ?? ""} onChange={(e) => edit({ text: e.target.value })} />
        </label>
      )}
      {o.kind === "text" && (
        <label>
          <input
            type="checkbox"
            checked={o.wrap ?? true}
            onChange={(e) => edit({ wrap: e.target.checked })}
          />{" "}
          Uzun metni satırlara böl
        </label>
      )}
      {["field", "barcode", "subreport", "crossTab"].includes(o.kind) && (
        <Choice
          label={
            o.kind === "subreport" ? "Ana kayıt alanı" : o.kind === "crossTab" ? "Satır alanı" : "Veri alanı"
          }
          options={fields}
          value={o.field}
          change={(field) => edit({ field })}
        />
      )}
      {o.kind === "barcode" && (
        <Choice
          label="Kod türü"
          options={[
            ["code128", "Code 128"],
            ["code39", "Code 39"],
            ["ean13", "EAN-13"],
            ["qr", "QR Code"],
          ]}
          value={o.symbology ?? "code128"}
          change={(s) => edit({ symbology: s as PrintItem["symbology"] })}
        />
      )}
      {o.kind === "subreport" && (
        <>
          <Choice
            label="Alt rapor"
            empty="Rapor seçin"
            value={o.target}
            options={library.filter((r) => r.id !== t.id).map((r) => [r.id, r.name])}
            change={(target) =>
              edit({
                target,
                childField: tableFields(library.find((r) => r.id === target)?.table ?? "")[0] ?? "",
              })
            }
          />
          <Choice
            label="Alt kaydın bağlantı alanı"
            value={o.childField}
            options={tableFields(library.find((r) => r.id === o.target)?.table ?? "")}
            change={(childField) => edit({ childField })}
          />
        </>
      )}
      {o.kind === "crossTab" && (
        <>
          <Choice
            label="Sütun alanı"
            value={o.column}
            options={fields}
            change={(column) => edit({ column })}
          />
          <Choice
            label="Toplanacak değer"
            value={o.measure}
            options={fields}
            change={(measure) => edit({ measure })}
          />
        </>
      )}
      {o.kind === "formula" && (
        <>
          <Choice
            label="İşlev"
            value={f.op}
            options={Object.entries(operations) as [string, string][]}
            change={(op) => calc({ op: op as Calculation["op"], condition: f.condition ?? defRule })}
          />
          {f.op !== "count" && f.op !== "if" && (
            <Choice
              label="Hesap alanı"
              value={f.field}
              options={fields}
              change={(field) => calc({ field })}
            />
          )}
          {["sum", "running", "count"].includes(f.op) && (
            <Choice
              label="Hesap kapsamı"
              value={f.scope ?? "section"}
              options={[
                ["section", "Geçerli grup"],
                ["report", "Tüm rapor"],
              ]}
              change={(scope) => calc({ scope: scope as Calculation["scope"] })}
            />
          )}
          {["add", "subtract", "multiply", "divide", "round", "daysBetween"].includes(f.op) && (
            <>
              <Choice
                label="İkinci alan"
                empty="Sabit değer"
                value={f.other}
                options={fields}
                change={(other) => calc({ other })}
              />
              {!f.other && (
                <label>
                  Sabit değer
                  <input value={String(f.value ?? 0)} onChange={(e) => calc({ value: e.target.value })} />
                </label>
              )}
            </>
          )}
          {f.op === "if" && (
            <>
              <RuleFields
                rule={f.condition ?? defRule}
                fields={fields}
                change={(condition) => calc({ condition })}
              />
              <label>
                Doğruysa
                <input value={String(f.yes ?? "")} onChange={(e) => calc({ yes: e.target.value })} />
              </label>
              <label>
                Yanlışsa
                <input value={String(f.no ?? "")} onChange={(e) => calc({ no: e.target.value })} />
              </label>
            </>
          )}
        </>
      )}
      <Num label="Yazı boyutu (pt)" min={5} max={72} value={o.font ?? 10} change={(font) => edit({ font })} />
      <label>
        <input type="checkbox" checked={o.bold ?? false} onChange={(e) => edit({ bold: e.target.checked })} />{" "}
        Kalın yazı
      </label>
      <Choice
        label="Metin hizası"
        options={[
          ["left", "Sol"],
          ["center", "Orta"],
          ["right", "Sağ"],
        ]}
        value={o.align ?? "left"}
        change={(align) => edit({ align: align as PrintItem["align"] })}
      />
      <Choice
        label="Değer biçimi"
        options={formats}
        value={o.format ?? "auto"}
        change={(format) => edit({ format: format as PrintFormat })}
      />
      <div className="pg-pair">
        <label>
          Renk
          <input
            type="color"
            value={o.color ?? "#162f46"}
            onChange={(e) => edit({ color: e.target.value })}
          />
        </label>
        <label>
          Dolgu
          <input
            type="color"
            value={o.background ?? "#ffffff"}
            onChange={(e) => edit({ background: e.target.value })}
          />
        </label>
      </div>
      <button onClick={() => edit({ background: null })}>Dolguyu temizle</button>
      {(o.kind === "line" || o.kind === "box") && (
        <Num
          label="Çizgi kalınlığı (mm)"
          min={0.1}
          max={6}
          value={o.border ?? 0.3}
          change={(border) => edit({ border })}
        />
      )}
      <label>
        <input
          type="checkbox"
          checked={Boolean(o.rule)}
          onChange={(e) => edit({ rule: e.target.checked ? defRule : null })}
        />{" "}
        Koşullu biçimlendirme
      </label>
      {o.rule && (
        <>
          <RuleFields rule={o.rule} fields={fields} change={(rule) => edit({ rule })} />
          <label>
            Koşul rengi
            <input
              type="color"
              value={o.ruleColor ?? "#b63428"}
              onChange={(e) => edit({ ruleColor: e.target.value })}
            />
          </label>
          <Choice
            label="Koşul biçimi"
            empty="Mevcut biçim"
            options={formats.slice(1)}
            value={o.ruleFormat}
            change={(v) => edit({ ruleFormat: (v as PrintItem["ruleFormat"]) || null })}
          />
          <label>
            <input
              type="checkbox"
              checked={o.hideWhen ?? false}
              onChange={(e) => edit({ hideWhen: e.target.checked })}
            />{" "}
            Koşul sağlanırsa gizle
          </label>
        </>
      )}
      <button onClick={remove}>Nesneyi kaldır</button>
    </fieldset>
  );
}
