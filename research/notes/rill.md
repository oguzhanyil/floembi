# Rill (rilldata/rill)

- **URL:** https://github.com/rilldata/rill
- **Lisans:** Apache License 2.0. **Doğrulandı.** Kök dosya `LICENSE.md` (201 satır, standart Apache 2.0 metni). `find . -iname "LICENSE*" -not -path "*/node_modules/*"` yalnızca `./LICENSE.md` döndürüyor. `ee/` veya `enterprise/` klasörü yok. Kaynak kodda "Elastic License", "BUSL", "AGPL", "GNU General" geçmiyor. `package.json` dosyalarında `license` alanı yok, yani kök lisans geçerli. Not: Rill Cloud'un bazı özellikleri (billing, provisioner) aynı repoda `admin/` altında ve onlar da Apache 2.0 kapsamında. Ayrı bir ticari lisans dosyası bulunmuyor.
- **Dil:** Backend Go (`go 1.26.10`, `go.mod`). Frontend TypeScript ve Svelte 5 (`web-common`, `web-local`, `web-admin`). API'ler Protobuf, gRPC ve gRPC-Gateway ile tanımlı (`proto/`).
- **Son commit tarihi:** 2026-11-17 (`2f92804786b6db9e07a76eddd20d8c1008cf59b6`, `--depth 1` klonu)
- **Önemli bağımlılıklar:** `github.com/duckdb/duckdb-go/v2 v2.10505.0` (MIT), `github.com/pingcap/tidb/pkg/parser` (Apache 2.0; measure expression ve Metrics SQL parse etmek için), `vega-lite` 6 (BSD-3), `@tanstack/svelte-query`, `d3-*` (ISC/BSD).

