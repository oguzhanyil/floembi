# MetricFlow (dbt-labs/metricflow)

- **URL:** https://github.com/dbt-labs/metricflow
- **Lisans:** Apache License 2.0 — **doğrulandı** (17.11.2026, `--depth 1` klon).
  - Kök `LICENSE` → Apache 2.0 tam metni. `dbt-metricflow/LICENSE` → Apache 2.0. Başka `LICENSE*` dosyası yok (`find . -iname "LICENSE*"` yalnızca bu ikisini döndürdü).
  - `pyproject.toml` ve `dbt-metricflow/pyproject.toml`: `license = "Apache-2.0"`.
  - **Lisans geçmişi (dikkat):** `CHANGELOG.md` satır 797: *"Version 0 to 0.140.0 was covered by the Affero GPL license. Version 0.150.0 and greater is covered by the BSL license."* Satır 133 (MetricFlow 0.210.0, 24 Nisan 2026): *"License Change - Version 0.209.0 and greater is covered by the Apache 2.0 license."*
  - Sonuç: **yalnızca ≥ 0.209.0** sürümler Apache 2.0. 0.150–0.208 arası BSL, ≤0.140 AGPL. Eski PyPI sürümleri, eski blog yazıları veya fork'lardan kod alınmamalı. (README'deki shield badge'inde hâlâ `logo=AGPL-3.0` yazıyor; bu kozmetik bir kalıntı, bağlayıcı olan LICENSE dosyası.)
- **Dil:** Python (≥3.9 hedefli; tip açıklamalı, immutable dataclass ağırlıklı). Test dışı ~73k satır Python.
- **Son commit tarihi:** 2026-11-16 (`git log -1 --format=%cs`). Sürüm: `metricflow/__about__.py` → `0.215.0.dev0`.
- **Runtime bağımlılıkları** (`requirements-files/requirements.txt`): Jinja2, pydantic, PyYAML, jsonschema, rapidfuzz, python-dateutil, more-itertools, tabulate, typing_extensions, sqlglot (yalnızca OSI dönüştürücüsünde). Hepsi MIT/BSD/Apache uyumlu (bağımlılık lisansları tek tek doğrulanmadı — kullanılacaksa ayrıca kontrol edilmeli). **dbt-core'a bağımlılık yok**; `dbt-metricflow` ayrı paket.

## Ne yapıyor (3-5 cümle)

