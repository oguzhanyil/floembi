# Floem BI (MVP: semantik çekirdek)

Floem BI, Floemdata Analytics üzerinde çalışan Power BI benzeri bir BI modülüdür.
Bu depodaki ilk dilim semantik çekirdektir:

- **Semantik model:** YAML ile tanımlanır. Nesne modeli Tabular/TOM'dan alınmıştır:
  tablolar, sütunlar, ilişkiler, ölçüler, hiyerarşiler ve roller (RLS).
- **Floem DAX derleyicisi:** el yazımı lexer, Pratt parser, filtre bağlamı semantiği
  ve sqlglot ile SQL üretimi. Çıktı lehçeleri DuckDB ve T-SQL.
- **query-service:** DuckDB üzerinde Import modu sorgu motoru ve FastAPI uç noktaları.

Mimari kararlar ve gerekçeleri `research/notes/99-floem-bi-sentez.md` dosyasındadır.

## Kurulum ve çalıştırma

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"

# Sentetik SAP B1 verisi ve Gold katmanı (demo)
.venv/Scripts/python -m floem_bi.demo.sapb1 data/demo.duckdb

# Testler
.venv/Scripts/python -m pytest

# API
set FLOEM_MODEL=examples/sapb1_satis.yaml
set FLOEM_DB=data/demo.duckdb
.venv/Scripts/uvicorn floem_bi.api.app:app --reload
```

### Floem BI Desktop (Electron)

Node.js 22.12 veya üstü gerekir.

```bash
npm install          # postinstall Electron ikilisini indirir
npm run desktop      # Vite + Electron; Python servisi .venv'den otomatik başlar
```

Desktop açılınca arka planda `python -m floem_bi.desktop_service` başlar. Servis rastgele
bir portta yalnızca `127.0.0.1` adresinden dinler ve her açılışta üretilen bir token'la
korunur. Kayıtlı bağlantıların şifresi olmayan bilgisi `%APPDATA%\FloemBI\connections.json`
dosyasında, şifreleri Windows Kimlik Bilgisi Yöneticisi'nde ("FloemBI") tutulur.

VS Code terminalinde `ELECTRON_RUN_AS_NODE=1` tanımlı olabilir. `npm run desktop` bunu
kendisi temizler; Electron'u elle başlatıyorsanız bu değişkeni kaldırın.

#### İçe aktarım, model görünümü ve .floem dosyası (H2)

- **Veri al → Gezgin → Yükle:** seçilen tablolar arka planda parça parça (50.000 satır) Arrow
  üzerinden yerel DuckDB'ye aktarılır. Pencere tablo tablo satır sayısını gösterir, iptal
  edilebilir. Önce geçici tablolara yüklenir; hepsi başarılı olursa tek transaction'da modele
  eklenir. Hata ya da iptal modeli değiştirmez.
- **SQL penceresi → Modele yükle:** sorgunun tamamı tablo olarak yüklenir (satır sınırı yok).
- **İlişkiler otomatik algılanır:** önce kaynaktaki yabancı anahtarlar, sonra ad eşleşmesi.
  "Bir" tarafı tek sütunlu birincil anahtar olmalı; anahtar bilgisi yoksa verideki benzersizliğe
  bakılır. SAP B1'de yabancı anahtar olmadığı için örneğin `INV1[DocEntry] → OINV[DocEntry]` ve
  `OINV[CardCode] → OCRD[CardCode]` ad eşleşmesinden bulunur. İki tablo arasında ikinci bir
  filtre yolu açan ilişki pasif eklenir.
- **Model görünümü:** tablo kartları (Σ, anahtar, tarih, gizli simgeleri), 1 / * işaretli ve
  filtre yönü oklu ilişki çizgileri (pasif ilişki kesik çizgi). Bir sütunu diğer tablodaki
  sütunun üstüne sürükleyince ilişki penceresi açılır. Pencere sütunların benzersizliğine bakıp
  kardinaliteyi önerir. Çizgiye çift tıklayınca düzenleme açılır; "İlişkileri yönet" de var.
- **Özellikler bölmesi:** tablo (ad, açıklama, gizle, tarih tablosu olarak işaretle, yenile, sil),
  sütun (ad, veri tipi, biçim, sütuna göre sırala, varsayılan özet, gizle), ilişki.
- **Yenile:** tabloları kaynaktan yeniden yükler. Kaynakta eklenen ya da silinen sütunlar modele
  yansır, kullanıcının değiştirdiği veri tipleri korunur. Yarıda kalan yenileme eski veriyi bozmaz.
- **.floem dosyası** (Ctrl+S / Ctrl+O): zip içinde `manifest.json`, `model.yaml`, `diagram.json`,
  `report.json`, `data.duckdb`. Şifre dosyaya girmez. Başka bilgisayarda açılan dosya yenilenirken
  aynı sunucuya kayıtlı bağlantı aranır.
- Model değişiklikleri servise işlem listesi olarak gider (`POST /document/ops`:
  `rename_table`, `add_relationship`, `update_column`…). Aynı işlemler ileride floembi.app'te
  web'den düzenleme için kullanılacak.

Duman testi kancaları (yalnızca geliştirme): `FLOEM_OPEN=dosya.floem`,
`FLOEM_START_VIEW=model`, `FLOEM_SCREENSHOT=cikti.png`, `FLOEM_SCREENSHOT_JS=...`.

#### Yeni veri kaynakları ve rapor taslakları

**Veri al** penceresinde SQL Server'a ek olarak üç kaynak seçilebilir:

| Kaynak | Giriş | İçeri alınan veri |
|---|---|---|
| SAP HANA | Sunucu `adres:port`, isteğe bağlı şema, HANA kullanıcısı ve şifresi; makinede HDBODBC gerekir | Tablo veya görünüm; salt okunur sorgu |
| SQLite | Yerel `.sqlite` / `.db` dosyasının tam yolu | Tablo veya görünüm; dosya salt okunur açılır |
| REST API | HTTPS temel adresi, kaynak yolu; isteğe bağlı Bearer belirteci | JSON nesne listesi (`items`, `data`, `results`, `records`); aynı adres altındaki `next` sayfaları |

Yeni kaynakların şifreleri `.floem` dosyasına yazılmaz. Bearer belirteci hatırlatılırsa Windows
Kimlik Bilgisi Yöneticisi'nde saklanır. REST kaynağında SQL penceresi kullanılmaz. Bu üç kaynak
Desktop'tan yayımlandığında veri anlık görüntü olarak gider; Floemway'in otomatik kaynak eşleme ve
yenileme akışı şu an SQL Server içindir. SAP HANA bağlantısı için canlı sunucu kabul testi gerekir.

PBIP raporlarından **tasarım ve alan eşlemesi** aktarımı için:

```powershell
.venv\Scripts\python -m floem_bi.pbip_import "C:\Raporlar\Ornek.Report" "C:\Raporlar\Ornek.floem"
.venv\Scripts\python -m floem_bi.pbip_import --all "C:\Raporlar" "C:\Taslaklar"
```

Oluşan `.floem` dosyası Desktop'ta **Dosya aç** ile düzenlenir. Sayfa, görsel konumu, desteklenen
görsel tipi ve alan bağları aktarılır. Model tabloları boş oluşturulur; gerçek veri, kaynak bağlantısı
ve Power BI ölçü formülleri aktarılmaz. Desteklenmeyen görseller metin yer tutucusu olur. Veriyle
çalıştırmak için ilgili kaynağı Desktop'ta yeniden bağlayıp ölçüleri FDX olarak uyarlayın.
Şeffaf PBIP tıklama katmanları içerik üstünü kapatmamaları için atlanır; sayfalar arası geçiş Floem
sayfa sekmeleriyle yapılır. Veri bulunmayan grafik ve kartlar **TASLAK · VERİ BEKLENİYOR**
önizlemesini gösterir; çubuklar gerçek veri değildir. 1920 piksel genişliğindeki raporlar açılırken
tuval geniş görünür, **Panelleri göster** düğmesiyle alan ve biçim panelleri açılır.

Desktop simgesi `apps/desktop/build-resources/floem-bi.ico` dosyasındadır. Kaynak görselden
yeniden üretmek için `apps/desktop/build-resources/generate-icon.ps1` çalıştırılır; paketli Windows
uygulamasında ve geliştirme penceresinde aynı simge kullanılır.

#### Rapor görünümü (H4'ün çekirdeği)

- Görseller: **Tablo** (toplam satırıyla), **Kümelenmiş sütun grafiği**, **Kart**.
- Veri bölmesinden alanı işaretleyin ya da sürükleyin. Sayısal alanlar değer olarak "Toplam"
  özetiyle, diğerleri gruplama alanı olarak eklenir (Power BI'daki gibi). Görselleştirmeler
  bölmesinde alan kutuları var; değerin özeti (Toplam, Ortalama, En düşük, En yüksek, Say,
  Say (Farklı)) seçilebilir.
- Görseller taşınır (başlıktan) ve boyutlandırılır (sağ alt köşe). Sayfa sekmeleri: ekleme,
  çift tıklayıp yeniden adlandırma, silme.
- Çapraz filtre: grafikte sütuna ya da tabloda satıra tıklayınca diğer görseller filtrelenir.
- Görsel sorguları Floem DAX derleyicisinden geçer: örtük ölçüler `SUM('INV1'[LineTotal])` gibi
  DAX'a çevrilip SQL'e derlenir ve ilişkiler üzerinden filtrelenir.
- Rapor tanımı `.floem` içindeki `report.json`'dadır. Tablo ya da sütun yeniden adlandırılınca
  görsellerdeki referanslar da güncellenir.
- Görsel türleri küçük grafik simgeleriyle seçilir. Satır, sütun, gösterge ve değer kutularına
  yerleştirilmiş alanlar tekrar sürüklenerek sıralanabilir veya uygun kutular arasında taşınabilir.
- **Biçim** panelinde hazır stiller, arka plan, kenarlık, köşe, gölge, boşluk ve başlık ayarlanır.
  Şekil, görsel dosyası ve canlanan sayı nesneleri eklenebilir. Belirme, yükselme ve hafif vurgu
  hareketleri Desktop ile web'de aynı çalışır; sistemin hareket azaltma tercihi uygulanır.
- Tuval üstündeki **Serbest tasarım** araçlarıyla sayfa rengi değiştirilir. Seçili nesne çoğaltılır,
  öne/geriye alınır, kilitlenir ve opaklığı ayarlanır. Nesneleri sürükleyip boyutlandırırken hizalama
  çizgileri görünür; `Alt` basılıyken ızgaraya yapışmadan konumlandırılır.

### floembi.app (yerel sunucu) ve yayımlama (H5)

#### Gerçek adresli tek alıcı pilotu

Bu pilot, mevcut yerel sunucu ve deneme kullanıcılarından ayrı çalışır. Desktop'ta kaydedilmiş
rapor `https://bi.floemdata.com` adresine yayımlanır; alıcı yalnızca kendisiyle paylaşılan raporu
görür. Sunucu bu Windows bilgisayarında çalıştığından bilgisayar uykuya geçtiğinde veya pilot
süreçleri durduğunda adres kullanılamaz.

