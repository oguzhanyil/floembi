# 90 - Altyapı bileşenleri (Grup 4)

> Tarih: 17.11.2026. Kaynak: resmi dokümantasyon, GitHub sayfaları ve LICENSE dosyaları (web üzerinden okundu; repolar klonlanmadı).
> Kural: yalnızca MIT / Apache 2.0 / BSD. MinIO (AGPL, bakım dışı) değerlendirme dışıdır.
> "Doğrulandı" = LICENSE dosyası `raw.githubusercontent.com` üzerinden bu tarihte okundu.
> Sürüm tarihlerinde GitHub sayfası yılı göstermediyse yıl, sayfa altbilgisinden veya varlık zaman damgalarından çıkarıldı ("yıl çıkarım" notu).

## Özet tablo

| Bileşen | URL | Lisans | Doğrulandı | Güncel kararlı sürüm | Floem BI'daki rol | Karar |
|---|---|---|---|---|---|---|
| DuckDB | https://github.com/duckdb/duckdb | MIT (Stichting DuckDB Foundation) | Evet (`LICENSE`) | v2.0.0 "Cyanoptera" (21.10.2026) | Import modu analitik motoru, Gold sorgulama, DAX→SQL hedefi | **Bağımlılık (MVP)** |
| ClickHouse | https://github.com/ClickHouse/ClickHouse | Apache 2.0 (ClickHouse, Inc.) | Evet (`LICENSE`) | v26.9.30.7-stable; LTS v26.8.38.9-lts (16.11.2026, yıl çıkarım) | Büyük ölçek / paylaşımlı çok kiracılı motor | **Sonraki aşama** |
| Apache Arrow (pyarrow) | https://github.com/apache/arrow | Apache 2.0 (+ izinli 3. taraf bileşenler) | Evet (`LICENSE.txt`) | 26.0.1 (03.11.2026, yıl çıkarım) | Bellek/aktarım formatı; Gateway → Floem veri taşıma | **Bağımlılık (MVP)** (IPC); Flight **Sonraki aşama** |
| Apache Iceberg / pyiceberg | https://github.com/apache/iceberg (pyiceberg: https://github.com/apache/iceberg-python) | Apache 2.0 | Evet (her iki repo `LICENSE`) | Java 1.12.0 (30.09.2026, yıl çıkarım); pyiceberg 0.12.0 (01.09.2026, PyPI) | Lakehouse tablo formatı (Silver/Gold) | **Sonraki aşama** (v1 adayı) |
| delta-rs (deltalake) | https://github.com/delta-io/delta-rs | Apache 2.0 | Evet (`LICENSE.txt`, PyPI sınıflandırıcısı) | Python deltalake 1.6.6 (24.09.2026, PyPI); Rust 1.0.0 (28.09.2026, yıl çıkarım) | Alternatif tablo formatı | **Gereksiz** (Iceberg tercih edilirse); yedek seçenek |
| SeaweedFS | https://github.com/seaweedfs/seaweedfs | Apache 2.0 (Copyright 2025 Chris Lu) | Evet (`LICENSE`) | 4.54 (16.11.2026, yıl çıkarım) | S3 uyumlu nesne depolama (bulut/ölçekli kurulum) | **Sonraki aşama** (S3'e geçişte ilk tercih) |
| RustFS | https://github.com/rustfs/rustfs | Apache 2.0 (RustFS, Inc.) | Evet (`LICENSE`) | 1.0.6 (15.11.2026, yıl çıkarım) | S3 uyumlu nesne depolama (pilot) | **Sonraki aşama — yalnızca pilot/test**, üretimde değil |
| Apache DataFusion | https://github.com/apache/datafusion | Apache 2.0 | Evet (`LICENSE.txt`) | crate 55.2.0 (07.10.2026, crates.io API) | Kendi Rust motoru için temel (ileride) | **Sonraki aşama** (v2+) |
| Polars | https://github.com/pola-rs/polars | MIT (Ritchie Vink; kısmen NVIDIA) | Evet (`LICENSE`) | Python 2.1.0 (25.10.2026, yıl çıkarım) | Bronze→Silver Python dönüşümleri, agent tarafı tip düzeltme | **Bağımlılık (MVP)** (opsiyonel; DuckDB SQL yetmezse) |
| Keycloak | https://github.com/keycloak/keycloak | Apache 2.0 | Evet (`LICENSE.txt`) | 26.8.2 (05.11.2026, yıl çıkarım) | SSO, OIDC/SAML, tenant başına IdP | **Bağımlılık (MVP)** — Organizations ile, realm-per-tenant değil |
| Trino | https://github.com/trinodb/trino | Apache 2.0 | Evet (`LICENSE`) | 484 (15.10.2026) | Federe sorgu | **Gereksiz** |
| Apache Calcite | https://github.com/apache/calcite | Apache 2.0 (+ dokümantasyon sitesinde MIT/OFL bileşenler) | Evet (`LICENSE`) | 1.42.0 (31.05.2026) | Sorgu planlayıcı | **Gereksiz** |

