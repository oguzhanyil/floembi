# F12 · Müşteri 360° ve parti/kalite süreç pilotları

20.11.2026. İki süreç için düzenlenebilir rapor, ortak gezinme ve iki yeni yerel
nesne hazır. Pilot veri **tamamen sentetiktir**; kaynak SAP/Power BI sonuç mutabakatı
ve gerçek kullanıcı kabulü tamamlanmış sayılmaz. F06-2–5 açıktır.

## Deneme

1. Desktop'ı `npm run desktop` ile açın; **Aç / Ctrl+O** ile
   `data/F12-Surec-Pilotlari.floem` dosyasını seçin.
2. **Etkileşimi dene** simgesini açın. Müşteri çalışma alanında firma ve dönem seçin;
   müşteri satırındaki **İncele** düğmesine basın. Müşteri 360° içindeki olay satırından
   belge ayrıntısına geçin. İki kez **Geri dön** yapınca önceki kapsam ve seçimler gelir.
   Detay sekmesine doğrudan girildiğinde kart/tablo, kayıt seçmenizi ister; toplamı
   seçili müşteri veya parti gibi göstermez.
3. **Parti ve kalite çalışma alanı** düğmesine basın. Örneğin `F1:U1` satırını inceleyin.
   Ana parti miktarı **700 kg**, sınır dışı ölçüm **1**, eksik/kararsız ölçüm **1**'dir.
4. Grafikte bir düğüme basın: yalnız bağlantı nesnesinin kökü değişir. **Parti geri**
   önceki düğüme, **İlk parti** listeden seçilen köke döner. Kalite kartları ve kayıtları
   **listeden seçilen ilk partiye** aittir; başka partinin kalitesi için listeye dönün.
5. **Kalite kayıtlarını aç** ile ölçüm satırlarını görün. Web için dosyayı normal
   yayımlama akışıyla yayımlayın; altı sayfa ve gömülü veri birlikte taşınır.
   Önceden yayımlanmış raporlar bu yerel geliştirmeyle kendiliğinden güncellenmez.

Telefon yerleşimleri dosyada kayıtlıdır. Web görünümü 620 px ve altında 390 px
tasarımını seçer; ana düzen ayrıca seçilebilir. Uzun etiketler sarılır veya araç
ipucuyla kısaltılır. Ağın yatay kaydırması ve çok satırlı kalite listesinin kendi
kaydırması veri gezinmesi içindir; sayfa dışına taşma gerektirmez.

Dosya yoksa **yeni bir hedef adıyla** yeniden üretin; var olan dosya üzerine yazılmaz:

```powershell
.venv\Scripts\python -m floem_bi.process_demo data\F12-Yeni.floem
```

## Gezinme sözleşmesi

**Biçim → Eylem → Sayfaya git → Firma, dönem ve seçim filtrelerini koru** seçeneği,
sayfanın devraldığı koşulları, kaynak nesne filtrelerini, dilimleyicileri, çapraz seçimi
ve satır anahtarını birlikte taşır. Aynı alanın farklı koşulları kesişir; mevcut kapsam
genişletilmez. Hedefteki firma/dönem dilimleyicisinin eski varsayılanı taşınan seçimle
uyumlanır. Bu yeni seçenek açılmayan eski düğmelerin filtre davranışı korunur.

**Geçmişte geri dön** düğme eylemi ve üstteki **Geri** en fazla 20 sayfa geçişini
oturumda tutar. Sayfa, filtre, çapraz seçim, dilimleyici ve gizlenen nesneler geri
yüklenir. Sekmeye basmak, filtre sıfırlamak veya seçimi temizlemek geçmişi kapatır.
Önizlemedeki gezinme rapor tanımını değiştirmez ve kaydetme başlatmaz. Geçmiş,
arama metni/açık tablo dalları gibi nesne içi geçici durumları kapsamaz.

## Müşteri hesapları

Model 12 tablo, 14 ilişki (13 aktif), 15 FDX ölçüsü ve iki firma içerir. Aynı müşteri
adı ve kodu farklı firmalarda ayrı anahtardır. Belgeler, satış satırları, cari hareket,
iş/fırsat değişimleri ve olaylar ayrı kayıt tanelerinde tutulur. İki satış satırı bir
faturadır; olgular birbirine birleştirilerek tutarlar çoğaltılmaz.

Satış ve tahsilat seçili dönemin **hareketidir**. Bakiye, vadesi geçmiş net kalem,
açık iş ve fırsat seçili dönemin son günündeki **durumdur**; dönem öncesi kayıtlar
korunur, gelecek kayıtlar dışlanır. Çoklu/ayrık dönem seçiminde durum göstergesi
seçimin en son gününü kullanır. Tahsilat yalnız tahsilat türüdür; iade tahsilat değildir.
Vade göstergesi, vadesi son günden önce olan net borç/alacak kalemleridir; gerçek
ERP kapatma/eşleştirme, yaşlandırma, kur, vergi ve kredi limiti hesabı değildir.

`F1:C001`, Şubat 2026 için bağımsız referans:

| Gösterge | Beklenen |
|---|---:|
| Net satış / belge adedi | 180 / 2 |
| Açılış / dönem hareketi / kapanış | 250 / 100 / 350 |
| Vadesi geçmiş net kalem / tahsilat | 170 / 80 |
| Açık takip işi / açık fırsat | 1 / 500 |

`F2:C001` parasal değerleri on katıdır; firma yetkisiyle F1'e karışmaz. C002'nin
Şubat'ta kapanan işi sıfırdır. C006'nın hareketi yoktur; eksik hesap sıfır diye üretilmez.

