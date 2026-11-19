# F01–F04 uygulaması ve marka belgesiyle güncellenen sıra

19.11.2026. Kullanıcının kapsamı: F01–F04'ü sırayla uygulamak; ek marka/UI belgesini ileri nesne tasarımı ve tema planına katmak.

## Uygulananlar

| İş | Sonuç | Doğrulama |
|---|---|---|
| F01 | Metinde satıra bölme, tek satır/üç nokta, içeriğe göre yükseklik ve isteğe bağlı kaydırma. Kesilen metni klavye/dokunmayla açan tam metin penceresi. PBIP'in 20 px alt sınırı kaldırıldı, font ailesi/satır aralığı desteklendi. Demo başlıkları yükseltildi. | Küçük kaynak fontu regresyonu; Chromium'da başlık taşmaması, büyüyen metin ve tam metin penceresi. |
| F02 | Açık sipariş tutarı yalnız açık başlık/satırın kalan miktarından. Fatura, sipariş ve açık sipariş miktarları ayrı; birim ve kayıt anahtarları taşınıyor. Aynı adlı müşteriler kodla ayrılıyor. Yürüyen bakiye ve farklı birimlerin genel toplamı kapalı. Müşteri alacağı/tedarikçi borcu ayrı. | Kısmi/kapalı/iptal sipariş, iade, aynı adlı muhatap ve aynı belge numarası için sentetik karşı örnekler; yerel SQL Server kaynağından yeniden üretim. |
| F03 | Her görsel için hata sınırı ve yeniden deneme; sorgu hatasında yeniden deneme; sıfır, boş sonuç, eksik alan ve yükleme ayrımı. Eski sonuç gösterilirken güncelleniyor işareti. | Chromium StrictMode altında bilerek bozulan görsel, sağlam komşu kart, hata sonrası toparlanma ve sorgu yeniden denemesi. |
| F04 | Ortak Desktop/web tuvalinde sayfaya/genişliğe sığdırma, %100, +/− ve odak tuvaldeyken Ctrl+/−/0. Büyük sayfada kaydırma. Sağ panel dış kenarından toplam genişlik, ara kenarından bölme genişliği; klavye okları da çalışır. Dar alanda paneller çekmece olur. Dar üst şerit kaydırılabilir. | 6 viewport/DPR bileşimi, panel boyutu/çekmece, %100 ve genişliğe sığdırma, gerçek pointer olaylarıyla rapor koordinatında taşıma. |

Zoom ve panel genişlikleri görünüm ayarıdır; raporun kayıtlı nesne koordinatlarını değiştirmez. **F05 güncellemesi:** otomatik yüksekliği seçilen metin akış kapsayıcısında büyürken komşularını iter; serbest sayfa nesneleri kendi konumunu korur. [Kullanım ve testler](f05-grup-kapsayici-ve-yerlesim.md).

### Demo dosyaları

- `data/SAPB1Demo-Floem-F01-F04.floem`: 8 sayfa, 150 nesne; 7 tablo, 83.218 satır. Yeni çalışma örneği; önceki dosyalar korunur.
- `data/SAPB1Demo-Taslak-F01-F04.floem`: güncel font aktarımıyla yeniden üretilen **boş verili** Power BI taslağı. Çalışan veri demosuyla karıştırılmamalı.
- Dosyalar yereldir ve git dışındadır; dış sunucuda rapor yayını bu turda değiştirilmedi.

Satınalma iade tabloları yerel kaynakta yok. Bu nedenle fatura satır tutarı açıkça bu kapsamla gösteriliyor; net satınalma eşdeğerliği iddia edilmiyor. Satır tutarları belge düzeyi indirim/vergi toplamı değildir. Açık siparişin kalan miktarı var fakat başlangıç miktarı sıfırsa belirsiz tutar sessizce sıfırlanmaz; üretim kaydetmeden açıklayıcı hatayla durur. Yürüyen bakiye kaynak geçmişini esas alır, tarih filtresiyle yeniden başlamaz. Ortak boyut/ilişkiler, seçili tarih açılış–kapanış ölçüleri ve 135 ölçünün tam geçişi F06'dır.

