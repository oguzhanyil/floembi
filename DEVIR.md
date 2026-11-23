# Floem BI: devir notu (23.11.2026)

Güncel geliştirme: F10A, F08, F09, F11 ve F13 uygulandı. F12 yerel süreç pilotları ve F14 BI ölçü/uyarı altyapısı ile yerel pilot hazır; gerçek kaynak kabulü açık. Kullanıcı Analytics'in çalışmadığını bildirdi; F14 canlı adaptör/kabul açık. Sıradaki ürün aşaması F15 senaryo ve yetkili işlem iş akışları.
F06-2–5 kaynak ölçü/motor/mutabakat işleri açık; nihai tema seçilmedi.

Bu dosya, projeyi devralan geliştiriciye ya da yapay zekâ ajanına yazıldı. Şunları anlatır:
- Bugüne kadar ne yapıldığı,
- Kesin kurallar,
- Kodun nerede durduğu,
- Plana göre sırada ne olduğu.

Önce bunu, ardından [CLAUDE.md](CLAUDE.md) (araştırma görevinin kuralları) ve [README.md](README.md)
(çalıştırma ve özellikler) dosyalarını okuyun.

## 1. Proje ve kullanıcı

**19.11.2026 etkileşim güncellemesi:** Rapor tasarımcısına `button` nesnesi, tıklama olayları
(sayfaya git, sonraki/önceki, filtreleri sıfırla, nesne göster/gizle, URL aç, fonksiyon, menü),
başlangıçta gizlenen nesneler ve ikonlu etkileşim önizleme anahtarı eklendi. Sağ üstteki Veri ve
Görselleştirmeler düğmeleri panellerini bağımsız açar/kapatır; tek panel açıkken yalnız onun genişliği ayrılır.
Serbest tasarım/etkileşim düğmesi 32 px, ortalanmış simgesi 16 px'dir.
Sayfa rengi ve nesne düzeni araçları Biçim panelindedir.
Tablo ve matriste satır eylem hücresi hazır veya yüklenen ikonla URL'ye kodlanmış `{value}` değeri
aktarır, hedef sayfayı aynı değerle filtreler ya da satır filtresiyle kayıtlı FDX ölçüsünü hesaplar.
Yalnızca HTTP(S) URL ve tanımlı fonksiyonlar çalıştırılır. Aynı olaylar
`packages/report/src/visualActions.ts` üzerinden Desktop ve web görüntüleyicisinde çözülür.
PBIP içe aktarıcısı `PageNavigation` düğmelerini alttaki kart/metin/şekle bağlar; içerik yoksa
saydam düğme üretir. Pavezyum yönetici panosunda menü ve yeni düğmeyle sayfa geçişi, sentetik
veride satır değeriyle detay sayfası ve FDX ölçüsü Desktop duman testinde doğrulandı.
PBIP taslaklarında gerçek veri yoktur.

- **Floem BI**, Power BI'ın karşılığı olan, kendi sunucuda çalışan, ticari ve kapalı kaynak bir BI ürünü.
  - Üç parçası var: Desktop (Electron), floembi.app (web sunucusu) ve Floemway (şirket içi ağ geçidi).
- **Kullanıcı (Oğuzhan)** Power BI'ı iyi biliyor, SQL Server ve SAP Business One üzerinde çalışıyor.
  - Anlatımlarda ve arayüzde Power BI kavramlarını kullanın ("Power BI'daki X'in karşılığı…").
- **Dil:** tüm yanıtlar, arayüz metinleri, hata mesajları, commit mesajları ve belgeler **Türkçe**.
  Kod, dosya adları ve teknik terimler orijinal kalır.
- **Ürün terimleri:** DAX yerine **FDX** (Floem Data Expressions), Power Query yerine **Floem Query** denir.
  - Sözdizimi DAX ile aynıdır.
  - Koddaki iç adlar (`floem_bi/dax`, `DaxSyntaxError`) değiştirilmez.
- **Depo:** https://github.com/oguzhanyil/floembi, dal `main`.
  - Kullanıcı `main`'e doğrudan commit ve push izni verdi; her aşama sonunda commit atılır.
  - Commit mesajları Türkçe, başlıkta aşama adı ("H7: …").

## 2. Kesin kurallar (ihlal etmeyin)

1. **Lisans:** yalnızca MIT, Apache-2.0, BSD, ISC, 0BSD, MIT-0 lisanslı bağımlılıklar kullanılabilir.
   - PyInstaller yalnızca derleme aracı olarak onaylı.
   - AGPL, GPL, ELv2 ya da MPL kullanılamaz. Yeni bağımlılık eklemeden önce lisansını doğrulayın.
2. **Kimlik bilgileri** dosyaya, depoya ve günlüğe düz metin olarak yazılmaz.
   - Desktop'ta Windows Kimlik Bilgisi Yöneticisi (`keyring`) kullanılır.
   - Sunucuda SMTP şifresi Fernet ile şifreli saklanır.
   - Floemway veri kaynağı şifresi, ağ geçidinin açık anahtarıyla şifrelenecek; sunucu çözemeyecek.
   - Kullanıcının sohbette paylaştığı şifreleri hiçbir yere yazmayın.
3. **Push öncesi gizli bilgi taraması yapın:** şifreler, anahtarlar ve kullanıcının sunucu IP'si.
   - Kullanıcının gerçek SQL Server IP'si **asla commit edilmez**.
   - `*.floem` dosyaları gerçek şirket verisi içerebilir; git dışında tutulur.
4. **Kullanıcının veritabanına yazmayın, onun SQL Server'ında DB oluşturmayın.** Kaynaklara yalnızca okuma erişimi var.
5. **Kullanıcının süreçlerine dokunmayın:**
   - Yalnızca sizin başlattığınız PID'leri durdurun; geniş kapsamlı `taskkill` kullanmayın.
   - Kullanıcının sunucusu **8800**'de çalışır; deneme sunucularını başka bir portta açın (örn. 8811).
   - `localhost:8765`'te kullanıcının başka bir servisi var, ona dokunmayın.
6. **Kişisel veri:** kullanıcının e-postasını dış servislere onay almadan göndermeyin.
7. **Kapsam:** planda "bilerek ertelendi" denen işleri kendiliğinden eklemeyin. Bunlar: DirectQuery,
   SSO ve gerçek kullanıcı yönetimi, web'de rapor düzenleme, çok kiracılık, PostgreSQL/Excel/REST bağlayıcıları.
8. **Çok yavaşlayan makine:** bu bilgisayar zaman zaman ağırlaşıyor; test takımının süresi 50 saniyeden 12 dakikaya çıkabiliyor.
   - Uzun komutları arka planda çalıştırın.
   - Tam test takımı çalışırken kaynak dosyalarını değiştirmeyin.

## 3. Mimari ve kodun yeri

```
src/floem_bi/
  dax/            FDX lexer + Pratt parser, yeniden adlandırma (rename.py)
  model/          YAML semantik model (schema.py: Tablo, Sutun, Iliski, Olcu, Rol…), ilişki grafiği
  compiler/       FDX → SQL: filtre bağlamı, CALCULATE, zaman zekâsı, RLS (sqlgen.py, measures.py), DuckDB + T-SQL
  engine/         DuckDB motoru
  connectors/     SQL Server bağlayıcısı (mssql-python/pyodbc), sqlguard (yalnızca SELECT)
  importer/       kaynak → DuckDB içe aktarım, tip eşleme, ilişki keşfi
  transform/      Floem Query adım motoru
  document/       açık belge (.floem), model düzenleme işlemleri (ops.py), işler (jobs.py)
  report/         rapor şeması, görsel sorgusu (run_visual_query)
  desktop_service/ Desktop'un yerel FastAPI servisi (127.0.0.1 + X-Floem-Token)
  server/         floembi.app: app.py (tüm uç noktalar), db.py (SQLAlchemy Core tabloları),
                  auth.py, mail.py (SMTP, şablonlar), events.py (SSE)
apps/desktop/     Electron + React (Vite)
apps/web/         floembi.app web arayüzü (React): App.tsx, apps.tsx, security.tsx, share.tsx, admin.tsx
packages/client/  FloemClient tipleri + DesktopClient/WebClient (tek API sözleşmesi)
packages/report/  ortak rapor görüntüleyici ve görseller (ECharts, TanStack)
packages/designer/ ortak rapor tasarımcısı
packaging/        PyInstaller servis paketi, run-server.mjs
research/notes/   33 açık kaynak proje analizi + 99-floem-bi-sentez.md (mimari kararlar)
tests/            pytest; test_server.py sunucu, test_document.py Desktop servisi (sahte SAP B1 kaynağı)
```

