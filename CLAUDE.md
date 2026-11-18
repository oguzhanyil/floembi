# Görev: Floem BI için açık kaynak BI projelerinin mimari analizi ve sentezi

## Bağlam
Ben Oğuzhan. SAP Business One ve SQL Server üzerinde çalışıyorum. Kendi ürünüm
Floemdata Analytics, Python tabanlı bir veri entegrasyon platformu:
- `agent/`: müşteri sunucusunda çalışan on-prem ajan (Floemway rolü)
- `warehouse/`: Bronze/Silver/Gold (medallion) katmanları
- Not (17.11.2026): `agent/` ve `warehouse/` henüz bu depoda yok. Bu araştırmada
  kod olarak yazılmayacak, hedef mimarileri tasarlanacak; MVP'de koda dökülecek.

Bunun üstüne **Floem BI** adında bir modül inşa ediyoruz. Amaç, Power BI ve
Microsoft Fabric'in temel yeteneklerini kendi sunucumda çalışan bağımsız,
modüler, ölçeklenebilir ve lisans bağımlılığı düşük bir platformda sunmak:
1. Kaynaklar: SQL Server, SAP B1, PostgreSQL, Excel, REST API
2. Floemway (Floemdata agent) üzerinden yerel sunuculardan veri aktarımı (Import + DirectQuery)
3. Grafik arayüzle semantik model: tablolar, ilişkiler (kardinalite, filtre yönü), hiyerarşiler, tarih tablosu
4. DAX benzeri ölçü dili (filtre bağlamı, CALCULATE, zaman zekâsı), bu dil SQL'e derlenecek
5. Sürükle-bırak rapor ve dashboard tasarımcısı (cross-filter, drill-down, slicer)
6. Çok kiracılık, RLS, zamanlanmış yenileme, embed

Referans alınan ticari ürünler: Power BI, Microsoft Fabric, Tableau, Qlik Sense,
Google Looker. Referans alınan açık kaynak ürünler: Metabase, Apache Superset ve
aşağıdaki listede yer alanlar.

## Kesin kurallar
- Floem BI ticari ve kapalı kaynak olacak. Sadece MIT, Apache 2.0, BSD, ISC ve
  0BSD lisanslı kod veya bağımlılık önerebilirsin (ISC ve 0BSD 18.11.2026'da
  eklendi; MIT ile aynı izinleri verirler). MIT-0 da MIT'in atıf şartsız hâlidir.
  PyInstaller (GPL + bootloader istisnası) yalnızca derleme aracı olarak onaylıdır.
- "Sadece UX referansı" grubundaki repolardan kod KOPYALAMA. Bunları yalnızca
  fikir ve UX referansı olarak incele ve raporda açıkça belirt.
- Her repoda lisansı LICENSE dosyasından tekrar doğrula. Aşağıdaki tablo
  17.11.2026 tarihli, değişmiş olabilir. Alt klasör lisanslarına (`ee/`,
  `enterprise/`) dikkat et.
- Repoları `research/repos/` altına `git clone --depth 1` ile klonla. Build alma,
  bağımlılık kurma, Docker çalıştırma; sadece kodu oku.
- "Altyapı" grubundaki büyük repoları (DuckDB, ClickHouse, Keycloak vb.)
  klonlama. Bunları resmi dokümantasyonları üzerinden değerlendir.
- `research/repos/` klasörünü `.gitignore`'a ekle. `research/notes/` versiyon
  kontrolünde kalsın.
- Araştırma süresince `agent/` ve `warehouse/` için kod yazma; yalnızca hedef
  mimariyi `research/notes/00-floemdata-hedef.md` içinde tasarla.
- Tüm çıktıları Türkçe yaz; kod, dosya ve teknik terimler orijinal kalsın.

## Açık kaynak proje listesi

### Grup 1: Derin analiz (önce bunlar)
| Repo | Lisans | Odak |
|---|---|---|
| https://github.com/rilldata/rill | Apache 2.0 | Metrics view, DuckDB entegrasyonu, dashboard state yönetimi (mimarisi Floem BI'a en yakın proje) |
| https://github.com/dbt-labs/metricflow | Apache 2.0 | Ölçü tanımı → join grafiği → SQL üretimi (DAX→SQL derleyicinin en yakın örneği) |
| https://github.com/apache/superset | Apache 2.0 | Bağlayıcı mimarisi, chart plugin sistemi, dashboard grid, RLS, embedded SDK |
| https://github.com/douglassimonsen/pbi_parsers | MIT | DAX ve M lexer/parser/formatter, AST yapısı |
| https://github.com/TabularEditor/TabularEditor | MIT | DAX grameri (ANTLR), TOM nesne modeli (Table, Column, Measure, Relationship, Role) |

