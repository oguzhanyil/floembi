# Desktop'ta Power BI dosyası açma

Desktop **Aç / Ctrl+O** artık `.floem`, `.pbip`, `.pbib`, `.pbix` ve
`definition.pbir` dosyalarını seçer. Power BI'ın proje uzantısı `.pbip`tir;
kullanıcının belirttiği `.pbib` aynı içerik için alternatif uzantı olarak kabul edilir.
`.Report` klasörü servis API'sinden de açılabilir. Birden fazla rapor içeren
projede ilgili `.Report/definition.pbir` seçilmelidir.

Power BI kaynağı değişmez. Düzenlenebilir yeni belge kaydedilmemiş olarak açılır;
**Ctrl+S** ile ayrı `.floem` dosyası oluşturulur. Paketli uygulamanın komut satırı
dosya argümanı da bu biçimleri alır; Windows'un Power BI varsayılan dosya
ilişkilendirmesi değiştirilmez. Geliştirme sürümünde dosya seçiciyi yenilemek
için Desktop tamamen kapatılıp `npm run desktop` ile yeniden açılmalıdır.

Kaynak projelerden dönüştürülen dosyalar ve Power BI ile ölçü karşılaştırması
için [FDX kabul belgesine](f06-kaynak-rapor-kabulu.md) bakın.

## Neler alınır?

| Kaynak | Yerleşim | Model | Veri |
|---|---|---|---|
| PBIP / PBIB / PBIR | PBIR `definition` veya eski `report.json` | Yanındaki TMDL veya BIM | Varsa `.SemanticModel/.pbi/cache.abf` |
| PBIX | PBIR veya eski `Report/Layout` | Okunabilen gömülü model | Okunabilen `DataModel` anlık görüntüsü |
| Canlı bağlantılı, önbelleksiz veya model sürümü okunamayan dosya | Desteklenen yerleşim | Erişilebilen metadata / açık taslaklar | Boş; aktarım raporunda neden gösterilir |

PBIP dosyasını yanındaki `.Report` ve `.SemanticModel` klasörleriyle birlikte
taşıyın. Yalnız `.pbip` dosyası tüm raporu içermez. Önbellek projede bulunmayabilir;
Microsoft da `.pbi/cache.abf` dosyasını yerel veri önbelleği olarak tanımlar.
[Microsoft PBIP semantik model dosyaları](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-dataset).

Tablolar/sütunlar, ölçü ifadeleri, desteklenen tek yönlü ilişkiler, sayfalar,
alan eşlemeleri, desteklenen görseller ve gömülü resimler alınır. Eski Layout
alan takma adları ve toplama türleri ortak PBIR okuyucusuna çevrilir. Yalnız ölçü
içeren tablolar da korunur. Gömülü hesaplanmış sütunlar okunabildiğinde fiziksel
anlık değer olarak saklanır; yeniden hesaplandığı iddia edilmez.

**Power BI aktarım raporu** satır/tablo/ölçü/ilişki sayılarını, alınamayan tabloyu,
uyarlama isteyen FDX ölçüsünü ve mevcut görsel uyumluluk bulgularını gösterir.
Özgün ölçü formülleri korunur; motorun derleyemediği ifadeler ayrıca listelenir.
Desteklenmeyen özel görsel kodu çalıştırılmaz. Filtreler, biçimler, bookmark'lar,
Power BI etkileşimleri ve hesaplar için tam eşdeğerlik garantisi yoktur; rapor
bulguları ve gerçek sonuç karşılaştırmasıyla kabul yapılır. F06 mutabakatı açıktır.

Kaynak SQL/M sorguları ve bağlantı kimlik bilgileri yeni modele taşınmaz veya
çalıştırılmaz; kaynak sunucuya bağlanılmaz. Veri bir anlık görüntüdür. Yenileme
için normal Floem bağlantısı ve alan eşlemesi ayrıca yapılandırılmalıdır.

## Yerleşim ve başlangıçta gizli katmanlar

Eski PBIX Layout'ta nesnenin masaüstü düzeni (`layouts.id=0`), kaynak piksel
konumu/boyutu ve katman sırası kullanılır. Telefon düzeninin dizide önce gelmesi
masaüstü nesnelerini o konumlara taşımaz. `display.mode=hidden` nesnesi
silinmez; tasarımda ve izleyicide başlangıçta saklanır. **Biçim → Katmanlar**
listesinden seçilince düzenlenebilir; **Başlangıçta gizle** kaldırılırsa görünür olur.

Gömülü temel/özel paletin sabit renkleri ve tonları, arka plan saydamlığı ve
yuvarlak köşeler taşınır. Dolgu tanımı olmayan ikonlu düğme saydam kalır;
görsel çerçevesi arkasındaki nesneyi beyaz kutuyla kapatmaz. Yeni `cardVisual`
`Data` alanları, birden çok değer ve satır grubu yerel kartlara eşlenir.
Desteklenen ikonlu düğmelerde ikon üstte/solda ve kaynak boyutuyla çizilir.