**Temel ilkeler**
- Tek çekirdek iki yerde çalışır: Desktop yerel servisi ve sunucu aynı derleyiciyi ve aynı `VisualQuery` sözleşmesini kullanır.
- Arayüz paketleri Electron'dan bağımsızdır.
- Her yenileme yeni bir DuckDB anlık görüntüsü üretir; geçiş atomiktir.

**Sunucu veritabanı** (SQLite, `data/server/floem.db`; ileride Postgres):
- `users` (is_admin), `workspaces`, `members` (admin/member/contributor/viewer)
- `datasets`, `reports`, `shares`
- `apps`, `app_items` (dondurulmuş rapor tanımı), `app_access`
- `role_members` (RLS ataması)
- `mail_config`, `mail_log`, `invitations`, `pending_grants` (workspace/report/app)
- Eski veritabanları için sütun eklemeleri `db._migrate()` içinde yapılır.

## 4. Çalıştırma ve test

```
python -m venv .venv && .venv\Scripts\pip install -e .[dev,server]
npm install
.venv\Scripts\python -m pytest -q          # Son tam koşu: 163 passed, 1 skipped
npm run typecheck                          # ya da: npx tsc --noEmit -p apps/web (apps/desktop)
npm run desktop                            # Electron (geliştirme)
npm run server                             # floembi.app → http://127.0.0.1:8800
npm run web:build                          # sunucunun sunduğu web arayüzü
```

- **Sahte kullanıcılar** (yalnızca geliştirme için):
  - `yonetici@floembi.test` / `Floem.Yonetici1`: Yönetici ve sistem yöneticisi.
  - `izleyici@floembi.test` / `Floem.Izleyici1`
- **E-posta:** SMTP ayarlanmamışsa e-postalar `data/server/outbox/*.eml` dosyalarına yazılır ve web'de "Gelen e-postalar" sayfasında görünür.
- **Ekran görüntüsüyle doğrulama:** Edge headless ve CDP kullanılıyor (Node 26 yerleşik WebSocket).
  - Git Bash'te `export MSYS_NO_PATHCONV=1` şart. Aksi hâlde `/workspaces/1` gibi argümanlar Windows yoluna çevrilir.
  - Oturum `localStorage["floem.session"] = {token, user}` ile verilir.
  - curl'e Türkçe JSON gönderilince gövde bozuluyor; Python `urllib` kullanın.

## 5. Tamamlananlar

| Aşama | Durum | İçerik |
|---|---|---|
| Araştırma | ✓ | `research/notes/`, sentez ve mimari kararlar |
| H1 | ✓ | Electron kabuğu, SQL Server bağlantısı (keyring), Navigator, SQL penceresi (yalnızca SELECT), PyInstaller + NSIS yükleyici |
| H2 | ✓ | İçe aktarım işi, ilişki algılama, model görünümü (xyflow), Özellikler bölmesi, ops API, `.floem` dosyası |
| H3 | ✓ (hiyerarşi oluşturma arayüzü hariç) | FDX formül çubuğu, ölçü yönetimi, tarih tablosu, tablo görünümü, Floem Query düzenleyicisi |
| H4 | ✓ | Rapor tasarımcısı: ECharts görselleri, matris, drill-down, dilimleyici, Biçim bölmesi, çapraz filtre, detaya git, metin kutusu, KPI ve trend, hizalama kılavuzları |
| H5 | ✓ | floembi.app sunucusu, giriş (JWT + argon2), çalışma alanları, Desktop'tan **Yayımla**, web'de rapor görüntüleme |
| H6 | ✓ | E-postayla paylaşım ve davet, Yönetim (e-posta sunucusu ekranı, kullanıcılar), **RLS** (Desktop: Rolleri yönet + Farklı görüntüle; web: anlam modeli → Güvenlik), **App** yayınlama (dondurulmuş sürüm, erişim, davet), **SSE** ile anlık güncelleme |
| H7 | ✓ | Floemway konsol uygulaması, tek kullanımlık kayıt, Windows Kimlik Bilgisi Yöneticisi'nde özel anahtar, dışa açılan WebSocket, Desktop yayımlamasında otomatik şifreli SQL bağlantısı eşlemesi, manuel yenileme, Arrow aktarımı, atomik DuckDB sürümü, hata geçmişi ve SSE |

## 6. Sırada: plana göre yapılacaklar

### 23.11.2026 F14 BI tarafı ve yerel pilot uygulandı; canlı Analytics kabulü açık

- `data/F14-Analytics-ve-Uyarilar.floem`: iki firma, iki katalog ölçüsü ve iki eşik;
  normal FDX kartlarıyla aynı sayfada; firma/dönem/müşteri seçimi ve 390 px telefon
  düzeni. Üretici `python -m floem_bi.analytics_demo data/F14-Yeni.floem` mevcut
  dosyaya yazmaz. F12'nin bağlantısız sentetik verisini kullanır; git dışında.
- `Report.analytics`: kalıcı kimlik, kayıtlı FDX, firma anahtarı, tane, birim,
  sabit filtre ve mutlak tolerans. `gt/ge/lt/le` eşikleri, Designer'da **Analytics
  ve uyarılar** paneli, **Ölçü ve uyarı** (`signal`) nesnesi ve F13 denetimi.
- `VisualQuery.analytics`: mevcut kimlik doğrulamalı Desktop, rapor ve App sorgu
  uçlarından aynı FDX hesabı. Firma ve değer sorguları aynı kilit/anlık görüntüyü
  kullanır; ikisine de RLS uygulanır. App dondurulmuş kataloğunu kullanır.
  Katalogdaki FDX/firma/filtre bağları yeniden adlandırmayı izler.
- `floem-metric/v1` makbuzu: model+ölçü+kural sürümü, firma/filtre/birim/tane kapsamı,
  belge/veri/yetki sürümü, kaynak zamanı beyanı ve ayrı değerlendirme zamanı.
  Zaman bilinmiyorsa eşit sayı doğrulanmış sayılmaz; boş sıfıra dönüşmez.
- JSON kanıtı indir/yükle: kapsam eşitse tolerans kontrolü; farklı kullanıcı,
  sürüm, firma veya filtrede eşit sayı bile uyum sayılmaz. Kanıt imzasız beyan;
  oturumda kalır, rapora yazılmaz. Geciken istek/yüklemede eski makbuz aktarılmaz.
  PDF/Excel/CSV güncel sayısal sonucu, JSON ise eşik/meta ayrıntılarını verir.
- Kullanıcı Analytics'in **çalışmadığını** söyledi. Yerel kopya yalnız okundu;
  Gold yanıtında ölçü+veri sürümü birlikte yok. Harici kod/servis değiştirilmedi.
  BI API'si hazır olsa da canlı adaptör ve tek yetkili sağlayıcıyla gerçek kaynak
  mutabakatı **açık**. İstatistiksel anomali, bildirim ve kaynak yazma eklenmedi.
- Ayrıntı: [F14 kullanım notu](docs/f14-ortak-olcu-ve-uyarilar.md).
  Sırada **F15**; F06-2–5, F12 gerçek kaynak/kullanıcı kabulü ve nihai tema açık.
- Doğrulama: 335 Python geçti / 1 atlandı; 81 saf TS kontrolü, 32 nesneli tam
  Chromium turu, typecheck ve Desktop/web derlemeleri geçti. Gerçek dosya+FDX ile
  180 satış / 350 bakiye, eşikler ve üç viewport/DPR doğrulandı; QA git dışında.

### 20.11.2026 F12 yerel süreç pilotları uygulandı; sırada F14

- `data/F12-Surec-Pilotlari.floem`: 6 düzenlenebilir sayfa; 12 tablo, 14 ilişki
  (13 aktif), 15 FDX ölçüsü, 2 firma, 12 müşteri, 16 parti ve 64 kalite kaydı.
  **Tamamen sentetik**; gerçek kaynak/kullanıcı kabulü F06'ya bağlı açık.
  Yeni dosya üretimi: `python -m floem_bi.process_demo data/F12-Yeni.floem`.
- Müşteri → olay → belge ve parti → kalite geçişleri firma/dönem/anahtarı taşır.
  Yeni `keepContext` sayfa eylemi ve `back` düğme eylemi; 20 geçişli oturum geçmişi
  filtreleri, çapraz seçimi, dilimleyicileri ve görünürlüğü geri yükler. Eski düğmelerin
  varsayılan filtre davranışı korunur. Önizleme kaydetme başlatmaz.
- Yeni `lineage` (Parti bağlantıları): tek kökten üst/alt/iki yönde sınırlı komşuluk;
  varsayılan 2 adım / 40 düğüm / 80 kenar, sert üst sınır 4 / 100 / 200.
  Döngü/elmas tekil düğüm/kenarla gösterilir; bağlantı miktarı üretim toplamı değildir.
  Kök ve komşu sorguları `page.snapshot` ile aynı veri/yetki sürümüne bağlanır.
  Grafikte düğüm seçimi yalnız grafiği değiştirir; kalite ilk seçili partide kalır.
