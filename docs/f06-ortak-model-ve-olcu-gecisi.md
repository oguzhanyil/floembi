# F06 — ortak model ve ölçü geçişi

20.11.2026. Ortak model, yerel ölçüler ve kaynak geçiş haritası uygulandı.
**135 özgün ölçünün tam aktarımı ve Power BI sonuç mutabakatı tamamlanmadı.**

## Denenecek dosya

Desktop'ı kapatıp `npm run desktop` ile yeniden açın; **Aç / Ctrl+O** üzerinden
`data/SAPB1Demo-Floem-F06.floem` dosyasını seçin. Çalışan Python servisi de yeniden
açılmalı; yalnız renderer yenilemesi yeni hesap desteğini yüklemez.

- 9 sayfa; **Model** düğmesiyle **Ortak Model** karşılaştırma sayfasına geçilir.
- 13 tablo, 27 etkin tek yönlü ilişki, 29 gerçek FDX ölçüsü.
- Aynı dönem ve muhatap seçimi satış, açık sipariş ve cari hareket hesaplarına yayılır.
- Yeni dosya verili anlık görüntüdür. `Taslak` adlı dosyalarla karıştırılmamalı.
- Önceki dosyalar korunur. Bu teslimde web'deki rapor yeniden yayımlanmadı.

**Kontrol:** Ortak Model sayfasında bir dönem ve muhatap seçin. Kartlar ve tablo
aynı filtreyi kullanmalı. Cari açılış önceki tarihlerden gelmeli; kapanış, seçilen
dönemin sonuna kadarki hareketleri içermeli. Muhatap seçimi aynı adlı başka
muhatabın kodunu kapsamamalı. Muhatap boyutu genel muhasebe tablosunu filtrelemez;
genel muhasebe için tarih, firma ve hesap boyutları kullanılır.

## Model ve tane düzeyi

| Tablo / boyut | Tane düzeyi ve ilişki |
|---|---|
| Finans | Tarih × hesap günlük özeti; firma, tarih ve hesap boyutlarına bağlı. Önceki üreticide aylıktı; ay ortası filtreleri için günlük yapıldı. |
| Cari | Muhatap yevmiye satırı; firma, tarih, muhatap ve hesap boyutlarına bağlı. Tam muhasebe hareketi değildir. |
| Satis / Satinalma | Belge türü × `DocEntry` × satır; firma, tarih, muhatap, ürün ve satış temsilcisine bağlı. Görünen belge numarası tekil anahtar sayılmaz. |
| Firsat / Aktivite | Fırsat / aktivite kaydı; firma, tarih, muhatap ve satış temsilcisine bağlı. |
| Muhatap | Güncel kaynak bakiyesi anlık görüntüsü; firma ve MuhatapBoyut'a bağlı. Tarihsel bilanço değildir; tarih boyutuna bağlanmadı. |
| Firma | Bu maskelenmiş demoda tek firma; çoğul firma birleştirmesi henüz uygulanmadı. |
| Tarih | Kaynaktaki ilk/son yıl arasında kesintisiz günlük takvim. Yıl, ay ve dönem alanları var; tarih tablosu olarak işaretli. |
| MuhatapBoyut | Firma + muhatap kodu. Etiket kodu da içerir; ada göre birleştirme yapılmaz. Atanmamış kayıt için ayrı üye var. |
| Urun | Firma + satırdaki ürün kodu; satış ve satınalma ortak kullanır. Ürün ana verisi/adı/grubu henüz taşınmadı; etiket ürün kodudur. Hizmet/boş kod ayrı üyedir. |
| HesapBoyut / SatisTemsilcisi | Firma + kaynak kodu; adları aynı olan satış temsilcileri kodlarıyla ayrı kalır. |

Birleşik boyut anahtarları JSON çifti olarak kodlanır; firma/kod içindeki ayraçlar
ve NULL/boş metin çakışmaz. Kaynak anahtar metni birebir kopyalanmaz. Kaydetmeden
önce boyut tekilliği, boş boyut anahtarı ve sahipsiz dış anahtarlar kontrol edilir.
Hata olursa yeni dosya kaydedilmez; kayıt değerleri günlüğe dökülmez.

