# TabularEditor (Tabular Editor 2.x)
- URL: https://github.com/TabularEditor/TabularEditor
- Lisans: **MIT** (doğrulandı). Kök `LICENSE`: "MIT License — Copyright (c) 2025 Tabular Editor ApS". Kurulum EULA'sı `TabularEditor-license.rtf` da aynı MIT metnini içeriyor.
  - Alt lisanslar (`find . -iname "LICENSE*"` + kökteki `license-*.txt`):
    - `license-FastColoredTextbox.txt` → **LGPL-3.0** (WinForms kod editörü bileşeni; Floem BI'a alınamaz, zaten UI'a özgü).
    - `license-TreeViewAdv.txt` → BSD (WinForms ağaç kontrolü; işimize yaramaz).
    - `license-FastWildcardMatching.txt` → MIT.
    - `TOMWrapper/TextServices/DAXCharStream.cs` → başlıkta ANTLR Project BSD-3 notu (case-insensitive char stream örneğinden türetilmiş).
    - `TabularEditor/UIServices/DaxFormatter.cs` → başlıkta "Parts of this code has been copied from the DAX Studio source code" notu var; DAX Studio Ms-RL lisanslıdır → **bu dosyaya dokunma**. Ayrıca harici `https://api.daxformatter.com` servisini çağırır.
  - **Microsoft AMO/TOM DLL'leri MIT DEĞİL**: `TOMWrapper/packages.config` → `Microsoft.AnalysisServices` 19.117.0 NuGet paketi (Microsoft'un kendi lisansı, kapalı kaynak, AS/Power BI ile kullanım amaçlı). TOMWrapper'ın tamamı bu DLL'i sarmalar (`using TOM = Microsoft.AnalysisServices.Tabular;`), TMDL serileştirme de `Microsoft.AnalysisServices.Tabular.Tmdl` üzerinden. Dolayısıyla TOMWrapper kodu MIT olsa bile **çalışmak için Microsoft DLL'ine bağımlıdır; Floem BI'a ne DLL ne de bu DLL'e bağlı kod alınabilir.**
- Dil: C# (.NET Framework 4.8, WinForms), ANTLR 4.6.6 (`Antlr4.Runtime`, BSD-3), T4 kod üretimi
- Son commit tarihi: **2026-09-11** (`git log -1 --format=%cs`); README'deki son sürüm 2.27.2 (2025-09-29). TE2 bakım modunda, ticari geliştirme TE3'te (kapalı kaynak).

