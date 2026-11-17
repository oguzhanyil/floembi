# pbi_parsers
- URL: https://github.com/douglassimonsen/pbi_parsers
- Lisans: **MIT**. Kök `LICENSE` dosyasından doğrulandı ("MIT License, Copyright (c) 2025 douglassimonsen"). `find . -iname "LICENSE*"` yalnızca kök `./LICENSE` dosyasını buldu; alt klasör lisansı yok. Çalışma zamanı bağımlılıkları: `colorama`, `jinja2` (ikisi de BSD-3); sadece `dax/utils.py` içindeki vurgulama (highlight) kodunda kullanılıyorlar.
- Dil: Python (>= 3.11), saf Python, harici parser üreteci kullanılmıyor. Sürüm `0.9.5` (`pbi_parsers/__init__.py`).
- Son commit tarihi: 2025-09-17 (`git log -1 --format=%cs`)
- Boyut: DAX tarafı (`pbi_parsers/dax/**`) 2.449 satır, tüm paket yaklaşık 5.500 satır, testler 701 satır (sadece DAX).

## Ne yapıyor (3-5 cümle)
DAX ve Power Query (M) için lexer, parser ve formatter sağlayan küçük bir Python kütüphanesi. README'ye göre "Crafting Interpreters" kitabı örnek alınmış. Amaç kodu çalıştırmak değil, kodu incelemek: ruff benzeri lint araçları, DAX lineage (ölçü/kolon bağımlılığı) çıkarımı ve M sorgularından kaynak tipini (Sql.Database, Excel.Workbook, Csv.Document...) bulma. Semantik analiz, tip sistemi, fonksiyon kataloğu ya da derleme/yürütme katmanı yok. Çıktı olarak somut alt sınıflardan oluşan bir AST (`Expression`) ve `pprint()` ile metin dökümü veriyor.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
```
pbi_parsers/
  base/lexer.py        BaseLexer: peek/match/advance; karakter tabanlı, elle yazılmış
  base/tokens.py       TextSlice(full_text,start,end) + BaseToken (çift yönlü bağlı liste, yerinde düzenleme)
  dax/tokens.py        TokenType enum (35 tür) + KEYWORD_MAPPING
  dax/lexer.py         Lexer.scan_helper: sıralı _match_* fonksiyonları
  dax/parser.py        Parser: token listesi + index + cache (consume/peek)
  dax/exprs/*.py       AST düğümleri; her sınıf kendi `match(parser)` metodunu taşır
  dax/exprs/__init__.py EXPRESSION_HIERARCHY = öncelik tablosu + any_expression_match()
  dax/exprs/_utils.py  @lexer_reset: geri sarma (backtracking) + memoization + yorum toplama
  dax/formatter.py     AST -> biçimlendirilmiş DAX metni
  dax/utils.py         highlight_section(): düğümün kaynaktaki yerini konsol/HTML olarak gösterir
  pq/...               Aynı desen M dili için (33 expr sınıfı)
  pq/misc/resolve      M'de değişken çözümleme + sabit katlama (constant folding)
  pq/misc/external_sources  M kodundan veri kaynağı (server/database/path) çıkarımı
```
Veri akışı (`dax/main.py`):
```python
def to_ast(text: str) -> Expression | None:
    tokens = Lexer(text).scan()
    tokens = remove_non_executing_tokens(tokens)   # WHITESPACE + yorumlar atılıyor
    parser = Parser(tokens)
    return parser.to_ast()
```
`format_expression(text)` = `to_ast` + `Formatter(ast).format()`.

### Parser tekniği
Ne ANTLR ne Pratt. **Geri sarmalı (backtracking) ve memoize edilmiş, öncelik tablolu bir recursive descent** kullanılıyor, yani bir çeşit packrat parser. Her AST sınıfında bir `@classmethod match(parser)` var. `any_expression_match(parser, skip_first)`, `EXPRESSION_HIERARCHY` demetini sırayla deniyor ve ilk eşleşeni döndürüyor:

