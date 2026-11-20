# F11 · Veriyle yaşayan kullanıcı tasarımları

F11, kullanıcının çizdiği kart ve bileşenleri alanlara/FDX ölçülerine bağlar.
Aynı tanım Desktop tasarım/etkileşim görünümünde ve web görüntüleyicisinde çalışır.
Yeni bağımlılık eklenmedi; dosyada kayıt başına binlerce tasarım nesnesi üretilmez.

## Deneme

Güncel kodla Desktop'ı yeniden açın; **Aç / Ctrl+O** ile
`data/F11-Tasarim-Atolyesi.floem` dosyasını seçin. Dosya üç sayfa ve 12.050
tamamen sentetik müşteri içerir; harici kaynak veya yenileme bağlantısı yoktur.

1. **Müşteri 360:** aramada `12049` yazın. Kart seçimi sağdaki toplamı filtreler.
   **Müşteriyi incele** seçilen müşterinin bütün gruplama alanlarını detay sayfasına taşır.
2. **Müşteri detayı:** müşteri adı tek alan bağıyla, bakiye FDX ölçüsüyle gösterilir.
   Bir müşteri seçmeden bu sayfaya doğrudan geçerseniz ad bağı çoklu değer uyarısı verir.
3. **Tasarım atölyesi:** örnek kart müşteri 0'a filtrelidir. Tasarımı düzenleyebilirsiniz.
   Kitaplığa şablon kaydederken bağ kaynaklarını **Tekrarlayıcının mevcut satırı** yapın.
   Gömülü **Müşteri 360 kartı** hazır bir satır şablonudur.

Yeni bir dosya üretmek için:

```powershell
.venv\Scripts\python -m floem_bi.runtime_demo data/F11-Yeni.floem
```

Komut mevcut dosyanın üstüne yazmaz. Örnek `.floem` ve QA ekranları git dışında kalır.

## Veri bağları

Nesneyi seçin → **Görselleştirmeler → Biçim → Veri bağları**.

| Hedef | Davranış |
|---|---|
| Metin | Metin, şekil, düğme içeriği; kart/sayaçta kategori etiketi. `{value}` şablonu kullanılabilir. |
| Değer | Kart, sayaç veya metin nesnesinin değeri. Sayı, sıfır, yanlış ve boş birbirinden ayrılır. |
| Zemin/yazı rengi | Doğrudan renk alanı veya koşul çıktısı; `#RRGGBB` / `transparent`. |
| Simge | Simge ve düğme nesnelerinde hazır ikon adları. |
| Görünürlük | Doğru/yanlış çıktı; kapsayıcı gizlenince çocukları da gizlenir. |

Kaynak **FDX ölçüsü/toplanmış sütun**, **tek alan değeri** veya **mevcut satır** olabilir.
Tek alan sorgusu iki farklı değer bulursa rastgele ilkini seçmez; filtreleme/toplama
gerektiğini söyler. Bağlar nesne, rapor, dilimleyici, çapraz seçim ve sunucudaki RLS
kapsamını kullanır. İlk eşleşen koşul kazanır. Sayısal karşılaştırmalar yalnız sayılar
arasında yapılır; metin kodları ve doğru/yanlış değerleri açıkça seçilir.

Boş/eşleşmeyen çıktı için yedek değer verilebilir. Aynı nesnenin aynı sorguyu kullanan
bağları tek isteği paylaşır; filtre/sürüm değişiminden sonra eski yanıt ekrana uygulanmaz.
Bağ sonucu ve durum önizlemesi rapor tanımına yazılmaz. Metin HTML olarak çalıştırılmaz;
renk ve ikon çıktıları doğrulanır, özel JavaScript çalıştırma eklenmemiştir.

## Nesne durumları

**Normal, üzerine gelme/klavye odağı, seçili, yükleniyor, boş veri ve hata** için
metin, renk, kenar, opaklık ve simge tanımlanabilir. Öncelik hata/yükleniyor/boş →
seçili → üzerine gelme → normaldir. Simge, ikon destekleyen içerikte ve durum mesajında görünür.
**Tasarımda dene** yalnız editör önizlemesini değiştirir. Hata ayrıntısı ve tekrar deneme
korunur. Çok küçük hata kutularında ayrıntı kırpılabilir; tam metin ayrıntının ipucundadır.

Veri kuralıyla gizli nesne tasarımda soluk bir işaretle düzenlenebilir; etkileşim/web
görünümünde görünmez. Gizleme bir yetkilendirme yöntemi değildir. Akışta ayrılmış alan
korunur; koşula bağlı olarak komşuları yeniden yerleştirme bu aşamada yapılmıyor.

## Kullanıcının çizdiği satır kartları