## Ne yapıyor (3-5 cümle)
Rill, "code-first" bir operasyonel BI aracı. Proje, YAML ve SQL dosyalarından oluşan bir klasör. Bu dosyalarda `connector`, `model` (SQL veya ingest), `metrics_view` (semantik katman), `explore` (hazır keşif dashboard'u) ve `canvas` (serbest yerleşimli dashboard) gibi kaynaklar tanımlanıyor. Go ile yazılmış `runtime`, bu dosyaları parse edip bir kaynak DAG'ı kuruyor ve reconciler'larla gerçek duruma getiriyor: tabloları DuckDB veya ClickHouse'a yüklüyor, metrics view'ları doğruluyor. Dashboard sorguları JSON formatında bir `metricsview.Query` olarak runtime'a geliyor. Runtime bu sorgudan dialect'e özgü SQL üretip OLAP motorunda çalıştırıyor. Bulut tarafında (`admin/`) org/proje çok kiracılığı, deployment, kullanıcı, token ve rapor/alert zamanlaması var.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)

| Klasör | Sorumluluk |
|---|---|
| `proto/rill/runtime/v1/` | Tüm kaynak spec'leri (`resources.proto`: `MetricsViewSpec`, `ExploreSpec`, `CanvasSpec`, `ComponentSpec`, `SecurityRule`), sorgu API'leri (`queries.proto`), filtre ifadesi (`expression.proto`) |
| `proto/rill/ui/v1/dashboard.proto` | Dashboard UI state'inin protobuf karşılığı (`DashboardState`); URL ve kayıtlı state için kullanılıyor |
| `runtime/parser/` | YAML'dan spec'e dönüşüm (`parse_metrics_view.go`, `parse_partial_security_policy.go`) |
| `runtime/reconcilers/` | Her kaynak tipi için idempotent `Reconcile` (`metrics_view.go`, `model.go`, `canvas.go`, `alert.go`, `report.go`...). DAG sırasıyla çalışıyor (`runtime/reconcilers/README.md`) |
| `runtime/metricsview/` | **Semantik katmanın çekirdeği:** `query.go` (sorgu modeli), `ast.go` (SELECT ağacı), `astsql.go` (SQL yazıcı), `astexpr.go` (filtre → SQL), `measure_expression.go` (güvenli ad-hoc ölçü ifadeleri) |
| `runtime/metricsview/executor/` | Sorgu yeniden yazım hattı (rollup yönlendirme, iki fazlı karşılaştırma, percent-of-total, limit pushdown, pivot), çalıştırma ve export |
| `runtime/metricsview/metricssql/` | "Metrics SQL": metrics view'a SQL benzeri bir dille sorgu atma (TiDB parser ile `metricsview.Query`'ye derleniyor) |
| `runtime/drivers/` | Connector ve OLAP soyutlaması (`olap.go`, `dialect.go`). Sürücüler: `duckdb`, `clickhouse`, `druid`, `pinot`, `postgres`, `mysql`, `snowflake`, `bigquery`, `databricks`, `redshift`, `starrocks`, `athena`, `s3`, `gcs`... **SQL Server sürücüsü yok** (`mssql`/`sqlserver` grep sonucu boş) |
| `runtime/pkg/rduckdb/` | DuckDB sarmalayıcı: ayrı okuma/yazma handle'ları, tablo başına ayrı `.db` dosyası, GCS'e yedekleme |
| `runtime/resolvers/` | Birleşik veri çözücü arayüzü (metrics, SQL, API). Cache anahtarı burada kuruluyor. `testdata/*.yaml` iyi birer şema ve sorgu örnekleri kaynağı |
| `runtime/security.go` | Güvenlik kurallarını kullanıcı attribute'larıyla template'leyip `ResolvedSecurity` üretiyor (access, field access, row filter) |
| `admin/` | Bulut kontrol düzlemi: org, proje, kullanıcı, deployment, billing. Postgres migration'ları `admin/database/postgres/migrations/` altında (101 dosya) |
| `web-common/src/features/dashboards/` | Explore dashboard UI'ı ve state yönetimi |
| `web-common/src/features/canvas/` | Serbest yerleşimli dashboard builder (satır/öğe grid'i, bileşenler, filtreler) |
| `cli/` | `rill start`, `rill deploy`, `rill runtime start` |

**Veri akışı:**
```
YAML/SQL dosyaları → parser → Resource (spec) → controller/reconciler (DAG)
   → model: kaynak → DuckDB/ClickHouse tablosu
   → metrics_view: tabloya karşı doğrulama → ValidSpec
UI (Svelte store state) → V1 API (MetricsViewAggregation vb.) → resolver(metrics)
   → executor (rewrite hattı) → metricsview.NewAST → ast.SQL() → drivers.OLAPStore.Query → sonuç
```

## Floem BI için kritik kısımlar

- `runtime/metricsview/query.go` → Dashboard'dan gelen sorgunun bildirimsel modeli: `Dimensions`, `Measures` (her ikisi de opsiyonel `Compute` ile: `time_floor`, `comparison_value/delta/ratio`, `percent_of_total`, `count_distinct`), `Where`/`Having` (ağaç biçiminde `Expression`), `TimeRange`, `ComparisonTimeRange`, `Sort`, `Limit`, `PivotOn`, `Spine`. → Floem BI'da **frontend ile ölçü derleyicisi arasındaki "Visual Query" sözleşmesine** karşılık gelir. Her görselin ürettiği sorgu nesnesi bu yapıya çok benzeyebilir.
- `runtime/metricsview/ast.go` (`NewAST`, `AddMeasureField`, `addDerivedMeasure`, `addTimeComparisonMeasure`, `WrapSelect`) → Ölçüleri tiplerine göre artımlı biçimde SELECT ağacına ekleyip ağacı yeniden şekillendiriyor (iç içe sub-select, karşılaştırma için FULL JOIN, spine için RIGHT JOIN). → Floem BI'da **DAX → SQL derleyicisinin "plan/IR" katmanına** karşılık gelir. CALCULATE ve zaman zekâsı, filtre bağlamı farklı alt sorgular ve join'lerle burada yapılabilir.
- `runtime/metricsview/astsql.go` → AST'yi parametreli SQL'e (`?` args) yazıyor. → Floem BI'da IR'dan SQL'e geçen "emitter".
- `runtime/drivers/dialect.go` (`Dialect` interface, 60+ metot: `EscapeIdentifier`, `DateTruncExpr`, `SafeDivideExpression`, `LateralUnnest`, `AnyValueExpression`, `SelectTimeRangeBins`, `SplitAggregateExpression`...) → Floem BI'da **SQL Server / PostgreSQL / DuckDB için dialect katmanı**. DirectQuery modunda SQL Server'a, Import modunda DuckDB'ye aynı IR'dan SQL üretmek için temel desen.
- `runtime/metricsview/executor/executor.go` (`Executor.Query`, satır 350 civarı) → Sıralı rewrite hattı: exact measures → caps → pivot → time ranges → limits → percent-of-total → rollup seçimi → AST → two-phase comparisons → limit pushdown → SQL. → Floem BI'da **sorgu optimizasyon pipeline'ı**. Aggregation tabloları (Power BI "aggregations") ve sorgu limitleri burada yer alır.
- `runtime/metricsview/executor/executor_rewrite_rollup.go` → Sorguyu, koşulları sağlıyorsa önceden toplanmış rollup tablosuna yönlendiriyor. Koşullar: grain türetilebilir mi, tüm boyutlar, ölçüler ve filtre boyutları rollup'ta var mı, zaman kapsamı uygun mu. → Floem BI'da **Power BI "Aggregations" / Fabric pre-aggregation** özelliğinin birebir karşılığı.
- `runtime/metricsview/measure_expression.go` → Kullanıcının çalışma anında yazdığı ad-hoc ölçü ifadesini (`revenue - cost`) TiDB parser ile parse ediyor. Fonksiyonlar allowlist ile sınırlı, uzunluk ve derinlik limitli. SQL girdiden kopyalanmıyor, AST'den yeniden render ediliyor. → Floem BI'da **"quick measure" / rapor seviyesi ölçü** ve SQL injection koruması için iyi bir desen.
- `runtime/security.go` ve `proto ... SecurityRule*` → Kurallar üç türde: access, field access (kolon gizleme), row filter (SQL veya `Expression`). Hepsi `{{ .user.email }}` gibi kullanıcı attribute'larıyla template'leniyor. `ast.go` içindeki `SecurityFilterSQL`, row filter'ı her alt sorgunun WHERE'ine ekliyor. → Floem BI'da **RLS (rol + DAX filtre ifadesi)** ve **OLS (object-level security)** karşılığı.
- `runtime/pkg/rduckdb/` ve `runtime/drivers/duckdb/README.md` → DuckDB'nin üretimdeki sorunları ve çözümleri: tablo başına ayrı `.db` dosyası (WAL şişmesi, drop sonrası yer açılmaması), okuma/yazma handle ayrımı, iç hatada handle'ı yeniden açma (`reopenDB()`). → Floem BI'da **Import modu depolama motoru** (VertiPaq yerine DuckDB) için doğrudan uygulanabilir dersler.
- `web-common/src/features/dashboards/stores/explore-state.ts` (`ExploreState`) ve `state-managers/` (`selectors/`, `actions/`) → Tek bir writable store, üstünde türetilmiş selector'lar ve isimlendirilmiş action'lar. Filtreler `whereFilter: V1Expression` olarak backend'in filtre ağacıyla aynı yapıda tutuluyor. → Floem BI'da **rapor sayfası state'i** (slicer, cross-filter, sort, görünür alanlar).
- `web-common/src/features/dashboards/url-state/` (`compression.ts`, `convertURLSearchParamsToExploreState.ts`) ve `proto-state/` → State URL'e serialize ediliyor. URL 2000 karakteri geçerse gzip + base64url ile sıkıştırılıyor (`gzipped_state`). Proto tabanlı state de var. → Floem BI'da **bookmark, paylaşılabilir link ve embed state**.
- `proto ... CanvasSpec / CanvasRow / CanvasItem / ComponentSpec` ve `web-common/src/features/canvas/` → Dashboard satırlardan ve içlerindeki öğelerden oluşuyor (genişlik/yükseklik). Bileşenlerin `renderer` + `renderer_properties` (Struct) yapısı var. Satır ve öğelerde `if` koşulu, `pinned_filters` ve `required_filters` tanımlanabiliyor. → Floem BI'da **sürükle-bırak dashboard JSON şeması**.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)

Model **tek tablo** üzerine kurulu (one big table yaklaşımı). Bir `metrics_view` tam olarak bir `model` veya `table`'a bağlanıyor. **Tablolar arası ilişki, kardinalite ya da filtre yönü kavramı yok.** Tek istisna, dimension seviyesinde `lookup_table`/`lookup_key_column`/`lookup_value_column` (esasen ClickHouse dictionary amaçlı). Join'ler modelleme aşamasında SQL ile önceden yapılıyor (denormalize). Bu nokta Floem BI'ın star-schema hedefinden **temel bir farklılık**.

YAML yapısı (`runtime/parser/parse_metrics_view.go`, `MetricsViewYAML`) şu alanları içeriyor: `model|table`, `timeseries`, `smallest_time_grain`, `first_day_of_week`, `first_month_of_year`, `watermark`, `dimensions[]` (`column|expression`, `unnest`, `lookup_*`), `measures[]` (`expression`, `type: simple|derived|time_comparison`, `requires`, `per`, `window`, `format_preset|format_d3`, `treat_nulls_as`, `valid_percent_of_total`, `exact_expression`), `security`, `rollups`, `annotations`, `parent` (türetilmiş metrics view).

Gerçek örnek (`runtime/resolvers/testdata/metrics_comparisons.yaml`):
```yaml
duckdb_metrics.yaml:
  type: metrics_view
  model: duckdb_data
  timeseries: time
  dimensions:
    - column: country
  measures:
    - name: count
      expression: count(*)
    - name: sum
      expression: sum(val)
```

Ölçü tipleri (`proto/rill/runtime/v1/resources.proto`, `MetricsViewSpec.Measure`):
- `SIMPLE`: ham SQL aggregate (`sum(val)`) doğrudan alttaki tabloya uygulanıyor.
- `DERIVED`: diğer ölçülere isimle referans veriyor (`requires:` ile). Bu durumda AST, referans verilen ölçüleri bir alt SELECT'e taşıyor ve türetilmiş ifade dış SELECT'te o alias'lar üzerinden hesaplanıyor. Parser, `type` boş bırakılmışsa ve `requires` içinde ölçü varsa tipi otomatik olarak `DERIVED` yapıyor (`parse_metrics_view.go` ~595).
- `TIME_COMPARISON`: `base.x` ve `comparison.x` alias'larını kullanıyor. Gerekli parçalar: `ComparisonTimeRange`, iki alt sorgu ve FULL JOIN.
- `window`: `partition`, `order`, `frame` ile `OVER (...)` üretiliyor (kümülatif toplam ve hareketli ortalama gibi).
- `per` (dimension başına seviye, DAX'taki `ALLEXCEPT` gibi): spec'te var ama **AST'de implement edilmemiş**. `addDerivedMeasureWithPer` şu hatayı döndürüyor: `support for "per" not implemented` (`ast.go` ~1028).

Güvenlik kuralı örneği (`SecurityPolicyYAML`): `access` (template'lenmiş boolean ifade), `row_filter` (SQL), `include/exclude` (koşula bağlı alan listesi), `rules[]`. Test örneği: `row_filter: country = 'DK'` (`runtime/resolvers/testdata/metrics_security.yaml`).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)

1. **Giriş:** JSON/YAML `metricsview.Query` gelir. Örnek (`metrics_comparisons.yaml`):
   ```yaml
   metrics_view: duckdb_metrics
   dimensions:
     - name: time__day
       compute: { time_floor: { dimension: time, grain: day } }
   measures:
     - name: sum
     - name: sum_prev
       compute: { comparison_value: { measure: sum } }
   time_range: { start: 2024-01-03T00:00:00Z, end: 2024-01-05T00:00:00Z }
   comparison_time_range: { start: 2024-01-01T00:00:00Z, end: 2024-01-03T00:00:00Z }
   sort: [{ name: time__day }]
   ```
   Filtreler ağaç biçiminde: `Expression{Name|Value|Condition{op, exprs}|Subquery}`. Operatörler `eq, neq, lt, in, like, and, or...` (`query.go` ~267-310). `Subquery`, "bir ölçüsü X'ten büyük olan boyut değerleri" gibi ölçü bazlı filtreleri `IN (SELECT ...)` olarak ifade etmeye yarıyor.
2. **Executor rewrite'ları** (`executor.go` ~350-435): sorgu doğrulanıyor, göreli zaman ifadeleri (`rilltime`) mutlak zamana çevriliyor, sorgu limitleri uygulanıyor, percent-of-total için önce toplam sorgusu çalıştırılıyor, uygun bir rollup varsa spec rollup tablosuyla değiştiriliyor.
3. **`NewAST`** (`ast.go` 199-385):
   - Her boyut `Dialect.MetricsViewDimensionExpression` ile ifadeye çevriliyor. Unnest gerekiyorsa lateral join ekleniyor.
   - `buildWhereForUnderlyingTable`: kullanıcının `Where` filtresi ile güvenlik filtresi (`SecurityFilterSQL`) AND ile birleştiriliyor.
   - `buildBaseSelect`: `GROUP BY` tüm boyutlar, `FROM` tablo, zaman aralığı `TimeWhere` olarak ekleniyor.
   - Her ölçü `AddMeasureField` ile ekleniyor. Simple ölçü en alttaki SELECT'e iniyor. Derived ölçü için `WrapSelect` ile bir dış SELECT açılıyor ve referanslar içeride kalıyor. Time comparison için kök `base` olarak sarılıyor, `comparison` alt sorgusu kuruluyor ve `FULL JOIN` ile birleştiriliyor. Boyutlar `COALESCE(base.d, comparison.d)` ile alınıyor.
   - `Having` için kök sarılıyor ve koşul dış WHERE olarak ekleniyor. Ardından `Sort`, `Limit`, `Offset` uygulanıyor.
4. **`ast.SQL()`** (`astsql.go`): CTE'ler ve iç içe SELECT'ler yazılıyor. Değerler parametre olarak `args`'a gidiyor.
5. `drivers.OLAPStore.Query`, priority ve timeout ile çalıştırılıyor. Sonuç resolver katmanında cache'leniyor. Cache anahtarı metrics view'ın watermark/`cache_key_sql` değerinden ve sorgudan oluşuyor. Testlerde farklı güvenlik bağlamları arasında cache sızıntısı olmadığı ayrıca doğrulanıyor.

Önemli gözlem: Derleyici **DAX'taki gibi bir "filtre bağlamı" kavramı taşımıyor**. Tüm ölçüler aynı WHERE'i paylaşıyor. Ölçü başına filtre değişikliği (CALCULATE benzeri) yalnızca iki özel durumda var: zaman karşılaştırması (ayrı alt sorgu) ve percent-of-total (ayrı toplam sorgusu). Ölçü seviyesinde `filter:` alanı yok. Ölçü ifadeleri ham SQL (`sum(val)`), yani ifade dili hedef dialect'e bağımlı.

## Alınacak fikirler
1. **AST tabanlı artımlı derleme:** Her ölçü tipi ağacı kendine göre dönüştürüyor (`WrapSelect`, comparison join, spine join). DAX derleyicisinde de CALCULATE, zaman zekâsı ve iterator'lar için benzer "ağaç dönüştürücü" handler'lar yazılabilir. `FieldNode.Name` değişmezi (aynı isim ağacın her yerinde aynı değeri verir) basit ama güçlü bir garanti.
2. **Dialect interface'i:** SQL Server, PostgreSQL ve DuckDB için tek bir IR'dan SQL üretimi. Özellikle `DateTruncExpr` (hafta başlangıcı ve mali yıl ayı parametreli), `SafeDivideExpression`, `SelectTimeRangeBins` (zaman omurgası/spine) ve `IntervalSubtractInTimeZone` (DST) metotları zaman zekâsı için doğrudan referans alınabilir.
3. **Rewrite pipeline + rollup routing:** Aggregation tablolarına otomatik yönlendirme ve uygunluk kuralları (`executor_rewrite_rollup.go` başlık yorumu adeta bir spesifikasyon). İki fazlı karşılaştırma ve limit pushdown da büyük SQL Server tablolarında DirectQuery performansı için önemli.
4. **Filtre ifadesi ağacı (`Expression`):** Frontend ile backend aynı yapıyı paylaşıyor. Slicer, cross-filter ve RLS filtreleri tek bir AST'de birleşiyor. Ölçü bazlı filtreler için `Subquery` düğümü kullanılıyor.
5. **Güvenlik:** Kullanıcı attribute'larıyla template'lenen row filter ve field access kuralları. Kurallar AST kurulumunda alttaki tabloya enjekte ediliyor, böylece hiçbir yol onları atlayamıyor. Cache anahtarına güvenlik bağlamının girmesi şart (testleri var).
6. **Ad-hoc ölçü güvenliği:** Allowlist fonksiyonlar, derinlik ve uzunluk limitleri, AST'den yeniden render. Kullanıcı tanımlı ölçüler ve DAX girişi için de aynı ilke uygulanmalı.
7. **Dashboard state:** Tek store, selector ve action ayrımı. State'in URL'e serialize edilmesi (uzunsa gzip + base64url). "Varsayılan preset" ile kullanıcı state'inin katmanlı birleşimi (`cascading-explore-state-merge.ts`).
8. **Canvas şeması:** satır → öğe → bileşen (`renderer` + `renderer_properties`), satır/öğe seviyesinde `if` görünürlük koşulu, `pinned_filters`/`required_filters`. Grafikler Vega-Lite spec'iyle çiziliyor (BSD-3, kullanılabilir).
9. **DuckDB operasyon dersleri:** tablo başına ayrı `.db` dosyası, okuma/yazma ayrımı, düşük kardinaliteli VARCHAR'ları ENUM'a çevirme, iç hata sonrası handle'ı yeniden açma.
10. **Reconciler/DAG modeli:** Model, metrics view ve dashboard bağımlılıkları bir DAG'da tutuluyor. Değişiklikte bağımlılar yeniden doğrulanıyor ve en son geçerli spec (`ValidSpec`) korunuyor. Bu, zamanlanmış yenileme ve "kırık model" senaryosu için iyi bir desen.

## Kaçınılacaklar / zayıf yönler
- **İlişki/star-schema yok:** Tek tablolu metrics view. Power BI tarzı çok tablolu model, ilişki, filtre yönü ve rol yapma tarih tablosu için join grafiği ve planlama tamamen Floem BI tarafından yazılmalı (bunun için MetricFlow ve Cube daha iyi referans).
- **Ölçüler ham SQL:** `expression: sum(val)` dialect'e bağımlı, taşınabilir değil. Floem BI'ın DAX benzeri dili ise dialect'ten bağımsız bir IR'a derlenmeli.
- **Filtre bağlamı ve CALCULATE yok:** Ölçü başına filtre, `ALL`/`ALLEXCEPT` yok. `per` alanı implement edilmemiş (`not implemented`). Zaman zekâsı yalnızca "karşılaştırma zaman aralığı" ile sınırlı. YTD/QTD gibi ifadeler için pencere fonksiyonu kullanılıyor.
- **Kod tabanının büyüklüğü ve dağınıklığı:** Druid, ClickHouse ve Pinot'a özel çok sayıda rewrite var (`executor_rewrite_druid_*`). Kodda `TODO`/`FIXME` notları ve eski `runtime/queries` ile yeni `resolvers` arasında yarım kalmış bir geçiş göze çarpıyor (`runtime/README.md`).
- **SQL Server ve SAP B1 desteği yok:** Sürücüler arasında `mssql` bulunmuyor. Gateway/on-prem ajan kavramı da yok (Rill Cloud kaynaklara doğrudan bağlanıyor).
- **Go + Svelte yığını:** Floem BI Python tabanlı. Kodu doğrudan import etmek pratik değil, desen olarak taşınması gerekiyor.
- **Pivot:** Etkileşimli pivot verimli değil. Pivot sorguları Parquet'e export edilip DuckDB'de okunarak çözülüyor (`executor.go` ~454 yorumu: "inefficient shim").
- Frontend state'te bazı geçici çözümler (`allMeasuresVisible` için "TODO: clean this up", `contextColumnWidths` için "FIXME") var. Bunlar birebir kopyalanmamalı.

## Kullanım kararı: Fikir al

Lisans (Apache 2.0, alt klasör istisnası yok) seçilmiş parçaların kopyalanmasına izin veriyor. Ancak dil uyumsuzluğu (Go/Svelte ile Python), tek tablo varsayımı ve SQL Server sürücüsünün olmaması nedeniyle bağımlılık olarak kullanmak ya da fork etmek uygun değil. `runtime/metricsview/` (AST, rewrite pipeline, rollup routing), `drivers/dialect.go` arayüzü ve `web-common/.../dashboards` state/URL deseni, Floem BI'ın ölçü derleyicisi ve dashboard state'i için birincil tasarım referansı olarak alınmalı. Belirli bir parça uyarlanırsa (örneğin dialect fonksiyonlarının mantığı) Apache 2.0 gereği NOTICE ve atıf eklenmeli.