```python
# pbi_parsers/dax/exprs/__init__.py
EXPRESSION_HIERARCHY = (
    InExpression, LogicalExpression, ComparisonExpression, ConcatenationExpression,
    AddSubExpression, DivMulExpression, ExponentExpression, AddSubUnaryExpression,
    ReturnExpression, VariableExpression, ParenthesesExpression, ArrayExpression,
    FunctionExpression, MeasureExpression, HierarchyExpression, ColumnExpression,
    KeywordExpression, IdentifierExpression, TableExpression,
    LiteralStringExpression, LiteralNumberExpression,
)
```
İkili operatörlerin hepsi aynı kalıpla yazılmış. Sol operand bir alt seviyeden (`skip_index + 1`), sağ operand aynı seviyeden (`skip_index`) okunuyor:
```python
# pbi_parsers/dax/exprs/add_sub.py
left_term = any_expression_match(parser=parser, skip_first=skip_index + 1)
operator = parser.consume()
...
right_term = any_expression_match(parser=parser, skip_first=skip_index)
```
Eşleşmeyen `match` çağrısında index'i geri alma ve yorum toplama işini `@lexer_reset` dekoratörü yapıyor (`dax/exprs/_utils.py`). Önbellek anahtarı `(idx, id(func))`. Yalnızca **başarılı** sonuçlar önbelleğe alınıyor (`if cached_val is not None`), başarısızlıklar her denemede yeniden hesaplanıyor.

### Token türleri (`dax/tokens.py`)
`AMPERSAND_OPERATOR, ASC, BRACKETED_IDENTIFIER, COMMA, COMPARISON_OPERATOR, DESC, DIVIDE_SIGN, DOUBLE_AMPERSAND_OPERATOR, DOUBLE_PIPE_OPERATOR, EOF, EQUAL_SIGN, EXPONENTIATION_SIGN, FALSE, IN, LEFT_CURLY_BRACE, LEFT_PAREN, MINUS_SIGN, MODULUS_SIGN, MULTIPLY_SIGN, MULTI_LINE_COMMENT, NOT_EQUAL_SIGN, NUMBER_LITERAL, PERIOD, PLUS_SIGN, RETURN, RIGHT_CURLY_BRACE, RIGHT_PAREN, SINGLE_LINE_COMMENT, SINGLE_QUOTED_IDENTIFIER, STRING_LITERAL, TRUE, UNQUOTED_IDENTIFIER, VARIABLE, WHITESPACE, UNKNOWN`.
Eksik olanlar: `NOT`, `DEFINE`, `EVALUATE`, `MEASURE`, `ORDER BY`, `TABLE`, `COLUMN`. `ASC`/`DESC` token olarak var ama parser bunları kullanmıyor. `MODULUS_SIGN` (`%`) üretiliyor ama hiçbir expression bu token'ı tüketmiyor.

### AST düğümleri (`dax/exprs/`)
| Sınıf | Alanlar | Örnek |
|---|---|---|
| `FunctionExpression` | `name_parts: list[Token]`, `args: list[Expression]`, `parens` | `CALCULATE(...)`, `func.name(...)` |
| `ColumnExpression` | `table: Token`, `column: Token` | `Sales[Amount]`, `'Sales Tbl'[Amount]` |
| `MeasureExpression` | `name: Token` | `[Total Sales]` (tablosuz kolon referansı da buraya düşüyor) |
| `HierarchyExpression` | `table, column, level` | `T[Date].[Year]` |
| `TableExpression` | `name: Token` | Pratikte sadece `'Quoted'` tablolar için |
| `IdentifierExpression` | `name: Token` | Değişken veya tırnaksız tablo adı (ikisi ayrılmıyor) |
| `VariableExpression` | `var_name: Token`, `statement` | `VAR x = 1` |
| `ReturnExpression` | `ret`, `variable_statements: list[VariableExpression]` | `VAR ... RETURN ...` |
| `AddSub/DivMul/Exponent/Comparison/Concatenation/Logical/InExpression` | `operator, left, right` | ikili operatörler |
| `AddSubUnaryExpression` | `operator, number` | `-x`, `+-+x` |
| `ArrayExpression` | `elements` | `{1, 2, 3}` |
| `ParenthesesExpression`, `KeywordExpression`, `LiteralString/NumberExpression`, `NoneExpression` (boş argüman) | | |

Ortak taban `Expression` (`dax/exprs/_base.py`): `children()`, `find()`, `find_all(cls, predicate)`, `position()`, `full_text()`, `pprint()`. Ziyaretçi (visitor) deseni yok. Formatter `type(expr)` ile bir dict üzerinden dağıtım yapıyor.

