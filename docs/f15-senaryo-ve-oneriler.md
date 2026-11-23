# F15 · Senaryo ve uygulama içi öneriler

**23.11.2026:** sayısal varsayımlar, FDX ile mevcut/senaryo karşılaştırması,
web'de yetkili öneri oluşturma ve onay/ret, tekrar işlem koruması ve işlem geçmişi
uygulandı. Kaynak ERP/SQL sisteminde işlem yürütme ayrı kapsamda kalır.

## Verili pilotu açma

Desktop'ı yeniden başlatın (`npm run desktop`); **Aç / Ctrl+O** ile
`data/F15-Senaryo-Atolyesi.floem` dosyasını açın. Sentetik F12 verisine her satış
satırı için açıkça tanımlanmış **maliyet = tutar × 0,6** eklenir. Vergi, kur veya
gerçek stok/muhasebe maliyetini temsil etmez. Telefon düzeni aynı nesneleri kullanır.

| F1 / 2026-02 / C001 | Başlangıç | İskonto %10 |
|---|---:|---:|
| Net satış | 180 TRY | 162 TRY |
| Maliyet | 108 TRY | 108 TRY |
| Brüt kâr | 72 TRY | 54 TRY |
| Brüt kâr oranı | 0,4 | 0,3333… |

Hacim ve birim maliyet varsayımlarını da değiştirebilirsiniz. Hacim hem satışa hem
maliyete uygulanır. İade satırları işaretini korur; müşteri C006 veri yok durumunu
gösterir. Firma seçimini kaldırmak iki firma görünüyorsa açık kapsam hatası üretir.

Yeni dosya üretimi:

```powershell
.venv\Scripts\python -m floem_bi.scenario_demo data/F15-Yeni.floem
```

Üretici mevcut dosyaya yazmaz; `.floem`, veri ve QA çıktıları git dışındadır.
Raporu mevcut yayımlama akışıyla web'e taşıyın. Güncel Desktop ve web sunucusu gerekir;
mevcut çalışan pilot sunucusu bu geliştirme sırasında yeniden başlatılmadı.

## Kendi senaryonuzu tasarlama

1. Modelde sayısal sabit FDX ölçüleri oluşturun; örneğin `[İskonto varsayımı] = 0`.
2. Etkilenecek normal FDX ölçüsünü yazın; örneğin
   `SUM(Satis[Tutar]) * (1 - [İskonto varsayımı] / 100)`.
3. **Görselleştirmeler → Senaryolar** bölümünde kimlik, ad, firma anahtarı,
   parametre ölçüleri, birim, minimum/maksimum/adım/başlangıç ve çıktı ölçülerini seçin.
4. Görselleştirmelerden **Senaryo** nesnesi ekleyip panelden tanımı bağlayın.
5. Öneri akışı gerekiyorsa açın ve öneri oluşturabilecek çalışma alanı rollerini seçin.

Bir raporda en fazla 30 senaryo; senaryoda 12 parametre ve 12 çıktı vardır. Parametre
kimliği ve ölçü bağı benzersizdir. Sınırlar ±10¹², adım en az 0,000001'dir. Başlangıç
değeri minimumdan başlayan adımlara uymalı ve bağlı ölçünün sayısal sabitiyle aynı
olmalıdır. Hesap, `VAR` veya tablo toplamı olan ölçü parametre olarak değiştirilemez.
Negatif ve ondalıklı sayısal sabitler desteklenir. Modelde ölçü/firma/sütun yeniden
adlandırması rapordaki bağları günceller; F13 eksik tanım ve bağları bildirir.

İzleyici sayı kutusu veya kaydırıcıyla varsayımı değiştirir; geçerli girişler kısa
bir beklemeyle hesaplanır. Sınır/adım dışı ve boş girişte önceki sonuç gösterilmez
ve dışa aktarılmaz. **Varsayımları sıfırla** modelin başlangıç varsayımlarına döner.
İzleyicinin deneme değerleri ve işlem notları rapor tanımına kaydedilmez.

