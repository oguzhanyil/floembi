# PBIP bulgularından geliştirme listesi

**Tarih:** 20.11.2026 · **Durum:** F10A-01–04 uygulandı.

[Uygulama, kullanım ve doğrulama](f10a-sayfa-gorunumu.md). Yedi raporun 39 sayfasındaki
bu dört kaynak özellik yolu yeni analizde uygulanır; kalan ilgili kayıp bulgusu 0.
Bilinmeyen/dinamik değerler uyarı olarak kalır. Aşağıdaki sayılar ilk F10 tespitini kaydeder.

Uyumluluk raporundaki bulgular geliştirme girdisidir. Aynı özellik için yüzlerce ayrı iş açmak
yerine özellik yolu ve bulgu kodu üzerinden tek iş oluşturulur; etkilenen rapor/sayfalar o işe bağlanır.
Bu liste F10 sonrasındaki sayfa görünümü işlerinin gerekçesini kaydeder.
F04/F07A görünüm iyileştirmeleri F08 ekran düzenlerinden önce tamamlandı.

## Kaynaktaki durum

Yedi yerel PBIP raporunun 39 sayfası incelendi:

| Kaynak özelliği | Açıkça tanımlı sayfa | Gözlenen değer | Bugünkü etki |
|---|---:|---|---|
| `displayOption` | 39 | `FitToPage` | Floem zaten sayfaya sığdırarak açılıyor; kaynak tercihi ayrıca kaydedilip okunmuyor. |
| `objects.background.transparency` | 37 | %0 | Örneklerde opak zemin; eksik desteğin görünür etkisi olmayabilir. |
| `objects.outspace.color` | 32 | Üç farklı renk | Tuval çevresinde kaynak raporun rengi yerine uygulamanın çalışma alanı görünümü kullanılıyor. |
| `objects.outspace.transparency` | 31 | %0 | Örneklerde opak dış alan; gelecekte farklı değerler için destek gerekli. |

Bir özelliğin bulunmaması, kaynakta açıkça %0 yazmasıyla aynı aktarım durumu değildir.
Bu sayılar görsel eşdeğerlik onayı değildir; yalnız kaynakta görülen tanımları sayar.

## İş maddeleri

### F10A-01 — Sayfanın başlangıç görünümünü koru

- **Kaynak:** `PAGE_PROPERTY_NOT_IMPORTED / displayOption`.
- **Öncelik:** P1 · **Bağlı işler:** F04, F08.
- **Beklenen davranış:** Kaynak başlangıç görünümü sayfayla saklansın; Desktop ve web ilk açılışta
  bunu uygulasın. Kullanıcının sonradan yaptığı zoom, nesnelerin kayıtlı koordinatlarını değiştirmesin.
- **Kabul:** Sayfaya sığdırma, genişliğe sığdırma ve gerçek boyut için doğrulanmış kaynak örnekleri;
  dosyayı kaydet/aç, yayımla, sayfa değiştir ve pencereyi yeniden boyutlandır senaryoları geçsin.
  Sayfaya geri dönünce oturumdaki manuel zoom'un korunup korunmayacağı açıkça tanımlansın.
- **Sınır:** Şimdilik kaynaklarda yalnız `FitToPage` gözlendi. Diğer kaynak enum değerleri uygulama
  sırasında doğrulanmalı; bilinmeyen değer sessizce başarılı sayılmamalı.
- **İlgili kod:** `pbip_import.py`, rapor Python/TypeScript şemaları, `ReportViewport.tsx`,
  `PageCanvas.tsx`, `ReportViewer.tsx`.

### F10A-02 — Rapor tuvalinin zemin şeffaflığını destekle

- **Kaynak:** `PAGE_PROPERTY_NOT_IMPORTED / objects.background.transparency`.
- **Öncelik:** P2 · **Bağlı işler:** F07A, F08.
- **Beklenen davranış:** Zemin rengi ve şeffaflığı ayrı ayarlar olsun. Şeffaflık yalnız sayfanın
  zemin katmanına uygulansın; metin, grafik ve diğer nesneler solmasın. Altta görünen katmanın
  rengi rapor temasıyla birlikte tutarlı tanımlansın.