1. Kapsayıcı içinde metin, şekil, resim, düğme, simge, kart ve sayaç tasarlayın.
2. Bağ kaynaklarını **mevcut satır** seçin; bileşen kitaplığına kaydedin.
3. **Satır tekrarlayıcı** ekleyin. Satır kimliği/alanlarını gruplama kutusuna, ölçüleri
   değer kutusuna bırakın. Şablonun ihtiyaç duyduğu her alan ve ölçü bu kutularda olmalı.
4. **Biçim → Satır tekrarlayıcı** bölümünde bileşeni seçip yuvaları eşleyin ve
   **Şablon eşlemesini uygula** düğmesine basın. Eksik eşleme kayda gönderilmez.
5. Kart yüksekliğini, sayfa boyutunu, aramayı ve eyleme taşınacak alanı ayarlayın.

Satır kimliği bütün gruplama değerlerinden üretilir. Tekrarlayıcı 25–500 gruplu sunucu
sayfaları getirir; o sayfanın da yalnız görünür kartlarını ve iki kart tamponunu çizer.
Şablonlar satır verisinden okunur; kayıt başına ağ sorgusu göndermez. Grafik, tablo,
iç içe tekrarlayıcı ve bağımsız ölçü sorgusu çalıştıran bağlar satır şablonuna alınmaz.

Satır seçimi diğer nesneleri filtreler. Şablon düğmeleri URL'ye kodlanmış değer taşır,
tam satır filtresiyle detay sayfası açar veya kayıtlı FDX işlevini çalıştırır. Şablon içi
göster/gizle durumu o satıra aittir. Yalnız HTTP(S) bağlantıları ve mevcut tanımlı
işlevler kullanılır; kaynağa yazan işlem eklenmedi.

Kart yuvası sabit yüksekliktedir (64–1.200 px); şablon en/boya orantılı sığdırılır.
Uzun metinde kırpma/sığdırma seçiminizi ve dar ekranda yazı boyutlarını kontrol edin;
F08 düzen varyantlarıyla uygun nesne genişlikleri tasarlayın. Otomatik değişken satır
yüksekliği ve duvar düzeni bu teslimin kapsamında değildir.

Sağ tıkta **bu sayfa / tüm eşleşen satır verisi** PDF, Excel ve CSV olarak indirilebilir.
CSV/Excel 100.000, PDF 2.000 grup sınırına, sürüm doğrulamasına ve iptale uyar.
İndirilen içerik **düz satır verisidir**; tasarlanmış kartların sayfa PDF'i değildir.

## Hareket

Biçim panelinde kapalı, görünme, giriş, **değer değişince vurgu** ve kart/sayaç için
**sayıyı canlandır** seçenekleri bulunur. Vurgu sonsuz tekrarlanmaz; sayı hızlı
değişimlerde mevcut ara değerden son hedefe ilerler. Süre 150–3.000 ms ile sınırlıdır.
İşletim sistemi veya tema hareket azaltmayı seçince hareket durur. Arka plandaki
sekmelerde sayaç doğrudan son değere geçer; zamanlayıcılar kaldırılırken temizlenir.

## Doğrulama ve sonraki iş

Şema/yuva doğrulaması, yeniden adlandırma, `.floem` aç/kaydet ve sunucu yayını,
RLS'li bağ/tekrarlayıcı sorguları Python testlerindedir. Saf TS testleri kural tiplerini,
eşlemeyi, değişmez bileşenleri ve sanallaştırma aralığını sınar. Gerçek Chromium
testleri filtre/sıfır/boş/hata/tekrar deneme, eski yanıt, görünürlük mirası, durum paneli,
12.050 grupta arama, sınırlı DOM, satırda URL/detay/gizleme ve tüm satırların CSV
aktarımı, azaltılmış hareket ve dar ekran davranışını doğrular.

Son koşu: **307 Python geçti, 1 atlandı; 59 saf TS testi; tam Chromium; typecheck;
Desktop ve web üretim derlemeleri başarılı.** Ekran/günlükler yerel `data/qa-f11/` içinde.

```powershell
.venv\Scripts\python -m pytest tests/test_runtime_bindings.py -q
node tests/design/run.mjs
$env:FLOEM_UI_RUNTIME_ONLY='1'; node tests/ui/run-smoke.mjs
```

Sıradaki iş **F13: tasarım ve anlam denetçisi**. Küçük yazı, taşma, eksik bağ,
birim/toplama ve veri kapsamı uyarıları tasarımı kendiliğinden değiştirmeden gösterilecek.
F06-2–5 kaynak ölçü/motor/mutabakat işleri açık; gerçek süreç pilotları F12 kapsamındadır.
