# 91 — UX Referansları (Grup 5: Sadece UX referansı)

> **KOD KOPYALANMADI — bu projeler yalnızca UX referansıdır.**
> Repolar klonlanmadı. Bu notlar yalnızca resmi dokümantasyon, ürün sayfaları, GitHub README ve LICENSE dosyaları web üzerinden okunarak (17.11.2026) hazırlandı. Kod parçası alıntılanmadı; yalnızca ekran akışı, UX deseni ve fikir çıkarıldı. Floem BI ekipleri bu repoların kaynak koduna implementasyon sırasında bakmamalı (clean-room yaklaşımı); bu not tek referanstır.

İşaretler: ✅ = LICENSE dosyasından doğrulandı · ⚠️ = kısmen doğrulandı / kaynaklar çelişiyor · ❓ = doğrulanamadı (hafızadan veya ikincil kaynaktan)

## Özet tablo

| Ad | URL | Lisans (17.11.2026) | Doğrulandı | Floem BI ekranı | Alınacak ana fikir |
|---|---|---|---|---|---|
| Metabase | https://github.com/metabase/metabase | AGPL (kök) + Metabase Commercial License (`enterprise/`) | ✅ `LICENSE.txt` | Sorgu oluşturucu / "Soru" ekranı, Explore | Adım adım notebook editor (Data → Join → Custom column → Filter → Summarize/Group by → Sort → Limit), her adımda Preview, tek tuşla Visualize, çok aşamalı (multi-stage) sorgu |
| Grafana | https://github.com/grafana/grafana | AGPL-3.0-only (varsayılan) + bazı `packages/*` Apache-2.0 | ✅ `LICENSING.md` | Rapor tasarımcısında görsel (panel) düzenleme modu, rapor/dashboard parametreleri | Panel editörü düzeni: önizleme + alt veri bölümü (Queries/Transformations) + sağ Options pane; Table view toggle; değişkenlerin dashboard üstünde dropdown olması |
| Graphic Walker | https://github.com/Kanaries/graphic-walker | Apache-2.0 (`LICENSE`) + Kanaries logo lisansı (`LICENSE2`) | ✅ her iki dosya okundu | Explore (ad-hoc keşif), rapor tasarımcısında görsel alan kuyuları | Tableau tarzı shelf'ler: alan listesi (dimension/measure) → Rows/Columns/Color/Size/Shape/Opacity kanallarına sürükle-bırak |
| WrenAI | https://github.com/Canner/WrenAI | `main`: Apache-2.0 (`core/`, `sdk/`, `skills/`, `examples/`, kök) + CC BY 4.0 (`docs/`); AGPL-3.0 "gelecek modüller için rezerve". Eski GenBI uygulaması `legacy/v1` dalında AGPL-3.0 | ✅ `LICENSE` (main) ve `legacy/v1/LICENSE` | Semantik model editörü (MDL fikri), ileride "doğal dille sor" | Git-dostu metin tabanlı semantik model tanımı + model üstünden doğal dil → SQL, dry-plan doğrulaması |
| Airbyte | https://github.com/airbytehq/airbyte | Elastic License 2.0 (kök + resmi dokümana göre bağlayıcılar dahil); yalnız `airbyte-protocol` MIT | ⚠️ kök `LICENSE` = ELv2 doğrulandı; bağlayıcı lisansı kaynaklar arasında çelişkili | Veri kaynağı kataloğu, bağlantı kurulum sihirbazı, zamanlanmış yenileme ekranı | Kaynak kataloğu → kurulum formu + yan panelde doküman → Test and save → Draft durumu → stream seçimi → senkron modu → zamanlama → şema kayması politikası |
| pbi-tools | https://github.com/pbi-tools/pbi-tools | AGPL-3.0 | ✅ `LICENSE` (AGPL v3, 19 Kasım 2007 metni) | Power BI'dan geçiş sihirbazı (PBIX/PBIP içe aktarma) | PBIX'i kaynak kontrolüne uygun klasöre açma; model/rapor/mashup ayrımı; PBIP + TMDL hedef format |
| MinIO (değerlendirme dışı) | https://github.com/minio/minio | AGPL-3.0 | ❓ ikincil kaynaklar | — | **Değerlendirme dışı:** topluluk sürümü Aralık 2025'te bakım moduna alındı, 2026'da arşivlendi (salt okunur) ve AGPL-3.0 lisanslı; yerine SeaweedFS veya RustFS. |

---

## 1. Metabase