## Hesap anlamı ve sürüm

İstek yalnız kayıtlı senaryo kimliği, sayısal değerler ve filtreleri taşır. Sunucu
rapor tanımından bağı çözer; kullanıcıdan FDX/SQL veya hesap sonucu almaz. Firma
RLS'li sorgudan belirlenir; tek firma gerekir. Örtük seçilen firma da hesap/öneri
kapsamına eklenir. Sabit, nesne, dönem, müşteri ve kullanıcı filtreleri kesişir.

Mevcut sonuç orijinal modelden, senaryo sonucu modelin istek için kopyasından gelir.
Yalnız kayıtlı sayısal sabitlerin ifadeleri bu kopyada değiştirilir. İki hesap aynı
veri/yetki anlık görüntüsünde ve kilitte çalışır. Asıl model, normal kartlar ve diğer
kullanıcıların senaryoları değişmez. Kayıtlı FDX'in filtre değiştirme davranışı sürer;
firma filtresi yetkilendirme yerine geçmez, güvenliği sunucu RLS'si sağlar.

Her çıktı mevcut, senaryo, fark ve değişim oranını gösterir. Değişim oranı
`fark / |mevcut|` olarak tanımlıdır; mevcut sıfırsa oran boş kalır. Eksik veri sıfır
sayılmaz. Bu varsayım modeli tahminin gerçekleşeceğini veya nedenselliği garanti etmez.
Sağ tık PDF/Excel/CSV güncel karşılaştırma satırlarını aktarır; parametre ve kapsam
ayrıntıları nesnede, kaydedilmiş öneride ve API makbuzunda bulunur.

`VisualQuery.scenario` mevcut Desktop, web raporu ve App sorgularında çalışır:

```json
{
  "scenario": { "id": "sales.margin", "values": { "discount": 10 } },
  "filters": [
    { "table": "Firma", "column": "Kod", "values": ["F1"] },
    { "table": "Tarih", "column": "Donem", "values": ["2026-02"] }
  ]
}
```

Eksik parametreler başlangıç değerini alır; tanımsız parametre, metin, boolean,
sonlu olmayan sayı, sınır ve adım hatası reddedilir. Sorgu Analytics/normal görsel
alanlarıyla karıştırılamaz. Yanıtın `scenario` alanı model+tanım sürümü, kullanıcıya
bağlı `snapshot`, ayrı `dataVersion`, kapsam/özeti, parametreler ve çıktı değerlerini
taşır. `scenario.snapshot` ile önceki anlık görüntüye bağlanılabilir. Geciken cevap
yeni kapsamın yerine geçmez; hata ve yüklemede eski sonuç aktarılmaz.

## Öneri, yetki ve geçmiş

Desktop senaryo hesabını yapar. **Öneri oluştur**, **Onayla/Reddet** ve kalıcı geçmiş
web'de çalışır. Bunlar Floem BI metadata veritabanında tutulan uygulama içi kararlardır.

- Öneri oluşturma, rapor/App erişimi ve tanımdaki `submitRoles` ile sunucuda denetlenir.
  Varsayılan roller Yönetici, Üye ve Katkıda bulunan; pilotta İzleyici de açıktır.
- Onay ve ret yalnız çalışma alanı **Yöneticisi/Üyesi** içindir. Katkıda bulunan ve
  paylaşımla/App erişimiyle gelen İzleyici onay veremez.
- Öneri sırasında parametre, sınır, RLS, firma, ölçü ve veri sürümü sunucuda yeniden
  hesaplanır; istemcinin sonuç göndermesi kabul edilmez. Boş sonuçla öneri oluşturulmaz.
- Her gönderim rastgele işlem anahtarı taşır. Aynı kullanıcı/rapor/anahtar ve aynı
  içerik önceki kaydı döndürür; değişen içerikle anahtar tekrarı reddedilir. Çift
  tıklama ve bağlantı sonrası tekrar ikinci öneri üretmez. Veritabanında tekillik
  kısıtı da bulunur. Yeni bir tarayıcı oturumunda yeni gönderim ayrı öneridir.
