# F05: grup, kapsayıcı, otomatik yerleşim ve tasarım geçmişi

20.11.2026. F07A tema altyapısı ve F06 ortak model üzerinde uygulandı. Yeni bağımlılık yok.

## Desktop'ta deneyin

`npm run desktop` ile açın, **Ctrl+O → data/SAPB1Demo-Floem-F05.floem** seçin.
İlk sayfa **Tasarım Atölyesi**: 26 düzenlenebilir nesne, üç birleşik KPI, büyüyen açıklama,
detay tablosunu açıp kapatan düğme. Dosyanın tamamı 10 sayfadır; F06 modelini ve önceki
sayfaları içerir. Kartlar ve tablo mevcut yerel FDX ölçülerini sorgular.

| İşlem | Kullanım |
|---|---|
| Çoklu seçim | Nesnelere **Shift+tık**; seçimin ortak taşıma/boyut tutamacı görünür. |
| Gruplama | **Ctrl+G**, sağ tık **Grupla** veya **Düzen ve katmanlar → Grupla**. Aynı üst nesnenin kilitsiz kardeşleri seçilir. |
| Çerçeve oluşturma | Çoklu seçim → **Kapsayıcıya al**; boş kapsayıcı için nesne paletindeki **Kapsayıcı** simgesi. |
| Grubu çözme | Grubu/kapsayıcıyı seçip **Ctrl+Shift+G** veya **Grubu çöz**. İç nesneler bir üst düzeye çıkar. |
| İç nesneyi seçme | **Ctrl+tık**, çift tıklama veya katman ağacı. Normal seçim dış grubu tutar. |
| Taşıma ve boyut | Nesne başlığını/tutamacını sürükleyin veya X/Y/genişlik/yükseklik girin. Grup boyutlandırılırken iç koordinatlar ve boyutlar orantılı değişir. Yazı boyutu ayrı bir biçim ayarıdır. |
| Hizalama | Çoklu seçim → **Seçimi hizala**: kenarlar/ortalar; üç nesnede eşit yatay/dikey aralık. Akış içindeki hizalamayı kapsayıcı yönetir. |
| Üst nesneyi değiştirme | **Üst kapsayıcı** listesini kullanın; veya **Ctrl+Alt ile sürükleyin**. Seçimin ortasını içeren en içteki kapsayıcı hedeflenir; dışarı bırakılırsa sayfaya çıkar. |
| Akış sırası | Yatay/dikey/ızgara içindeki nesnenin başlığını kardeşinin merkezine bırakın. |
| Çoğaltma/silme | Sağ tık veya **Ctrl+D / Delete**; kapsayıcının alt ağacı da işleme katılır. İç nesne göster/gizle eylem hedefleri çoğaltılan ağaca eşlenir. |
| Geri al/yinele | Tuvaldeki küçük **↶ / ↷**, **Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z**. Bir sürükleme tek adımdır; sürüklerken **Escape** iptal eder. |

Görselleştirmeler ve Veri panelleri bağımsız düğmelerini korur. Düzen ayarları,
Görselleştirmeler içindeki **Düzen ve katmanlar** bölümündedir. Yeni üst araç çubuğu eklenmedi.

## Yerleşim kuralları

- **Grup:** birleşik bir nesneyi taşımak ve orantılı boyutlandırmak için serbest koordinatlar.
- **Kapsayıcı:** serbest, yatay, dikey veya ızgara. İç boşluk, nesneler arası boşluk,
  çapraz hizalama, dağılım, satıra kaydırma, sütun sayısı ve içerikle büyüyen yükseklik.
- **Esnek boyut sınırları:** akış çocuğunda büyüme payı ve en az/en fazla genişlik/yükseklik.
  Boş alan ağırlıklara bölünür; sınırına gelen nesnenin kalan payı diğerlerine aktarılır.
- **Büyüyen metin:** gerçek metin yüksekliği ölçülür. Akıştaki sonraki nesne aşağı itilir;
  açıklama kısalınca geri gelir. Taşıma bu yüksekliği kalıcı minimuma dönüştürmez.
  Akıştan serbeste geçiş ve grubu çözme, ekranda ölçülen konumları korur.
- **Taşma:** göster/kırp seçilir; sınırı aşan içerik seçili kapsayıcıda uyarılır.
  Sabit boyut ve yetersiz minimum sınırları kullanıcı kararıdır; gizlice küçültülmez.
