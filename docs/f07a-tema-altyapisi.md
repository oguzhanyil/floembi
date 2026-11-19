# F07A: tema altyapısı ve karşılaştırma

## Kullanım

- Desktop başlık çubuğundaki **◐ Tema**, uygulamanın renk ailesini, açık/koyu görünümünü,
  yoğunluğunu ve azaltılmış hareket tercihini ayarlar. Web'de giriş ekranı ve üst çubukta da bulunur.
  Tercih cihazın/tarayıcı profilinin yerel depolamasında saklanır.
- **Görselleştirmeler → Rapor teması**, raporun kendi temasını seçer. Raporu kaydedip
  yayımladığınızda tema değerleri dosyayla birlikte taşınır; Desktop ve web aynı değerleri kullanır.
- **10 temayı karşılaştır**, beş ailenin açık/koyu görünümlerini aynı örnek veride gösterir.
  Oturum açma ve tasarım araçları örneklerinin yanında gerçek kart, grafik, AG Grid ve ağaç tablo
  bileşenleri kullanılır. Aile düğmeleri iki görünümü birlikte değiştirir.
- Nesneye özel renkler/biçimler tema değerlerinden önceliklidir. **Biçim → Görünüm → Temadan al**,
  nesnenin renk, tipografi, köşe, boşluk, gölge ve süre istisnalarını temizler; içerik, veri bağları,
  konum ve eylemler korunur. Sayfaya özel zemin rengi ayrıca korunur.
- Eski raporlar otomatik yeniden renklendirilmez; uygulama temasından bağımsız açık bir kapsamda
  gösterilir. Tema atandıktan sonra miras alınan değerler etkinleşir.

## Tasarım sözleşmesi

Electric Blue, Midnight Indigo, Emerald Intelligence, Arctic Cyan, Graphite & Orange aileleri
birer adaydır; kalıcı marka seçimi yapılmadı. Okunurluk için bazı ham marka renklerinin açık
görünümde daha koyu, koyu görünümde daha açık eşleri kullanılır.

`theme.tsx` yüzey/metin/kenar/aksiyon/seçim/başarı/uyarı/hata/bilgi rollerini, sekiz seri rengini,
sistem fontlarını, tipografi rollerini, 4–64 px boşluk ölçeğini ve 30/38 px satır yoğunluğunu
tanımlar. İş durumlarının renkleri tema ailesinden bağımsızdır. Merkezi odak halkası ve hareket
tercihi bulunur. Sistem hareket azaltma tercihi de desteklenir; raporda azaltılmış hareket
sayısal sayaçları ve grafik animasyonlarını kapatır.

Rapor `theme` alanı kimlik, sürüm, açık/koyu, renk değerleri, seri paleti, yoğunluk ve hareket
tercihini taşır. Tema biçime yalnız çizim sırasında uygulanır; varsayılanlar nesne tanımlarına
yazılmaz. `ThemeSnapshot` Python şeması renkleri `#RRGGBB` biçimiyle doğrular. Eksik renk rolleri
sürüm 1 ailesinin varsayılanlarından tamamlanır. Yeni bağımlılık eklenmedi.

## Doğrulama ve sınırlar

- 20 hedefli Python testi: tema JSON gidiş/dönüşü, eski raporlar, geçersiz sürüm/renk, mevcut sorgular.
- Chromium: 10 gerçek önizleme, metin/ikincil metin/durum/düğme eşlerinde en az 4,5:1 kontrast;
  uygulama/rapor ayrımı, nesne istisnası, Temadan al, hareket ve yoğunluk kaydı, web görünümü.
- Önceki 26 nesne menüsü, matris/Excel ve viewport regresyonları geçti.
- TypeScript ve Desktop/web üretim derlemeleri başarılı; mevcut paket boyutu uyarısı sürüyor.
- Tema karşılaştırması bir örnek ekranıdır; bütün uygulama sayfalarının görsel onayı veya
  fiziksel Windows DPI/çoklu monitör testi yerine geçmez. Eski sabit renkli özel nesneler
  kullanıcı Temadan al seçeneğini kullanana kadar kendi stillerini korur.

Sonraki ana teslim **F10: PBIP uyumluluk ve kayıp raporu**; ardından F06, F05 ve F07B.
