# Floem BI Belge Tasarımcısı

24 Kasım 2026 · Ürün ve geliştirme planı

## Desktop'ta bugün deneyebileceğiniz sürüm

**Aç → `data/Belge-Demo.floem`** ile hazır raporu açın. Dosya, tasarımcıda FAT-0200 faturasını seçer. Kendi açık raporunuzda aynı ekrana üst şeritteki **Belge Tasarımcısı** düğmesiyle geçebilirsiniz. **A4 önizleme** bütün kalemleri gerçek sayfalarda gösterir. **PDF indir** aynı çıktıyı kaydeder. Önizlemedeki yazıcı simgesi yazdırma penceresini açar.

**Fatura** ve **Teklif** ayrı şablonlardır. Sol panelde firma, başlık, PNG/JPEG logo, vurgu rengi, detay sütunları, depo/ürün gruplaması, ara toplam ve not düzenlenir. Sütunlar sürüklenerek veya ok düğmeleriyle sıralanır. **Ctrl+S** iki şablonu ve seçilen örnekleri `.floem` dosyasına yazar. Şablonlar biçim 2 arşivindeki `documentTemplates.json` dosyasında saklanır. Düzenleyici, açık yerel modelin anlık görüntüsünü okur.

| Kabul belgesi | PDF'deki kalem | Depo | A4 sayfa | Son sayfada tek genel toplam |
|---|---:|---:|---:|---:|
| FAT-0200 | 182 | 2 | 6 | 33.061,80 TL |
| TEK-0001 | 1 | 1 | 1 | 17,10 TL |
| TEK-0002 | 40 | 3 | 2 | 2.886,00 TL |
| TEK-0003 | 200 | 3 | 7 | 14.766,00 TL |

İlk sürüm aşağıdaki SAP B1 demo alanlarını kullanır. Sıradaki tasarım işleri başka modeller için elle alan eşleme, boş şablon ve nesneleri bant içinde milimetreyle konumlandırmadır. Web'de yetkili rapor satırından belge açma üçüncü aşamadadır.

Hazır raporu aynı kaynaktan yeni bir yola tekrar üretmek için depo kökünde aşağıdaki komutu kullanın.

```powershell
.\.venv\Scripts\python -m floem_bi.demo.belge_raporu data\SAPB1Demo-Belgeler.sqlite data\Belge-Demo-Yeni.floem
```

