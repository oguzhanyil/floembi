# F08 — Ekranlara göre düzenler

Aynı raporun nesneleri telefon, tablet ve laptop için ayrı yerleştirilebilir. Ölçüler,
alanlar, filtreler, düğme eylemleri ve bileşen kimlikleri tek tanımda kalır. Düzen
değiştirmek veri kopyalamaz; okuyucunun seçimlerini sıfırlamaz.

## Kullanım

1. Desktop'ı güncel kodla açın. **Görselleştirmeler → Ekran düzenleri** bölümünü açın.
2. **+ Telefon**, **+ Tablet** veya **+ Laptop** ile bir başlangıç düzeni ekleyin.
3. **Düzen** listesinden Ana veya oluşturduğunuz düzeni seçin. Konum, boyut,
   kapsayıcı akışı, yazı/başlık boyutu, iç boşluk, metin taşması, gösterge konumu ve
   tablo sütunlarını sığdırma ayarları seçili düzende saklanır.
4. Sayfa akışını dikey, iki sütun veya serbest yapın. Serbeste geçiş görünür
   konumları saklar. Akışta nesnelerin sırasını katman araçlarıyla veya sürükleyerek
   değiştirin; serbest düzende konumlarını ayrı ayarlayın.
5. Ekleme/silme, alanlar, metnin içeriği, renkler ve eylemler bütün düzenlerde
   ortaktır. Gruplama, üst kapsayıcı ve bileşen kitaplığı Ana düzende düzenlenir.
6. Kaydedip yayımlayın. Web, rapora ayrılan alanın genişliğine göre düzen seçer.
   Alttaki **Düzen** menüsünden elle de seçim yapılabilir; tercih sayfa başına
   oturumda kalır.

| Başlangıç | Tuval genişliği | Otomatik seçim eşiği |
|---|---:|---:|
| Telefon | 390 | ≤ 600 CSS piksel |
| Tablet | 768 | ≤ 1024 CSS piksel |
| Laptop | 1280 | ≤ 1440 CSS piksel |
| Ana | Özgün genişlik | Eşleşen düzen yoksa |

Eşik ve tuval boyutları bağımsız değiştirilebilir. Birden fazla eşleşmede en dar
eşik kazanır; kayıt sırası önemli değildir. Fiziksel piksel/DPR yerine rapor
bölmesinin CSS genişliği ölçülür. Manuel zoom her sayfa/düzen için ayrıdır.

## Yerleşim ve sınırlar

Yeni düzen tüm nesneleri koruyan bir **başlangıçtır**. Kök nesneler yukarıdan aşağı
sıralanır; mevcut akış kapsayıcıları dar ekrana uyarlanır. Serbest grupların çizim
ilişkileri korunur ve yatay ölçüleri uyarlanır. Karmaşık, üst üste bindirilmiş
tasarımların kompozisyonu kullanıcı tarafından kontrol edilmelidir.

Metinler içerikle büyüyebilir; akıştaki komşuları aşağı iter. Sayfa en az yüksekliğin
altına inmez; uzadığında aşağı kaydırılır. Sayfa/kapsayıcı taşmaları tasarımcıda
uyarılır; otomatik gizleme yapılmaz. Tablonun okunabilir minimum sütun genişliği
korunur; geniş tablonun kendi yatay kaydırması olabilir. Sayfa sekmeleri de yatay
kayabilir. Başlangıçta gizli nesneler ortak görünürlük/eylem kurallarına uyar;
akışta ayrılan alanları korunur. Koşula göre alan kapatma ve tekrarlama F11 işidir.

Bir sayfada en fazla 12 düzen vardır; eşikler ve kimlikler benzersizdir. Akışın
20.000 px sınırını aşan içerik için taşma uyarısını inceleyin. Düzen silme ve
konum değişiklikleri geri alınabilir. Düzen kaldırıldığında nesneler silinmez.
**Seçimi Ana düzenden al** seçilen nesnelerin yerel istisnalarını temizler.

## Dosya sözleşmesi

`ReportPage.layouts[]`: `id`, `name`, `maxWidth`, `width`, `height`, `displayOption`,
`rootLayout`, `order`, `overrides`. İstisnalar mevcut görsel kimliğine başvurur.
`overrides` yalnız geometri, kapsayıcı/esnek boyut ve izin verilen sunum alanlarını
kabul eder; sorgu, ölçü, veri, eylem veya bileşen tanımı taşımaz. Silinen nesnelerin
istisnaları temizlenir; eklenen nesneler tüm düzenlere katılır.

`rootLayout`, kalıcı sahte görsel eklemeden sayfa akışını tanımlar. Ortak hesap
Desktop ve web'de gerçek metin yüksekliklerini kullanır. Okuyucunun seçimleri ve
zoom dosyaya yazılmaz; düzen tanımları dosyaya ve yayına taşınır. Ölçü/alan yeniden
adlandırma tek semantik tanım üzerinden sürer. Eski rapor özgün sabit tuvalle açılır.

## Yerel örnek

**`data/SAPB1Demo-Floem-F08.floem` → Ekran Düzenleri**. F07B korunur. Yeni dosyada
11 sayfa, ilk iki sayfada üçer düzen, aynı veri ve sürümlü bileşenler vardır. Yerel
DuckDB üzerinde bu iki sayfanın beş veri sorgusu boş dönmedi.

Yeniden üretmek için mevcut olmayan bir hedef seçin:

```powershell
node scripts/create-responsive-demo.mjs data/SAPB1Demo-Floem-F07B.floem data/Yeni-F08.floem
```

Üretici ürünün aynı TS yerleşim yardımcısını kullanır; SQL kaynağına bağlanmaz.
Yeni şema için Desktop ve web Python sunucusu güncel kodla yeniden başlatılmalıdır.
Bu geliştirmede kullanıcının çalışan süreçleri durdurulmadı.

## Doğrulama

- Tam Python: **275 geçti, 1 atlandı**. Saf TS: **47 geçti**.
- Tam Chromium takımı, typecheck ve Desktop/web derlemeleri geçti.
- Python: geçersiz geometri, eşik/kimlik/sıra, yasak semantik istisna, kaydet/aç,
  ölçü yeniden adlandırma ve test sunucusuna gerçek yayımlama/sorgu.
- Saf TS: eski tuval, eşikler, ortak semantik/ayrı geometri, sıralama, ekleme/silme,
  büyüyen kök akışı, serbest grup ve undo/redo.
- Chromium: üç düzen oluşturma, gerçek fareyle taşıma, undo/redo, üç viewport/DPR,
  dar rapor bölmesi, ortak dilimleyici/görünürlük/sayfa eylemi, sorgusuz düzen geçişi.
  Yerel demo yerleşimi ayrıca gerçek DuckDB sorgu sonuçlarıyla kontrol edildi;
  uzun başlıklı web kabuğu da dar ekranda sınandı.
- Typecheck, Desktop/web derlemeleri ve önceki UI regresyon kontrolleri.

Sıradaki aşama **F09: büyük Grid/Tree Grid, arama, sayfalama ve aktarım kapsamı**.
