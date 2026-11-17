# Cube (cube-js/cube)

- URL: https://github.com/cube-js/cube
- Lisans: **Apache 2.0 (varsayılan) + MIT (bazı paketler)** — doğrulandı (17.11.2026).
  - Kök `LICENSE`: "Source code in this repository is covered by one of two licenses: (i) the Apache License 2.0 (ii) an MIT license. The default license throughout the repository is Apache License 2.0 unless the header or package LICENSE file specifies another license."
  - MIT olan paketler (paket `LICENSE` dosyasından): `cubejs-client-core`, `cubejs-client-dx`, `cubejs-client-ngx`, `cubejs-client-react`, `cubejs-client-vue3`, `cubejs-client-ws-transport`, `cubejs-playground`, `cubejs-testing*`.
  - Geri kalan tüm paketler (`cubejs-schema-compiler`, `cubejs-query-orchestrator`, `cubejs-server-core`, `cubejs-api-gateway`, sürücüler) ve Rust tarafı (`rust/cubestore`, `rust/cubesql`, `rust/cube/cubesqlplanner`) Apache 2.0.
  - `ee/` / `enterprise/` klasörü YOK. Kaynak-açık (source-available) istisna bulunmadı. (Not: Cube Cloud'a özgü özellikler bu repoda değil.)
  - Sonuç: Tamamı Floem BI'da kullanılabilir (Apache 2.0 için NOTICE/atıf yükümlülüğü).
- Dil: TypeScript (Node.js backend, schema compiler), Rust (CubeStore, CubeSQL Postgres-wire SQL API, yeni "Tesseract" SQL planner `rust/cube/cubesqlplanner`).
- Son commit tarihi: 2026-11-16

## Ne yapıyor (3-5 cümle)
Cube, veri ambarının önüne oturan "headless" bir semantik katmandır: YAML/JS ile tanımlanan `cubes` (ölçü, boyut, join, segment, hiyerarşi, pre-aggregation) ve `views` modelini derler, gelen JSON sorgusunu (measures + dimensions + timeDimensions + filters) hedef veritabanının SQL lehçesine çevirir. Sonuçları kendi kuyruk + önbellek katmanında (query orchestrator) tutar, `refresh_key` ile tazeler ve sık sorguları pre-aggregation (rollup) tablolarına (CubeStore veya kaynak DB) materyalize edip sorgu anında otomatik eşleştirir. REST/GraphQL/SQL (Postgres wire) API'leri sunar; çok kiracılık `securityContext` → `contextToAppId`/`contextToOrchestratorId` ile, RLS ise `access_policy` veya `queryRewrite` ile yapılır. Kendi görselleştirme UI'ı yok (Playground hariç).

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `packages/cubejs-schema-compiler/src/compiler/` | Model dosyalarını okur/transpile eder (`DataSchemaCompiler.ts`, `YamlCompiler.ts`), Joi ile doğrular (`CubeValidator.ts`, ~1650 satır = şemanın resmi tanımı), sembol tablosu (`CubeSymbols.ts`, `CubeEvaluator.ts`), join grafiği (`JoinGraph.ts`, `node-dijkstra` ile en kısa join yolu + `multiplicationFactor`). |
| `packages/cubejs-schema-compiler/src/adapter/` | SQL üretimi: `BaseQuery.ts` (~6000 satır, tüm mantık), lehçe alt sınıfları (`MssqlQuery.ts`, `PostgresQuery.ts`, `SnowflakeQuery.ts`, …), `BaseMeasure/BaseDimension/BaseTimeDimension/BaseFilter.ts`, `PreAggregations.ts` (rollup eşleştirme), `ParamAllocator.ts` (parametreli SQL). |
| `rust/cube/cubesqlplanner/cubesqlplanner/src/` | "Tesseract": yeni nesil planner (Rust). `planner/` (join_tree, join_multiplication, multi_fact_join_groups), `logical_plan/` (aggregate_multiplied_subquery, keys_grid, multistage, pre_aggregation), `physical_plan_builder/`. `CUBEJS_TESSERACT_SQL_PLANNER` (`nativeSqlPlanner`) ile açılıyor; `BaseQuery.buildSqlAndParams` içinde dallanıyor. |
| `packages/cubejs-query-orchestrator/src/orchestrator/` | `QueryOrchestrator.ts`, `QueryCache.ts` (refreshKey/renewalThreshold/expireSecs), `QueryQueue.ts` (eşzamanlılık, öncelik, tekilleştirme), `PreAggregationLoader.ts`, `PreAggregationPartitionRangeLoader.ts` (partition + incremental refresh). |
| `packages/cubejs-server-core/src/core/` | `server.ts` (çok kiracılık kancaları: `contextToAppId`, `contextToOrchestratorId`, `repositoryFactory`, `driverFactory`, `scheduledRefreshContexts`), `CompilerApi.ts`, `RefreshScheduler.ts`. |
| `packages/cubejs-api-gateway/` | REST/GraphQL uçları, `checkAuth` (JWT → securityContext), `queryRewrite`. |
| `rust/cubesql/` | Postgres wire protokolü üzerinden SQL API (BI araçları için); DataFusion tabanlı SQL → Cube sorgusu çevirisi. |
| `rust/cubestore/` | Pre-aggregation depolama motoru (kolon bazlı, dağıtık). |
| `packages/cubejs-*-driver/` | Kaynak sürücüleri (`cubejs-mssql-driver`, `cubejs-postgres-driver`, `cubejs-duckdb-driver`…). |
| `packages/cubejs-model-schema/` | `CubeValidator` Joi şemalarından üretilen JSON Schema (editör tamamlama/doğrulama için). |

Veri akışı:
```
JSON sorgu (API Gateway) → checkAuth → securityContext
  → contextToAppId → (kiracıya özel) CompilerApi: model compile (cache'li)
  → queryRewrite / access_policy (RLS filtreleri eklenir)
  → QueryFactory → <Dialect>Query extends BaseQuery
  → PreAggregations.findPreAggregationForQuery() → eşleşirse rollup tablosuna SQL
  → buildSqlAndParams() → [sql, params]
  → contextToOrchestratorId → QueryOrchestrator → QueryCache (refreshKey) → QueryQueue → Driver
```

## Floem BI için kritik kısımlar
- `packages/cubejs-schema-compiler/src/compiler/CubeValidator.ts` → Tüm model şemasının Joi tanımı (cube, measure, dimension, join, preAggregation, accessPolicy, hierarchies, views, folders, multiStage). → Floem BI semantik model JSON şemasının (tablo/kolon/ölçü/ilişki/rol) referans kontrol listesi.
- `packages/cubejs-schema-compiler/src/compiler/JoinGraph.ts` → Join'leri yönlü graf olarak tutar, Dijkstra ile istenen cube'ları bağlayan ağacı kurar, `multiplicationFactor` ile hangi cube'un satır çoğaltmaya (fan-out) uğradığını hesaplar. → Floem BI ilişki motoru (kardinalite + filtre yönü); Power BI'daki "filtre yayılımı" için temel.
- `packages/cubejs-schema-compiler/src/adapter/BaseQuery.ts` → `buildSqlAndParams` (L1094), `fullKeyQueryAggregate` (L1505), `regularMeasuresSubQuery` (L2719), `aggregateSubQuery` (L2741, fan-out'a uğrayan ölçüler için PK DISTINCT "keys" alt sorgusu), `collectMultipliedMeasures` (L4115), `multiStageWithQueries` (L1869, CTE tabanlı çok aşamalı hesaplar), `rollingWindow*`/`overTimeSeriesQuery` (zaman serisi). → Floem BI ölçü dili → SQL derleyicisinin "fiziksel plan" aşaması.
- `rust/cube/cubesqlplanner/cubesqlplanner/src/logical_plan/` → Aynı mantığın mantıksal plan düğümleriyle (Query, MultiStage, AggregateMultipliedSubquery, KeysGrid, PreAggregation) temiz yeniden yazımı. → Floem BI derleyicisinde "AST → mantıksal plan → SQL" katmanlaması için daha iyi okunacak referans.
- `packages/cubejs-schema-compiler/src/adapter/PreAggregations.ts` → `transformQueryToCanUseForm` (L627) + `canUsePreAggregation*` (L~990-1030): sorgu ölçülerinin additive olup olmadığına, boyut/zaman granülerliğinin rollup'ı kapsayıp kapsamadığına bakarak rollup seçer. → Floem BI "Aggregations / Import modu özet tabloları" (Power BI aggregations karşılığı).
- `packages/cubejs-query-orchestrator/src/orchestrator/QueryCache.ts`, `QueryQueue.ts`, `PreAggregationPartitionRangeLoader.ts` → refreshKey ile önbellek geçersizleştirme, kuyruk, partition'lı incremental yenileme. → Floem BI zamanlanmış yenileme + DirectQuery önbelleği + incremental refresh.
- `packages/cubejs-server-core/src/core/server.ts` (L156-256, L565, L683) → `contextToAppId` (kiracı başına derlenmiş model önbelleği), `contextToOrchestratorId` (kiracı başına sorgu kuyruğu/önbellek), `driverFactory(context)` (kiracı başına bağlantı), `scheduledRefreshContexts` (hangi kiracılar için arka plan yenileme). → Floem BI çok kiracılık ve Gateway yönlendirmesi (kiracı → agent tüneli).
- `packages/cubejs-schema-compiler/src/compiler/DataSchemaCompiler.ts` (L796, L1416-1428) → `COMPILE_CONTEXT` / `securityContext`'in model derleme zamanında kullanılması (kiracıya göre farklı şema/tablo). → Floem BI "tenant-aware model" (ör. her müşterinin farklı SAP B1 şirket DB'si).
- `packages/cubejs-schema-compiler/src/adapter/MssqlQuery.ts` → T-SQL lehçesi (TOP/OFFSET FETCH kuralları, `SWITCHOFFSET` ile timezone, GROUP BY ifadeleri). → SQL Server/SAP B1 (MSSQL) kaynakları için doğrudan referans.
- `packages/cubejs-model-schema/` → Joi → JSON Schema üretimi. → Floem BI model dosyası/GUI editörü için JSON Schema yaklaşımı.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
YAML (snake_case) veya JS (camelCase); derleyici ikisini aynı iç yapıya çevirir. Gerçek örnek (`packages/cubejs-schema-compiler/test/unit/fixtures/orders_and_items_multiplied_pre_agg.yml`):
```yaml
cubes:
  - name: orders
    sql_table: public.orders
    joins:
      - name: line_items
        sql: "{CUBE}.id = {line_items}.order_id"
        relationship: one_to_many
    dimensions:
      - name: id
        sql: id
        type: number
        primary_key: true
      - name: status
        sql: status
        type: string
      - name: created_at
        sql: created_at
        type: time
    measures:
      - name: count
        type: count
      - name: total_qty
        type: sum
        sql: amount
    pre_aggregations:
      - name: pre_agg_with_multiplied_measures
        dimensions: [orders.status, line_items.product_id]
        measures: [orders.count, orders.total_qty]
        timeDimension: orders.created_at
        granularity: month
```
Çok aşamalı (DAX `CALCULATE`/`SAMEPERIODLASTYEAR` benzeri) ölçü (`test/unit/fixtures/calendar_orders.yml`):
```yaml
      - name: count_prev_year
        type: number
        multi_stage: true
        sql: "{count}"
        time_shift:
          - time_dimension: created_at
            interval: 1 year
            type: prior
```
Şemanın önemli anahtarları (`CubeValidator.ts`):
- Ölçü tipleri: `count, number, string, boolean, time, sum, avg, min, max, countDistinct, countDistinctApprox`; multi-stage için ek `numberAgg`, `rank`.
- Ölçü: `sql`, `filters` (ölçüye gömülü WHERE), `rolling_window` (`fixed` trailing/leading, `year_to_date`, `quarter_to_date`, `month_to_date`, `to_date`), `multi_stage` + `time_shift` / `group_by` (sabit boyut — DAX `ALLEXCEPT` benzeri) / `reduce_by` (boyutu kaldır — `ALL(col)` benzeri) / `add_group_by` (iç içe toplama).
- Join: `relationship: one_to_one | one_to_many | many_to_one` (eski `has_one/has_many/belongs_to`), `sql` (`{CUBE}` ve `{diğer_cube}` referanslarıyla). Filtre yönü kavramı YOK; yön her zaman sorgu ağacından türetiliyor.
- `hierarchies` (drill-down seviyeleri), `segments` (önceden tanımlı filtreler), `views` (`cubes: - join_path: orders.users, includes/excludes, prefix`), `folders`, `view groups`.
- `access_policy` (RLS + kolon güvenliği): `group/groups`, `conditions: [{ if: ... }]`, `member_level: {includes, excludes}`, `member_masking`, `row_level: {filters | allow_all}`; filtre değerlerinde `{ securityContext.x }`.
- `pre_aggregations`: `type: rollup | original_sql | rollupJoin | rollupLambda`, `partition_granularity`, `refresh_key: { every | sql, incremental, update_window }`, `build_range_start/end`, `indexes`.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
1. Gelen sorgu: `{ measures: ['orders.count'], dimensions: ['orders.status'], timeDimensions: [{dimension:'orders.created_at', granularity:'month', dateRange:[...]}], filters: [...] }`.
2. `BaseQuery.initFromOptions` (L428) → `BaseMeasure/BaseDimension/BaseTimeDimension/BaseFilter` nesneleri; filtreler ağaç olarak (`extractFiltersAsTree`, L370) ayrıştırılır; boyut filtreleri WHERE'e, ölçü filtreleri HAVING'e.
3. `collectJoinHints` → `JoinGraph.buildJoin(hints)` ile Dijkstra en kısa join ağacı + her cube için `multiplicationFactor`.
4. `fullKeyQueryAggregateMeasures` (L1730) ölçüleri sınıflar: **regular** (fan-out yok), **multiplied** (join tarafından çoğaltılan cube'un ölçüsü), **cumulative** (rolling window), **multiStage**.
5. Hiç multiplied/cumulative/multiStage yoksa `simpleQuery()` → tek `SELECT ... FROM ... JOIN ... WHERE ... GROUP BY`.
6. Aksi halde "full key aggregate": regular ölçüler için `regularMeasuresSubQuery`, her multiplied cube için `aggregateSubQuery` → önce `keysQuery` (boyutlar + PK `SELECT DISTINCT`), sonra PK üzerinden cube'a tekrar join edip toplama; alt sorgular boyutlar üzerinden FULL/LEFT JOIN ile birleştirilir (`joinFullKeyQueryAggregate`). Multi-stage ölçüler CTE (`WITH`) olarak çıkar (`multiStageWithQueries`, `renderWithQuery`).
7. Her adımda önce `PreAggregations.findPreAggregationForQuery()` denenir; eşleşirse SQL rollup tablosuna yönlenir (additive ölçüler re-aggregate edilir).
8. `ParamAllocator.buildSqlAndParams` → `$1`/`?`/`@p1` lehçe parametreleriyle `[sql, params]`.
9. Tesseract açıksa (`nativeSqlPlanner`) aynı iş Rust tarafında mantıksal plan → fiziksel plan → SQL olarak yapılır (`buildSqlAndParamsRust`, L1149).

## Alınacak fikirler
- **Fan-out (çoklu sayım) çözümü**: `multiplicationFactor` + "keys alt sorgusu + PK ile yeniden join" deseni; Power BI'ın ilişki yayılımında doğal olarak çözdüğü sorunun SQL karşılığı. Floem BI derleyicisinde zorunlu.
- **Multi-stage ölçüler** (`time_shift`, `group_by`, `reduce_by`, `add_group_by`, `rank`) ≈ DAX `CALCULATE` filtre bağlamı manipülasyonları. DAX → ara temsil → CTE zinciri tasarımında doğrudan model: "filtre bağlamını değiştiren her CALCULATE = ayrı aşama (CTE), sonra boyutlar üzerinden join".
- **Mantıksal plan katmanı** (Tesseract `logical_plan/`): string birleştirmeyle SQL üretmek yerine düğüm tabanlı plan. Floem BI derleyicisi baştan böyle kurulmalı.
- **Pre-aggregation eşleştirme kuralları** (additivity, granülerlik kapsama, leaf measure) → Floem BI "Aggregations" ve Import modu.
- **refreshKey + renewalThreshold + incremental partition** → zamanlanmış yenileme ve önbellek geçersizleştirme tasarımı.
- **Çok kiracılık kancaları**: `contextToAppId` (model önbelleği anahtarı), `contextToOrchestratorId` (kuyruk/önbellek izolasyonu), `driverFactory(context)` (kiracıya özel bağlantı → Floem'de agent tüneli). Bu ayrım (model izolasyonu ≠ veri/önbellek izolasyonu) çok değerli.
- **access_policy** şeması (grup → member_level + row_level + masking + conditions) → Floem BI "Role" nesnesi için temiz bir DSL.
- **Joi → JSON Schema** yaklaşımı (`cubejs-model-schema`): tek kaynaktan hem doğrulama hem editör şeması.
- **Lehçe alt sınıfları** (`MssqlQuery extends BaseQuery`): ortak planner + lehçe override'ları.

## Kaçınılacaklar / zayıf yönler
- `BaseQuery.ts` 6000+ satırlık, durum taşıyan (mutable context, `evaluateSymbolSqlWithContext`) tek dev sınıf; string tabanlı SQL birleştirme. Kendileri de Rust'ta yeniden yazıyor (Tesseract) → iki planner paralel yaşıyor, karmaşıklık yüksek. Fork etmek bakım yükü olur.
- İlişkilerde **filtre yönü (single/both) ve aktif/pasif ilişki** kavramı yok; join yolu otomatik (Dijkstra) seçilir, belirsiz yollar sürpriz yaratabilir. Power BI semantiği için ek tasarım gerekli.
- Ölçü dili gerçek bir ifade dili değil: `sql` + `{member}` şablonları + YAML anahtarları. DAX gibi iç içe `CALCULATE(..., FILTER(...))` kompozisyonu yok.
- Model JS dosyalarında rastgele kod çalıştırılabiliyor (`COMPILE_CONTEXT`, dinamik model) → çok kiracılı SaaS'ta sandbox gerektirir; Floem BI'da model saf veri (JSON) olmalı.
- Node.js + Rust (napi) + CubeStore bağımlılık zinciri ağır; Python tabanlı Floemdata ile entegrasyon ancak HTTP/SQL API üzerinden.
- Görselleştirme/dashboard katmanı yok (sadece Playground).

## Kullanım kararı: Fikir al
Lisans (Apache 2.0 / MIT) her türlü kullanıma izin veriyor; ancak Floem BI'ın DAX benzeri dili, ilişki/filtre yönü semantiği ve Python ekosistemi Cube'un JSON-sorgu modeline birebir oturmuyor ve `BaseQuery` fork edilemeyecek kadar karmaşık. Fan-out çözümü, multi-stage ölçü → CTE deseni, pre-aggregation eşleştirme kuralları, refreshKey önbelleği ve `contextToAppId/contextToOrchestratorId` çok kiracılık ayrımı Floem BI derleyicisine ve sorgu servisine tasarım referansı olarak alınmalı. (Opsiyon: MVP'de hızlı bir "headless semantic layer" gerekiyorsa Cube'u ayrı servis olarak bağımlılık şeklinde çalıştırmak lisans açısından serbest.)