- **URL:** https://github.com/metabase/metabase
- **Lisans:** ✅ `LICENSE.txt`'den doğrulandı. Üst düzey `enterprise/` dizini dışındaki kod AGPL lisanslı (dosyada AGPL sürümü belirtilmiyor), `enterprise/` içi Metabase Commercial License. Binary'lerde de aynı ayrım geçerli: standart Docker image AGPL, enterprise image ticari.
- **Kaynaklar:** `LICENSE.txt`, https://www.metabase.com/docs/latest/questions/query-builder/editor, https://www.metabase.com/docs/latest/questions/query-builder/summarizing-and-grouping

### Neden kod alınamaz
AGPL, ağ üzerinden sunulan türev işin kaynak kodunun açılmasını gerektirir. Floem BI kapalı kaynak ve sunucu tarafında çalışan bir ürün olduğu için AGPL kod, kapalı kaynak modelle bağdaşmaz. `enterprise/` ise zaten ticari lisanslı.

### Alınacak UX fikirleri
1. **Notebook editor (adım adım sorgu):** Sorgu dikey bir adım listesi olarak kuruluyor:
   1. *Pick data*: tablo, model, metrik veya kayıtlı soru seçilir. Sütunların işareti kaldırılarak sonuçtan çıkarılabilir ama sonraki adımlarda kullanılmaya devam edilir.
   2. *Join*: aynı veritabanındaki tablolar birleştirilir.
   3. *Custom column*: yalnızca bu soruya ait, tablo formülü tarzında hesaplanmış sütun.
   4. *Filter*
   5. *Summarize + Group by*: metrikler (Count, Sum, Avg, Distinct) ve kırılım sütunları seçilir. Admin'in tanımladığı Metric/Measure da seçilebilir.
   6. *Sort*
   7. *Limit*: her zaman en sonda yer alır.
2. **Adım başına Preview:** her adımın yanında bir ▶ butonu var ve o adıma kadarki ilk 10 satırı gösteriyor. Kullanıcı ara sonucu görerek ilerliyor.
3. **Multi-stage:** bir Summarize'dan sonra yeniden Filter/Join/Summarize eklenebiliyor (ör. "aylık sipariş sayısı → bunun ortalaması"). Bu, DAX'taki iç içe ölçüleri (AVERAGEX(VALUES(Ay), [Sipariş Sayısı])) görsel olarak ifade etmenin bir yolu.
4. **Zaman ve sayı gruplama:** tarih alanları varsayılan olarak ay bazında gruplanıyor, kullanıcı day/week/quarter/year arasında geçiş yapabiliyor. Aynı tarih farklı granülaritelerle iki kez kullanılabiliyor (hafta + haftanın günü). Sayısal sütunlar otomatik bin'leniyor.
5. **Visualize → otomatik grafik seçimi:** grafik türü gruplama alanının tipine göre seçiliyor (tarih → çizgi). Kullanıcı sonradan değiştirebiliyor.
6. **View SQL:** üretilen native sorgu gösteriliyor (yetkiye bağlı). Floem BI'da "Ölçü → üretilen SQL" şeffaflığı için birebir uygun bir fikir.
7. **Summarize sidebar:** sonuç ekranında yan panelde aynı grup/özet kontrolleri var: grup değiştirmek için tıkla, eklemek için "+", kaldırmak için "X".
8. **Drill-through:** grafikte bir noktaya tıklayıp detaya inme ve bunu yeni soru olarak kaydetme (yalnızca editor sayfasında anılıyor, ayrıntısı doğrulanmadı).

### Floem BI karşılığı
- Explore / "Hızlı Soru" ekranı: semantik model üzerinden kod yazmadan sorgu kurma.
- Rapor tasarımcısında "veri adımı" paneli (görselin arkasındaki sorguyu adım adım gösterme).
- Ölçü editörü yanında "Üretilen SQL'i göster" sekmesi.

### Kaçınılacaklar
- Metabase'in "question" ile "model" ve "metric" kavramlarının çoğalması Power BI kullanıcısı için kafa karıştırıcı olabilir. Floem BI'da tek kaynak semantik model olmalı, notebook yalnızca onun üstünde çalışmalı.
- Ham tablo üstünde join'i kullanıcıya bırakmak, Power BI zihin modelindeki "ilişkiler modelde tanımlanır" yaklaşımıyla çelişir. Join adımı yalnızca ileri kullanıcı modunda sunulmalı.
- Metabase'in otomatik grafik seçimi algoritmasının ayrıntıları doğrulanmadı; kendi kural setimizi yazmalıyız.

