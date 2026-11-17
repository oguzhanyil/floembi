# dlt (data load tool)
- URL: https://github.com/dlt-hub/dlt
- Lisans: **Apache 2.0** — doğrulandı (kök `LICENSE.txt`; `pyproject.toml` → `license = "Apache-2.0"`). **Dikkat:** `docs/website/docs/hub/license.md` "dltHub License" (tescilli EULA) — bu, ayrı dağıtılan `dlthub` paketi için (`pyproject.toml` extra `hub = ["dlthub>=0.31.0,<0.33", "dlthub-client"]`). `dlt/hub/__init__.py` sadece `from dlthub import transformation, runner` dener; repo içinde tescilli kod yok. Floem BI'da `dlt[hub]` extra'sı **kurulmamalı**.
- Dil: Python
- Sürüm: `pyproject.toml` → `version = "1.32.0"`
- Son commit tarihi: 2026-11-17

## Ne yapıyor (3-5 cümle)
Python generator'larını (`@dlt.resource`, `@dlt.source`) bir hedefe yükleyen, extract → normalize → load aşamalı bir EL(T) kütüphanesi. Şemayı veriden otomatik çıkarır, iç içe yapıları alt tablolara açar, şema değişikliklerini (yeni kolon, tip değişimi) sözleşmeye (schema contract) göre yönetir. Artımlı yükleme için cursor durumunu (`last_value`) pipeline state'inde saklar; `append/replace/merge` (delete-insert, upsert, scd2) yazma stratejileri sunar. Hazır `sql_database` (SQLAlchemy/pyarrow/connectorx), `rest_api`, `filesystem` kaynakları ve MSSQL, DuckDB, Postgres, Fabric, filesystem(parquet/delta) dahil çok sayıda hedefi var.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `dlt/extract/` | `decorators.py` (`@resource/@source`), `resource.py`, `pipe.py`, `incremental/` (cursor, `lag.py`, `transform.py`), `hints.py` (write_disposition, primary_key, columns) |
| `dlt/normalize/` | Ham item'ları şemaya göre normalize edip load paketlerine (jsonl/parquet) yazar; `worker.py` paralel |
| `dlt/load/load.py` | Load paketlerini hedefe iş (job) olarak yükler, `_dlt_loads` kaydı |
| `dlt/common/schema/` | `schema.py`, `typing.py` (`TSchemaContract`, `TLoaderMergeStrategy`), `migrations.py`, `detections.py` |
| `dlt/pipeline/pipeline.py` | `extract()` L442, `normalize()` L542, `load()` L600, `run()` L698; state senkronizasyonu (`state_sync.py`) |
| `dlt/sources/sql_database/` | `__init__.py` (`sql_database`, `sql_table`), `helpers.py` (`TableLoader._make_query`), `schema_types.py` (SQLAlchemy tip yansıtma), `arrow_helpers.py` |
| `dlt/destinations/impl/` | `mssql`, `duckdb`, `postgres`, `fabric`, `filesystem`, `ducklake`, `sqlalchemy`… |

Akış: `source/resource generator → extract (incremental filtre + state) → normalize (şema çıkarımı/evrim) → load package (parquet/jsonl) → load (hedefe COPY/INSERT/MERGE) → _dlt_loads + _dlt_pipeline_state`.

## Floem BI için kritik kısımlar
- `dlt/sources/sql_database/helpers.py` `_make_query` (L171-220) → `last_value`'ya göre `WHERE cursor >= :last` (`range_start` open/closed), `end_value` ile üst sınır, `row_order` ile ORDER BY, NULL cursor davranışı (`on_cursor_value_missing`). → Gateway ajanındaki SAP B1 `UpdateDate`/`UpdateTS` veya SQL Server `rowversion` tabanlı artımlı çekme sorgusu.
- `dlt/extract/incremental/__init__.py` (`Incremental`, L99) → `initial_value`, `end_value` (backfill aralığı), `primary_key` ile aynı cursor değerli satırların tekilleştirilmesi, `lag` (geç gelen veri penceresi), `allow_external_schedulers`. → Floem "Incremental refresh policy" (Power BI'daki RangeStart/RangeEnd karşılığı).
- `dlt/common/schema/typing.py` L217 `TSchemaEvolutionMode = evolve|discard_value|freeze|discard_row`; `TSchemaContractDict` (tables/columns/data_type ayrı) → Bronze katmanda kaynak şema değişimi politikası (Bronze=evolve, Silver=freeze).
- `dlt/common/schema/typing.py` L254 `TLoaderMergeStrategy = delete-insert|scd2|upsert|insert-only|cdc` → Bronze→Silver birleştirme stratejileri; `scd2` boyut tarihçesi.
- `dlt/common/schema/typing.py` L40-42 `_dlt_version`, `_dlt_loads`, `_dlt_pipeline_state` + her satırda `_dlt_load_id` → Floem warehouse'da yükleme denetim tabloları ve "hangi yenileme hangi satırı getirdi" izlenebilirliği.
- `dlt/sources/sql_database/__init__.py` (`backend="sqlalchemy"|"pyarrow"|"connectorx"`, `chunk_size=50000`, `reflection_level`, `query_adapter_callback`) → Ajanda büyük tabloları Arrow batch'leri halinde akıtma; kaynak sorgusunu (ör. SAP B1 şirket DB/şema) özelleştirme.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Uygulanamaz (yalnızca fiziksel şema: `dlt.Schema` YAML — tablo, kolon, tip, `primary_key`, `merge_key`, `write_disposition`).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Uygulanamaz (analitik sorgu yok). Kaynak çekme sorgusu: `SELECT * FROM t WHERE cursor >= :last_value [AND cursor < :end_value] ORDER BY cursor` (SQLAlchemy ile).

## Alınacak fikirler
- Floemdata agent'ı için: **ajanda dlt pipeline + `filesystem` hedefi (parquet)** → dosyaları merkeze gönder → merkezde DuckDB/MSSQL'e load. Böylece ajan hedef DB kimlik bilgisi taşımaz.
- State'i hedefte saklama (`_dlt_pipeline_state`) → ajan yeniden kurulsa da cursor kaybolmaz.
- `lag` + `primary_key` dedup ile "son N gün yeniden çek" stratejisi (SAP B1'de geriye dönük güncellenen belgeler için).
- Schema contract'ı tablo/kolon/tip seviyesinde ayrı ayrı yönetmek.

## Kaçınılacaklar / zayıf yönler
- Pipeline state yerel çalışma dizinine (`~/.dlt/pipelines`) ve hedefe bağlı; çok kiracılı merkezi yönetimde state'in sahibi net tasarlanmalı.
- Silme (hard delete) tespiti cursor ile yapılamaz; SAP B1/MSSQL için CDC veya periyodik tam karşılaştırma gerekir (`cdc` stratejisi kaynak CDC verisi bekler).
- `connectorx` backend `chunk_size`'ı yok sayar (bellek riski). `dlt[hub]`/`dlthub` tescilli → kullanma.
- Ağır bağımlılık seti; ajan paketi boyutu büyür (PyInstaller vb. ile paketlenecekse test edilmeli).

## Kullanım kararı: **Bağımlılık olarak kullan**
Floemdata agent'ında extract/incremental/şema evrimi motoru olarak (sadece Apache 2.0 çekirdek, `hub` extra'sı hariç). Gerekirse `sql_database` kaynağı SAP B1'e özel sarmalanır.
