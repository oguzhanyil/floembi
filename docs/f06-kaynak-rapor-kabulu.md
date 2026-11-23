# Power BI raporlarının FDX kabulü

23 Kasım 2026. Desktop, kaynak modelin tablo ve sütunlarını, desteklenen ilişkilerini, özgün ölçü adlarını ve ifadelerini düzenlenebilir bir Floem belgesine alır. Kaynak ölçüleri, açık belgenin içe aktarılmış veri kopyası üzerinde FDX motoru hesaplar.

## Test dosyaları

Depoda `npm run desktop` ile Desktop'ı yeniden başlatın. **Aç / Ctrl+O** ile aşağıdaki yerel dosyaları seçin. Daha önce kaydedilen bir `.floem` dosyasının tasarımını güncellemek için kaynak projeyi yeniden açıp ayrı kopya kaydedebilirsiniz.

| Dosya | Neyi deneyebilirsiniz |
|---|---|
| `data/FDX-Test/SAPB1Demo.floem` | 17 sayfa, 28 tablo, 23 ilişki, 135 ölçü ve 542.926 kaynak satırı. Satış Analizi, Satış Hunisi ve Müşteri Analizi sayfaları. |
| `data/FDX-Test/DinamikFinans.floem` | 2 sayfa, 8 tablo, 3 ilişki, 22 ölçü ve 68.165 kaynak satırı. Yıl ve firma seçimiyle bakiye ve fiş sayısı. |
| `data/FDX-Test/Ornek/*-Sentetik.floem` | Kaynak önbelleği bulunmayan beş yönetim, üretim ve kâr/zarar projesinin ayrı örnek kopyaları. Ana klasörde bu projelerin özgün, verisiz modelleri yer alır. |
| `data/FDX-Test/HITInsights-B1-NMT.floem` | Ek PBIX örneği. 9 sayfa, 734.680 satır ve derlenen 48 ölçü. MasterPage görünürlük düğmeleri, açılır dilimleyiciler ve grup yerleşimi. |

Aynı klasördeki **Test-rehberi.md** filtre seçimlerini ve beklenen örnek tutarları içerir. **Alan-eslemeleri.md** ve JSON dökümü başvuruları gösterir. **Dallar.md** dört daldaki 26 proje sürümünü, aynı rapor ve model tanımını paylaşan kopyaları birleştirerek 14 dosyayla eşler. **FDX-olculeri.json** formülleri ölçü adı, tablo, proje ve dal ile birlikte listeler. Veri dosyaları, tutarlar ve referans sonuçları yalnız yerel test klasöründedir.

## Ölçüler ve mutabakat

Dört dalda 260 farklı kaynak DAX ifadesi derlendi. Ana dalın yedi modelinde 338 ölçü tanımı var. Üretim ve test projeleri bazı formülleri paylaşır. Ana daldaki 251 farklı ifadeye önceki dallardan 9 ifade eklenir.

| Karşılaştırma | Power BI referansı | Kapsam |
|---|---|---|
| 449 ölçü sonucu | İki kaynak projenin kendi veri kopyaları | SAPB1Demo'da 135 ölçü × 3 filtre durumu. DinamikFinans'ta 22 ölçü × 2 durum. Genel, 2025 ve firma, ayrıca SAP'de 2025, muhatap ve USD. |
| 12 müşteri satırı sonucu | SAPB1Demo kaynak kopyası | Aynı üç müşteriyle gruplanmış net satış, ABC sınıfı, kümülatif satış payı ve ilk 10 müşteri payı. |
| 10 müşteri ve tutar | SAPB1Demo kaynak kopyası | Satış Analizi sayfasındaki ilk 10 sıralamasında hem müşteri kümesi hem her müşterinin net satışı Power BI ile eşleşti. Tek müşteri ekseninde sıra ve birikimli pay hesapları seçili müşteri puanlarını paylaşır. |
| 181 ölçü sonucu | İki motora aynı sentetik satırlar verilerek | Ana daldaki önbelleksiz beş modelin özgün ölçüleri. |
| 9 eski sürüm sonucu | Eski model ve ilişkilerle aynı sentetik satırlar | Önceki dallara özgü dokuz ifade. Üçü bu örnek seçimde iki motorda da boş döner. |

