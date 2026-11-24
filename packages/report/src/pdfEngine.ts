import pdfMake from "pdfmake/build/pdfmake";
import regular from "./fonts/Roboto-Regular.ttf?inline";
import medium from "./fonts/Roboto-Medium.ttf?inline";

// Roboto v2.138 (Apache-2.0), tablo ve belge çıktıları aynı Türkçe fontu kullanır.
pdfMake.addVirtualFileSystem({
  "Floem-Regular.ttf": regular.split(",")[1],
  "Floem-Medium.ttf": medium.split(",")[1],
});
pdfMake.addFonts({ Floem: { normal: "Floem-Regular.ttf", bold: "Floem-Medium.ttf", italics: "Floem-Regular.ttf", bolditalics: "Floem-Medium.ttf" } });
export default pdfMake;
