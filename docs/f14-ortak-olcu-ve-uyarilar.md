# F14 · Ortak ölçü ve uyarılar

**23.11.2026:** BI kataloğu, ortak hesap API'si, eşik nesnesi ve verili yerel pilot
hazır. Kullanıcı Analytics'in çalışmadığını bildirdi; canlı Analytics adaptörü ve
gerçek kaynakla uçtan uca kabul açık. Sonraki ürün aşaması F15 senaryo ve yetkili
işlem iş akışlarıdır.

## Deneme

Desktop'ı `npm run desktop` ile açın; **Aç / Ctrl+O** ile
`data/F14-Analytics-ve-Uyarilar.floem` dosyasını seçin. Dosya F12'nin bağlantısız,
sentetik veri modelini kullanır: iki firma, aynı kodlarla farklı müşteriler ve
seçili dönemden farklı anlam taşıyan dönem sonu bakiyesi. Yeni dosya üretimi:

```powershell
.venv\Scripts\python -m floem_bi.analytics_demo data/F14-Yeni.floem
```

Üretici mevcut dosyanın üzerine yazmaz. Dosya, kayıtlar ve QA çıktıları git dışında
kalır; üretici kodu depodadır.

| Seçim | Satış | Dönem sonu bakiyesi | Beklenen davranış |
|---|---:|---:|---|
| F1 / 2026-02 / C001 | 180 TRY | 350 TRY | Satış 200 altı ve bakiye 300 üstü eşikleri tetiklenir. |
| F2 / 2026-02 / C001 | 1.800 TRY | 3.500 TRY | Aynı kod diğer firmanın verisini getirir. |
| F1 / 2026-02 / C006 | Boş | Boş | Veri yok; eşik hesaplanamadı. Boş sıfıra dönüşmez. |
| Firma seçilmeden iki firma görünür | — | — | Ortak ölçü tek firma seçilmesini ister. |

İki normal kart ve iki **Ölçü ve uyarı** nesnesi yan yanadır. Kartın kayıtlı FDX
ölçüsü katalogda da seçilidir. İkinci bir formül veya SQL hesabı üretilmez. Normal
yayımlama akışı katalog ve nesneleri web'e taşır; güncel Desktop ve sunucu gerekir.

## Katalog ve tasarım

**Görselleştirmeler → Analytics ve uyarılar** bölümünde katalog kimliği, mevcut FDX
ölçüsü, firma anahtar alanı, birim, kayıt tanesi/hesap anlamı ve mutlak karşılaştırma
toleransını seçin. Görselleştirmelerden **Ölçü ve uyarı** ekleyin; nesne seçiliyken
aynı panelden katalog ölçüsünü bağlayın.

Kural için ölçü, ad, `>`, `≥`, `<` veya `≤` koşulu, sayısal eşik ve önem seçilir.
Sıfır ve negatif eşikler geçerlidir. Boş değerde karar **Hesaplanamadı** olur.
Renk yanında simge ve metin bulunur. Bir raporda en fazla 100 katalog ölçüsü ve
200 kural vardır. Katalog ölçüsü silinince ilgili kurallar da kaldırılır; bağlı
nesne açık bir düzenleme/hata durumu gösterir. F13 denetçisi eksik katalog, FDX,
firma alanı, sabit filtre ve bilinmeyen veri zamanını bildirir.

**Kaynak veri zamanı** saat dilimi içeren ISO tarihtir; örneğin
`2026-03-31T23:59:00Z`. Kaynağın beyanıdır. Kaydetme/yayımlama/hesaplama zamanı
verinin güncelliği sayılmaz. Bilinmiyorsa boş bırakılır; karşılaştırma doğrulanmış
sayılmaz. Pilotun zamanı sentetik veri beyanıdır.

## Ortak hesap sözleşmesi

Mevcut kimlik doğrulamalı sorgu uçları kullanılır:

- Desktop: `POST /document/query`, mevcut `X-Floem-Token` ve farklı görüntüle akışı.
- Web: `POST /api/reports/{rid}/query`, mevcut kullanıcı oturumu/yetkisi.
- App: `POST /api/apps/{aid}/items/{iid}/query`; App'in dondurulmuş tanımındaki
  katalog ve kurallar kullanılır.

İstek örneği:

```json
{
  "analytics": { "metricId": "sales.net" },
  "filters": [
    { "table": "Firma", "column": "Kod", "values": ["F1"] },
    { "table": "Tarih", "column": "Donem", "values": ["2026-02"] },
    { "table": "Musteri", "column": "Kod", "values": ["C001"] }
  ]
}
```

İstemci formül, eşik veya firma yetkisi göndermez. Sunucu raporun kataloğunu okur;
sabit filtrelerle isteğin filtrelerini kesiştirir. Yetkili firma sorgusu ve FDX
değer sorgusu aynı belge/veri kilidi altında aynı veri/yetki anlık görüntüsüne
bağlanır. Çok veya sıfır firma varsa hesap reddedilir. RLS iki sorguya da uygulanır.
Firma filtresi yetki vermez; kayıtlı FDX'in CALCULATE/REMOVEFILTERS davranışı normal
rapor hesabıyla aynıdır. Tane ve birim birer modelleme beyanıdır.

Standart `columns`, `rows`, `page` sonucuna `analytics` makbuzu eklenir:

