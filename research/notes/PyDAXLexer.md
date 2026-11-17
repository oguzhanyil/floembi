# PyDAXLexer
- URL: https://github.com/jurgenfolz/PyDAXLexer
- Lisans: MIT (doğrulandı: kök `LICENSE`, "Copyright (c) 2024 Klaus Jürgen Folz"; `pyproject.toml` classifier `License :: OSI Approved :: MIT License`). `find . -iname "LICENSE*"` yalnızca kök `LICENSE` dosyasını buluyor.
- Dil: Python (>=3.10), ANTLR 4.13.2 ile üretilmiş lexer. PyPI paketi `PyDAXLexer` 0.3.1 (import adı `PyDAX`)
- Son commit tarihi: 2026-10-15

### Lisans zinciri
| Parça | Kaynak | Lisans | Durum |
|---|---|---|---|
| `src/PyDAX/PyDAXLexer.g4` | TabularEditor `AntlrGrammars/DAXLexer.g4` (README "Acknowledgments") | MIT (TabularEditor kök `LICENSE`, "Copyright (c) 2025 Tabular Editor ApS", yerel klonumuzda doğrulandı) | Uyumlu, MIT atıf notu korunmalı |
| `src/PyDAX/PyDAXLexer.py` | ANTLR'nin ürettiği kod (`# Generated from src/PyDAX/PyDAXLexer.g4 by ANTLR 4.13.2`) | Gramerin lisansını izler (MIT) | Uyumlu |
| `antlr4-python3-runtime==4.13.2` (`requirements.txt`) | ANTLR runtime | BSD-3-Clause (PyPI: "BSD") | Uyumlu |
| `antlr-4.13.2-complete.jar` (repo kökünde commit'lenmiş) | ANTLR tool | BSD-3 (+ gömülü yardımcı kütüphaneler) | Yalnızca build aracı; dağıtıma koymayın |
| Best practice kural metinleri (`best_practices_rules/*.py` `rule_metadata`) | Microsoft/Tabular Editor BPA kural setinden uyarlanmış görünüyor (ID'ler ör. `USE_THE_DIVIDE_FUNCTION_FOR_DIVISION`) | Kaynak açıkça belirtilmemiş | Metin kopyalamadan önce kaynak doğrulanmalı |

Sonuç: Lisans zinciri temiz (MIT + BSD-3).

## Ne yapıyor (3-5 cümle)
Tabular Editor'ün ANTLR DAX lexer gramerini Python hedefine taşıyan ve üstüne küçük bir analiz katmanı ekleyen bir paket. `DAXExpression` sınıfı bir DAX ifadesini token'lara ayırıyor; yorumları çıkarıyor/siliyor, `'Tablo'[Kolon]` ve `[Ölçü]` referanslarını, `VAR` değişkenlerini, `USERELATIONSHIP` ilişki referanslarını ve UDF benzeri çağrıları topluyor. Token akışı üzerinde 8 adet "best practice" kuralı (DIVIDE kullan, IFERROR'dan kaçın, INTERSECT yerine TREATAS, kullanılmayan değişken vb.) çalıştırıyor. Sözdizimi renklendirmeli ve ihlal vurgulu HTML çıktısı üretebiliyor. **Parser yok:** gramer `lexer grammar`; AST/parse tree üretilmiyor.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
```
src/PyDAX/
  PyDAXLexer.g4          512 satır, lexer grameri (TE DAXLexer.g4 kopyası, sadece action kodu Python'a çevrilmiş)
  PyDAXLexer.py          ANTLR 4.13.2 üretimi lexer (2788 satır)
  PyDAXLexer.tokens/.interp  ANTLR artefaktları
  .antlr/                VS Code ANTLR eklentisinin ürettiği Java dosyaları (gereksiz artefakt)
  DAXExpression.py       Ana API: lexer kurulumu, yorum çıkarma, referans çıkarma, kural çalıştırma, HTML
  DAXReference.py        DAXArtifactReference(table_name, artifact_name), DAXTableReference, DAXVariableReference, DAXFunctionReference, DAXRelationshipReference
  DAXToken.py, DAXVariable.py  Token/değişken sarmalayıcıları
  best_practices_rules/  BestPracticeRule tabanı + 8 kural
tests/                   16 pytest dosyası
resources/               Örnek DAX ifadeleri (~100 ölçü/kolon .txt), kural ihlali örnekleri
dist/                    Commit'lenmiş eski wheel/sdist'ler
```
Veri akışı: `DAXExpression(str)` → `InputStream` → `PyDAXLexer` (hata dinleyicileri kaldırılmış) → token akışı 3 kanala ayrılıyor (`DEFAULT`, `COMMENTS_CHANNEL`, `KEYWORD_CHANNEL`; boşluk `HIDDEN`) → `extract_references()` token dizisinde basit desen eşleme (`TABLE|TABLE_OR_VARIABLE` + opsiyonel `(` + `COLUMN_OR_MEASURE`) → kurallar her biri `lexer.reset()` ile token'ları baştan tarıyor.

## Floem BI için kritik kısımlar
- `src/PyDAX/PyDAXLexer.g4` → DAX token seti (392 fonksiyon/anahtar kelime token'ı + literaller + operatörler) → Floem DAX lexer'ının başlangıç token listesi. Ancak TabularEditor'deki orijinal `DAXLexer.g4` ile **birebir aynı** (diff sonucu: yalnızca gramer adı ve 4 satırlık `{Text = ...}` C# action'ı → `{self.text = ...}` Python). Yani doğrudan kaynak TabularEditor olmalı.
- Kanal tasarımı: `channels { COMMENTS_CHANNEL, KEYWORD_CHANNEL }` → Fonksiyon adları ayrı kanalda; parser'a girerken bu kanal ayrımı kaldırılmalı veya fonksiyon adları ayrı token tipi olarak ele alınmalı.
- Literal action'ları: `TABLE: '\'' ... '\'' {self.text = self.text[1:-1].replace("''","'");}`, `COLUMN_OR_MEASURE: '[' ... ']' {... .replace("]]","]")}`, `DATE_LITERAL: 'DT"' ...` → Floem DAX lexer'ında kaçış kuralları için birebir örnek.
- `DAXExpression.extract_references()` → Ölçü bağımlılık grafiği (hangi ölçü hangi kolon/ölçüyü kullanıyor) → Floem'de ölçü bağımlılık analizi, "kullanılmayan kolon/ölçü" tespiti, geçiş aracında eksik referans kontrolü.
- `best_practices_rules/` → Floem model editöründe "lint" / öneri motoru fikri.
- `generate_html_with_violations()` → editörde sözdizimi renklendirme + ihlal vurgusu (Floem UI'da Monaco/CodeMirror ile yapılmalı).

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Semantik model yok. Yalnızca tek bir DAX ifadesinin referans listesi tutuluyor:
```python
class DAXArtifactReference:
    def __init__(self, table_name: str, artifact_name: str, artifact_token: Token, table_token: Token = None):
        ...
    def __str__(self):
        return f"'{self.table_name}'[{self.artifact_name}]"
```
Tabla adı olmayan `[X]` referansları `table_name=''` ile tutuluyor; kolon mu ölçü mü olduğu ayırt edilmiyor (bunun için model metadata'sı gerekir, ör. pbixray çıktısı).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Yok. Lexer seviyesinde kalıyor; parse tree, AST, tip denetimi veya SQL üretimi bulunmuyor.

## Alınacak fikirler
- ANTLR lexer'ında kanal kullanımı: yorumları ayrı kanalda tutmak → yorum korumalı formatter ve "yorumları çıkar" özelliği ucuza geliyor.
- Token tabanlı lint kuralları (`BestPracticeRule` tabanı: `id, name, severity, category, verify_violation(lexer)`, `violators_tokens`, `highlight_tokens`) → Floem DAX için kural motoru arayüzü. Ancak Floem'de kurallar AST üzerinde yazılmalı.
- Örnek DAX korpusu (`resources/sample_dax_expressions/`, ~100 gerçek ölçü) → Floem DAX parser'ı için ek regresyon testi girdisi (MIT, kullanılabilir).
- Referans çıkarma + `USERELATIONSHIP` tespiti → geçişte ilişki bağımlılıklarını raporlama.

## Kaçınılacaklar / zayıf yönler
- **Parser yok.** Floem DAX için gereken parse tree/AST, operatör önceliği, `VAR/RETURN` kapsamı, `DEFINE/EVALUATE` sorgu yapısı hiçbiri yok. Referans çıkarma desen eşlemeyle yapılıyor (ör. `FILTER(` sonrası her `(` atlanıyor), karmaşık ifadelerde yanlış pozitif/negatif üretebilir.
- **Büyük/küçük harf duyarsızlığı eksik:** Gramerdeki not "Must use DAXCharStream as input, to make the lexer case-insensitive" diyor, ama `DAXExpression.__init__` düz `InputStream(dax_expression)` kullanıyor ve gramerde `options { caseInsensitive = true; }` yok. Sonuç: `sum(...)` (örnek: `resources/sample_dax_expressions/measure__Measures_Population by Age Group 2.txt`) `SUM` token'ı değil `TABLE_OR_VARIABLE` olarak lekslenir ve `function_references` (UDF) listesine düşer. `VAR` için `tok.text.upper() == 'VAR'` ile yama yapılmış (`DAXExpression.py:243`), genel çözüm yok. (Kod okumasıyla tespit; çalıştırılarak doğrulanmadı.)
- Token seti güncel değil: `MATCHBY`, `RUNNINGSUM`, `MOVINGAVERAGE` (visual calculations), `NETWORKDAYS`, `LINEST`, `TOCSV`, `INFO.*`, `DEFINE` içinde `MEASURE`/`COLUMN`/`FUNCTION` anahtar kelimeleri yok. (`WINDOW`, `OFFSET`, `INDEX`, `ORDERBY`, `PARTITIONBY`, `RANK`, `ROWNUMBER`, `EVALUATEANDLOG` var.) Bilinmeyen fonksiyonlar `TABLE_OR_VARIABLE` olarak düşüyor; bu bir bakıma toleranslı ama tip bilgisi kayboluyor.
- Fonksiyonların her biri ayrı token tipi (392 tip): parser'ı şişirir. Floem DAX'ta fonksiyon adlarını tek `IDENTIFIER` + fonksiyon kataloğu (ad → imza, dönüş tipi, SQL derleyici) olarak tutmak daha iyi.
- `REAL_LITERAL: [0-9]* '.' [0-9]+` → bilimsel gösterim (`1e5`) yok; tanımlayıcılar yalnız ASCII (`UnicodeClassLU` = `A-Z`), Türkçe karakterli tablo adları tırnaksız kullanılamaz (DAX'ta zaten tırnak gerekir, sorun değil). Liste ayırıcı `;` (bölgesel ayar) desteklenmiyor.
- Hata dinleyicileri kaldırılmış (`removeErrorListeners()`): hatalı ifade sessizce geçiyor; editörde hata gösterimi için uygun değil.
- Repo hijyeni: `dist/` altında wheel'ler, `antlr-4.13.2-complete.jar`, `.antlr/` Java artefaktları commit'li; `NOTES.md` içinde PyPI token şablonu.
- Ürettiği şey Python; Floem DAX parser'ı farklı bir dilde (TypeScript/Rust/Java) yazılacaksa kodun kendisinin değeri sınırlı, değer gramerde ve o da TabularEditor'de zaten var.

## Kullanım kararı: Fikir al
Gramer TabularEditor `DAXLexer.g4`'ün birebir kopyası olduğundan Floem DAX lexer'ı için doğrudan TabularEditor gramerini (MIT) kaynak alın; PyDAXLexer'ı bağımlılık veya fork olarak almayın. Alınacaklar: kanal tasarımı, BPA tarzı lint kuralı arayüzü, referans çıkarma fikri ve `resources/` altındaki örnek DAX korpusu (test verisi olarak, MIT atfıyla). Gerçek parser (AST) için `pbi_parsers` ve kendi gramerimiz değerlendirilmeli.
