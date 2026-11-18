import type { ModelDefinition } from "@floem/client";
import { monaco } from "../monaco";

/** Floem DAX'ta desteklenen fonksiyonlar (derleyiciyle uyumlu) ve kısa açıklamaları. */
export const DAX_FUNCTIONS: [string, string, string][] = [
  ["SUM", "SUM(<sütun>)", "Sütundaki sayıların toplamı"],
  ["AVERAGE", "AVERAGE(<sütun>)", "Ortalama"],
  ["MIN", "MIN(<sütun>)", "En küçük değer"],
  ["MAX", "MAX(<sütun>)", "En büyük değer"],
  ["COUNT", "COUNT(<sütun>)", "Boş olmayan değer sayısı"],
  ["COUNTA", "COUNTA(<sütun>)", "Boş olmayan değer sayısı"],
  ["COUNTROWS", "COUNTROWS(<tablo>)", "Satır sayısı; FILTER ile kullanılabilir"],
  ["DISTINCTCOUNT", "DISTINCTCOUNT(<sütun>)", "Farklı değer sayısı"],
  ["SUMX", "SUMX(<tablo>, <ifade>)", "Her satır için ifadeyi hesaplayıp toplar"],
  ["AVERAGEX", "AVERAGEX(<tablo>, <ifade>)", "Satır ifadesinin ortalaması"],
  ["MINX", "MINX(<tablo>, <ifade>)", "Satır ifadesinin en küçüğü"],
  ["MAXX", "MAXX(<tablo>, <ifade>)", "Satır ifadesinin en büyüğü"],
  ["COUNTX", "COUNTX(<tablo>, <ifade>)", "Satır ifadesinin boş olmayan sayısı"],
  ["CALCULATE", "CALCULATE(<ifade>, <filtre>, ...)", "İfadeyi değiştirilmiş filtre bağlamında hesaplar"],
  ["FILTER", "FILTER(<tablo>, <koşul>)", "Koşula uyan satırlar (CALCULATE/COUNTROWS/SUMX içinde)"],
  ["ALL", "ALL(<tablo veya sütun>)", "Filtreleri kaldırır"],
  ["ALLEXCEPT", "ALLEXCEPT(<tablo>, <sütun>, ...)", "Belirtilenler dışındaki filtreleri kaldırır"],
  ["ALLSELECTED", "ALLSELECTED(<tablo veya sütun>)", "Görselin gruplamasını kaldırır, dilimleyicileri korur"],
  ["REMOVEFILTERS", "REMOVEFILTERS(<tablo veya sütun>)", "Filtreleri kaldırır"],
  ["KEEPFILTERS", "KEEPFILTERS(<koşul>)", "Koşulu mevcut filtreyle kesiştirir"],
  ["VALUES", "VALUES(<sütun>)", "Tek değer varsa o değer"],
  ["SELECTEDVALUE", "SELECTEDVALUE(<sütun>, <alternatif>)", "Tek değer seçiliyse o değer, yoksa alternatif"],
  ["HASONEVALUE", "HASONEVALUE(<sütun>)", "Sütunda tek değer görünüyor mu"],
  ["USERELATIONSHIP", "USERELATIONSHIP(<sütun1>, <sütun2>)", "Pasif ilişkiyi bu hesap için etkinleştirir"],
  ["RELATED", "RELATED(<sütun>)", "Satır bağlamında ilişkili tablodaki değer"],
  ["DIVIDE", "DIVIDE(<pay>, <payda>, <alternatif>)", "Sıfıra bölmede hata vermeyen bölme"],
  ["IF", "IF(<koşul>, <doğruysa>, <yanlışsa>)", "Koşullu değer"],
  ["SWITCH", "SWITCH(<ifade>, <değer>, <sonuç>, ..., <varsayılan>)", "Çok koşullu değer"],
  ["AND", "AND(<koşul1>, <koşul2>)", "Ve"],
  ["OR", "OR(<koşul1>, <koşul2>)", "Veya"],
  ["NOT", "NOT(<koşul>)", "Değil"],
  ["ISBLANK", "ISBLANK(<değer>)", "Değer boş mu"],
  ["COALESCE", "COALESCE(<değer1>, <değer2>, ...)", "İlk boş olmayan değer"],
  ["BLANK", "BLANK()", "Boş değer"],
  ["SAMEPERIODLASTYEAR", "SAMEPERIODLASTYEAR(<tarih sütunu>)", "Geçen yılın aynı dönemi"],
  ["DATEADD", "DATEADD(<tarih sütunu>, <sayı>, YEAR|QUARTER|MONTH)", "Dönemi kaydırır"],
  ["DATESYTD", "DATESYTD(<tarih sütunu>)", "Yılbaşından bugüne"],
  ["DATESQTD", "DATESQTD(<tarih sütunu>)", "Çeyrek başından bugüne"],
  ["DATESMTD", "DATESMTD(<tarih sütunu>)", "Ay başından bugüne"],
  ["TOTALYTD", "TOTALYTD(<ifade>, <tarih sütunu>)", "Yılbaşından bugüne toplam"],
  ["TOTALQTD", "TOTALQTD(<ifade>, <tarih sütunu>)", "Çeyrek başından bugüne toplam"],
  ["TOTALMTD", "TOTALMTD(<ifade>, <tarih sütunu>)", "Ay başından bugüne toplam"],
  ["ABS", "ABS(<sayı>)", "Mutlak değer"],
  ["ROUND", "ROUND(<sayı>, <basamak>)", "Yuvarlar"],
  ["INT", "INT(<sayı>)", "Aşağı yuvarlar"],
  ["MOD", "MOD(<sayı>, <bölen>)", "Bölümden kalan"],
  ["YEAR", "YEAR(<tarih>)", "Yıl"],
  ["MONTH", "MONTH(<tarih>)", "Ay"],
  ["DAY", "DAY(<tarih>)", "Gün"],
  ["DATE", "DATE(<yıl>, <ay>, <gün>)", "Tarih oluşturur"],
  ["TODAY", "TODAY()", "Bugünün tarihi"],
  ["LEN", "LEN(<metin>)", "Karakter sayısı"],
  ["LEFT", "LEFT(<metin>, <adet>)", "Soldan karakterler"],
  ["RIGHT", "RIGHT(<metin>, <adet>)", "Sağdan karakterler"],
  ["MID", "MID(<metin>, <başlangıç>, <adet>)", "Ortadan karakterler"],
  ["TRIM", "TRIM(<metin>)", "Baştaki/sondaki boşlukları siler"],
  ["UPPER", "UPPER(<metin>)", "Büyük harfe çevirir"],
  ["LOWER", "LOWER(<metin>)", "Küçük harfe çevirir"],
  ["CONCATENATE", "CONCATENATE(<metin1>, <metin2>)", "Metinleri birleştirir"],
  ["USERPRINCIPALNAME", "USERPRINCIPALNAME()", "Oturum açan kullanıcının e-postası (RLS)"],
];