| Alan | Anlamı |
|---|---|
| `protocol` | `floem-metric/v1` |
| `metricId`, `metricVersion` | Katalog kimliği; model semantiği, ölçü ve kuralların özeti. Yardımcı ölçü, ilişki ve RLS değişikliği de sürümü değiştirir. |
| `snapshot`, `datasetVersion` | Belge/veri sürümü ve oturumun yetki bağlamı. |
| `context`, `contextHash` | Yetkili sorgudan firma, firma alanı, sıralanmış/tekilleştirilmiş filtreler, birim ve tane. |
| `dataTime`, `dataTimeStatus` | Kaynak zamanı beyanı veya bilinmiyor. |
| `evaluatedAt` | Hesap zamanı; veri zamanı yerine geçmez. |
| `value`, `alerts` | Aynı FDX sonucunun değeri ve bu değerden hesaplanan eşik kararları. |
| `comparison` | Kanıt yok / kapsam farklı / doğrulanamadı / kapsam ve değer uyumlu / değer farkı. |

Birden çok isteği aynı veri/yetki sürümüne bağlamak için önceki `snapshot`,
`analytics.snapshot` olarak verilebilir. Değişmişse eski/yeni sonuç birleştirilmez.
Makbuz bağlantı/kimlik bilgisi içermez. İlişkisiz model değişikliği de ölçü sürümünü
değiştirebilir; bu temkinli bir tercihtir.

## Kanıt karşılaştırması

**Ölçü kanıtını indir** JSON makbuzunu verir. **Kanıt karşılaştır** en fazla 64 KB
JSON alır. Yalnız `MetricEvidence` alanları taşınır: protokol, kimlik, ölçü sürümü,
anlık görüntü, kapsam özeti, kaynak zamanı ve değer. Sunucu güncel değeri yeniden
kendi hesabından üretir; dosyadaki eşik/kuralları çalıştırmaz.

Önce kapsam alanları karşılaştırılır. Biri farklıysa sayılar aynı olsa bile
**Kapsam uyuşmuyor** çıkar. Kapsam aynı, zaman/değer biliniyorsa mutlak fark kayıtlı
toleransla sınanır. Boş değer/bilinmeyen zamanda **Doğrulanamadı** olur. Sürümsüz eski
Analytics kart JSON'u yeterli kanıt değildir.

Dosya imzasız kapsam beyanıdır; kaynak/gönderen kimliği doğrulaması yapılmaz.
Kanıt yalnız açık nesnenin oturumunda tutulur; rapora kaydedilmez/yayımlanmaz.
Filtre/sürüm değişince önceki karşılaştırma kaldırılır. Geciken yanıt yeni kapsamı
ezemez; yükleme/hata sırasında eski değer aktarılmaz. Sağ tık PDF/Excel/CSV yalnız
güncel sayısal sonucu aktarır; eşik/meta ayrıntıları JSON'dadır.

Desktop, web, farklı kullanıcı veya ayrı veri sağlayıcısı farklı `snapshot`
üretir. Eşit sayılar bu sürümleri eşdeğer yapmaz. Bağımsız Analytics hesabını BI
makbuzuna sararak uyum iddiası üretmek doğru bir adaptasyon değildir.

## Canlı kabulde kalanlar

Yerel `research/repos/floemdata-analytics-user` kopyası yalnız davranış/sözleşme
açısından okundu; kod kopyalanmadı ve Analytics servisleri değiştirilmedi. Mevcut
Gold yanıtında ölçü ve veri sürümü birlikte yok; doğrudan doğrulanmış karşılaştırma
yapılamıyor. Kullanıcı servisin çalışmadığını bildirdi.

Analytics açıldığında seçili bir ölçü için **tek yetkili hesap sağlayıcısı**
belirlenmeli. BI API'si seçilirse Analytics tüketicisi aynı katalog kimliği,
filtre, oturum ve `snapshot` ile bu API'yi kullanmalı; formül çoğaltılmamalı.
Analytics sağlayıcı olacaksa eşdeğer sürümlü katalog/veri/yetki sözleşmesi ayrıca
uygulanmalı. Ardından gerçek firma/dönem, yenileme ve yetki değişimiyle uçtan uca
kabul yapılmalı. Bu canlı adaptör bu teslimde uygulanmış sayılmıyor.

Eşik kuralları tarihsel/statistiksel anomali motorunun yerine geçmez. Zamanlanmış
bildirim, e-posta ve kaynakta işlem çalıştırma bu nesnenin işlevi değildir.
F06-2–5 ve F12 gerçek kaynak/kullanıcı kabulü açık kalır.

## Doğrulama

Python testleri bağımsız SQL/FDX eşitliği, filtre kesişimi/sırası, farklı firma ve
oturum RLS'si, boş/sıfır, eşik sınırları, semantik/veri sürümü, eski kanıt, dosya
yeniden açma, kimlik doğrulama ve App'in dondurulmuş kurallarını kapsar. Saf TS
testleri kanıt biçimi ve F13 katalog denetimini sınar. Chromium koşusu katalog
kaydı, sıfır eşik, kanıt/kapsam farkı, hata/tekrar, geciken yanıt ve gerçek
`.floem`/DuckDB ile 390/1440/1920 px ve DPR 1/1.25/2'yi dener. Yerel günlükler ve
ekran görüntüleri `data/qa-f14/` altındadır.

Son genel koşu: **335 Python geçti, 1 atlandı; 81 saf TypeScript kontrolü**.
32 nesneli tam Chromium turu, typecheck ve Desktop/web üretim derlemeleri geçti.
