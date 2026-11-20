# F07B — bileşen ve marka kitaplığı

20.11.2026. F05'te oluşturulan grup ve kapsayıcılar artık alan yuvaları ve sürümleriyle
yeniden kullanılabilir. Kullanımlar normal rapor nesneleridir; Desktop ve web aynı
malzemeleştirilmiş tasarımı görüntüler.

## Deneme

Desktop'u kapatıp `npm run desktop` ile yeniden açın; yeni yerel servis uç noktaları da yüklenir.
**Aç / Ctrl+O → `data/SAPB1Demo-Floem-F07B.floem`** seçin.
Web'e yayımlama için floembi.app Python sunucusunu da güncel kodla yeniden başlatın;
yeni gömülü bileşen alanlarını sunucu şeması doğrular.

1. İlk sayfa **Bileşen Atölyesi**. Satış, açık sipariş veya cari kartının grubunu seçin.
2. **Görselleştirmeler → Bileşen kitaplığı** bölümünü açın.
3. **v2 güncellemesini incele** ile etkilenecek kullanımlara bakın.
4. **Bu rapordaki tüm kullanımlara uygula** seçilirse dört kullanım güncellenir.
   Ortak başlık yazı boyutu değişir; farklı ölçüler, yeşil/mor vurgular ve yerel
   başlıklar korunur. **Bileşen Kullanımları** sayfasındaki kart da aynı tanıma bağlıdır.
5. **Ctrl+Z / Ctrl+Y** ile uygulamayı tek adımda geri alın/yineleyin.

Yeni dosya 11 sayfa, iki tanım sürümü ve dört bağlı kullanım içerir. İlk iki sayfadaki
beş veri sorgusu yerel demo üzerinde boş olmayan sonuç verdi. F05/F06 dosyaları korunur.
Yeniden üretmek için yeni hedef adı kullanın:

```powershell
.venv\Scripts\python -m floem_bi.component_demo data\SAPB1Demo-Floem-F05.floem data\SAPB1Demo-Floem-F07B-yeni.floem
```

Komut kaynaklara bağlanmaz, mevcut hedefi ezmez. `.floem` dosyaları git dışındadır.

## Kendi bileşeninizi oluşturma

Grup/kapsayıcı içine metin, şekil, görsel, tablo ve düğme koyun. Tek nesne de kaydedilebilir.
**Seçimi kitaplığa kaydet** ile ad/açıklama ve alan yuvası adlarını belirleyin.
Birden çok bağımsız nesne için önce Ctrl+G ile grup oluşturun. İç bileşenler yeni tanımın
düzenlenebilir tasarım kopyasına dönüşür.

Alan, gösterge, değer, hedef, görsel filtresi, FDX ölçüsü çalıştıran düğme, sayfa geçişi ve
harici nesne göster/gizle başvuruları otomatik yuva olur. Aynı türdeki aynı başvurunun
birden çok kullanımı tek yuvada birleşir. İç düğme hedefleri kopyanın kendi nesnelerine bağlanır.
**Sayfaya ekle** sırasında mevcut modelden alan/ölçü, toplama, sayfa veya nesne seçin.
Eksik eşleme tamamlanmadan ekleme yapılamaz. Metin sütunlarında sayma/farklı sayma da desteklenir.
Metin nesnesinin `[Ölçü]` yer tutucuları eşlemeyle yeni ölçü adına taşınır.

Sabit başlık ve açıklamalar normal metin olarak düzenlenir. Kaydedilmiş tasarım filtreleri
ve eylemleri korunur; başka modele aktarırken filtre değerlerini de kontrol edin.
Dilimleyici seçimi gibi çalışma anı durumu kopyaya taşınmaz.

Başlangıç kitaplığında **Karşılaştırmalı KPI**, **Gezinme ve filtre**, **Süreç adımı** bulunur.
Süreç kartı düzenlenebilir bir tasarım örneğidir; veriyle değişen durumlar F11 kapsamındadır.

## Ortak sürüm ve yerel ayarlar

Bağlı grubun herhangi bir iç nesnesi seçiliyken kitaplık bölümü o bileşenin sürümünü gösterir.
Tasarımı değiştirip **Yeni sürüm hazırla → Sürümü kaydet** kullanın. Kayıt, seçili kullanımı
yeni sürüme bağlar. Diğer kullanımlar kendi sürümlerinde kalır; **güncellemeyi incele**
ekranında sayfaları/kullanımları görüp seçili kullanıma veya bu rapordaki tüm kullanımlara uygulayın.

Güncelleme eski temel, mevcut tasarım ve yeni sürümü karşılaştırır. Yerelde değiştirilmemiş
özellikler ortak sürümü alır. Yerel renk, yazı, biçim, alan eşlemesi, ekleme/silme ve kök
konumu korunur. Kaynaktan kaldırılan sade nesne silinir; yerelde özelleştirilmiş nesne kalır.
Yeni zorunlu yuva geçerli varsayılan bulamazsa eşleme istenir. Toplu eşlemede yalnız açıkça
değiştirilen yuva diğer kullanımlara uygulanır. Kilitli kullanım varsa önce kilidi açılmalıdır.