Motorun ilişki doğrulamasındaki yönsüz döngü kontrolü düzeltildi: iki olgunun aynı
tarih ve müşteri boyutlarına bağlanması geçerlidir. Yönlü döngü, aynı iki nokta
arasındaki ikinci yönlü yol ve yinelenen etkin ilişkiler reddedilmeye devam eder.
Çift yön filtreleme hâlâ motorun mevcut sınırlamasıdır.

## Ölçü kapsamı

29 ölçü modelin Veri panelinde **F06 · Yerel demo** klasöründedir. Satış/iade,
fatura adedi, ortalama fatura, açık sipariş, satır brüt kârı/oranı, satınalma,
cari/muhasebe borç-alacak ve açılış/kapanış, fırsat ve aktivite hesaplarını içerir.
Fatura sayımı satır sayısı veya görünen belge numarası üzerinden yapılmaz.

Açılış/kapanış için dış bağlamda tanımlanan toplamalı `VAR`, `CALCULATE` içindeki
filtrede kullanılabilir. Tarih filtresi kaldırıldığında önceki MIN/MAX sınırı
korunur. Ay satırları kendi sınırlarını, genel toplam kendi son tarihini kullanır;
aylık bakiyeler toplanmaz. RLS bu alt hesaplarda da uygulanır. DuckDB ve T-SQL
üretimi desteklenir; yeni sınır alt sorguları aynı üst `WITH` içinde oluşturulur.
Filtredeki bu VAR'ın içinde iç içe iteratör/zaman dönüşümü henüz desteklenmez;
açık hata verilir.

Kapanış gerçek son gün bakiyesidir. Bitişik olmayan dönemler seçilirse aradaki
hareketleri de içerir; bu durumda açılış + yalnız seçilen dönem hareketi kapanışa
eşit olmayabilir. Güncel kaynak bakiye kartları tarihsel kapanış yerine geçmez.

Yerel tutarlar belge indirimi, vergi, sistem para birimi/kur seçimi ve muhasebe
mutabakatını içermez. Kaynak Power BI brüt kâr marjı yalnız `MaliyetVar` kapsamındaki
satışları esas alır; demodaki **Yerel satır brüt kâr oranı** farklı kapsamdadır.
Satınalma iadeleri kaynakta bulunmadığı için net satınalma iddiası yoktur.

## 135 ölçünün denetimi ve yeniden üretim

```powershell
.venv\Scripts\python -m floem_bi.demo_port "data\SAPB1Demo-Floem-F06.floem" --semantic
.venv\Scripts\python -m floem_bi.semantic_import "..\powerbi-main\Demo\SAPB1Demo.SemanticModel" "data\semantic-F06\SAPB1Demo" --demo "data\SAPB1Demo-Floem-F06.floem"
```

İlk komut yalnız maskelenmiş yerel `DEMO_FIRMA1` kaynağını okur, yerel DuckDB'ye
yazar ve çıktı dosyasını üretir. Kaynak sunucuya yazmaz. İkinci komut kaynak
bağlantısı açmaz; TMDL metadata ve FDX derlemesini inceler, verilen yerel demo
üzerinde alan/ölçü/anahtar ve sonuç kontrollerini çalıştırır. `--demo` isteğe bağlıdır.