İlk kullanıcı hedefi, aynı Floem modelinden **satış faturası** ve **satış teklifi** için iki ayrı şablon hazırlamak. Kullanıcı logosunu, alanları ve toplamları yerleştirecek, örnek bir belge seçip kaç sayfa tuttuğunu görecek ve baskıya uygun PDF alacak. Bu tasarım yaklaşımı *bant tabanlı raporlama* (banded reporting), fiziksel sayfalara bölünen çıktı ise *sayfalandırılmış rapor* (paginated report) adıyla kullanılıyor. Arayüz için önerilen ad **Belge Tasarımcısı**. [SAP Crystal Reports 2025 kullanıcı kılavuzu](https://help.sap.com/doc/37c8938b12384f399940e22b7315979f/2025/en-US/cr2025_usergde_en.pdf) · [Microsoft Learn, sayfalandırılmış fatura ve formlar](https://learn.microsoft.com/en-us/power-bi/paginated-reports/report-design/create-invoices-forms-lists-report-builder)

## Güncel araçlardan alınacak tasarım kararları

| Araç | İncelenen özellik ve Floem BI için öneri |
|---|---|
| SAP Crystal Reports 2025 | Belge, sayfa, grup ve detay bölümlerinin basılma zamanları farklı. Floem'de her bandın yanında “her kalemde”, “grup değişince” veya “son sayfada” açıklaması gösterilsin. [SAP kullanıcı kılavuzu](https://help.sap.com/doc/37c8938b12384f399940e22b7315979f/2025/en-US/cr2025_usergde_en.pdf) |
| Power BI Report Builder | Serbest yerleşimli bir fatura formu her belge grubu için tekrarlanabiliyor. Grup başında veya sonunda sayfa kesmek ayrı bir ayar. Floem'de kullanıcı belge anahtarını seçsin ve grup için “yeni sayfadan başlat” seçeneğini görebilsin. [Fatura tasarımı](https://learn.microsoft.com/en-us/power-bi/paginated-reports/report-design/create-invoices-forms-lists-report-builder) · [Sayfa kesmeleri](https://learn.microsoft.com/en-us/power-bi/paginated-reports/report-design/control-page-breaks-headings-columns-rows-report-builder) |
| DevExpress Web Report Designer | Fatura örneğinde kullanıcı veri alanlarını tasarım yüzeyine sürüklüyor. Müşteri bilgileri, sipariş kalemleri ve tekrar eden başlıklar ayrı düzenleniyor. Floem'de “Miktar” alanını detaya bırakmak hem alan bağını kursun hem örnek değeri göstersin. [Web tasarımcısında fatura örneği](https://docs.devexpress.com/eud/eud-for-devexpress-reports/reporting-for-web/report-designer/create-reports/invoices) |
| pdfme | Boş sayfa üzerinde dinamik tablo büyüyüp sayfalara bölünüyor. Hazır PDF zemininde sayfalar sabit kalıyor. Floem'de boş A4 üzerinde akan belge ile matbu forma koordinatla baskıyı ayrı tasarım kararları olarak ele alalım. [Dinamik tablolar](https://pdfme.com/docs/tables) · [Üst ve alt bilgiler](https://pdfme.com/docs/headers-and-footers) |

## Kullanıcı ne tasarlayacak?

Desktop'ta **Ekle → Belge şablonu → Fatura / Teklif / Boş** öneriliyor. İlk adımda kullanıcı modelden belge başlığını, ilişkili satır tablosunu ve bir örnek belgeyi seçer. Düzenleyicide ortada mm cetvelli A4 sayfa, yanda model alanları ve seçili öğenin özellikleri bulunur. Alanları sürükleyebilir, bant içinde serbestçe taşıyabilir, hizalayabilir, yeniden boyutlandırabilir ve geri alabilir. **Tasarım** görünümünde tek örnek detay satırı düzenlenir. **Baskı önizleme** seçilen belgenin bütün kalemleriyle üretilmiş gerçek sayfaları gösterir.

| Tasarım bandı | Fatura örneği | Ne zaman basılır? |
|---|---|---|
| Belge başlığı | Logo, müşteri unvanı, fatura adresi | Belge başına bir kez |
| Sayfa üst bilgisi | Belge numarası ve tarih | Her fiziksel sayfada |
| Sütun başlıkları | Kod, açıklama, miktar, fiyat, tutar | Kalem listesinin başladığı ve devam ettiği sayfalarda |
| Grup başlığı | Ürün grubu veya proje adı | Seçilen grup değişince |
| Detay | Bir malzeme veya hizmet kalemi | Her kaynak satırı için bir kez |
| Grup alt bilgisi | O grubun ara toplamı | Grubun son kaleminden sonra |
| Belge alt bilgisi | İskonto, vergi ve genel toplam | Son detaydan sonra, belge başına bir kez |
| Sayfa alt bilgisi | İletişim ve “Sayfa 2 / 3” | Her sayfanın altında |

Teklif şablonunda aynı bantlarla **geçerlilik tarihi, teslim ve ödeme koşulları, teklif notu, imza/onay alanı** tasarlanır. Kullanıcı koşul metnini genişlettiğinde sonraki bölüm aşağı kayar. İlk nesneler metin, model alanı, sayı/tarih, resim/logo, çizgi, dikdörtgen, kalem sütunu ve sayfa numarasıdır. Bant ayarları boşken gizleme, içerikle büyüme, grup başlığını ilk kalemle tutma ve grup ara toplamını gösterebilmedir.

## Floem BI'a nasıl eklenir?

| Mevcut dayanak | Planlanan geliştirme |
|---|---|
| [Desktop tasarımcısı](../packages/designer/src/ReportDesigner.tsx) alan paneli, seçim, hizalama ve geri alma içeriyor. | Belge düzenleyicisi aynı etkileşimleri kullanır. Bantların içinde mm cinsinden konumlar saklanır. Ayrıntı satırları çoğaldıkça alttaki bantların başlangıcını sayfalama motoru belirler. |
| [.floem arşivi](../src/floem_bi/document/floemfile.py) ve [belge şablonu tanımı](../packages/client/src/printForms.ts) | Şablonlar arşivde ayrı bir `documentTemplates.json` girdisinde saklanır. Böylece rapor görsellerini düzenleyen bir kayıt işlemi şablonları korur. Eski dosya boş şablon listesiyle açılır. Şablon içeren rapor biçim 2 olarak kaydedilir. |
| [Sorgu motoru](../src/floem_bi/report/query.py) alanları, filtreleri ve FDX ölçülerini çözüyor. [Yayımlanmış rapor ve App sorguları](../src/floem_bi/server/app.py) kullanıcı yetkisini ve RLS'yi uyguluyor. | Aynı güvenlik ve model bağlamında tek belgenin başlığını, sıralı kaynak satırlarını ve toplamlarını getiren belge sorgusu eklenir. Seçici, önizleme ve PDF aynı yetkili veri sürümünü kullanır. Baskı sürerken sürüm değişirse yeniden önizleme istenir. |
| [Satır eylemi](../packages/report/src/visualActions.ts) bugün seçili hücrenin değerini taşıyor. | **Belgeyi aç** eylemi şablonu ve tam belge anahtarını taşır. Tekil birleşik anahtar varsa doğrudan kullanılır. Firma, belge türü ve iç numara ayrı sütunlardaysa alanların birlikte eşlenmesi gerekir. Ürün filtresi faturayı bulmaya yardım eder. Baskıda seçili faturanın bütün yetkili kalemleri alınır. Kapsamı eksik bir belge tam fatura olarak üretilmez. |
| [PDF aktarımı](../packages/report/src/tablePdf.ts) pdfmake 0.3.14, gömülü Türkçe font, tekrarlı sütun başlığı ve sayfa numarası kullanıyor. [Büyük tablo aktarımının](f09-buyuk-grid-ve-aktarim.md) kendi grup sınırları var. | Ayrı bir belge üreticisi aynı PDF altyapısını kullanır. Önce fiziksel ölçü, satır akışı ve grup kuralları sınanır. Önizleme, indirme ve yazdırma aynı üretilmiş PDF'yi kullanır. Eksik satırlı PDF indirmesi engellenir ve sorunlu alan/bant tasarımda gösterilir. pdfmake'in yerel paket lisansı MIT, kullanılan Roboto fontları Apache-2.0'dır. [pdfmake 0.3 belgeleri](https://pdfmake.github.io/docs/0.3/) · [Floem font kaydı](../packages/report/src/fonts/README.md) |

**Veri doğruluğu.** SAP Business One için örnek eşleme satış faturasında `OINV → INV1`, satış teklifinde `OQUT → QUT1`. Kullanıcı ekranda belge numarasını görür. Eşleme firma ve belge türü kapsamında `DocEntry`, kalem kimliği için ayrıca `LineNum` kullanır. Aynı ürün iki satırdaysa ikisi de basılır. Başlıktaki belge toplamı bir kez okunur. Grup ara toplamı, grubun satırlarından veya aynı kapsamda hesaplanan FDX ölçüsünden gelir. Vergi, iskonto, para birimi ve yuvarlama için kaynak belgenin kayıtlı tutarlarıyla karşılaştırma yapılır. Diğer modeller aynı alan rollerine eşlenebilir. [SAP fatura kalemleri](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKHelp/inv1.html) · [SAP teklif kalemleri](https://help.sap.com/doc/089315d8d0f8475a9fc84fb919b501a3/10.0/en-US/SDKhelp/QUT1.html)

**Sürüm ve yetki.** Modelde bir sütun yeniden adlandırılınca şablondaki bağı da güncellenir. Silinen bir alan için tasarımcı, alanı ve bandı gösterip yeniden eşleme ister. Yayımlanmış bir Floem uygulamasından belge açıldığında o uygulamanın yayımlanmış şablonu kullanılır. Kaynak satırlar ve belge toplamı için aynı yetki denetimi uygulanır. Farklı yetkili kullanıcıların çıktı önbelleği paylaşılmaz.

## İlk denemenin veri kaynağı

Desktop'ta **Veri al → SQLite dosyası** seçilir ve yerel `data/SAPB1Demo-Belgeler.sqlite` dosyasının tam yolu girilir. Dört tablo birlikte yüklenir. Faturalar `OINV.DocEntry → INV1.DocEntry`, örnek teklifler `OQUT.TeklifDocEntry → QUT1.TeklifDocEntry` ile eşlenir. Sentetik teklif anahtarının adı, Desktop'ın ada göre ilişki algılarken faturaya da bağlamasını önler. Görünen belge numarası `DocNum`, detay sırası `LineNum`, grup alanı `WhsCode` ve vergi öncesi satır tutarı `LineTotal` alanıdır.

Power BI demosundaki `tmp/ham/Firma1.sqlite`, maskelemeden önce alınmış fatura verisini içerir. [Yerel örnek üreticisi](../src/floem_bi/demo/belge_sqlite.py) bu dosyayı salt okunur açar. Fatura başına satır sayısını, aynı ürünün tekrarlanmasını, müşteriye ve depoya göre gruplanmayı ve boş ürün/depo alanlarını korur. Belge numaraları, kodlar, adlar, adresler, tarihler ve tutarlar örnek için üretilir. Kaynaktaki 409 faturadan 2.225 örnek kalem elde edildi. Kaynakta teklif tabloları bulunmadığından üç sentetik teklif eklendi. Dosya yalnız yerel `data/` klasöründe tutulur. Aynı makinede yeni bir kopya üretme komutu aşağıdadır. Çıktı dosya adının boşta olması gerekir.

```powershell
.\.venv\Scripts\python -m floem_bi.demo.belge_sqlite "..\powerbi-main\tmp\ham\Firma1.sqlite" "data\SAPB1Demo-Belgeler.sqlite"
```

| Belge | Neyi sınar? | SQLite dosyasında doğrulanan değer |
|---|---|---|
| FAT-0200 | Uzun fatura, tekrarlayan ürün, iki depo | 182 satır, vergi dâhil 33.061,80 TL |
| TEK-0001 | Tek satırda başlık, detay ve toplam | 1 satır, vergi dâhil 17,10 TL |
| TEK-0002 | Depo ara toplamları ve sayfa geçişi | 40 satır. Üç deponun net tutarı sırasıyla 834,75 TL, 774,50 TL ve 795,75 TL. Vergi dâhil toplam 2.886,00 TL |
| TEK-0003 | Birden fazla sayfaya yayılan teklif | 200 satır, vergi dâhil 14.766,00 TL |

Desktop'ın içe aktarma servisinde dört tablonun satır sayıları, iki etkin başlık–detay ilişkisi ve tablo önizlemeleri doğrulandı. SQLite'ta 412 belgenin her birinde kalemlerden hesaplanan vergi ve genel toplam başlıkla kuruş düzeyinde eşleşti. Örnekte tarihler ISO biçiminde metindir. Desktop modelinde tarih biçimlendirmesini denemek için `DocDate` ve `DocDueDate` alanları Tarih tipine dönüştürülür.

## Geliştirme ve kullanıcı testi sırası

| Sıra | Teslim | Bittiğini nasıl anlayacağız? |
|---|---|---|
| 1 | **Belge ve baskı denemesi tamamlandı.** FAT-0200 ve üç teklifin PDF'leri Desktop'tan indirildi. | PDF'den okunan bütün kalem kimlikleri, satır tutarları, depo ara toplamları, vergi ve son sayfadaki genel toplam SQLite ile karşılaştırıldı. |
| 2 | **İlk kullanılabilir Desktop tasarımcısı.** İki hazır şablon ve boş şablon, sürükle-bırak, bantlar, gruplama/sıralama, biçimlendirme, logo, önizleme, PDF ve kaydet/aç. | Kullanıcı yardım almadan logosunu değiştirir, depoya göre grup ve ara toplam ekler, teklif koşulunu düzenler ve iki PDF'yi alır. Dosyayı kapatıp açınca yaptığı düzen korunur. **İlk kullanıcı denemesi bu aşamada yapılır.** |
| 3 | **Raporla bütünleşme ve web çıktısı.** Fatura satırından ilgili şablonu açma, mevcut yayımlama ile taşıma, tarayıcıdan önizleme/indirme/yazdırma. | Desktop ve web'de aynı şablon/veri sürümü aynı sayfa sayısını ve toplamı verir. İki firmada numarası aynı olan faturalar karışmaz. Yetkisiz kullanıcı alanları, belgeyi ve PDF'yi açamaz. |
| 4 | **Kullanım sonucuna göre genişletme.** İç içe gruplar, matbu form/PDF üzerine koordinatla baskı, toplu belge çıktısı, barkod/QR, etiket ve irsaliye adayları. | Önceliği ilk denemede işi durduran veya elle düzeltme gerektiren adımlar belirler. Matbu baskı seçilirse gerçek yazıcıda %100 ölçekte alan eşleşmesi ayrıca denenir. |

**Baskı kabulü.** Uzun Türkçe açıklama ve adres, boş isteğe bağlı alan, farklı para birimi, boş kalem listesi ve sayfanın dibinde başlayan grup test edilir. Bir gruplama başlığı sonraki kalem olmadan sayfa sonunda kalmamalı. Tek kalem bir sayfadan uzunsa devamı anlaşılır biçimde sonraki sayfaya taşınmalı. 200 kalemli örnekte PDF'den okunan satır anahtarları ve tutarları kaynakla karşılaştırılmalı. Tasarımcı taşan nesneyi baskıdan önce işaretlemeli.

Kullanıcı TEK-0002 şablonunda sütunları taşıdığında veya kalemler ikinci sayfaya aktığında yukarıdaki üç ara toplam ve tek belge toplamı korunmalı. Bu ilk SQLite dosyasında para birimi TRY ve örnek vergi oranı %20. Kur, iskonto ve boş belge senaryoları ayrıca sınanacak.

**Başlangıç önerisi.** İlk tasarım boş A4 üzerine, logonun ve antetin Floem BI içinde düzenlendiği biçimde hazırlanır. Önceden basılı kâğıt veya hazır PDF antet ilk kullanım için gerekliyse arka plan ile mm tabanlı kalibrasyon 1. ve 2. aşamaya alınır. Bu çalışma kayıtlı faturanın veya teklifin baskı görünümünü üretir. Resmî elektronik belge düzenleme ve gönderme ayrı bir entegrasyon kararıdır. Üretim ortamının saha kabulü mevcut plandaki son aşamada kalır.