- Onay sırasında hesap, veri sürümü, firma/filtre kapsamı ve çıktılar yeniden
  karşılaştırılır. Değişmişse yeni öneri istenir; eski öneri reddedilebilir.
- Bir öneri yalnız İncelemede → Onaylandı/Reddedildi geçişini yapar. Aynı kararın
  tekrarı ikinci olay yazmaz; tersine çevirme reddedilir.
- Geçmişte kim, ne zaman, hangi varsayım/filtre/sonuç ve notla işlem yaptı görülür.
  Yönetici/Üye seçili firmanın geçmişini görür. Diğer roller yalnız kendi **güncel
  veri/model/yetki sürümündeki** kayıtlarını görür; sürüm değişince eski sonuçlar
  onlara yeniden açılmaz. Yönetici/Üye eski kayıtları inceleyebilir/reddedebilir.
  Son 100 kayıt gösterilir ve kesilme açıklanır.

Rapor için `POST /api/reports/{rid}/scenario-proposals`, `/history` ve
`/{proposal_id}/decision` uçları kullanılır. App'te aynı son ekler
`/api/apps/{aid}/items/{iid}` altındadır. App dondurulmuş senaryo tanımını kullanır;
canlı raporun son ayarıyla sessizce değiştirilmez. Veri ise anlam modelinin güncel
sürümüdür. Kayıtlar `scenario_proposals` ve eklemeli `scenario_events` tablolarındadır;
tablo kurulumu mevcut metadata oluşturma akışıyla yapılır.

## Sınırlar ve kalan işler

ERP belgesi oluşturma, onayın bir bağlayıcıya komut göndermesi, dış fonksiyon/SQL
çalıştırma ve kaynak sisteme yazma uygulanmış sayılmaz. Bunlar işlem türü,
bağlayıcı, işlem başına yetki ve kaynak tarafı tekrar korumasıyla ayrıca
tasarlanıp yetkilendirilmelidir. Geçmiş bir kriptografik denetim arşivi değildir.

F06-2–5 gerçek kaynak ölçü/motor/mutabakatı, F12 gerçek süreç/kullanıcı kabulü,
F14 canlı Analytics adaptörü ve nihai tema seçimi açıktır. Sonraki iş gerçek bir
rapor/süreç üzerinde kullanıcı kabulüdür; yeni numaralı bir ürün aşaması bu teslimde
kendiliğinden eklenmemiştir.

## Doğrulama

Bağımsız matematik, aynı kapsam/FDX, modelin korunması, sınır/adım, boş/sıfır,
iki firma ve RLS, eski snapshot, dosya tekrar açma, rol, eş zamanlı/tekrarlı öneri,
onay/ret, veri sürümü ve App'in dondurulmuş tanımı Python testlerinde sınanır.
Saf TS testleri giriş ve yanıt eşlemesi ile F13 bağ denetimini kapsar. Chromium
parametre düzenleme, yanlış/boş sonuç, geciken cevap, hata/tekrar, tanım kaydı,
yanıtı kesilen önerinin tekrarı ve onay/geçmişi dener. Gerçek `.floem` ile geçici,
kimlik doğrulamalı web sunucusunda izleyici önerisi, yönetici eski sürüm engeli ve
ret/geçmiş; 390/1440/1920 px ve DPR 1/1.25/2 doğrulanır.

QA günlükleri ve görüntüler `data/qa-f15/` altındadır. Kullanıcının 8800/8765
servisleri veya gerçek kaynak veritabanı testlerde kullanılmaz.

Son koşu: **354 Python geçti, 1 atlandı; 84 saf TypeScript kontrolü**. 33 nesneli
tam Chromium turu, typecheck ve Desktop/web üretim derlemeleri geçti.