### Kontroller

- `python -m pytest tests/test_pbip_import.py tests/test_demo_port.py tests/test_report.py -q`: **20 geçti**.
- `node tests/ui/run-smoke.mjs`: gerçek Chromium'da otomatik bileşen ve etkileşim kontrolleri geçti. Testin kendi geçici profili kullanılır; kullanıcının tarayıcı oturumuna bağlanılmaz.
- `npm run typecheck`, Desktop ve web üretim derlemeleri geçti. Mevcut büyük paket boyutu uyarıları sürüyor.
- Yeni `.floem` dosyası açıldı; **62 veri sorgusu sonuç döndürdü, model uyarısı yok**. Kayıt içerikleri veya tutarlar test çıktısına yazılmadı.
- Tarayıcı denemeleri: 1366×768/1, 1920×1080/1,25, 2560×1440/1,5, 1024×768/1,25, 768×1024/1,5, 390×844/2 (CSS viewport / DPR). Bunlar gerçek Windows DPI ayarı değiştirilmesi veya fiziksel monitörler arasında taşıma testi değildir; o donanım kontrolleri bekliyor.

## Ek marka belgesinden çıkarılan kararlar

Kullanıcının “YILDIRIM TECHNOLOGIES & FLOEMDATA — Brand Identity, Logo Design & Complete UI/UX Design System” belgesi okundu; önceki `yildirim.png` logo panosu yeniden incelendi. Y biçimi, iki koldaki veri/piksel uçları ve mavi–cyan karakter korunacak. Referans panodaki düz, beyaz yazılı koyu zemin varyantları okunaklı bir başlangıç; karanlık zemindeki siyah yazı ve yoğun ışık etkileri ürün içinde kullanılmamalı. Küçük boyutlar için ayrı sadeleştirilmiş sembol gerekir.

