# Redash
- URL: https://github.com/getredash/redash
- Lisans: BSD-2-Clause, **doğrulandı** (kök `LICENSE`, "Copyright (c) 2013-2020, Arik Fraimovich", 2 maddeli BSD metni). Alt lisanslar:
  - `redash/utils/ssrf/LICENSE` → Apache 2.0 (Advocate kütüphanesinden uyarlanmış SSRF koruması) — Floem BI için uygun.
  - `LICENSE.borders` → Bahreyn harita verisi, "free for personal and commercial purpose with attribution" (kod değil; ihtiyaç yok).
  - `ee/` / `enterprise/` klasörü yok.
- Dil: Python (Flask, SQLAlchemy, RQ/Redis) backend; React/TypeScript frontend (`client/`, `viz-lib/`)
- Son commit tarihi: 2026-11-10

## Ne yapıyor (3-5 cümle)
Redash, kullanıcının bir veri kaynağına (data source) karşı ham sorgu (SQL, YAML ile tanımlı HTTP isteği vb.) yazdığı, sonucu tabloya/grafiğe çevirip dashboard'a koyduğu "SQL-first" bir BI aracıdır. 70'e yakın bağlayıcı ("query runner") tek bir küçük arayüz (`BaseQueryRunner`) üzerinden eklenir. Sorgular RQ kuyruklarında asenkron çalışır, sonuçlar `query_results` tablosunda JSON olarak saklanır ve sorgu metninin hash'i ile yeniden kullanılır (önbellek). Zamanlanmış sorgular (interval / saat / haftanın günü) periyodik bir job tarafından yeniden kuyruğa atılır. Semantik model, ölçü ya da sorgu üretimi YOKTUR; her şey kullanıcının yazdığı metin sorgudur.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `redash/query_runner/` | Bağlayıcılar. `__init__.py` taban sınıflar + registry; her dosya bir kaynak (`mssql.py`, `mssql_odbc.py`, `pg.py`, `excel.py`, `json_ds.py`, `url.py`, `query_results.py` ...) |
| `redash/models/__init__.py` | SQLAlchemy modelleri: `DataSource`, `QueryResult`, `Query`, `Dashboard`, `Visualization`, `Widget`, `Alert`; şema önbelleği, zamanlama mantığı (`should_schedule_next`, `outdated_queries`) |
| `redash/models/parameterized_query.py` | `{{ param }}` (Mustache) parametreleri, tip doğrulama, `is_safe` |
| `redash/tasks/queries/execution.py` | `enqueue_query` (Redis kilidi ile tekilleştirme) ve `QueryExecutor.run` (runner çağrısı → sonucu sakla) |
| `redash/tasks/queries/maintenance.py` | `refresh_queries`, `refresh_schemas`, `cleanup_query_results`, `remove_ghost_locks` |
| `redash/tasks/schedule.py` | rq-scheduler periyodik job tanımları |
| `redash/handlers/` | REST API (Flask-RESTful) |
| `redash/permissions.py` | Grup → data source erişimi (`view_only` bayrağı) |
| `client/`, `viz-lib/` | React UI ve görselleştirme kütüphanesi |

Veri akışı:
```
UI/API → handlers/query_results.py
  → ParameterizedQuery.apply(params)          (mustache render + doğrulama)
  → QueryResult.get_latest(ds, text, max_age)  (hash ile önbellek kontrolü)
  ↳ yoksa enqueue_query()  → Redis lock "query_hash:data_source_id" → RQ job
       → QueryExecutor.run() → data_source.query_runner.run_query(annotated_query, user)
       → QueryResult.store_result(...)  → Query.update_latest_result()  → alert kontrolü
```

## Floem BI için kritik kısımlar
- `redash/query_runner/__init__.py` → `BaseQueryRunner` / `BaseSQLQueryRunner` / `BaseHTTPQueryRunner` + `register()` / `get_query_runner()` registry'si → Floem BI'da **Gateway (agent) içindeki "Connector" arayüzü**. Arayüz çok küçük: `configuration_schema()` (JSON Schema, `secret` alanları dahil), `test_connection()` (`noop_query`), `run_query(query, user) -> (data, error)`, `get_schema(get_stats)`. `enabled()` sürücü import edilemezse runner'ı sessizce devre dışı bırakır.
- `redash/query_runner/__init__.py` sonuç formatı →
  ```python
  {"columns": [{"name": "...", "friendly_name": "...", "type": "integer|float|boolean|string|datetime|date"}],
   "rows": [{"col": value, ...}]}
  ```
  `fetch_columns()` tekrar eden sütun adlarını `ad1`, `ad2` diye tekilleştirir. → Floem BI'da Gateway'den dönen "resultset" sözleşmesi (ancak satır başı dict yerine Arrow/kolonsal olmalı, bkz. zayıf yönler).