---

## 2. Grafana

- **URL:** https://github.com/grafana/grafana
- **Lisans:** ✅ `LICENSING.md`'den doğrulandı. Varsayılan lisans **AGPL-3.0-only**. Apache-2.0 istisnaları: `packages/grafana-data/`, `packages/grafana-e2e-selectors/`, `packages/grafana-runtime/`, `packages/grafana-ui/`, `packaging/`, `kinds/`, `pkg/kinds/`, `pkg/kindsys/`, `pkg/registry/schemas/`, `grafana-mixin/`, bazı ikon klasörleri ve TraceView bileşenleri. `public/vendor/` upstream lisansını koruyor.
- **Kaynaklar:** `LICENSING.md`, https://grafana.com/docs/grafana/latest/panels-visualizations/panel-editor-overview/, https://grafana.com/docs/grafana/latest/dashboards/variables/

### Neden kod alınamaz
Uygulamanın kendisi (panel editörü, dashboard) AGPL-3.0-only lisanslı. Apache-2.0 istisnaları (`grafana-ui` vb.) teknik olarak izinli olsa bile Grafana'nın veri modeline sıkı bağlı ve görev tanımı gereği bu grup "yalnızca UX referansı". Bu yüzden bu paketler de bağımlılık olarak önerilmiyor.

### Alınacak UX fikirleri
1. **Panel editörü düzeni (dört alan; pratikte üç ana bölme + başlık):**
   - *Header:* hangi dashboard'a ait olduğu + **Back** (değişiklikler korunarak dashboard'a dön), **Discard**, **Save**.
   - *Visualization preview* (sol üst, geniş alan): canlı görsel, panel bazında zaman aralığı, Refresh, **Table view** toggle (herhangi bir görseli ham tabloya çevirip veriyi kontrol etme).
   - *Data section* (sol alt): **Queries** / **Transformations** / **Alert** sekmeleri.
   - *Options pane* (sağ): görsel türü seçimi (ilk açılışta veri şekline göre öneriler), panel ayarları, field override'lar.
