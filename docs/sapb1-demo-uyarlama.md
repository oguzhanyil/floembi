# SAP B1 Demo → Floem BI uyarlaması

Kaynak: yerel `powerbi-main/Demo/SAPB1Demo.pbip` ve maskelenmiş LocalDB `DEMO_FIRMA1`.
PBIP 18 sayfa ve 963 görsel tanımlar. Sayfalardan biri özel `asistan` görselidir.

## Oluşturulan dosyalar

| Dosya | İçerik | Kullanım |
| --- | --- | --- |
| `data/SAPB1Demo-Taslak.floem` | PBIP içe aktarıcısının 18 sayfalık, 905 görselli düzen taslağı | Özgün yerleşimi incelemek ve elle düzenlemek; tablolar boştur, ölçüler çalışmaz |
| `data/SAPB1Demo-Floem.floem` | Yerel demo verisiyle çalışan, düzenlenebilir 8 sayfa ve 150 görsel | Desktop'ta **Dosya aç** ile raporu incelemek |

Her iki `.floem` dosyası yereldir ve git tarafından dışlanır. Çalışan dosya bu makinedeki
LocalDB verisinin **anlık görüntüsünü** içerir; kaynak değişirse yeniden üretmek gerekir.

```powershell
.venv\Scripts\python -m floem_bi.pbip_import "..\powerbi-main\Demo\SAPB1Demo.Report" "data\SAPB1Demo-Taslak.floem"
.venv\Scripts\python -m floem_bi.demo_port "data\SAPB1Demo-Floem.floem"
```

İkinci komut yalnız `DEMO_FIRMA1` veritabanından `SELECT` yapar ve firma adını doğrular.
Kaynak veritabanına yazmaz. Çıktı yolundaki mevcut dosyanın üzerine yazar.

## Uygulanan kapsam

| PBIP sayfaları | Floem sayfası | Uygulanan alanlar / davranış |
| --- | --- | --- |
| Ana Menü | Genel | Satış, satınalma, fırsat, aktivite kartları; aylık satış; sayfa gezinme düğmeleri |
| Finansallar, Mizan | Mizan | `OJDT` + `JDT1` + `OACT`; borç, alacak, bakiye, dönem; hesap sınıfı/ana hesap/hesap Tree Grid |
| Cari Ekstre | Cari | `JDT1` + `OCRD`; muhatap, fiş, tarih, borç, alacak ve kaynak sırasına göre yürüyen bakiye |
| Satış ve Satınalma, Satış Analizi | Satış | Fatura, iade, sipariş satırları; net satış, sipariş, brüt kâr; tür dilimleyicisi |
| Satınalma Analizi | Satınalma | Fatura ve sipariş satırları; tutar, miktar, tedarikçi; tür dilimleyicisi |
| Satış Fırsatları, Satış Hunisi, Fırsat Performansı | Fırsat | Fırsat, aşama, durum, potansiyel ve ağırlıklı tutar; çubuk ve halka grafik |
| Muhataplar, Müşteri Analizi | Muhatap | `OCRD`; müşteri/tedarikçi türü, sayısı ve bakiye |
| Aktiviteler | Aktivite | `OCLG`; tür, durum, öncelik ve muhatap |

Görsellerde kart, çizgi/çubuk/halka grafik, dilimleyici, AG Grid tablo, Tree Grid,
metin, şekil ve sayfa gezinme düğmeleri kullanıldı. Sayfalar Desktop'ta düzenlenebilir.
Hesaplar basit kaynak toplamlarıdır; PBIP'deki ölçülerin birebir karşılığı olarak
sunulmaz. Satış ve satınalma tutarları satırların yerel para birimi tutarlarıdır;
PBIP'deki kur seçimi, belge/muhasebe mutabakatı ve bütün belge düzeyi indirimleri
uygulanmadı.

## Henüz taşınmayanlar ve Floem BI eksikleri

| Öncelik | Konu | Durum / yapılacak iş |
| --- | --- | --- |
| 1 | PBIP semantik model aktarımı | Mevcut içe aktarıcı yalnız rapor düzeni ve alan başvurularını taşır. 28 TMDL tablosunu, ilişkileri, 135 DAX ölçüsünü, hesaplanmış sütunları ve Power Query M bölümlerini içe alıp doğrulayan bir akış gerekli. Bu nedenle taslak dosya verisizdir. |
| 1 | Bilanço, Gelir Tablosu, Yaşlandırma | Bu üç PBIP sayfası çalışan dosyada yok. Hesap sınıflandırması, dönem karşılaştırması, vade kovaları ve finansal ölçüler kaynakla mutabakat yapılarak kurulmalı. Mizan grafiği bunların yerine geçmez. |
| 1 | DAX / FDX uyumu | Kaynaktaki `TREATAS`, `LOOKUPVALUE`, `PATHITEM`, `TOPN`, `ADDCOLUMNS` ve benzeri hesaplar otomatik çevrilmiyor. FDX `RANKX`, `TOPN` ve `ADDCOLUMNS` işlevlerini şu an açıkça desteklemiyor. `CALCULATE`, `SUMX`, `SWITCH`, `ALLSELECTED` için bazı destekler var; bütün kaynak ölçüleri tek tek test edilmeli. |
| 2 | Özgün grafik türleri | Power BI birleşik çizgi/sütun grafiği ve funnel için Floem'de aynı tür yok. İçe aktarıcı bunları düz sütun/çubuk olarak yaklaştırır; eksen, seri ve etiket ayarları birebir korunmaz. |
| 2 | Muhatap Kartı (360°) | Detaya git, ilişkili satış/fırsat/aktivite bileşimi ve sayfa filtresi çalışan dosyada kurulmadı. Floem'in mevcut drillthrough özelliğiyle ayrıca tasarlanmalı. |
| 2 | PBIP düzen sadakati | 18 sayfalık taslak özgün konumların çoğunu taşır; sayfa arka planı, resim kaynakları, yazı tipleri, şeffaf katmanlar, koşullu biçim ve özel etkileşimler için görsel karşılaştırma ve düzeltme gerekir. |
| 3 | Özel asistan | PBIP'deki `sapb1AsistanC7E2B94D1A` özel görselinin Floem karşılığı yok; taslakta yer tutucudur. |
| 3 | Büyük tablo sayfalama | Floem rapor tablosu sorgusu ilk 10.000 grupla sınırlıdır. Satınalma anlık görüntüsü 50.828 satırdır; tüm ayrıntıları gezmek için sunucu tarafı sayfalama/filtreleme gerekir. |

## Veri ve doğrulama

Yerel veritabanındaki isimler maskelenmiş, fırsatlar ve aktiviteler sahte olarak üretilmiştir.
Ancak kaynaktaki `Demo/sql/maskele.sql`, **kod, tutar ve tarihleri değiştirmediğini** açıkça
belirtiyor. Bu nedenle `.floem` anlık görüntüsünü genel erişime açmadan önce veri
paylaşımını ayrıca değerlendirin.

19.11.2026 tarihinde oluşturulan dosyada şu satır sayıları doğrulandı: Finans 2.947,
Cari 17.679, Satış 4.105, Satınalma 50.828, Fırsat 778, Muhatap 2.291, Aktivite 4.590.
Sekiz sayfanın 150 görseli tuval sınırları içindeydi. Değer kullanan 56 görsel sorgusunun
tamamı satır döndürdü; boş veya hatalı sorgu yoktu. Bu kontrol sorgu çalışmasını
doğrular, Power BI'deki tüm finansal sonuçlarla mutabakat anlamına gelmez.