Bilgisayarı yeniden başlattıktan ve Windows oturumu açtıktan sonra depo kökündeki
[`floem-baslat.bat`](floem-baslat.bat) dosyasına çift tıklayın. Bu dosya yerel sunucuyu (8800),
pilot yayın sunucusunu (8811), Cloudflare tünelini, kayıtlı Floemway süreçlerini ve Desktop'ı
başlatır. Açık bileşenleri tekrar açmaz. Kurulumun (`.venv`, `node_modules`, web derlemesi,
Cloudflare tünel belirteci) önceden yapılmış olması gerekir. Başlatma Windows oturum açılışına
otomatik olarak eklenmez; web yayını için bilgisayarın açık ve uyanık kalması gerekir.

```powershell
npm run web:build
.venv\Scripts\python -m floem_bi.server.pilot init
.venv\Scripts\python -m floem_bi.server.pilot cloudflare-setup
.venv\Scripts\python -m floem_bi.server --pilot
```

`init` gerçek yönetici e-postasını, adını ve şifresini gizli istemden alır. Boş
`%LOCALAPPDATA%\FloemBI\pilot-server` klasöründe yönetici ve “Pilot Raporlar” çalışma alanı
oluşturur. Şifre veritabanında yalnızca özetiyle, sunucu anahtarı Windows Kimlik Bilgisi
Yöneticisi'nde tutulur. Geliştirme kullanıcıları oluşturulmaz; mevcut `data/server` ve 8800
portundaki süreç değişmez. `cloudflare-setup`, bu alan adına ait mevcut
`%USERPROFILE%\.cloudflared\cert.pem` oturumunu kullanarak **ayrı** `floembi-pilot` tünelini ve
`bi.floemdata.com` DNS kaydını oluşturur. Başka bir DNS kaydı varsa üzerine yazmaz. Tünel
belirtecini Windows Kimlik Bilgisi Yöneticisi'ne kaydeder; belirteç komut satırına yazılmaz.
Yönetici şifresini daha sonra gizli istemle değiştirmek için
`.venv\Scripts\python -m floem_bi.server.pilot admin-password` kullanın. Yönetici şifresi
en az 8 karakter olmalıdır.

