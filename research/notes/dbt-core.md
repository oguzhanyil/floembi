# dbt-core (dbt v2.0 / "Fusion" kaynak kodu)
- URL: https://github.com/dbt-labs/dbt-core (README'de `dbt-labs/dbt` olarak geçiyor)
- Lisans: **Apache 2.0** — doğrulandı (kök `LICENSE`; `Cargo.toml` `[workspace.package] license = "Apache-2.0"`). **Önemli ayrım:** README: "`main` branch now contains all the Apache 2.0 source code of dbt v2.0 — a ground-up rewrite in Rust" ve "*dbt* is a distribution of the dbt repository with dbt-specific customizations released under a **dbt product license**" (Fusion engine license agreement). Yani repo kaynak kodu Apache 2.0, ama dbt Labs'in **dağıttığı binary** tescilli lisanslı olabilir. Floem BI ancak kaynaktan kendisi derlerse Apache 2.0 kapsamında kalır. Alt lisanslar: `crates/dbt-jinja/**/LICENSE` (minijinja, Apache 2.0). v1 Python kodu `1.latest` dalında (Apache 2.0).
- Dil: Rust (91 crate), Jinja makroları (SQL)
- Sürüm: `Cargo.toml` → `version = "2.0.11"`
- Son commit tarihi: 2026-11-17

## Ne yapıyor (3-5 cümle)
Analistlerin `SELECT` olarak yazdığı modelleri (Jinja + SQL) `ref()`/`source()` bağımlılıklarına göre DAG'e dizer, derler ve hedef ambarda view/table/incremental olarak materyalize eder. Test (unique, not_null, relationships), snapshot (SCD2), seed, dokümantasyon ve lineage sağlar. v2.0 Rust ile yeniden yazılmış; tek binary, katı parse-time doğrulama, Parquet artifact'lar (manifest.json uyumlu) üretiyor. `dbt-metricflow` crate'i ile semantic layer entegrasyonu da repo içinde.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `crates/dbt-parser`, `crates/dbt-loader` | Proje/YAML/SQL dosyalarını yükleme ve parse; `dbt-loader/src/dbt_macro_assets/<adapter>/macros/` gömülü Jinja makroları |
| `crates/dbt-jinja*` | minijinja tabanlı Jinja motoru, `ref/source/config` bağlamı |
| `crates/dbt-dag/src/` (`schedule.rs`, `deps_mgmt.rs`), `crates/dbt-scheduler/src/` (`node_selector.rs`) | `ref()` grafiği, seçici (`+model`, `tag:`) ve yürütme sırası |
| `crates/dbt-adapter-*` | Adaptörler; `dbt-adapter-core/src/lib.rs` `AdapterType` enum: Snowflake, BigQuery, Databricks, Redshift, Spark, **DuckDB**, **Postgres**, **Fabric**, ClickHouse, Trino, Oracle… (**SQL Server yok**) |
| `crates/dbt-metricflow` | MetricFlow semantic layer entegrasyonu |
| `crates/dbt-schemas`, `dbt-metadata-parquet` | Manifest/artifact şemaları |

Akış: `models/*.sql + schema.yml → parse → Jinja render (ref çözümü) → DAG → node seçimi → adapter.materialization makrosu → hedef DB'de CREATE/MERGE`.

## Floem BI için kritik kısımlar
- `crates/dbt-loader/src/dbt_macro_assets/dbt-adapters/macros/materializations/models/incremental/` → `incremental.sql` (ana akış: temp tablo → strateji → swap), `strategies.sql` (`append`, `delete_insert`, `merge`, `insert_overwrite`), `merge.sql` (MERGE SQL üretimi), `on_schema_change.sql` (`ignore|append_new_columns|sync_all_columns|fail`), `is_incremental.sql`. → Floem Silver→Gold artımlı dönüşüm motorunun SQL şablonları.
- `crates/dbt-loader/src/dbt_macro_assets/dbt-fabric/macros/materializations/` (models/seeds/snapshots/tests) → T-SQL'e uyarlanmış materyalizasyonlar (Fabric DWH). → SQL Server Gold katmanı için en yakın referans (v1 ekosisteminde `dbt-sqlserver` bu adaptörden türer).
- `crates/dbt-loader/src/dbt_macro_assets/dbt-duckdb/` → DuckDB materyalizasyonları. → Floem DuckDB Gold katmanı.
- `crates/dbt-dag/src/schedule.rs`, `crates/dbt-scheduler/src/node_selector.rs` → DAG + seçici sözdizimi. → Floem dönüşüm adımlarının bağımlılık sırası ve "sadece etkilenenleri yenile".

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
`semantic_models:` / `metrics:` YAML (MetricFlow formatı; ayrıntı için `metricflow.md`). Örnek:
```yaml
semantic_models:
  - name: sales
    model: ref('fct_sales')
    entities: [{name: customer, type: foreign, expr: CardCode}]
    dimensions: [{name: doc_date, type: time, type_params: {time_granularity: day}}]
    measures: [{name: revenue, agg: sum, expr: DocTotal}]
```

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Analitik sorgu değil; dönüşüm SQL'i: model SQL'i Jinja ile render edilir, `{% if is_incremental() %} WHERE UpdateDate > (SELECT MAX(UpdateDate) FROM {{ this }}) {% endif %}` ile artımlı filtre, ardından strateji makrosu MERGE/DELETE+INSERT üretir.

## Alınacak fikirler
- Silver→Gold dönüşümlerini "SELECT tanımı + materyalizasyon türü + unique_key + on_schema_change" olarak modellemek (kendi YAML/JSON şemamızda).
- `ref()` tabanlı DAG ve seçici sözdizimi (`+gold_sales`) → kısmi yenileme.
- Incremental strateji şablonları (merge/delete+insert) ve `on_schema_change` politikaları.
- Veri testleri (unique, not_null, relationships) → Gold kalite kontrolleri.

## Kaçınılacaklar / zayıf yönler
- v2 Rust: Floem'in Python backend'ine gömülemez; CLI/binary olarak çağırmak gerekir. Resmi binary'nin lisansı tescilli (dbt product license) → kaynaktan derlemek veya v1 (`1.latest`, Python, Apache 2.0) kullanmak gerekir.
- v2'de **SQL Server adaptörü yok** (yalnız Fabric); SAP B1/SQL Server merkezli Gold için risk.
- Jinja-SQL şablonlama, grafik arayüzlü model tasarımına uygun değil; Floem kullanıcısı dbt projesi yazmayacak.
- Çok kiracılıkta her kiracı için ayrı profil/proje yönetimi gerekir.

## Kullanım kararı: **Fikir al**
Silver→Gold dönüşümleri Floem'in kendi (sqlglot ile üretilen) materyalizasyon motoruyla yapılmalı; dbt'nin incremental/merge makroları, `on_schema_change` ve DAG/seçici tasarımı referans alınmalı. Gerekirse ileride "ileri kullanıcılar için dbt projesi içe aktarma" opsiyonel entegrasyon olabilir.