- Ata kilidi alt nesnelerin taşınmasını ve düzenlenmesini engeller. Kapsayıcı göster/gizle
  eylemi alt ağaca uygulanır; opaklık ve kırpma da alt nesnelere taşınır.

Sayfanın serbest yerleştirilmiş diğer bölümleri, komşu bir kapsayıcı uzadığında kendiliğinden
taşınmaz. Birlikte akmasını istediğiniz bölümleri ortak bir üst kapsayıcıya alın.
Bu sürüm sabit rapor tuvalini kullanır. Telefona ayrı sayfa düzeni ve kırılma noktaları **F08** işidir.

## Dosya, kayıt ve geçmiş

`page.visuals` düz listesi korunur; `parentId`, üst kapsayıcıya göre yerel `x/y`,
`container` ve `layoutItem` eklenir. Eski düz raporların koordinatları değişmez.
Sunucu döngü, eksik/başka sayfadaki üst nesne, kapsayıcı olmayan üst nesne, geçersiz
sayısal değer ve 16 düzeyi aşan ağaçları reddeder. Geçersiz kayıt mevcut raporu değiştirmez.

Desktop ve web ortak `resolvePageLayout`/`usePageLayout` katmanını kullanır.
Ölçülen yükseklikler çalışma zamanındadır; dosyaya DOM koordinatı yazılmaz.
Kayıt istekleri sırayla gönderilir; eski bir kayıt cevabı yeni yerel taslağı veya undo'yu ezmez.
Yeni belge açıldığında tasarımcı ve geçmişi yenilenir.

Geçmiş **oturum içindeki son 75 tasarım işlemini** tutar: sayfalar, nesneler, alan eşlemeleri,
tema ve biçim. Kaynak verisi, model değişiklikleri ve web okuyucusunun seçimleri bu geçmişe girmez.
Dosya kapatılıp açılınca undo geçmişi yeniden başlar; tasarım tanımı korunur.
Metin kutusunda yazarken işletim sisteminin normal geri alma davranışı geçerlidir.

Önceki dosyayı koruyarak atölyeyi yeniden üretmek için yeni bir hedef adı verin:

```powershell
.venv\Scripts\python -m floem_bi.layout_demo data\SAPB1Demo-Floem-F06.floem data\SAPB1Demo-Floem-F05-yeni.floem
```

Komut yalnız yerel dosya kopyasıyla çalışır ve var olan hedefi ezmez.
`.floem` dosyaları git dışındadır. Web'de görmek için yeni dosyayı normal Desktop yayın akışıyla
yayımlayın; bu geliştirme çalışmasında canlı rapor yayını yapılmadı.

## Doğrulama ve sonraki aşama

- **227 Python testi geçti, 1 atlandı**; 21 yeni test ağaç doğrulamasını ve gerçek `.floem`
  aç/kaydet turunu kapsar. Kaynak SQL Server bağlantısı gerekmez.
- `node tests/design/run.mjs`: **20** yerleşim, grup, hizalama, çoğaltma, kilit ve geçmiş testi.
- `node tests/ui/run-smoke.mjs`: Chromium StrictMode altında gerçek pointer ile grup taşıma/
  boyutlandırma, özellikten boyutlandırma, undo/redo, kapsayıcı değiştirme ve akış sırası;
  metin büyüme/küçülme, büyüyen grubu çözme ve serbeste geçiş, geciken kayıt,
  kapsayıcı görünürlüğü, Desktop/web ve üç viewport/DPR bileşimi.
  Önceki 27 nesne menüsü, grid/matris, tema, aktarım raporu ve altı viewport kontrolleri de geçti.
- Yerel F05 dosyası açıldı; atölyedeki **4 veri sorgusu** boş olmayan sonuç verdi.
  Gerçek rapor düzeninin tarayıcı görüntüsü ayrıca **sentetik ekran verisiyle** incelendi.
- Typecheck ve Desktop/web build kontrolleri çalıştırıldı.

Sırada **F07B: kullanıcı bileşenleri, marka ve ikon kitaplığı** var. Grupları kitaplığa kaydetme,
alan yuvaları, sürümlü ortak stiller ve yerel istisnalar bu aşamada yapılacak.
F06'nın 135 özgün kaynak ölçüyle tam sonuç/motor uyumu **F06-2–5** olarak açık kalır.
