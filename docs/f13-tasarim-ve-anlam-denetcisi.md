# F13: tasarım ve anlam denetçisi

20.11.2026: Desktop tasarımcısında **Görselleştirmeler → Tasarımı denetle** hazır.
Denetçi bulguları listeler; raporu, modeli ve kullanıcı tasarımını değiştirmez.
Yayımlama önünde zorunlu bir kontrol oluşturmaz.

## Kullanım

1. Bir rapor açın. Görselleştirmeler panelinde **Tasarımı denetle** düğmesine basın.
2. Hata/uyarı/bilgi, kategori, sayfa ve metin aramasıyla listeyi daraltın.
3. Her bulguda **Gerekçe**, **Öneri** ve dayanak (**Tanım**, **Ölçüm**, **Çalışma zamanı**) bulunur.
4. **Nesneye git** tam sayfayı ve kayıtlı ekran düzenini açar, nesneyi seçer ve Biçim paneline geçirir.
5. **JSON indir** tüm bulguları aktarır; ekrandaki arama/filtre yalnız listeyi sınırlar.

Liste ilk 100 bulguyu gösterir; sonraki yüzlük gruplar elle açılır. Escape veya Kapat
ile çıkılabilir. Denetleme ve bulguya gitme kayıt/geri alma adımı oluşturmaz.

## Denetimler ve yorumları

| Alan | Kontrol | Yorum |
|---|---|---|
| Yerleşim | Sayfa dışı nesne, akış kapsayıcısının taşması, kırpan ebeveyn | Tüm kayıtlı düzenler kendi çözülmüş koordinatlarıyla incelenir. Serbest üst üste yerleşim hata değildir. |
| Yazı | Açık ayarda 12 px altı yazı; görünür metinde gerçek taşma ve küçük boyut | Tuval yakınlaştırması ve DPR yazı boyutundan ayrılır; tekrarlayıcı şablonunun kendi küçülmesi hesaba katılır. |
| Bağlar | Eksik sütun/ölçü, zorunlu bölme, satır bağlamı, tekrarlayıcı şablonu/sürümü/eşlemesi | Kart/sayaçta değer bağı geçerlidir. Semantik motor gibi model adları harf duyarsız karşılaştırılır. |
| Eylem | Eksik hedef sayfa/nesne/FDX ölçüsü, geçersiz web adresi veya satır kaynak sütunu | Menü alt eylemleri ve şablon içindeki yerel göster/gizle hedefleri de kontrol edilir. Eylem çalıştırılmaz. |
| Birim | Ortak eksen veya KPI/hedef karşılaştırmasında açık biçim birimleri | Yalnız `%`, TRY/TL/₺, USD/$, EUR/€ çıkarılır. Ayrı tablo sütunlarında farklı birimler normaldir. Bilinmeyen birim hata sayılmaz. |
| Toplama | Anahtar/varsayılan özet ile SUM seçimi arasındaki olası uyuşmazlık | İş kuralı kontrolü isteyen uyarıdır. Ölçü adı üzerinden yanlış hesap kararı verilmez. |
| Toplam | Ortalama, farklı sayım ve oran işareti taşıyan değerler | Toplam kendi bağlamında hesaplanır; görünen satırları toplamaması hata kanıtı değildir. FDX metin kontrolü tam ifade analizi değildir. |
| Kapsam | Statik sorgu sınırı ile gözlenen gerçek kesilmenin ayrılması | Sınır varlığı bilgi; çalıştırılan sorgunun kesilme bildirmesi uyarıdır. Sayfalı `truncated` sonraki sayfaları temsil eder, veri kaybı sayılmaz. |
| Canlı durum | Açık nesnenin sorgu/bağ hatası veya boş sonucu | Sıfır boş değildir. Yeni veri sürümü/sayfa/düzen/rapor tanımı eski gözlemleri geçersiz kılar; tekrar denemeden sonra durum güncellenir. |

Sunucu sayfalı Grid/Tree Grid ve tekrarlayıcı için genel toplamın **rapor filtreleri**
kapsamında olduğu belirtilir. Sonuç içi arama/sütun filtresi bu toplamı değiştirmez.
CSV/Excel 100.000, PDF 2.000 satır sınırı ve tekrarlayıcı aktarımının düz veri olduğu hatırlatılır.