MetricFlow, dbt Semantic Layer'ın sorgu derleyicisidir: YAML ile tanımlanan *semantic model*'ler (tablo + entity + dimension + measure) ve *metric*'ler (simple / ratio / derived / cumulative / conversion) üzerinden gelen "metrik listesi + group-by + where + order/limit" isteğini, motor-spesifik SQL'e derler. Derleme üç ara temsil üzerinden geçer: (1) *Metric Evaluation Plan* (metrik bağımlılık DAG'i), (2) *Dataflow Plan* (Read → Join → Filter → Aggregate → Compute → Combine düğümlerinden oluşan mantıksal DAG), (3) *SQL Plan* (SELECT/JOIN/CTE düğüm ağacı). Join yolları entity'ler (birincil/yabancı anahtar benzeri) üzerinden otomatik bulunur ve *fan-out* üretecek join'ler entity tipleriyle engellenir. SQL plan, kolon budama ve subquery birleştirme optimizasyonlarından geçip 10 farklı lehçeye (Postgres, Snowflake, BigQuery, Redshift, Databricks, DuckDB, Trino, Athena, Vertica, ClickHouse) render edilir. **SQL Server / T-SQL desteği yok.**

## Mimari (ana klasörler ve sorumlulukları, veri akışı)

Repo üç Python paketi + yardımcılardan oluşur:

| Klasör | Sorumluluk |
|---|---|
| `metricflow_semantic_interfaces/` | Şema katmanı (eski adı dbt-semantic-interfaces). `protocols/` (Metric, SemanticModel, Entity, Dimension, Measure arayüzleri), `implementations/` (Pydantic modelleri), `parsing/` (YAML yükleyici, JSON schema, Jinja `where_filter` parser), `transformations/` (manifest normalize kuralları: measure→simple metric dönüşümü vb.), `validations/` (manifest doğrulama kuralları), `type_enums/` (MetricType, EntityType, AggregationType, TimeGranularity). |
| `metricflow_semantics/` | Semantik çözümleme katmanı. `model/semantics/` (lookup'lar, **`semantic_model_join_evaluator.py`**), `semantic_graph/` (entity/dimension/metric graf modeli + trie tabanlı isim çözümleyici), `query/` (query parser, group-by item çözümleme DAG'i, hata/öneri üretimi), `specs/` (MetricSpec, DimensionSpec, TimeDimensionSpec, EntitySpec, WhereFilterSpec, LinkableSpecSet), `sql/sql_exprs.py` (SQL ifade AST'i), `instances.py`. |
| `metricflow/` | Derleyici ve yürütücü. `engine/metricflow_engine.py` (giriş noktası), `metric_evaluation/` (metrik bağımlılık planı), `dataflow/` (builder + nodes + optimizer), `dataset/` (semantic model → SqlDataSet dönüşümü), `plan_conversion/` (dataflow → SQL plan), `sql/` (SQL plan düğümleri, `optimizer/`, `render/` lehçeler), `execution/`, `protocols/sql_client.py` (SqlEngine enum). `converters/` (OSI ↔ MSI dönüştürücü). |
| `sidecar/` | MetricFlow'u Nuitka ile native binary'ye derleyip stdin/stdout üzerinden **NDJSON IPC (mf-ipc v1)** ile "sadece SQL derle" servisi olarak sunar (dbt-core v2 / Fusion bunu subprocess olarak çağırıyor). |
| `dbt-metricflow/` | `mf` CLI ve dbt adaptörü üzerinden SqlClient entegrasyonu. |
| `tests_metricflow/snapshots/` | Her test için motor bazında **ham ve optimize SQL snapshot'ları** (`__plan0.sql`, `__plan0_optimized.sql`). Derleyici davranışını anlamak için en iyi kaynak. |

**Veri akışı (tek sorgu):**

```
MetricFlowQueryRequest (metric_names, group_by_names, where_constraints, order_by, limit)
  └─ MetricFlowQueryParser.parse_and_validate_query()        [metricflow_semantics/query/query_parser.py]
       → MetricFlowQuerySpec (metric_specs, dimension_specs, time_dimension_specs, entity_specs,
                              filter_intersection, filter_spec_resolution_lookup, ...)
  └─ DataflowPlanBuilder.build_plan()                         [metricflow/dataflow/builder/dataflow_plan_builder.py]
       ├─ DepthFirstSearchMetricEvaluationPlanner.build_plan() → MetricEvaluationPlan (metrik DAG'i)
       ├─ her MetricQueryNode → dataflow alt-ağacı (simple / derived / cumulative / conversion)
       │    └─ _find_source_node_recipe() → en az join'li kaynak + JoinLinkableInstancesRecipe listesi
       ├─ build_sink_node (OrderByLimit, WriteToDataTable)
       └─ _optimize_plan() (SourceScanOptimizer: ortak kaynakları birleştirir)
  └─ DataflowToExecutionPlanConverter
       ├─ DataflowToSqlPlanConverter (visitor: her dataflow düğümü → SqlSelectStatementNode)
       ├─ SqlOptimizationLevel O0..O5 (column pruning, subquery reducer, alias simplifier, CTE)
       └─ <Engine>SqlPlanRenderer.render_sql_plan() → SQL string + bind parametreleri
  └─ SequentialPlanExecutor (SqlClient ile çalıştırır)
```

## Floem BI için kritik kısımlar

- `metricflow/engine/metricflow_engine.py` (`MetricFlowEngine.__init__`, `_create_execution_plan`, `explain`) → Kurulumda tüm semantic model'leri `SemanticModelToDataSetConverter` ile `SqlDataSet`'e çevirir, kaynak düğümleri bir kez cache'ler; her sorguda parse → dataflow → SQL plan → render zincirini çalıştırır. → **Floem BI'da "Query Engine / Measure Compiler" servisinin giriş noktası.** `explain()` (çalıştırmadan SQL üretme) ayrımı, DirectQuery modunda Gateway'e gönderilecek SQL'in üretimiyle birebir eşleşir.
- `metricflow_semantics/model/semantics/semantic_model_join_evaluator.py` → `_VALID_ENTITY_JOINS` / `_INVALID_ENTITY_JOINS` tabloları ile hangi entity tip çiftlerinin join edilebileceğini belirler (ör. `FOREIGN → PRIMARY` geçerli, `FOREIGN → FOREIGN` / `PRIMARY → FOREIGN` geçersiz = fan-out). `MAX_JOIN_HOPS = 2`. → **Floem BI'daki ilişki kardinalitesi (1:N, 1:1, N:1) ve "tek yönlü filtre" kuralının birebir karşılığı.** Power BI'ın "çok tarafı → bir tarafı" ilişki yönü kuralını bu tabloya map edebiliriz.
- `metricflow/dataflow/builder/node_evaluator.py` (`NodeEvaluatorForLinkableInstances`, `JoinLinkableInstancesRecipe`) → Ölçünün bulunduğu "left node" için, istenen boyutları (ör. `listing__country`) sağlayabilecek "right node"ları entity eşleşmesiyle bulur, join reçetesini (join entity, join tipi, partition join, SCD validity window) üretir. → **Floem BI'da "boyut nereden gelir, hangi ilişki yolundan join'lenir" çözümleyicisi** (Power BI'da ilişki üzerinden filtre yayılımının SQL tarafı).
- `metricflow/dataflow/builder/dataflow_plan_builder.py` → `_find_source_node_recipe_non_cached` (aday kaynaklar arasından **en az join gerektireni** seçer; join gerektirmeyen bulunursa erken çıkar), `_build_aggregated_simple_metric_input` + `_build_pre_aggregation_plan` (JoinOnEntities → Selector → WhereFilter → ConstrainTimeRange → SemiAdditiveJoin → Aggregate), `_build_derived_metric_output_node`, `_build_cumulative_metric_output_node`. → **Floem BI ölçü derleyicisinin "mantıksal plan" katmanı.** CALCULATE filtreleri = metrik-seviyesi `where_filter_specs`; zaman zekâsı (YTD, MTD, kayan pencere) = cumulative/offset düğümleri.
- `metricflow/dataflow/nodes/*.py` → Mantıksal operatör seti: `ReadSqlSourceNode`, `JoinOnEntitiesNode`, `FilterElementsNode`(Selector), `WhereFilterNode`, `ConstrainTimeRangeNode`, `AggregateSimpleMetricInputsNode`, `ComputeMetricsNode`, `CombineAggregatedOutputsNode`, `JoinToTimeSpineNode`, `JoinOverTimeRangeNode`, `SemiAdditiveJoinNode`, `WindowReaggregationNode`, `JoinConversionEventsNode`, `OrderByLimitNode`, `MinMaxNode`. → **Floem BI mantıksal sorgu IR'ının düğüm kataloğu için doğrudan şablon.**
- `metricflow/metric_evaluation/dfs_me_planner.py` + `metric_evaluation/plan/` → Türetilmiş metriklerin bağımlılık DAG'ini çıkarır (`bookings_per_listing → bookings, listings`), ortak alt metrikleri paylaşır. → **DAX'ta ölçünün başka ölçüyü çağırması** (`[Ciro] / [Adet]`) için ölçü bağımlılık grafiği.
- `metricflow/plan_conversion/to_sql_plan/dataflow_to_subquery.py` (`DataflowNodeToSqlSubqueryVisitor`) → Her dataflow düğümünü alt-sorguya çevirir. `visit_join_on_entities_node` join sonrası boyutları `entity__dim` olarak yeniden adlandırır ve önceden toplanmış ölçüleri `PARTIAL` duruma çeker (yeniden toplama gerekir); `visit_compute_metrics_node` metrik tipine göre ifade üretir (ratio → `SqlRatioComputationExpression`, derived → ham `SqlStringExpression`); `visit_combine_aggregated_outputs_node` farklı fact'lerden gelen metrikleri **FULL OUTER JOIN + COALESCE(boyutlar)** ile birleştirir. → **Floem BI SQL üretici çekirdeği.** Özellikle çoklu fact tablosu (ör. Satış + Bütçe) birleştirme kalıbı.
- `metricflow/plan_conversion/to_sql_plan/sql_join_builder.py` → Join ON koşullarını (entity, partition, SCD validity window `BETWEEN`) kurar. → Floem BI ilişki → `ON` koşulu üreticisi; SCD Type-2 boyut desteği.
- `metricflow_semantics/sql/sql_exprs.py` → 23 sınıflık SQL ifade AST'i (`SqlColumnReferenceExpression`, `SqlAggregateFunctionExpression`, `SqlWindowFunctionExpression`, `SqlCaseExpression`, `SqlDateTruncExpression`, `SqlRatioComputationExpression`, `SqlArithmeticExpression`, ...) + `rewrite()` ile kolon değiştirme. → **Floem BI'da DAX AST → SQL ifade AST'i hedefi.**
- `metricflow/sql/optimizer/` (`optimization_levels.py`, `column_pruning/`, `rewriting_sub_query_reducer.py`, `table_alias_simplifier.py`) → Naif üretilen iç içe subquery'leri sadeleştirir. Somut etki: `test_filter_with_where_constraint_on_join_dim__plan0.sql` 514 satır → optimize sürüm ~30 satır. → **Floem BI'da "önce doğru ama naif SQL üret, sonra ayrı optimizer pass'leriyle sadeleştir" yaklaşımı.**
- `metricflow/sql/render/sql_plan_renderer.py` + `expr_renderer.py` + `postgres.py`, `big_query.py`, ... → `DefaultSqlPlanRenderer`/`DefaultSqlExpressionRenderer` üzerinden lehçe başına override (`double_data_type`, `visit_date_trunc_expr`, `visit_percentile_expr`, `_render_limit_section`, ...). `postgres.py` ~130 satır. → **Floem BI'nın SQL Server (T-SQL) renderer'ı bu kalıpla yazılabilir** (TOP/OFFSET-FETCH, `DATETRUNC`/`DATEADD`, GROUP BY'da alias yasak → `use_column_alias_in_group_by=False`, `FLOAT` double tipi).
- `metricflow_semantics/specs/where_filter/where_filter_spec.py` → Filtreler Jinja şablonu (`"{{ Dimension('listing__country') }} = 'us'"`) olarak gelir, render edilip `where_sql` string'i + kullanılan boyut spec'leri çıkarılır. → Floem BI slicer/cross-filter'ının karşılığı ama **yapısal değil, string tabanlı** (aşağıda zayıf yönler).
- `metricflow_semantics/semantic_graph/` (`builder/entity_join_subgraph.py`, `attribute_resolution/recipe_writer_weight.py`, `trie_resolver/`) → Manifest'ten "model → entity → model" grafı kurar; bir metrik için erişilebilir tüm group-by öğelerini (dunder isimleriyle) hesaplar, tekrar eden model/isimleri ve `MAX_JOIN_HOPS` üstünü engeller. → **Floem BI rapor tasarımcısında "bu ölçüyle hangi alanlar kullanılabilir" listesini (alan paneli gri/aktif) besleyen servis.**
- `sidecar/mf_entry.py` + `mf_ipc_protocol.py` → Derleyiciyi durumsuz "explain" servisi olarak dışarı açar. → Floem BI'da derleyicinin ayrı süreç/servis olarak izole edilmesine örnek.
- `tests_metricflow/snapshots/**/SqlPlan/<Engine>/*.sql` → Motor bazında snapshot test. → **Floem BI derleyicisi için golden-SQL snapshot test stratejisi.**

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)

Temel kavramlar (`metricflow_semantic_interfaces/type_enums/`):
- **Semantic model** = bir tablo/view (`node_relation`) + `entities` + `dimensions` + `measures` (+ `defaults.agg_time_dimension`, `primary_entity`).
- **Entity** tipleri: `primary`, `unique`, `foreign`, `natural` (SCD için). İlişkiler **açıkça tanımlanmaz**; aynı isimli entity'ler üzerinden örtük kurulur (Power BI'daki explicit relationship nesnesinden farklı).
- **Dimension**: `categorical` veya `time` (`time_granularity`, `is_partition`, SCD için `validity_params`).
- **Measure** agg tipleri: `sum, min, max, count_distinct, sum_boolean, average, percentile, median, count` (+ `agg_params`, `non_additive_dimension` = semi-additive, ör. bakiye).
- **Metric** tipleri: `simple, ratio, cumulative, derived, conversion`. Her metrik girdisine `filter`, `offset_window`, `offset_to_grain`, `alias` eklenebilir; simple metrikte `fill_nulls_with`, `join_to_timespine`.
- Not: Yeni sürümlerde `measures` kavramı simple metric içine taşınıyor (`metric_aggregation_params`, `transformations/flatten_simple_metrics_with_measure_inputs.py`, `replace_input_measures_with_simple_metrics_transformation.py`); eski YAML transformation kurallarıyla yeni iç modele çevriliyor.

Gerçek örnek — `metricflow_semantics/test_helpers/semantic_manifest_yamls/sg_02_single_join/manifest.yaml`:

```yaml
semantic_model:
  name: bookings_source
  node_relation:
    schema_name: $source_schema
    alias: bookings_source
  defaults:
    agg_time_dimension: booking_time
  entities:
    - name: booking
      type: primary
    - name: listing
      type: foreign
  measures:
    - name: booking_count
      expr: "1"
      agg: sum
  dimensions:
    - name: booking_time
      type: time
      type_params:
        time_granularity: quarter
---
semantic_model:
  name: listings_source
  node_relation: { schema_name: $source_schema, alias: listings_source }
  entities:
    - name: listing
      type: primary
  dimensions:
    - name: country_latest
      type: categorical
---
metric:
  name: bookings
  type: simple
  type_params:
    measure: booking_count
```

Metrik tipleri — `simple_manifest/metrics.yaml`'dan gerçek örnekler:

```yaml
metric:
  name: bookings_per_booker
  type: ratio
  type_params:
    numerator: { name: bookings }
    denominator: { name: bookers }
---
metric:
  name: instant_booking_fraction_of_max_value
  type: ratio
  type_params:
    numerator:
      name: average_booking_value
      filter: "{{ Dimension('booking__is_instant') }}"   # ≈ CALCULATE([x], is_instant = TRUE)
    denominator:
      name: max_booking_value
---
metric:
  name: booking_fees_last_week_per_booker_this_week
  type: derived
  type_params:
    expr: "booking_value * 0.05 / bookers"              # ham SQL ifadesi
    metrics:
      - name: booking_value
        offset_window: 1 week                            # ≈ DATEADD(..., -7, DAY)
      - name: bookers
---
metric:
  name: revenue_mtd
  type: cumulative
  type_params:
    measure: txn_revenue
    cumulative_type_params:
      grain_to_date: month                               # ≈ TOTALMTD
---
metric:
  name: trailing_2_months_revenue
  type: cumulative
  type_params:
    measure: txn_revenue
    cumulative_type_params:
      window: 2 month                                    # kayan pencere
      period_agg: average
```

Semi-additive örnek (`simple_manifest/semantic_models/accounts_source.yaml`) — DAX'taki `LASTNONBLANK`/kapanış bakiyesi karşılığı:

```yaml
    - name: current_account_balance_by_user
      agg: sum
      expr: account_balance
      non_additive_dimension:
        name: ds
        window_choice: max
        window_groupings:
          - user
```

Sorgu tarafı isimlendirme: boyutlar **dunder** yollarıyla adreslenir — `listing__country_latest` = "listing entity'si üzerinden ulaşılan country_latest". Çok adımlı join: `user__device__platform`. `metric_time` özel zaman boyutudur (her metriğin `agg_time_dimension`'ına map edilir) ve `metric_time__month` gibi grain sonekleri alır. Pydantic şema: `metricflow_semantic_interfaces/implementations/metric.py` (`PydanticMetricTypeParams`), JSON schema: `metricflow_semantic_interfaces/parsing/generated_json_schemas/`.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)

**Örnek istek** (`tests_metricflow/query_rendering/test_query_rendering.py::test_filter_with_where_constraint_on_join_dim`):
`metric_names=("bookings",)`, `group_by_names=("booking__is_instant",)`, `where = "{{ Dimension('listing__country_latest') }} = 'us'"`

1. **Parse & resolve** (`MetricFlowQueryParser`): isimler spec'lere çevrilir; `listing__country_latest` → `DimensionSpec(element_name='country_latest', entity_links=('listing',))`. Belirsiz isimler group-by çözümleme DAG'i (`metricflow_semantics/query/group_by_item/resolution_dag/`) ile çözülür; hata durumunda `rapidfuzz` ile öneri üretilir (`query/suggestion_generator.py`).
2. **Metric evaluation plan**: `DepthFirstSearchMetricEvaluationPlanner` → `TopLevelQuery → SimpleMetricsQuery([bookings])`. Derived/ratio'da alt metriklere dallanır.
3. **Kaynak seçimi + join reçetesi** (`_find_source_node_recipe_non_cached`): `bookings` measure'ını içeren kaynak düğümler "left", tüm kaynaklar "right" adayı. `NodeEvaluatorForLinkableInstances.evaluate_node` her left için: lokal olarak karşılanan spec'ler + `listing` entity'si ile `listings_latest`'e join reçetesi. `SemanticModelJoinEvaluator` `foreign → primary` olduğu için onay verir. **En az join'li aday seçilir.** Metrik sorgularında join tipi `LEFT OUTER`, sadece boyut sorgularında `FULL OUTER`.
4. **Dataflow alt-ağacı** (`_build_pre_aggregation_plan`): `ReadSqlSourceNode(bookings_source)` → `MetricTimeDimensionTransformNode` → `JoinOnEntitiesNode(listings_latest on listing)` → `SelectorNode` → `WhereFilterNode` → `SelectorNode` → `AggregateSimpleMetricInputsNode` → `ComputeMetricsNode` → `WriteToResultDataTableNode`. Filtre push-down: `PredicatePushdownState` ile zaman kısıtları ve uygun filtreler join'den önce kaynağa itilebilir.
5. **Dataflow optimizer**: `SourceScanOptimizer` (aynı kaynaktan okunan dalları tek taramada birleştirir, `cm_branch_combiner.py`).
6. **SQL plan**: `DataflowNodeToSqlSubqueryVisitor` her düğüm için bir `SqlSelectStatementNode` (iç içe subquery) üretir — ham çıktı 514 satır.
7. **SQL optimize** (varsayılan `O5`): `SqlColumnPrunerOptimizer` → `SqlRewritingSubQueryReducer` → `SqlTableAliasSimplifier` + CTE izni.
8. **Render** (`PostgresSQLSqlPlanRenderer`) — gerçek snapshot (`tests_metricflow/snapshots/test_query_rendering.py/SqlPlan/Postgres/test_filter_with_where_constraint_on_join_dim__plan0_optimized.sql`):

```sql
SELECT
  booking__is_instant
  , SUM(bookings) AS bookings
FROM (
  -- Join Standard Outputs
  SELECT
    subq_12.booking__is_instant AS booking__is_instant
    , listings_latest_src_28000.country AS listing__country_latest
    , subq_12.__bookings AS bookings
  FROM (
    SELECT
      listing_id AS listing
      , is_instant AS booking__is_instant
      , 1 AS __bookings
    FROM ***.fct_bookings bookings_source_src_28000
  ) subq_12
  LEFT OUTER JOIN
    ***.dim_listings_latest listings_latest_src_28000
  ON
    subq_12.listing = listings_latest_src_28000.listing_id
) subq_17
WHERE listing__country_latest = 'us'
GROUP BY
  booking__is_instant
```

**Çok fact'li ratio** (`bookings_per_listing`, boyutsuz) — her metrik kendi fact'inde ayrı toplanır, sonra birleştirilir (boyut yoksa `CROSS JOIN`, boyut varsa `FULL OUTER JOIN ... ON COALESCE(...)`), payda `NULLIF(...,0)` ile korunur:

```sql
SELECT
  CAST(MAX(subq_19.bookings) AS DOUBLE PRECISION) / CAST(NULLIF(MAX(subq_25.listings), 0) AS DOUBLE PRECISION) AS bookings_per_listing
FROM (SELECT SUM(1) AS bookings FROM ***.fct_bookings bookings_source_src_28000) subq_19
CROSS JOIN (SELECT SUM(1) AS listings FROM ***.dim_listings_latest listings_latest_src_28000) subq_25
```

Bu "**önce her ölçüyü kendi fact grain'inde topla, sonra ortak boyutlar üzerinde birleştir**" yaklaşımı, chasm/fan trap'i önleyen ve Power BI'ın çoklu fact davranışına en yakın SQL desenidir.

## Alınacak fikirler

1. **Üç katmanlı IR:** Ölçü bağımlılık planı → mantıksal dataflow DAG → fiziksel SQL AST → lehçe renderer. DAX derleyicimizde de DAX AST'ten doğrudan SQL string üretmek yerine benzer bir mantıksal plan katmanı olmalı (test edilebilirlik, optimizasyon, çoklu lehçe).
2. **Entity tipiyle fan-out koruması:** `_VALID_ENTITY_JOINS` tablosu kadar basit bir kural seti. Floem BI'da ilişki kardinalitesini (1:N, 1:1) ve filtre yönünü kullanarak "geçerli join yönü" tablosu kurulmalı; N:N join'ler ancak köprü tablo/explicit izinle.
3. **Ölçü başına ayrı toplama + COALESCE'li FULL OUTER JOIN ile birleştirme** (`visit_combine_aggregated_outputs_node`). Satış + Bütçe gibi farklı fact'lerden gelen ölçüler aynı görselde olduğunda doğru sonuç verir.
4. **Toplama durumu takibi** (`AggregationState.NON_AGGREGATED / PARTIAL / COMPLETE`): join sonrası yeniden toplama gerekip gerekmediğini tip sisteminde izlemek, sessiz çift sayımı engeller.
5. **En az join'li kaynak seçimi** (`node_with_lowest_cost_plan`): aynı ölçü birden fazla tabloda (ör. Import aggregate tablosu + detay tablo) varsa en ucuz olanı seçmek → ileride Floem BI'ın "aggregation table / pre-aggregation" özelliğine temel.
6. **Semi-additive measure** (`non_additive_dimension` + `window_choice` + `window_groupings`) → stok/bakiye ölçüleri için (SAP B1'de çok yaygın) doğrudan model alınacak tanım.
7. **Time spine** (tarih tablosu) zorunlu ve birinci sınıf: cumulative, offset (`offset_window`, `offset_to_grain`), `join_to_timespine`, `fill_nulls_with`, custom granularity (mali yıl) hep spine üzerinden. Floem BI tarih tablosu = time spine; DAX zaman zekâsı fonksiyonları bu düğümlere derlenir.
8. **Naif üret + ayrı optimizer pass'leri** (`SqlOptimizationLevel O0..O5`): doğruluğu basit tutar; debug için optimizasyon seviyesi düşürülebilir.
9. **Lehçe renderer'ı visitor override kalıbı**: SQL Server renderer'ımızı aynı kalıpla yazmak (~150-300 satır tahmini).
10. **Golden SQL snapshot testleri** motor başına; ham + optimize iki snapshot.
11. **Erişilebilir alanlar servisi** (semantic graph + `list_dimensions(metric_names)`) → rapor tasarımcısında seçilen ölçüyle uyumsuz alanları gri gösterme.
12. **Kullanıcı dostu hata + öneri** (rapidfuzz ile "bunu mu demek istediniz") — ölçü dili editöründe faydalı.
13. **Derleyiciyi durumsuz "explain" servisi** olarak izole etmek (sidecar/NDJSON): DirectQuery'de SQL'i merkezde derleyip Gateway'e göndermek için temiz sınır.

## Kaçınılacaklar / zayıf yönler

- **SQL Server / T-SQL renderer yok** (`SqlEngine` enum: BigQuery, DuckDB, Redshift, Postgres, Snowflake, Databricks, Trino, Vertica, Athena, ClickHouse). Floem BI'ın ana kaynağı SQL Server + SAP B1 (HANA/MSSQL); HANA da yok. Kullanılsa bile renderer yazmak gerekir.
- **Filtre bağlamı modeli yok:** DAX'ın filtre bağlamı, `CALCULATE` ile bağlam değiştirme, `ALL/ALLEXCEPT/REMOVEFILTERS`, satır bağlamı / iterator (`SUMX`), context transition kavramları yok. Metrik filtreleri yalnızca **ek AND kısıtı** (filtre kaldırma / üzerine yazma yok). Yüzde-toplam (`DIVIDE(x, CALCULATE(x, ALL(...)))`) gibi kalıplar doğrudan ifade edilemez.
- **Derived metric `expr` ve where filtreleri ham SQL string'i:** `SqlStringExpression.create(sql_expr=metric.type_params.expr)`; filtreler Jinja şablonu render edilip `where_sql` string'i oluyor. Ayrıştırılmış AST yok → lehçe bağımsızlığı, tip kontrolü ve **SQL injection koruması** zayıf. Floem BI'da slicer/cross-filter değerleri mutlaka yapısal filtre AST'i + bind parametresi ile taşınmalı.
- **Örtük ilişkiler** (aynı isimli entity'ler): Power BI'daki açık ilişki nesnesi, aktif/pasif ilişki (`USERELATIONSHIP`), çift yönlü filtre, rol oynayan boyutlar (ör. sipariş tarihi / teslim tarihi) için doğrudan karşılık yok; isim çakışmaları belirsizliğe yol açıyor.
- **`MAX_JOIN_HOPS = 2`** sabit sınırı ve multi-hop'ta `len(entity_links) != 2` için özel kod yolu (`node_processor.py`). Snowflake şemalarında (SAP B1: OINV → INV1 → OITM → OITB) yetersiz kalabilir.
- **Self-join yasak** (`entity_join_subgraph.py`: "Joining a semantic model to itself is currently not allowed"), `natural → natural` join yasak, iki SCD tablosu arası join yasak.
- **RLS / çok kiracılık yok:** Güvenlik katmanı tamamen dışarıda; filtre enjeksiyonu kullanıcıya bırakılmış.
- **Önbellek / pre-aggregation / Import modu yok** (sadece SQL derleme + çalıştırma). Cube.js'in aksine materyalizasyon yönetimi yok.
- **Karmaşıklık:** `dataflow_plan_builder.py` 2495 satır, `dataflow_to_subquery.py` 2407 satır; çok sayıda özel durum (custom granularity, offset, conversion, SCD). Kodu doğrudan fork'lamak yüksek bakım maliyeti getirir; ayrıca API kararlılık garantisi yok (`MetricFlowEngine` docstring: *"TODO: provide a more stable API layer instead of assuming this class is stable."*).
- **Global durum:** `SequentialIdGenerator.reset(...)` sorgu başına global ID sayacını sıfırlıyor → eşzamanlı (multi-thread) kullanımda deterministik alias garantisi şüpheli (doğrulanmadı; çok kiracılı sunucuda kullanılacaksa test edilmeli).
- **Lisans geçmişi riski:** 0.150–0.208 BSL, ≤0.140 AGPL. Yalnızca ≥0.209.0 alınmalı; internetteki eski kod parçaları/fork'lar kullanılmamalı.
- Ham (O0) SQL çok şişkin (514 satır) — optimizer'a bağımlılık yüksek; optimizer hatası = yanlış/okunmaz SQL.

## Kullanım kararı: Fikir al

**Gerekçe:** Lisans (≥0.209, Apache 2.0) bağımlılık olarak kullanmaya veya fork'lamaya teknik olarak izin veriyor (NOTICE/atıf yükümlülüğüyle). Ancak (1) SQL Server/HANA renderer'ı yok, (2) DAX'ın filtre bağlamı semantiği (CALCULATE ile filtre kaldırma/değiştirme, iterator'lar, USERELATIONSHIP) modelde yok ve eklemek çekirdek planlayıcıyı değiştirmeyi gerektirir, (3) ifade ve filtreler string tabanlı, (4) API kararlılığı yok ve kod tabanı çok büyük/özel durum yoğun. Bu nedenle Floem BI ölçü derleyicisini kendi IR'ımızla yazıp MetricFlow'dan **mimari kalıpları** almak en doğrusu: üç katmanlı IR, entity-tipi tabanlı fan-out kuralları, ölçü başına toplama + COALESCE birleştirme, semi-additive ve time-spine tasarımı, optimizer pass'leri, lehçe renderer visitor kalıbı, snapshot testleri.

**İkincil seçenek (değerlendirilebilir):** Prototip/MVP aşamasında, Floem BI semantik modelinin "basit" alt kümesini (DAX'sız; sadece ölçü + boyut + AND filtre) MetricFlow manifest'ine çevirip `MetricFlowEngine.explain()` ile SQL üretmek ve SQL Server için ince bir renderer eklemek hızlı bir referans/oracle olabilir — kendi derleyicimizin çıktısını karşılaştırmak için test oracle'ı olarak kullanmak. Belirli bir sürüme (≥0.209.0) pinlenmeli; Apache 2.0 NOTICE gereklilikleri karşılanmalı.
