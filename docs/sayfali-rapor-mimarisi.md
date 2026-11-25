# Floem BI sayfalı rapor motoru

## Mimari

Desktop ve web aynı React bileşenleriyle çalışır. Mevcut fatura ve teklif şablonları kendi sürümlü biçimlerini korur. Genel amaçlı sayfalı rapor, veri kümesine bağlanan, milimetre cinsinden ölçülendirilmiş bölümler ve bu bölümlere yerleştirilmiş nesnelerden oluşur. Bir detay bölümündeki çizgi, her kaydın aynı fiziksel konumunda tekrarlanır.

Veri kaynağı katmanı seçilen model alanlarını satırlara dönüştürür. Bağlantı bilgileri rapor tanımına yazılmaz. Yayımlanan raporun veri istekleri sunucudaki mevcut rapor yetkileri ve veri rolleri üzerinden geçer. Formül değerlendirmesi yalnızca desteklenen işlemleri yürütür. Sayfalayıcı filtrelenmiş ve sıralanmış satırları bölüm örneklerine, bunları da sabit ölçülü sayfalara dönüştürür. Çıktı katmanı aynı sayfa koordinatlarını kullanır.

## Geliştirme sırası ve kabul ölçütleri

1. **Tanım ve kütüphane.** Şablon alanları, bölüm ve nesne kimlikleri, sürümlü arşiv ve geri açma. Eski belgeler okunabilmeli, kopya bağımsız düzenlenebilmeli.
2. **Veri ve ifadeler.** Model alanı bağlama, parametre seçenekleri, gruplama, sıralama, formül ve toplam kapsamları. Farklı veri tipleri, boş değer ve eksik alan test edilmeli.
3. **Sayfalama.** Yedi bölüm türü, iç içe grup, grup kırılımı, yinelenen başlık ve sayfa sayacı. Grup ve rapor toplamları sayfa geçişinde çift yazılmamalı.
4. **Tasarım.** Desktop belge tasarımcısında cetvel, ızgara ve fiziksel ölçülü tuval. Kullanıcı alan yerleştirebilmeli, nesne taşıyıp boyutlandırabilmeli, detay satırının içine çizgi çizebilmeli.
5. **Bileşik nesneler ve çıktılar.** Bağlı alt rapor, çapraz tablo, koşullu biçim, barkodlar ve beş çıktı biçimi. Baskı önizlemesi ile PDF sayfa sayısı ve konumları karşılaştırılmalı.
6. **Yayımlama ve uçtan uca doğrulama.** Kaydet, yeniden aç, parametre seç, önizle ve dışa aktar akışları örnek veriyle çalıştırılmalı. Sunucu tarafında yetkiler ve veri erişimi ayrıca test edilmeli.

## Tasarım ve kullanım

Desktop'ta **Belge Tasarımcısı → Sayfalı raporlar** sekmesini açın. **Serbest sayfa** boş bir A4 çalışma alanı verir. **Her kayıt için bir form** aynı tasarımı veri kümesindeki her kayıtta yineler. **Veri listesi** ilk dört alanla başlık ve detay bölümlerini oluşturur. Bağlantısız belgeyi sonradan bir model tablosuna bağlayabilirsiniz.

Metin kutusunu araçlardan sürükleyin, çift tıklayıp yazın. Köşe tutamacı boyutu değiştirir. Ok tuşları nesneyi 1 mm, Shift ile 5 mm kaydırır. Nesneyi başka bir bölüme sürükleyebilir veya **Bölüme taşı** listesini kullanabilirsiniz. **Bölümdeki nesneler** listesinden üst üste gelen kutuları seçin. Öne getirme, arkaya gönderme, çoğaltma, kilitleme ve geri alma işlemleri tasarım araçlarındadır. Parametreler izleyicide görünür. **Yeni sürüm başlat** geçerli düzenin bir kopyası üzerinde çalıştırır. **Ctrl+S** kütüphaneyi belgeye kaydeder.

Hazır **Fatura** ve **Teklif** sekmelerinde de başlığa tıklayın, sürükleyin veya köşesinden boyutlandırın. **Metin kutusu ekle** ile belge başlığında, kalemlerden önce veya alt bilgide alan bağlantılı metin oluşturun. Örneğin kutuya `Teslim alan: {CardName}` yazın. Yinelenen kalem içeriği için **Detay satırını düzenle** aracını kullanın.

## Uygulama sınırları ve veri yolu

- Şablon ve sürüm doğrulaması `paginated/schema.py`, RLS uygulanmış model satırları `source.py`, koşullar ve hesaplar `formula.py`, iç içe gruplar ve fiziksel sayfa akışı `pagination.py` içindedir. Her biri bağımsız çalıştırılabilir.
- Bir alt rapor kütüphanedeki rapora kimliğiyle bağlanır. Tasarımcı ana anahtarı ve alt kaydın alanını seçer. Çapraz tablo her farklı sütun değerine bir sütun açar ve kesişimdeki değerleri toplar. Her iki nesne de detay veya toplam bölümünün sonunda sonraki sayfalara akabilir.
- Model SQL Server tablosu, görünüm veya salt okunur sorgudan beslenebilir. **SQL sorgusu → Saklı yordamdan veri al** ekranı kullanıcı tarafından seçilen yordamı sıralı, bağlanmış parametrelerle çağırır. İlk sonuç kümesi belgeye kaydedilir. Yordamı tekrar çalıştırmak için aynı içe aktarım ekranı kullanılır.
- Web raporu ve Floem App öğesi, yayımlanan sürümün kütüphanesini kullanır. Veri satırları ve dinamik seçim listeleri oturum sahibinin veri rolleriyle üretilir. Sayfalama için kaynak başına 100.000 satır ve çıktı başına 1.500 sayfa sınırı vardır. Sınır aşılırsa işlem okunabilir bir hata verir.
- SVG çizimleri ve metin koordinatları önizleme, PDF, HTML ve Word için ortaktır. Word dosyasında metinler düzenlenebilir kutular olarak bulunur. Excel ve CSV aynı sayfalardaki görünür satırları ve toplamları tablosal biçimde aktarır.
- `.floem` arşivindeki `paginatedReports.json` sürüm 5 ile eklenir. Hazır fatura/teklifte serbest metin kutuları kullanıldığında biçim sürümü 6 olur. Önceki sürümler yüklenebilir.

Bölüm sıralaması ve tekrar kapsamları için [SAP Crystal Reports tasarım alanları](https://help.sap.com/docs/sap_crystal_reports_for_enterprise/5e655af038844318b5686fe80d91af27/478eb4626e041014910aba7db0e91070.html) ve [SAP yürüyen toplam yerleşimi](https://help.sap.com/docs/SAP_CRYSTAL_REPORTS/dfc124becfa845ffa91b1e717b20e3ec/4776b79e6e041014910aba7db0e91070.html) esas alınmıştır.

## Örneği yeniden üretme

Depo kökünde, yeni bir çıktı adıyla çalıştırın.

```powershell
.venv\Scripts\python -m floem_bi.demo.sayfali_rapor data\Belge-Demo.floem data\Sayfali-Rapor-Ornegi.floem
```

Kütüphanede fatura dökümü, ona bağlı fatura kalemleri, iç içe depo/stok özeti ve A3 yatay çapraz tablo bulunur. Fatura numarası alanında FAT-0200 seçilidir. Altı sayfada 182 kalem ve son sayfada 33.061,80 TL genel toplam kontrol edilebilir.