JSON/Markdown çıktısı: `data/semantic-F06/SAPB1Demo.json` ve `.md`.
TMDL okuyucu tablo/sütun/ölçü/ilişki alt kümesidir; tam TOM/M aktarıcısı değildir.
[TMDL ifade ve girinti kuralları](https://learn.microsoft.com/en-us/analysis-services/tmdl/tmdl-overview)
esas alınır. Ham M/SQL, bağlantılar, özgün ölçü ifadeleri ve tutarlar rapora yazılmaz.

| Kontrol | Sonuç |
|---|---|
| Kaynak envanteri | 28 tablo, 220 sütun, 23 ilişki, 135 ölçü |
| Kaynak ölçü için SQL üretilebildi | 19; veri aktarımı veya eşdeğerlik anlamına gelmez |
| Motor engeli | 116: 3 sözdizimi, 113 derleme/bağımlılık engeli |
| Yerel model | 29 FDX ölçüsü; 21 kaynak ölçüye sınırlı kapsamlı demo uyarlaması gösterildi |
| Alan eşlemesi | 61 hedef alan eşlemesi; 159 alan eksik olarak görünür. Ad benzerliği semantik eşdeğerlik değildir. |
| Birebir taşındığı doğrulanan kaynak ölçü | 0; denetimde açıkça ayrı tutulur |
| Gerçek yerel dosya | 69 görsel sorgusu sonuç döndürdü; boş görsel sorgusu yok |
| Yerel hesap denetimi | 8 dönem/muhatap senaryosu × 7 hesap = 56 bağımsız SQL karşılaştırması geçti |

Tabloda **Biçim → Sütunları nesneye sığdır** seçeneği eklendi; yeni karşılaştırma
tablosunda açıktır. Başlıklar satıra bölünür ve yükseklikleri içeriğe uyar.
Sütunların 88 px en küçük genişliği korunur; çok dar nesnede veya çok sütun varsa
kaydırma yine gerekebilir. Kullanıcı bu ayarı kapatıp sabit genişliklere dönebilir.
[AG Grid sütun boyutlandırma](https://www.ag-grid.com/react-data-grid/column-sizing/)
ve [başlık yüksekliği](https://www.ag-grid.com/react-data-grid/column-headers-styling/)
özellikleri kullanıldı; yeni bağımlılık eklenmedi.

Doğrulama: tüm Python takımı **206 geçti, 1 atlandı**; son metadata/dosya kontrolleri
için 15 hedefli test de geçti. Typecheck ve Desktop/web üretim derlemeleri başarılı.
Chromium duman testi için `FLOEM_UI_REPORT` rapor düzeni JSON'u isteğe bağlıdır;
yerleşim testinde sentetik değerler kullanılır, gerçek hesaplar yukarıdaki ayrı
DuckDB denetiminde kontrol edilir. Örnek ekran çıktısı yerelde
`%TEMP%/floem-f06-qa/f06-ortak-model.png` konumundadır.

Kaynak fonksiyonları ve bağımlılıkları her ölçü satırında bulunur. Üst ölçünün
derlenememesi altındaki desteklenmeyen ölçüden kaynaklanabilir. Fonksiyonun bir
engelli ölçüde görünmesi, o fonksiyonun tamamının desteklenmediği anlamına gelmez.
Özgün ölçü yerine sıfır/yer tutucu formül eklenmez.

## Kalan F06 işleri

| Sıra | İş | Kabul ölçütü |
|---|---|---|
| F06-2 | `SUMMARIZE`, `LOOKUPVALUE`, `CALCULATETABLE`, `TREATAS` ve gereken tablo bağlamları | Kur/belge/muhasebe ölçüleri aynı filtre ve ilişki altında bağımsız karşı örneklerle doğrulanır. |
| F06-3 | İsteğe bağlı boş argümanlar, `RANKX`/`TOPN`/`ADDCOLUMNS` ve sıralama bağlamı | Eşit sıralar, negatif/boş değer, müşteri seçimi, ABC ve ilk 10 payı test edilir. |
| F06-4 | Eksik alanlar ve ana veri: kur, sistem tutarları, ürün adı/grubu, maliyet kapsamı, vade/açık kalemler, finansal satır eşlemesi | Kaynak tane düzeyi korunur; toplam çoğalması ve eksik satınalma iadesi açıkça yönetilir. |
| F06-5 | Özgün ölçüler ve finansal sayfalar için Power BI mutabakatı | Aynı tarih/firma/muhatap/para birimi seçimleriyle ölçü bazında sonuç karşılaştırması; derleme başarısı yeterli değildir. |

F05 için kullanılabilir ortak alan ve ölçü temeli hazırdır. Yukarıdaki işler,
135 ölçünün tam geçişi tamamlanmış gibi kapatılmamalı.