**Lisans sürprizi yok:** 12 bileşenin hepsi LICENSE dosyasında beklenen lisansı taşıyor. Dikkat edilecek noktalar:
- **Arrow** `LICENSE.txt` içinde paketlenmiş 3. taraf kodlar var: BSD-2/3, MIT, Boost, zlib, PSF v2, ZPL 2.1 (mingw-w64 polyfill), CC0, OpenSSL/SSLeay. Hepsi izinli. Ancak NOTICE üretiminde pyarrow wheel'inin kendi `LICENSE.txt` + `NOTICE.txt` dosyaları aynen taşınmalı.
- **SeaweedFS**'in ayrı bir **Enterprise Edition**'ı var (veri kurtarma, self-healing, özelleştirilebilir erasure coding). Bu özellikler açık kaynak sürümde yok; lisans koşulları GitHub sayfasında açıklanmıyor (doğrulanamadı). Biz yalnızca Apache 2.0 sürümünü kullanırız.
- **DuckDB community extension**'ları (ör. `mssql`) DuckDB Labs tarafından yazılmıyor ve denetlenmiyor; her birinin lisansı ayrıca kontrol edilmeli. Core extension'lar (iceberg, delta, httpfs) DuckDB organizasyonu altında. Tek tek lisansları bu çalışmada doğrulanmadı.
- **Calcite**: kaynak kodu Apache 2.0. MIT/OFL bileşenler (font-awesome, jekyll, lato) yalnızca site/dokümantasyon tarafında.
- **ClickHouse, RustFS**: telif şirkette (ClickHouse, Inc., RustFS, Inc.). Bu durum ileride yeni sürümlerde lisans değişikliği riskini artırır, ama mevcut Apache 2.0 sürümler geri alınamaz.

---

## 1. DuckDB — Import modu motoru