- Yeni `tolerance` (Kalite toleransı): tekil ölçüm, alt/üst sınır ve isteğe bağlı hedef.
  Sınırlar dahil; eksik/ters sınır doğrulanamadı. Farklı birimler toplanmaz.
- `compiler/sqlgen.py::_fallback_axis`: ölçüsüz alan listeleri daha önce yalnız kendi
  tablo filtresini kullanıyordu. İlişkili boyut filtresi ve RLS'nin aktif ilişki yolu
  da uygulanır. Yerel ve yayımlanmış raporda firma dışı anahtar sızmaması test edilir.
- Kaynaklar: `process_demo.py`, `reportJourney.ts`, `useReportJourney.ts`, `lineage.ts`,
  `LineageVisual.tsx`, `ToleranceVisual.tsx`. Yeni bağımlılık yok; SVG/HTML kullanılır.
- [Kullanım, hesap sözleşmesi ve kabul sınırları](docs/f12-surec-pilotlari.md).
  Doğrulama: 316 Python geçti / 1 atlandı, 78 saf TypeScript kontrolü, 31 nesneli
  tam Chromium turu, typecheck ve Desktop/web üretim derlemeleri geçti.
  Sıradaki ürün aşaması F14 Analytics ölçü/uyarı entegrasyonu; F06-2–5 ve gerçek süreç
  kabulü açık kalır. Fiziksel kütle dengesi, ERP kapatma/yaşlandırma ve yazma iş akışı yok.

### 20.11.2026 F13 tasarım ve anlam denetçisi uygulandı; ardından F12 yerel pilotları

- **Görselleştirmeler → Tasarımı denetle:** hata/uyarı/bilgi, kategori/sayfa/arama;
  gerekçe/öneri, doğru sayfa ve düzenin nesnesine gitme, tüm bulguları JSON indirme.
  Denetleme ve yönlendirme kayıt/undo adımı oluşturmaz; otomatik düzeltme/yayın engeli yok.
- `packages/designer/src/designAudit.ts`: saf denetim; tüm kayıtlı varyantlarda sınır,
  kapsayıcı, yazı, eksik model/şablon/eylem bağı; açık biçimden birim çıkarımı,
  anahtar/özet-SUM ve toplanamayan toplam açıklaması. İş kuralı ispatı değildir.
- `useDesignMeasurements.ts`: açık düzende gerçek taşma/yazı ölçümü; tuval scale ve
  DPR ayrılır, gizli başlık/yer tutucu/tablo veri kaydırması dışarıda tutulur.
- `packages/report/src/diagnostics.tsx`: mevcut sorgulardan yalnız durum/sayı metadata;
  yeni sorgu çalışmaz. Ham kayıt/filtre değeri/URL/hata ayrıntısı aktarılmaz.
  Sayfa/düzen/veri/rapor sürümüyle eski gözlemler geçersizdir. Normal sunucu sayfası
  `truncated` bilgisi veri kesilmesi sayılmaz. Şablon alt nesneleri tekrarlayıcıya bağlanır.
- Yerel `data/F13-Tasarim-Denetimi.floem`: 4 sayfa, telefon varyantı, 12.050 sentetik
  müşteri. İlk sayfada bilinçli sorunlar; diğerleri çalışan F11 örnekleri. Üretici:
  `python -m floem_bi.inspector_demo data/F13-Yeni.floem`; var olan hedefi korur.
- DOM ölçümü yalnız yüklenmiş/görünür metni kapsar. Açılmamış varyantların minimum
  geometrisi bilinir; sanal listenin gizli satırları ve grafik etiketi piksel analizi yok.
  Kontrast belgesi/kaynak hesap mutabakatı/otomatik düzeltme yapılmaz. F06-2–5 açık.
- [Kullanım, kurallar ve sınırlar](docs/f13-tasarim-ve-anlam-denetcisi.md).
- Doğrulama: 308 Python geçti, 1 atlandı; 72 saf TypeScript testi, tam Chromium
  arayüz koşusu, typecheck ve Desktop/web üretim derlemeleri geçti. Şablon/sayfa
  nesne kimliği çakışmasında bulgunun tekrarlayıcıya bağlanması da sınanır.
  Yerel kanıtlar `data/qa-f13/`; yeni bağımlılık yok, kullanıcı süreçleri durdurulmadı,
  canlı rapor yayımlanmadı. Kullanıcıya ait package dosyaları commit dışında tutulur.

**Sırada F12:** müşteri 360° ve parti/kalite pilotlarını bu araçlarla oluşturmak;
seçili kayıt bağlamını ve parti miktarlarının yinelenmeden hesaplanmasını doğrulamak.
Gerçek kaynak mutabakatı ve F06-2–5 sonuçlandırılmadan tam ölçü geçişi iddia edilmez.

### 20.11.2026 F11 veri bağları, nesne durumları, tekrarlayıcı ve hareket uygulandı; ardından F13

- `Visual.bindings`: alan/FDX ölçüsü veya mevcut satırdan metin, değer, zemin/yazı rengi,
  simge ve görünürlük. Koşullar tipli; tek alanın çoklu değeri hata verir. Filtre/sürüm
  değişiminden sonra eski yanıt uygulanmaz; aynı nesnedeki aynı sorgu paylaşılır.
- `Visual.states`: normal/hover-odak/seçili/yükleniyor/boş/hata görünümü. Biçim paneli ve
  kaydedilmeyen durum önizlemesi. Gizli kapsayıcının çocukları web'de gizlenir, tasarımda
  soluk kalır; akış boşluğu korunur. Gizleme erişim kontrolü değildir.
- Yeni `icon` ve `repeater` nesneleri. Tekrarlayıcı gömülü F07B bileşeninin değişmez
  sürümünü, eşlenmiş yuvalarını ve mevcut satır bağlarını kullanır. Şablon içinde sorgu
  veya grafik/tablo çalışmaz. 25–500 grupluk sunucu sayfasında yalnız görünür kartlar +
  tampon çizilir; kimlik bütün gruplama değerlerinin JSON'udur. Kart yüksekliği sabittir.
- Satır seçimi tam gruplama kapsamıyla çapraz filtre yapar; düğme URL/detay/FDX eylemine
  satırı taşır. Şablon içi göster/gizle o satıra özeldir. Sağ tıkta düz satır verisi
  PDF/Excel/CSV olarak indirilir; F09 kapsam/sürüm/iptal/sınırları kullanılır.
- Sonlu değer değişimi vurgusu ve kart/sayaç sayma hareketi. Hızlı değişimde son hedef,
  tema/OS azaltılmış hareket ve arka plan sekmesi gözetilir; sonsuz pulse kaldırıldı.
- `python -m floem_bi.runtime_demo data/F11-Yeni.floem`: önceki dosyayı değiştirmeyen
  üretici. Yerel `data/F11-Tasarim-Atolyesi.floem`: 3 sayfa, 12.050 sentetik müşteri,
  gömülü müşteri kartı; harici veri bağlantısı yok. Gerçek süreç pilotu F12'de kalır.
- 307 Python geçti / 1 atlandı; 59 saf TS; tam Chromium (29 nesne, önceki aşamalar ve
  yeni F11), typecheck ve iki üretim derlemesi geçti. Şema/dosya/yayın/RLS kontrolleri
  dahil. Ekranlar/günlükler `data/qa-f11/` içinde, git dışında.
- [Kullanım ve sınırlar](docs/f11-veri-baglari-ve-tekrarlayici.md). Desktop/web Python
  sürecinin güncel şemayla yeniden açılması gerekir; kullanıcı süreçleri durdurulmadı,
  canlı rapor yayımlanmadı. Yeni bağımlılık yok; kullanıcıya ait package dosyalarına dokunulmadı.

**F11 sonrasındaki F13 de uygulandı:** taşma, küçük yazı, eksik bağ, birim/toplama ve
veri kapsamı gerekçeli denetlenir; tasarım kendiliğinden değişmez. Sırada F12; F06-2–5 açık.

### 20.11.2026 F09 büyük Grid/Tree Grid uygulandı (tamamlanan önceki aşama)

- Tablo/Tree Grid için `format.gridDataMode: "server"` opt-in; varsayılan eski mod.
  Tablo arama/sütun filtreleri bütün gruplarda; sayfalar 25–500 grup, API en fazla 1.000.
- Kararlı SQL sırası, parametreli çıktı araması, FDX toplamı; toplam arama/sütun
  filtrelerinden bağımsızdır, sayfa toplamlarından türetilmez. Rapor/çapraz seçim/RLS korunur.
- `VisualQuery.page` + `VisualResult.page`: snapshot veri/erişim, revision sorgu bağlamı.
  Veri/rol/sorgu değişince sayfa/indirme reddi ve ilk sayfadan yeniden yükleme.