- `redash/query_runner/mssql.py` → `pymssql` ile bağlantı; şema keşfi `INFORMATION_SCHEMA.COLUMNS` + sistem şemalarını dışlama; `limit_query = " TOP 1000"`, `limit_after_select = True` ile otomatik limit; zaman aşımında `connection.cancel()` → Floem BI SQL Server / SAP B1 (SQL Server üzerinde) connector'ı. `mssql_odbc.py` aynı işi `pyodbc` ile yapar (Windows/on-prem ajan için daha uygun).
- `redash/query_runner/pg.py` → `build_schema()` ile `public` şemasını gizleme + çakışma çözümü; materialized view'ları `pg_class.relkind='m'` ile ekleme; `has_table_privilege(...)` ile sadece okunabilir tabloları listeleme → Floem BI PostgreSQL connector şema keşfi. Sütun tiplerini (`data_type`) de döner (MSSQL runner dönmüyor).
- `redash/query_runner/excel.py` → "sorgu" aslında YAML: `url` + `pd.read_excel(**args)` kwargs'ları; pandas dtype → Redash tipi dönüşüm tablosu (`conversions`) → Floem BI Excel import (fikir: dtype eşleme tablosu). `get_schema` desteklenmiyor.
- `redash/query_runner/json_ds.py` → REST/JSON bağlayıcı: YAML sorgu (`url`, `method`, `params`, `headers`, `path`, `fields`, `pagination`), `_apply_path_search` (nokta notasyonlu path), `parse_json` (iç içe dict'leri `a.b` sütunlarına düzleştirme), `UrlPagination` / `TokenPagination`, `_validate_url_within_base` (base_url dışına çıkmayı engeller) → Floem BI REST API connector'ının neredeyse birebir şablonu.
- `redash/utils/requests_session.py` + `redash/utils/ssrf/` → özel IP'lere istek atmayı engelleyen SSRF koruması (Apache 2.0) → Floem BI bulut tarafında REST connector için gerekli.
- `redash/query_runner/__init__.py::with_ssh_tunnel` → `host`/`port` property'lerini geçici olarak tünel adresiyle değiştiren dekoratör → Floem BI'da Gateway kullanılmayan senaryolarda SSH tünel opsiyonu.
- `redash/models/__init__.py::QueryResult.get_latest / store_result` + `redash/utils/__init__.py::gen_query_hash` → sorgu sonucu önbelleği: anahtar = `md5(yorumsuz + boşluksuz sorgu)` + `data_source_id`, tazelik = `retrieved_at + max_age >= now()` → Floem BI DirectQuery sonuç önbelleği (anahtar fikri; ama RLS/kullanıcı bağlamı anahtara eklenmeli).
- `redash/tasks/queries/execution.py::enqueue_query` → aynı `query_hash:data_source_id` için Redis'te kilit; çalışan job varsa yeni job açmak yerine mevcuda bağlanır (request coalescing / "single-flight") → Floem BI'da aynı görsel için eşzamanlı gelen DirectQuery isteklerinin birleştirilmesi.
- `redash/models/__init__.py::should_schedule_next` + `Query.outdated_queries` + `tasks/queries/maintenance.py::refresh_queries` → zamanlanmış yenileme: `schedule = {"interval", "time", "day_of_week", "until", "disabled"}` JSON alanı, başarısızlıkta `2**failures` dakika üstel geri çekilme, 30 sn'de bir tarama → Floem BI "zamanlanmış yenileme" (Import modu) için basit referans.
- `redash/models/__init__.py::DataSource.get_schema` → şema Redis'te `data_source:schema:{id}` anahtarıyla TTL'li önbellek, `refresh_schemas` periyodik job'u → Floem BI'da model tasarımcısının kaynak tablolarını listelemesi.
- `redash/models/parameterized_query.py` → parametre tipleri (`text`, `number`, `enum`, `query`, `date-range` ...) ve `is_safe` (serbest metin parametresi varsa sorgu "güvensiz" sayılır, embed/paylaşımda çalıştırılmaz) → Floem BI'da native query parametreleri / "what-if" parametreleri.
- `redash/query_runner/query_results.py` → `query_123` / `cached_query_123` tablolarını SQLite'a yükleyip çapraz-kaynak JOIN yapma → Floem BI'da "kompozit model" fikrinin ilkel hali (Floem BI'da DuckDB ile yapılmalı).

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Yok. Redash'te semantik katman, ölçü, ilişki, hiyerarşi kavramı bulunmuyor. En yakın yapılar:
- Veri kaynağı yapılandırması (JSON Schema ile tanımlı, UI formu bundan otomatik üretilir):
  ```python
  # redash/query_runner/mssql.py
  {"type": "object",
   "properties": {"user": {"type": "string"}, "password": {"type": "string"},
                  "server": {"type": "string", "default": "127.0.0.1"},
                  "port": {"type": "number", "default": 1433},
                  "db": {"type": "string", "title": "Database Name"}, ...},
   "required": ["db"], "secret": ["password"]}
  ```
- Şema keşfi çıktısı: `[{"name": "dbo.OINV", "columns": ["DocEntry", ...] | [{"name": "...", "type": "..."}]}]` (tablo + sütun listesi; PK/FK/ilişki bilgisi yok).
- Sorgu sonucu sütun tipleri: 6 sabit tip (`TYPE_INTEGER` ... `TYPE_DATE`).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Üretilmiyor; kullanıcı SQL'i elle yazar. Sistemin sorguya yaptığı tek dönüşümler:
1. Mustache parametre doldurma (`ParameterizedQuery.apply`).
2. Otomatik limit: `BaseSQLQueryRunner.apply_auto_limit` → `sqlparse` ile son ifade `SELECT` ve `LIMIT/TOP` yoksa `LIMIT 1000` / `TOP 1000` eklenir (MSSQL'de `limit_after_select=True` ile SELECT'ten hemen sonra).
3. Annotation: `/* user_id: 5, query_id: 12, Query Hash: ... */` yorumu (yalnızca regex ile doğrulanmış alanlar; MSSQL'de kapalı).
4. `split_sql_statements` ile çoklu ifade ayrıştırma.

## Alınacak fikirler
1. **Minimal connector arayüzü**: `configuration_schema / test_connection / run_query / get_schema` dörtlüsü + sınıf düzeyinde `register()` ve `enabled()` (sürücü yoksa sessizce kapat). Floem BI Gateway connector SDK'sı bu kadar sade başlamalı; üstüne `execute_streaming`, `cancel`, `capabilities` (DirectQuery destekler mi, pushdown seviyesi) eklenmeli.
2. **JSON Schema ile bağlantı formu**: `secret` ve `order` alanlarıyla UI formunun otomatik üretilmesi; şifrelerin API'de maskelenmesi.
3. **REST connector tasarımı** (`json_ds.py`): `path` ile kayıt dizisini bulma, iç içe nesne düzleştirme, URL/token sayfalama stratejileri, base_url origin kısıtı + SSRF koruması.
4. **Sonuç önbelleği anahtarı** = normalize edilmiş sorgu hash'i + data source id; tazelik `max_age` ile; **single-flight** Redis kilidi ile aynı sorgunun paralel çalışmasını engelleme.
5. **Zamanlama modeli**: `interval/time/day_of_week/until/disabled` JSON alanı, başarısızlık sayacı ve `2**n` dakika backoff, `remove_ghost_locks` ile asılı kilit temizliği.
6. **Şema önbelleği** TTL'li ve periyodik arka plan yenilemeli; `has_table_privilege` ile kullanıcının görebildiği nesneleri listeleme.
7. **Parametre güvenliği**: `is_safe` kavramı — serbest metin parametresi içeren native sorgular embed/public linkte çalıştırılmaz.
8. Pandas dtype → mantıksal tip eşleme tablosu (Excel/CSV import için).

## Kaçınılacaklar / zayıf yönler
- **Sonuç formatı satır başı dict + JSON** (`rows: [{...}]`) ve `query_results.data` sütununda JSON metin olarak saklanıyor: büyük sonuçlarda bellek ve depolama israfı. Floem BI'da Arrow IPC / Parquet kullanılmalı.
- **Önbellek anahtarında kullanıcı/RLS bağlamı yok**: aynı sorgu metni herkes için aynı sonucu döndürür. Floem BI'da RLS filtresi SQL'e enjekte edildiği için anahtar otomatik ayrışır, ama bu bilinçli tasarlanmalı.
- Tip sistemi çok zayıf (6 tip; MSSQL'de `types_map` 5 TDS kodundan ibaret, decimal → float). Floem BI'da decimal/para birimi hassasiyeti (SAP B1 tutarları) için yetersiz.
- MSSQL şema keşfinde sütun tipi, PK/FK yok → ilişki otomatik tespiti yapılamaz. Floem BI `sys.foreign_keys` / `INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS` okumalı.
- `run_query` senkron ve tüm sonucu `fetchall()` ile belleğe alıyor; streaming / sayfalama yok.
- Bağlantı havuzu yok; her sorguda yeni bağlantı açılıyor.
- Excel runner dosyayı URL'den indiriyor, şema keşfi yok; yerel dosya / sheet listesi desteği yok.
- `_get_tables_stats` her tablo için `select count(*)` atıyor — SAP B1 gibi büyük şemalarda maliyetli.
- `query_results.py` çapraz sorgu SQLite'a satır satır INSERT ile yükleniyor; performans zayıf.
- Erişim kontrolü sadece "grup → data source (view_only)" düzeyinde; RLS yok.

## Kullanım kararı: Fikir al
Lisans (BSD-2) kod alıntısına izin veriyor (telif bildirimi korunarak); `json_ds.py` sayfalama/düzleştirme mantığı ve `ssrf/` modülü gerekirse uyarlanabilir. Ancak Redash bir uygulama olarak bağımlılık olmaya uygun değil ve semantik katmanı yok; connector arayüzü, önbellek anahtarı, single-flight kilidi ve zamanlama modeli fikir olarak alınmalı.