Sunucu açıkken ikinci terminalde tüneli başlatın:

```powershell
.venv\Scripts\python -m floem_bi.server.pilot tunnel
```

Cloudflare API kurulumu kullanılamıyorsa, Cloudflare panelinde ayrı bir uzaktan yönetilen tüneli
ve `bi.floemdata.com` → `http://127.0.0.1:8811` rotasını oluşturun; tünel belirtecini
`.venv\Scripts\python -m floem_bi.server.pilot tunnel-token` komutunun gizli istemine girin.

Web'de yönetici olarak giriş yapıp **Yönetim → E-posta sunucusu** ekranında gerçek SMTP ayarını
kaydedin ve test e-postasının ulaştığını doğrulayın. Desktop'ta raporu kaydedin, **Yayımla**
ekranında `https://bi.floemdata.com` adresi ve yönetici hesabıyla “Pilot Raporlar”ı seçin.
Web'de raporu açıp **Paylaş** ile gerçek alıcının e-postasını ekleyin. Davet bağlantısı yedi gün
geçerlidir; alıcı adını ve şifresini belirleyip oturum açınca raporu görür. **Erişimi olanlar**
ekranından yetki kaldırılabilir. Veri, Desktop'tan gönderilen anlık görüntüdür; güncellemek için
raporu yeniden yayımlayın. Bu pilotta Floemway yenilemesi kurulmaz.