Alan bölmesinde tek yuva başvurusu değiştirildiğinde kullanım eşlemesi de güncellenir.
Aynı yuvanın yalnız bazı başvurularını değiştirirseniz bunlar yerel istisna olarak kalır.
Üye nesne kendi alt ağacından taşınırsa kökün bileşen bağı kopar; tasarım nesneleri kalır.
**Bağı kopar** ile bunu elle de yapabilirsiniz. Çoğaltma yeni düğüm kimlikleriyle bağlantıyı korur.

Modelde alan/ölçü yeniden adlandırma, kullanım eşlemelerine yansır. Gömülü tanımlar
oluşturuldukları sürümün değişmez temelidir. Başka raporda varsayılan ad bulunmazsa yeniden eşleyin.
Rapor üzerindeki uygulama ve bağ değişiklikleri oturum geçmişindedir. Kitaplığa sürüm yazma
raporun undo işlemiyle geri alınmaz; sonraki değişiklik yeni sürüm olarak kaydedilir.

## Kalıcılık ve raporlar arasında kullanım

Desktop kişisel kitaplığı `%APPDATA%\FloemBI\components.json` içinde tutar. Yeni raporda aynı
kitaplık açılır. **Yerel kitaplığa al**, gömülü/hazır tanımı kişisel kitaplığa ekler.
**JSON indir / JSON içe aktar** tasarımları başka bilgisayara taşır. **Yerelden kaldır** seçili
ailenin kişisel kopyalarını kaldırır; açık rapordaki gömülü tanımlar ve kullanımlar kalır.

Rapor, kullandığı sürümleri `report.components` içinde taşır. Web görüntüleyici kişisel kitaplığa
erişmez; tanımlar ve malzemeleştirilmiş nesneler dosyayla yayımlanır. Diğer raporlar açıldığında
yeni yerel sürüm görülebilir ve güncelleme o raporda ayrıca uygulanır. Kaynak dosyalar topluca
ve sessizce değiştirilmez. Canlı web raporunu değiştirmek için normal yeniden yayımlama gerekir.

Yerel API mevcut `X-Floem-Token` doğrulamasıyla korunur. Kitaplık en fazla 10 MB ve 500 sürüm;
tek bileşen 200 nesne/200 yuva, ağaç 16 düzeyle sınırlıdır. Aynı kimlik/sürüm farklı içerikle
üzerine yazılamaz. Revizyon kontrolü eski kaydın yeniyi ezmesini engeller; çakışmada **Listeyi
yenile** kullanılır. Dosya geçici yazım + atomik değiştirmeyle kaydedilir. JSON hedef yolları,
yuva türleri ve ağaç hem istemcide hem Python'da doğrulanır.

## Marka ve ikonlar

**Bileşen kitaplığı → Marka ve ikonlar**: kullanıcının Y/veri-piksel işaretinden türetilen
Yıldırım Technologies, FloemData, Floem BI Desktop ve Floemway aileleri. Yatay, dikey, sembol,
tek renk, çizgisel ve uygulama simgesi açık/koyu zeminde karşılaştırılır.

16, 32, 48, 64, 128, 256 ve 512 px simgeler gerçek boyutta görünür; küçük simgede detay azalır.
SVG, PNG ve altı PNG çerçeveli Windows ICO indirilebilir; logo doğrudan sayfaya resim olarak
eklenebilir. Yerleşik sistem yazı tipleri kullanılır; dış font/ağ kaynağı veya yeni bağımlılık yoktur.
Bu varyantlar kitaplıkta seçilebilir; mevcut paketlenmiş uygulama simgesi otomatik değiştirilmedi.

## Doğrulama ve devam

- Tam Python takımı: **240 geçti, 1 atlandı**.
- 13 yeni Python testi: kimlik doğrulama, revizyon çakışması, değişmez sürüm, boyut sınırı,
  hatalı ağaç/yol/eşleme, gerçek `.floem` aç/kaydet ve izole web sunucusunda yayımlama/sorgu.
- `node tests/design/run.mjs`: 16 bileşen/marka ve önceki 20 tasarım/yerleşim testi.
- Chromium StrictMode: kaydetme, farklı sayfada ölçü eşleme, yerel renk + ortak yazı boyutu,
  toplu güncelleme önizlemesi, undo/redo, JSON gidiş-dönüş, gerçek simge ölçüleri,
  SVG/PNG/ICO başlıkları, rapor yeniden açma, web logo ve iç düğme hedefi.
- Typecheck, Desktop/web üretim derlemeleri; önceki grid/matris/tema/aktarım/düzen regresyonları.

Sonraki iş **F10A-01–04 sayfa görünümü**: `displayOption`, tuval saydamlığı ve tuval dışı
alan rengi/saydamlığı. Ardından **F08 ekran düzeni varyantları** gelir.
Güncelleme: F10A, F08, F09 ve [F11 veri durumları/tekrarlayıcı](f11-veri-baglari-ve-tekrarlayici.md)
tamamlandı. Sırada F13; F06-2–5 kaynak ölçü/motor/mutabakat işleri açıktır.