## Kapsam sınırları

- Statik denetim tüm sayfa ve kayıtlı varyantları kapsar. Açık düzende büyüyen metnin
  gerçek yerleşim yüksekliği kullanılır; açılmamış düzenlerde yalnız kayıtlı minimumlar bilinir.
- DOM ölçümü panel açıkken, açık düzenin yüklenmiş metin/kart/sayaç/başlık/düğme
  metninde yapılır. Gizli başlıklar, hata/yüklenme/boş yer tutucuları ve tablo veri
  kaydırması metin taşması sayılmaz. Kaydırma açıkça seçilmişse taşma bilgi düzeyindedir.
- Tüm kayıtlar DOM'a yüklenmez. Sanallaştırılmış tekrarlayıcının görünmeyen satırları,
  açılmamış ağaç dalları ve açılmamış düzenlerin gerçek yazı ölçümü kapsam dışıdır.
- Denetçi yeni veri sorgusu çalıştırmaz. Mevcut sorgu kancaları yalnız durum, sayı ve
  kesilme metadatası bildirir. Kayıtlar, filtre değerleri, URL içerikleri ve ham sorgu
  hataları toplayıcıya/JSON'a eklenmez. Sayfa, nesne ve model alan adları bulguda bulunur.
- Kontrast/erişilebilirlik belgesi, tüm grafik etiketlerinin piksel analizi, ilişki
  tane düzeyi ispatı, kaynak FDX motor mutabakatı ve otomatik düzeltme bu teslimde yoktur.
  F06-2–5 kaynak ölçü/motor/mutabakat işleri açık kalır. Bir bulgunun yokluğu kusursuzluk garantisi değildir.
- Rapor dosya şemasına bulgu eklenmez. Paylaşılan sorgu kancaları web derlemesinde de
  çalışır; denetçi başlatıcısı düzenleme tasarımcısındadır, web görüntüleyicisine yeni araç eklenmedi.

## Sentetik örnek

Yerel dosya: **`data/F13-Tasarim-Denetimi.floem`**. Dört sayfa, bir telefon varyantı,
12.050 sentetik müşteri ve gömülü müşteri kartı içerir. İlk sayfadaki küçük yazı,
taşma, kayıp ölçü ve tutar/yüzde hedef karşılaştırması bilerek bırakıldı.
Diğer üç sayfa F11 tasarım atölyesinin çalışan örnekleridir; gerçek kaynak bağlantısı yoktur.

Yeni dosya üretmek için (var olan dosyanın üstüne yazmaz):

```powershell
.venv\Scripts\python -m floem_bi.inspector_demo data\F13-Yeni.floem
```

## Doğrulama

Saf TypeScript testleri; salt okunurluk, varyant hedefleri, birim/toplama ayrımları,
eksik referanslar, sorgu kesilmesi ile normal sayfalama farkı ve canlı durumları kapsar.
Gerçek Chromium testleri metin/DPR/zoom, arama, veri sürümü sonrası yenilenme,
gizli kayıt/hata içermeyen JSON, doğru nesneye gitme, Escape, 135 bulgulu liste ve
390 px panel düzenini sınar. Python testi demo dosyasını yeniden açar, gömülü kayıtları
ve önceki hedefin korunmasını doğrular. Mevcut Python/tasarım/arayüz kontrolleri,
typecheck ve Desktop/web üretim derlemeleri birlikte çalıştırılır.

Sonuç: **308 Python geçti, 1 atlandı; 72 saf TypeScript testi**, tam Chromium koşusu,
typecheck ve her iki üretim derlemesi geçti. Şablon ve sayfa nesnelerinin aynı kimliği
kullanması durumunda canlı bulgunun doğru tekrarlayıcıya ait olduğu da doğrulanır.
Yerel ekran görüntüsü ve günlükler `data/qa-f13/` altındadır; veri dosyaları git dışındadır.

Sıradaki aşama **F12: müşteri 360° ve parti/kalite süreç pilotları**. F13 iş kurallarının
doğrulanmasını destekler; kaynak ölçü geçişini ve gerçek pilot mutabakatını tamamlanmış saymaz.