## Parti bağlantıları nesnesi

Görselleştirmelerden **Parti bağlantıları** ekleyin. Gruplama alanlarının sırası:
kaynak anahtar, hedef anahtar, kaynak adı, hedef adı, birim, ilişki türü. İlk iki alan
zorunludur. Gösterge kuyusuna **kök parti anahtarı**, değere isteğe bağlı bağlantı
miktarı gelir. Firma ile birlikte tekil bir anahtar kullanın; pilotta `F1:U1` biçimindedir.
Kök seçiminde tam bir parti bulunmalıdır; aksi halde seçim istemi görünür.

**Biçim → Parti inceleme kapsamı** bölümünde üst/alt/iki yön, adım (1–4), düğüm (5–100)
ve bağlantı (5–200) sınırları ayarlanır. Varsayılan 2 adım, 40 düğüm, 80 bağlantıdır.
Her adımda yalnız sınırdaki düğümler sorgulanır; tüm yollar önceden üretilmez.
Kök alanındaki filtre yürüyüş başlangıcıdır; komşu sorgularında bu koşul kaldırılır,
firma/dönem ve diğer koşullar korunur. Nesneyi tümüyle tek partiye daraltan ayrı bir
filtre tablosu kullanılırsa komşular da daralabilir; kök alanını doğru eşleyin.

Yüklenen ağda çevrimler ve birleşen yollar ↻ ile işaretlenir. Tekrar görülen kenarın
miktarı tekrar eklenmez; farklı birim/ilişki grupları ayrı kalır. Aynı kaynak/hedef,
ad, birim ve ilişki grubundaki kaynak satırları seçilen ölçüyle gruplanır; bu görünüm
tek tek ham bağlantı olaylarının listesi değildir. Sınırda uyarı çıkar;
görünen altgraf tüm ağın kapsandığını garanti etmez. Ok yönü bir ilişkinin yönüdür,
fiziksel dağıtım veya kütle dengesi kanıtı değildir. Ana üretim miktarı tekil parti
tablosundan gelir; kg ve adet karışıkken toplam boş bırakılır.

Kök ve komşu sorguları aynı veri/yetki anlık görüntüsüne bağlanır. Veri veya erişim
kapsamı değişirse ağ birleştirilmez; yeniden deneme istenir. Her sorguda sunucu
RLS'si uygulanır. Ölçüsüz anahtar/alan listeleri de ilişkili boyut filtrelerini ve RLS'yi
izler; bu aşamada derleyicideki eksik yol düzeltildi. Sağ tık aktarımı yalnız **yüklenmiş
bağlantı satırlarını** verir; bütün grafı indirdiği iddiasında bulunmaz.

## Tolerans nesnesi

Görselleştirmelerden **Kalite toleransı** ekleyin. Gruplamaya tekil ölçüm kimliği,
test adı ve birim; değerlere sırasıyla **ölçülen değer, alt sınır, üst sınır**, isteğe
bağlı **hedef** koyun. Aynı ölçümün tekrarları bir grupta ortalamaya dönüşmemelidir.
Sınır değerler dahildir. Boş, sayısal olmayan veya ters alt–üst sınırda karar
**Doğrulanamadı** olur; uygun olarak işaretlenmez. Renk yanında simge ve metin de vardır.

Tek sorguda en çok 100 ölçüm gösterilir; kesilme açıkça bildirilir. Sorgu sınırları
ve kayıt tanesi F13 denetçisinde de açıklanır. Nesne bir SPC/kontrol grafiği veya
istatistiksel süreç yeterlilik hesabı değildir; mühendislik kabul sınırını gösterir.

## Doğrulama ve sonraki aşama

Python kontrolleri bağımsız SQL mutabakatı, dönem/stok ayrımı, iade, iki satırlı fatura,
aynı ad/kod, boş müşteri, parti tanesi/birim, eksik/sınırdaki kalite, ölçüsüz RLS,
anlık görüntü değişimi, dosyanın yeniden açılması ve geçici sunucuda yayımlamayı kapsar.
Saf TypeScript kontrolleri filtre kesişimi/geçmiş, altgraf yönü/sınırı, çevrim/elmas,
tipli kimlik ve tolerans kararını sınar. Chromium testleri web/Desktop önizlemesinde
iki adımlı geri dönüş, hedef dilimleyici, parti yürüyüşü ve sürüm hatasını dener.
Yerel gerçek `.floem` + DuckDB koşusunda altı sayfalı akış ve telefon düzeni kontrol edilir.
Günlük ve ekran görüntüleri git dışında `data/qa-f12/` altındadır.

Son koşu: **316 Python geçti, 1 atlandı; 78 saf TypeScript kontrolü**, tam Chromium
arayüz turu, typecheck ve Desktop/web üretim derlemeleri geçti. Yeni nesneler dahil
31 nesnenin ortak sağ tık menüsü ve veri aktarım seçenekleri de kontrol edildi.

F12 teslimini izleyen **F14'ün BI tarafı ve yerel pilotu hazır**; [kapsam ve canlı
Analytics kabulünde kalanlar](f14-ortak-olcu-ve-uyarilar.md). [F15 senaryo ve öneri akışı](f15-senaryo-ve-oneriler.md)
da hazır; sırada gerçek süreç/kullanıcı kabulü var. F12'nin gerçek kaynak
bağlantısı ve kullanıcı kabulü, F06 ölçü mutabakatına bağlı açık kabul maddeleridir.
Bu pilotlar sipariş/fırsat hunisi, stok yaşlandırma veya yetkili ERP işlem iş akışının
tam uygulaması değildir; F15 kaynak yazma işlerini ayrıca ele alır.