Web sitesinin mevcut mesajı bağlantı, veri hazırlama ve mutabakat üzerine kurulu. Ürün ailesinde bu altyapı rolü, Floem BI'ın tasarım/görüntüleme rolü ve Floemway'in yenileme rolü anlaşılır kalmalı. Bu tur ürün adları değiştirilmedi. [Floemdata web sitesi](https://floemdata.com/).

### F07 iki teslimata ayrılacak

**F07A — tasarım sistemi temeli, F05'ten önce:** uygulama arayüzü teması ile raporun kendi teması ayrı tutulur. Uygulama temasını değiştirmek yayımlanmış raporun renklerini değiştirmez. Rapor tema kimliği/sürümü ve gerekli değerleriyle dosyada taşınır; Desktop/web aynı görünümü üretir. Nesne özel ayarı tema değerinin üstüne geçer; “temadan al” seçeneğiyle geri döner.

Temel kapsam:

- Beş renk ailesi: Electric Blue, Midnight Indigo, Emerald Intelligence, Arctic Cyan, Graphite & Orange. Her biri için ayrı tasarlanmış açık/koyu görünüm; toplam 10 tema adayı. Nihai renk seçimi karşılaştırmalı ekranlar hazır olduğunda kullanıcıya bırakılır.
- Renklerin görevleri: birincil/ikincil aksiyon, vurgu, yüzey, kenar, metin, başarı/uyarı/hata/bilgi. Grafik seri renkleri ve iş durumları birbirinden ayrılır; örneğin turuncu tema seçmek tüm uyarıları sıradan aksiyon rengine dönüştürmez.
- Tipografi: başlık/gövde/açıklama/etiket/sayısal veri rolleri; tabular rakamlar, Türkçe karakterler, farklı uzunluklar. İlk teknik temel sistem fontlarıdır; yeni font dosyaları eklenmeden lisansları proje kurallarına göre değerlendirilir.
- 4/8/12/16/24/32/48/64 boşluk ölçeği; köşe, kontrollü gölge, odak halkası ve yoğun/rahat tablo seçenekleri.
- Hareket süresi ve azaltılmış hareket ayarı merkezi olur. Parlama ve sürekli animasyon varsayılan olmaz. Güvenilirlik, okunabilirlik ve yoğun veri kullanımına öncelik verilir.

Belgeden alınan başlangıç paletleri (F07A ile açık/koyu tema ailesi olarak uygulandı):

| Aile | Primary / Secondary / Accent | Koyu arka plan / yüzey | Metin / ikincil metin |
|---|---|---|---|
| Electric Blue | `#0866E8` / `#0755C8` / `#00C8F0` | `#0B1628` / `#12233B` | `#F5F8FF` / `#91A4BD` |
| Midnight Indigo | `#5146E5` / `#3730A3` / `#8B7CFF` | `#111326` / `#1B1D38` | `#F5F4FF` / `#A5A5C2` |
| Emerald Intelligence | `#059669` / `#047857` / `#2DD4BF` | `#0B1918` / `#142B28` | `#F0FDFA` / `#8EAAA3` |
| Arctic Cyan | `#0891B2` / `#0E7490` / `#22D3EE` | `#0B1720` / `#132733` | `#F0FAFC` / `#91A9B5` |
| Graphite & Orange | `#F97316` / `#EA580C` / `#FBBF24` | `#111318` / `#20242C` | `#F8FAFC` / `#9CA3AF` |

Açık görünüm başlangıcı: arka plan `#F5F7FA`, yüzey `#FFFFFF`, metin `#172033`, ikincil metin `#64748B`, kenar `#E2E8F0`. Başarı/uyarı/hata/bilgi başlangıç renkleri sırasıyla `#16A34A`, `#F59E0B`, `#EF4444`, `#3B82F6`; tüm ön plan/arka plan eşleşmeleri gerçek bileşenlerde kontrast denetiminden geçecek. Marka renginin beyaz metinle her yerde kullanılabileceği varsayılmayacak.

**F07B — bileşen ve marka kitaplığı uygulandı:** kullanıcı kendi nesnesini sürümlü kitaplığa kaydeder; tema rollerini miras alan birleşik nesneler başka sayfalarda/model alanlarıyla tekrar kullanılır. Ortak güncelleme önizlemeyle uygulanır, yerel istisnalar korunur. Logo yatay/dikey/sembol/tek renk/çizgisel/açık-koyu varyantları ve 16–512 px ikonlar gerçek boyutta karşılaştırılır; SVG/PNG/ICO indirilir. [Kullanım ve doğrulama](f07b-bilesen-ve-marka-kitapligi.md).

### Kullanıcının ileri düzey nesne oluşturma akışı

1. Çerçeve veya grup oluştur; metin, ikon, şekil, resim, grafik ve düğmeyi içine yerleştir.
2. Sabit konum veya akış/grid düzeni seç; boşluk, min/max boyut, hizalama ve dar ekrandaki davranışı tanımla.
3. Yazı/değer/renk/ikon/görünürlüğü bir alan, ölçü veya açıkça tanımlanmış koşula bağla.
4. Normal, seçili, üzerine gelinmiş, yükleniyor, boş ve hata görünümlerini düzenle; dokunma/klavye eşdeğerlerini koru.
5. Tıklama, satır seçimi ve sayfa geçişini mevcut tanımlı eylemlere bağla. Serbest kod çalıştırma yerine doğrulanmış parametreli eylemler kullan.
6. Bileşene alan yuvaları ver: örneğin “Müşteri kimliği”, “Alacak”, “Son aktivite”, “Detay hedefi”. Başka raporda bu yuvaları eşleştirerek kullan.
7. Bileşeni sürümlü kitaplığa kaydet; ortak güncellemenin hangi kullanımları etkileyeceğini göster, yerel istisnaları koru.

İlk örnekler: karşılaştırmalı KPI, ikonlu satır eylemi, açılır filtre çekmecesi, müşteri 360° kartı, süreç adımı ve kalite durum kartı. Satır tekrarlayıcıda her kayıt için binlerce kalıcı tasarım nesnesi üretmek yerine aynı bileşen sanallaştırılarak kullanılır (F11).

### Tasarım karşılaştırmasının kabul koşulları

Beş palet **aynı veri ve aynı düzen** üzerinde değerlendirilir: dashboard, tasarımcı, giriş ekranı ve yoğun tablo/Tree Grid. Açık/koyu görünümlerde seçili satır, odak, hata, boş durum, uzun Türkçe başlık ve büyük sayı örnekleri bulunur. Renk panosu tek başına teslim sayılmaz. Marka panosu, renk karşılaştırması, uygulama kimliği, gerçek UI ekranları ve bileşen kitaplığı ayrı incelenebilir çıktılar olur. Rapordaki veriler tema değişiminde değişmez; renk tek bilgi taşıyıcısı olmaz.

## Güncel geliştirme sırası

PBIP sayfa görünümü bulguları için [F10A-01–04 alt işleri](pbip-bulgularindan-gelistirme-listesi.md)
planlandı. F04/F07A iyileştirmesi olarak F08 öncesinde ele alınacak. F06 ortak temeli, F05 ve F07B uygulandı. Sırada **F10A-01–04**, ardından **F08** var. F06-2–5 kaynak ölçü/motor/mutabakat işleri açık.

| Sıra | İş | Bağımlılık / amaç |
|---|---|---|
| 1–4 | **F01 → F02 → F03 → F04** | Uygulandı; fiziksel DPI/çoklu monitör son kontrolü bekliyor. |
| 5 | **F07A: tema/tipografi/boşluk/durum altyapısı ve karşılaştırma** | Uygulandı; [kullanım ve doğrulama](f07a-tema-altyapisi.md). Nihai marka ailesi seçilmedi. |
| 6 | **F10: PBIP uyumluluk ve kayıp raporu** | Uygulandı; [kullanım ve yedi raporun bulguları](f10-pbip-uyumluluk.md). |
| 7 | **F06: ortak model ve ölçü geçişi** | Ortak temel, 29 yerel ölçü ve 135 kaynak ölçünün haritası uygulandı; tam motor/sonuç uyumu açık. [Kapsam ve kalan işler](f06-ortak-model-ve-olcu-gecisi.md). |
| 8 | **F05: grup, kapsayıcı, otomatik yerleşim, undo/redo** | Uygulandı; [kullanım, demo ve doğrulama](f05-grup-kapsayici-ve-yerlesim.md). |
| 9 | **F07B: kullanıcı bileşenleri, marka ve ikon kitaplığı** | Uygulandı; sürümlü yerel/gömülü kitaplık, alan eşleme, ortak stil ve yerel istisna, SVG/PNG/ICO. [Kullanım](f07b-bilesen-ve-marka-kitapligi.md). |
| 9a | **F10A-01–04: PBIP sayfa görünümü** | Sıradaki iş; sayfaya/genişliğe sığdırma, saydamlık ve tuval dışı renk. |
| 10 | **F08: ekranlara göre düzen varyantları** | Aynı bileşen/ölçü farklı ekran düzenlerinde korunur. |
| 11 | **F09: büyük Grid/Tree Grid** | Sunucu arama/sayfalama, toplam ve dışa aktarım kapsamı. |
| 12 | **F11: veri bağları, durumlar, tekrarlayıcı ve hareket** | Kullanıcı nesneleri veriyle değişir. |
| 13 | **F13: tasarım ve anlam denetçisi** | Taşma, küçük yazı, eksik bağ, yanlış birim/toplam ve kapsam uyarıları. |
| 14 | **F12: müşteri 360° ve parti/kalite pilotları** | Yukarıdaki tasarım araçlarıyla gerçek süreç ekranları. |
| 15 | **F14: Analytics ölçü/uyarı entegrasyonu** | Ortak hesap, filtre ve veri sürümü. |
| 16 | **F15: senaryo ve yetkili işlem iş akışları** | Kaynak yazma ayrı kapsam; izin, doğrulama ve işlem geçmişi. |

Ek belgede anılan DirectQuery ve diğer geniş ürün ekranları bu sırayı kendiliğinden değiştirmiyor. Web'de düzenleme ve çok kiracılılık gibi ayrı mimari işler kendi kapsamlarında kalıyor.
