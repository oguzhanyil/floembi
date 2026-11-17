# Apache Superset

- **URL:** https://github.com/apache/superset
- **Lisans:** Apache License 2.0 — **doğrulandı** (kök `LICENSE.txt`, "Apache License Version 2.0, January 2004"). Alt paketlerde ayrı lisans dosyası yalnızca `superset-core/LICENSE.txt` ve `superset-extensions-cli/LICENSE.txt` (ikisi de Apache 2.0). `ee/` veya `enterprise/` benzeri farklı lisanslı klasör **yok**. `superset-frontend` altındaki 23 `package.json` dosyasının hepsinde `"license": "Apache-2.0"`, `superset-embedded-sdk/package.json` de Apache-2.0.
  - **Dikkat (üçüncü taraf bağımlılıklar):** `plugin-chart-point-cluster-map` ve `preset-chart-deckgl` `mapbox-gl` (v2+ sürümleri tescilli Mapbox lisansı) kullanıyor. Python tarafında MSSQL için önerilen sürücü `pymssql` (LGPL, dinamik bağlama ile genelde sorunsuz ama hukuki kontrol gerekir). Floem BI bu parçaları almamalı.
- **Dil:** Python (Flask, Flask-AppBuilder, SQLAlchemy 2.0, sqlglot, pandas/pyarrow) + TypeScript/React (frontend, ECharts, ag-grid-community 36.3.0)
- **Son commit tarihi:** 2026-11-17 (`git log -1 --format=%cs`, `--depth 1` klon)

## Ne yapıyor (3-5 cümle)
Superset, SQLAlchemy uyumlu ~70 veritabanına bağlanan, web tabanlı bir keşif/dashboard platformu. Kullanıcı bir "dataset" (fiziksel tablo veya SQL ile tanımlı sanal tablo) üzerinde sütunlar ve SQL ifadesi olarak saklanan metrikler tanımlar; Explore ekranında chart oluşturur, chart'ları 12 kolonlu sürükle-bırak grid'e dizerek dashboard yapar. Her chart isteği bir `QueryContext`/`QueryObject` JSON'ına dönüşür, backend bunu SQLAlchemy ile tek tabloya karşı SQL'e derler, sonucu pandas ile post-process eder ve önbelleğe alır. RLS, dataset+rol bazlı WHERE cümleleriyle; embed ise guest-token JWT + iframe + `postMessage` ile yapılır. Yeni sürümde (feature flag arkasında) harici semantik katmanları takılabilir provider olarak bağlayan bir "Semantic Layer" SDK'sı da var.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)