Cloudflare Free/Pro'da tek HTTP yüklemesi 100 MB ile sınırlıdır. Desktop, bu adrese daha büyük
`.floem` dosyasını göndermeden açıklayıcı hata verir. Pilotu dış ağdan, örneğin mobil veriyle
test edin; davet sonucunun `sent` olması gerekir, `outbox` gerçek e-posta gönderimi değildir.

```bash
.venv/Scripts/python -m pip install -e ".[server]"
npm run web:build     # web arayüzünü derler (apps/web/dist)
npm run server        # http://127.0.0.1:8800  (veri: data/server, git dışı)
```

İlk açılışta iki **geliştirme kullanıcısı** ve "Satış Ekibi" çalışma alanı oluşturulur:

| E-posta | Şifre | Rol |
|---|---|---|
| `yonetici@floembi.test` | `Floem.Yonetici1` | Satış Ekibi'nde Yönetici: yayımlar, raporları görür |
| `izleyici@floembi.test` | `Floem.Izleyici1` | Hiçbir alanda üye değil: yalnızca kendisiyle paylaşılan raporu görür |

Şifreler `FLOEM_YONETICI_PASSWORD` / `FLOEM_IZLEYICI_PASSWORD` ile değiştirilebilir (yalnızca ilk
açılışta). Bunlar yalnızca geliştirme içindir; gerçek kullanıcı yönetimi ve SSO sonraki aşamada.