Yerel Dashboard dosyasında 7 sayfa / 179 nesnenin dikdörtgeni kaynakla aynı
bulundu; gerçek Desktop DOM'unda 154 görünür nesne ve 25 gizli katman doğrulandı.
Bu kontrol büyük DataModel'i tekrar içeri almadan yapıldı; veri/hesap eşdeğerliği
iddiası değildir. Bookmark seçimi, hover durumları, kartların bütün iç yerleşimleri
ve her Power BI grafik türü birebir taşınmaz. Bulgular aktarım raporunda kalır.
Yeni dönüşüm için güncel Desktop'ı açıp orijinal PBIX'i tekrar seçin.

İç içe gruplar da yerel serbest grup kapsayıcıları olarak alınır. Alt nesnenin
koordinatı kendi grubuna aittir; ortak motor üst grupları ekleyerek sayfa konumunu
hesaplar. Üst grup gizliyse alt nesneler tasarım ve izleyicide gizli kalır;
Katmanlar'dan seçilerek düzenlenebilir. Grup modu `0` dışındaki kaynak modlar
eşdeğer kabul edilmez; bulgu kaydı bırakılır. Eksik/döngülü üst grup reddedilir.

Gömülü sayfa arka plan resmi PNG/JPEG/WebP/SVG veri URI'si olarak korunur;
resim 2 MB, kodlanmış sayfa alanı 2,8 milyon karakterle sınırlıdır. Resmin
saydamlığı ayrı bir alt katmandadır; rapor nesneleri saydamlaşmaz. İçerik ayrı
nesnelere bölünmez. Kaynak Fit/Fill gösterimi contain/cover olarak alınır;
Normal için contain kullanılır (incelenen HITInsights SVG'si sayfayla aynı
1280×720 boyutunda olduğundan ölçek farkı yoktur). Uzak URL kabul edilmez.

HITInsights kabulü: 9 sayfa, 39 grup, 113 üst grup bağlantısı; 145 görünür ve
17 etkin gizli hedef nesne. Kaynak göreli/mutlak geometri ve gerçek Desktop DOM'u
karşılaştırıldı. Ayrı okuyucu gerçek dosyadan 734.680 satır aldı. Yeni verili
dosya `data/HITInsights-B1-NMT-Floem.floem`; 48 ölçünün 29'u uyarlama istiyor.
Bu sonuç tam hesap eşdeğerliği değildir; özel görsel ve bookmark bulguları sürer.

Aktarım raporu indirilirken tablo/ölçü adları içerdiğini göz önünde bulundurun.

Kaynak RLS/OLS rolleri varsa, kurallar birebir çevrilmiş sayılmaz: Floem rolleri
bütün tablolar için `1 = 0` ile kapalı oluşturulur. Güvenlik metadatası okunamayan
gömülü modelde de kapalı inceleme rolü oluşturulur. Yayımlamadan önce kuralları
uyarlayın, kullanıcı üyeliklerini atayın ve **Farklı görüntüle** ile doğrulayın.
Kaynak kullanıcı üyelikleri otomatik alınmaz; Desktop sahibi model verisini görebilir.

## Hata ve kaynak sınırları

Okuyucu ayrı süreçte çalışır; hata halinde açık eski rapor korunur. Arayüz açılış
sırasında bekleme katmanı gösterir; eski editör değişiklikleri önce tamamlanır.
Zaman aşımı/okuyucu çökmesi uygulamayı beyaz ekrana düşürmez.

- Dosya/bileşen en fazla 2 GB, Windows okuyucu süreci 2 GB RAM, aktarım 240 saniye.
- Geçici alan 4 GB; yerleşim 256 MB, JSON dosyası 64 MB ve 20.000 arşiv girdisi.
- Tablo başına 10 milyon satır / 1 GB çözülmüş Arrow verisi. Bir tablo okunamaz,
  şeması uyuşmaz veya sınırı aşarsa o tablonun bütün aktarılmış satırları silinir;
  eksik veriyle doğruymuş gibi toplam gösterilmez. Diğer tablolar için kısmi durum açıklanır.
- Proje dışına çıkan dosya başvuruları, arşiv yol aşımı ve şifreli girdiler reddedilir.
- Ayrı süreç zaman/disk sınırı tüm platformlarda; Job Object RAM ve üst süreç
  kapanışı sınırı Windows'tadır. Bu okuyucu bir işletim sistemi güvenlik sandbox'ı değildir.

## Lisans ve dağıtım kaydı — 23.11.2026

Kullanıcı bu görüşmede **“Bu paketler için istisnayı onaylıyorum”** yanıtıyla,
PBIX gömülü verisi için NumPy Windows paketindeki Zlib/CC0 ve GPL + GCC Runtime
Exception bileşenlerini onayladı. Genel GPL/AGPL yasağı sürer. Araştırma
klonundan kod kopyalanmadı veya paket kurulmadı; yayımlanmış PyPI dağıtımı kullanıldı.