## Ne yapıyor (3-5 cümle)
Tabular Editor 2, Analysis Services Tabular / Power BI (XMLA) semantik modellerini (Model.bim JSON, klasör-bölünmüş JSON, TMDL) çevrimdışı düzenlemeye yarayan bir masaüstü aracıdır. Microsoft'un TOM (Tabular Object Model) nesnelerini kendi "wrapper" sınıflarıyla sarar; bu sarmalayıcılar undo/redo, property grid, perspektif/çeviri/RLS/OLS indeksleyicileri ve DAX bağımlılık takibi ekler. DAX için yalnızca bir **ANTLR lexer** grameri vardır (parser grameri yok); bağımlılık analizi, yeniden adlandırmada formül düzeltme (formula fixup), syntax highlighting ve IntelliSense bu token akışı üzerinde sezgisel olarak yapılır. Ayrıca Best Practice Analyzer (Dynamic LINQ kuralları) ve C# scripting içerir. Sorgu çalıştırma / SQL üretimi yoktur; hesaplama tamamen AS motoruna (VertiPaq) bırakılır.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `AntlrGrammars/` | `DAXLexer.g4` (512 satır, ~392 keyword kuralı) ve `CSharpLexer.g4` (scripting için). Build sırasında `Antlr4.CodeGenerator` ile C# lexer üretilir. **`DAXParser.g4` yok.** |
| `TOMWrapper/TOMWrapper/Base/` | `WrapperBase.tt` (T4 şablonu, TOM DLL'ini reflection ile okuyup sarmalayıcı üretir) → `WrapperBase.generated.cs` (20.160 satır; Table, Column, Measure, Relationship, ModelRole, Hierarchy, Level, Perspective, CalculationGroup, CalculationItem, KPI, Partition, Function, Calendar... için property'ler). `Rules.ttinclude` hangi TOM tiplerinin/özelliklerinin sarmalanacağını belirler. |
| `TOMWrapper/TOMWrapper/*.cs` | Elle yazılmış partial sınıflar: `Measure.cs`, `Column.cs`, `Table.cs`, `CalculationGroupTable.cs`, `ModelRole.cs`, `TablePermission.cs`, `SingleColumnRelationship.cs`, `TabularModelHandler*.cs` (model yükleme/kaydetme/deploy, BeginUpdate/EndUpdate batch'leri). |
| `TOMWrapper/TOMWrapper/Indexers/` | `PerspectiveIndexer`, `TranslationIndexer`, `RoleRLSIndexer`/`TableRLSIndexer` (rol × tablo → DAX filtre), `RoleOLSIndexer`/`ColumnOLSIndexer` (rol × tablo/kolon → MetadataPermission). |
| `TOMWrapper/Utils/` | `FormulaFixup.cs` (bağımlılık ağacı kurma + rename düzeltme), `DependencyList.cs` (`DependsOnList`, `ReferencedByList`), `DaxDependencyHelper.cs` (nesne başına hangi DAX property'leri var), `DaxToken.cs` (token listesi + Prev/Next), `TabularDeployer.cs`. |
| `TOMWrapper/TextServices/` | `DAXCharStream.cs` (büyük harfe çeviren char stream → case-insensitive lexing; ayrıca non-US `;`→`,` dönüşümü), `DAXLexerExtensions.cs` (`GetDefaultTokens`). |
| `TOMWrapper/TOMWrapper/Serialization/` | `Serializer.cs`, `SplitModelSerializer.cs` (modeli nesne başına JSON dosyalarına böler — git dostu), perspektif/çeviri/ilişki annotation serileştiricileri. |
| `TOMWrapper/UndoFramework/` | Undo/redo komutları (`UndoPropertyChangedAction` vb.). |
| `TabularEditor/` | WinForms UI, `BestPracticeAnalyzer/` (`BestPracticeRule.cs`: ID, Name, Category, Severity, Scope, Expression (Dynamic LINQ), FixExpression), `Scripting/` (Roslyn C# script), `UI/Dialogs/DependencyForm.cs` (bağımlılık ağacı görüntüleyici). |
| `TOMWrapperTest/`, `TabularEditorTest/` | Birim testleri (`FixUpTests.cs` rename düzeltme testleri). |

Veri akışı: `.bim/JSON/TMDL` veya XMLA bağlantısı → Microsoft TOM `Database` → `TabularModelHandler` her TOM nesnesi için wrapper oluşturur → `FormulaFixup.BuildDependencyTree()` tüm DAX ifadelerini tokenize edip `DependsOn`/`ReferencedBy` grafiğini kurar → kullanıcı düzenler (undo kayıtları + rename'de `DoFixup`) → `Serializer` ile JSON/TMDL'e yazılır veya `TabularDeployer` ile XMLA üzerinden sunucuya deploy edilir. Doğrulama (DAX hataları) sunucudan gelen `ErrorMessage` alanıyla yapılır; TE2'nin kendi semantik doğrulayıcısı yoktur.

## Floem BI için kritik kısımlar
- `AntlrGrammars/DAXLexer.g4` → DAX tokenizer: kanallar (`COMMENTS_CHANNEL`, `KEYWORD_CHANNEL`, `HIDDEN`), ~392 fonksiyon/anahtar kelime, literal ve referans token'ları → Floem BI ölçü dilinin **lexer'ına referans** (keyword listesi, `'Tablo'` / `[Kolon]` / `DT"..."` literal kuralları, kaçış kuralları `''` ve `]]`). Kod olarak MIT; doğrudan port edilebilir ama gramer stili (her fonksiyon ayrı token) parser için uygun değil (bkz. zayıf yönler).
- `TOMWrapper/TextServices/DAXCharStream.cs` → case-insensitive lexing + yerel ayar (`;` ayraç, `,` ondalık) normalizasyonu → Floem BI'da Türkçe yerel ayarlı formül girişi (TR'de `;` ayraç) için aynı fikir.
- `TOMWrapper/Utils/FormulaFixup.cs` → token tabanlı referans çözümleme, bağımlılık grafiği kurma, rename sonrası formülleri yeniden yazma → Floem BI'da **ölçü bağımlılık grafiği + refactor (yeniden adlandırma) servisi**.
- `TOMWrapper/Utils/DependencyList.cs` → `DependsOnList` (nesne → referans listesi, karakter aralıklarıyla), `ReferencedByList`, `Deep()` geçişli kapanış, `AnyVisible` (ölü kod tespiti) → Floem BI'da lineage/impact analizi ve "kullanılmayan ölçü/kolon" uyarısı.
- `TOMWrapper/Utils/DaxDependencyHelper.cs` → nesne tipi başına DAX taşıyan property'lerin listesi (`Expression`, `FormatStringExpression`, `DetailRowsExpression`, KPI `Status/Target/TrendExpression`, RLS `FilterExpression`, calc group `NoSelectionExpression` ...) → Floem BI şemasında "ifade taşıyan alanlar" kataloğu.
- `TOMWrapper/TOMWrapper/Base/WrapperBase.generated.cs` + elle yazılmış partial'lar → nesne property listeleri → **Floem BI semantik model şemasının temel alan listesi** (aşağıda).
- `TOMWrapper/TOMWrapper/Indexers/RoleRLSIndexer.cs`, `TableRLSIndexer.cs`, `ColumnOLSIndexer.cs` → RLS/OLS'nin rol×tablo ve rol×kolon matrisi olarak modellenmesi → Floem BI rol editörü (matris UI) ve şema.
- `TOMWrapper/TOMWrapper/Indexers/PerspectiveIndexer.cs` → `obj.InPerspective["Satış"] = true` deseni → Floem BI'da perspektif = nesne alt kümesi (rapor yazarına gösterilecek görünüm).
- `TOMWrapper/TOMWrapper/Serialization/SplitModelSerializer.cs` → modeli nesne başına dosyalara bölme → Floem BI modellerinin git'te diff'lenebilir saklanması.
- `TabularEditor/BestPracticeAnalyzer/BestPracticeRule.cs` → kural = (Scope, Expression, Severity, FixExpression) → Floem BI'da model lint kuralları (ör. "gizli olmayan kolonda SummarizeBy=Sum ve isim 'Id' ile bitiyorsa uyar").
- `TOMWrapper/TOMWrapper/TabularModelHandler.cs` + `UndoFramework/` → BeginUpdate/EndUpdate batch (bağımlılık yeniden kurmayı batch sonuna erteleme: `EoB_RequireRebuildDependencyTree`) ve undo → Floem BI model editöründe komut/undo yığını.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
TE2, TOM'un JSON (TMSL `Model.bim`) şemasını kullanır; wrapper sınıflardan çıkarılan gerçek property listeleri (generated + elle yazılmış partial'lar) aşağıdadır. Enum değerleri repoda kullanıldığı haliyle (TOM DLL'inde tanımlı).

**Model** — `Description, Culture, Collation, DefaultMode (Import/DirectQuery/Dual...), DefaultDataView, DiscourageImplicitMeasures, DiscourageReportMeasures, ForceUniqueNames, ValueFilterBehavior, SelectionExpressionBehavior, MaxParallelismPerQuery, DefaultMeasure` + koleksiyonlar `Tables, Relationships, Roles, Perspectives, Cultures, DataSources, Expressions (NamedExpression/M parametreleri), QueryGroups, Functions (DAX UDF)`.

**Table** — `Name, Description, DataCategory ("Time" = tarih tablosu), IsHidden, IsPrivate, ShowAsVariationsOnly, ExcludeFromModelRefresh, LineageTag, SourceLineageTag, SystemManaged, DefaultDetailRowsExpression (DAX)` + `Partitions, Columns, Measures, Hierarchies, Calendars, Sets`; artımlı yenileme politikası (`Table.cs`: `EnableRefreshPolicy, PolicyType, RollingWindowGranularity, RollingWindowPeriods, IncrementalGranularity, IncrementalPeriods, IncrementalPeriodsOffset, PollingExpression, SourceExpression, Mode`); türetilmiş `RowLevelSecurity[role]`, `ObjectLevelSecurity[role]`, `RelatedTables`, `UsedInRelationships`, `DependsOn/ReferencedBy` (calculated table için).
- Alt tipler: `CalculatedTable` (DAX `Expression`), `CalculationGroupTable`.

**Column** (abstract) — `Name, Description, DataType, IsDataTypeInferred, DataCategory, IsHidden, IsKey, IsUnique, IsNullable, Alignment, DisplayFolder, DisplayOrdinal, FormatString, SummarizeBy (AggregateFunction: None/Sum/Count/Min/Max/Average/DistinctCount/Default), SortByColumn, IsDefaultLabel, IsDefaultImage, TableDetailPosition, IsAvailableInMDX, KeepUniqueRows, EncodingHint, SourceProviderType, LineageTag, SourceLineageTag, Variations, AlternateOf (aggregation tablosu eşlemesi), GroupByColumns, ObjectLevelSecurity[role]` + türetilmiş `UsedInHierarchies, UsedInLevels, UsedInSortBy, UsedInRelationships, ReferencedBy`.
- `DataColumn`: `SourceColumn` (kaynak kolon adı).
- `CalculatedColumn`: `Expression` (DAX, satır bağlamı), `ExpressionContext`.
- `CalculatedTableColumn`: calculated table çıktısından.
- DAX kimliği: `DaxObjectName = "[Kolon]"`, `DaxObjectFullName = "'Tablo'[Kolon]"` (`Column.cs`).

**Measure** — `Name, Description, Expression (DAX), FormatString, FormatStringExpression (dinamik format, CL≥1601), DetailRowsExpression (drill-through DAX), DataType (salt okunur, motor çıkarır), IsHidden, IsSimpleMeasure, DisplayFolder, DataCategory, LineageTag, SourceLineageTag, KPI, Table (ev sahibi tablo)` + `DependsOn, ReferencedBy, ErrorMessage`. DAX kimliği tablo öneksiz: `DaxObjectFullName = "[Ölçü]"` (ölçü adları model genelinde benzersiz kabul edilir).

**KPI** — `Measure, TargetExpression, TargetFormatString, TargetDescription, StatusExpression, StatusGraphic, StatusDescription, TrendExpression, TrendGraphic, TrendDescription`.

**Relationship** (abstract) / **SingleColumnRelationship** — `Name (ID), IsActive, Type, FromTable, FromColumn, FromCardinality, ToTable, ToColumn, ToCardinality (RelationshipEndCardinality: None/One/Many), CrossFilteringBehavior (OneDirection/BothDirections/Automatic), SecurityFilteringBehavior (OneDirection/BothDirections/None — RLS filtresinin ilişki üzerinden yayılımı), JoinOnDateBehavior (DateAndTime/DatePartOnly), RelyOnReferentialIntegrity (DirectQuery'de INNER JOIN kullanımı)`. Not: yalnızca tek kolonlu ilişkiler var (`RelationshipCollection: TabularNamedObjectCollection<SingleColumnRelationship>`), "From" tarafı çok (many) tarafıdır.

**Hierarchy / Level** — Hierarchy: `Name, Description, IsHidden, DisplayFolder, HideMembers (ragged hiyerarşi), LineageTag, Levels`; Level: `Name, Ordinal, Column, Description, LineageTag`. Türetilmiş `Hierarchy.DaxObjectFullName`.

**ModelRole (RLS/OLS)** — `Name, Description, ModelPermission (None/Read/ReadRefresh/Refresh/Administrator), Members (ModelRoleMember: MemberName, MemberID; Windows/External alt tipleri), TablePermissions`, türetilmiş `RowLevelSecurity[table]` (DAX filtre), `MetadataPermission[table]` (OLS).
**TablePermission** — `Role, Table, FilterExpression (RLS DAX boolean ifadesi), MetadataPermission (Default/None/Read), ColumnPermissions[column]`, `NoEffect` (hiçbir kısıt yoksa true), `DependsOn` (RLS ifadesi de bağımlılık grafiğine girer).

**Perspective** — `Name, Description`; üyelik nesne tarafında indeksleyiciyle: `table.InPerspective[p]`, `column.InPerspective[p]`, `measure.InPerspective[p]`, `hierarchy.InPerspective[p]` (`Indexers/PerspectiveIndexer.cs`).

**CalculationGroup / CalculationItem** — CalculationGroup: `Precedence, Description, CalculationItems, MultipleOrEmptySelectionExpression, MultipleOrEmptySelectionFormatStringExpression, NoSelectionExpression, NoSelectionFormatStringExpression` (`CalculationGroup.cs`, `CalculationGroupTable.cs`); CalculationItem: `Name, Expression (SELECTEDMEASURE() kullanan DAX), FormatStringExpression, Ordinal, Description`.

**Diğer**: `Partition` (Mode, SourceType, QueryGroup, Query/M ifadesi, DataCoverageDefinition), `NamedExpression` (Kind, Expression, ...), `Function` (DAX UDF: Expression, IsHidden), `Calendar`/`CalendarColumnGroup`/`TimeUnitColumnAssociation` (yeni takvim tabanlı zaman zekâsı), `Culture` (çeviriler), `Variation` (otomatik tarih hiyerarşisi bağlama).

Örnek (Floem BI şeması için önerilen sadeleştirilmiş JSON — TE2/TOM alanlarından türetilmiştir, uydurma alan eklenmemiştir):
```json
{
  "tables": [{
    "name": "Sales", "isHidden": false, "dataCategory": null,
    "columns": [
      {"name": "OrderDate", "type": "data", "sourceColumn": "DocDate", "dataType": "dateTime", "summarizeBy": "none"},
      {"name": "Amount", "type": "data", "sourceColumn": "LineTotal", "dataType": "decimal", "formatString": "#,0.00", "summarizeBy": "sum"},
      {"name": "Margin", "type": "calculated", "expression": "[Amount] - [Cost]"}
    ],
    "measures": [
      {"name": "Total Sales", "expression": "SUM('Sales'[Amount])", "formatString": "#,0", "displayFolder": "Base"},
      {"name": "Sales LY", "expression": "CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))"}
    ],
    "hierarchies": [{"name": "Calendar", "levels": [{"name": "Year", "ordinal": 0, "column": "Year"}]}]
  }],
  "relationships": [{
    "fromTable": "Sales", "fromColumn": "OrderDate", "fromCardinality": "many",
    "toTable": "Date", "toColumn": "Date", "toCardinality": "one",
    "crossFilteringBehavior": "oneDirection", "securityFilteringBehavior": "oneDirection",
    "isActive": true, "relyOnReferentialIntegrity": false
  }],
  "roles": [{
    "name": "Region North", "modelPermission": "read",
    "tablePermissions": [{"table": "Customer", "filterExpression": "[Region] = \"North\"", "metadataPermission": "default", "columnPermissions": {"CreditLimit": "none"}}]
  }],
  "perspectives": [{"name": "Satış", "members": ["Sales", "Sales[Total Sales]"]}]
}
```

### DAX grameri — gerçek örnekler (`AntlrGrammars/DAXLexer.g4`)
```antlr
lexer grammar DAXLexer;
channels { COMMENTS_CHANNEL, KEYWORD_CHANNEL }
SINGLE_LINE_COMMENT: ( '//' | '--' ) InputCharacter* -> channel(COMMENTS_CHANNEL);
CALCULATE:  'CALCULATE'  -> channel(KEYWORD_CHANNEL);
BETADIST:   'BETA.DIST'  -> channel(KEYWORD_CHANNEL);
ONEWAYRIGHTFILTERSLEFT: 'ONEWAY_RIGHTFILTERSLEFT' -> channel(KEYWORD_CHANNEL);
DATE_LITERAL:      'DT"' (~'"' | '""')* '"' {Text = Text.Substring(3, Text.Length - 4);};
STRING_LITERAL:    '"' (~'"' | '""')* '"' {Text = Text.Substring(1, Text.Length - 2);};
TABLE:             '\'' (~["\'\r\n\u0085  ] | '\'\'')* '\'' {...Replace("''","'");};
COLUMN_OR_MEASURE: '[' (~["\]\r\n\u0085  ] | ']]')* ']'   {...Replace("]]","]");};
TABLE_OR_VARIABLE: IdentifierOrKeyword;
OP_AND: '&&'; OP_OR: '||'; OP_NE: '<>'; LAMBDA: '=>'; COLON: ':';
```
- Literal grameri lexer'da: büyük harf literal + `DAXCharStream` ile case-insensitive (ANTLR'ın önerdiği yöntem).
- Lexer action'ları C#'a özgü (`{Text = ...}`) — başka hedef dile taşırken temizlenmeli.
- Fonksiyonlar, `VAR/RETURN/DEFINE/EVALUATE/ORDER BY/IN/NOT` dahil hepsi `KEYWORD_CHANNEL`'da; yani parser varsayılan kanalda bunları görmez. Bu tasarım tamamen highlighting ve sezgisel analiz içindir.
- `IdentifierStartCharacter` yalnızca ASCII `A-Z a-z _` — Türkçe karakterli çıplak tablo adları (`Satış`) `TABLE_OR_VARIABLE` olarak eşleşmez; tırnak (`'Satış'`) zorunlu.

### Bağımlılık analizi nasıl yapılıyor (`TOMWrapper/Utils/FormulaFixup.cs`)
1. `BuildDependencyTree()` modeldeki tüm `IDaxDependantObject`'leri dolaşır: tablo çocukları (measure, calculated column, KPI), calculated table'lar, calculation item'lar, partition data coverage, DAX UDF'ler, rol `TablePermission`'ları.
2. Her nesne için `GetDAXProperties()` ile DAX taşıyan property'ler alınır (ör. Measure → `Expression`, `FormatStringExpression`, `DetailRowsExpression`).
3. `ParseExpression`: `\r` silinir, `DAXLexer` + `GetDefaultTokens()` (default + keyword kanal; yorum/boşluk hariç) ile token listesi alınır ve **tek geçişli sezgisel tarama** yapılır:
   - `TABLE` / `TABLE_OR_VARIABLE` / (arkasında `(` olmayan keyword) → tablo referansı adayı. Arkasında `(` varsa fonksiyon çağrısı; `Model.Functions` içinde varsa UDF bağımlılığı. Arkasında `COLUMN_OR_MEASURE` varsa `lastTableRef` olarak saklanır (tam nitelikli `'T'[C]`). `Model.FindTableOrCalendar` ile eşleşirse tablo/takvim bağımlılığı eklenir.
   - `COLUMN_OR_MEASURE`: önceki token tablo ise o tablonun `Columns` sonra `Measures` koleksiyonunda aranır. Değilse önce ifadenin kendi tablosundaki kolon, sonra kendi tablosundaki ölçü, sonra **tüm tablolardaki ilk eşleşen ölçü** aranır.
4. Her bağımlılık `DependsOnList.Add(obj, property, fromChar, toChar, fullyQualified)` ile karakter aralığıyla kaydedilir; karşı tarafa `ReferencedBy` eklenir (`AddDep`).
5. Yeniden adlandırmada `FormulaFixup.DoFixup(obj)` → her referans veren için `DependsOnList.UpdateRef` saklanan karakter aralıklarını yeni `DaxObjectName`/`DaxObjectFullName` ile değiştirerek ifadeyi yeniden yazar (`fullyQualified` bilgisi korunur).
6. `DependsOnList.Deep()` / `ReferencedByList.Deep()` HashSet ile geçişli kapanış (döngüye karşı güvenli); `ReferencedByList.AnyVisible` ölü kod tespiti için. Döngüsel bağımlılık yalnızca UI'da (`UI/Dialogs/DependencyForm.cs`) kök nesneye geri dönüşte "(circular dependency)" etiketi ile gösterilir; modelde engellenmez (AS motoru reddeder).
7. Toplu düzenlemelerde (`BeginUpdate/EndUpdate`) yeniden kurma batch sonuna ertelenir (`EoB_RequireRebuildDependencyTree`).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
**Yok.** TE2 bir model editörüdür; DAX'ı değerlendirmez, SQL'e çevirmez, sorgu planlamaz. DAX sorguları (TE3'te var) ya da ölçü sonuçları AS/Power BI motorunda çalışır. Partition'ların kaynak sorgusu (SQL/M) sadece metin olarak saklanır. Floem BI'ın DAX→SQL derleyicisi için buradan alınacak bir şey yoktur; bunun için `metricflow`, `pbi_parsers` (AST) ve `rill` notlarına bakılmalı.

## Alınacak fikirler
1. **Semantik model alan listesi**: Yukarıdaki Table/Column/Measure/Relationship/Role/Hierarchy/Perspective/CalculationGroup property'leri Floem BI şemasının iskeleti olarak kullanılabilir (özellikle `SummarizeBy`, `SortByColumn`, `DisplayFolder`, `FormatStringExpression`, `DetailRowsExpression`, `SecurityFilteringBehavior`, `RelyOnReferentialIntegrity`, `IsKey`, `DataCategory="Time"`, `LineageTag`).
2. **İfade-taşıyan alan kataloğu** (`DaxDependencyHelper.GetDAXProperties`): bağımlılık, rename ve validasyon tüm DAX alanlarını (RLS filtresi, format string ifadesi, KPI, calc group dahil) kapsamalı.
3. **Karakter aralıklı referans kaydı + rename fixup**: her referansı (property, from, to, fullyQualified) olarak saklayıp yeniden adlandırmada formülü yerinde yeniden yazmak; Floem BI'da AST tabanlı yapılmalı ama aynı veri yapısı (DependsOn/ReferencedBy + span) korunmalı.
4. **Çift yönlü grafik + `Deep()` + `AnyVisible`**: impact analizi ("bu kolonu silersem hangi ölçüler bozulur"), ölü ölçü tespiti, lineage UI.
5. **RLS/OLS matris modeli**: rol × tablo (DAX filtre) ve rol × kolon (None/Read) indeksleyicileri; `SecurityFilteringBehavior` ile RLS'nin ilişki üzerinden yayılımı ayrı bir ayar.
6. **Perspektif = nesne üzerinde boolean üyelik**; çeviriler için kültür × nesne × (Name/Description/DisplayFolder) indeksleyicisi.
7. **Case-insensitive + yerel ayar normalizasyonu** (`DAXCharStream`): TR kullanıcıları için `;` ayraçlı giriş, kanonik olarak `,` saklama.
8. **Best Practice Analyzer**: (Scope, koşul ifadesi, Severity, FixExpression) kural formatı; Floem BI'da model lint.
9. **Split serializer**: modeli nesne başına dosya olarak saklama → versiyon kontrolü ve diff.
10. **Batch + undo**: değişiklik komutları ve pahalı yeniden hesaplamaların batch sonuna ertelenmesi.
11. Lexer'daki DAX fonksiyon/keyword listesi, Floem BI dilinin kapsam planı için (hangi fonksiyonlar → hangi sırayla SQL'e derlenecek) kontrol listesi olarak kullanılabilir.

## Kaçınılacaklar / zayıf yönler
- **Parser yok**: yalnızca lexer var; AST, tip kontrolü, scope (VAR) çözümleme yok. Floem BI'da bu yaklaşım kopyalanmamalı; DAX→SQL için gerçek bir parser + AST + binder şart.
- **Sezgisel çözümleme hataları** (`FormulaFixup.ParseExpression`):
  - `VAR Sales = ...` gibi bir değişken adı bir tablo adıyla çakışırsa tablo bağımlılığı sanılır (scope yok).
  - `'X'[Y]` kalıbında `X` tablosu bulunamazsa `return;` ile **ifadenin geri kalanı hiç taranmaz** (sonraki referanslar kaçırılır); takvim (`Calendar`) tablo öneki bu dalda `Model.Tables`'ta aranmadığı için aynı sonuca yol açabilir.
  - Öneksiz `[Ad]` için önce kendi tablosunun kolonları aranır, sonra tüm modeldeki ilk ölçü — ölçü/kolon ad çakışmalarında belirsiz.
  - String literal içindeki referanslar doğru atlanır (lexer sayesinde), ancak dinamik/metin tabanlı referanslar (ör. `FORMAT` içinde kolon adı) görülmez.
- **Gramer tasarımı**: her fonksiyon ayrı token ve `KEYWORD_CHANNEL`'da → yeni fonksiyon eklemek gramer değişikliği gerektirir, parser yazmaya uygun değil. Floem BI'da fonksiyonlar tek `IDENTIFIER` + fonksiyon kataloğu (imza, dönüş tipi, bağlam davranışı) olarak modellenmeli.
- Lexer action'ları C# kodu içeriyor (`{Text = ...}`), hedef dilden bağımsız değil; ASCII dışı tanımlayıcı desteklemiyor.
- **Microsoft TOM bağımlılığı**: tüm wrapper katmanı `Microsoft.AnalysisServices` DLL'ini sarmalar ve T4 ile o DLL'den üretilir; wrapper kodu Floem BI'a taşınamaz (hem lisans hem mimari: Microsoft DLL'i olmadan çalışmaz). Sadece alan adları/kavramlar referans alınmalı.
- `TabularEditor/UIServices/DaxFormatter.cs`: DAX Studio'dan (Ms-RL) kopyalanmış parçalar + harici `api.daxformatter.com` çağrısı → kesinlikle kullanma (lisans + veri sızıntısı).
- FastColoredTextbox (LGPL-3) ve WinForms UI kodu → alınmaz.
- Global singleton (`TabularModelHandler.Singleton`) ve uyumluluk seviyesi (CompatibilityLevel 1200/1400/1601...) dallanmaları kodu karmaşıklaştırıyor; Floem BI tek sürümlü kendi şemasıyla başlamalı.
- Döngüsel bağımlılık modelde engellenmiyor; Floem BI'da kayıt anında topolojik sıralama ile reddedilmeli.

## Kullanım kararı: [Fikir al]
Kök lisans MIT, fakat kodun değerli kısmı (TOMWrapper) Microsoft'un MIT olmayan AMO/TOM DLL'ine sıkı bağlı ve .NET/WinForms tabanlı; Floem BI'ın Python yığınına bağımlılık ya da fork olarak uymaz. Alınacak olanlar: semantik model alan listesi (şema tasarımı), ifade-taşıyan alan kataloğu, DependsOn/ReferencedBy + karakter aralıklı referans + rename fixup tasarımı, RLS/OLS matris modeli, BPA kural formatı. `DAXLexer.g4` keyword listesi (MIT, atıf ile) Floem BI lexer'ı için başlangıç kontrol listesi olarak kullanılabilir, ama gramer yapısı birebir alınmamalı; AST üreten parser için `pbi_parsers` incelemesine bakılmalı.
