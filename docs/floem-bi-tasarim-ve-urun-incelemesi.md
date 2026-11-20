# Floem BI: rapor mantığı, tasarım sorunları ve geliştirme sırası

**İnceleme tarihi:** 19.11.2026. **Güncel durum (20.11.2026):** F01–F04, F07A/B, F05, F08 ve F10/A uygulandı; aşağıdaki ilk incelemenin bulguları uygulama öncesi durumu anlatır. Sonuçlar ve marka belgesiyle güncellenen sıra [uygulama notunda](f01-f04-uygulama-ve-tasarim-sirasi.md). F09'un matris/aktarım ve sunucu sayfalı büyük Grid/Tree Grid işleri de hazır; [kapsam ve sınırlar](f09-buyuk-grid-ve-aktarim.md). [F11 veri bağları, durumlar ve tekrarlayıcı](f11-veri-baglari-ve-tekrarlayici.md) ile [F13 denetçi](f13-tasarim-ve-anlam-denetcisi.md) tamamlandı. Sırada F12 süreç pilotları; F06 tam ölçü geçişi açık.

## 1. Sonuç ve ürün yönü

İncelenen raporların ortak amacı **sonucu görmek → nedenini bulmak → ilgili kayda inmek → bir sonraki işi belirlemek**. Finans raporu bir hesap tablosu, üretim raporu yalnız bir ağaç, satış raporu yalnız bir grafik değil. Her biri kullanıcının bir iş sürecini takip ettiği ekran.

Floem BI için önerilen yön: **kullanıcının kendi görünümünü, veriyle değişen bileşenlerini ve etkileşimlerini tasarlayabildiği rapor uygulaması**. Etkileyici görünüm; iyi tipografi, boşluk, görsel hiyerarşi, akıcı geçişler ve anlaşılır veri ilişkileriyle kurulmalı. Çok sayıda dekoratif nesne veya sürekli animasyon tek başına bu sonucu sağlamaz.

İlk öncelik iki paralel konu: metin/ölçek sorunlarını çözmek ve çalışan demonun ölçülerini doğru adlandırmak. Ardından tasarım bileşenleri, ortak veri modeli ve süreç ekranları gelmeli. Çalışan demo, tam Power BI geçişi olarak sunulmamalı.

## 2. İncelenen sürümler ve doğrulamanın sınırı

GitHub dal başları `git ls-remote` ve yerel klona `fetch` ile kontrol edildi; model, rapor tanımları ve üretici kodları okundu.