const quoteTable = (t: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? t : `'${t.replace(/'/g, "''")}'`);

/** Otomatik tamamlama o an açık modeli kullanır (formül çubuğu günceller). */
let currentModel: ModelDefinition | null = null;
export function setCompletionModel(m: ModelDefinition | null) {
  currentModel = m;
}

let registered = false;
export function registerDaxCompletion() {
  if (registered) return;
  registered = true;
  monaco.languages.registerCompletionItemProvider("msdax", {
    triggerCharacters: ["[", "'", "("],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      // "[" ya da "Tablo[" yazılıyorsa köşeli parantezden itibaren değiştir
      const open = before.lastIndexOf("[");
      const inBracket = open >= 0 && before.indexOf("]", open) === -1;
      const range = inBracket
        ? new monaco.Range(position.lineNumber, open + 1, position.lineNumber, position.column)
        : new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const K = monaco.languages.CompletionItemKind;
      const items: monaco.languages.CompletionItem[] = [];
      const tables = currentModel?.tablolar ?? [];
      const prefixTable = inBracket ? before.slice(0, open).match(/('?)([^'[\s(,]+)\1\s*$/)?.[2] : undefined;
      for (const t of tables) {
        if (!inBracket) {
          items.push({ label: t.ad, kind: K.Struct, insertText: quoteTable(t.ad), range, detail: "Tablo" });
        }
        for (const c of t.sutunlar) {
          if (prefixTable && prefixTable.toLowerCase() !== t.ad.toLowerCase()) continue;
          const full = `${quoteTable(t.ad)}[${c.ad}]`;
          items.push({
            label: inBracket && prefixTable ? `[${c.ad}]` : full,
            kind: K.Field,
            insertText: inBracket && prefixTable ? `[${c.ad}]` : full,
            filterText: inBracket ? `[${c.ad}` : full,
            range,
            detail: `${t.ad} sütunu · ${c.tip}`,
          });
        }
        if (!prefixTable) {
          for (const m of t.olculer) {
            items.push({
              label: `[${m.ad}]`, kind: K.Function, insertText: `[${m.ad}]`, filterText: `[${m.ad}`, range,
              detail: `Ölçü (${t.ad})`, documentation: m.ifade,
            });
          }
        }
      }
      if (!inBracket) {
        for (const [name, sig, doc] of DAX_FUNCTIONS) {
          items.push({
            label: name, kind: K.Method, insertText: `${name}(`, range, detail: sig, documentation: doc,
          });
        }
      }
      return { suggestions: items };
    },
  });
}