### Hata kurtarma
**Yok.** İlk hatada `ValueError` ya da `assert` fırlıyor ve kısmi AST dönmüyor, tanılama (diagnostic) listesi de yok. Örnekler:
- `ParenthesesExpression.match`: `assert right_paren.tok_type == TokenType.RIGHT_PAREN`
- `FunctionExpression.match`: `assert parser.consume().tok_type == TokenType.COMMA`
- `Parser.to_ast`: `assert self.peek().tok_type == TokenType.EOF`

`python -O` ile çalıştırıldığında bu `assert` satırları siliniyor, yani kontroller sessizce devre dışı kalıyor. Hata mesajları konum (satır/sütun) taşımıyor; `ValueError(f"Unexpected token sequence: {parser.peek()}, {parser.index}")` gibi token index'i veriyor. Konum bilgisinin altyapısı (`highlight_section`) aslında mevcut ama hata yolunda kullanılmıyor.

### Test kapsamı
- `tests/test_dax/test_exprs/` altında her expression için bir dosya var. Testler çoğunlukla **elle kurulmuş token listeleri** veriyor ve lexer'ı atlıyor. Örneğin `test_literal_number.py` içindeki `"-1.1e-2"` tek bir `NUMBER_LITERAL` token'ı olarak elle oluşturulmuş, gerçek lexer bu girdiyi bu şekilde tokenize etmiyor (aşağıya bakın).
- `test_lexer.py` 3 vaka içeriyor (`1 + 2`, `func({})`, `1.1e2`), `test_formatter/test_basic.py` 3 vaka.
- **M (pq) için hiç test yok.**
- İlişkilendirme (`1-2-3`), anahtar kelime sınırı, gerçek dünya ölçüleri ve hata yolları test edilmiyor. Coveralls rozeti var, ancak testler yapay token listeleri kullandığı için yüksek kapsam oranı yanıltıcı olabilir.

## Floem BI için kritik kısımlar
- `pbi_parsers/base/tokens.py` → `TextSlice` + bağlı liste token'lar; `replace/add_token_before/remove` ile kaynak metni yerinde düzenleme → Floem DAX editöründe **otomatik düzeltme / refactor** (ölçü yeniden adlandırma) için iyi bir fikir. Her düğüm `position()` döndürdüğü için hata işaretleme ve hover desteği kolaylaşıyor.
- `pbi_parsers/dax/exprs/_base.py` → `find_all(cls, predicate)` → Floem'de **lineage / bağımlılık grafiği** çıkarımı. Örnek: `ast.find_all(ColumnExpression)` ve `ast.find_all(MeasureExpression)` ile ölçünün dokunduğu kolonları ve ölçüleri bulmak.
- `pbi_parsers/dax/exprs/__init__.py` → öncelik tablosu ve yorum olarak eklenmiş Microsoft operatör önceliği listesi → Floem DAX gramerinde öncelik tablosu için başlangıç referansı. Not: yazar `&&`/`||` ve `IN` önceliğini "tahmin ettiğini" kendisi belirtiyor.
- `pbi_parsers/dax/exprs/keyword.py` → `TRUE()`/`FALSE()` hem anahtar kelime hem fonksiyon olarak ele alınıyor → Floem DAX'ta da desteklenmesi gereken bir DAX tuhaflığı.
- `pbi_parsers/dax/exprs/function.py` → `_match_function_name` noktalı fonksiyon adları (`func.name(`) → `PERCENTILE.INC`, `STDEV.P` gibi DAX fonksiyonları.
- `pbi_parsers/dax/utils.py` → `highlight_section(node).to_console()/to_html()` → Floem'de derleyici hata mesajlarında kaynak kodu satır numarası ve `^^^` ile işaretleme (rustc/ruff tarzı).
- `pbi_parsers/dax/formatter.py` → `MAX_ARGUMENT_LENGTH = 40` eşiğiyle argümanları satırlara bölme → Floem DAX editöründe "Format" butonu için basit bir referans (aşağıdaki hatalarla birlikte).
- `pbi_parsers/pq/misc/external_sources/` → M kodundan `Sql.Database(server, db)`, `Excel.Workbook`, `Csv.Document` gibi kaynakları çıkarma → **Power BI'dan Floem BI'a geçiş aracı** (pbixray ile birlikte): .pbix içindeki M sorgularından bağlantı tanımlarını otomatik oluşturma.
- `pbi_parsers/pq/misc/resolve/resolve.py` → M değişkenlerini çözüp sabitleri katlama (`add_sub_resolve`) → geçiş aracında parametreli kaynak yollarını çözmek için fikir.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
**Temsil edilmiyor.** Kütüphane yalnızca tek bir DAX ifadesini parse ediyor. Tablo, kolon, ilişki ya da ölçü kataloğu yok; `DEFINE MEASURE` veya `EVALUATE` sorgu sözdizimi de desteklenmiyor. Referanslar yalnızca sözdizimsel olarak ayrılıyor:
- `Tablo[Kolon]` → `ColumnExpression(table=Token, column=Token)`. Token metni köşeli parantez ve tırnaklarla birlikte saklanıyor; `utils.get_inner_text(tok)` bunları temizliyor.
- `[X]` → her zaman `MeasureExpression`. DAX'ta `[X]` satır bağlamında bir kolon da olabilir; bu ayrım semantik model olmadan yapılamaz.
- Tırnaksız `Sales` → `IdentifierExpression`, çünkü `IdentifierExpression` hiyerarşide `TableExpression`'dan önce geliyor. Değişken ile tablo adı ayrılmıyor.

