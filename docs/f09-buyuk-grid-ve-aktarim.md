# F09 — Büyük tablo, ağaç dalları ve aktarım kapsamı

20.11.2026. Tablo ve Tree Grid için **sunucuda arama ve sayfalama** eklendi.
10.000 gruptan sonraki sonuçlara erişilir; tüm sonuçlar tarayıcıya yüklenmez.
Desktop ve web aynı sorgu sözleşmesini ve görselleri kullanır.

## Kullanım

1. Desktop ve web Python sunucusunu güncel kodla yeniden açın. Bu teslimatta
   kullanıcının çalışan süreçleri durdurulmadı, canlı web yayını yapılmadı.
2. Tablo/ağaç nesnesini seçin → **Görselleştirmeler → Biçim → AG Grid tablo / Ağaç tablo**.
3. **Veri kapsamı → Sunucuda arama ve sayfalama** seçin.
4. Sayfa boyutunu 25, 50, 100, 250 veya 500 grup yapın; varsayılan 100'dür.
   Tablo araması, sütun filtreleri ve genel toplam parametrik kalır.
5. Sayfa altındaki ilk/önceki/sonraki/son düğmelerini kullanın. Arama veya filtre
   değişince ilk sayfaya dönülür. Tablo sütun başlığı bütün sonucu sıralar.

Eski dosyalar **Getirilen sonuçlar** modunda açılır; otomatik veri kapsamı değişikliği
yapılmaz. Bu moddaki sınır notu arama/indirmenin yalnız getirilen sonuçları kapsadığını
belirtir. Yeni mod `.floem` dosyasında `format.gridDataMode: "server"` olarak saklanır.
AG Grid Community kullanılır; ücretli Enterprise Server-Side Row Model eklenmedi.

## Hangi sonuç ve hangi toplam?

| İşlem | Kapsam |
|---|---|
| Tablo araması | Rapor/dilimleyici/çapraz seçim/RLS filtrelerinden sonra oluşan bütün sonuç grupları |
| Tablo sütun filtresi | Aynı sonuçtaki ilgili sütun; sütunlar arasında AND, sütun başına tek koşul |
| Sayfa göstergesi | Görünen aralık / arama ve sütun filtrelerine uyan toplam grup sayısı |
| Genel toplam | Rapor/dilimleyici/çapraz seçim/RLS bağlamında FDX ile yeniden hesaplama |
| Sonuç araması veya sütun filtresi | Genel toplamı değiştirmez; açıklaması nesnede kalıcıdır |
| Ağaç dalı toplamı | Yukarıdaki bağlama ek olarak üst dal yolu; alt satırların toplamı/ortalaması alınmaz |

Örneğin ortalama ve farklı sayım sayfa toplamlarından türetilmez. Toplam politikası,
Excel/CSV'deki detay satırlarını toplayarak aynı değere ulaşılabileceği anlamına gelmez.
Arama, ham kaynak satırları yerine **gruplandırılmış sonuç** üzerinde çalışır; ölçü
filtreleri de bu aşamadadır. Sayılar ham sonuç değerleriyle aranır, biçimlenmiş para
veya tarih metniyle eşdeğer arama iddiası yoktur. Metin karşılaştırması DuckDB'nin
`lower` davranışıdır; Türkçeye özel I/İ eşlemesi ayrıca uygulanmadı.

## Ağaçta açma, arama ve indirme

Kök grupları önce yüklenir. **+** bir dalın bir sonraki düzeyini sorgular; **−** dalı
ve alt dallarını kapatır. Kapalı dalların detayları önceden sorgulanmaz. Her dalın kendi
araması, sayfası ve indirmesi vardır. Arama **yalnız o düzeyin gruplarını** arar; bütün
alt hiyerarşide arama yapmaz. Boş grup değeri de açılabilir.

Aynı anda en fazla 32 dal açık tutulur; **Dalları kapat** görünmeyen sayfalardaki
açılımları da temizler. Dal başına sayfa boyutu sınırı vardır. Bu ağaç görünümü
sayfalı ve tembel yüklenir; bütün ağacı sanallaştıran bir Tree Grid motoru değildir.
Satır eylem hücresi ve ikonları korunur. Kaynak alanı henüz yüklenmemiş bir alt düzeydeyse
üst satırdaki eylem devre dışıdır. Ağaç sırası grup alanlarına göre kararlıdır;
bu modda eski girintili/ayrı sütun görünümü ve tüm düzeyleri birden açma uygulanmaz.

## CSV, Excel ve PDF

**İndir** ve ortak sağ tık menüsü kapsamı seçenek adında gösterir:

- **Bu sayfa:** o anda gösterilen sayfa; tabloda görünür sütunların sırası korunur.
- **Tüm eşleşen gruplar:** arama/sütun filtrelerine uyan bütün tablo grupları,
  sayfalar sırayla alınarak tek dosyada birleştirilir.
- Ağaçta **Bu düzeyin tüm grupları:** seçilen dalın yalnız mevcut düzeyi. Üst yol
  sütunları çıktıda bulunur; kapalı alt dallar aktarılmaz. Ortak sağ tık kök düzeye aittir.

