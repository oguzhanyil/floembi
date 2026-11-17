# Lightdash (lightdash/lightdash)

- URL: https://github.com/lightdash/lightdash
- Lisans: **MIT (çoğunluk) + "Lightdash Source Available License" (`ee`)** — doğrulandı (17.11.2026).
  - Kök `LICENSE`: "All content that resides under the `packages/backend/src/ee` directory ... is licensed under the license defined in `packages/backend/src/ee/LICENSE`" ve "Content outside of the above mentioned directories ... is available under the MIT license".
  - `packages/backend/src/ee/LICENSE`: Source Available; üretimde kullanım için Lightdash Enterprise aboneliği şart, kopyalama/dağıtım yasak. **Kesinlikle kullanılmaz.**
  - **Dikkat — gri alan:** `packages/common/src/ee/` ve `packages/frontend/src/ee/` klasörleri de var, ancak kök LICENSE bunları adıyla anmıyor (teknik olarak MIT kapsamına düşüyor gibi okunuyor). İçerikleri ticari özellikler (embed, preAggregates, AI agent, SCIM, customRoles, serviceAccounts, `commercialFeatureFlags.ts`). Hukuki risk almamak için **tüm `*/ee/*` klasörleri Source Available kabul edilip kopyalanmamalı.**
  - Tüm `package.json` dosyaları `"license": "MIT"` (backend, common, frontend hariç tutulmadı, cli, formula, warehouses, query-sdk, visualization).
  - Ek: `sandboxes/data-apps/template/.claude/skills/frontend-design/LICENSE` ayrı bir üçüncü taraf lisansı; Floem BI için ilgisiz.
- Dil: TypeScript (Node.js/Express backend, React + Mantine frontend, Redux Toolkit store), Peggy (formül grameri).
- Son commit tarihi: 2026-11-17

