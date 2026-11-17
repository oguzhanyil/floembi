# Malloy
- URL: https://github.com/malloydata/malloy
- Lisans: MIT — **doğrulandı** (kök `LICENSE`: "Malloy Project License / SPDX-License-Identifier: MIT"; kaynak dosyalarda `SPDX-License-Identifier: MIT` başlığı). `find -iname "LICENSE*" -not -path "*/node_modules/*"` sonucu: kök `LICENSE` + `scripts/license_disclaimer.ts`, `scripts/utils/licenses.ts` (bunlar lisans dosyası değil, bağımlılık lisans raporu üreten scriptler). Alt klasör lisansı yok.
- Dil: TypeScript (npm workspaces + Lerna monorepo). Parser: ANTLR (`antlr4ts`, BSD), filtre dilleri: peggy. SQL Server sürücüsü: `mssql` (MIT).
- Son commit tarihi: 2026-11-16 (paket sürümü 0.0.439)

## Ne yapıyor (3-5 cümle)
Malloy, Looker/LookML'in kurucusunun başlattığı, hem semantik modelleme hem sorgu dili olan bir dildir; mevcut SQL motorlarında (DuckDB, Postgres, BigQuery, Snowflake, MySQL, Trino/Presto, Databricks ve **deneysel SQL Server**) çalışan SQL üretir. Bir `source` tabloya/SQL'e dimension, measure, join ve view eklenerek tanımlanır; join'ler sorguya değil modele aittir ve kardinaliteleri (`join_one`, `join_many`, `join_cross`) belirtilir. Fan-out problemini **symmetric aggregates** ile çözer: bir ölçü join'in "en yaprak" (leafiest) tarafında değilse SUM/AVG, satırın distinct key'inin hash'i ile `SUM(DISTINCT hash + value) - SUM(DISTINCT hash)` şeklinde hesaplanır. `nest:` ile iç içe (hiyerarşik) sonuçlar tek sorguda üretilir. Derleme iki aşamalıdır: translate (Malloy → serileştirilebilir IR) ve compile (IR → SQL).

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
`packages/`
- `malloy/src/lang/` — **Translator**: ANTLR grammar (`grammar/`), parse tree → AST (`malloy-to-ast.ts`, `ast/` altında `source-elements`, `source-properties`, `query-elements`, `view-elements`, `expressions`, `field-space`), AST → IR. Hata/uyarı `parse-log.ts`.
- `malloy/src/model/` — **Compiler**: IR tipleri `malloy_types.ts` (2.4k satır; `StructDef`, `SourceDef`, `JoinBase {join: 'one'|'many'|'cross', matrixOperation: 'left'|'right'|'full'|'inner', onExpression}`), `query_query.ts` (3.6k satır; asıl SQL üretimi, CTE/stage yönetimi, group_set fan-out'u ile nest), `expression_compiler.ts` (ifade → SQL, symmetric aggregate kararları), `query_node.ts` (`QueryStruct`, `getDistinctKey()`), `join_instance.ts` (join ağacı, `parentRelationship()`, `forceAllSymmetricCalculations()`), `field_instance.ts`, `filter_compilers.ts`, `stage_writer.ts`, `nest-capability.ts` (lehçe bazlı nest stratejisi).
- `malloy/src/dialect/` — **Lehçe katmanı**: soyut `Dialect` sınıfı (`dialect.ts`, 1.5k satır) + `duckdb/`, `postgres/`, `standardsql/` (BigQuery), `snowflake/`, `mysql/`, `trino/`, `databricks/`, `sqlserver/`. Her lehçe: tip eşlemesi, zaman fonksiyonları, `sqlSumDistinctHashedKey`, nest/array yetenek bayrakları, fonksiyon override'ları (`function_overrides.ts`, `dialect_functions.ts`). `dialect/shifty_sum_distinct.ts`: 38 haneli decimal motorlar için symmetric SUM.
- `malloy-db-*` — bağlantı (connection) paketleri: `malloy-db-duckdb`, `malloy-db-postgres`, `malloy-db-sqlserver` (`sqlserver_connection.ts`, `mssql` sürücüsü) vb.
- `malloy-interfaces` — dilden bağımsız, JSON serileştirilebilir **stable query API** (`types.ts`: `Query`, `ViewOperation` = `group_by | aggregate | order_by | limit | where | nest | having | drill`, `Filter = filter_string | literal_equality`).
- `malloy-query-builder` — `ASTQuery`: GUI'den sorgu kurmak için AST düzenleyici ve `toMalloy()` (Explorer UI'ı bunun üstünde).
- `malloy-filter` — tipe özgü filtre mini-dilleri (string/number/boolean/temporal), `parse` / `unparse` (peggy grammar'ları).
- `malloy-render` — sonuç render'ı, `# dashboard`, `# bar_chart` gibi annotation tabanlı görselleştirme.
- `malloy-tag` — annotation/tag dili.

Veri akışı:
```
.malloy kaynak ─ANTLR─▶ parse tree ─▶ AST (lang/ast) ─▶ IR (ModelDef/SourceDef/Query, JSON)
   ─▶ QueryModel/QueryQuery (model/) + Dialect ─▶ SQL (CTE stage'leri) ─▶ Connection ─▶ sonuç + metadata ─▶ renderer
GUI: malloy-query-builder (ASTQuery) / malloy-interfaces (stable JSON query) ─▶ Malloy ─▶ aynı hat
```

## Floem BI için kritik kısımlar
- `packages/malloy/src/model/expression_compiler.ts` → `generateSumFragment`, `generateAvgFragment`, `generateCountFragment`, `generateDistinctKeyIfNecessary`, `needsSymetricCalculation(qs, resultSet) = !joinOf(qs, resultSet).leafiest`, `withSourceRowFilter` (eşleşmeyen satırlarda operandı NULL'lar) → Floem BI derleyicisinde "bu ölçü fan-out'tan etkileniyor mu?" kararı ve güvenli aggregate üretimi.
- `packages/malloy/src/model/join_instance.ts` → `parentRelationship()` (`one`→`many_to_one`, `many`→`one_to_many`, `cross`→`many_to_many`), `forceAllSymmetricCalculations()` (right/full join'de tüm aggregate'ler symmetric) → Floem BI ilişki modeli (kardinalite, join tipi) → derleme kuralları.
- `packages/malloy/src/model/query_node.ts` `getDistinctKey()` → her source'un `__distinct_key`'i (primary key) → Floem BI'da her tablonun zorunlu/otomatik anahtarı.
- `packages/malloy/src/dialect/dialect.ts` `sqlSumDistinct()` + `SumDistinctByHash` (`direct` / `shifty`) ve `dialect/shifty_sum_distinct.ts` → symmetric SUM/AVG'nin lehçeden bağımsız şablonu; dosyadaki yorum çarpışma olasılığını (~n²/2⁹³) ve decimal taşma sınırlarını ayrıntılı açıklıyor.
- `packages/malloy/src/dialect/sqlserver/sqlserver.ts` → **T-SQL lehçesi var, `experimental = true`**. Önemli satırlar:
  - `sqlSumDistinctHashedKey`: `CAST(CAST(HASHBYTES('MD5', CAST(key AS NVARCHAR(MAX))) AS BIGINT) AS DECIMAL(38, 9))`
  - `sqlAggDistinct` → `unsupported('distinct aggregates')`; nesting, array, record, nested pipeline → `unsupported(...)`; regex SQL Server 2025 öncesi yok; boolean cast yok (`bit` integer sayılıyor).
  - `sqlOrderByLimit`: `ORDER BY ... OFFSET 0 ROWS FETCH NEXT n ROWS ONLY`, sırasız limitte `ORDER BY (SELECT NULL)`.
  - `windows_zones` ile IANA → Windows saat dilimi eşlemesi; `[name]` → ANSI quote dönüşümü (`bracketsToAnsi`).
  → Floem BI'ın T-SQL üreticisi için doğrudan referans (tip eşleme tablosu `sqlServerToMalloyTypes`, tarih fonksiyon eşlemesi `datePartMap`, OFFSET/FETCH kuralları).
- `packages/malloy/src/dialect/duckdb/duckdb.ts` `sqlSumDistinct` → DuckDB'de hash yerine `UNNEST(list(distinct {key, val}))` alt sorgusu ile tam doğru distinct toplama → DuckDB (Import modu) için daha basit yol.
- `packages/malloy/src/model/nest-capability.ts` `nestStrategy()` → "bu lehçe bu yapıyı üretebilir mi?" kararını tek fonksiyonda toplayan yetenek (capability) modeli → Floem BI'da DuckDB vs T-SQL özellik farklarını yönetme deseni.
- `packages/malloy-interfaces/src/types.ts` + `packages/malloy-query-builder` → GUI'nin ürettiği JSON sorgu (group_by/aggregate/where/having/nest/drill) → Floem BI rapor tasarımcısı → sorgu IR sözleşmesi.
- `packages/malloy-filter` → slicer/filtre kutusu için tipe özgü filtre ifadeleri ve `unparse` (UI ↔ metin çift yönlü).
- `packages/malloy/src/doc/adding-a-new-database.md`, `structdef.md`, `expr.md` → lehçe ekleme ve IR dokümantasyonu.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Malloy kaynağı (`packages/malloy-render/src/stories/dashboard.stories.malloy`'dan):
```malloy
source: products is duckdb.table("static/data/products.parquet") extend {
  measure:
    product_count is count()
    total_retail is retail_price.sum()
    percent_of_products is count() / all(count()) * 100
  view: by_brand is {
    group_by: brand
    aggregate: product_count, total_retail, percent_of_products
  }
}
```
Join örneği (`test/src/core/bugless.spec.ts`):
```malloy
join_many: carriers is duckdb.table('malloytest.carriers') on carriers.code = carrier
```
- `join_one: users with user_id` (FK→PK kısaltması), `join_many: ... on ...`, `join_cross`.
- Aggregate locality: `order_items.amount.sum()` — ölçünün hangi grain'de toplanacağı yol ile belirtilir.
- `all(expr)` / `exclude(expr, dim...)` (IR'da `node: 'all' | 'exclude'`, `malloy_types.ts:197`) → DAX `ALL` / `ALLEXCEPT`'in tersi semantiğe yakın "ungroup" ifadeleri; SQL'de `MAX(...) OVER (PARTITION BY ...)` ile üretiliyor (`expression_compiler.ts` ~satır 968).
- IR: `SourceDef` alanları (dimension/measure `FieldDef`, join'li `StructDef` + `JoinBase`), JSON olarak serileştirilebilir → dil olmadan IR'ı doğrudan üretmek mümkün.
- Annotation'lar (`# currency`, `# dashboard`) ile format/görsel metadata alan seviyesinde tutuluyor.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
1. `run: products -> { group_by: brand; aggregate: total_retail; where: ... }` translate edilerek IR `Query` (source ref + pipeline segment'leri: `reduce`/`project`, `filterList`, field'lar) olur.
2. `QueryQuery` (model/query_query.ts) segment'i işler: kullanılan alanlardan `FieldInstanceResult` ağacı, gerekli join'lerden `JoinInstance` ağacı çıkarılır (yalnızca başvurulan join'ler SQL'e girer).
3. Her aggregate için `expression_compiler` ölçünün ait olduğu struct'ın join ağacında "leafiest" olup olmadığına bakar: değilse `dialect.sqlSumDistinct(distinctKey, value, 'SUM'|'AVG')`; COUNT için `COUNT(DISTINCT key)`; MIN/MAX/COUNT DISTINCT zaten fan-out'a dayanıklı (`generateSymmetricFragment`).
4. Filtreler WHERE'e (dimension) ve HAVING'e (measure) yerleştirilir; filtrelenmiş ölçü (`sum() { where: ... }`) `CASE WHEN` olarak operanda girer.
5. `nest:` varsa tek tarama + `group_set` ile fan-out (CROSS JOIN ile satır çoğaltma) ve sonrasında array/JSON aggregate ile iç içe sonuç; T-SQL lehçesinde bu yol `unsupported`.
6. Çok aşamalı pipeline'lar (`->`) CTE stage'leri olarak `StageWriter` ile yazılır; sonuçla birlikte şema metadata'sı döner.

## Alınacak fikirler
- **Symmetric aggregates**: join'i bir kez yapıp ölçüleri doğru toplayan tek-SELECT yöntemi; özellikle DirectQuery'de (SQL Server) çoklu CTE/pre-aggregation yerine tek sorgu gerektiğinde alternatif. Floem BI'da iki strateji birlikte düşünülebilir: varsayılan pre-aggregation (BSL/Power BI tarzı), opsiyonel symmetric aggregate.
- **"Leafiest join" kuralı**: ölçü, sorgudaki join ağacının en çok satır üreten ucunda değilse distinct-key tabanlı hesaplama — fan-out tespitinin basit ve genel ifadesi.
- **Her source'un zorunlu distinct key'i** (`__distinct_key`): Floem BI tablo tanımında primary key zorunlu/otomatik olmalı.
- **Join modele ait, sorguya değil**; sadece başvurulan join'ler SQL'e eklenir (join pruning).
- **Translate / compile ayrımı + JSON IR**: DAX benzeri dil → serileştirilebilir IR → SQL. IR'ın dilden bağımsız olması GUI'nin (sürükle-bırak) doğrudan IR üretmesini sağlar (`malloy-interfaces` stable query API bunun örneği).
- **Lehçe yetenek bayrakları** (`supportsNesting`, `supportsAggDistinct`, `divisionIsInteger`, `sumDistinctByHash`) ve tek karar noktası (`nestStrategy`) — T-SQL/DuckDB farklarını if-else'e dağıtmadan yönetmek.
- T-SQL detayları: `divisionIsInteger = true` (tam sayı bölmesi tuzağı), `OFFSET 0 ROWS FETCH NEXT`, `ORDER BY (SELECT NULL)`, `HASHBYTES('MD5', ...)`, Windows saat dilimi eşlemesi, `bit`'in boolean olmaması.
- `malloy-filter`: tipe özgü filtre mini-dilleri, parse+unparse ile UI ↔ metin senkronu (slicer, gelişmiş filtre kutusu).
- `all()` / `exclude()` → DAX `ALL`/`ALLEXCEPT` için pencere fonksiyonu tabanlı derleme.
- Annotation/tag ile alan seviyesinde format ve görsel ipuçları.

## Kaçınılacaklar / zayıf yönler
- **TypeScript**: Floem BI backend'i Python; Malloy'u bağımlılık olarak kullanmak Node runtime + köprü gerektirir (malloy-py var ama Node'u sarmalıyor).
- **SQL Server lehçesi deneysel** (`experimental = true`): nest, distinct aggregate (`sqlAggDistinct`), array/record, nested pipeline desteklenmiyor; Floem BI'ın ana hedefi olan SAP B1/SQL Server için olgun değil.
- Symmetric aggregate'in maliyeti: SQL Server'da `HASHBYTES('MD5', CAST(... AS NVARCHAR(MAX)))` + `SUM(DISTINCT DECIMAL(38,9))` büyük tablolarda pahalı ve indeks kullanmaz; olasılıksal (çarpışma ihtimali ~n²/2⁹³, çok düşük ama sıfır değil); decimal hassasiyet/taşma sınırları (`shifty_sum_distinct.ts` yorumu: Databricks'te toplam 10²⁷ ile sınırlı).
- Malloy'un ölçü semantiği "aggregate locality" üstüne kurulu; DAX'ın **filtre bağlamı / CALCULATE / context transition / filtre yönü** modeli yok. Zaman zekâsı fonksiyonları (YTD, SAMEPERIODLASTYEAR) dil seviyesinde yok, tarih aritmetiği ve filtrelerle elle kuruluyor.
- `query_query.ts` 3.6k satır, `malloy_types.ts` 2.4k satır — derleyici büyük ve karmaşık; fork bakım yükü yüksek.
- Paket sürümü hâlâ `0.0.x`; API kırılmaları olası.
- RLS, çok kiracılık, cache/refresh gibi platform özellikleri kapsam dışı (bunlar Malloy Publisher tarafında).

## Kullanım kararı: Fikir al
Lisans (MIT) kod alımına izin veriyor, ancak dil (TypeScript), deneysel T-SQL lehçesi ve DAX'tan farklı semantik nedeniyle bağımlılık veya fork önerilmez. Symmetric aggregate algoritması (`dialect.ts` `sqlSumDistinct`, `shifty_sum_distinct.ts`, `expression_compiler.ts` `needsSymetricCalculation`), lehçe yetenek modeli, T-SQL lehçe detayları (`sqlserver.ts`) ve translate/compile + JSON IR ayrımı Floem BI Python derleyicisine **MIT atfıyla uyarlanabilir/port edilebilir** referans olarak alınmalı. Port edilen parçalar için `THIRD_PARTY_NOTICES` içinde Malloy MIT bildirimi tutulmalı.