**Yayımlama:** Desktop → *Yayımla* → floembi.app'te oturum aç → çalışma alanı seç. Yayımlanan,
diske kaydedilmiş `.floem` dosyasıdır (kaydedilmemiş değişiklik varsa önce kaydetmeniz istenir).
Sunucu anlam modelini (veri anlık görüntüsü) ve raporu ayrı ayrı saklar. Aynı adla tekrar
yayımlanınca üzerine yazılır ve sürüm artar; son iki sürüm tutulur. Web'de rapor salt okunur ama
etkileşimlidir (çapraz filtre, sayfalar). Yetkisiz işlemler 403 alır ve ekranda okunur mesaj
çıkar ("Bu rapor sizinle paylaşılmamış").

**E-postayla paylaşım (H6):** Web'de rapor → *Paylaş* (yalnızca çalışma alanı Yöneticisi ve
Üyesi). Alıcıya rapora salt okunur erişim verilir, istenirse "Raporu aç" bağlantılı e-posta gider.
Erişim aynı pencerenin "Erişimi olanlar" listesinden kaldırılır. floembi.app hesabı olmayan
adrese davet e-postası gider; kişi hesabını açınca rapor paylaşılmış olur.

**Satır düzeyi güvenlik (RLS):** Power BI'daki akışla aynı.

1. Desktop'ta **Güvenlik → Rolleri yönet**: rol oluşturulur, tablo başına FDX filtresi yazılır
   (`[CardName] = "Ege Yapı"`, kişiye göre `[E-posta] = USERPRINCIPALNAME()`). Filtre kaydederken
   derlenir; hatalıysa kaydedilmez. Filtre ilişkiler boyunca diğer tablolara yayılır.
2. **Güvenlik → Farklı görüntüle**: rapor seçilen rollerin (ve isteğe bağlı bir e-postanın) gözünden
   sorgulanır; üstte sarı bant çıkar, "Görüntülemeyi durdur" ile kapanır.
3. Yayımladıktan sonra web'de çalışma alanında anlam modeline tıklanır → **Güvenlik** ekranında
   rollere kişi atanır (çalışma alanı Yöneticisi ve Üyesi). Atama rol adına bağlıdır; yeniden
   yayımlamada rol modelde kalırsa korunur, kalkarsa "modelde artık olmayan roller" altında görünür.

Filtreler yalnızca **İzleyicilere** ve raporu paylaşımla görenlere uygulanır; Yönetici, Üye ve
Katkıda bulunan tüm veriyi görür. Modelde rol varsa ve izleyici hiçbir role atanmamışsa rapor
açılmaz, nedeni ekranda yazar. `USERPRINCIPALNAME()` web'de oturum açan kişinin e-postasıdır.

**Uygulama (App):** Power BI App karşılığı; çalışma alanı başına bir tane.

- Çalışma alanında **＋ Uygulama oluştur** (Yönetici/Üye): ad, açıklama, tema rengi; içerik olarak
  raporlar seçilir, menü başlığı, bölüm ve sıra verilir. **Uygulamayı yayımla**, raporların o anki
  tasarımını dondurur. Çalışma alanında rapor yeniden yayımlansa da izleyiciler **Uygulamayı
  güncelle**ye kadar eski tasarımı görür; veri her zaman günceldir. Güncelleme gerektiğinde
  çalışma alanı sayfası uyarır.
- **Erişim:** e-posta ile kişi eklenir, kişiye "uygulama açıldı" e-postası gider. Hesabı olmayana
  davet gider; hesap açılınca uygulama görünür. Erişim verilen kişi **İzleyici**dir: çalışma
  alanını ve App dışındaki raporları görmez. RLS App'te de uygulanır.
- İzleyici sol menüdeki **▦ Uygulamalar**dan ya da giriş sayfasındaki karttan açar; solda bölümlere
  ayrılmış rapor menüsü, sağda rapor.