Floem için çıkarım: AST'de sözdizimsel bir `BracketRef` düğümü olmalı ve bu düğüm **semantik bağlama (binding) aşamasında** model kataloğuna bakılarak `MeasureRef` / `ColumnRef` / `VarRef` / `TableRef` olarak çözülmeli.

Örnek AST çıktısı (testten, `tests/test_dax/test_exprs/test_variable.py`):
```
Variable (
    name: x,
    statement: Add (
                   left: Number (42),
                   right: Number (
                              sign: +,
                              number: Number (42),
                          )
               )
)
```

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
**Üretilmiyor.** SQL derleme, filtre bağlamı, CALCULATE semantiği veya yürütme yok; README "Designed to support code introspection and analysis, not execution" diyor. Floem'in DAX → DuckDB/T-SQL derleyicisi (binding, tip çıkarımı, filtre bağlamı cebiri, SQL IR, lehçe üretimi) tamamen ayrıca yazılmak zorunda. Bu repo en fazla ilk aşamanın, yani parse adımının yerini tutabilir.

## Alınacak fikirler
1. **Tam konum izleme:** Her token `TextSlice(full_text, start, end)` taşıyor, her düğüm `position()` döndürüyor. Floem AST'de her düğümde `Span` olmalı; hata mesajları, LSP hover ve go-to-definition bunun üzerine kurulur.
2. **`highlight_section` tarzı hata gösterimi:** satır numarası, bağlam satırları ve `^^^` ile işaretleme. Floem derleyici tanılamaları için doğrudan uygulanabilir.
3. **`find_all(cls, predicate)` sorgu API'si:** lineage, "bu ölçü hangi kolonlara dokunuyor" ve etki analizi (bir kolon silinirse hangi ölçüler bozulur) için basit ve etkili.
4. **Trivia'yı (boşluk/yorum) token akışında tutmak:** lexer `WHITESPACE` ve yorum token'larını kaybetmiyor. Floem'de yorumları koruyan bir formatter için gerekli, ancak bunları parser'a sokmak yerine Roslyn/rust-analyzer gibi token'a bağlı "leading/trailing trivia" olarak tutmak daha doğru.
5. **Kaynak metni token düzeyinde yerinde düzenleme** (`Token.replace`): rename refactor ve quick-fix için.
6. **DAX tuhaflıkları kontrol listesi:** `TRUE()`/`TRUE`, noktalı fonksiyon adları, `==` (katı eşitlik), `--` ve `//` yorumları, `""` kaçışlı string, hiyerarşi `T[C].[Level]`, boş argüman (`NoneExpression`, örneğin `FUNC(a,,b)`).
7. **M kaynak çıkarımı** (`pq/misc/external_sources`): geçiş aracı için fikir. İstenirse ayrı bir araçta MIT bağımlılığı olarak da kullanılabilir.

## Kaçınılacaklar / zayıf yönler
Kodu okuyarak tespit edilen somut hatalar (çalıştırılmadı, statik analiz):