## Ne yapıyor (3-5 cümle)
Lightdash, dbt projesini okuyup (manifest/YAML `meta` blokları) her dbt modelini bir "table", join'lerle birlikte bir "explore" haline getiren, self-service BI aracıdır. Kullanıcı Explore ekranında alan ağacından dimension/metric seçer, filtre/sıralama/limit/tablo hesaplaması ekler; bu `MetricQuery` nesnesi backend'de `MetricQueryBuilder` ile hedef ambarın SQL lehçesine derlenip çalıştırılır. Grafikler, dashboard'lar, zamanlanmış gönderimler, kullanıcı öznitelikleriyle RLS (`sql_filter`) ve alan erişimi (`required_attributes`) sunar. dbt'siz kullanım için "Lightdash YAML" modelleri de destekler (dbt formatına çevrilir). Embed, pre-aggregate materyalizasyonu, AI agent gibi ticari özellikler `ee` altında.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `packages/common/src/types/` | Paylaşılan tipler: `field.ts` (Dimension, Metric, `MetricType`, `Format`), `metricQuery.ts` (`MetricQuery`), `explore.ts`, `dbt.ts`, `filter.ts`. |
| `packages/common/src/compiler/translator.ts` | dbt model node'u → `Table` (columns → dimensions, `meta.metrics` → metrics, `joins`, `sql_filter`, `required_attributes`). |
| `packages/common/src/compiler/exploreCompiler.ts` | `ExploreCompiler`: `${table.field}` referanslarını çözüp `compiledSql` üretir (`compileMetricSql` L1217, `compileDimensionSql` L1592), döngü/öz-referans tespiti, `tablesReferences` (hangi join'ler gerekli). |
| `packages/common/src/compiler/joinInflation.ts`, `filtersCompiler.ts`, `fieldSetExpander.ts`, `lightdashModelConverter.ts` | Join kaynaklı şişme analizi, filtre kuralı → SQL, alan setleri, Lightdash YAML → dbt node dönüşümü. |
| `packages/backend/src/utils/QueryBuilder/` | `QueryComposer` (cephe), `MetricQueryBuilder.ts` (~6000 satır, metric query → SQL), `PivotQueryBuilder.ts` (DENSE_RANK ile pivot indeksleri), `TotalQueryBuilder.ts` (grand/row/column/subtotal), `MergeQueryBuilder.ts`, `utils.ts` (user attribute yerleştirme). `AGENTS.md` mimariyi iyi anlatıyor. |
| `packages/warehouses/src/warehouseClients/` | Ambar istemcileri + `WarehouseBaseSqlBuilder.ts` (lehçe farkları). Desteklenen: BigQuery, Postgres, Redshift, Snowflake, Databricks, Trino, ClickHouse, Athena, DuckDB. **SQL Server yok.** |
| `packages/formula/` | Peggy (`src/grammar/formula.pegjs`, ~460 satır) ile Google Sheets benzeri formül → AST → lehçe SQL (`src/codegen/generator.ts`, `dialects.ts`). Pencere fonksiyonları, `SUMIF/AVERAGEIF`, `MOVING_SUM`, tarih fonksiyonları. |
| `packages/frontend/src/components/Explorer/` | Explore UI: `ExploreTree` (alan ağacı), `FiltersCard`, `VisualizationCard`, `ResultsCard`, `CustomMetricModal`, `CustomDimensionModal`, `PeriodOverPeriodComparisonModal`, `fieldDrag.ts`. |
| `packages/frontend/src/features/explorer/store/` | Redux Toolkit `explorerSlice.ts` + `selectors.ts`: Explore durumunun (metric query + chart config) tek kaynağı. |
| `packages/backend/src/ee/` | Source Available: embed, pre-aggregate materyalizasyonu/matcher (`ee/preAggregates/matcher.ts`), Postgres wire, SCIM, AI. **Kullanılmaz.** |

Veri akışı:
```
dbt manifest / schema.yml (meta) ──translator.ts──▶ Table/Explore (ham)
   ──ExploreCompiler──▶ CompiledExplore (her alanın compiledSql'i, tablesReferences)
UI (ExploreTree + Filters) ──▶ MetricQuery {exploreName, dimensions, metrics, filters, sorts, limit, tableCalculations, additionalMetrics, customDimensions}
   ──QueryComposer──▶ compileMetricQuery ──▶ MetricQueryBuilder.compileQuery()
       (user attributes yerleştir, join seçimi, fan-out CTE'leri, metric filtreleri, table calc CTE'leri)
   ──(opsiyonel) PivotQueryBuilder──▶ SQL ──▶ WarehouseClient ──▶ sonuç (AsyncQueryService, sonuçlar önbellekte/sayfalı)
```

## Floem BI için kritik kısımlar
- `packages/common/src/types/field.ts` (L934 `MetricType`, `Format`) → Alan/ölçü tip sistemi: `sum, count, count_distinct, sum_distinct, average_distinct, average, min, max, median, percentile, number, percent_of_previous, percent_of_total, running_total, string, date, timestamp, boolean`. → Floem BI ölçü tip kataloğu ve format modeli (`format: usd/percent/"#,##0.0%"`, `round`).
- `packages/common/src/compiler/exploreCompiler.ts` → `${table.field}` referans çözümü, metric→dimension / metric→metric bağımlılık kuralları (aggregate metric yalnızca dimension'a, `type: number` metric diğer metric'lere referans verebilir), öz-referans hatası. → Floem BI ölçü bağımlılık grafiği ve "ölçü içinde ölçü" kuralları.
- `packages/common/src/compiler/translator.ts` (L1282 `sqlWhere: meta.sql_filter || meta.sql_where`) → YAML → iç model dönüşümü. → Floem BI'da dış model formatlarını (pbixray çıktısı, dbt) içe alma katmanı.
- `packages/backend/src/utils/QueryBuilder/MetricQueryBuilder.ts` (L2755 `getExperimentalMetricsCteSQL`, L3068 `cte_keys_*`, L3099 `cte_metrics_*`, L3349 `cte_unaffected`, L3657 `buildDistinctMetricCtes`, L4016 `buildNestedAggregateCtes`, L4583 `buildDependentTableCalcCtes`) → Fan-out korumalı SQL: etkilenen her tablo için PK + boyutlarla `SELECT DISTINCT` keys CTE, ardından PK ile tekrar join edip toplama; etkilenmeyen metrikler `cte_unaffected`'ta; sonra boyutlar üzerinden birleştirme. Eksik `relationship`/`primary_key` için kullanıcıya uyarı üretir (L2949-3011). → Floem BI derleyicisindeki ilişki/kardinaliteye dayalı fan-out çözümü + "model sağlık uyarıları".
- `packages/backend/src/utils/QueryBuilder/metricQueryBuilderSnapshots/` (`fanoutQueries.test.ts`, `distinctQueries.test.ts`, `nestedAggregateQueries.test.ts`, …) → Girdi metric query → beklenen SQL snapshot testleri. → Floem BI derleyicisi için test stratejisi (golden SQL).
- `packages/backend/src/utils/QueryBuilder/PivotQueryBuilder.ts`, `TotalQueryBuilder.ts` → Pivotu SQL'de DENSE_RANK ile indeksleme, ara/genel toplamları ayrı toplam sorgusuyla hesaplama. → Floem BI matrix görseli (Power BI Matrix) ve subtotal'lar.
- `packages/backend/src/utils/QueryBuilder/utils.ts` (L322 `replaceUserAttributes`, L398 `replaceUserAttributesInSqlTable` + `assertSafeSqlIdentifierValue`) → `${lightdash.attributes.x}` değerlerini kaçışlı string olarak SQL'e yerleştirme; tablo referansında yalnızca `[A-Za-z0-9_.-]` kabul. → Floem BI RLS DAX filtresinin (`USERPRINCIPALNAME()` vb.) SQL'e güvenli enjeksiyonu.
- `packages/formula/` (Peggy grameri + dialect codegen) → Küçük, okunabilir "formül dili → AST → çok lehçeli SQL" derleyicisi. → Floem BI DAX benzeri dil derleyicisinin iskelet referansı (parser → typed AST → dialect emitter). MIT, ama DAX grameri için doğrudan değil, mimari örnek olarak.
- `packages/frontend/src/components/Explorer/` + `features/explorer/store/explorerSlice.ts` → Alan ağacı + seçili alanlar + filtre kartı + görselleştirme kartı + sonuç tablosu düzeni; durum tek bir serileştirilebilir `MetricQuery` + chart config. → Floem BI rapor tasarımcısındaki "Fields" paneli ve görsel başına sorgu durumu.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
dbt `schema.yml` içinde `meta` (yeni dbt'de `config.meta`) blokları. Model düzeyi: `joins`, model-level `metrics`, `sql_filter`, `required_attributes`, `primary_key`, `default_time_dimension`, ek `explores`, `pre_aggregates` (bu sonuncusu ee). Kolon düzeyi: `meta.dimension` (tip, format, `time_intervals`) ve kolondan türeyen `meta.metrics`.
Gerçek örnek (`examples/full-jaffle-shop-demo/dbt/models/orders.yml`):
```yaml
models:
  - name: orders
    config:
      meta:
        joins:
          - join: customers
            sql_on: ${customers.customer_id} = ${orders.customer_id}
            relationship: many-to-one
            label: Order Customer
        metrics:
          completion_percentage:
            type: number
            sql: ${total_completed_order_amount}/${total_order_amount}
            format: percent
          order_amount_plus_average_customer_age:
            type: number
            sql: ${total_order_amount} + ${customers.average_age}
        default_time_dimension:
          field: order_date
          interval: MONTH
        explores:
          orders_with_custom_dims:
            additional_dimensions:
              order_value_category:
                type: string
                sql: "CASE WHEN ${orders.amount} > 100 THEN 'high' ELSE 'low' END"
    columns:
      - name: order_id
        config:
          meta:
            metrics:
              unique_order_count:
                type: count_distinct
              completed_order_count:
                type: count_distinct
                filters:
                  - is_completed: "true"
        meta:
          dimension:
            type: number
```
RLS örneği (`examples/full-jaffle-shop-demo/dbt/models/fanouts_examples/fanouts_accounts_bridged_fanout.yml`):
```yaml
      required_attributes:
        is_admin_saas_demo: 'true'
      sql_filter: ${lightdash.attributes.is_admin_saas_demo} = 'true' or segment != 'Enterprise'
```
Sorgu tarafı (`packages/common/src/types/metricQuery.ts` L174): `MetricQuery = { exploreName, dimensions: FieldId[], metrics: FieldId[], filters, sorts, limit, tableCalculations, additionalMetrics?, customDimensions?, metricOverrides?, timezone?, pivotDimensions? }`. Alan kimliği `<tablo>_<alan>` (ör. `orders_order_date_day`).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
1. Proje derlemesinde `ExploreCompiler` her alanın `sql`'ini `${...}` referanslarını açarak `compiledSql`'e çevirir; metric için `type`'a göre agregasyon sarılır (`SUM(...)`, `COUNT(DISTINCT ...)`), `filters` varsa `CASE WHEN` ile gömülür; her alan hangi tablolara ihtiyaç duyduğunu (`tablesReferences`) bilir.
2. Sorgu anında `QueryComposer` → `compileMetricQuery` (table calculations, custom metric/dimension'ları derler) → `MetricQueryBuilder`.
3. `getDimensionsSQL` (L1399): boyut SELECT'leri, zaman dilimine duyarlı date_trunc, boyut filtreleri → WHERE (`getFilterRuleSQL`, L2130).
4. `getJoinsSQL` (L2532): yalnızca seçili alanların ve filtrelerin referans verdiği join'ler eklenir; `sql_filter` + user attribute'ler base tabloya/join'lere eklenir.
5. `getMetricsSQL` (L1824) + fan-out analizi: `relationship` bilgisinden (one-to-many tarafındaki tablolar) şişmeye uğrayacak metrikler tespit edilir → `cte_keys_<tablo>` + `cte_metrics_<tablo>` + `cte_unaffected` CTE'leri; boyut alias'ları üzerinden birleştirilir. Çözülemeyen durumlar uyarı olarak döner.
6. Metric filtreleri (HAVING benzeri) ve post-calculation metrikler (`percent_of_total`, `running_total`) ile table calculation'lar ayrı CTE katmanlarında (`buildMetricFiltersCte`, `createTableCalculationCtes`).
7. `getSortSQL` / `getLimitSQL` → son SELECT; istenirse `PivotQueryBuilder` dış sorgu olarak sarar.

## Alınacak fikirler
- **Alan kimliği + referans sözdizimi** (`${table.field}`) ve "aggregate metric → yalnızca dimension; `number` metric → diğer metric'ler" kuralı: Floem BI'da "kolon ifadesi (row context)" ile "ölçü (filter context)" ayrımını netleştirmek için sade bir model.
- **Fan-out CTE deseni + model uyarıları**: `relationship`/`primary_key` eksikliğinde açık uyarı; Floem BI model doğrulayıcısına "bu ölçü şişebilir" uyarısı eklenmeli.
- **Snapshot (golden SQL) testleri**: her derleyici özelliği için girdi sorgu → beklenen SQL.
- **QueryComposer cephesi**: context hazırlığı (parametreler, timezone, date zoom, user attributes) ile SQL üretiminin ayrılması; tek "derlenmiş sorgu" nesnesi.
- **Pivot ve toplamların SQL'de üretilmesi** (DENSE_RANK indeks + ayrı totals sorgusu) → Matrix görseli.
- **Date zoom / default_time_dimension / time_intervals**: tarih boyutundan otomatik hiyerarşi (DAY/WEEK/MONTH/QUARTER/YEAR) üretimi → Floem BI tarih tablosu/hiyerarşisi için kolay yol.
- **Kullanıcı öznitelikleri ile RLS** (`sql_filter` + `${lightdash.attributes.x}` + `required_attributes` alan/tablo gizleme) ve güvenli değer enjeksiyonu (`assertSafeSqlIdentifierValue`).
- **Formül paketi mimarisi** (Peggy grameri → AST → dialect emitter) — DAX derleyicisi için iskelet.
- **Explore UI düzeni**: sol alan ağacı (tablo grupları, dimension/metric ayrımı, arama), üstte filtreler, ortada görselleştirme, altta sonuçlar; custom metric/dimension modal'ları ile ad-hoc hesap.

## Kaçınılacaklar / zayıf yönler
- **SQL Server desteği yok** (`WarehouseTypes`: bigquery, postgres, redshift, snowflake, databricks, trino, clickhouse, athena, duckdb). SAP B1/MSSQL için lehçe sıfırdan gerekir.
- **dbt'ye sıkı bağlılık**: model dbt YAML `meta` bloklarında yaşıyor; GUI tabanlı model düzenleme ana akış değil (Lightdash YAML da dbt node'una çevriliyor). Floem BI'ın grafik model editörüyle uyumsuz.
- İlişkilerde **filtre yönü, aktif/pasif ilişki, many-to-many köprü** semantiği yok; join'ler explore'un taban tablosundan tek yönlü LEFT JOIN. Çok olgusal (multi-fact) sorgu sınırlı.
- Ölçü dili yine `sql` + şablon; DAX `CALCULATE` tarzı filtre bağlamı değişimi yok (yerine period-over-period, table calculation gibi özel durum özellikleri).
- `MetricQueryBuilder.ts` 6000 satırlık, string birleştirmeli, çok sayıda özel durum (PoP, distinct, nested aggregate, totals) içeren sınıf — kopyalanması/fork'u ağır.
- **Pre-aggregate eşleştirme ve materyalizasyon, embed, SCIM, custom roles `ee` altında** (Source Available) — bu özelliklerin koduna bakılmamalı/kopyalanmamalı. `common/src/ee` ve `frontend/src/ee` lisans açısından belirsiz, kaçınılmalı.

## Kullanım kararı: Fikir al
`ee` dışı kod MIT olduğu için seçici kopyalama hukuken mümkün, ancak dbt bağımlı model, SQL Server eksikliği ve filtre yönü/DAX semantiğinin olmaması nedeniyle bağımlılık veya fork mantıklı değil. Explore UI düzeni, `MetricType`/format kataloğu, `${ref}` derleme kuralları, fan-out CTE deseni + model uyarıları, snapshot SQL testleri, `sql_filter`/user attribute RLS ve Peggy tabanlı formül → SQL derleyici mimarisi fikir olarak alınmalı. Gerekirse küçük MIT parçaları (ör. `packages/formula` yapısı) atıfla uyarlanabilir; `*/ee/*` klasörlerinden hiçbir şey alınmamalı.