- Ağaç +/− yalnız açılan dalın sonraki düzeyini sorgular; her dalın araması/sayfası
  ayrıdır. En fazla 32 açık dal ve Dalları kapat; boş dal, ikonlu satır eylemi korunur.
- Bu sayfa / tüm eşleşen gruplar CSV/Excel/PDF; ilerleme/iptal; CSV/Excel 100.000,
  PDF 2.000 grup sınırı, kısmi başarı yok. Yeni ağaç Excel'i o dalın **tek düzeyidir**,
  eski matris Excel outline aktarımı ayrıca korunur. Genel toplam dosyaya detay gibi eklenmez.
- Yeni üretici `python -m floem_bi.grid_demo data/F09-Yeni.floem`; yerel verili örnek
  `data/F09-Buyuk-Grid.floem`: 2 sayfa, 12.150 sentetik satır ve 12.050 kimlik. Kaynak bağlantısı yok.
- Python 291 geçti/1 atlandı; 52 saf TS; tam Chromium ve yeni F09 etkileşim kontrolleri,
  typecheck ve iki üretim derlemesi geçti. Eski F05 sürükleme testinde taşınacak nesne
  açıkça seçilerek, F08'de kaydırma sonrası yerleşim/hover beklenerek testler düzeltildi.
  [Kullanım, doğrulama ve sınırlar](docs/f09-buyuk-grid-ve-aktarim.md).
- Kullanıcı sunucuları durdurulmadı, canlıya yayımlanmadı. Güncel sorgu şeması için
  Desktop ve web Python sunucusunu güncel kodla yeniden açmak gerekir.

**F09 sonrasında F11 de uygulandı:** alan/ölçüye bağlı metin-değer-renk-ikon-görünürlük,
nesne durumları, sanallaştırılmış satır tekrarlayıcı ve sonlu hareket. F13 de hazır; sırada F12;
F06-2–5 ölçü/motor/mutabakat işleri açık; kaynak yazma ayrı kapsamdır.

### 20.11.2026 F08 ekran düzenleri uygulandı (tamamlanan önceki aşama)

- `ReportPage.layouts[]` ile aynı görsellerin laptop/tablet/telefon yerleşimleri;
  geometri, akış ve sınırlı sunum istisnaları ayrı, semantik ve eylemler ortaktır.
- Görselleştirmeler → Ekran düzenleri: oluştur/seç, eşik/boyut, sayfa akışı,
  seçimi Ana düzenden al ve düzen kaldır. Değişiklikler undo/redo'ya katılır.
- Web rapor bölmesi genişliğini ölçer; en dar eşleşen eşiği seçer. Alttaki Düzen
  menüsü manuel seçim sunar. Filtre/görünürlük/eylem durumu ve sorgular korunur.
- Kök akışı gerçek metin/kapsayıcı yüksekliğiyle sayfayı büyütür; taşma uyarılır.
  Gruplama/üst kapsayıcı ve ortak bileşen kitaplığı Ana düzende düzenlenir.
- Yeni yerel dosya: `data/SAPB1Demo-Floem-F08.floem`; 11 sayfa, ilk ikisinde üçer
  düzen, beş boş dönmeyen veri sorgusu. Önceki F07B dosyası korunur.
- Üretici aynı TS yardımcısını kullanır: `scripts/create-responsive-demo.mjs`.
  [Kullanım, veri sözleşmesi ve sınırlar](docs/f08-ekran-duzenleri.md).
- Kullanıcı sunucuları durdurulmadı. Yeni şema için Desktop ve web Python
  sunucusunun güncel kodla yeniden açılması gerekir.
- Doğrulama: 275 Python geçti, 1 atlandı; 47 saf TS; tam Chromium; typecheck ve
  Desktop/web derlemeleri geçti. Gerçek demo DuckDB sonuçları ve web stil dosyasıyla
  telefon görünümü de denetlendi; arayüzdeki uzun rapor başlığı satıra geçer.

**Sonraki F09 (artık uygulandı):** 10.000 üstü sentetik kayıtta sunucu arama/sayfalama sözleşmesi,
kararlı sıralama ve filtre/RLS bağlamı; toplamların kapsamı; görünen sonuç/tam kapsam
ayrımını açıkça gösteren CSV/Excel/PDF davranışı. Kullanıcının SQL kaynağına yazılmaz.

### 20.11.2026 F10A sayfa görünümü uygulandı (tamamlanan önceki aşama)

[Kullanım ve sözleşme](docs/f10a-sayfa-gorunumu.md). Başlangıç `FitToPage/FitToWidth/ActualSize`,
sayfa başına oturum zoom'u, zemin/dış alan rengi ve ayrı %0–100 saydamlık. Koordinatlar sabit;
yazı/grafikler solmaz. Sayfa alt katmanı rapor temasının zemini; dış alan alt katmanı
uygulama `--bg` yüzeyi. Tuval/dış alan sıfırlama düğmeleri sayfa Biçim panelinde.
Pencere/sayfa değişimi ve yeniden açma ortak ReportViewport üzerinden Desktop/web'de çözülür.

Yedi PBIP, 39 sayfa: 39 görünüm, 37 tuval saydamlığı, 32 dış renk, 31 dış saydamlık
uygulandı; bu dört yol için yeni analizde kalan kayıp bulgusu 0. Desteklenmeyen değerler,
dinamik renk ve koşullu seçiciler bulgu olarak kalır. Eski aktarım geçmişi değiştirilmez.
16 yeni Python, 3 saf TS ve Chromium görünüm/zemin/oturum kontrolleri eklendi.
F08 aynı ölçü/eylemi koruyan laptop/tablet/telefon düzenleri bu temelin üzerine gelir.

### 20.11.2026 F07B bileşen ve marka kitaplığı uygulandı; sırada F10A → F08

[Kullanım ve sözleşme](docs/f07b-bilesen-ve-marka-kitapligi.md). Görselleştirmeler →
Bileşen kitaplığı: grup/kapsayıcı/tek nesne kaydetme, alan yuvaları, sayfa/model eşleme,
sürümlü ortak stil ve yerel istisna. Yeni sürüm etkilenen kullanımlarla önizlenir;
seçili veya açık rapordaki tüm kullanımlara elle uygulanır. Ölçü/konum/yerel renk,
ekleme/silme korunur; toplu uygulama tek undo adımıdır. Kitaplık kaydı undo ile silinmez.
Hazır KPI, gezinme/filtre ve süreç kartı; JSON alışverişi, bağ koparma ve yerel kaldırma var.

Desktop kitaplığı `%APPDATA%\FloemBI\components.json`: token korumalı API, CAS revizyonu,
atomik yazma, 10 MB/500 sürüm. Bileşen 200 nesne/200 yuva/16 düzey; yol/ağaç/eşleme
doğrulamalı. Kullanılan sürümler rapora gömülür; normal nesneler web'de yerel kitaplık
olmadan görünür. Diğer raporlar açılınca güncelleme ayrıca uygulanır; canlı yayın değiştirilmedi.
Model yeniden adlandırma kullanım eşlemesini günceller; değişmez tanım sürümleri korunur.
Kopyalama yerel silinmiş kimlikleri de ayırır; alt ağaç dışına taşıma bağı koparır.

Marka ve ikonlar: Yıldırım Y/piksel işaretinden dört ürün ailesi, altı logo varyantı,
açık/koyu görünüm, gerçek 16–512 px karşılaştırma ve SVG/PNG/ICO. Logo tuvale eklenir.
Mevcut paket simgesi otomatik değiştirilmedi; yeni bağımlılık yok.

Yeni yerel `data/SAPB1Demo-Floem-F07B.floem`: 11 sayfa, iki sürüm, dört bağlı kullanım.
İlk iki sayfadaki beş sorgu boş olmayan sonuç verdi. Önceki demolar korunur.
`python -m floem_bi.component_demo` yeni hedefe üretir. 13 yeni Python testi, 16 yeni
saf TS bileşen/marka testi ve Chromium kitaplık/alan/sürüm/undo/web/marka kontrolleri var.
Son tam koşu: **240 Python geçti, 1 atlandı**; **36 saf TS testi** ve tüm tarayıcı
regresyonları başarılı. Typecheck ve Desktop/web üretim derlemeleri geçti.

**Sıradaki F10A-01–04:** PBIP `displayOption`, tuval saydamlığı ve tuval dışı alan
rengi/saydamlığı. Sonrasında F08 düzen varyantları. F06-2–5 ve F11 işleri açık.

### 20.11.2026 F05 tasarım düzeni uygulandı

