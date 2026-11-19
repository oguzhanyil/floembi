# F10: Power BI aktarımında uyumluluk ve kayıp raporu

Uyumluluk bulgularını sonraki işlere dönüştüren [geliştirme listesi](pbip-bulgularindan-gelistirme-listesi.md):
başlangıç görünümü, tuval zemini ve tuval dışı alanın renk/şeffaflık desteği; öncelik ve kabul ölçütleriyle planlandı.

## Kullanım

Yeni içe aktarılan dosyada **Görselleştirmeler → Power BI aktarım raporu** açılır. Sayfa,
kaynak nesne türü/kimliği, hedef nesne, alan rolü/başvurusu ve bulgular listelenir. Arama ve
durum filtresi bulunur; **Nesneye git** ilgili sayfayı açıp nesneyi seçer. Web görüntüleyicisi
raporu okuyabilir ve JSON indirebilir. İndirilen JSON, ekrandaki arama filtresinden bağımsız tam envanterdir.

Rapor, aktarım anının geçmiş kaydıdır. Kullanıcı nesneyi sonradan düzelttiğinde kendiliğinden
başarılıya dönüşmez. Silinmiş hedefe gidilmeye çalışılırsa açıklama gösterilir.

Durumlar:

- **Yerleşim eşlendi:** incelenen yerleşim için bulgu yok. Tam biçim/hareket/hesap eşdeğerliği onayı değildir.
- **Kısmi:** desteklenen nesne türünde alan başvuruları veya filtre/biçim/eylem/sorgu kayıpları vardır.
- **Desteklenmiyor:** eşdeğer uygulama yoktur. Özel görsel, birleşik çizgi/sütun ve huni,
  başka grafik anlamına çevrilmeden uyarılı metin yer tutucusu olarak gösterilir.
- **Atlandı:** eylemsiz saydam tıklama katmanı gibi bir kaynak nesne için hedef oluşturulmamıştır.

Alan başvurusu taşınsa bile veri tipi/model/hesap doğrulanmadığından “başvuru / taslak” olarak
gösterilir. Özgün ölçü formülü, filtre değerleri ve kaynak bağlantısı bu rapora kopyalanmaz.

## Komut satırı

```powershell
# Düzenlenebilir boş verili taslak + uyumluluk JSON/Markdown
.venv\Scripts\python -m floem_bi.pbip_import "..\powerbi-main\Demo\SAPB1Demo.Report" "data\SAPB1Demo-Taslak-F10.floem"

# .floem oluşturmadan kaynak depodaki tüm raporların analizi
.venv\Scripts\python -m floem_bi.pbip_import "..\powerbi-main" "data\pbip-compatibility-F10" --all --analyze-only
```

Her hedefin yanında `.compatibility.json` ve `.compatibility.md` yazılır. Aynı JSON, normal
aktarımda `.floem` içindeki `report.json/importAudit` alanına da eklenir ve kaydet/aç/yayımla
akışında taşınır. Eski `.floem` dosyalarında kaynak PBIP bilgisi bulunmadığından geçmiş
aktarım kayıpları sonradan tahmin edilmez; rapor için yeni adla tekrar aktarım gerekir.

## Yerel kaynak incelemesi — 20.11.2026

Yedi `.Report`, toplam **39 sayfa ve 1.408 kaynak nesne** incelendi. Kaynak sayıları hedef
nesne sayısı değildir: saydam gezinme düğmesi alttaki nesnelere eylem olarak bağlanabilir.

| Rapor | Sayfa | Kaynak nesne | Kısmi | Desteklenmiyor | Atlandı |
|---|---:|---:|---:|---:|---:|
| Aydınlı / DinamikFinans | 2 | 30 | 29 | 0 | 0 |
| Demo / SAPB1Demo | 18 | 963 | 952 | 11 | 0 |
| Kadoğlu / KADOOGLU | 1 | 10 | 8 | 2 | 0 |
| Pavezyum / üretim takip TEST | 4 | 40 | 39 | 0 | 1 |
| Pavezyum / yönetici panosu TEST | 5 | 163 | 163 | 0 | 0 |
| Pavezyum / üretim takip | 4 | 39 | 38 | 0 | 1 |
| Pavezyum / yönetici panosu | 5 | 163 | 163 | 0 | 0 |

Aydınlı'da bir nesnenin yerleşimi bulgusuz eşlendi. SAP B1 Demo'daki 11 desteklenmeyen tür:
7 birleşik grafik, 3 huni, 1 özel asistan. Kadoğlu'nda özel filtre görseli ve kaynak grup yapısı
eşdeğer aktarılamıyor. Biçim kayıpları özellik yollarıyla; kaynak filtreleri, ölçü yer tutucuları,
toplama işlevleri, tarih hiyerarşileri, sıralama ve geçersiz/desteklenmeyen eylemler ayrı kodlarla listelenir.

Yerel inceleme çıktıları `data/pbip-compatibility-F10/` altındadır. Yeni örnek
`data/SAPB1Demo-Taslak-F10.floem`: **18 sayfa, 905 hedef nesne, 23 boş tablo**.
Bu dosya verili SAP B1 demosunun yerine geçmez. Kaynaklar ve önceki demo dosyaları korunur.
Kullanıcı verisi/yerel inceleme çıktıları git'e eklenmez.

## Uygulama ve doğrulama

`pbip_import.prepare_report` dönüşümü bellekte hazırlar. `pbip_compatibility.py` aynı gerçek
hedef nesnelerden denetim kaydı üretir; son kimlikler ve saydam düğmelerin hedefleri korunur.
UI `ImportCompatibility.tsx` üzerinden Desktop ve web'de ortaktır. Yeni bağımlılık yoktur.

29 hedefli pytest; aktarım yan dosyaları, JSON/arşiv gidiş-dönüşü, özel değerlerin yazılmaması,
bilinmeyen tür/rol ve tekrarlanan kimlikleri doğruladı. Chromium; arama, durum filtresi, tam JSON
indirme, sayfa/nesneye geçiş ve kalıcı uyarıyı doğruladı. Önceki tema/matris/menü testleri,
TypeScript ve Desktop/web derlemeleri geçti. Gerçek SAP B1 taslağı yeniden açıldı; model uyarısı yok.

Bu denetim desteklenen PBIP rapor JSON biçimindeki aktarım kararlarını inceler; bütün Power BI
sürümleri için tam uyumluluk sertifikası veya TMDL ölçü/ilişki doğrulayıcısı değildir.
**Sonraki ana iş F06: ortak model ve ölçü geçiş haritası**, ardından F05 ve F07B.