| Klasör | Sorumluluk |
|---|---|
| `superset/db_engine_specs/` | Her veritabanı için diyalekt farkları: time grain SQL'leri, identifier quoting, limit yöntemi, hata eşleme, OAuth2, metadata keşfi, RLS yöntemi. `base.py` (3889 satır) `BaseEngineSpec`; `mssql.py`, `postgres.py` vb. alt sınıflar. Harici spec'ler `entry_points(group="superset.db_engine_specs")` ile yüklenir (`__init__.py:80`). |
| `superset/connectors/sqla/models.py` | Semantik katmanın ORM'i: `SqlaTable` (dataset), `TableColumn`, `SqlMetric`, `RowLevelSecurityFilter`. |
| `superset/models/helpers.py` | `ExploreMixin.get_sqla_query()` (satır 6684'ten ~8200'e kadar, tek fonksiyon ~1500 satır): QueryObject → SQLAlchemy `Select`. Ayrıca `adhoc_metric_to_sqla`, `get_query_str_extended`, `exc_query`. |
| `superset/common/` | `query_object.py` (QueryObject), `query_context.py`, `query_context_processor.py` (cache, df payload), `query_actions.py`, `query_object_factory.py`. |
| `superset/utils/pandas_postprocessing/` | SQL sonrası pandas işlemleri: `pivot`, `rolling`, `cum`, `contribution`, `compare`, `resample`, `prophet`, `rank`... |
| `superset/sql/parse.py` | sqlglot tabanlı SQL ayrıştırma; `RLSAsPredicateTransformer`, `RLSAsSubqueryTransformer` (SQL Lab ve sanal dataset'lere RLS enjeksiyonu). |
| `superset/security/manager.py` (7361 satır) | Yetki, `get_rls_filters`, guest token üretimi/çözümü (`create_guest_access_token`), dataset erişim kontrolü. |
| `superset/subjects/` | Yeni "subject" soyutlaması: `SubjectType.USER/ROLE/GROUP`; RLS ve sahiplik artık subject'lere bağlanıyor. |
| `superset/embedded/`, `superset/embedded_dashboard/` | Embed config (izinli domainler), embedded view. |
| `superset/semantic_layers/` + `superset-core/src/superset_core/semantic_layers/` | Takılabilir harici semantik katman SDK'sı (`SemanticLayer`, `SemanticView`, `SemanticQuery`), `SEMANTIC_LAYERS` feature flag'i (varsayılan `False`, `config.py:776`). |
| `superset/explorables/base.py` | `Explorable` Protocol: `SqlaTable` ve `SemanticView` için ortak arayüz (`get_query_result`, `metrics`, `columns`). |
| `superset/jinja_context.py` | SQL içi Jinja makroları: `current_username`, `current_user_roles`, `filter_values`, `url_param`, `metric`, `dataset`. |
| `superset-frontend/packages/superset-ui-core` | Chart plugin altyapısı (`ChartPlugin`, registry'ler, `buildQueryContext`, `DataMask`). |
| `superset-frontend/packages/superset-ui-chart-controls` | Explore kontrol paneli tanım DSL'i. |
| `superset-frontend/packages/superset-ui-switchboard` | iframe ↔ host `MessageChannel` RPC katmanı. |
| `superset-frontend/plugins/*` | Chart eklentileri (echarts, table, ag-grid-table, pivot-table, deckgl, ...). |
| `superset-frontend/src/dashboard/` | Dashboard grid, native filter'lar, cross-filter, layout reducer'ları. |
| `superset-embedded-sdk/` | Host sayfada iframe kuran `embedDashboard()` SDK'sı. |

**Veri akışı (chart):**
```
Plugin buildQuery(formData) ──► POST /api/v1/chart/data  {datasource, queries:[QueryObject...], result_type}
  → QueryContextFactory → QueryContext → QueryContextProcessor.get_df_payload()
      → cache_key (query_cache_key) → data_cache hit? → döndür
      → datasource.get_query_result(query_obj)            (Explorable)
          SqlaTable: query() → get_query_str_extended() → get_sqla_query()
                    → database.compile_sqla_query() → exc_query() → DataFrame
          SemanticView: SemanticQuery → provider.get_table() → pyarrow.Table
      → query_obj.exec_post_processing(df)  (pandas_postprocessing)
  → JSON → plugin transformProps() → React/ECharts bileşeni
```

## Floem BI için kritik kısımlar

- `superset/db_engine_specs/base.py` → `BaseEngineSpec`: `engine`, `_time_grain_expressions`, `identifier_quote_start/end`, `get_limit_method`, `get_rls_method`, `extract_errors`, `get_dbapi_exception_mapping`, `get_table_names/get_columns`, OAuth2 akışı, `impersonate_user`, `_extended_aggregations` → **Floem BI "Connector/Dialect" katmanı**. DAX→SQL derleyicinin hedef diyalekt farklarını (DATEADD vs date_trunc, `TOP` vs `LIMIT`, `[ ]` quoting) tek sınıfta toplama örneği.
- `superset/db_engine_specs/mssql.py` → SQL Server time grain'leri ve quoting. Örnek:
  ```python
  class MssqlEngineSpec(BasicParametersMixin, BaseEngineSpec):
      engine = "mssql"
      identifier_quote_start: str = "["
      identifier_quote_end: str = "]"
      max_column_name_length = 128
      allows_cte_in_subquery = False
      _time_grain_expressions = {
          TimeGrain.MONTH: "DATEADD(MONTH, DATEDIFF(MONTH, 0, {col}), 0)",
          TimeGrain.YEAR:  "DATEADD(YEAR, DATEDIFF(YEAR, 0, {col}), 0)",
          ...
  ```
  → Floem BI'ın birincil kaynağı SQL Server/SAP B1 olduğu için **doğrudan referans** (Apache 2.0, gerekirse tablo içerikleri uyarlanabilir).
- `superset/db_engine_specs/__init__.py:64 load_engine_specs()` → entry point ile 3. parti connector yükleme → Floem BI connector eklenti mekanizması.
- `superset/connectors/sqla/models.py` (`SqlaTable`, `TableColumn`, `SqlMetric`) → Floem semantik modelde **Table / Column / Measure** karşılığı (ama ilişki yok, bkz. zayıf yönler).
- `superset/models/helpers.py:6684 get_sqla_query()` → ölçü+boyut+filtre → SQL derleyici. Floem'un "ölçü planı → SQL" katmanının **en basit (tek tablo) hali**.
- `superset/common/query_object.py` → `QueryObject` (metrics, columns, filters, extras.where/having, orderby, row_limit, series_limit, time_range, time_shift, post_processing, grouping_sets) → Floem BI görsel ↔ sorgu motoru arasındaki **sorgu sözleşmesi (wire format)**.
- `superset/utils/pandas_postprocessing/` → SQL'de değil bellekte yapılan hesaplar (`contribution`, `cum`, `rolling`, `compare` = time shift). → Floem'da zaman zekâsının bir kısmı (YoY, running total) SQL yerine post-processing'e kaydırılabilir; ama DAX semantiği için SQL tarafında yapılması daha doğru.
- `superset/connectors/sqla/models.py:1178 get_sqla_row_level_filters()` + `superset/security/manager.py:6295 get_rls_filters()` → **RLS** (Floem: Role + DAX filtresi karşılığı).
- `superset/sql/parse.py:413-545 RLSTransformer` → sqlglot AST üstünde tabloları alt sorguyla sarma → Floem'da DirectQuery/serbest SQL'e RLS enjeksiyonu için örnek.
- `superset/security/manager.py:6593 create_guest_access_token()` + `superset/security/guest_token.py` → **embed token** (Floem: Power BI "Embed Token" karşılığı).
- `superset-embedded-sdk/src/index.ts` → `embedDashboard()`, `EmbeddedDashboard` API'si (`getDataMask`, `setDataMask`, `observeDataMask`, `setThemeConfig`, `getDashboardPermalink`) → Floem BI JS embed SDK'sı (Power BI JS SDK karşılığı).
- `superset-frontend/packages/superset-ui-core/src/chart/models/ChartPlugin.ts` → görsel eklenti sözleşmesi → Floem "custom visual" API'si.
- `superset-frontend/src/dashboard/util/constants.ts`, `componentTypes.ts`, `gridComponents/` → 12 kolonlu grid ve ağaç yapılı layout → Floem rapor sayfası/dashboard yerleşimi.
- `superset-frontend/src/dashboard/util/crossFilters.ts` + `DataMask` (`superset-ui-core/src/chart/types/Base.ts:72`) → **cross-filter / slicer** durumu.
- `superset-core/src/superset_core/semantic_layers/{layer,view,types}.py` → harici semantik motoru BI ön yüzüne bağlama sözleşmesi → Floem semantik motorunun **iç API'si için çok iyi bir şablon** (bkz. aşağı).

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)

### 1) Klasik model: tek tablolu "dataset"
Superset'te gerçek bir semantik model **yok**; her dataset bağımsız, tablolar arası ilişki/kardinalite/filtre yönü kavramı yok. Join gerekiyorsa kullanıcı "virtual dataset" (`SqlaTable.sql`) içinde SQL yazar.

```python
# superset/connectors/sqla/models.py:1741
class SqlMetric(AuditMixinNullable, ImportExportMixin, CertificationMixin, Model):
    __tablename__ = "sql_metrics"
    __table_args__ = (UniqueConstraint("table_id", "metric_name"),)
    metric_name = Column(String(255), nullable=False)
    verbose_name = Column(String(1024))
    metric_type = Column(String(32))
    d3format = Column(String(128))
    currency = Column(CurrencyType, nullable=True)
    warning_text = Column(Text)
    table_id = Column(Integer, ForeignKey("tables.id", ondelete="CASCADE"))
    expression = Column(utils.MediumText(), nullable=False)   # ham SQL: "SUM(num) / COUNT(*)"
```
`SqlaTable` alanları: `table_name`, `schema`, `catalog`, `database_id`, `sql` (sanal dataset), `main_dttm_col`, `fetch_values_predicate`, `template_params`, `normalize_columns`, `always_filter_main_dttm`, `folders` (JSON, alan klasörleri), `partition_column`. `TableColumn`: `column_name`, `type`, `is_dttm`, `groupby`, `filterable`, `expression` (hesaplanmış sütun SQL'i), `python_date_format`, `advanced_data_type`.

Ölçü = **ham SQL agregasyon ifadesi**. Ad-hoc metrikler iki türlü: `SIMPLE` (`{aggregate: "SUM", column: {column_name}}`) ve `SQL` (`{sqlExpression}`) — `helpers.py:5043 adhoc_metric_to_sqla`. Ölçünün başka ölçüye referansı yalnızca Jinja `{{ metric('x') }}` makrosu ile (`jinja_context.py:1365`); filtre bağlamı / CALCULATE benzeri bir şey **yok**.

### 2) Yeni: Semantic Layer SDK (`superset-core`, feature flag `SEMANTIC_LAYERS`)
Harici bir semantik motoru (Cube, MetricFlow, Snowflake semantic view gibi — repo içinde somut provider yok, provider'lar extension olarak `registry` dict'ine kaydoluyor) Superset'e "SemanticView" olarak bağlar. Tipler (`superset_core/semantic_layers/types.py`):

```python
@dataclass(frozen=True)
class Dimension:
    id: str; name: str; type: pa.DataType
    definition: str | None = None; description: str | None = None
    grain: Grain | None = None          # aynı name için (name, grain) varyantları
    verbose_name: str | None = ...; metadata: dict = ...

@dataclass(frozen=True)
class Metric:
    id: str; name: str; type: pa.DataType
    definition: str; aggregation: AggregationType | None = None ...

@dataclass(frozen=True)
class SemanticQuery:
    metrics: list[Metric]
    dimensions: list[Dimension]
    filters: set[FilterExpression] | None = None   # Filter | OrFilter, Operator enum
    order: list[OrderTuple] | None = None
    limit: int | None = None
    offset: int | None = None
    group_limit: GroupLimit | None = None          # top-N + "Others"
    selection_identity_version: str | None = None
```
`SemanticView` (ABC, `view.py`): `get_dimensions()`, `get_metrics()`, `get_values()`, `get_table(query) -> SemanticResult(requests, results: pa.Table)`, `get_row_count()`, `get_compatible_metrics()`, `get_compatible_dimensions()`, `features: frozenset[SemanticViewFeature]` (`GROUP_LIMIT`, `ROW_OFFSET`, `ADHOC_COLUMN_EXPRESSIONS`...). Docstring'ler sözleşmeyi çok net tanımlıyor (ör. "order limit'ten önce uygulanır", "NULL hiçbir zaman karşılaştırma operandı değildir, IS_NULL'a host böler", "row count = istenen sonuç penceresi"). Sonuç **Arrow** tablosu.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)

`ExploreMixin.get_sqla_query()` (`superset/models/helpers.py:6684`) adımları (satır numaraları yaklaşık):
1. `metrics` → her biri `SqlMetric.get_sqla_col()` veya `adhoc_metric_to_sqla()` ile `ColumnElement` (6798-6818). Metrik yoksa `COUNT(*)`.
2. `columns` (boyutlar) → `TableColumn` ifadesi veya ad-hoc SQL sütun; `groupby_all_columns` doldurulur (6900-6990).
3. `tbl, cte = self.get_from_clause(template_processor)` (7023) → fiziksel tablo veya sanal dataset alt sorgusu (Jinja işlenmiş).
4. Zaman serisi ise `get_timestamp_expression()` → `db_engine_spec._time_grain_expressions[grain]` ile `DATEADD(...)` vb. (7034-7043).
5. `qry = sa.select(*select_exprs)` + `group_by` (veya `grouping_sets`, 7209-7224).
6. Filtreler: her `QueryObjectFilterClause {col, op, val}` → WHERE; metrik üzerindeki filtre → HAVING (7227-7363). `extras.where/having` ham SQL olarak eklenir (7988, 7997).
7. **RLS:** `where_clause_and += self.get_sqla_row_level_filters(template_processor)` (7978) — kullanıcının RLS cümleleri (aynı `group_key` olanlar OR, diğerleri AND) + embed guest RLS.
8. Partition mirror predicate'leri, ORDER BY, LIMIT/OFFSET (8024-8062).
9. `series_limit` varsa: ana metrik ile top-N alt sorgusu (`inner_main_metric_expr`) üretilip ana sorguya join ya da prequery ile bağlanır; `group_others_when_limit_reached` ile "Others" (8064-8172).
10. `get_query_str_extended()` → `database.compile_sqla_query()` → `_apply_cte()` → `mutate_sql_based_on_config` (2686-2710) → SQL string.
11. `exc_query()` → DataFrame → `exec_post_processing` (pandas).

Örnek (Pie chart) — frontend tarafında sorgu ve post-processing tanımı (`plugins/plugin-chart-echarts/src/Pie/buildQuery.ts`):
```ts
return buildQueryContext(formData, baseQueryObject => [{
  ...baseQueryObject,
  ...(sort_by_metric && { orderby: [[metric, false]] }),
  post_processing: [{ operation: 'contribution',
    options: { columns: [metricLabel], rename_columns: [getContributionLabel(metricLabel)] } }],
}]);
```

RLS örneği (`RowLevelSecurityFilter`): `filter_type` `REGULAR` (listedeki subject'lere uygulanır) veya `BASE` (listedekiler **hariç** herkese uygulanır), `tables` (M2M), `subjects` (user/role/group), `group_key`, `clause` (ör. `region = '{{ current_username() }}'` — Jinja destekli). SQL Lab / sanal dataset için `superset/utils/rls.py:475 apply_rls()` sqlglot ile tabloyu `(SELECT * FROM t WHERE clause) AS t` alt sorgusuna sarar (`RLSMethod.AS_SUBQUERY`) ya da predicate ekler.

Guest token (embed) yükü (`security/manager.py:6614`):
```python
claims = {"user": user, "resources": [{"type": "dashboard", "id": ...}],
          "rls_rules": [{"dataset": 12, "clause": "tenant_id = 7"}],
          "rev": <revocation version>, "iat": now, "exp": now+exp_seconds,
          "aud": audience, "type": "guest", "datasets": [...]}   # datasets: opsiyonel allowlist
```

## Alınacak fikirler

1. **EngineSpec/Dialect sınıfı**: tüm diyalekt farklarını (time grain şablonları `{col}` placeholder ile, quoting, limit/offset yöntemi, max identifier uzunluğu, CTE-in-subquery desteği, hata → kullanıcı mesajı eşlemesi) tek bir sınıf hiyerarşisinde toplamak; entry point ile 3. parti connector. Floem'un DAX→SQL derleyicisinin "backend" katmanı bu olmalı.
2. **QueryObject benzeri ara temsil (IR)**: görsel → `{metrics, dimensions, filters, orderby, limit, series_limit, time_range, time_shift, post_processing}` JSON sözleşmesi. Floem'da bu IR, DAX derleyicisinin çıktısı ile görsellerin girdisi arasında durmalı; cache key bu IR'nin hash'i olmalı (`query_cache_key`).
3. **Semantic Layer SDK sözleşmesi** (`superset_core/semantic_layers`): `SemanticView.get_table(SemanticQuery) -> Arrow`, `features` bayrakları ile yetenek bildirimi, `get_compatible_metrics/dimensions` (hangi ölçü hangi boyutla birleşebilir — ilişki grafiği olan bir modelde UI'da alan gri-leme için birebir), `GroupLimit` (top-N + Others), (name, grain) dimension varyantları. Floem semantik motorunun iç API'sini bunun gibi **Arrow tabanlı ve yetenek bayraklı** tasarlamak; hatta Floem'u ileride Superset'e "semantic layer provider" olarak takılabilir yapmak mümkün.
4. **RLS çift modu**: (a) derlenmiş sorguya WHERE predicate ekleme, (b) serbest SQL'de sqlglot AST ile tabloyu filtrelenmiş alt sorguya sarma (`AS_SUBQUERY` daha güvenli). `REGULAR/BASE` filtre tipi ve `group_key` ile OR/AND kombinasyonu pratik. Floem'da Power BI tarzı rol filtresi (DAX boolean ifadesi) derlenip aynı noktaya enjekte edilebilir; sqlglot (MIT) Floem'da da kullanılabilir.
5. **Guest token + iframe + MessageChannel embed modeli**: kısa ömürlü JWT içinde `resources` + `rls_rules` + `datasets` allowlist + revocation versiyonu; SDK token'ı `exp - 5sn` önce yeniler (`guestTokenRefresh.ts`), `fetchGuestToken` callback'i host backend'ine bırakılır. `setDataMask/getDataMask/observeDataMask` ile host uygulama filtreleri programatik kontrol eder. Floem embed için birebir uygun kalıp.
6. **ChartPlugin sözleşmesi**: `metadata` (ad, kategori, `behaviors: [InteractiveChart, DrillToDetail, DrillBy, NativeFilter]`), `buildQuery` (formData → QueryContext), `transformProps` (sonuç → bileşen props), `controlPanel` (alan kuyuları/özellik paneli DSL'i), `loadChart` (lazy). Register edilince 5 ayrı registry'ye yazar. Floem "visual" eklenti API'si için iyi şablon; `behaviors` ile cross-filter/drill desteğinin görsel bazında bildirilmesi önemli.
7. **DataMask modeli** (`extraFormData` + `filterState` + `ownState`): slicer/cross-filter'ın her görselin sorgusuna "ek filtre" olarak eklenmesi; filtre kapsamı (scope) layout ağacı üzerinden hesaplanır (`getChartIdsInFilterScope`). Power BI "edit interactions" karşılığı.
8. **Dashboard layout JSON'u**: düz bir `id → {type, children, parents, meta:{width,height,chartId}}` haritası (ROOT_ID → GRID_ID → ROW → CHART/COLUMN/TABS/MARKDOWN), 12 kolon, `GRID_BASE_UNIT = 8px`. Düz harita undo/redo ve diff için kolay. `DYNAMIC_TYPE` ile harici bileşen tipleri.
9. **Jinja bağlam makroları** (`current_username`, `current_user_roles`, `filter_values`, `url_param`) → RLS cümlelerinde ve sanal dataset'lerde dinamik parametre. Floem'da `USERPRINCIPALNAME()` / `USERNAME()` karşılığı.
10. **Post-processing hattı**: SQL'in ifade edemediği veya diyalektler arası tutarsız hesaplar (rolling, cum, contribution, pivot, resample) için pandas/Arrow tarafında deterministik işlem zinciri. Import modunda (DuckDB) bunlar SQL'e itilebilir, DirectQuery'de fallback olarak bellek içi.
11. Ölçü meta alanları: `d3format`, `currency`, `warning_text`, `certified_by/certification_details`, `folders` (display folder) — Power BI'daki format string ve display folder'larına iyi karşılık.

## Kaçınılacaklar / zayıf yönler

- **İlişki/join modeli yok.** Dataset = tek tablo veya elle yazılmış SQL. Kardinalite, filtre yönü, yıldız şema, rol oynayan tarih tablosu yok; Floem'un temel gereksinimi (3. madde) burada hiç karşılanmıyor. Bu kısım için MetricFlow/Cube/Rill'e bakılmalı.
- **Ölçü dili yok.** Metrik = ham SQL string; filtre bağlamı, CALCULATE, zaman zekâsı, ölçü bileşimi yok (yalnızca Jinja `metric()` makrosu ile metin ikamesi). Time comparison pandas `compare`/`time_shift` ile ikinci sorgu + bellekte birleştirme şeklinde — DAX semantiğine uygun değil.
- **Dev monolitik fonksiyonlar:** `get_sqla_query` ~1500 satır, `models/helpers.py` 8300, `security/manager.py` 7361 satır. Floem'da derleyiciyi aşamalı (parse → bind → plan → optimize → emit) tasarlamak gerekir; Superset'in "her şey tek fonksiyonda" yapısı kopyalanmamalı.
- **RLS ham SQL metni:** RLS `clause` doğrudan `text()` ile WHERE'e gömülüyor (Jinja işlendikten sonra). Güvenlik yönetici girdisine güveniyor; SQL injection yüzeyi geniş. Floem'da RLS ifadesi tipli AST olarak saklanmalı.
- **Çok kiracılık yok:** Superset tek kiracılı; "tenant" kavramı yok, izolasyon rol + RLS + guest token ile taklit ediliyor. Floem bunu çekirdekte tasarlamalı.
- **Import/refresh/Gateway yok:** Superset her zaman canlı sorgu (DirectQuery) + sonuç önbelleği; zamanlanmış veri yenileme, on-prem ajan, medallion katmanı yok.
- **Flask-AppBuilder bağımlılığı** ve ORM'ye bağlı yetki modeli (perm string'leri `perm`, `schema_perm`) ağır ve legacy; Floem için örnek alınmamalı.
- Frontend'de legacy `formData` ile yeni `QueryContext` arasında çift dünya (`DEPRECATED_FIELDS`: `groupby→columns`, `timeseries_limit→series_limit`...) — sözleşmeyi baştan versiyonlamak gerektiğinin dersi.
- Lisans tuzakları: `mapbox-gl` (tescilli) kullanan harita eklentileri, `pymssql` (LGPL) gibi sürücüler; Floem'a taşınacak her bağımlılık ayrıca kontrol edilmeli.
- Semantic Layer SDK yeni ve feature flag arkasında (`SEMANTIC_LAYERS: False`); API'nin kararlılığından **emin değilim**, değişebilir.

## Kullanım kararı: Fikir al

Gerekçe: Lisans (Apache 2.0) ticari kullanıma uygun; ancak Superset'in çekirdeği (tek tablolu dataset, ham SQL metrik, Flask-AppBuilder, monolitik sorgu üretici) Floem BI'ın semantik model + DAX→SQL hedefine mimari olarak uymuyor; fork etmek ağır bir yükü devralmak olur. Seçici olarak **kod uyarlaması** (NOTICE dosyasına atıf ile) mantıklı olabilecek yerler: `db_engine_specs/mssql.py` time grain şablonları, `superset-embedded-sdk` (iframe + Switchboard + token refresh kalıbı), `sql/parse.py` RLS transformer'ları (sqlglot), `superset_core/semantic_layers` tip sözleşmesi. Uzun vadede, Floem'u Superset'e "semantic layer provider" olarak sunmak bir entegrasyon seçeneği olarak not edilebilir.
