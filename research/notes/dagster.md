# Dagster
- URL: https://github.com/dagster-io/dagster
- Lisans: **Apache 2.0** — doğrulandı (kök `LICENSE`; her paket ve kütüphane altında ayrı Apache 2.0 `LICENSE`). Vendored: `dagster/_vendored/croniter`, `dateutil` (MIT/BSD). `python_modules/dagster-cloud/` (Dagster+ ajan istemcisi) de `pyproject.toml`'da `Apache-2.0`, ama yalnızca ücretli Dagster+ SaaS'e bağlanmak için — işimize yaramaz. `ee/` klasörü yok.
- Dil: Python (backend), TypeScript/React (UI: `js_modules/`)
- Sürüm: kaynakta `__version__ = "1!0+dev"` (`dagster/version.py`; yayın sürümleri CI'da atanıyor, repoda sabit sürüm yok)
- Son commit tarihi: 2026-11-17

## Ne yapıyor (3-5 cümle)
Veri varlıklarını (tablo, dosya, model) `@asset` olarak tanımlayıp bağımlılık grafiği üzerinden materyalize eden bir orkestratör. Schedule (cron), sensor (olay/poll), declarative automation (`AutomationCondition.on_cron/eager`) ile ne zaman çalışacağına karar verir; zaman/statik/dinamik partition'lar ve backfill destekler. Çalıştırmaları (run) kuyruğa alır, eşzamanlılığı tag bazlı sınırlar, olay günlüğünü (event log) Postgres/SQLite'ta saklar ve web UI sunar. `dagster-dlt`, `dagster-dbt`, `dagster-duckdb`, `dagster-powerbi` gibi entegrasyonları vardır.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `python_modules/dagster/dagster/_core/definitions/` | `decorators/` (`@asset`, `@schedule`, `@sensor`), `schedule_definition.py`, `sensor_definition.py`, `partitions/definition/` (`time_window.py`, `dynamic.py`, `multi.py`), `declarative_automation/` (`automation_condition.py`), `freshness_policy.py`, `backfill_policy.py`, `definitions_class.py` (`Definitions`) |
| `python_modules/dagster/dagster/_daemon/` | Arka plan süreçleri: `sensor.py`, `asset_daemon.py` (automation), `backfill.py`, `run_coordinator/`, `freshness.py` |
| `python_modules/dagster/dagster/_core/run_coordinator/queued_run_coordinator.py` | Run kuyruğu, `max_concurrent_runs`, `tag_concurrency_limits` |
| `python_modules/dagster/dagster/_core/storage/` | `runs/`, `event_log/`, `schedules/` (SQLite/Postgres), IO manager'lar |
| `python_modules/dagster/dagster/_core/workspace/` | Code location (ayrı süreç/gRPC) yükleme, `workspace.yaml` |
| `python_modules/libraries/dagster-dlt/dagster_dlt/` | `asset_decorator.py` (`@dlt_assets`), `translator.py` (dlt resource → asset key) |
| `python_modules/libraries/dagster-dbt/` | dbt manifest → asset grafiği |

Akış: `Definitions(assets, schedules, sensors)` → code location sunucusu (gRPC) → daemon (schedule/sensor/automation tick) → `RunRequest` → QueuedRunCoordinator → run launcher (süreç/Docker/K8s) → event log → UI.

## Floem BI için kritik kısımlar
- `_core/definitions/partitions/definition/time_window.py` + `dynamic.py` → Günlük/aylık partition ve **dinamik partition** (çalışma zamanında eklenen anahtarlar). → Floem incremental refresh (zaman dilimi) ve kiracı başına partition (`DynamicPartitionsDefinition("tenants")`).
- `_core/definitions/declarative_automation/automation_condition.py` (`on_cron` L948, `eager` L926, `on_missing` L967) → "Bronze yenilendiyse Silver/Gold'u yenile" türü koşullu tetikleme. → Floem zamanlanmış yenileme + bağımlı yenileme zinciri.
- `_core/run_coordinator/queued_run_coordinator.py` (`tag_concurrency_limits`) → Kiracı/ajan başına eşzamanlı yenileme sınırı. → Gateway başına tek yükleme, kiracı başına adil kuyruk.
- `_daemon/sensor.py`, `_core/definitions/sensor_definition.py` → Poll tabanlı tetikleme (ör. "ajan yeni parquet paketi yükledi"). → Ajan → merkez olay tetiklemesi.
- `libraries/dagster-dlt/dagster_dlt/asset_decorator.py` → dlt kaynaklarını asset'e çevirir. → Floem dlt tabanlı Bronze yüklemesinin orkestrasyonu.
- `_core/storage/runs/`, `event_log/` → Run geçmişi ve materyalizasyon kayıtları. → "Yenileme geçmişi" ekranı.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Uygulanamaz.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Uygulanamaz.

## Alınacak fikirler
- Yenilemeyi "job" değil **asset** (dataset/Gold tablo) merkezli modellemek: her semantik modelin bağımlı olduğu tablolar asset grafiği.
- Declarative automation koşulları (cron + upstream güncellendi + eksik partition) → Floem yenileme politikası JSON'u.
- Tag bazlı eşzamanlılık limitleri ve kuyruk → kiracı izolasyonu.
- Partition + backfill kavramı → incremental refresh ve geçmiş yeniden yükleme.

## Kaçınılacaklar / zayıf yönler
- Çok kiracılık yerleşik değil: OSS'de RBAC/kiracı izolasyonu yok (Dagster+ ücretli). Kiracı başına asset tanımı ya dinamik partition ya da kod üretimi (code location başına kiracı) gerektirir; binlerce kiracıda code location yaklaşımı ölçeklenmez.
- Tanımlar Python kodu: Kullanıcının UI'dan oluşturduğu yenileme planlarını Dagster'a aktarmak için dinamik `Definitions` üretimi ve yeniden yükleme gerekir (karmaşık).
- Ağır işletim: daemon + webserver + code location + Postgres; on-prem tek sunucu kurulumları için fazla.
- Sürüm hızı yüksek, API'lerin bir kısmı (automation, components) sık değişiyor.

## Kullanım kararı: **Fikir al**
MVP'de Floem kendi hafif zamanlayıcısını (ör. APScheduler/Postgres tabanlı iş kuyruğu + kiracı-aware kuyruk) yazmalı; Dagster'ın asset/partition/automation-condition modeli referans alınmalı. İleride iç veri platformu (Floem'in kendi Bronze/Silver/Gold işleri, kiracıya görünmeyen) için bağımlılık olarak değerlendirilebilir.