Power BI referansları ayrı bir Desktop örneğinin Analysis Services motorundan alındı. Floem tarafında kayıtlı dosya yeniden açıldı ve raporların kullandığı görsel sorgular çalıştırıldı. Tutar olarak işaretlenen ölçülerde mutlak tolerans 0,005 para birimi, tam sayı adetlerde doğrudan eşitlik kullanılır. Oranlarda kayan nokta hassasiyeti, zaman alanlarında iki motorun tarih çözünürlüğü hesaba katılır. Kaynaktaki boş değer korunur.

Aynı denetimi yerel referansla tekrarlamak için depo kökünde çalıştırın.

```powershell
.venv\Scripts\python -m floem_bi.reconciliation data\FDX-Test\SAPB1Demo.floem data\qa-f06-gecis\SAPB1Demo-yil.json --output data\FDX-Test\Tekrar-kontrol.json
```

Referans JSON'u `filters` içinde tablo/sütun/değer üçlüleri, `values` içinde ölçü adı ve beklenen değer içerir. `moneyMeasures` ve `countMeasures` ile ölçünün karşılaştırma kuralı seçilebilir. Komut herhangi bir fark veya sorgu hatasında sıfırdan farklı kod döndürür.

## Alan eşlemesi ve tasarım

**Alan eşlemesi**, örneğin bir ağaç haritasında kategorinin `Kalem[KalemGrubu]`, değerin `[Net Satış]` ölçüsü olduğunu kaydeder. Böylece her ürün grubu için net satış kendi filtre bağlamında hesaplanır. Yedi ana modelde görsellerin 929 alan başvurusu eşlendi. Eksik bir görsel alanı aynı tablodaki geçerli verilerin okunmasını engellemez. Gerçek veri yüklendiğinde boş sorgu sonucuna taslak önizlemesi çizilmez.

- Sütun ve çizgi serileri aynı birleşik grafikte ayrı alanlara bağlanır. Huni aşamaları ve ağaç haritası grup/değer rolleri düzenlenebilir.
- Sabit paragraf hizaları ve metin parçalarının yazı tipi, boyutu, rengi, kalınlığı, italikliği ve alt çizgisi taşınır. Biçim panelinden seçili metnin görünümü değiştirilebilir.
- Yeni kartların etiket/değer düzeni, hassasiyeti ve desteklenen görüntü birimleri taşınır. Çoklu kartta kaynak sütun sayısı uygulanır.
- Gömülü temanın renk paleti, desteklenen Inforiver açılır dilimleyicileri ve hedefi çözülebilen görünürlük yer işaretleri yerel nesneye dönüşür. Aynı sayfadaki menü eylemi mevcut seçimi korur.
- Görsel hesaplar, filtre durumunu geri yükleyen yer işaretleri, koşullu biçimler ve özel görsellerin kendine özgü davranışları ayrıca değerlendirilir. HITInsights'taki bir gizli görsel hesap bu kapsamdadır. HITInsights'ın mali sonuçları için bağımsız bir karşılaştırma yapılmadı.

Sanal tablo, sıralama, kur arama ve bağlam geçişleri bu teslimde DuckDB içe aktarım motorunda doğrulandı. T-SQL DirectQuery, canlı ERP verisi ve farklı şirketlerin aynı kurumsal modelde birleştirilmesi için ayrıca kaynak kabulü gerekir. Eski sadeleştirilmiş F06 ortak modelinin kendi alan haritası geçerlidir. [Ortak modelin tanımı](f06-ortak-model-ve-olcu-gecisi.md)