1. **Sol ilişkilendirme hatası (anlam bozan):** Tüm ikili operatörlerde sağ operand aynı öncelik seviyesinden okunuyor (`skip_first=skip_index`). Bu yüzden `1 - 2 - 3` ifadesi `Sub(1, Sub(2, 3))` olarak parse ediliyor: sonuç 2 çıkar, doğrusu -4. `8 / 4 / 2` da `8/(4/2) = 4` olur, doğrusu 1. Formatter parantez basmadığı için `test_formatter/test_basic.py` içindeki `arg1 + 1 + 2 + 3` testi bu hatayı yakalamıyor. **Bu AST SQL'e derlenirse yanlış sayı üretir.**
2. **Lexer'da kelime sınırı kontrolü yok:** `_match_var`, `_match_return` ve `_match_keyword`, `UNQUOTED_IDENTIFIER`'dan önce ve sadece önek olarak eşleşiyor:
   ```python
   def _match_var(self, start_pos: int) -> Token | None:
       if self.match("var", case_insensitive=True):
   ```
   Bunun sonuçları:
   - `VAR.P(...)`, `VAR.S(...)`, `VARX.P(...)` gerçek DAX fonksiyonları olduğu halde `VARIABLE` + `.P` olarak tokenize ediliyor.
   - `Returns[Amount]` gibi bir tablo adı `RETURN` + `s` oluyor.
   - `Description[x]` → `DESC` + `ription`, `TrueValue` → `TRUE` + `Value`.
3. **`IN` sezgisel olarak yakalanıyor:** sadece `"in "` (arkasında boşluk varsa) eşleşiyor. `x IN{1,2}` veya satır sonunda biten `IN` tanınmıyor (kod yorumu: "I have found no case where 'in' is not followed by a space").
4. **`NOT` operatörü yok.** Öncelik yorumunda listelenmiş ama ne expression sınıfı ne token türü var, yani `NOT [Flag]` parse edilemiyor. `%` (mod) token'ı üretiliyor ama hiçbir yerde tüketilmiyor.
5. **Sayı literal'leri:** `1e-5` → `1e` (geçersiz) + `-` + `5` oluyor. `.5` önce `PERIOD` olarak eşleşiyor (`_match_period`, `_match_number_literal`'den önce geliyor). `1.2.3` ve `1e` de tek bir NUMBER olarak kabul ediliyor.
6. **Kaçış dizileri eksik:** `]]` (köşeli parantez içinde) ve `''` (tırnaklı tablo adında) desteklenmiyor.
7. **Formatter geçersiz DAX üretiyor:** `_format_variable` `VAR` anahtar kelimesini basmıyor:
   ```python
   def _format_variable(cls, expr: VariableExpression) -> str:
       return f"{expr.var_name.text} = {cls._format_helper(expr.statement)}"
   ```
   Bu yüzden `VAR x = 1 RETURN x` formatlanınca `x = 1\nRETURN x` çıkıyor.
8. **Formatter yorumları siliyor:** `main.to_ast` parse öncesinde yorumları atıyor (`remove_non_executing_tokens`). Bu yüzden `pre_comments`/`post_comments` pratikte hep boş kalıyor ve `format_expression` yorumları kaybediyor. Ayrıca bu iki alan sınıf seviyesinde paylaşılan mutable `list` (`pre_comments: list[Any] = []`).
9. **Tuple / tablo constructor desteği yok:** `{(1, "a"), (2, "b")}` parse edilemiyor, çünkü `ParenthesesExpression` tek ifade bekliyor ve ardından `assert RIGHT_PAREN` yapıyor. `f(a,)` gibi bir sondaki boş argüman da sessizce kayboluyor.
10. **DAX sorgu dili yok:** `DEFINE`, `MEASURE`, `EVALUATE`, `ORDER BY`, `VAR` blokları dışındaki üst düzey yapılar desteklenmiyor.
11. **Performans ve sağlamlık:** Başarısız eşleşmeler önbelleğe alınmıyor ve her öncelik seviyesi sol operandı yeniden deniyor. `consume()` sonra kontrol, sonra geri sarma deseni kullanılıyor. Lexer `match(lambda...)` ile karakter karakter ilerliyor ve her karakter için closure çağırıyor. Uzun ölçülerde yavaş kalır. `MAX_POSITION = 1_000_000` sert sınırı var.
12. **Hata kurtarma ve tanılama yok** (yukarıya bakın). Editörde kullanıcı yazarken anlık hata göstermek (LSP) için uygun değil.
13. **Kod kalitesi:** Okunabilir ve tip ipuçlu, ruff `ALL` kurallarıyla lint ediliyor. Ancak `pq/misc/external_sources/main.py` içinde üretim kodunda `breakpoint()` unutulmuş. 21 expression sınıfında `match/pprint/position` kodu büyük ölçüde kopyala-yapıştır. `Expression.find` istisnayı kontrol akışı için kullanıyor. Tek geliştirici, sürüm 0.x, son commit 2025-09.