| Doğrulanan dağıtım | Lisans / seçilen alternatif |
|---|---|
| PBIXRay 0.15.5 | [MIT](https://github.com/Hugoberry/pbixray/blob/main/LICENSE) |
| xpress8 0.1.1 | [MIT; ESE bildirimi dahil](https://github.com/Hugoberry/xpress8-python/blob/main/LICENSE) |
| xpress9 0.3.9 | [MIT](https://github.com/Hugoberry/xpress9-python/blob/main/LICENSE) |
| xmhuffman 0.3.2 | [MIT](https://github.com/Hugoberry/xmhuffman-cython/blob/main/LICENSE) |
| kaitaistruct 0.11 | [MIT](https://github.com/kaitai-io/kaitai_struct_python_runtime/blob/master/LICENSE) |
| APSW 3.54.1.0 | [OSI alternatifleri arasından MIT seçildi](https://github.com/rogerbinns/apsw/blob/master/LICENSE) |
| NumPy 2.5.5 Windows wheel | BSD-3 / 0BSD / MIT + Zlib / CC0; beraberindeki GCC çalışma zamanı için GPL + GCC Runtime Exception, kullanıcı istisnası kapsamında |
| pandas 3.1.1 | [BSD-3](https://github.com/pandas-dev/pandas/blob/main/LICENSE) |
| python-dateutil 4.0.0 | [BSD-3 alternatifi](https://github.com/dateutil/dateutil/blob/master/LICENSE) |
| tzdata 2026.6 | [Apache-2.0 ve veri bildirimleri](https://github.com/python/tzdata/blob/master/LICENSE) |

Sadece ana NumPy deposunun BSD lisansı yeterli kabul edilmedi; kurulu Windows
wheel içindeki `numpy-*.dist-info/licenses/LICENSE.txt` de incelendi.
`packaging/floem-service.spec` PBIXRay'in geçişli dağıtım metadatasını
`copy_metadata(..., recursive=True)` ile pakete alır; lisans ve çalışma zamanı
istisnası metinleri değiştirilmeden korunur. APSW için seçilen MIT metni
[dağıtım bildirimleriyle](../packaging/POWERBI-THIRD-PARTY-NOTICES.txt) pakete alınır.

Sürüm/yeni platform paketi değişince dağıtım lisansları tekrar incelenmelidir.

## Doğrulama

`tests/test_powerbi_open.py` proje ve eski PBIX yerleşimi, orijinal ölçülerin
korunması, bağlantı taşınmaması, kapalı roller, yol sınırları, bozuk dosyada açık
raporun korunması, başlangıç dosyası, tablo kısmi veri geri alma ve zaman aşımını
kapsar. Yerel açık PBIXRay test korpusu varsa gerçek gömülü satır/sorgu ve `.floem`
tekrar açma testi de çalışır. Korpus yoksa yalnız bu test açıkça atlanır.

Bu makinede gerçek dosya kontrolü: `abc.pbix` 9 satır; açık örnek Supplier Quality
5 sayfa / 10 tablo / 9.026 satır; kullanıcının yerel `SAPB1Demo.pbip` projesi
18 sayfa / 28 tablo / 542.926 satır. Son projede 135 ölçünün 116'sı FDX uyarlaması
gerektirdi. Bu sayılar aktarım kontrolüdür, hesap mutabakatı değildir. Kullanıcı
dosyaları/verileri ve QA çıktıları Git'e eklenmez.

`node tests/ui/run-powerbi-desktop.mjs` üretim Desktop App'ini gerçek yerel
servis/ayrı okuyucu ile Chromium'da sınar: PBIX kartı 45, tablo 6 satır, toplam
9 gömülü satır, `.floem` kaydı, bozuk dosyada eski raporun korunması, önbelleksiz
PBIP bildirimi ve tablosuz metin raporu. Yalnız Electron dosya seçici köprüsü
test çiftidir; Windows yerel dosya penceresinin elle kabulü ayrıca yapılabilir.
Paketlenmiş Windows `floem-service.exe --powerbi-worker` çıktısı da yeniden
açılarak 9 satır doğrulandı. Yerel kullanıcı projesinin dönüştürülmüş kopyası
`data/PowerBI-SAPB1Demo-Imported.floem` içindedir.

Son genel koşu: **385 Python geçti / 1 atlandı, 87 saf TS kontrolü**, 33 nesneli
tam Chromium turu, typecheck ve Desktop/web/Windows servis derlemeleri geçti.
Paketli ana servis üzerinden açma isteği de ayrı paketli okuyucuyu başlatarak
9 satırlık yeni belge döndürdü; üçüncü taraf lisans dosyalarının pakette olduğu
kontrol edildi. QA kayıtları `data/qa-powerbi/` altındadır. Kullanıcının 8800/8765
servisleri veya kaynak veritabanı kullanılmadı.
