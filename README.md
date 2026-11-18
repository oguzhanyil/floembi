# Floem BI (MVP: semantik çekirdek)

Floem BI, Floemdata Analytics üzerinde çalışan Power BI benzeri bir BI modülüdür.
Bu depodaki ilk dilim semantik çekirdektir:

- **Semantik model:** YAML ile tanımlanır. Nesne modeli Tabular/TOM'dan alınmıştır:
  tablolar, sütunlar, ilişkiler, ölçüler, hiyerarşiler ve roller (RLS).
- **Floem DAX derleyicisi:** el yazımı lexer, Pratt parser, filtre bağlamı semantiği
  ve sqlglot ile SQL üretimi. Çıktı lehçeleri DuckDB ve T-SQL.
- **query-service:** DuckDB üzerinde Import modu sorgu motoru ve FastAPI uç noktaları.

Mimari kararlar ve gerekçeleri `research/notes/99-floem-bi-sentez.md` dosyasındadır.

## Kurulum ve çalıştırma

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"

# Sentetik SAP B1 verisi ve Gold katmanı (demo)
.venv/Scripts/python -m floem_bi.demo.sapb1 data/demo.duckdb

# Testler
.venv/Scripts/python -m pytest

# API
set FLOEM_MODEL=examples/sapb1_satis.yaml
set FLOEM_DB=data/demo.duckdb
.venv/Scripts/uvicorn floem_bi.api.app:app --reload
```

### Floem BI Desktop (Electron)

Node.js 22.12 veya üstü gerekir.

```bash
npm install          # postinstall Electron ikilisini indirir
npm run desktop      # Vite + Electron; Python servisi .venv'den otomatik başlar
```

Desktop açılınca arka planda `python -m floem_bi.desktop_service` başlar. Servis rastgele
bir portta yalnızca `127.0.0.1` adresinden dinler ve her açılışta üretilen bir token'la
korunur. Kayıtlı bağlantıların şifresi olmayan bilgisi `%APPDATA%\FloemBI\connections.json`
dosyasında, şifreleri Windows Kimlik Bilgisi Yöneticisi'nde ("FloemBI") tutulur.

VS Code terminalinde `ELECTRON_RUN_AS_NODE=1` tanımlı olabilir. `npm run desktop` bunu
kendisi temizler; Electron'u elle başlatıyorsanız bu değişkeni kaldırın.

#### İçe aktarım, model görünümü ve .floem dosyası (H2)

- **Veri al → Gezgin → Yükle:** seçilen tablolar arka planda parça parça (50.000 satır) Arrow
  üzerinden yerel DuckDB'ye aktarılır. Pencere tablo tablo satır sayısını gösterir, iptal
  edilebilir. Önce geçici tablolara yüklenir; hepsi başarılı olursa tek transaction'da modele
  eklenir. Hata ya da iptal modeli değiştirmez.
- **SQL penceresi → Modele yükle:** sorgunun tamamı tablo olarak yüklenir (satır sınırı yok).
- **İlişkiler otomatik algılanır:** önce kaynaktaki yabancı anahtarlar, sonra ad eşleşmesi.
  "Bir" tarafı tek sütunlu birincil anahtar olmalı; anahtar bilgisi yoksa verideki benzersizliğe
  bakılır. SAP B1'de yabancı anahtar olmadığı için örneğin `INV1[DocEntry] → OINV[DocEntry]` ve
  `OINV[CardCode] → OCRD[CardCode]` ad eşleşmesinden bulunur. İki tablo arasında ikinci bir
  filtre yolu açan ilişki pasif eklenir.
- **Model görünümü:** tablo kartları (Σ, anahtar, tarih, gizli simgeleri), 1 / * işaretli ve
  filtre yönü oklu ilişki çizgileri (pasif ilişki kesik çizgi). Bir sütunu diğer tablodaki
  sütunun üstüne sürükleyince ilişki penceresi açılır. Pencere sütunların benzersizliğine bakıp
  kardinaliteyi önerir. Çizgiye çift tıklayınca düzenleme açılır; "İlişkileri yönet" de var.
- **Özellikler bölmesi:** tablo (ad, açıklama, gizle, tarih tablosu olarak işaretle, yenile, sil),
  sütun (ad, veri tipi, biçim, sütuna göre sırala, varsayılan özet, gizle), ilişki.
- **Yenile:** tabloları kaynaktan yeniden yükler. Kaynakta eklenen ya da silinen sütunlar modele
  yansır, kullanıcının değiştirdiği veri tipleri korunur. Yarıda kalan yenileme eski veriyi bozmaz.
- **.floem dosyası** (Ctrl+S / Ctrl+O): zip içinde `manifest.json`, `model.yaml`, `diagram.json`,
  `report.json`, `data.duckdb`. Şifre dosyaya girmez. Başka bilgisayarda açılan dosya yenilenirken
  aynı sunucuya kayıtlı bağlantı aranır.
- Model değişiklikleri servise işlem listesi olarak gider (`POST /document/ops`:
  `rename_table`, `add_relationship`, `update_column`…). Aynı işlemler ileride floembi.app'te
  web'den düzenleme için kullanılacak.

Duman testi kancaları (yalnızca geliştirme): `FLOEM_OPEN=dosya.floem`,
`FLOEM_START_VIEW=model`, `FLOEM_SCREENSHOT=cikti.png`, `FLOEM_SCREENSHOT_JS=...`.

#### Rapor görünümü (H4'ün çekirdeği)

- Görseller: **Tablo** (toplam satırıyla), **Kümelenmiş sütun grafiği**, **Kart**.
- Veri bölmesinden alanı işaretleyin ya da sürükleyin. Sayısal alanlar değer olarak "Toplam"
  özetiyle, diğerleri gruplama alanı olarak eklenir (Power BI'daki gibi). Görselleştirmeler
  bölmesinde alan kutuları var; değerin özeti (Toplam, Ortalama, En düşük, En yüksek, Say,
  Say (Farklı)) seçilebilir.
- Görseller taşınır (başlıktan) ve boyutlandırılır (sağ alt köşe). Sayfa sekmeleri: ekleme,
  çift tıklayıp yeniden adlandırma, silme.
- Çapraz filtre: grafikte sütuna ya da tabloda satıra tıklayınca diğer görseller filtrelenir.
- Görsel sorguları Floem DAX derleyicisinden geçer: örtük ölçüler `SUM('INV1'[LineTotal])` gibi
  DAX'a çevrilip SQL'e derlenir ve ilişkiler üzerinden filtrelenir.
- Rapor tanımı `.floem` içindeki `report.json`'dadır. Tablo ya da sütun yeniden adlandırılınca
  görsellerdeki referanslar da güncellenir.

### floembi.app (yerel sunucu) ve yayımlama (H5)

```bash
.venv/Scripts/python -m pip install -e ".[server]"
npm run web:build     # web arayüzünü derler (apps/web/dist)
npm run server        # http://127.0.0.1:8800  (veri: data/server, git dışı)
```

İlk açılışta iki **geliştirme kullanıcısı** ve "Satış Ekibi" çalışma alanı oluşturulur:

| E-posta | Şifre | Rol |
|---|---|---|
| `yonetici@floembi.test` | `Floem.Yonetici1` | Satış Ekibi'nde Yönetici: yayımlar, raporları görür |
| `izleyici@floembi.test` | `Floem.Izleyici1` | Hiçbir alanda üye değil: yalnızca kendisiyle paylaşılan raporu görür |

Şifreler `FLOEM_YONETICI_PASSWORD` / `FLOEM_IZLEYICI_PASSWORD` ile değiştirilebilir (yalnızca ilk
açılışta). Bunlar yalnızca geliştirme içindir; gerçek kullanıcı yönetimi ve SSO sonraki aşamada.

**Yayımlama:** Desktop → *Yayımla* → floembi.app'te oturum aç → çalışma alanı seç. Yayımlanan,
diske kaydedilmiş `.floem` dosyasıdır (kaydedilmemiş değişiklik varsa önce kaydetmeniz istenir).
Sunucu anlam modelini (veri anlık görüntüsü) ve raporu ayrı ayrı saklar. Aynı adla tekrar
yayımlanınca üzerine yazılır ve sürüm artar; son iki sürüm tutulur. Web'de rapor salt okunur ama
etkileşimlidir (çapraz filtre, sayfalar). Yetkisiz işlemler 403 alır ve ekranda okunur mesaj
çıkar ("Bu rapor sizinle paylaşılmamış").

Geliştirmede web arayüzünü anlık yenilemeyle çalıştırmak için: `npm run server` açıkken
`npm run web` (http://127.0.0.1:5299, `/api` istekleri 8800'e gider).

#### Windows yükleyicisi

```bash
.venv/Scripts/python -m pip install -e ".[package]"   # PyInstaller
npm run desktop:package
# → apps/desktop/release/FloemBI-Desktop-Setup-<sürüm>.exe  (NSIS, yönetici izni istemez)
```

Adımlar: PyInstaller Python servisini `build/pyinstaller/dist/floem-service/` altına
`floem-service.exe` olarak derler (onedir, UPX yok). Vite arayüzü derler. electron-builder
servisi `resources/floem-service/` altına koyup kurulum dosyasını üretir. Kurulan uygulamada
Python gerekmez; SQL Server için makinede Microsoft ODBC Driver 17 veya 18 kurulu olmalıdır.
Kod imzalama henüz yok, bu yüzden Windows SmartScreen ilk açılışta uyarı verir.

Lisans notu: PyInstaller GPLv2'dir ama bootloader istisnası, üretilen kapalı kaynak
uygulamanın dağıtımına izin verir. PyInstaller yalnızca derleme aracıdır, ürüne bağımlılık
olarak girmez (karar: 17.11.2026).

Gerçek SQL Server ile isteğe bağlı entegrasyon testi:

```bash
set FLOEM_TEST_MSSQL_SERVER=SUNUCU\INSTANCE
set FLOEM_TEST_MSSQL_USER=okuyucu
set FLOEM_TEST_MSSQL_PASSWORD=...
.venv/Scripts/python -m pytest tests/test_connectors.py
```

### Örnek sorgu

Windows'ta Türkçe karakterli ölçü adlarının bozulmaması için gövdeyi
UTF-8 kodlu bir dosyadan `--data-binary @sorgu.json` ile göndermek daha güvenlidir.

```bash
curl -X POST 127.0.0.1:8000/query -H "Content-Type: application/json; charset=utf-8" -d '{
  "group_by": ["Tarih[Yil]", "Urun[Kategori]"],
  "measures": ["Toplam Satış", "Geçen Yıl Satış", "Kategori Payı"],
  "filters": [{"column": "Musteri[Grup]", "op": "in", "values": ["Bayi"]}]
}'
```

## Desteklenen DAX alt kümesi

Ölçüler Desktop'ta formül çubuğundan yazılır (Hesaplamalar → Yeni ölçü): `Ad = ifade`,
otomatik tamamlama, yazarken hata işareti. Tarih tablosu: Hesaplamalar → Tarih tablosu.

| Grup | Fonksiyonlar |
|---|---|
| Toplama | SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTROWS, DISTINCTCOUNT |
| Satır satır hesaplama (iterator) | SUMX, AVERAGEX, MINX, MAXX, COUNTX; tablo, `FILTER(...)` ya da `VALUES(T[c])` üzerinde; RELATED desteklenir |
| Bağlam geçişi | İteratör içinde ölçü: `AVERAGEX(VALUES(Tarih[Ay]), [Satış])`, `SUMX(Musteri, [Satış] * 2)` (tablonun tek anahtar sütunu olmalı) |
| Filtre bağlamı | CALCULATE, FILTER, ALL, ALLEXCEPT, ALLSELECTED, REMOVEFILTERS, KEEPFILTERS, USERELATIONSHIP, tek ya da aynı tablonun çok sütunlu boolean koşulları |
| Tek değer | VALUES (skaler), SELECTEDVALUE, HASONEVALUE |
| Zaman zekâsı | SAMEPERIODLASTYEAR, DATEADD (YEAR/QUARTER/MONTH), DATESYTD/QTD/MTD, TOTALYTD/QTD/MTD |
| Mantık ve skaler | IF, SWITCH, DIVIDE, ISBLANK, COALESCE, BLANK, AND, OR, NOT, IN, ABS, ROUND, INT, MOD |
| Tarih ve metin | YEAR, MONTH, DAY, DATE, TODAY, LEN, LEFT, RIGHT, MID, TRIM, UPPER, LOWER, CONCATENATE |
| Değişkenler | VAR / RETURN |
| Güvenlik | USERPRINCIPALNAME, USERATTRIBUTE (RLS kuralları için) |

**Bilinen sapmalar ve sonraya kalanlar:**
- FILTER koşulunda ölçü (`FILTER(Musteri, [Satış] > 1000)`) ve hesaplanmış sütunda ölçü henüz yok.
- CROSSFILTER, RANKX, TOPN, SUMMARIZE, ADDCOLUMNS, EARLIER desteklenmiyor.
- Çift yönlü ilişkiler tek yön gibi uygulanıyor; model yüklenirken uyarı veriliyor.
- `x / 0`, DAX'taki ∞ yerine BLANK döndürüyor.
- Zaman zekâsı için tarih tablosu, ölçünün taban tablosuna doğrudan bağlı olmalı.
- Zaman zekâsının tek günlük bağlamlardaki uç durumu için: `src/floem_bi/compiler/timeintel.py`.

## Yapı

```
src/floem_bi/
  dax/        lexer, Pratt parser, AST
  model/      YAML şeması (pydantic), ad çözümleme, ilişki grafiği, doğrulama
  compiler/   IR, filtre bağlamı (measures.py), zaman eşlemeleri, SQL üretimi (sqlgen.py)
  engine/     DuckDB motoru
  api/        FastAPI query-service
  demo/       sentetik SAP B1 verisi + Gold katmanı
examples/     örnek semantik model
tests/        parser, zaman eşlemesi, ölçü sonuçlarının oracle karşılaştırması, RLS, T-SQL, API testleri
research/     açık kaynak araştırma notları (repos/ git dışı)
```