| Kaynak | İncelenen sürüm | Bulgular |
|---|---|---|
| [powerbi / main](https://github.com/oguzhanyil/powerbi/tree/4bc05a96c4d839175389e37b6b0a90021c80947b) | `4bc05a9` | Aydınlı, Kadoğlu, Pavezyum ve Demo |
| [demo-finans-raporlari](https://github.com/oguzhanyil/powerbi/tree/536702ed0a2d0068dd05afccca44ee0f1e49e171/Demo) | `536702e` | 6 sayfa, 12 model tablosu, 36 ölçü, 5 ilişki |
| [demo-kur-muhataplar](https://github.com/oguzhanyil/powerbi/tree/f29fd916d3737368947df7b26c04a44fab50e640/Demo) | `f29fd91` | 17 sayfa, 28 model tablosu, 135 ölçü, 23 ilişki; `main` ile Demo klasörü aynı |
| [kadoglu-satis-kar-zarar](https://github.com/oguzhanyil/powerbi/tree/ddce773db6d760e930f105449a005d38c8132291) | `ddce773` | Satış/iade, SMM ve 620 farkı dağıtımı; ayrıntılı ölçü incelemesi `main` kopyasında |
| [floemdata-analytics](https://github.com/oguzhanyil/floemdata-analytics/tree/0782a4f190800152113f6b470a40c9d51f720449) | `0782a4f` | Agent, Bronze/Silver/Gold, ölçü kataloğu, rapor derleyicisi ve anomali kuralları |
| Yerel `SAPB1Demo-Floem.floem` | Bu incelemedeki dosya | 8 sayfa, 150 nesne, 1280×860; modelde ilişki yok |
| Yerel `SAPB1Demo-Taslak.floem` | Bu incelemedeki dosya | 18 sayfa, 905 nesne; modelde ilişki yok; veri içermeyen yerleşim taslağı |

GitHub'daki son Demo 17 sayfa/962 nesne. Yerel Power BI kopyasındaki ek asistan sayfası nedeniyle önceki aktarım 18 sayfa üzerinden yapılmış; bunlar aynı sayım değil. Çalışan Floem demosunun veri kapsamı ve önceki doğrulamalar [SAP B1 uyarlama notunda](sapb1-demo-uyarlama.md).

Kadoğlu dalı ile `main` de aynı değil: Kadoğlu klasöründe 14 dosya değişmiş. `main`, dağıtım tutarını firma bazında `SUMX` ile hesaplıyor ve kaynakta bulunmayan bazı alanları boş döndürme davranışı ekliyor. Geçişte eski dal yerine bu düzeltmeleri içeren sürüm temel alınmalı; bunlar yeniden yapılacak eksikler olarak sayılmadı.

Bu turda Power BI/Electron ekranı açılarak piksel ölçümü yapılmadı; JSON/TMDL, CSS/React/Python ve yerel `.floem` arşiv tanımları incelendi. Kullanıcı önceki düzeltmeden sonra verinin göründüğünü doğruladı. Aşağıdaki taşma sayıları **statik geometri adaylarıdır**, ekran görüntüsüyle doğrulanmış hata sayısı değildir. Kaynak veritabanına yazılmadı, raporlar yeniden yayımlanmadı.

## 3. Bu verilerle ne göstermek istiyoruz?

| Rapor | İş sorusu ve veri mantığı | İyileştirme yönü |
|---|---|---|
| Aydınlı Dinamik Finans | Firma → hesap hiyerarşisi → yevmiye; borç/alacak, dönem hareketi, devir ve kapanış. Seçilen hesap seviyeleriyle ayrıntı değişir. | Özet → sapma → hesap → belge akışı. Hareket tutarı ile belirli tarihteki bakiye açıkça ayrılmalı; çok firmalı toplamın konsolidasyon/eliminasyon içerip içermediği belirtilmeli. |
| Kadoğlu satış/kâr-zarar | Fatura − iade = net satış; kayıtlı maliyet + muhasebe hesabından dağıtılan fark = SMM. Ürün/pazar/firma kırılımında kazanç. | Satıştan kâra geçişi açıklayan waterfall; kayıtlı maliyet ve dağıtılmış fark ayrı gösterilmeli. Kullanıcı dağıtımın kaynağını ve paydasını görebilmeli. |
| Pavezyum üretim takibi | Üretim girdileri ve çıktıları üzerinden parti bağlantıları, tekrar eden düğümler, kalite kontrol formu. | Ağaç + bağlantı grafiği + parti zaman çizgisi. Bir partiden geriye hammaddeye, ileriye etkilenebilecek ürünlere ilerleme. Kalite ölçümünü hedef/tolerans bandında gösterme. |
| Pavezyum yönetici panosu | Açık satış/satınalma, stok kullanılabilirliği, gecikmiş üretim ve eksik bileşenler. | Toplam adetlerden öncelikli iş listesine: “Hangi müşteri siparişi hangi eksik malzeme nedeniyle gecikecek?” Sipariş–stok–üretim ilişkisi ve tarihli olaylar gerekir. |
| Demo finans | Mizan, bilanço, gelir tablosu, cari ekstre, yaşlandırma, dönem karşılaştırması ve para birimi seçimi. | Mutabakat ve açıklanabilir toplamlar; kapanış, vade, kur tarihi ve seçili bağlamın görünür olması. |
| Demo ticari süreç | Satış/satınalma analizi, fırsat hunisi ve performansı, müşteri ABC/segmentleri, muhatap kartı ve aktiviteler. | Fırsat → sipariş → fatura → tahsilat zinciri; müşteri kartından geciken işe geçiş. Kaynakta ABC ve 360° kart var; Floem'e bunların anlamı taşınmalı. |

### Power BI raporlarında somut iyileştirme noktaları

1. **Kâr oranının adı:** Kadoğlu `Kar Zarar Oran (%)`, kârı **SMM'ye** bölüyor. Bu maliyet üzerinden kârlılıktır; satış marjı farklıdır. İkisi ayrı ölçü/ad olmalı. Aynı ölçü `FORMAT` ile metne dönüyor; sayısal değer ve yüzde gösterimi ayrılarak sıralama ve sonraki hesaplar korunmalı. Kaynak: `Kadoglu/KADOOGLU.SemanticModel/definition/tables/fatura.tmdl`.
2. **Dağıtımın açıklanması:** 620 farkı dağıtımı kaynakta var ve bazı filtreleri bilinçli kaldırıyor. “Bu ürünün kendi maliyeti” ile “firma toplamından dağıtılan düzeltme” aynı sayı içinde kaybolmamalı. Firma/dönem toplamında dağıtılan tutarın farkla eşitliği; sıfır/negatif net satış ve yalnız iadeli gruplar için beklenen davranış sınanmalı. Bu koşullarda hata oluştuğu veriyle doğrulanmadı.
3. **Çok firmada kur bağlamı:** Demo `Para Birimi.tmdl` açıklaması yerel/sistem para birimi seçicisinde ilk firmanın esas alındığını söylüyor. Farklı yerel para birimine sahip firmalar birlikte seçildiğinde ortak sunum para birimi ve firma bazlı çeviri gerekir. Bu, tek firmalı demoda görünmeyebilecek bir genişleme sorunu.
4. **Tekrarlanan parti miktarları:** Pavezyum kaynak açıklaması kenarlardaki üretim miktarının tekrar edebildiğini belirtiyor. Grafikte aynı partinin her görünümünü toplayarak üretim toplamı hesaplanmamalı. İş emri, parti ve bağlantı miktarının toplama kuralları ayrı olmalı. Bağlantı bulunması fiziksel miktarın kesin olarak o çıkışa dağıldığını tek başına kanıtlamaz.
5. **Geçmiş performans ile anlık durum:** Açık sipariş ve stok görüntüsünden geçmişteki teslim performansı çıkarılamaz. “Bugün gecikmiş” ve “geçen ay zamanında teslim oranı” farklı veri gerektirir. Pavezyum özetine tarihli hareket/snapshot katmanı eklenmeden geçmiş trend uydurulmamalı.
6. **Huni ile dönüşüm:** Mevcut aşamalardaki fırsat sayısı bir dağılımdır; aşamadan aşamaya gerçek dönüşüm oranı için aşama geçmişi ve başlangıç kohortu gerekir. Açılış, beklenen kapanış ve gerçekleşen kapanış tarihleri farklı analiz rolleri olmalı.
7. **Seçim görünürlüğü:** Demo muhatap kartının ölçüsü tek müşteri seçilmediğinde varsayılan/ilk uygun müşteri belirleyebiliyor. Kartın neden bu müşteriyi gösterdiği belirtilmeli; çoklu seçimde “karşılaştır” veya “bir müşteri seç” durumu daha anlaşılır olabilir.
8. **Tasarımın bakım maliyeti:** Son Demo'da 386 şekil, 124 resim, 181 metin ve 62 düğme var; 962 nesnenin 753'ü bu dört türden. Bunlar tek başına kusur değil; menü/kart/başlıkların çok parçalı kurulması değişiklik ve aktarım maliyetini artırıyor. Tekrar kullanılan birleşik bileşenler gerekir. 962 nesne aynı anda tek sayfada çiziliyor diye bir performans sonucu çıkarılmadı.

## 4. Floem demosunda görsellikten önce korunması gereken anlam

Kanıt: [demo_port.py](../src/floem_bi/demo_port.py). Bunlar Floem motorunun her raporda yapamadığı şeyler değil; **mevcut sade demo uyarlamasının** sınırlamaları.

| Bulgu | Etkisi | Geliştirme ve doğrulama |
|---|---|---|
| “Açık sipariş” açıklaması; sorguda yalnız `CANCELED = 'N'` | Kapalı siparişler de sipariş tutarına girebilir. | Mevcut değeri “iptal edilmemiş sipariş toplamı” diye tanımla veya açık satır/kalan miktar mantığıyla gerçek açık sipariş ölçüsü üret. Kısmi teslim ve kapanmış satır örneğiyle kontrol et. |
| Satış `Miktar` alanı fatura, iade ve siparişi birlikte topluyor | Aynı ticari sürecin sipariş ve faturası birlikte sayılabilir; farklı birimler de karışabilir. | Net faturalanan, sipariş edilen, kalan sipariş miktarını ayır; birimsiz toplamı engelle. |
| Satınalma sorgusunda fatura ve sipariş var, iade ailesi yok | Gösterilen tutar net satınalma diye yorumlanamaz. | Başlık kapsamını açık tut; net satınalma için iade/iskonto/iptal ve para birimi kurallarını tamamla. |
| `Muhatap` adı aktarılıyor, kod bazı tablolarda yok | Aynı adlı farklı müşteriler birleşebilir; satır eylemi yanlış kayda gidebilir. | Firma + kaynak kayıt anahtarı taşı. Belge için firma + tür + `DocEntry`, satır için ayrıca `LineNum`; gösterim adı anahtar olmasın. |
| Yürüyen bakiye kaynakta hesaplanıyor; görselde değer alanı `sum` | Koşan bakiyenin genel toplamı anlamlı değil; tarih kesiti başlangıcı belirsiz kalabilir. | Açılış, dönem hareketi ve kapanışı ayrı ölçü yap; yürüyen bakiyede toplamı kapat veya bağlama göre son değer uygula. |
| 7 tablo arasında ilişki yok | Genel sayfada satış seçiminin fırsat/aktiviteye ortak müşteri filtresi olarak geçmesi güvence altında değil. | Ortak Firma, Tarih, Muhatap, Ürün boyutları; her olgunun tane düzeyi ve tarih rolü tanımlansın. |
| Hesap seviyeleri `LEFT(..., 1/3)` ile kuruluyor | Kaynaktaki gerçek üst–alt hesap hiyerarşisinin eşdeğeri değil. | `FatherNum`/anahtar tabanlı ağaç; eksik ebeveyn ve döngü kontrolü. |
| Müşteri ve tedarikçi bakiyesi netleştiriliyor | Büyük alacak ve borç birbirini gizleyebilir. | Alacak, borç, gecikmiş alacak ve döviz kırılımı ayrı kartlar. |
| Satır tutarları ve 135 DAX ölçüsü arasında tam eşdeğerlik yok | Bilanço, yaşlandırma, kur, ABC ve dönem karşılaştırması taslak görünümden ibaret kalabilir. | Ölçü başına “destekli / dönüşüm gerekli / eksik veri / desteklenmiyor” envanteri ve aynı filtrede sonuç karşılaştırması. |

**Demo verisinin niteliği:** kaynak README tüm veriyi sahte diye tanımlasa da `Demo/sql/maskele.sql`, kod/tutar/tarihlerin değişmediğini açıkça söylüyor. Fırsat ve aktiviteler ayrıca sentetik üretiliyor. Bu nedenle mevcut dosya “tamamen sentetik” diye sınıflandırılmamalı. Dışarıya dağıtılacak örnek veri için tutarları ve tarih ilişkilerini de yeniden üreten, tutarlılık kontrolleri olan bağımsız veri üreticisi planlanmalı; bu incelemede veri paylaşılmadı.

## 5. Metin, kaydırma, çözünürlük ve masaüstü hissi

### Doğrudan kod bulguları

| Konu | Kanıt | Sonuç / öneri |
|---|---|---|
| Her metinde kaydırma | [visuals.css](../packages/report/src/visuals.css), `.v-text`: `height:100%; overflow:auto; line-height:1.4` | Bir piksellik taşma da kaydırma çıkarabilir. Başlık, açıklama ve uzun içerik için ayrı taşma politikaları gerekir. |
| Aktarımda zorunlu büyütme | [pbip_import.py](../src/floem_bi/pbip_import.py), `_text`: pt→px sonrası en az 20 px; yalnız ilk metin parçasının sınırlı biçimi | Kutu aynı kalırken metin büyüyor; zengin metin/font bilgisi kayboluyor. Kaynak birimini doğru dönüştür, otomatik büyütmeyi kaldır, desteklenmeyen biçimi raporla. |
| Başlık kutusu çok kısa | [demo_port.py](../src/floem_bi/demo_port.py), `_base`: yükseklik 43, font 30, kenarlık 1 | `border-box` altında içerik 41 px; satır 42 px. Çalışan dosyada 8 başlık bu koşulu taşıyor. Gerçek DOM ölçümüyle doğrula, içerik ölçüsüne göre yüksekliği ayarla. |
| Sabit sağ paneller | [designer.css](../packages/designer/src/designer.css): 260 + 240 px | Panelleri gizleme zaten var. Buna boyutlandırma, minimum tuval alanı ve dar ekranda çekmece davranışı eklenmeli. |
| Tüm sayfayı birlikte küçültme | [PageCanvas.tsx](../packages/designer/src/PageCanvas.tsx), [ReportViewer.tsx](../packages/report/src/ReportViewer.tsx): iki eksene sığdırma, alt sınır 0.2 | Yazı ve tıklama alanı da küçülüyor. `%100`, genişliğe sığdır, sayfaya sığdır, yakınlaştır/kaydır ve uyarlanan düzen seçenekleri ayrılmalı. |
| Kart fontu yaklaşık hesaplanıyor | [visuals.tsx](../packages/report/src/visuals.tsx), `CardVisual`: karakter sayısı ve kutu boyutuyla tahmin; en az 16 px | Uzun para birimi, negatif değer ve farklı fontlarda garanti yok. Gerçek metin genişliği ölçülmeli; kompakt sayı ve tam değer erişimi sunulmalı. |
| Etiket/başlık kesilmesi | Sabit 26 px başlık, tek satır ellipsis; bazı grafik eksenlerinde sabit etiket genişliği | Satır sayısı, yükseklik, sözcük kaydırma ve ayrıntıyı açma kontrolü eklenmeli; bilgi yalnız fare tooltip'ine bağlı kalmamalı. |
| Tablo sınırları | [useVisualData.ts](../packages/report/src/useVisualData.ts): tablo 10.000 grup, matris sorgusu 5.000; [matrix.tsx](../packages/report/src/matrix.tsx): görünür satır 3.000 | Sınır uyarıları mevcut. Arama/CSV'nin yüklenen sonuçta mı tüm veride mi çalıştığı daha görünür olmalı; büyük veri için sorgu tarafında sayfalama/arama gerekir. |
| Hata yalıtımı | Desktop genel `AppErrorBoundary`; AG Grid API yaşam döngüsü düzeltildi | Bir nesne arızalanınca raporun kalanını koruyan nesne düzeyinde sınır ve tekrar dene davranışı eklenmeli. |

**Statik tarama:** GitHub Demo'daki 181 metin kutusunun 20'si, aktarım sonrası tek satır yüksekliğinden bile kısa. Yerel taslakta kenarlık/padding hesabıyla 30, çalışan demoda 8 taşma adayı var. Çok satır ve sözcük kaydırmayı kapsamadığından bu tam bir taşma envanteri değil.

**Ölçek örneği:** 1366 CSS piksel genişlikte, 500 px sağ panel + 48 px sol şerit + 32 px boşluk varsayımıyla 1920 genişliğindeki sayfaya en fazla yaklaşık `0,409` ölçek kalır. Sayfadaki 20 px yazı yaklaşık 8,2 CSS px görünür. Yükseklik sınırı bunu daha da düşürebilir. Bu bir hesap örneğidir; fiziksel ekran çözünürlüğü Windows DPI nedeniyle CSS piksel genişliğiyle aynı olmayabilir. Panelleri kapatmak yardımcı olur, farklı düzene ihtiyacı kaldırmaz.

### Önerilen davranış sözleşmesi

- **Başlık ve etiket:** varsayılan iç kaydırma yok; sınırlı satır kaydırma, otomatik yükseklik veya kullanıcı seçerse üç nokta. Tam içerik klavye/dokunmayla da açılabilir.
- **Uzun açıklama:** içerik kadar büyüme veya açıkça seçilmiş kaydırılabilir açıklama paneli. Kaydırma bir tasarım tercihi.
- **KPI:** ölçü adı, değer, birim, karşılaştırma ve durum bir bileşen; okunabilir alt font sınırına ulaşınca düzen değişir. Sessizce rakam kırpılmaz.
- **Tablo/matris:** kaydırma korunur; sabit başlık, isteğe bağlı sabit ilk kolon, sütun genişliği, sanallaştırma ve tek belirgin kaydırma alanı. “Hiç scroll olmasın” hedefi tablo için uygun değil.
- **Menü/tooltip:** tuval veya görsel kenarında kesilmeyen üst katmana yerleşir; Escape, odak dönüşü ve klavyeyle kullanım vardır.
- **Tuval:** serbest konumlandırma ile kapsayıcı/grid düzeni birlikte çalışır. Kullanıcı masaüstü/tablet/telefon için düzen seçer; salt orantılı küçültme kullanılabilir tek yol olmaz.

Electron zaten yerel pencere kabuğu sağlıyor. Buradaki “native” hedefi: keskin metin, DPI değişiminde doğru çizim, tutarlı klavye/sağ tık/odak davranışı, geri al–yinele ve akıcı taşıma. Bu hedefler uygulamayı başka bir masaüstü teknolojisine yeniden yazmayı gerektirmez.

### Uygulama sırasında kabul matrisi

| Kontrol | Kapsam | Başarı koşulu |
|---|---|---|
| Masaüstü | 1366×768, 1920×1080, 2560×1440 fiziksel ekran; %100/%125/%150 Windows ölçeği; paneller açık/kapalı | Gerçek CSS viewport kaydedilir; uygulama komutlarına erişilir; başlık/KPI iç kaydırması yok; odaklanan nesneye erişilebilir. |
| Web | 1280/1024/768/390 CSS px; tarayıcı %100/%200 | Uyarlanan görüntüleme düzeninde içerik kaybolmaz; geniş tablolar kendi alanında kayar. |
| Metin | Uzun Türkçe başlık, İ/ı/Ş/Ğ, uzun kimlik, negatif ve büyük tutar, sıfır, boş değer | Taşma politikası uygulanır; boş veri sıfır diye gösterilmez; sayı/birim okunur. |
| Etkileşim | Klavye, fare, dokunma; zoom sonrası sürükleme; iki monitör arasında taşıma | Taşıma koordinatı doğru, odak görünür, menü kesilmez, geri alma çalışır; Windows DPI değişiminde yenilenir. |
| Büyük veri | Küçük örnek, 10.000 sınırını aşan tablo, derin ağaç, boş/hatalı sorgu | Sınır ve kapsam görünür; UI yanıt verir; yalnız arızalı nesne etkilenir. Gecikme/çizim süresi ölçülür, sonuç alınmadan performans iddiası yapılmaz. |
| Hareket | Azaltılmış hareket ayarı; sekme arka planda; hızlı filtre değiştirme | Mevcut `prefers-reduced-motion` desteği korunur; eski animasyon iptal edilir; son değer doğru kalır. |

Ürün hedefi olarak olağan kontrollerde en az 24×24 CSS px etkin hedef ve mobilde daha geniş hedef tercih edilmeli; WCAG'nin istisnaları ve aralık koşulları ayrıca değerlendirilir. İki boyutlu tabloların yeniden akış istisnası var; bu istisna çevredeki tüm arayüzü kaydırılmaz yapmayı gerektirmez. Bu liste bir erişilebilirlik uygunluk sertifikası değildir. [W3C hedef boyutu](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [W3C yeniden akış](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## 6. Canva yaklaşımını Floem'e nasıl uyarlamalıyız?

Canva'nın gruplama, katman ve hizalama iş akışı tasarım için uygun referans. Ama Floem bileşeninin ayrıca veri alanı, ölçüsü, filtre bağlamı ve etkileşim durumu var. Alınacak fikir, kolay düzenlenebilir tasarım sistemi; başka ürünün kodu veya ücretli varlıkları değil. Ücretsiz/ücretli özellik kapsamı hakkında bu inceleme bir lisans iddiasında bulunmuyor. [Canva gruplama ve hizalama](https://www.canva.com/help/layer-group-align/).

**Serbest tasarımın önerilen kapsamı:** nesneyi istediğin yere taşımak + çoklu seçip gruplamak + hizalamak + bileşen olarak kaydetmek + bileşene veri bağlamak + ekran küçüldüğünde nasıl davranacağını tanımlamak. Mevcut Alt ile serbest konumlandırma bunun yalnız başlangıcı.

| Tasarım aracı | Floem karşılığı | Kullanıcıya getirisi |
|---|---|---|
| Grup ve iç içe çerçeve | Başlık, ikon, sayı, trend ve eylemi tek bileşene alma | Kartı taşırken alt parçaları ayrı ayrı düzeltmez. |
| Akıllı yerleşim | İç boşluk, aralık, hizalama, min/max boyut, sarma, kenara sabitleme | Yazı uzayınca nesneler üst üste binmez. |
| Stil sistemi | Font, renk, boşluk, köşe, gölge ve durum renkleri; rapor/sayfa/nesne mirası | Marka tasarımı tek değişiklikle güncellenir. |
| Bileşen kitaplığı | Kullanıcının kaydettiği kart, menü, müşteri satırı, süreç adımı | Hazır şablona hapsolmadan kendi tasarım dilini kurar. |
| Veri bağları | Metin/renk/ikon/görünürlük/hedefi ölçüye veya satıra bağlama | Aynı kart farklı veride farklı anlamlı durum gösterir. |
| Tasarım durumları | Normal, seçili, hover, yükleniyor, boş, hata; görünürlük kuralları | Rapor yalnız veri geldiğinde değil her durumda tasarlanır. |
| Tekrarlayıcı | Bir müşteri/ürün tasarımını sorgu sonucu için tekrar etme | Dinamik kart galerisi veya katalog; binlerce ayrı kalıcı nesne üretmeden sanallaştırılır. |
| Tasarım kontrolü | Taşma, çok küçük yazı, düşük kontrast, eksik veri bağı ve belirsiz birim uyarısı | Yayınlamadan önce sorun görülür; öneri kullanıcı onayıyla uygulanır. |

Önerilen ilk hazır bileşenler: karşılaştırmalı KPI, sekmeli menü, açılır filtre çekmecesi, müşteri kartı, durum etiketi, adım göstergesi ve satır eylemi. Mevcut düğme/menü/URL/sayfa geçişi/FDX eylemleri korunarak bunların içine bağlanmalı.

Animasyon; değer değişimini, seçilen akışı ve açılan ayrıntıyı açıklamalı. Kısa geçişler tercih edilmeli; sürekli nabız efekti varsayılan olmamalı. Mevcut sayaç ve azaltılmış hareket desteği yeniden yazılacak özellikler değil, geliştirilecek temel.

## 7. BI araçlarındaki fırsat: mevcut özellikleri aşan bütünlük

Power BI'da mobil düzen, duyarlı görseller ve yer imi tabanlı katmanlar zaten bulunuyor. “Power BI responsive veya etkileşim yapamaz” sonucu doğru değil. Floem'in fırsatı aynı kullanıcı bileşeninin veri bağını koruyarak farklı düzenlere uyarlanmasını kolaylaştırmak. [Microsoft mobil düzen](https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-mobile-layout-view), [görsel biçimlendirme](https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-format-visuals).

Tableau'da da koşula göre alan gösterme/gizleme var. Floem'de yenilik iddiası yalnız nesne gizlemek olamaz; grup, veri, yerleşim ve eylem durumunun aynı editörde anlaşılır biçimde yönetilmesi olmalı. [Tableau Dynamic Zone Visibility](https://help.tableau.com/current/online/en-us/dynamic_zone_visibility.htm).

Power BI raporundan Power Automate akışı çalıştırmak mümkün. Bu entegrasyonun izin ve kullanım sınırları var. Floem için fırsat, satırdan eyleme geçişin bağlamını, sonucunu ve geçmişini rapor deneyiminin içinde anlaşılır kılmak. Bunun bütün BI ürünlerinde eksik olduğu iddia edilmiyor. [Microsoft Power Automate görseli](https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-automate-visual).

Bu karşılaştırmalardan çıkan, kullanıcılarla sınanacak ürün hipotezleri:

- **Tasarım tekrarının maliyeti:** aynı kartı on sayfada düzeltme yerine sürümlü bileşen kullanımı. Ölçüm: ortak stil değişikliği için gereken işlem sayısı.
- **Veri güveninin görünmezliği:** tazelik, para birimi, hesap kuralı ve mutabakat durumunu bileşenin ayrıntısında göstermek. Ölçüm: kullanıcı değerin nereden geldiğini bulabiliyor mu?
- **Analizden işe geçerken bağlam kaybı:** seçili müşteri/dönem/partiyi ayrıntı ve eyleme taşımak. Ölçüm: aynı filtreleri tekrar kurma ihtiyacı.
- **Ekranlar arası bakım:** bir raporun laptop ve telefonda yeniden kurulması yerine düzen varyantları. Ölçüm: yayın sonrası kırpılma sayısı ve ikinci düzene ayırılan süre.
- **Sayı çok, yönlendirme az:** istisna, sorumlu, neden ve sonraki adımı aynı görünümde sunmak. Ölçüm: sorunun kaynağını ve ilgili kaydı bulma süresi.

## 8. Farklı süreçler için görselleştirilebilir deneyimler

| Süreç / ekran | Görsel ve etkileşim | Gerekli veri / bugünkü durum |
|---|---|---|
| Finans yöneticisi | Kâra geçiş waterfall'ı, dönem karşılaştırması, hesap–belge detayı | Kaynak PBI'da önemli kısmı var; Floem ölçü ve hiyerarşi geçişi gerekli. |
| Tahsilat masası | Vade şeritleri, müşteri risk kartı, tahsilat olay çizgisi, ilgili kayıt bağlantısı | Yaşlandırma kaynakta var; açık kalem, tahsilat eşlemesi ve analiz tarihi doğru taşınmalı. |
| Satış ekibi | Fırsat aşamaları, kayıp nedeni, müşteri 360°, sıradaki aktivite | Demo fırsat/aktivitesi sentetik. Gerçek dönüşüm için aşama geçmişi; eylem için yetkili iş akışı gerekir. |
| Satınalma | Geciken tedarikçi, sipariş–teslimat çizgisi, üretime etkisi | Sipariş ve teslimat satır ilişkisi, termin ve gerçekleşen tarih gerekir; mevcut Floem özet tabloları yeterli değil. |
| Üretim ve kalite | Parti grafiği, ağaç, tolerans bandı, seçilen partinin ileri/geri etkisi | Pavezyum sorgu mantığı referans; Floem'in Import modeline uygun seçili altgraf yaklaşımı tasarlanmalı. DirectQuery ayrı kapsam. |
| Depo | Depo/raf planı üzerinde doluluk, stok yaş haritası, hareket zaman çizgisi | Stoktan öte raf koordinatı, kapasite, lot ve hareket zamanı gerekir. |
| Servis / bakım | Cihaz kartı, arıza zaman çizgisi, SLA geri sayımı, teknisyen iş listesi | Servis çağrısı, durum geçmişi, vardiya ve iş takvimi yeni veri kaynağıdır. |
| Proje / ekip | Gantt, bağımlılıklar, iş yükü ve bütçe sapması | İş/kişi/zaman/bütçe tane düzeyleri gerekir; yalnız aktivite adedi yeterli değil. |
| Pazarlama / içerik | Kampanya yolculuğu, kohort, kanal maliyeti ve dönüşüm | Analytics tarafındaki kaynaklar adaydır; kimlik ve atıf yöntemi doğrulanmadan nedensellik iddia edilmez. |
| Yönetim sunumu | Canlı veriye bağlı kısa hikâye sayfaları; özetten istisnaya geçiş | Aynı ölçüler ve seçili filtreler korunur; sunum sırasında değişen verinin zamanı görünür. |

### Öncelikli üç tasarım örneği

**Yönetici özeti:** üstte firma/dönem/para birimi ve veri zamanı; altında dört karşılaştırmalı KPI; ortada kâra geçiş; sağda gerekçeli üç istisna; altta ilgili iş listesi. Dar ekranda KPI'lar iki sütun, istisnalar grafiğin altına; filtreler çekmeceye geçer.

**Müşteri 360°:** sol üstte müşteri kimliği ve durumu; satış/tahsilat/risk kartları; ortada fatura–ödeme–aktivite zaman çizgisi; sağda açık işler. Bir satır seçildiğinde aynı müşteri ve belge anahtarıyla ayrıntı açılır. Tarih filtresi ile anlık bakiye arasındaki fark yazılır.

**Parti inceleme:** solda arama/ağaç; ortada seçili partinin sınırlı komşuluk grafiği; sağda kalite ölçümü ve belge detayı. Tekrarlanan düğüm simgesi, ilişki türü ve miktar anlamı görünür. Tüm olası yolları önceden çoğaltmak yerine ihtiyaç duyulan altgraf açılır.

### Yenilik adayları

1. **Veriyle yaşayan tasarım bileşeni:** kullanıcı bir süreç kartı çizer; ölçüleri, durum renklerini, ikonları ve eylemleri bağlar; başkaları aynı bileşeni kendi alanlarıyla kullanır.
2. **Tasarım ve anlam denetçisi:** “Bu kutu taşıyor”, “bu toplam farklı birimleri birleştiriyor”, “bu bakiye toplanamaz”, “arama ilk 10.000 sonuçta” uyarıları. Her uyarı kaynak ve düzeltme önerisi içerir.
3. **Açıklanabilir istisna:** anomali kartı → hesabın tanımı → etkileyen kırılımlar → kaynak kayıtlar. Analitik ilişki, doğrulanmış neden gibi sunulmaz.
4. **Senaryo katmanı:** kullanıcı kur/fiyat/tahsilat günü varsayımıyla görünüm karşılaştırır. Varsayım sonuçları gerçekleşenden ayrı işaretlenir; kaynak ERP'ye yazılmaz.
5. **Filtreleri koruyan hikâye:** özet, neden ve ayrıntı durakları arasında geçiş; her durakta aynı müşteri/parti/dönem bağlamı ve geri dönüş.

Bu fikirlerin dünyada ilk olduğu ileri sürülmüyor. Farklılaşma, bunların aynı veri ve tasarım sözleşmesiyle tutarlı işlemesinde.

## 9. Uygulanabilir geliştirme listesi

`S`: yerel ve sınırlı değişiklik; `M`: birkaç bileşen/katman; `L`: şema ve uçtan uca mimari. Bunlar süre taahhüdü değil. Önceki dosyaların geriye uyumluluğu her şema değişikliğinde korunmalı.

| ID | Öncelik / kapsam | İş | Bitti sayılma koşulu / bağımlılık |
|---|---|---|---|
| F01 | P0 / M | Metin taşma politikaları, başlık yüksekliği, PBIP font dönüşümü | 8 çalışan başlık ve taslaktaki adaylar gerçek DOM ölçümüyle yeniden kontrol edilir; başlıklarda iç scroll yok; kaynak boyut korunur. |
| F02 | P0 / M | Demo ölçü ve kimlik düzeltmeleri | Açık sipariş, miktar, satınalma kapsamı, yürüyen bakiye ve kayıt anahtarları için karşı örnekli doğrulama; kart etiketleri sorguyla aynı anlamda. |
| F03 | P0 / M | Görsel hata yalıtımı ve veri durumları | Tek bozuk görsel diğerlerini kapatmaz; boş/sıfır/yükleniyor/hata ayrıdır; dosya açma akışı çalışır. |
| F04 | P1 / M | Zoom ve panel davranışı | %100/genişliğe/sayfaya sığdırma, kaydırma, panel boyutu; ölçek sonrası taşıma ve menü konumu kabul matrisini geçer. F01 ile birlikte. |
| F05 | P1 / L | Grup, kapsayıcı, hizalama, geri al–yinele | Bir KPI'nın alt parçaları birlikte taşınır; metin uzaması yerleşimi bozmadan yönetilir; aç/kaydet geri dönüşü ve undo korunur. |
| F06 | P1 / L | Ortak model ve ölçü geçiş haritası | Firma/tarih/muhatap anahtarları ve ilişkileri; 135 ölçünün her birine durum; öncelikli ölçüler aynı bağlamda kaynakla karşılaştırılır. F02'ye dayanır. |
| F07 | P1 / M | Tema ve bileşen kitaplığı | Bir kart/menü bileşeni oluştur, iki sayfada kullan, ortak stili güncelle, yerel istisnayı koru. F05'e dayanır. |
| F08 | P1 / L | Düzen varyantları ve uyarlanan görüntüleme | Laptop/tablet/telefon aynı ölçü ve eylemleri kullanır; okuyucuda bilgi kaybı yok; eski sabit tuval hâlâ açılır. F04–F07. |
| F09 | P1 / M | Büyük tablo/Tree Grid davranışı | Sonuç kapsamı, sunucu sayfalaması/arama, toplam politikası ve CSV kapsamı açık; 10.000 üstü kayıtla doğrulanır. |
| F10 | P1 / M | PBIP uyumluluk raporu | Nesne türü, alan bağı, ölçü, filtre, eylem ve biçim kayıpları listelenir; desteklenmeyen özellik sessizce başka anlamda açılmaz. |
| F11 | P2 / L | Veriyle değişen bileşen durumları ve tekrarlayıcı | Alan bağları doğrulanır, kimlikler kararlı, büyük listeler sanallaşır; tasarım/önizleme/okuma tutarlı. F05–F08. |
| F12 | P2 / L | Müşteri 360° ve parti inceleme pilotları | Özetten seçili kayda bağlam kaybetmeden gidilir; parti miktarları yinelenerek toplanmaz. F06 ve seçili altgraf sözleşmesi gerekli. |
| F13 | P2 / M | Tasarım ve anlam denetçisi | Taşma, küçük yazı, eksik bağ, birim/toplama ve sonuç sınırı uyarıları gerekçeli; kullanıcı tasarımını kendiliğinden değiştirmez. |
| F14 | P2 / L | Analytics ölçü/uyarı entegrasyonu | Rapor ve uyarı aynı ölçü sürümü, filtre, veri zamanı ve firma kapsamını kullanır; sayı tutarlılığı sınanır. |
| F15 | P3 / L | Senaryo ve işlem iş akışları | Varsayım ayrımı; işlem bazlı yetki, parametre doğrulama, tekrar denemede çift işlemden korunma ve işlem geçmişi. Kaynak yazma ayrıca tasarlanıp yetkilendirilir. |

### Önerilen teslim sırası

**İlk teslim:** F01–F03 ve F04'ün temel zoom kısmı. Mevcut çalışan demo üzerinden gözle görülür iyileşme; veri anlamındaki bariz farkların giderilmesi.

**İkinci teslim:** F05–F07 ve F10. Yönetici özeti ile müşteri kartı, kullanıcının düzenleyip tekrar kullanabildiği örnek bileşenlere dönüştürülür. Bilanço/yaşlandırma/ABC için motor eksikleri ölçü haritasından çıkarılır; hepsi SQL'de sabit hesaplanarak filtre davranışı kaybedilmez.

**Üçüncü teslim:** F08–F09 ve F11–F14 içinden bir süreç pilotu. En güçlü iki aday müşteri 360° ve parti/kalite ekranı; ilkinde mevcut Demo verisine daha yakın, ikincisinde daha ayırt edici bir deneyim var.

DirectQuery, web'de düzenleme, çok kiracılılık ve ERP'ye yazma bu inceleme nedeniyle otomatik olarak uygulama kapsamına alınmış değildir. Buradaki gelecek önerileri, mevcut Import/Desktop/web görüntüleme sınırından ayrı değerlendirilmelidir.

## 10. Floemdata Analytics ile iş bölümü

Eski proje notlarındaki “agent/warehouse henüz yok” bilgisi incelenen Analytics sürümü için geçerli değil: bu klasörler ve Gold/uyarı kodu mevcut. `warehouse/gold/derleyici.py`, tanımlı ölçü/boyutlardan sorgu üretiyor; `warehouse/anomali/kurallar.py`, zaman serisi, anlık görüntü ve tutarlılık kontrollerini ayırıyor. Eksik geçmişte uyarıyı erteleme ve ayın bir kısmını tam ayla kıyaslamama yaklaşımı Floem için değerli.

Öneri: Analytics veri hazırlama, katalog ve uyarı kanıtını sağlasın; Floem BI semantik model, tasarım ve kullanıcı etkileşimini sunsun; Floemway yetkili kaynak bağlantısı ve yenilemeyi taşısın. Aynı iş ölçüsünün iki üründe farklı formülle tekrar tanımlanması önlenmeli. Önce katalog kimliği, tane düzeyi, birim, filtre sözleşmesi ve veri sürümü eşlemesi tasarlanmalı. Bu entegrasyonun bugün uçtan uca çalıştığı doğrulanmadı.

Başarı ölçütü yalnız yeni nesne sayısı değil: kullanıcı bir ekranı ne kadar çabuk kuruyor, farklı çözünürlükte ne kadar az düzeltme gerekiyor, sayının anlamını ne kadar kolay açıklıyor ve ilgili işe kaç adımda ulaşıyor.