[Kullanım ve sözleşme](docs/f05-grup-kapsayici-ve-yerlesim.md). Shift çoklu seçim, grup/kapsayıcı,
iç içe katmanlar, grup orantılı boyutu, hizalama/eşit aralık, yatay/dikey/ızgara düzen,
boşluk/satır kaydırma/min-max/büyüme payı, otomatik yükseklik ve taşma uyarısı eklendi.
Ctrl+Alt sürükleme veya üst nesne listesiyle kapsayıcı değişir; akış kardeşleri sürüklenerek sıralanır.
Kapsayıcı kilidi, görünürlüğü, opaklığı ve kırpması alt ağaca uygulanır.
Grup çözme ve serbeste geçişte ölçülen metin konumları korunur; taşıma otomatik yüksekliği sabitlemez.

`parentId`/yerel koordinat/`container`/`layoutItem` sözleşmesi geriye uyumlu; Python ağaç,
döngü, aynı sayfa, 16 düzey ve sonlu boyut doğrulaması yapar. Ortak `layout.ts` ve
`usePageLayout.ts` Desktop/web'de aynı yerleşimi çözer. 75 adım oturum geçmişi;
sürükleme tek adımdır, Escape iptal eder; metin girişinin doğal undo davranışı korunur.
Kayıt kuyruğu ve kendi eski kayıt cevaplarını ayırma, undo'nun eski veriyle ezilmesini önler.
Yeni belge kimliği tasarımcıyı yeniden kurar. Geçmiş dosyaya yazılmaz.

Yeni `data/SAPB1Demo-Floem-F05.floem`: F06'nın yerel kopyası, 10 sayfa; ilk sayfa
Tasarım Atölyesi, 26 nesne, 4 çalışan veri sorgusu. `python -m floem_bi.layout_demo`
yeni hedefe yeniden üretir; eski dosya ezilmez. Kullanıcı DB'si ve canlı yayın değiştirilmedi.
227 Python testi geçti, 1 atlandı; 20 saf tasarım testi ve Chromium regresyonları başarılı.
Gerçek atölye geometrisi sentetik ekran verisiyle incelendi; yeni bağımlılık yok.

F07B birleşik nesne kitaplığı bu temelin üzerine uygulandı (yukarıda).
F10A görünüm alt işleri F08 öncesinde. F06-2–5 kaynak ölçü/motor/mutabakat işleri açık.

### 20.11.2026 F06 ortak model ve ölçü geçiş haritası uygulandı

[Kullanım, kapsam ve kalan F06 işleri](docs/f06-ortak-model-ve-olcu-gecisi.md).
Yeni verili dosya `data/SAPB1Demo-Floem-F06.floem`: 9 sayfa, 13 tablo, 27 ilişki,
29 FDX ölçüsü. Ortak Model sayfasında tarih/muhatap filtresiyle satış, açık sipariş
ve cari açılış/hareket/kapanış birlikte incelenir. Firma, tarih, muhatap, ürün,
hesap ve temsilci boyutları; anahtar tekillik/referans kontrolleri kuruldu.
Finans günlük hesap özetine geçti. Önceki dosyalar korunur; web yeniden yayımlanmadı.

Yönsüz döngü kontrolünün geçerli ortak boyutları reddetmesi düzeltildi. Yönlü
belirsizlik ve döngüler engellenmeye devam eder. FDX filtrelerinde toplamalı VAR
tanımlandığı bağlamı korur; açılış/kapanış, dönem satırı/genel toplam ve RLS testli.
`semantic_import` TMDL alt kümesini sorgu çalıştırmadan envanterler; JSON/Markdown
çıktısında ham sorgu/ifade/bağlantı yok. `--demo` yerel dosya kontrollerini de ekler.

135 kaynak ölçüden 19'u SQL üretir; 116'sı motor/sözdizimi/bağımlılık engelli.
61 alan eşlendi, 21 kaynak ölçüye sınırlı demo uyarlaması gösterildi; birebir sonuç
eşdeğerliği doğrulanan kaynak ölçü yok. **135 ölçünün tam geçişi tamamlanmadı.**
Yerel dosyada 69 görsel sorgusu ve 8 senaryoda 56 bağımsız hesap karşılaştırması geçti.
F05 için ortak temel hazır; kaynak ölçü/motor/mutabakat işleri F06-2–5 olarak açık.
Tabloda isteğe bağlı `gridFitColumns` (Biçim: Sütunları nesneye sığdır) başlık sarma
ve otomatik yükseklikle çalışır; yeni karşılaştırma tablosunda açıktır. 206 Python
testi geçti, 1 atlandı; 15 hedefli tekrar, typecheck ve Desktop/web build başarılı.

### 20.11.2026 F10 PBIP uyumluluk raporu uygulandı

**Geliştirme girdisi:** Kullanıcının isteğiyle görünüm bulguları
[F10A-01–04 iş maddelerine](docs/pbip-bulgularindan-gelistirme-listesi.md) dönüştürüldü.
`displayOption`, sayfa zemin şeffaflığı ve tuval dışı renk/şeffaflık için öncelik, bağımlılık,
hedef davranış ve kabul ölçütleri yazıldı. Durumları planlandı; bu ayarlar henüz uygulanmadı.
F04/F07A iyileştirmesi olarak F08 öncesine bağlandı. Ana sıradaki F06 değişmedi.

[Kullanım ve yerel inceleme](docs/f10-pbip-uyumluluk.md). İçe aktarıcı `prepare_report` ve
`import_report` olarak ayrıldı. `pbip_compatibility.py`, kaynak/gerçek hedef nesne ve alan
başvuruları üzerinden tür, filtre, ölçü, toplama, hiyerarşi, sorgu, eylem ve biçim kayıplarını listeler.
Özel tür/birleşik grafik/huni açık uyarılı metin yer tutucusudur; sessiz grafik benzetimi kaldırıldı.
`report.importAudit` geçmiş kaydı .floem içinde; JSON/Markdown yan dosyaları da yazılır.
`--analyze-only` DuckDB veya .floem oluşturmadan inceleme çıktısı üretir.
Desktop Görselleştirmeler ve web'de `ImportCompatibility` arama/durum/JSON sunar;
Desktop'ta sayfa/nesneye gider. Sonraki elle düzeltmeler aktarım geçmişini değiştirmez.

Yedi kaynakta 39 sayfa/1.408 nesne: 13 desteklenmeyen, 1.392 kısmi, 2 atlanan, 1 yerleşim eşlemesi.
Yerel JSON/Markdown dosyaları `data/pbip-compatibility-F10/`; yeni örnek
`data/SAPB1Demo-Taslak-F10.floem` 18 sayfa/905 hedef/23 boş tablo. Önceki verili dosyalar korunur.
29 hedefli pytest, Chromium UI ve önceki regresyonlar, typecheck, Desktop/web build başarılı.
Gerçek yeni taslak `Document.open` ile açıldı; model uyarısı yok. Yeni bağımlılık eklenmedi.
Bu teslimden sonraki F06 ortak temel/harita uygulandı; tam ölçü uyumu F06-2–5 olarak açık.
Tasarım sırası F05 → F07B.

### 19.11.2026 F07A tema altyapısı uygulandı

[Kullanım, sözleşme ve kontroller](docs/f07a-tema-altyapisi.md). Beş aile × açık/koyu tema,
uygulama/rapor ayrımı, dosyada sürümlü renk anlık görüntüsü, yerel nesne istisnaları ve Temadan al,
yoğunluk ve azaltılmış hareket eklendi. Uygulama seçicisi Desktop başlığında ve web giriş/üst
çubuğunda; rapor seçicisi Görselleştirmeler panelindedir. Karşılaştırma gerçek kart/grafik/grid/ağaç
bileşenleriyle aynı veriyi gösterir. Tema ailesi marka kararı olarak kesinleştirilmedi.
Kaynaklar `packages/report/src/theme.tsx`, `ThemeControls.tsx`, `theme.css` ve Python
`report/schema.py:ThemeSnapshot`. Stil değerleri çizim anında çözülür, nesnelere kopyalanmaz.
20 hedefli pytest, Chromium tema/kontrast/kalıcılık ve önceki UI regresyonları, typecheck,
Desktop/web derlemeleri geçti. Fiziksel DPI ve bütün ürün ekranlarının görsel onayı bekliyor.
Bu teslimden sonraki F10 tamamlandı; sırada F06 → F05 → F07B var.

### 19.11.2026 matris hiyerarşisi ve Excel (F09)

`matrix.tsx` ayrı satır sütunları ve birleşik çok düzeyli sütun başlıkları gösterir.
`matrixRowLayout: "columns" | "compact"` Biçim panelinden ayarlanır; varsayılan matris için
columns, ağaç tablo için compact'tır. +/− Düzey araçları ve sağ tık işlemleri bir basamak ilerler;
tek dal kapatıldığında o dalın alt açılma durumları temizlenir, kardeş dallar korunur.
Ağaç araması eşleşen yolları otomatik açar; arama sırasında düzey düğmeleri kapalıdır.

