# Floem BI: devir notu (19.11.2026)

Bu dosya, projeyi devralan geliştiriciye ya da yapay zekâ ajanına yazıldı. Şunları anlatır:
- Bugüne kadar ne yapıldığı,
- Kesin kurallar,
- Kodun nerede durduğu,
- Plana göre sırada ne olduğu.

Önce bunu, ardından [CLAUDE.md](CLAUDE.md) (araştırma görevinin kuralları) ve [README.md](README.md)
(çalıştırma ve özellikler) dosyalarını okuyun.

## 1. Proje ve kullanıcı

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
  - Ölçeklenince yazı boyutu ölçeklenmiyor.
  - Harita kararı bekliyor.
  - Detaya gitte sağ tık menüsü, gizli sayfa ve çok adımlı geri yığını yok; başlık düğmesi ve tek adım geri var.
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