### Grup 2: Orta derinlikte analiz
| Repo | Lisans | Odak |
|---|---|---|
| https://github.com/cube-js/cube | Apache 2.0 / MIT | Semantik model şeması, pre-aggregation, sorgu planlama, önbellek |
| https://github.com/lightdash/lightdash | MIT (`ee/` hariç) | Dimension/metric YAML yapısı, Explore UI |
| https://github.com/Hugoberry/pbixray | MIT | .pbix'ten model, ilişki ve ölçü okuma (Power BI'dan Floem BI'a geçiş aracı) |
| https://github.com/jurgenfolz/PyDAXLexer | MIT | Tabular Editor gramerinden üretilmiş ANTLR DAX lexer'ı |
| https://github.com/boringdata/boring-semantic-layer | MIT | Ibis üstünde hafif Python semantik katmanı |
| https://github.com/malloydata/malloy | MIT | Semantik modelleme dili tasarımı |
| https://github.com/Canner/wren-engine | Apache 2.0 | MDL semantik model formatı, AI ile sorgulama |
| https://github.com/evidence-dev/evidence | MIT | Kodla rapor tanımı (SQL + Markdown) |
| https://github.com/getredash/redash | BSD-2 | Basit query runner (bağlayıcı) mimarisi |
| https://github.com/gristlabs/grist-core | Apache 2.0 | Formüllü tablo, hesaplanmış sütun mantığı |

### Grup 3: Yüzeysel analiz (sadece ilgili bölüm)
| Repo | Lisans | Odak |
|---|---|---|
| https://github.com/tobymao/sqlglot | MIT | SQL lehçe çevirisi (T-SQL ↔ PostgreSQL ↔ DuckDB), AST üzerinden SQL üretimi |
| https://github.com/ibis-project/ibis | Apache 2.0 | Python API'den çoklu backend SQL üretimi |
| https://github.com/dlt-hub/dlt | Apache 2.0 | Artımlı yükleme, şema evrimi (Floemdata agent ile uyum) |
| https://github.com/dbt-labs/dbt-core | Apache 2.0 | Silver→Gold dönüşüm modellemesi |
| https://github.com/dagster-io/dagster | Apache 2.0 | Zamanlanmış yenileme, asset tabanlı orkestrasyon |
| https://github.com/fatedier/frp | Apache 2.0 | Floemway tünel mimarisi |
| https://github.com/jpillora/chisel | MIT | HTTP/WebSocket üzerinden tünel |
| https://github.com/xyflow/xyflow | MIT | Model görünümü: tablo kutuları ve ilişki okları (React Flow) |
| https://github.com/react-grid-layout/react-grid-layout | MIT | Dashboard tuvali (taşıma ve boyutlandırma) |
| https://github.com/gridstack/gridstack.js | MIT | Alternatif dashboard grid |
| https://github.com/clauderic/dnd-kit | MIT | Alanları grafik eksenlerine sürükle-bırak |
| https://github.com/puckeditor/puck | MIT | Görsel sayfa editörü çatısı |
| https://github.com/apache/echarts | Apache 2.0 | Ana grafik kütüphanesi |
| https://github.com/vega/vega-lite | BSD-3 | JSON grafik spesifikasyonu (rapor tanım formatı için model) |
| https://github.com/finos/perspective | Apache 2.0 | WASM pivot/matris görseli |
| https://github.com/TanStack/table | MIT | Tablo görseli |
| https://github.com/casbin/casbin | Apache 2.0 | RBAC/ABAC, RLS kural motoru |
| https://github.com/vanna-ai/vanna | MIT | Doğal dilden SQL (ileri aşama) |

### Grup 4: Altyapı (klonlama, dokümantasyondan değerlendir)
| Repo | Lisans | Rol |
|---|---|---|
| https://github.com/duckdb/duckdb | MIT | Import modu analitik motoru (VertiPaq yerine) |
| https://github.com/ClickHouse/ClickHouse | Apache 2.0 | Büyük ölçek ve çok kiracılı analitik motor |
| https://github.com/apache/arrow | Apache 2.0 | Bellek formatı, Arrow Flight ile Floemway veri taşıma |
| https://github.com/apache/iceberg | Apache 2.0 | Lakehouse tablo formatı |
| https://github.com/delta-io/delta-rs | Apache 2.0 | Delta Lake (Python/Rust) |
| https://github.com/seaweedfs/seaweedfs | Apache 2.0 | S3 uyumlu nesne depolama (olgun) |
| https://github.com/rustfs/rustfs | Apache 2.0 | S3 uyumlu nesne depolama (yeni, pilot) |
| https://github.com/apache/datafusion | Apache 2.0 | Rust sorgu motoru (ileride kendi motor için) |
| https://github.com/pola-rs/polars | MIT | Python dönüşümleri |
| https://github.com/keycloak/keycloak | Apache 2.0 | SSO, kiracı başına realm |
| https://github.com/trinodb/trino | Apache 2.0 | Federe sorgu (muhtemelen gereksiz) |
| https://github.com/apache/calcite | Apache 2.0 | Sorgu planlayıcı (muhtemelen gereksiz) |