`matrixExport.ts` Desktop/web ve XLSX için ortak başlık düzenini oluşturur. `ExportTable.excel`
isteğe bağlı anlık görüntüsü, görünür PDF/CSV'den bağımsız olarak sorgulanmış kapalı detayları da
aktarır. `matrixExcel.ts`, write-excel-file'ın MIT özellik arayüzüyle gerçek OpenXML
`outlineLevel`, `hidden`, `collapsed`, `summaryBelow=0` satır grupları üretir. Excel'de her satır
alanı ayrı sütundadır, sütun grupları birleşik hücrelerdir; başlık ve satır alanları sabitlenir.
Toplam/ortalama değerleri mevcut düzey sorgularından alınır; tekrar toplanmaz. Kaynak sorgusu,
RLS ve satır sınırları değişmez. Excel'in 8 düzey sınırından derin satırlar son grupta kalır.
Yeni bağımlılık yoktur; modül yalnız Excel indirilirken yüklenir.

`tests/ui/matrix-smoke.mjs` Chromium'da 3 satır × 2 sütun düzeyini, basamak açma/kapama,
dal bağımsızlığı, tek/ayrı sütun görünümü ve ağaç aramasını doğrular. Gerçek indirilen XLSX'in
birleşik başlıkları, outline/hidden/collapsed işaretleri, donmuş bölmeleri, kapalı detayları,
sayısal sıfır/negatifler ve ortalama genel toplamı kontrol edilir. Mevcut 26 nesne menüsü ve tablo
aktarım testleri, TypeScript kontrolü, Desktop/web derlemeleri geçti.

### 19.11.2026 tüm nesnelerde ortak sağ tık

`ContextMenu.tsx` portal/klavye menüsü, `VisualContextMenu.tsx` nesne kapsamı ve işlem kayıt arayüzüdür.
PageCanvas ve ReportViewer her görseli bu kapsamla sarar. Yeni görseller temel menüyü otomatik alır;
türe özel işlemler `useVisualMenuSource`, veri aktarımı `useVisualExports` ile eklenir.
Tasarım modunda biçim panelini açma, çoğaltma, kilitleme, katman sırası ve silme; tüm modlarda nesne
bilgileri; uygun türlerde metin kopyalama, yeniden sorgulama, dilimleyici temizleme ve hiyerarşi
işlemleri vardır. Web/önizleme tasarım işlemleri içermez. Grid kendi hücre/sütun bağlamını korur
ve aynı menüye ortak işlemleri ekler. Menü tıklaması nesnenin eylemini tetiklemez.

Yeni `contextMenu`, `exportData`, `exportPdf`, `exportExcel`, `exportCsv` ayarları tüm nesnelerde
**Biçim → Sağ tık ve indirme** bölümündedir. Eski `gridContextMenu` / `gridExport*` değerleri yeni
alan tanımlı değilse okunur. Grafik/kart/dilimleyici güncel sorgu sonucunu; matris/ağaç PDF/CSV'de
görünür hiyerarşiyi, Excel'de kapalı detayları da dışa aktarır. PDF grafik resmi değil veri dökümüdür. Statik şekil/resim/düğme
için veri indirme gösterilmez. Matris/ağaç dosyalarında ara toplam satırları bulunduğundan tüm
satırları toplamak doğru genel toplamı vermeyebilir.
26 görsel türünün tamamında tasarım ve izleyici menüsü, gerçek çoğaltma/kilit/katman/silme/biçim,
grafik/ağaç CSV aktarımı ve eski tablo indirmeleri Chromium testinde doğrulandı.

### 19.11.2026 parametrik tablo araçları

Biçim → AG Grid tablo bölümünde sütun filtreleri, Tabloda ara, sütun seçici ve
satır sayısı her tablo için ayrı ayarlanır; indirme ortak bölüme taşındı. `VisualFormat` içindeki `gridFilters`, `gridSearch`,
`gridColumnChooser`, `gridExport`, `gridRowCount` Desktop/web ortak bileşeninde uygulanır;
eksik değerler açık kabul edilir. Filtre/arama kapatıldığında etkin koşul temizlenir, sütun
seçici kapatıldığında gizlenen sütunlar geri gelir. Tüm üst araçlar kapalıysa araç çubuğu kalkar.
Chromium duman testi arama ve sütun filtresini uygulayıp kapatarak satırların geri geldiğini,
sütun görünürlüğünün geri yüklendiğini ve araçların yeniden açıldığını doğrular.

**Sağ tık ve dışa aktarma:** Ortak AG Grid tablosunda Floem'in kendi portal menüsü hücre/satır kopyalar,
sıralar, filtreleri temizler ve sütun gizler/gösterir. Shift+F10, oklar, Enter, Esc ve dışarı tıklama
desteklenir; kapatılmış araçlar menüden de çalıştırılamaz. `gridContextMenu`, `gridExportPdf`,
`gridExportExcel`, `gridExportCsv` ayrı ayarlardır; eski `gridExport:false` tüm indirmeleri kapatır.
`tableExport.ts` canlı grid'den alınan filtre/sıra/görünür sütun anlık görüntüsünü işler;
sayfalama sınırı uygulanmaz, toplam ve eylem hücreleri alınmaz. PDF ve XLSX modülleri ihtiyaçta yüklenir.
PDF için pdfmake 0.3.14 (MIT), Excel için write-excel-file 4.1.1 (MIT), tipler @types/pdfmake 0.3.3 (MIT).
Yeni geçişli bağımlılıkların lisansları MIT; @swc/helpers Apache-2.0. Npm paketi LICENSE içermeyen
fontkit/dfa/brotli için paket README'si ve package.json MIT bildirimi doğrulandı.
Roboto **v2.138** (Apache-2.0) fontu kaynak/lisansıyla `packages/report/src/fonts` içindedir;
pdfmake'in güncel OFL font paketi kullanılmaz. Font lisansı PDF Subject üstverisinde de taşınır.
Chromium testi gerçek PDF/XLSX/CSV dosyalarını indirip filtre, sıralama, gizli sütun, sayfalama,
sayısal hücre ve formül metni davranışını kontrol eder. `FLOEM_UI_ARTIFACT_DIR` verilirse inceleme
dosyaları ve çok sayfalı örnek PDF o klasöre bırakılır. Türkçe PDF metni ve sayfa görselleri incelendi.

### 19.11.2026 F01–F04 uygulandı

[Uygulama ve yeni tasarım sırası](docs/f01-f04-uygulama-ve-tasarim-sirasi.md): metin taşma seçenekleri,
PBIP font düzeltmesi, demo ölçü/anahtar düzeltmeleri, görsel başına hata yalıtımı ve yeniden deneme,
ortak Desktop/web zoom ve kaydırma, boyutlandırılabilir sağ paneller/dar ekran çekmecesi tamamlandı.
Yeni örnek `data/SAPB1Demo-Floem-F01-F04.floem`; 8 sayfa/150 nesne/83.218 satır, 62 sorgu sonuç verdi.
Boş verili taslak `data/SAPB1Demo-Taslak-F01-F04.floem`. Eski dosyalar korunuyor; dış rapor yayımlanmadı.
20 hedefli pytest, typecheck, Desktop/web derlemesi ve `node tests/ui/run-smoke.mjs` geçti.
Chromium viewport/DPR simülasyonu yapıldı; fiziksel Windows DPI/çoklu monitör denemesi bekliyor.
Marka eki ve Y logosu incelendi. Bu teslimden sonra F07A tema altyapısı/5 palet × açık-koyu
karşılaştırması uygulandı; sırada F10, F06, F05 ve F07B kullanıcı bileşenleri var.
Renk ailesi henüz seçilmedi; marka adı değişmedi.

### 19.11.2026 rapor mantığı ve tasarım incelemesi

[Tasarım ve ürün incelemesi](docs/floem-bi-tasarim-ve-urun-incelemesi.md), Power BI dalları,
yerel SAP B1 demoları ve Floemdata Analytics kodu üzerinden hazırlandı. İlk finans dalı 6,
son Demo dalı 17 sayfa; çalışan Floem uyarlaması 8 sayfa ve tam semantik geçiş değil.
Kullanıcı AG Grid yaşam döngüsü düzeltmesinden sonra Desktop'ta veriyi gördüğünü doğruladı.

Yeni bulgular: PBIP metin aktarımında en az 20 px zorlaması, tüm metinlerde `overflow:auto`,
çalışan demonun 8 başlığında satır yüksekliğinden 1 px kısa içerik alanı; sabit paneller ve
sayfaya sığdırmanın okunabilirliğe etkisi. Sayılar statik incelemeye dayanır; bu turda ekran
testi yapılmadı. Demo sorgularında açık sipariş etiketi, birleşik miktar ve yürüyen bakiye
toplamı gibi anlam farkları da belgelendi. Bu paragraf ilk incelemeyi kaydeder; F01–F04'ün sonraki
uygulaması ve kalan işlerin güncellenmiş sırası yukarıdaki bağlantıdadır.