- **Kabul:** %0, %50, %100; açık/koyu tema; özel sayfa rengi ve tema mirası birlikte denensin.
  Sayfadaki yazı/grafikler aynı opaklıkta kalsın. Eksik değer ve “temadan al” davranışı korunsun.
  Değer dosyada ve web'de aynı sonucu üretsin; geçersiz yüzde sessizce kabul edilmesin.
- **İlgili kod:** Sayfa şemaları, `pbip_import.py`, sayfa Biçim paneli ve ortak sayfa çizimi.

### F10A-03 — Tuval dışı çalışma alanı rengini destekle

- **Kaynak:** `PAGE_PROPERTY_NOT_IMPORTED / objects.outspace.color`.
- **Öncelik:** P1 · **Bağlı işler:** F07A, F08.
- **Beklenen davranış:** Sayfanın dışındaki alanın rengi rapor sayfasına özel seçilebilsin;
  tuval renginden bağımsız olsun. Rapor tercihi varsa uygulamanın açık/koyu temasından bağımsız
  korunsun; tercih yoksa kullanılacak varsayılan açıkça tanımlansın.
- **Kabul:** %100 görünümde, sayfaya/genişliğe sığdırmada, yatay/dikey kaydırmada ve dar ekranda
  sayfanın çevresinde boş şerit veya renk sıçraması oluşmasın. Kaydet/aç ve web görünümü aynı olsun.
  Bu renk rapor sayfasının içine taşmasın; sayfa çıktısına katılıp katılmayacağı ayrıca tanımlansın.
- **İlgili kod:** Sayfa şemaları, `pbip_import.py`, `ReportViewport.tsx`, `.report-scroll` ve
  `.report-scroll-space`, sayfa Biçim paneli.

### F10A-04 — Tuval dışı alanın şeffaflığını destekle

- **Kaynak:** `PAGE_PROPERTY_NOT_IMPORTED / objects.outspace.transparency`.
- **Öncelik:** P2 · **Bağımlılık:** F10A-03.
- **Beklenen davranış:** Dış alanın rengi ve şeffaflığı birlikte uygulanabilsin. Altta görünen
  uygulama yüzeyi tanımlı olsun; sayfa tuvali ve nesneler etkilenmesin.
- **Kabul:** %0, %50, %100 değerleri açık/koyu uygulama ve rapor temalarıyla denensin.
  Sayfalar arasında geçişte önceki sayfanın rengi/şeffaflığı kalmasın. Dosyada ve web'de korunsun.
- **İlgili kod:** F10A-03'ün şema, panel ve viewport uygulaması.

**Bu grubun uygulama sırası:** F10A-01 → F10A-03 → F10A-02 → F10A-04.
Mevcut örneklerde iki şeffaflık değeri de %0 olduğundan, görünür fayda sağlayan işler önce gelir.

## Diğer bulguları işe dönüştürme kuralı

Her işte bulgu kodu/özellik yolu, kaynak türü, etkilenen kapsam, kayıp davranış, hedef davranış,
öncelik, bağımlılık ve kabul senaryosu bulunmalı. Sıklık tek başına öncelik değildir: ölçü, filtre
ve toplama hataları yanlış iş sonucu doğurabileceğinden görünüm farklarından önce değerlendirilir.

| Bulgu ailesi | Geliştirme hattı |
|---|---|
| Ölçü yer tutucuları, toplama, alan/hiyerarşi eşlemesi | F06 model ve ölçü geçişi |
| Grup/kapsayıcı kaybı | F05 tasarım ve yerleşim |
| Sabit/koşullu biçim, tipografi ve zengin metin kaybı | F07A/F07B ve F13 denetçi |
| Filtre, sıralama ve düğme eylemi kaybı | F06 sonrası bağlam/etkileşim doğrulaması; ayrı iş ve karşı örnek |
| Desteklenmeyen grafik/özel nesne | Alan ve hesap sözleşmesi tanımlı yeni nesne işi; temsilî grafik başarı sayılmaz |

Bir destek eklendiğinde ilgili kaynak özelliği için regresyon örneği de eklenir. Yeni aktarımda
özellik gerçekten uygulanıyorsa bulgu kaldırılır; kısmiyse neden devam ettiği belirtilir.
Eski `.floem` içindeki aktarım geçmişi değiştirilmez; yeni aktarım ayrı kayıt üretir.