### Grup 5: Sadece UX referansı (KOD KOPYALAMA YASAK)
| Repo | Lisans | Neden sadece referans |
|---|---|---|
| https://github.com/metabase/metabase | AGPL + ticari | Query builder UX'i iyi ama AGPL |
| https://github.com/grafana/grafana | AGPL | Panel editörü UX'i |
| https://github.com/Kanaries/graphic-walker | Apache 2.0 + marka lisansı | Tableau tarzı keşif UX'i; ek lisans logo zorunluluğu getiriyor |
| https://github.com/Canner/WrenAI | Karışık (bir kısmı AGPL) | Sadece Apache lisanslı `core/` incelenebilir |
| https://github.com/airbytehq/airbyte | Elastic License 2.0 | Açık kaynak değil, SaaS olarak sunulamaz |
| https://github.com/pbi-tools/pbi-tools | AGPL | PBIX/PBIP yapısı için referans |

Not: MinIO (https://github.com/minio/minio) bakım dışı ve AGPL lisanslı.
Değerlendirmeye alma, yerine SeaweedFS veya RustFS kullan.

## Adım 1: Floemdata hedef mimarisini tasarla
`agent/` ve `warehouse/` henüz yok. `research/notes/00-floemdata-hedef.md`
dosyasına şunları yaz: agent (Floemway) ve warehouse (medallion) için hedef
mimari, önerilen kütüphaneler, Floem BI'ın hangi noktalardan bağlanacağı,
açık sorular.

## Adım 2: Repoları analiz et
Grup 1'den başla. Mümkünse alt ajanlarla paralel çalış. Grup 1, 2 ve 3'teki
her repo için `research/notes/<repo-adi>.md` dosyasını şu şablonla yaz:

```
# <Repo>
- URL / Lisans (doğrulandı mı?) / Dil / Son commit tarihi
## Ne yapıyor (3-5 cümle)
## Mimari (ana klasörler ve sorumlulukları, veri akışı)
## Floem BI için kritik kısımlar
  - Dosya yolu → ne yapıyor → Floem BI'da neye karşılık gelir
## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
## Alınacak fikirler
## Kaçınılacaklar / zayıf yönler
## Kullanım kararı: [Bağımlılık olarak kullan / Fork et / Fikir al / Gereksiz]
```

Grup 4 ve 5 için tek bir özet dosya yeterli:
`research/notes/90-altyapi.md` ve `research/notes/91-ux-referanslari.md`.

## Adım 3: Sentez
`research/notes/99-floem-bi-sentez.md` dosyasında şunları üret:

1. **Karşılaştırma tablosu:** semantik model formatları (Rill metrics view,
   MetricFlow, Cube, LookML/Malloy, Tabular/TOM). Hangisi DAX'a ve Power BI
   kullanıcısının zihin modeline en yakın?
2. **Floem BI semantik model şeması:** tablo, sütun, ilişki, ölçü, hiyerarşi
   ve rol için JSON/YAML taslağı. SAP B1 örneğiyle göster
   (OINV/INV1 olgu tablosu; OCRD, OITM, OSLP ve Tarih boyutları).
3. **Floem DAX dili → SQL derleme tasarımı:** parser (pbi_parsers'ı fork mu
   edelim, sıfırdan mı yazalım?), AST, filtre bağlamı temsili, CALCULATE ve
   zaman zekâsının SQL karşılığı. Şu üç ölçünün DuckDB ve T-SQL için
   üretilecek SQL'ini örnekle:
   - `Toplam Satış = SUM(Satis[Tutar])`
   - `Geçen Yıl Satış = CALCULATE([Toplam Satış], SAMEPERIODLASTYEAR(Tarih[Tarih]))`
   - `Kategori Payı = DIVIDE([Toplam Satış], CALCULATE([Toplam Satış], ALL(Urun[Kategori])))`
4. **Floem BI mimarisi:** modül listesi ve her modülün sorumluluğu, servis
   sınırları, teknoloji seçimi ve gerekçesi. Floemdata'nın agent/ ve
   warehouse/ katmanlarıyla entegrasyonunu da göster. Mermaid diyagramı ekle.
5. **Bağımlılık listesi:** Floem BI'da kullanılacak her açık kaynak paket için
   ad, URL, lisans, versiyon ve kullanım amacı (sonradan NOTICE dosyası
   üretmek için).
6. **Riskler ve açık sorular:** benim karar vermem gereken noktaları
   numaralı liste olarak yaz.
7. **Taslak yol haritası:** MVP → v1 → v2 aşamaları, her aşamada teslim
   edilecek somut özellikler.

## Bitiş
Sentez tamamlandığında DUR, kod yazmaya başlama. Bana şunları özetle:
- En önemli 5 bulgu
- Floem BI için önerdiğin teknoloji yığını (tek satırda)
- Benim cevaplamam gereken açık sorular

Ben onay verdikten sonra Floem BI MVP'sinin implementasyonuna geçeceğiz.