**Anlık güncelleme (SSE):** açık rapor ekranı, rapor yeniden yayımlanınca; açık App ekranı, App
güncellenince ya da altındaki veri yenilenince kendiliğinden yenilenir ve kısa bir bildirim
gösterir. Olaylar yalnızca içeriğe erişimi olanlara gider ve yalnızca kimlik/sürüm taşır. Tarayıcı
bağlantıyı oturumla alınan 60 saniyelik, tek kullanımlık bir biletle açar; oturum anahtarı adres
satırına ve sunucu günlüğüne düşmez. Ters vekil (nginx) arkasında `/api/events` için tamponlama
kapalı olmalı (`X-Accel-Buffering: no` başlığı gönderiliyor).

**Floemway (şirket içi veri ağ geçidi, H7):** Çalışma alanı → **Floemway** ekranında kayıt
anahtarı oluşturun. Müşteri ağındaki Windows bilgisayarında Python ortamına projeyi
`pip install -e .` ile kurup ekranda verilen `python -m floem_bi.gateway ...` komutunu bir kez
çalıştırın. Floemway daha sonra `python -m floem_bi.gateway --id <numara>` ile yeniden başlatılır;
ayar dosyası `%APPDATA%\FloemBI\gateway-<numara>.json` içindedir. Özel anahtar Windows Kimlik
Bilgisi Yöneticisi'nde tutulur. İlk sürüm konsol uygulamasıdır; Windows servisi H8 kapsamındadır.
Uzak floembi.app adresi HTTPS olmalıdır; yerel geliştirmede `127.0.0.1` için HTTP kullanılabilir.

Floem BI Desktop'ta kayıtlı SQL bağlantısıyla raporu kaydedip **Yayımla** düğmesine basın. Tek kayıtlı
Floemway varsa bağlantı otomatik seçilir; birden fazla varsa yayımlama ekranında seçin. Desktop, SQL
şifresini Floemway'in açık anahtarıyla kendi bilgisayarınızda şifreler ve yayımlanan anlam modelinin
kaynaklarına otomatik eşler. Sunucu yalnızca şifreli metni saklar. Çalışma alanındaki **Floemway →
Yayımlanan veri kaynakları** tablosunda sunucu, veritabanı ve hazır/bekliyor durumunu görebilirsiniz.
Şifre Desktop'ta kayıtlı değilse, Windows kimlik doğrulaması kullanılıyorsa veya Floemway henüz
kaydedilmemişse rapor yayımlanır ve bağlantı bekliyor görünür. Eksik eşlemeyi aynı ekranda veya anlam
modelinin yenileme sayfasında tamamlayabilirsiniz. Floemway'i rapordan sonra kaydettiyseniz raporu
Desktop'ta yeniden yayımlayın; kayıtlı SQL bağlantıları o sırada otomatik eşlenir. **Şimdi yenile**,
kaynak tabloları Floemway üzerinden Arrow parçalarıyla alır, Floem Query adımlarını
uygular ve başarılı olursa yeni DuckDB sürümüne geçirir. **Yenileme geçmişi** tablo, adım, süre ve
ham hata ayrıntısını gösterir. Başarısız yenilemede rapor eski veriyle çalışmayı sürdürür.

**Yönetim (sistem yöneticisi):** web'de sol menüdeki *Yönetim* bölümü yalnızca sistem
yöneticilerine görünür (sahte kullanıcılardan `yonetici@floembi.test`). Mevcut bir metadata
veritabanı açılınca çalışma alanı Yöneticileri otomatik olarak sistem yöneticisi yapılır.

- **E-posta sunucusu:** SMTP sunucusu, port, güvenlik, kullanıcı, şifre ve gönderen bu ekrandan
  tanımlanır. Microsoft 365, Gmail ve Mailpit için hazır ayarlar var. "Test e-postası gönder"
  kaydetmeden dener. Şifre metadata DB'de şifreli saklanır (Fernet; anahtar
  `FLOEM_SERVER_SECRET`'tan türetilir) ve ekrana geri gönderilmez. Gizli anahtar değişirse
  şifre ekrandan yeniden girilir. Öncelik: bu ekrandaki ayar, yoksa aşağıdaki ortam
  değişkenleri, o da yoksa giden kutusu.