- **Lisans:** MIT, doğrulandı (`LICENSE`: "Copyright 2018-2026 Stichting DuckDB Foundation"). Telifin vakıfta olması lisans değişikliği riskini düşürür.
- **Sürüm:** v2.0.0 (21.10.2026). Öne çıkanlar: async Parquet okuma/yazma, aggregate state export, daha hızlı ROLLUP/CUBE/GROUPING SETS (matris görseli ve toplam satırları için doğrudan faydalı), ICU bağımlılığının kaldırılması, `spark` lehçe modu.
- **Rol:** Gold katmanını (Parquet ya da `.duckdb` dosyası) sorgulayan, DAX→SQL derleyicisinin hedef lehçesi olan gömülü motor. VertiPaq'ın karşılığı.
- **Eşzamanlılık** (resmi doküman, `connect/concurrency`):
  - Bir veritabanı dosyasında **tek okuma-yazma süreci** olabilir. O süreç içinde çok sayıda thread yazabilir (MVCC + optimistic concurrency). Append'ler çakışmaz; aynı satıra eşzamanlı güncelleme "conflict" hatası verir.
  - `READ_ONLY` modda birden çok süreç aynı dosyayı okuyabilir, ama o sırada hiçbir süreç yazamaz.
  - Çok süreçten yazma için doküman iki yol gösteriyor: "Quack" remote protokolü (DuckDB'yi client-server yapar) ya da PostgreSQL kataloglu **DuckLake** (DuckLake lisansı: MIT, doğrulandı).
  - Ağ paylaşımındaki (SMB/NFS) dosyalarda dosya kilitleri güvenilir değil. Doküman bu konuda uyarıyor.
  - **Floem BI sonucu:** sorgu sunucusu ve yenileme işi aynı dosyaya aynı anda yazmamalı. Önerilen desen: yenileme yeni bir dosya/snapshot üretir (`gold_<tenant>_<ts>.duckdb` ya da Parquet), sorgu servisi atomik olarak yeni sürüme geçer (blue/green). Böylece okuyucular kilitlenmez.
- **Çok kiracılık:** yerleşik kullanıcı/rol/RLS yok. İzolasyon uygulama katmanında yapılır: tenant başına ayrı dosya/klasör, tenant başına bağlantı havuzu, RLS ise derlenen SQL'e `WHERE` olarak eklenir. `memory_limit` ve `threads` bağlantı başına ayarlanabilir, ama süreç içi tenant'lar arasında sert kaynak izolasyonu yoktur. Gürültülü komşu riskine karşı büyük tenant'lar ayrı worker sürecine alınmalı.
- **Bellek:** kolon bazlı, vektörize yürütme yapar ve diske taşabilir (out-of-core). VertiPaq gibi tüm modeli RAM'e almak zorunda değildir. Bu, tek sunucuda çok tenant barındırırken avantajdır.
- **Windows/on-prem:** Windows AMD64 resmi platform (pip wheel, CLI). Tek süreç içinde gömülü olduğu için ek servis kurulumu gerekmez. On-prem "Floem BI tek sunucu" paketlemesi için idealdir.
- **T-SQL/MSSQL:** resmi bir SQL Server extension'ı yok. Community `mssql` extension'ı (hugr-lab, native TDS + TLS, pushdown, Entra ID) var, ama DuckDB Labs denetiminde değil ve lisansı doğrulanmadı. **Öneri:** SQL Server okumasını agent tarafında (`mssql-python`/`pyodbc`) yap, DuckDB'ye Arrow olarak ver. T-SQL lehçesi üretimi için sqlglot kullan.
- **Lakehouse:** `iceberg` extension'ı catalog-managed tablolarda yazmayı destekliyor (INSERT; UPDATE/DELETE/MERGE "Writing to Iceberg" sayfasında listeleniyor, ayrıntıları okunmadı). Doğrudan dosya okuma yalnızca okuma amaçlı. `delta` extension'ı CREATE TABLE ve INSERT destekliyor, ama UPDATE/DELETE/MERGE/CTAS desteklemiyor.
- **Zayıf yönler:** tek yazar modeli; yerleşik sunucu/erişim kontrolü yok; büyük veride (yüzlerce GB ve üzeri, çok sayıda eşzamanlı kullanıcı) tek düğümle sınırlı; community extension güvenliği.
- **Karar:** **Bağımlılık olarak kullan (MVP).**

## 2. ClickHouse — ölçek ve paylaşımlı çok kiracılık

- **Lisans:** Apache 2.0, doğrulandı ("Copyright 2016-2026 ClickHouse, Inc.").
- **Sürüm:** stable v26.9.30.7 (16.11.2026), v26.10.x stable hattı da mevcut. LTS v26.8.38.9-lts. Üretimde LTS hattı önerilir.
- **Rol:** DuckDB'nin tek düğüm sınırını aşan tenant'lar ya da tek paylaşımlı küme isteyen SaaS dağıtımı için ikinci motor.
- **Güçlü yönler:**
  - Gerçek client-server, yüksek eşzamanlılık, dağıtık (shard/replica).
  - Çok kiracılık için yerleşik RBAC: kullanıcı, rol, **row policy**, **settings profile**, **quota**. Kiracı başına kaynak sınırı (quota/profile) DuckDB'de yoktur.
  - Materialized view ve projection'lar Power BI aggregation tablolarına karşılık gelir.
- **Zayıf yönler:**
  - Row policy'ler yalnızca salt okuma erişimde anlamlı. Doküman, yazma/partition kopyalama hakkı varsa kısıtlamanın aşılabileceğini ve sistem tablolarının satır sayısı gibi metadata sızdırabileceğini belirtiyor. Bu nedenle sert izolasyon için tenant başına database + kullanıcı önerilir.
  - Resmi kurulum sayfasında **Windows paketi yok** (Linux paketleri, Docker, kaynak). Windows on-prem müşterilerde ancak Docker/WSL ile çalışır. On-prem Windows için uygun değil.
  - Operasyonel yük: Keeper/ZooKeeper, replikasyon, sürüm yükseltmeleri.
  - SQL lehçesi standarttan sapıyor (JOIN semantiği, `Nullable`, tip sistemi). DAX→SQL derleyicisinde ikinci bir lehçe arka ucu gerekir; sqlglot bu lehçeyi destekliyor.
  - DAX tarzı çok tablolu yıldız şema JOIN'lerinde DuckDB kadar rahat değil. Geniş/denormalize tablolarda çok güçlü.
- **T-SQL/MSSQL:** `odbc` table function ve tablo motoru üzerinden bağlanılabilir. Ayrıntılar bu çalışmada doğrulanmadı.
- **Karar:** **Sonraki aşama.** Ölçüm kriteri: tenant başına Gold boyutu tek düğüm DuckDB'nin interaktif gecikme sınırını (ör. p95 > 2 sn) aşarsa ya da SaaS'ta yüzlerce eşzamanlı kullanıcı olursa.

### DuckDB vs ClickHouse

| Kriter | DuckDB | ClickHouse |
|---|---|---|
| Dağıtım | Gömülü kütüphane, sıfır servis | Sunucu/küme, Keeper |
| Windows on-prem | Resmi destek | Resmi paket yok (Docker/WSL) |
| Eşzamanlı yazma | Tek süreç yazar | Çok istemci, yüksek ingest |
| Eşzamanlı okuma | Süreç içi çok thread; çok süreç için READ_ONLY | Yüksek, dağıtık |
| Çok kiracılık | Uygulama katmanında (ayrı dosya) | Yerleşik RBAC, row policy, quota |
| Kaynak izolasyonu | Yok (süreç ayırarak) | Quota, settings profile |
| Yıldız şema JOIN | Güçlü | Orta (denormalizasyon tercih edilir) |
| Veri boyutu (pratik) | Tek düğüm (out-of-core) | TB–PB, dağıtık |
| Lakehouse okuma | Iceberg/Delta/Parquet extension'ları | Iceberg/Delta/S3 table function'ları |
| Operasyon maliyeti | Çok düşük | Orta-yüksek |

**Sonuç:** MVP'de yalnızca DuckDB kullanılmalı. Hedef pazar (SAP B1 KOBİ müşterileri, tenant başına birkaç GB–onlarca GB) tek düğüm DuckDB için uygun. DAX→SQL derleyicisi baştan **lehçe soyutlamalı** (sqlglot) tasarlanırsa ClickHouse ileride ikinci arka uç olarak eklenebilir. Ortak format Parquet/Iceberg olursa veri taşımaya gerek kalmaz; ClickHouse aynı dosyaları okuyabilir.

## 3. Apache Arrow — bellek formatı ve Gateway taşıma

- **Lisans:** Apache 2.0, doğrulandı (`LICENSE.txt`). Paketlenmiş 3. taraf kodların hepsi izinli lisanslı (yukarıdaki nota bakın).
- **Sürüm:** 26.0.1 (03.11.2026).
- **Rol:** agent → Floem aktarım formatı (IPC stream), DuckDB/Polars/pyiceberg arasında sıfır kopya veri değişimi, sorgu sonucunun frontend'e iletilmesi (Arrow IPC → JS `apache-arrow`).
- **Arrow Flight:** gRPC üzerinde çalışır (`grpc+tls`, mTLS bazı implementasyonlarda). `DoGet`/`DoPut`/`DoExchange` RPC'leri, paralel endpoint'ler ve `PollFlightInfo` sunar. Spec, handshake token'ının her çağrıda doğrulanmaması durumunda güvenli olmadığını açıkça uyarıyor.
- **Windows:** pyarrow Windows wheel'leri mevcut. Flight'ın Windows wheel'inde bulunduğu genel bilgi, bu çalışmada ayrıca doğrulanmadı.

### Arrow Flight vs Arrow IPC over HTTP/WebSocket

| Kriter | Arrow Flight (gRPC) | Arrow IPC stream over HTTP/2 veya WebSocket |
|---|---|---|
| Ağ geçişi | gRPC/HTTP2. Kurumsal proxy ve TLS inspection cihazları gRPC'yi sık bozar | Düz HTTPS/WSS, proxy dostu |
| Yön | İstemci → sunucu. Agent dışa bağlantı açtığı için ters yön (Floem'in agent'tan veri istemesi) ek tasarım gerektirir (DoExchange ya da ters tünel) | WebSocket zaten çift yönlü. Tek dışa açılan bağlantı üzerinde komut + veri çoklanabilir |
| Paralellik | Yerleşik (çoklu endpoint/ticket) | Elle (çoklu stream/chunk) |
| Karmaşıklık | Protobuf, gRPC bağımlılığı, sertifika yönetimi | Az: `pyarrow.ipc.new_stream` + mevcut tünel |
| Performans | Çok yüksek | Pratikte benzer (aynı IPC baytları; darboğaz WAN bant genişliği) |
| Tarayıcı | Doğrudan değil (gRPC-web gerekir) | Doğrudan (fetch/WebSocket + `apache-arrow` JS) |

**Sonuç:** MVP'de **Arrow IPC stream (zstd/lz4 sıkıştırmalı) + agent'ın açtığı WSS/HTTP2 tüneli** kullanılmalı. Bu, Power BI Gateway'in "yalnızca dışa bağlantı" modeline ve 00-floemdata-hedef.md'deki tünel tasarımına doğrudan uyar. Flight, ileride Floem içi servisler arasında (ör. sorgu servisi ↔ motor) ya da müşteri LAN'ında yüksek hacimli aktarım için değerlendirilir (**Sonraki aşama**). Flight SQL/ADBC, dış araçlara (Excel/Python istemcileri) sorgu uç noktası açmak için ilginç bir v2 seçeneği.

## 4. Apache Iceberg + pyiceberg — lakehouse tablo formatı

- **Lisans:** Apache 2.0, doğrulandı. Hem `apache/iceberg` hem `apache/iceberg-python` LICENSE dosyaları okundu. Paketlenmiş kod da Apache 2.0. pyiceberg'teki Cython ile üretilmiş C kodu için ek kısıt olmadığı LICENSE'ta belirtiliyor.
- **Sürüm:** Java 1.12.0 (30.09.2026); pyiceberg 0.12.0 (01.09.2026). pyiceberg hâlâ 0.x. API kırılması olabilir.
- **pyiceberg yetenekleri** (0.12.0 sürüm notları ve PyPI): append/overwrite (RecordBatchReader kabul ediyor), delete düzeltmeleri, commit retry + eşzamanlılık doğrulaması. Kataloglar: SQL (Postgres/SQLite), REST, Hive, Glue, DynamoDB, BigQuery. Upsert bu sürüm notlarında geçmiyor; önceki sürümlerdeki durumu doğrulanmadı.
- **Güçlü yönler:** motor bağımsızlığı (DuckDB, ClickHouse, Trino, Spark, DataFusion okuyabilir), snapshot/time travel (yenileme geri alma), şema/partition evrimi, Apache vakfı yönetimi. **SeaweedFS yerleşik Iceberg REST Catalog sunuyor** (S3 Tables API). Bu, ayrı katalog servisi gerektirmeyen ilginç bir seçenek.
- **Zayıf yönler:** katalog bileşeni gerekiyor (en basiti: pyiceberg SQL catalog + Postgres/SQLite). Küçük dosya/metadata birikimi için compaction ve snapshot expire bakımı gerekiyor. Python tarafı Java'nın gerisinde.

### Iceberg vs Delta vs düz Parquet

| Kriter | Düz Parquet (+ DuckDB) | Iceberg (pyiceberg) | Delta (delta-rs) |
|---|---|---|---|
| Kurulum | Sıfır | Katalog gerekir (SQL/REST) | Katalogsuz (`_delta_log`) |
| ACID / atomik yenileme | Yok (dosya değiştirme + manifest ile elle) | Var | Var |
| Upsert/merge | Elle (yeniden yazma) | pyiceberg'te gelişiyor | delta-rs'te `merge` mevcut |
| Time travel / geri alma | Yok | Var | Var |
| DuckDB desteği | Doğal | Okuma + catalog-managed yazma | Okuma + yalnızca append yazma |
| ClickHouse/Trino/Spark | Var | Geniş (sektör standardı yönünde) | Geniş, Databricks merkezli |
| Yönetişim | — | Apache Software Foundation | Linux Foundation (Delta Lake) |
| Bakım işleri | Yok | compaction, expire snapshots | optimize, vacuum |

**Sonuç:**
- **MVP:** Bronze = append-only, partition'lı **düz Parquet** (`tenant/source/table/load_date=.../*.parquet`). Silver/Gold = DuckDB ile üretilen Parquet ya da tenant başına `.duckdb` dosyası. Atomiklik "yeni klasöre yaz + manifest/pointer değiştir" deseniyle sağlanır.
- **v1:** Silver/Gold'u **Iceberg**'e taşı (pyiceberg SQL catalog, Postgres metadata DB'si ya da SeaweedFS Iceberg REST catalog). Gerekçe: ClickHouse/DataFusion geçişinde motor bağımsızlığı.
- **Delta:** Fabric/OneLake ile birlikte çalışma (Fabric Delta kullanıyor) bir gereksinim olursa delta-rs devreye alınır. Aksi halde iki tablo formatını taşımaya gerek yok.
- **DuckLake** (MIT, doğrulandı): katalog bir SQL veritabanında, veri Parquet'te. DuckDB-merkezli bir yığın için Iceberg'e hafif bir alternatif. Ancak ekosistemi DuckDB'ye bağlı. İzlenmeli, karar v1'de.

## 5. delta-rs (deltalake)

- **Lisans:** Apache 2.0, doğrulandı (`LICENSE.txt`; PyPI: "Apache Software License").
- **Sürüm:** Python `deltalake` 1.6.6 (24.09.2026); Rust 1.0.0 (28.09.2026).
- **Güçlü:** JVM'siz Delta okuma/yazma, `merge`, katalogsuz kurulum, Polars/DuckDB entegrasyonu.
- **Zayıf:** DuckDB `delta` extension'ı UPDATE/DELETE/MERGE yazamıyor. Yazma yolu delta-rs üzerinden olmalı, bu da iki farklı yazma yolu demek. Ekosistem Databricks/Fabric yönelimli.
- **Karar:** **Gereksiz** (MVP ve v1 için). Fabric/OneLake birlikte çalışması istenirse yeniden değerlendirilir.

## 6. SeaweedFS — S3 uyumlu depolama (olgun)

- **Lisans:** Apache 2.0, doğrulandı ("Copyright 2025 Chris Lu"). Ayrı ticari Enterprise Edition var (erasure coding özelleştirme, self-healing, veri kurtarma). Koşulları doğrulanamadı.
- **Sürüm:** 4.54 (16.11.2026). GitHub'da 36.1k yıldız, sık sürüm çıkıyor.
- **Güçlü yönler:** geniş S3 API (73 bucket/object işlemi, IAM 39, STS 5, versioning, Object Lock, lifecycle, bucket policy). STS federasyonu (OIDC; Keycloak ile entegre edilebilir). Küçük dosyalarda çok iyi (append-only volume, inode yok). **S3 Tables + yerleşik Iceberg REST Catalog** var. FUSE mount Windows'ta da çalışıyor. Go ile yazılmış tek binary.
- **Zayıf yönler:** mimari parçalı (master, volume, filer, S3 gateway). Filer için metadata store seçimi gerekiyor. Gelişmiş EC/self-healing Enterprise'da. Çok kiracılık için bucket + IAM policy tasarımı bize kalıyor. Windows'ta sunucu olarak üretim kullanımı yaygın değil (doğrulanamadı).
- **Karar:** **Sonraki aşama** (tek sunucudan S3'e geçişte birinci tercih). On-prem tek sunucu kurulumda yerel dosya sistemi yeterli.

## 7. RustFS — S3 uyumlu depolama (yeni)

- **Lisans:** Apache 2.0, doğrulandı ("Copyright 2024-2026 RustFS, Inc."). Telif tek şirkette; MinIO'nun geçmişte yaşadığı lisans değişikliği senaryosu teorik olarak mümkün.
- **Sürüm:** 1.0.6 (15.11.2026). 1.0.0 GA yakın zamanda çıkmış (1.0.0-rc.6 hâlâ "pre-release" olarak listede). 1.0.5 notlarında karışık sürümlü kümelerde DELETE'in geçici 503 dönebileceği uyarısı var.
- **Güvenlik geçmişi (kritik):** 2025 sonu – 2026 arasında çok sayıda yüksek/kritik CVE yayımlandı (OpenCVE'de 33 kayıt). Örnekler: CVE-2025-68705 (path traversal; varsayılan RPC secret `rustfs-default-secret`), CVE-2026-27607 (upload policy bypass), CVE-2026-22043 (yetki yükseltme), CVE-2026-45041 (üretim kodunda gömülü RSA özel anahtarı), CVE-2026-49991 (replikasyon anahtarlarının ifşası). Çoğu alpha/beta serisinde düzeltildi. Bağımsız bir güvenlik denetimi bulunamadı.
- **Güçlü yönler:** Rust ile yazılmış, MinIO benzeri basit tek binary deneyimi, yüksek performans iddiası.
- **Karar:** **Sonraki aşama — yalnızca pilot/lab.** Müşteri verisini tutan üretim depolaması olarak 1.x hattında en az 6–12 ay temiz güvenlik sicili görülene kadar kullanılmamalı.

### SeaweedFS vs RustFS

| Kriter | SeaweedFS | RustFS |
|---|---|---|
| Olgunluk | 10+ yıl, 4.x | 1.0 GA yeni (2026) |
| Güvenlik sicili | Ciddi bir seri bilinmiyor (ayrıca taranmadı) | 2025-26'da çok sayıda kritik CVE |
| S3 kapsamı | Çok geniş + IAM/STS + S3 Tables/Iceberg REST | MinIO uyumlu hedefli; ayrıntı doğrulanmadı |
| Mimari | Çok bileşenli | Tek binary, basit |
| Küçük dosya | Çok iyi | Doğrulanmadı |
| Lisans riski | Apache 2.0 + ayrı Enterprise | Apache 2.0, tek şirket |
| Öneri | Üretim | Pilot |

**Not:** Floem kodu yalnızca S3 API'sine (boto3/`obstore`/DuckDB `httpfs`) yazılmalı. Böylece depolama değiştirilebilir kalır (SeaweedFS ↔ RustFS ↔ AWS S3 / Azure Blob ↔ yerel FS).

## 8. Apache DataFusion

- **Lisans:** Apache 2.0, doğrulandı. **Sürüm:** crate 55.2.0 (07.10.2026). GitHub Releases sayfası boş, sürümler crates.io/tag üzerinden çıkıyor.
- **Rol:** ileride kendi motoru (ör. VertiPaq benzeri kolon önbelleği + özel DAX operatörleri) yazmak istenirse genişletilebilir planlayıcı/yürütücü. Arrow-native, Iceberg (iceberg-rust) entegrasyonu var.
- **Zayıf:** Rust uzmanlığı gerektirir. DuckDB'nin tek düğümdeki hazır performansına ve ekosistemine karşı MVP'de ek değer yok. Python binding'leri var, ama Floem'in Python backend'inde DuckDB'nin yerini almak için gerekçe yok.
- **Karar:** **Sonraki aşama (v2+).**

## 9. Polars

- **Lisans:** MIT, doğrulandı. **Sürüm:** Python 2.1.0 (25.10.2026). 2.x ana sürümünde 1.x'ten API değişiklikleri olabilir; sürüm sabitlenmeli.
- **Rol:** Bronze→Silver Python dönüşümleri (SAP B1 kod tablosu çözümleme, tip düzeltme, tekilleştirme), agent tarafında hafif DataFrame işleme, Excel okuma (calamine motoru). Arrow-native, DuckDB ile sıfır kopya veri alışverişi yapar.
- **Zayıf:** DuckDB SQL ile örtüşüyor; iki dönüşüm dili bakım yükü getirir. Dağıtık değil.
- **Karar:** **Bağımlılık (MVP), opsiyonel.** Varsayılan dönüşüm dili DuckDB SQL olmalı. Polars, SQL ile ifadesi zor olan prosedürel adımlar ve agent tarafı için kullanılmalı.

## 10. Keycloak — SSO

- **Lisans:** Apache 2.0, doğrulandı. **Sürüm:** 26.8.2 (05.11.2026).
- **Rol:** OIDC/SAML SSO, tenant'ın kendi IdP'si ile federasyon (Entra ID/AD FS/LDAP), Floem BI kullanıcı/rol token'ları. Token claim'leri (`tenant_id`, roller) RLS'ye beslenir.
- **Realm-per-tenant ölçek sınırları:**
  - Resmi doküman: "One Keycloak deployment can define, store, and manage as many realms as there is space for in the database". Yani resmi bir üst sınır yok.
  - Topluluk raporları (2016–2021): ~100–120 realm'den sonra yavaşlama; 2.000+ realm'de yeni realm oluşturma "birkaç dakika".
  - Skycloak ölçümü (Keycloak 26.6, Temmuz 2026; Skycloak yönetilen Keycloak satan bir firma, sonuçlar ihtiyatla okunmalı): boş realm başına ~1 MB heap. 2.000 realm'de pod soğuk başlatma 176–240 sn, tam küme yeniden başlatma ~7,5–8 dk. 3.000 realm'de `GET /admin/realms` ~39 sn ve admin konsolu realm seçici ~50 sn. Realm oluşturma hızı 100 realm'de 2,33/sn iken 2.000 realm'de 0,89/sn. **Login/token/JWKS gecikmesi realm sayısından bağımsız ve düz.** Önerilen pratik sınır: küme başına **~300–400 realm**, üstünde sharding.
  - Phase Two (Organizations eklentisi satan firma) da "yüzlerce realm"de bozulma raporluyor.
- **Alternatif — Organizations:** Keycloak 26.0'dan beri **fully supported** (resmi 26.0.0 duyurusu). Tek realm içinde tenant = organization. Organizasyon başına IdP bağlama ve e-posta domain'ine göre yönlendirme sunuyor; 26.6'da Organization Groups eklendi. Varsayılan olarak açık olup olmadığı kaynaklarda çelişkili (doğrulanamadı; `--features=organization` gerekebilir).
- **Windows/on-prem:** Java (Quarkus) uygulaması, JVM olan her yerde çalışır. Üretimde harici bir DB (PostgreSQL) gerekir. On-prem tek müşteri kurulumunda tek realm yeterli.
- **Zayıf yönler:** JVM bellek ayak izi; sürüm yükseltmeleri sık ve zaman zaman kırıcı; tema/özelleştirme Java/FreeMarker gerektiriyor.
- **Karar:** **Bağımlılık (MVP)** şu desenle: **SaaS'ta tek realm + Organizations (tenant = organization)**. Yalnızca özel güvenlik/özelleştirme gerektiren büyük kurumsal tenant'lara ayrı realm verilir. Toplam realm sayısı küme başına birkaç yüzün altında tutulur. On-prem kurulum = tek realm.

## 11. Trino

- **Lisans:** Apache 2.0, doğrulandı. **Sürüm:** 484 (15.10.2026).
- **Değerlendirme:** federe sorgu (SQL Server + Postgres + Iceberg'i tek SQL'de birleştirme) güçlü. Ancak JVM koordinatör/worker kümesi gerektiriyor ve bellek ayak izi yüksek. Floem'de federasyon ihtiyacı Import (Gold'da birleştirme) ve agent üzerinden DirectQuery ile karşılanıyor. Kaynaklar müşteri ağında, agent arkasında olduğu için Trino zaten bunlara doğrudan erişemez. Kompozit model (Import + DirectQuery karışımı) gerekirse bile birleştirme DuckDB'de yapılabilir.
- **Karar:** **Gereksiz.**

## 12. Apache Calcite

- **Lisans:** Apache 2.0, doğrulandı. **Sürüm:** 1.42.0 (31.05.2026).
- **Değerlendirme:** Java kütüphanesi. Python backend ile entegrasyonu zayıf (JPype/servis gerekir). DAX→SQL derleme, lehçe üretimi ve SQL AST denetimi için **sqlglot** (MIT, Python) aynı ihtiyacı Floem yığınında karşılıyor. Maliyet tabanlı optimizasyonu hedef motorlar (DuckDB/ClickHouse) zaten kendileri yapıyor.
- **Karar:** **Gereksiz.**

---

## MVP için önerilen altyapı yığını

| Katman | Seçim | Not |
|---|---|---|
| Analitik motor (Import) | **DuckDB 2.0.x** (gömülü, Python) | Tenant başına ayrı dosya/klasör. Yenileme yeni snapshot üretir, sorgu servisi atomik geçiş yapar. Büyük tenant'lar ayrı worker süreci |
| Depolama formatı | **Parquet** (Bronze append-only, Silver/Gold Parquet ya da `.duckdb`) | Iceberg'e geçişe uygun klasör düzeni: `tenant/layer/table/...` |
| Nesne depolama | **Yerel dosya sistemi** (on-prem). S3 soyutlaması kodda hazır tutulur | SaaS/ölçek: SeaweedFS. RustFS yalnızca lab |
| Gateway taşıma | **Arrow IPC stream** (zstd) — agent'ın açtığı **WSS/HTTP2 tüneli** üzerinden | Flight daha sonra, Floem içi servisler arasında |
| Dönüşüm | **DuckDB SQL** (Silver→Gold), **Polars** (gerektiğinde, agent + Bronze→Silver) | sqlglot ile T-SQL ↔ DuckDB lehçe çevirisi |
| Kimlik | **Keycloak 26.x** (PostgreSQL backend), **tek realm + Organizations** | Tenant claim'i → RLS |
| Metadata DB | PostgreSQL (Keycloak + Floem metadata; ileride Iceberg SQL catalog / DuckLake catalog) | Lisans bu notta değerlendirilmedi (PostgreSQL License, izinli) |

**v1:** Silver/Gold → Iceberg (pyiceberg; SQL catalog ya da SeaweedFS Iceberg REST), SeaweedFS S3, ClickHouse'u ikinci arka uç olarak POC. **v2:** ClickHouse üretimde (büyük tenant/paylaşımlı küme), Arrow Flight/Flight SQL dış uç noktası, DataFusion tabanlı özel motor değerlendirmesi.

## Kritik riskler

1. **DuckDB tek yazar modeli:** yenileme sırasında okuyucular kilitlenmesin diye snapshot/blue-green deseni zorunlu. Ağ paylaşımında (SMB) DuckDB dosyası tutulmamalı.
2. **DuckDB'de tenant kaynak izolasyonu yok:** tek süreçte çok tenant varsa gürültülü komşu sorunu çıkar. Süreç havuzu, `memory_limit` ve sorgu zaman aşımı gerekir.
3. **Keycloak realm-per-tenant ölçeklenmez** (~300–400 realm/küme pratik sınır; yeniden başlatma süreleri dakikalar). Organizations ile başlanmalı.
4. **RustFS güvenlik sicili zayıf;** üretim verisi için uygun değil.
5. **pyiceberg 0.x ve Polars 2.x** API değişkenliği: sürümler sabitlenmeli.
6. **ClickHouse'un Windows paketi yok:** Windows on-prem müşterilerde ölçek seçeneği yalnızca Linux/Docker ile mümkün.
7. **DuckDB community extension'ları** (ör. `mssql`) denetimsiz ve lisansları ayrı doğrulanmalı. Üretimde agent tarafı sürücü tercih edilmeli.

## Açık sorular

1. SaaS mı, on-prem mi, ikisi birden mi? On-prem Windows Server zorunluysa ClickHouse ve SeaweedFS sunucusu pratikte devre dışı kalır. Yığın DuckDB + yerel FS + Keycloak'a iner.
2. Hedef tenant sayısı ve tenant başına veri hacmi nedir? (Ör. 500 tenant × 5–50 GB.) Bu, DuckDB'den ClickHouse'a geçiş eşiğini ve Keycloak realm/organization kararını belirler.
3. Tenant'lar kendi IdP'lerini (Entra ID/AD FS) bağlayacak mı? Organizations'ın IdP-per-organization desteği yeterli mi, yoksa bazı tenant'lar ayrı realm mi isteyecek?
4. Fabric/OneLake ile birlikte çalışma (Delta) bir satış gereksinimi mi? Öyleyse delta-rs yeniden değerlendirilir.
5. Gold formatı: tenant başına `.duckdb` dosyası mı (hızlı, basit), yoksa Parquet/Iceberg mı (motor bağımsız)? Öneri: MVP'de Parquet + DuckDB görünümleri; sık sorgulanan aggregation'lar `.duckdb` önbelleğinde.
6. Agent ↔ Floem tüneli Python mu, Go mu olacak? Arrow IPC her iki dilde de destekleniyor (pyarrow / arrow-go); karar taşıma formatını etkilemez.
7. DuckDB "Quack" remote protokolü ve DuckLake, çok süreçli yazma ihtiyacını çözerek ClickHouse ihtiyacını erteleyebilir mi? v2.0 dokümanında geçiyor; olgunluğu bu çalışmada değerlendirilmedi.
8. Keycloak Organizations 26.8'de varsayılan olarak açık mı, yoksa feature flag mi gerekiyor? Kaynaklar çelişkili; kurulumda doğrulanmalı.

## Kaynaklar

- LICENSE dosyaları: `raw.githubusercontent.com/{duckdb/duckdb, ClickHouse/ClickHouse, apache/arrow (LICENSE.txt), apache/iceberg, apache/iceberg-python, delta-io/delta-rs (LICENSE.txt), seaweedfs/seaweedfs, rustfs/rustfs, apache/datafusion (LICENSE.txt), pola-rs/polars, keycloak/keycloak (LICENSE.txt), trinodb/trino, apache/calcite, duckdb/ducklake}`
- Sürümler: GitHub Releases sayfaları; PyPI (`deltalake`, `pyiceberg`); crates.io API (`datafusion`); trino.io release notes; calcite.apache.org history
- DuckDB eşzamanlılık: https://duckdb.org/docs/2.0/connect/concurrency.html
- DuckDB Iceberg/Delta: https://duckdb.org/docs/2.0/core_extensions/iceberg/overview.html, https://duckdb.org/docs/2.0/core_extensions/delta.html
- DuckDB mssql community extension: https://duckdb.org/community_extensions/extensions/mssql.html
- ClickHouse erişim kontrolü: https://clickhouse.com/docs/operations/access-rights ; kurulum: https://clickhouse.com/docs/install
- Arrow Flight: https://arrow.apache.org/docs/format/Flight.html
- SeaweedFS: https://github.com/seaweedfs/seaweedfs
- RustFS CVE'leri: https://app.opencve.io/cve/?vendor=rustfs , https://advisories.gitlab.com/pkg/cargo/rustfs/CVE-2025-68705/ , https://www.kodemsecurity.com/cve-archive/cve-2026-27607
- Keycloak realm ölçeği: https://skycloak.io/blog/keycloak-realm-scaling-how-many-realms-per-cluster/ , https://lists.jboss.org/pipermail/keycloak-user/2016-October/008050.html , https://forum.keycloak.org/t/maximum-limit-of-realms/8189 , https://phasetwo.io/blog/multi-tenancy-options-keycloak/
- Keycloak Organizations: https://www.keycloak.org/2024/10/keycloak-2600-released , https://www.keycloak.org/2026/04/org-groups