CSV/Excel üst sınırı **100.000 grup**, PDF sınırı **2.000 grup**. Sınır aşılırsa
kısmi dosya indirilmez; kapsamı daraltma mesajı gösterilir. Genel toplam satırı dosyaya
detay gibi eklenmez. Ağaçtaki yeni sunucu modu Excel çıktısı **düz bir düzey tablosudur**;
tüm ağacın Excel +/− grupları değildir. Önceden yapılan matris/yerel ağaç Excel
hiyerarşisi ve birleşik başlık aktarımı mevcut modunda korunur.

Uzun indirmede ilerleme ve **İndirmeyi iptal et** bulunur. İptal, sürmekteki HTTP/SQL
isteğini sunucuda kesmez; yanıt alınsa da sonraki sayfa/dosya indirilmez. Dosya üretimi
tarayıcı belleğinde yapılır; bu sürüm akışla sınırsız dosya üretmez. Büyük ve geniş
tabloların gerçek bellek/süre bütçeleri ayrıca ölçülmelidir.

## Sorgu ve erişim tutarlılığı

`VisualQuery.page` offset, size, search, column_filters ve iki sürüm işareti taşır.
Sunucu en fazla 1.000 grupluk yanıt verir. Arama/sütun değerleri SQL'e parametreyle
bağlanır; kullanıcıdan SQL alınmaz. Derlenmiş semantik/RLS sonucu dış sorguyla aranır.
Seçilen sıralamaya grup alanları bağlayıcı olarak eklenir, böylece eşit ölçü değerleri
sayfalar arasında tekrara/kayba neden olmaz.

`snapshot` veri/model sürümü ve erişim bağlamını, `revision` buna ek olarak sorguyu
bağlar. Sonraki sayfa ve indirme aynı sürümü ister; ağaç alt dalı üstünün snapshot'ını
taşır. Veri yenilenir/yayımlanır, rol veya sorgu kapsamı değişirse eski devam isteği
reddedilir; **İlk sayfadan yeniden yükle / Düzeyi yenile** ile başlanır. Bu bir geçmiş
veri sürümünü süresiz tutma mekanizması değildir. Yetki her sunucu sorgusunda yeniden
denetlenir; sürüm işareti bir erişim yetkisi değildir.

Sorgu başına sayım ve gerektiğinde FDX toplam sorgusu çalışır. 12.050 gruptaki kontrol,
milyonlarca satırda performans garantisi değildir; anahtar tabanlı sayfalama, sayım/toplam
önbelleği ve akışla dosya üretimi ileride ölçümle ele alınabilir.

## Verili deneme

Yerel ve git dışında: **`data/F09-Buyuk-Grid.floem`**. Desktop'ta **Aç / Ctrl+O**:

- **Büyük Tablo:** 12.050 farklı kimlik; `12049` araması ve son sayfa kontrolü.
- **Büyük Ağaç:** Bölge → kayıt; boş bölge dahil dalları açma, arama ve indirme.
- 12.150 sentetik kaynak kaydı; ilk 100 kimlikte ek kayıt, ağırlıklı ortalama kontrolü.
  Harici veri kaynağı, bağlantı veya şirket verisi yoktur.

Başka makinede yeni dosya oluşturma (mevcut dosyanın üzerine yazmaz):

```powershell
.venv\Scripts\python -m floem_bi.grid_demo data/F09-Yeni.floem
```

## Doğrulama

- Python: **291 geçti, 1 atlandı**. Yeni 16 test; 12.050 grupta bütün sayfalar,
  eşit sıralama değerleri, ağırlıklı ortalama, 10.000 ötesinde arama, parametreli
  arama, sayısal filtre, boş ağaç dalı, RLS ve sürüm reddi; gerçek Desktop → yayımla →
  web API eşitliği ve yeniden yayımlamada eski sayfanın reddi.
- Saf TypeScript: **52 kontrol**; bütün sayfaları toplama, aktarım sınırı, iptal,
  snapshot uyuşmazlığı ve filtre sözleşmesi dahil.
- Tam Chromium testi geçti. Yeni sunucu modu için Desktop/web sayfalama, arama, sıfır sonuç,
  sütun filtresi, bütün sonuçları sıralama, CSV/Excel, PDF sınırı, iptal,
  sürüm hatası ve yeniden yükleme, yalnız açılan dalın sorgulanması ve 390 px ekran.
- Typecheck, Desktop ve web üretim derlemeleri geçti; mevcut paket boyutu uyarıları sürer.
- Yerel `.floem` yeniden açıldı: son sayfada 50 grup, son kimlik 12049 ve gerçek
  kaynak ortalaması doğrulandı. Günlükler ve ekran görüntüleri git dışında `data/qa-f09/`.

AG Grid'in tek koşul yapılandırması için birincil kaynak:
[Filter Conditions](https://www.ag-grid.com/react-data-grid/filter-conditions/).
Yeni bağımlılık eklenmedi. Sonraki F11 veri bağları/durumlar/tekrarlayıcı/hareket aşaması da
[uygulandı](f11-veri-baglari-ve-tekrarlayici.md); sırada **F13 tasarım ve anlam denetçisi** var.
F06-2–5 ölçü/motor/mutabakat işleri açık kalır.