- **Kullanıcılar:** e-posta adreslerine çalışma alanı rolü verilir ve kişiye otomatik e-posta
  gider.
  - Hesabı olana "erişim verildi" e-postası gider.
  - Hesabı olmayana davet gider. Bağlantı 7 gün geçerli ve tek kullanımlıktır; veritabanında
    yalnızca SHA-256 özeti tutulur. Kişi adını ve şifresini belirler, hesabı açılınca
    yetkileri geçerli olur.
  - Rol değiştirme, çalışma alanından çıkarma ve davetleri yeniden gönderme/iptal etme de bu
    ekrandadır.
  - Son Yönetici çıkarılamaz; kişi kendi sistem yöneticiliğini kaldıramaz.

E-posta sunucusu ortam değişkenleriyle de ayarlanabilir (ekranda ayar yoksa kullanılır):

| Değişken | Örnek | Açıklama |
|---|---|---|
| `FLOEM_SMTP_HOST` | `smtp.sirket.local` | Boşsa **geliştirme modu**: e-postalar gönderilmez, `data/server/outbox/*.eml` olarak yazılır ve web'de **✉ Gelen e-postalar** sayfasında görünür |
| `FLOEM_SMTP_PORT` | `587` | `ssl` için varsayılan 465 |
| `FLOEM_SMTP_SECURITY` | `starttls` | `starttls` · `ssl` · `none` |
| `FLOEM_SMTP_USER` / `FLOEM_SMTP_PASSWORD` | | Kimlik doğrulama gerekiyorsa |
| `FLOEM_SMTP_FROM` | `floembi.app <bi@sirket.com>` | Gönderen adresi; görünen ad paylaşan kişinin adı olur |
| `FLOEM_PUBLIC_URL` | `https://bi.sirket.com` | E-postadaki bağlantının adresi |

Mailpit ile denemek için (isteğe bağlı, Docker): `docker run -d -p 8025:8025 -p 1025:1025 axllent/mailpit`,
ardından `FLOEM_SMTP_HOST=127.0.0.1`, `FLOEM_SMTP_PORT=1025`, `FLOEM_SMTP_SECURITY=none`;
e-postalar http://127.0.0.1:8025 adresinde. Gönderim hatası ("E-posta sunucusuna ulaşılamadı…")
Paylaş penceresinde ve gönderim kaydında okunur; erişim yine verilir.