### Fork edilebilirlik değerlendirmesi
- **Lehte:** MIT; küçük (DAX ~2.4k satır); bağımlılığı az; okunabilir.
- **Aleyhte:** Mimari kusurlar (ilişkilendirme, lexer sınırları, hata kurtarma eksikliği, hiyerarşi sıralamasına bağlı belirsizlik çözümü) tekil hatalar değil, **tasarımın kendisinden** geliyor. Bunları düzeltmek pratikte lexer'ı ve parser çekirdeğini (`any_expression_match` + `EXPRESSION_HIERARCHY` + `@lexer_reset`) yeniden yazmak demek, yani kodun büyük kısmı. Geriye korunabilecek olan yalnızca `TextSlice`/`Token` ve düğüm sınıflarının veri alanları kalıyor.
- Floem'in ihtiyaç duyduğu katmanlar (binding, tip sistemi, fonksiyon kataloğu, filtre bağlamı, SQL IR) zaten hiç yok. Bunlar parser'ın üzerine sıfırdan yazılacak ve AST tasarımını (örneğin `BracketRef` → `MeasureRef/ColumnRef` çözümlemesi, `Span`, trivia) belirleyecek.

## Kullanım kararı: Fikir al
**Floem DAX parser'ı sıfırdan yazılmalı, fork edilmemeli.** Gerekçe ve öneri:
1. Fork ile kazanılacak kod azdır: lexer ve parser çekirdeğinin yeniden yazılması gerekir, düğüm sınıfları da Floem'in semantik AST'sine uymaz. Fork etmek, üstüne Floem'e ait olmayan bir tasarımın borcunu da getirir.
2. Önerilen yaklaşım: elle yazılmış lexer (kelime sınırı ve maksimal munch kuralıyla, trivia token'lara bağlı olacak şekilde) ve ikili operatörler için **Pratt (precedence climbing) parser**. Bu yaklaşım sol ilişkilendirmeyi doğal olarak çözer ve backtracking gerektirmez. Bunun yanında `Span` taşıyan değişmez (immutable) AST düğümleri, `ERROR` düğümü ve senkronizasyon token'ları (`,` `)` `RETURN` `VAR`) ile hata kurtarma ve bir diagnostik listesi gerekir. Ardından ayrı bir binding aşaması gelmeli: `[X]` model kataloğuna bakılarak ölçü veya kolon olarak çözülmeli.
3. Bu repo test korpusu ve kontrol listesi olarak değerlidir: `tests/test_dax/` içindeki örnekler, yukarıdaki 13 maddelik hata listesi (Floem için negatif ve regresyon testleri olarak) ve `highlight_section`, `find_all`, `Token.replace` fikirleri. MIT olduğu için atıf vererek küçük parçalar (örneğin `TextSlice` yaklaşımı) alınabilir. Ancak yeniden yazmak, kopyalamaktan daha az iş çıkarır.
4. İsteğe bağlı bağımlılık olarak kullanım: Power BI → Floem geçiş aracında, .pbix'ten çıkan M sorgularından `Sql.Database`/`Excel.Workbook` kaynaklarını okumak için `pbi_parsers.pq.misc.external_sources.get_external_sources` MIT bağımlılığı olarak kullanılabilir. Bu yalnızca geliştirme ve geçiş aracı için geçerli, çekirdek ürün için değil.
5. Gramer referansı olarak bu repo yerine Tabular Editor'ün ANTLR DAX grameri (MIT) ve Microsoft DAX operatör dokümantasyonu esas alınmalı. pbi_parsers yazarı önceliklerin bir kısmını "tahmin ettiğini" kendisi belirtiyor.
