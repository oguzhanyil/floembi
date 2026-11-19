# F10A — sayfa görünümü ve zemin katmanları

20.11.2026. F10A-01 → F10A-03 → F10A-02 → F10A-04 uygulandı.

## Kullanım

Desktop'ta tuvalin boş yerine tıklayın. **Görselleştirmeler → Tuval** bölümünde:

- **Başlangıç görünümü:** sayfaya sığdır, genişliğe sığdır veya gerçek boyut.
- **Sayfa rengi / Tuval saydamlığı:** sayfa zemini, %0 opak ve %100 saydam.
- **Tuval dışı alan / Dış alan saydamlığı:** çalışma alanının bağımsız rengi ve alfası.
- **Tuval rengini temadan al** ve **Dış alanı uygulamadan al** özel ayarları temizler.

Alttaki büyüteç/ölçek araçları yalnız oturum görünümünü değiştirir. Manuel yakınlaştırma
sayfa başına hatırlanır; sayfalar arası geçiş koordinatları değiştirmez ve kaydırma başlangıca
döner. Başlangıç görünümü ayarı değiştirilirse o sayfanın manuel ölçeği sıfırlanır.
Yeni belge/görüntüleyici oturumunda dosyadaki başlangıç görünümü uygulanır.

Dosyada isteğe bağlı `displayOption`, `backgroundTransparency`, `outspaceColor` ve
`outspaceTransparency` alanları vardır. Eski raporlar sayfaya sığdırma ve %0 saydamlıkla açılır.
Renk verilmezse sayfa rapor temasını, dış alan uygulamanın `--bg` yüzeyini miras alır.
Uygulama yüzeyi tanımlı değilse eski dış alan rengi `#e9e8e6` kullanılır.

Sayfa zemini saydamlaştığında alttaki **rapor temasının zemin rengi** görünür. Tuval dışı renk
sayfanın içine sızmaz. Dış alan saydamlaşınca uygulama yüzeyi görünür. Yazılar, grafikler ve
nesneler bu saydamlık hesaplarına katılmaz; kapsayıcı `opacity` değeri değiştirilmez.
Sekiz haneli rengin mevcut alfası saydamlıkla çarpılır. Dış alan çalışma alanıdır; tablo/nesne
PDF, Excel ve CSV çıktısına katılmaz. Tam sayfa baskı düzeni bu aşamanın kapsamı değildir.

## Power BI aktarımı

`FitToPage`, `FitToWidth`, `ActualSize` değerleri Microsoft'un
[sayfa 2.1.0 şemasına](https://github.com/microsoft/json-schemas/blob/main/fabric/item/report/definition/page/2.1.0/schema.json)
göre eşlenir. Eski `ActualSizeTopLeft`, dinamik görünüm, bilinmeyen değer, dinamik renk,
geçersiz yüzde ve koşullu seçici başarı sayılmaz; aktarım raporunda kalır.
Sabit/default arka plan ve dış alan renkleriyle %0–100 saydamlıklar uygulanır.

Yedi yerel PBIP raporunun 39 sayfası yeniden analiz edildi:

| Özellik | Uygulanan sayfa |
|---|---:|
| Başlangıç görünümü | 39 |
| Tuval saydamlığı | 37 |
| Tuval dışı alan rengi | 32 |
| Tuval dışı alan saydamlığı | 31 |

Bu dört yol için yeni analizde kalan kayıp bulgusu **0**. Bu sayı tam rapor eşdeğerliği
anlamına gelmez. Eski `.floem` dosyasındaki aktarım geçmişi değiştirilmez; yeni aktarım
güncel destek durumunu üretir. Veri ve ölçü geçişi ayrı F06 işleri olarak devam eder.

## Doğrulama

- Tam Python takımı: **256 geçti, 1 atlandı**. Saf TypeScript: **39 geçti**.
- Tam Chromium takımı geçti; F05 ve F07B geriye dönük kontrolleri buna dahil.
- 16 yeni Python örneği: üç görünüm, %0/50/100, bilinmeyen/dinamik kaynak, geçersiz değer,
  gerçek `.floem` kaydet/aç ve eski alanların eksik kalması.
- Üç saf TS kontrolü: ölçek, alfa ve rapor teması mirası.
- Chromium: sayfa başına manuel zoom, koordinat koruma, kaynak başlangıç tercihi,
  nesneleri soldurmadan saydamlık, açık/koyu uygulama ayrımı, Desktop/web,
  üç viewport/DPR ve taşma sınırları. Önceki nesne/grid/matris/tema/bileşen kontrolleri de çalışır.
- Typecheck ve Desktop/web üretim derlemeleri.

Yeni şema alanlarını kullanmadan önce Desktop ve web Python sunucusu güncel kodla yeniden
başlatılmalıdır. Bu geliştirme sırasında kullanıcının çalışan sunucusu durdurulmadı.
Devam aşaması [F08: laptop/tablet/telefon düzenleri](f08-ekran-duzenleri.md) uygulandı.
Güncel sırada F09 büyük Grid/Tree Grid vardır.