Geliştirmede web arayüzünü anlık yenilemeyle çalıştırmak için: `npm run server` açıkken
`npm run web` (http://127.0.0.1:5299, `/api` istekleri 8800'e gider).

#### Windows yükleyicisi

```bash
.venv/Scripts/python -m pip install -e ".[package]"   # PyInstaller
npm run desktop:package
# → apps/desktop/release/FloemBI-Desktop-Setup-<sürüm>.exe  (NSIS, yönetici izni istemez)
```

Adımlar: PyInstaller Python servisini `build/pyinstaller/dist/floem-service/` altına
`floem-service.exe` olarak derler (onedir, UPX yok). Vite arayüzü derler. electron-builder
servisi `resources/floem-service/` altına koyup kurulum dosyasını üretir. Kurulan uygulamada
Python gerekmez; SQL Server için makinede Microsoft ODBC Driver 17 veya 18 kurulu olmalıdır.
Kod imzalama henüz yok, bu yüzden Windows SmartScreen ilk açılışta uyarı verir.

Lisans notu: PyInstaller GPLv2'dir ama bootloader istisnası, üretilen kapalı kaynak
uygulamanın dağıtımına izin verir. PyInstaller yalnızca derleme aracıdır, ürüne bağımlılık
olarak girmez (karar: 17.11.2026).

Gerçek SQL Server ile isteğe bağlı entegrasyon testi:

```bash
set FLOEM_TEST_MSSQL_SERVER=SUNUCU\INSTANCE
set FLOEM_TEST_MSSQL_USER=okuyucu
set FLOEM_TEST_MSSQL_PASSWORD=...
.venv/Scripts/python -m pytest tests/test_connectors.py
```

### Örnek sorgu

Windows'ta Türkçe karakterli ölçü adlarının bozulmaması için gövdeyi
UTF-8 kodlu bir dosyadan `--data-binary @sorgu.json` ile göndermek daha güvenlidir.

```bash
curl -X POST 127.0.0.1:8000/query -H "Content-Type: application/json; charset=utf-8" -d '{
  "group_by": ["Tarih[Yil]", "Urun[Kategori]"],
  "measures": ["Toplam Satış", "Geçen Yıl Satış", "Kategori Payı"],
  "filters": [{"column": "Musteri[Grup]", "op": "in", "values": ["Bayi"]}]
}'
```

## Desteklenen DAX alt kümesi

Ölçüler Desktop'ta formül çubuğundan yazılır (Hesaplamalar → Yeni ölçü): `Ad = ifade`,
otomatik tamamlama, yazarken hata işareti. Tarih tablosu: Hesaplamalar → Tarih tablosu.

| Grup | Fonksiyonlar |
|---|---|
| Toplama | SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT |
| Satır satır hesaplama (iterator) | SUMX, AVERAGEX, MINX, MAXX, COUNTX; tablo, `FILTER(...)` ya da `VALUES(T[c])` üzerinde; RELATED desteklenir |
| Bağlam geçişi | İteratör içinde ölçü: `AVERAGEX(VALUES(Tarih[Ay]), [Satış])`, `SUMX(Musteri, [Satış] * 2)` (tablonun tek anahtar sütunu olmalı) |
| Filtre bağlamı | CALCULATE, FILTER, ALL, ALLEXCEPT, ALLSELECTED, REMOVEFILTERS, KEEPFILTERS, USERELATIONSHIP, tek ya da aynı tablonun çok sütunlu boolean koşulları |
| Tek değer | VALUES (skaler), SELECTEDVALUE, HASONEVALUE |
| Zaman zekâsı | SAMEPERIODLASTYEAR, DATEADD (YEAR/QUARTER/MONTH), DATESYTD/QTD/MTD, TOTALYTD/QTD/MTD |
| Mantık ve skaler | IF, SWITCH, DIVIDE, ISBLANK, COALESCE, BLANK, AND, OR, NOT, IN, ABS, ROUND, INT, MOD |
| Tarih ve metin | YEAR, MONTH, DAY, DATE, TODAY, LEN, LEFT, RIGHT, MID, TRIM, UPPER, LOWER, CONCATENATE |
| Değişkenler | VAR / RETURN |
| Güvenlik | USERPRINCIPALNAME, USERATTRIBUTE (RLS kuralları için) |

**Bilinen sapmalar ve sonraya kalanlar:**
- FILTER koşulunda ölçü (`FILTER(Musteri, [Satış] > 1000)`) ve hesaplanmış sütunda ölçü henüz yok.
- CROSSFILTER, RANKX, TOPN, SUMMARIZE, ADDCOLUMNS, EARLIER desteklenmiyor.
- Çift yönlü ilişkiler tek yön gibi uygulanıyor; model yüklenirken uyarı veriliyor.
- `x / 0`, DAX'taki ∞ yerine BLANK döndürüyor.
- Zaman zekâsı için tarih tablosu, ölçünün taban tablosuna doğrudan bağlı olmalı.
- Zaman zekâsının tek günlük bağlamlardaki uç durumu için: `src/floem_bi/compiler/timeintel.py`.

## Yapı

```
src/floem_bi/
  dax/        lexer, Pratt parser, AST
  model/      YAML şeması (pydantic), ad çözümleme, ilişki grafiği, doğrulama
  compiler/   IR, filtre bağlamı (measures.py), zaman eşlemeleri, SQL üretimi (sqlgen.py)
  engine/     DuckDB motoru
  api/        FastAPI query-service
  demo/       sentetik SAP B1 verisi + Gold katmanı
examples/     örnek semantik model
tests/        parser, zaman eşlemesi, ölçü sonuçlarının oracle karşılaştırması, RLS, T-SQL, API testleri
research/     açık kaynak araştırma notları (repos/ git dışı)
```