### 19.11.2026 görsel tasarım ve kaynak genişletmesi

Desktop simgesi kullanıcının Yıldırım Technologies görselindeki mavi Y işaretinden türetildi;
`apps/desktop/build-resources/` altında PNG, ICO ve üretim betiği vardır. Görsel seçicide grafik
simgeleri, dolu alan kutuları arasında sürükle-bırak, ortak Desktop/web görünüm stilleri, şekil,
resim ve canlanan sayı eklendi. Yeni Desktop kaynakları SAP HANA ODBC, SQLite ve REST JSON'dur.
Bu kaynaklar yayımlandığında veri anlık görüntü olarak gider; Floemway yenilemesi yalnızca SQL
Server için uygulanmıştır. HANA canlı kaynağında henüz doğrulanmadı.

Kullanıcının Power BI deposundaki yedi PBIP proje, seçtiği kapsam uyarınca **tasarım ve alan
eşlemesi** olarak `local-reports/` altında `.floem` taslaklarına aktarıldı. Bu klasör ve `.floem`
dosyaları git dışındadır. Taslaklarda gerçek veri ve kimlik bilgisi yoktur; boş model, sayfa
yerleşimleri ve alan referansları vardır. Yeniden üretim komutu README'deki `pbip_import --all`.
Desteklenmeyen Power BI görselleri yer tutucuya döner; ölçülerin FDX karşılığı ve canlı veri
bağlantısı sonraki çalışmadır.

Kullanıcı Pavezyum taslaklarının görünmediğini bildirdi. Nedeni PBIP'deki %100 şeffaf actionButton
katmanlarının beyaz şekil olarak aktarılması ve 1920×1080 sayfada yalnızca dış kutu boyutunun
ölçeklenmesi, iç metnin ölçeklenmemesiydi. İçe aktarıcı artık şeffaf katmanları atlar, sayfa arka
planını ve görünüm biçimini korur; görselin tüm içeriği tuval ölçeğiyle birlikte küçülür. Boş verili
grafiklerde açıkça taslak olarak işaretlenen önizlemeler gösterilir. Görselleştirmeler panelinde sayfa
rengi, katman, çoğaltma, kilit ve opaklık araçları bulunur. `local-reports/` altındaki yedi dosya
yeniden üretildi; önceki sürümleri git dışındaki `data/pbip-before-repair/` klasörüne kopyalandı.
Gerçek veriye bağlama yine ayrı iştir.

### Gerçek adresli tek alıcı pilotu (19.11.2026)

`https://bi.floemdata.com` adresi için mevcut Windows bilgisayarında ayrı pilot sunucu ve
Cloudflare tüneli kuruldu. Pilot SQLite/DuckDB verisi `%LOCALAPPDATA%\FloemBI\pilot-server`
altındadır; geliştirme kullanıcıları ve 8800 sunucusu kullanılmaz. `floemmodel.floem`
Desktop yayınlama istemcisiyle pilot çalışma alanına gönderildi. GoDaddy SMTP test gönderimi
ve gerçek alıcı daveti `sent` döndü. Cloudflare tüneli `healthy`; dış adreste rapor API'si
yetkisiz isteğe 401 döndü. Alıcı daveti kabul edip şifresini belirledi; yalnızca rapora
`viewer` erişimi var, çalışma alanı üyeliği yok. Desktop'taki son değişiklikler kaydedilip
aynı raporun 2. sürümü yayımlandı. Alıcı rolüyle dış adreste görsel sorgusu 200 ve 66 satır,
çalışma alanı isteği 403 döndü. Kullanıcı web görsellerini açıp Desktop dosyasını kaydettiğini
bildirdi. Pilot yönetici şifresi kurulumda rastgele üretildi; kullanıcı bu şifrenin Windows
Kimlik Bilgisi Yöneticisi'nde aynı kalmasını tercih etti.

Kod: `src/floem_bi/server/pilot.py` (yönetici, tünel, şifre),
`src/floem_bi/server/cloudflare_pilot.py` (idempotent DNS/tünel kurulumu),
`README.md` (çalıştırma ve kullanıcı akışı). Yönetici şifresi Windows Kimlik Bilgisi
Yöneticisi'nde; manuel yönetici girişi gerektiğinde kullanıcı
`python -m floem_bi.server.pilot admin-password` ile bildiği bir şifre belirleyebilir.
Bu hesap ve SMTP şifresi depoda tutulmaz.

Windows yeniden açıldıktan sonra `floem-baslat.bat` dosyasına çift tıklanır; otomatik
oturum açılışı görevi kurulmaz. `src/floem_bi/start_all.py` yerel 8800 sunucusunu, pilot
8811 sunucusunu, Cloudflare tünelini, kayıtlı Floemway'leri ve Desktop'ı kontrol edip
eksik olanları başlatır. Anahtarlar Windows Kimlik Bilgisi Yöneticisi'nden okunur.

Ayrıntılı plan kullanıcının bilgisayarında: `~/.claude/plans/g-r-nen-sorunlar-mevcutta-yok-greedy-fairy.md`.
Özeti ve güncel kalanlar aşağıda.

### Güncel iş sırası (19.11.2026)

| Sıra | Kalan iş | Bitti sayılma koşulu |
|---|---|---|
| 0 | **H7 saha kabulü:** gerçek SQL Server ile Floemway yenilemesi | Bağlı model yenilenir, yeni veri raporda görünür; hatalı şifre ve çevrimdışı durumda hata geçmişi yazılır, eski anlık görüntü korunur. Sahte bağlayıcı testleri geçiyor; yerel kurulumda eşleme sonrası başarılı yenileme henüz doğrulanmadı. |
| 1 | **H8 zamanlanmış yenileme** | Anlam modeli için günlük saat ve saat dilimi API/arayüzde saklanır; sunucu aynı yenileme kuyruğunu zamanı gelince tetikler, çakışma ve yeniden başlatma davranışı test edilir. |
| 2 | **H8 yenileme e-postası** | Başarısız işin özeti, tablo/adım bilgisi ve geçmiş bağlantısı model sahibine gider; isteğe bağlı başarı bildirimi ve gönderim hatası test edilir. |
| 3 | **H8 Floemway kurulumu** | Ayrı yükleyici ve Windows servisiyle kullanıcı oturumu olmadan çalışır; özel anahtar erişimi, yeniden bağlanma ve kaldırma doğrulanır. |
| 4 | **H8 sunucu dağıtımı ve Desktop kabulü** | Docker Compose ile sunucu, PostgreSQL metadata ve geliştirme posta servisi kurulur; gerçek alan adı/TLS ve yedekleme ayarları tanımlanır. Paketli Desktop'ta `.floem` dosyasına çift tıklama doğrulanır. |
| 5 | **H9 sağlamlaştırma** | Gerçek SQL entegrasyon ve temel tarayıcı uçtan uca senaryoları, 1–5 milyon satır performans ölçümü, demo ve işletim belgeleri tamamlanır. |

Eski iki aylık plan, H7'deki web üzerinden elle bağlantı tanımını ve "Gateway" adını anlatıyor.
Güncel ürün akışı Desktop yayımlamasında otomatik eşleme ve **Floemway** adıdır.

### H7: Floemway ve manuel yenileme (tamamlandı)

Uygulama: `src/floem_bi/gateway/__main__.py`, `src/floem_bi/server/refresh.py`,
`server/app.py` ve `db.py`; web'de çalışma alanı → Floemway ve anlam modeli →
Yenileme ekranı. Hedefli kabul testleri `tests/test_gateway.py` içindedir.
Windows'ta açık DuckDB dosyası fiziksel kopyalanamadığı için yeni sürüm DuckDB'nin
`COPY FROM DATABASE` komutuyla geçici klasörde kurulur. Başarısız aktarımda mevcut
snapshot değişmez. Son iki sürüm tutulur. Floemway özel anahtarı dosyada değil,
Windows Kimlik Bilgisi Yöneticisi'ndedir. Uzak bağlantı HTTPS/WSS gerektirir.

Desktop yayımlama artık kullanılan model kaynaklarını Desktop bağlantı deposundan bulur. Tek kayıtlı
Floemway otomatik seçilir; birden fazla varsa kullanıcı seçer. SQL şifresi Desktop'ta açık anahtarla
şifrelenip `/api/datasets/{id}/gateway-sync` üzerinden yüklenir. Şifresiz bilgi `.floem` dosyasına
yazılmaz. Web'de çalışma alanı ve Floemway sayfaları kaynakların hazır/bekliyor durumunu gösterir.
Kayıtlı Floemway veya Desktop'ta kayıtlı SQL şifresi yoksa rapor yayımlanır, bağlantı bekler.
Test: `tests/test_server.py::test_desktop_publish_auto_syncs_floemway` uçtan uca akışı doğrular.