2. **Panel styles:** canlı önizleme kartı olarak sunulan hazır stil kombinasyonları. Uygulandığında yalnızca kendi tanımladığı alanları değiştiriyor, override'lara dokunmuyor.
3. **Copy / Paste styles:** aynı türdeki görseller arasında biçim kopyalama (sorgu ve override'lar hariç). Power BI'daki "Format Painter"ın karşılığı.
4. **Değişkenler (template variables):** Query, Custom, Text box, Constant, Data source, Interval, Filters (dashboard genelinde ad-hoc key/value) ve Switch türleri. Dashboard'un tepesinde dropdown veya metin alanı olarak görünüyorlar. Bir değişken değişince iç içe değişkenin seçenekleri de değişiyor (chained). **Repeat panels:** değişkenin her değeri için panel çoğaltılıyor.
5. **Field overrides** (genel kural + alan bazında istisna): ayrıntısı bu oturumda doğrulanmadı ❓. Fikir olarak koşullu biçimlendirme için uygun.

### Floem BI karşılığı
- Rapor tasarımcısı → "Görseli düzenle" (odak modu): ortada önizleme, altta veri alanları/ölçüler ve sorgu/dönüşüm adımları, sağda Format paneli. Power BI'daki "Visualizations / Format / Analytics" bölmesinin daha geniş, odaklı bir versiyonu.
- Table view toggle → Power BI'daki "Show as table" / "Görsel tablosunu göster".
- Değişkenler → rapor parametreleri / What-if parametreleri / sayfa filtreleri. "Filters" türü → rapor düzeyi ad-hoc filtre çubuğu.
- Repeat panels → Power BI'daki "small multiples" karşılığına ek olarak "her bölge için bir kart" senaryosu.

### Kaçınılacaklar
- Grafana'nın zaman serisi merkezli tasarımı (her panelde zaman aralığı) BI raporları için fazla. Floem BI'da zaman aralığı rapor/sayfa düzeyinde olmalı, panel düzeyi isteğe bağlı kalmalı.
- Değişkenlerin ham sorgu metnine string interpolation ile eklenmesi (`$var`) SQL enjeksiyonu ve RLS açısından riskli. Floem BI'da parametreler semantik katmanda tiplenmiş filtre olarak derlenmeli.
- Saved queries'in yalnızca Enterprise/Cloud'da olması gibi parçalı özellik dağılımı UX'i bölüyor.

---

## 3. Graphic Walker (Kanaries)

- **URL:** https://github.com/Kanaries/graphic-walker
- **Lisans:** ✅ İki dosya okundu.
  - `LICENSE`: değiştirilmemiş standart **Apache License 2.0**.
  - `LICENSE2`: Kanaries logo dosyaları için ek lisans. README'de "logo dosyaları için LICENSE ve LICENSE2'ye bakın" yazıyor. `LICENSE2`'nin içeriği: kapsam "Graphic-Walker yazılım ürünü" olarak tanımlanmış, dosya listesi verilmemiş. "Kanaries" logosu **bozulmadan ve değiştirilmeden korunmalı**, marka ve atıf kullanıcı arayüzünde ve pazarlama materyallerinde **belirgin şekilde** gösterilmeli. Markayı kaldırmak, değiştirmek veya gizlemek yasak. Markayı değiştirmek için ayrı bir **White Label License** gerekiyor. İhlal halinde haklar otomatik olarak sona eriyor. Metin kendini "sample license, not legal advice" olarak niteliyor.
- **Kaynaklar:** README, `LICENSE`, `LICENSE2`, https://docs.kanaries.net/graphic-walker

### Neden kod alınamaz
Apache-2.0 tek başına izin verici bir lisans. Ancak `LICENSE2`'nin kapsamı "Graphic-Walker yazılım ürünü" olarak geniş yazılmış ve ürünü gömenlerin arayüzde Kanaries markasını belirgin şekilde göstermesini istiyor. Kapalı kaynak ve kendi markasıyla satılacak bir üründe bu kabul edilemez. Ayrıca iki lisansın kapsam sınırı belirsiz, bu da hukuki risk demek. Bu yüzden bağımlılık olarak da kullanılmamalı; yalnızca UX referansı olarak kalmalı.

### Alınacak UX fikirleri
1. **Alan listesi + shelf'ler:** solda alanlar `dimension` / `measure` olarak ayrılıyor, ayrıca semantik tipleri var (`temporal`, `nominal`, `quantitative`). Alanlar **Rows / Columns / Color / Size / Shape / Opacity** kanallarına (README'de ayrıca Details ve Filters) sürükleniyor. Bu, Tableau'nun shelf modelinin aynısı.
2. **İç içe boyutlar:** Rows/Columns'a birden fazla dimension bırakılınca facet/small-multiples benzeri iç içe görünüm oluşuyor.
3. **Data tab ↔ Visualization tab:** aynı ekranda ham satırlara bakma ile grafik kurma arasında geçiş.
4. **Auto Viz:** seçilen alanlara göre grafik önerisi.
5. **Explain Data / Interpret Data:** grafikte bir noktaya tıklayıp "bu değer neden böyle?" sorusuna otomatik kırılım önerisi alma. Power BI'daki "Analyze → Explain the increase" ile aynı fikir.
6. **Hesaplamanın yeri seçilebilir:** varsayılan olarak tarayıcıda WebWorker'da, büyük veride sunucuda. Floem BI için de "küçük veri/Import → istemci önbelleği, büyük veri → sunucu" kararında esin olabilir.
7. **Grafik spesifikasyonunun dosya olarak kaydedilip yeniden yüklenmesi**, PNG/SVG dışa aktarımı ve spec'ten SQL üretimi (gw-dsl-parser). Bu fikir Floem BI'da "görsel tanımı JSON → semantik sorgu" katmanına karşılık geliyor.