**Floemway** müşteri sunucusunda çalışan bir Python uygulaması. Yeni modül: `src/floem_bi/gateway/`.
- İlk sürümde konsol uygulaması olacak; Windows servisi H8'de.
- **Kayıt:**
  1. Web'deki **"Floemway"** sayfası tek kullanımlık bir kayıt anahtarı üretir.
  2. Floemway ilk açılışta bu anahtarla kaydolur ve bir anahtar çifti (PyNaCl, Apache-2.0) üretir.
  3. Floemway'in açık anahtarı sunucuda saklanır.
- **Bağlantı:**
  - Yalnızca **dışa açılan WebSocket (wss)** kullanılır; müşteri tarafında port açılmaz.
  - Floemway kalp atışı gönderir ve bağlantı koparsa yeniden bağlanır.
  - Web'de gateway'in çevrimiçi/çevrimdışı durumu görünür.
  - Bağımlılık `websockets` (BSD-3). Lisansı tekrar doğrulayın.
- **Veri kaynağı tanımı:**
  - Desktop yayımlamada sunucu, veritabanı, SQL kullanıcısı ve kayıtlı şifre otomatik alınır.
  - Şifre Desktop'ta Floemway'in açık anahtarıyla **sealed box** olarak şifrelenir; yalnızca Floemway çözebilir.
  - Web'deki elle bağlantı girişi ve anlam modeli eşlemesi eksik kaynaklar için yedektir.
  - Dataset'in `veri_kaynaklari` alanı (sunucu + veritabanı) bu tanımla eşleşir. Power BI'daki "gateway connection" eşlemesinin karşılığıdır.
- **"Şimdi yenile"** (yalnızca Yönetici/Üye):
  1. Sunucu bir yenileme işi kaydı açar (kuyrukta → çalışıyor → başarılı/hata).
  2. Floemway, modeldeki her tablonun kaynak sorgusunu SQL Server'da çalıştırır. Mevcut `connectors/sqlserver.py` kullanılır; Floem Query adımları varsa `transform/` ile uygulanır.
  3. Sonuç Arrow parçaları halinde sunucuya akar.
  4. Sunucu yeni DuckDB anlık görüntüsünü kurar ve dataset sürümünü atomik olarak artırır. Yayımlamadaki `engines.drop` ve `KEEP_VERSIONS` mantığına bakın.
  5. Açık ekranlar SSE ile güncellenir. `notify_report` zaten var; dataset olayı için genişletin.
- **Hatalar ekranda okunur olmalı.** Bu, kullanıcının özel isteği. Örnek mesajlar:
  - "Floemway çevrimdışı"
  - "SQL Server'a bağlanılamadı: Login failed for user 'x'"
  - "OINV tablosu bulunamadı"
  - "Zaman aşımı (300 sn)"

  Her hatada hangi tablo ve hangi adımda kalındığı, ham hata metni ve süre gösterilir. Bir **"Yenileme geçmişi"** listesi tutulur.
- **Yarım kalan yenileme mevcut anlık görüntüyü bozmamalı;** rapor eski veriyle çalışmaya devam etmeli.
- **Testler:** sahte gateway ile iş akışı (başarılı yenileme, Login failed, gateway çevrimdışı).

### H8: Zamanlanmış yenileme, e-posta bildirimi ve paketleme

- **Zamanlanmış yenileme:** dataset ayarlarında günlük saatler ve saat dilimi.
  - Sunucu içi zamanlayıcı, manuel yenilemeyle aynı iş kuyruğunu kullanır.
  - Tetikleme yalnızca saatle yapılır; "gelen e-posta ile tetikleme" istenmiyor.
- **E-posta bildirimi:** yenileme başarısız olunca (istenirse başarılı olunca da) dataset sahibine e-posta gider.
  - E-postada hata özeti ve "Geçmişi aç" bağlantısı olur.
  - `server/mail.py` içindeki `_layout` ve `deliver` kullanılır.
- **Paketleme:**
  - Floemway yükleyicisi ve Windows servisi.
  - Sunucu için `deploy/docker-compose.yml`: servis + Postgres. Postgres'e geçiş SQLAlchemy Core sayesinde küçük bir iş; `asyncpg` ya da `psycopg` lisansını doğrulayın.
  - Desktop yükleyicisi zaten var (`npm run desktop:package`).
- **Doğrulanacak bilinen sorun:** Electron 45, uygulama yolundan sonra 2 ya da daha fazla argümanla açılınca 127 koduyla çıkıyor. `.floem` dosyasına çift tıklayarak açmayı H8'de doğrulayın.

### H9: Sağlamlaştırma (tampon)

- Uçtan uca kabul senaryoları (plan dosyasındaki "Doğrulama" bölümü). Playwright (Apache-2.0) ile temel arayüz testi.
- 1–5 milyon satırla performans ölçümü.
- Dokümantasyon ve demo senaryosu.

### Kabul senaryosu (Aşama 3 sonu)

1. Floemway kaydedilir; web'de çevrimiçi görünür.
2. Veri kaynağı tanımlanır; SQL Server'a yeni fatura satırları eklenir.
3. Yönetici "Şimdi yenile"ye basar; raporda yeni rakamlar görünür.
4. SQL şifresi bozulup yenilenir: ekranda tablo ve adım bilgisiyle "Login failed" hatası çıkar ve geçmişe yazılır.
   Zamanlanmış yenilemede hata olursa e-posta gider.
5. Floemway durdurulur: "Floemway çevrimdışı" hatası çıkar, rapor eski veriyle çalışmaya devam eder.

## 7. Bekleyen küçük işler (plan dışı, araya alınabilir)

- **Hiyerarşi oluşturma arayüzü:** H3'ten kaldı (sütuna sağ tık → "Hiyerarşi oluştur").
- **E-posta yeniden deneme kuyruğu:** SMTP hatasında tek bağlantıyla toplu gönderim ve sonra yeniden deneme.
- **"Şifremi unuttum"** (şifre sıfırlama e-postası).
- **RLS eksikleri:**
  - Sütun düzeyi güvenlik (OLS): modelde `sutun_izinleri` alanı var ama arayüzü yok.
  - `USERATTRIBUTE()` web'de boş dönüyor; kullanıcı öznitelikleri ekranı yok.
- **App eksikleri:** kitleler (audiences); ilk sürümde tek erişim listesi var, şema buna uygun.
- **Görsellerin bilinen sınırları** (kullanıcı ileride geliştirmek istiyor):
  - Tüm içerik artık tuvalle birlikte ölçekleniyor; küçük ekranda okunabilirlik, metin taşması ve düzen varyantları açık işler (yukarıdaki inceleme).
  - Harita kararı bekliyor.
  - Detaya git için başlık düğmesi ve F12'de 20 geçişli oturum geçmişi var. Gizli sayfa ve detay hedeflerini sağ tıkta listeleme açık.
  - Trend göstergesi yalnızca kart/KPI'da var, "geçen yılın aynı dönemi" seçeneği yok.
  - Ana-ayrıntıda çoklu seçim yok.
  - Metin kutusunda zengin metin yok.
  - Floem Query'de birleştirme tek anahtarla yapılıyor.

## 8. Açık konular ve bilinen durumlar

- **E-posta sağlayıcısı:** kullanıcının alan adının e-postası **GoDaddy**'de (MX kaydı `secureserver.net`; Titan değil).
  - SMTP: `smtpout.secureserver.net`, port 465, SSL; kullanıcı adı tam e-posta adresi. 19.11.2026'da bu ayarla test e-postası başarıyla gitti.
  - Ekranda **GoDaddy** hazır ayarı var. Şifre sohbete değil, Yönetim → E-posta sunucusu ekranına girilir (şifreli saklanır).
- **Çözülen test yarışı:** `test_refresh_fails_cleanly_when_step_breaks` sırasında iş durumu hata ayrıntısından önce yazılıyordu; `document/jobs.py` düzeltildi. Son tam koşu 163 geçti, 1 atlandı.
- **Kullanıcının yerel değişikliği:** kökteki `package.json` ve `package-lock.json` dosyalarına yanlışlıkla `npm install server` eklenmiş olabilir.
  - Depoda bu değişiklik geri alındı (`f684c6e`), yerel dosyalarda duruyor.
  - Kullanıcı eklemediyse: `git checkout -- package.json package-lock.json`.
  - Bu dosyaları commit'e katmayın.
- **Lisans soruları:** xyflow'un d3-* bağımlılıkları ISC, tslib/ECharts tarafı 0BSD; ikisi de onaylandı. certifi MPL-2.0 olduğu için Desktop'ta httpx kullanılmadı.
- **Gerçek barındırma** (alan adı, TLS, Postgres) henüz yok; floembi.app bu bilgisayarda yerel çalışıyor.