### Floem BI karşılığı
- **Explore ekranı** (Power BI'da "Explore this data" / Fabric "Explore"): alan listesi + shelf'ler + Data/Vis sekmeleri.
- **Rapor tasarımcısı → görsel alan kuyuları (field wells):** Power BI'daki "Axis / Values / Legend / Tooltips" kuyularının, Tableau tarzı daha genel kanal modeliyle (Color, Size, Shape) zenginleştirilmesi.
- Explain Data → ileride "Akıllı analiz" (decomposition tree / key influencers benzeri).

### Kaçınılacaklar
- Graphic Walker'ı npm bağımlılığı olarak gömmek (marka zorunluluğu).
- Vega-Lite grameri doğrudan kullanıcıya açmak; Power BI kullanıcısı "kanal / encoding" terimlerine alışık değil. Floem BI arayüzünde Power BI terminolojisi (Eksen, Değerler, Gösterge, Araç ipucu) korunmalı; Tableau kanalları "gelişmiş" olarak sunulmalı.
- Ham CSV üzerinden keşif: Floem BI'da Explore her zaman semantik model ve ölçüler üzerinden yapılmalı. Kullanıcı ham sütunu toplamak yerine ölçüyü sürüklemeli.

---

## 4. WrenAI (Canner)

- **URL:** https://github.com/Canner/WrenAI
- **Lisans:** ✅ `main` dalındaki `LICENSE` yol bazlı eşleme veriyor:

  | Yol | Lisans |
  |---|---|
  | `core/**` | Apache-2.0 |
  | `sdk/**` | Apache-2.0 |
  | `skills/**` | Apache-2.0 |
  | `examples/**` | Apache-2.0 |
  | `docs/**` | CC BY 4.0 |
  | Diğer (kök dosyalar) | Apache-2.0 |

  Şu anda **hiçbir dizin AGPL-3.0'a eşlenmemiş.** `LICENSE-AGPL-3.0` dosyası "ileride AGPL-3.0-only modüller eklenebilir" diye önceden konmuş. Yayınlanan paketlerin manifest'i (Cargo.toml, pyproject.toml, package.json) çelişki durumunda o paket için geçerli sayılıyor.
  - `CHANGELOG.md` (2026-Q2): `Canner/wren-engine` `core/` içine taşınmış (yaklaşık 5.300 commit, `git filter-repo` ile). Eski **GenBI uygulaması** (`wren-ui`, `wren-ai-service`, `wren-launcher`, `docker`, `deployment`) **`legacy/v1` dalına arşivlenmiş** (tag `v1-final`).
  - ✅ `legacy/v1` dalındaki `LICENSE` **AGPL-3.0** (Copyright 2024 Canner, Inc.). Yani bilinen "AGPL kısım" (modelleme arayüzü ve GenBI UI) artık `main`'de değil, legacy dalda.
  - README: GenBI UI ve dashboard'lar artık ticari teklifin parçası, açık kaynak motorun değil.
- **Kaynaklar:** README, `LICENSE` (main), `legacy/v1/LICENSE`, `CHANGELOG.md`

### Neden kod alınamaz
- Görev tanımı bu repoyu "yalnızca UX referansı" grubuna koyuyor. UX değeri taşıyan kısım (modelleme UI'ı, GenBI sohbet ekranı) `legacy/v1` dalında ve **AGPL-3.0**, dolayısıyla kopyalanamaz.
- `main` dalındaki `core/` artık Apache-2.0 ve teknik olarak kullanılabilir. Ancak bu, Grup 2'deki `Canner/wren-engine` ile aynı kod tabanı ve orada ayrıca değerlendirildi (`research/notes/wren-engine.md`). Bu notta yalnızca UX fikri alınıyor.
- Risk: `LICENSE-AGPL-3.0` "gelecek modüller için rezerve" edilmiş. Bağımlılık olarak `core/` kullanılırsa her sürüm yükseltmesinde yol eşlemesi ve paket manifest'i yeniden kontrol edilmeli.

### Alınacak UX fikirleri
1. **Git-dostu, metin tabanlı semantik model (MDL):** model, sütun, ilişki, view, cube ve metric tanımları dosya halinde tutuluyor. Floem BI'da grafik model editörünün arkasında diff alınabilir bir model dosyası olması (PBIP/TMDL'e benzer) hem geçiş hem sürümleme için değerli.
2. **Bağlam dosyaları:** `instructions.md` (iş kuralları/talimatlar) ve `queries.yml` (örnek soru → SQL çiftleri). İleride "doğal dille sor" için modele "açıklama ve örnek sorular" sekmesi eklemek.
3. **Soru → SQL akışında güvenlik rayları:** dry-plan ile doğrulama, satır limiti ve yapılandırılmış hata mesajları. Kullanıcıya "sorgu çalıştırılmadan önce planlandı ve doğrulandı" geri bildirimi verilmesi.
4. (legacy UI, ❓ doğrulanmadı, hafızadan) Modelleme ekranında tablo kutuları ve ilişki çizgileri; ilişki eklerken kardinalite seçimi. Bu fikir zaten xyflow notunda ele alındı.

### Floem BI karşılığı
- Semantik model editörü → "Model dosyası / kaynak görünümü" sekmesi ve Git entegrasyonu.
- İleri aşama "Soru sor" (Q&A) ekranı: model açıklamaları, eş anlamlılar, örnek sorular.

### Kaçınılacaklar
- `legacy/v1` dalını açıp UI koduna bakmak (AGPL; clean-room ihlali riski).
- Dashboard'ları AI ajanlarının üretip Vercel/Cloudflare'e deploy etmesi gibi akışlar on-prem odaklı Floem BI için uygun değil.

---

## 5. Airbyte

- **URL:** https://github.com/airbytehq/airbyte
- **Lisans:** ⚠️
  - ✅ Kök `LICENSE` = **Elastic License 2.0**. Barındırılan/yönetilen hizmet olarak "yazılımın önemli bir özellik setini" üçüncü taraflara sunmak yasak. Lisans anahtarı mekanizmasını atlatmak yasak. Lisans bildirimlerini kaldırmak yasak.
  - Resmi doküman (https://docs.airbyte.com/community/licenses/): "Airbyte Connectors and everything in our public repos" ELv2. Yalnızca `airbyte-protocol` MIT. Her bağlayıcının lisansı kendi `metadata.yaml` dosyasında yazıyor.
  - **Çelişki:** airbyte.com/license-faq ve eski kaynaklar bağlayıcıların ve CDK'nın MIT olduğunu söylüyor. README rozetlerinde hem MIT hem ELv2 var. Güncel resmi doküman ELv2 diyor. CDK'nın lisansı bu oturumda doğrulanmadı ❓.
- **Kaynaklar:** `LICENSE`, README, https://docs.airbyte.com/community/licenses/, https://docs.airbyte.com/platform/using-airbyte/getting-started/set-up-a-connection, https://docs.airbyte.com/platform/using-airbyte/getting-started/add-a-source

### Neden kod alınamaz
ELv2, OSI onaylı bir açık kaynak lisansı değil. Floem BI'ın çok kiracılı SaaS/hosted sunumu, Airbyte'ın bağlantı yönetimi işlevlerini sunuyorsa "managed service" kısıtına takılabilir. Ayrıca CLAUDE.md yalnızca MIT/Apache/BSD'ye izin veriyor. Bağlayıcı lisansları bağlayıcı bazında değişiyor ve kaynaklar çelişkili; bu da ek risk.

### Alınacak UX fikirleri
1. **Kaynak kataloğu:** "Sources → New Source" ile açılan, aranabilir bağlayıcı kataloğu ve ayrı bir **Marketplace** sekmesi (topluluk bağlayıcıları). Deneme için **Sample Data** kaynağı.
2. **Kurulum formu + yan panelde dokümantasyon:** bağlayıcı formu solda, ilgili kurulum dokümanı sağda. SAP B1 / SQL Server kurulumunda (port, servis hesabı, Gateway seçimi) çok değerli.
3. **Draft durumu:** form yarım bırakılınca kaynak "Draft" olarak kaydediliyor ve test geçene kadar bağlantıda kullanılamıyor.
4. **Test and save:** kaydetme sırasında bağlantı testi; başarılı olunca Draft kalkıyor.
5. **AI kurulum asistanı (Cloud):** sohbetle konfigürasyon toplama; **secret mode** ile parolalar ajana gönderilmiyor; OAuth için popup. Kullanıcı form ve sohbet modu arasında istediği an geçebiliyor. Test başarısız olursa asistan nedenini açıklayıp çözüm öneriyor.
6. **Bağlantı (connection) sihirbazı:** kaynak → hedef (mevcut seç veya yeni oluştur) → **stream seçimi** (stream bazında ayrı ayar) → **sync mode** (okuma/yazma davranışı: tam/artımlı) → **zamanlama** (otomatik veya manuel tetikleme) → **şema kayması (schema drift) politikası**.
7. Kaynak bağlayıcıların birden fazla bağlantıda yeniden kullanılabilmesi.

### Floem BI karşılığı
- "Veri al" (Get Data) kataloğu: SQL Server, SAP B1, PostgreSQL, Excel, REST API kartları.
- Kaynak kurulum sihirbazı: Gateway (Floemdata agent) seçimi + bağlantı testi + Draft durumu.
- Tablo seçimi = stream seçimi; Import/DirectQuery seçimi = sync mode benzeri adım; artımlı yenileme (incremental refresh) ayarı.
- Zamanlanmış yenileme ekranı ve şema değişikliği politikası (Power BI'da eksik olan, değerli bir fark).

### Kaçınılacaklar
- Airbyte bağlayıcılarını (Docker image'ları veya kodu) gömmek ya da yeniden dağıtmak: lisans bağlayıcı bazında değişiyor ve hosted kısıtı var.
- Her kaynak için ayrı container çalıştırma modeli on-prem Gateway için ağır.
- Sohbet asistanını tek kurulum yolu yapmak; form her zaman birincil yol kalmalı.

---

## 6. pbi-tools

- **URL:** https://github.com/pbi-tools/pbi-tools (CLI dokümanı: https://pbi.tools/cli/)
- **Lisans:** ✅ `LICENSE` = **GNU AGPL v3** (19 Kasım 2007 metni). Ek bir ticari lisans veya ek şart görünmüyor.
- **Bakım durumu:** ❓ Repo sayfasında 714 commit, 168 açık issue görünüyor. Son commit tarihi ve son sürüm sayfadan okunamadı. Dokümanda en yeni anılan sürüm `1.0.0-beta.8`; site 18.02.2026'da üretilmiş (bu bir sürüm tarihi değil).
- **Kaynaklar:** README, `LICENSE`, https://pbi.tools/cli/, PBIP için Microsoft Learn: https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview

### Neden kod alınamaz
AGPL-3.0. Geçiş aracı Floem BI sunucusunda çalışacaksa ağ üzerinden etkileşim maddesi devreye girer. Ayrıca .NET ve Power BI Desktop bileşenlerine bağımlı. PBIX okuma için MIT lisanslı `pbixray` (Grup 2) ve TOM/TMDL için Tabular Editor (MIT) zaten değerlendirildi. pbi-tools yalnızca "PBIX'in hangi parçalara ayrıştırılacağı" konusunda referans.

### Alınacak UX / akış fikirleri
1. **Komut ayrımı (geçiş sihirbazının adımlarına model):** `extract` (PBIX/PBIT → kaynak kontrolüne uygun klasör), `compile` (kaynaktan PBIX/PBIT üretme), `deploy` (manifest ile dağıtım), `convert` (PbixProj ↔ Tabular format), `generate-bim`, `export-data` (tabloları CSV'ye aktarma), `info` (yerel ortam teşhisi).
2. **Model serileştirme modu seçeneği** (`-modelSerialization Raw` ve TMDL): aynı modelin farklı ayrıntı düzeyinde dışa aktarılması.
3. **Hedef format PBIP (Microsoft, doğrulandı):** proje kökünde `<ad>.Report/` (`definition.pbir`), `<ad>.SemanticModel/` (`definition.pbism`, `definition/` altında TMDL), `.gitignore` (`.pbi/localSettings.json` ve `.pbi/cache.abf` dışlanır) ve isteğe bağlı `<ad>.pbip` bulunuyor. Microsoft şunların şemasının belgelenmediğini ve dışarıdan düzenlenmesinin desteklenmediğini söylüyor: `report.json`, `mobileState.json`, `semanticModelDiagramLayout.json`, `diagramLayout.json`.
4. ❓ (hafızadan, doğrulanmadı) PbixProj klasörü kabaca `Model/` (tablolar, sütunlar, ölçüler ayrı dosyalarda, ölçü ifadeleri `.dax`), `Report/` (sayfa/section ve görsel container klasörleri), `Mashup/` (Power Query M), `StaticResources/` ve kök meta dosyalarından oluşuyor. Kesin ağaç için pbi-tools dokümanındaki örnek projeye bakılmalı; burada doğrulanmadı.

### Floem BI karşılığı
- **Power BI'dan geçiş sihirbazı:**
  1. Dosya yükle (PBIX veya PBIP klasörü/zip).
  2. Analiz raporu: tablolar, ilişkiler, ölçüler, M sorguları, sayfalar/görseller. Her öğe için "otomatik dönüştürülebilir / manuel gerekli / desteklenmiyor" etiketi.
  3. Kaynak eşleme: M sorgusundaki SQL Server/SAP B1 bağlantılarını Floem Gateway kaynaklarına eşleme.
  4. Ölçü dönüşümü: DAX → Floem DAX uyumluluk raporu.
  5. Rapor sayfası dönüşümü (görsel tipi eşleme).
  6. Önizleme ve içe aktar.
- **Tercih:** öncelikle PBIP/TMDL (belgelenmiş, metin tabanlı) desteklenmeli; PBIX desteği `pbixray` (MIT) ile sağlanmalı.

### Kaçınılacaklar
- pbi-tools'u sunucuda alt süreç olarak çalıştırmak veya dağıtmak (AGPL).
- Belgelenmemiş `report.json` / `diagramLayout.json` şemasına sıkı bağımlılık; bu dosyalar sürümden sürüme değişebilir. Dönüştürücü toleranslı olmalı ve eksik kısımları raporlamalı.
- Geçiş aracını Power BI Desktop kurulumuna bağımlı yapmak.

---

## MinIO (değerlendirme dışı)

MinIO değerlendirme dışı: topluluk reposu Aralık 2025'te bakım moduna alındı, 2026'da arşivlendi (salt okunur; tarih kaynaklara göre Şubat veya Nisan 2026, ❓ GitHub'dan doğrulanmadı) ve Mayıs 2021'den beri AGPL-3.0 lisanslı. Yerine SeaweedFS veya RustFS (Apache-2.0) kullanılacak.

---

## Floem BI ekranlarına UX eşleme tablosu

| Floem BI ekranı | Birincil referans | İkincil referans | Alınacak somut desen | Kaçınılacak |
|---|---|---|---|---|
| Veri kaynağı kataloğu ("Veri al") | Airbyte | — | Aranabilir kart kataloğu, Sample Data, topluluk/marketplace ayrımı | Bağlayıcı kodu/imajı gömmek |
| Kaynak kurulum sihirbazı (Gateway) | Airbyte | — | Form + yan panel doküman, Draft durumu, Test and save, secret alanlar, hatada açıklayıcı öneri | Tek yol olarak AI sohbet |
| Tablo seçimi ve yenileme ayarları | Airbyte | — | Stream (tablo) bazında seçim, Import/DirectQuery ≈ sync mode, artımlı yenileme, zamanlama, şema kayması politikası | Kaynak başına container |
| Semantik model editörü (diyagram + kaynak görünümü) | WrenAI (MDL fikri) | pbi-tools/PBIP (TMDL klasör yapısı) | Grafik editörün arkasında Git-dostu metin model dosyası; açıklama/örnek soru alanları | legacy/v1 AGPL UI'ına bakmak |
| Ölçü editörü | Metabase (View SQL) | WrenAI (dry-plan) | "Üretilen SQL'i göster", çalıştırmadan doğrula, yapılandırılmış hata | Ham SQL interpolasyonu |
| Explore / Hızlı soru | Metabase (notebook) | Graphic Walker (shelf'ler) | Adım listesi + adım başına Preview; Visualize ile otomatik grafik; multi-stage; tarih granülaritesi değiştirme | Ham tablo üstünde keşif, model dışı join |
| Rapor tasarımcısı – görsel alan kuyuları | Graphic Walker | Power BI (terminoloji) | Dimension/measure ayrımlı alan listesi; Rows/Columns/Color/Size/Shape kanalları; iç içe boyut → small multiples | Vega-Lite terimlerini kullanıcıya açmak |
| Rapor tasarımcısı – görsel odak/düzenleme modu | Grafana (panel editörü) | — | Önizleme + alt veri bölümü (sorgu/dönüşüm) + sağ format paneli; Back/Discard/Save; Table view toggle; stil kartları; biçim kopyala/yapıştır | Panel başına zaman aralığı zorunluluğu |
| Rapor parametreleri / slicer çubuğu | Grafana (değişkenler) | — | Üstte dropdown parametreler, zincirleme parametre, ad-hoc filtre çubuğu, değere göre tekrar eden görsel | `$var` metin interpolasyonu |
| Akıllı analiz ("Bu neden yükseldi?") | Graphic Walker (Explain Data) | — | Grafikte nokta seç → otomatik kırılım önerisi | — (ileri aşama) |
| Doğal dille sor (ileri aşama) | WrenAI | — | Model talimatları + örnek soru-SQL çiftleri, dry-plan, satır limiti | Ajanın dashboard'u dış servise deploy etmesi |
| Power BI geçiş sihirbazı | pbi-tools | PBIP (Microsoft Learn) | extract → analiz raporu → kaynak eşleme → DAX uyumluluk → sayfa dönüşümü → içe aktar | pbi-tools'u çalıştırmak/dağıtmak; belgelenmemiş JSON'a sıkı bağlılık |

## Doğrulanamayanlar (özet)
- Metabase AGPL sürümü (`LICENSE.txt`'de belirtilmiyor); drill-through ayrıntıları.
- Grafana field override editörünün ayrıntılı UI'ı; multi-value / "Include All" değişken seçenekleri.
- Graphic Walker'da Details/Filters kanallarının güncel UI'da yeri (README'de var, doküman sayfasında yok); `LICENSE2`'nin hangi dosyalara uygulandığı (dosya listesi yok).
- Airbyte bağlayıcı ve CDK lisansı (resmi doküman ELv2, FAQ MIT diyor; çelişkili).
- pbi-tools son commit/sürüm tarihi ve PbixProj klasör ağacının tam hali.
- MinIO'nun kesin arşivlenme tarihi.
