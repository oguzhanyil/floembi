# Floemway yenileme, dağıtım ve saha kabulü

## Web'de deneme

1. SQL bağlantısı eşlenmiş bir raporu Desktop'tan yayımlayın. Web'de çalışma alanından raporun **anlam modelini** açın.
2. **Şimdi yenile** ile deneme yapın. **Yenileme geçmişi** içinde başlangıç türü, süre, tablo, adım ve hata görünür. Başarıdan sonra rapor yeni sürümden sorgulanır.
3. **Zamanlanmış yenileme** bölümünde günlük saatleri ve IANA saat dilimini girin. Örneğin `08:30, 18:45` ve `Europe/Istanbul`. Kaydedince bir sonraki zaman tarayıcınızın yerel saatinde görünür.
4. Başarısız yenileme modelin yayımlayıcısına bildirilir. Başarı bildirimi aynı formdan açılır. Geliştirmede **Gelen e-postalar**, SMTP kullanımında **Yönetim → E-posta sunucusu** son gönderim sonucunu gösterir. **Geçmişi aç** oturum ve model erişimi gerektirir.

Sunucu 15 saniyede bir zamanı gelen modelleri kontrol eder. Aynı Floemway'de zamanlanmış işler sıra bekler. Elle tetikleme sırasında Floemway meşgulse geçmişte kuyruk hatası görünür. Kaçırılmış saatler model başına bir bekleyen işe birleştirilir. Başlatılmadan bekleyen iş yeniden açılışta devam eder. Aktarım sırasında kesilen iş hata olarak kapanır ve son başarılı sürüm kullanılabilir. İleri saat geçişinde bulunmayan yerel saat atlanır. Geri geçişte tekrarlanan saatin ilk karşılığı çalışır.

## Windows'ta Floemway hizmeti

1. Depo kökünden `powershell -ExecutionPolicy Bypass -File packaging/build-floemway.ps1` ile yükleyiciyi üretin. Derleme için proje sanal ortamı, PyInstaller, .NET Framework C# derleyicisi ve NSIS gerekir.
2. `build\floemway\Floemway-Setup.exe` dosyasını yönetici olarak çalıştırın. Yükleyici hizmeti elle başlatma türüyle kaydeder. Makinede Microsoft SQL Server ODBC sürücüsü bulunmalıdır.
3. Web'de zaten kayıtlı Floemway için, kaydı yapan Windows kullanıcısının yükseltilmiş PowerShell oturumunda aşağıdaki komutu çalıştırın. Örnekte kendi Floemway numaranızı girin. İlk kayıtsa önce web Floemway ekranındaki kayıt komutunu kullanın.

```powershell
& "$env:ProgramFiles\Floemway\worker\floemway.exe" --id 4 --copy-to-service
```

4. Aynı kaydı kullanan konsol açıksa kapatın. `Start-Service Floemway` ile hizmeti başlatın ve web'de çevrimiçi olduğunu kontrol edin. Hizmet LocalService hesabıyla çalışır. Oturum kapansa bile açık kalır. Konsol kimliğinin hizmet kopyası Windows DPAPI ile korunur. Özel klasörün ACL'si hizmete okuma, yöneticiler ve SYSTEM'e tam erişim verir.
5. Durdurmak için `Stop-Service Floemway`, kaldırmak için Windows **Yüklü uygulamalar → Floemway → Kaldır** kullanılır. Hizmetin anahtar kopyası kaldırılır. Elle çalıştırılan `floem-baslat.bat` aynı kayıtla çalışan hizmeti tanır.

## PostgreSQL ve Docker Compose

Mevcut Windows pilotu için `floem-baslat.bat` geçerlidir. Aşağıdaki komutlar yeni bir dağıtım oluşturur. PostgreSQL metadata tutar. Anlam modellerinin DuckDB dosyaları ve giden kutusu ayrı veri birimindedir. Sunucu tek işlem/örnek olarak çalışır. WebSocket oturumları ve açık veri dosyaları bu örneğe bağlıdır.

```powershell
.venv\Scripts\python deploy/maintenance.py init-secrets
.venv\Scripts\python deploy/maintenance.py compose build server
.venv\Scripts\python deploy/maintenance.py compose run --rm server init
.venv\Scripts\python deploy/maintenance.py compose up -d --wait
```

İlk yönetici e-posta adresi, adı ve şifresi etkileşimli alınır. Sunucu anahtarı ve PostgreSQL parolası yerel işletim sisteminin kimlik kasasında saklanır. Bir sunucu gizli bilgi yöneticisi kullanılıyorsa `FLOEM_DEPLOY_DB_PASSWORD` ve `FLOEM_DEPLOY_SERVER_KEY` çalışma ortamına oradan verilebilir. İki değer Compose secrets üzerinden konteynere ulaşır.

Yerel adres `http://127.0.0.1:8890`. Gerçek yayında `FLOEM_PUBLIC_URL` değerini tarayıcıdan açılan HTTPS alan adına ayarlayın. Cloudflare Tunnel veya TLS ters vekilinin hedefini bu sunucunun yerel portuna verin. WebSocket yükseltmesini ve SSE için tamponlamasız aktarımı etkinleştirin. Port değişirse `FLOEM_PORT` ve yerel adresi birlikte ayarlayın. Sağlık denetimi `/api/health`, oturumsuz rapor isteği `/api/reports/1` için beklenen sonuçlar sırasıyla 200 ve 401'dir.

Geliştirme postasını Mailpit'te görmek için son komutu aşağıdaki gibi çalıştırın. Gelen kutusu `http://127.0.0.1:8025` üzerinde açılır. Üretim SMTP ayarı web yönetim ekranındadır.

```powershell
.venv\Scripts\python deploy/maintenance.py compose -- -f deploy/mail-dev.yml up -d --wait
```

## Yedek ve kurtarma

```powershell
.venv\Scripts\python deploy/maintenance.py export-keys D:\Yedek\floem-anahtarlar.enc
.venv\Scripts\python deploy/maintenance.py backup D:\Yedek\floem-20261124
```

Yedekleme çalışan BI sunucusunu kısa süre durdurur, PostgreSQL dökümü ve rapor arşivini alır, önceki çalışma durumunu geri getirir. Rapor dosyaları ve metadata şirket verisi içerir. Erişimi sınırlanmış ve şifreli bir yedek konumu kullanın. Anahtar yedeği ayrıca parola ile şifrelenir. Onu ve kurtarma parolasını ayrı koruyun.

Yeni makinede aynı anahtarları `import-keys` ile yükleyin. Yeni Compose proje adı ve boş veri birimleri seçin. Kurtarma aracındaki dosya sağlaması kontrolü ve PostgreSQL tek işlemli yüklemesi hata halinde komutu durdurur. Başarısız denemeyi yeni, boş bir projeyle tekrarlayabilirsiniz. Önceki dağıtım açıkken deniyorsanız farklı port kullanın.

```powershell
.venv\Scripts\python deploy/maintenance.py import-keys D:\Yedek\floem-anahtarlar.enc
.venv\Scripts\python deploy/maintenance.py restore D:\Yedek\floem-20261124 --project floem-kurtarma
$env:FLOEM_PORT='8891'
$env:FLOEM_PUBLIC_URL='http://127.0.0.1:8891'
.venv\Scripts\python deploy/maintenance.py compose -- -p floem-kurtarma up -d --wait
```

Bu senaryo PostgreSQL dağıtımının kurtarmasıdır. Windows pilotunun SQLite deposu kendi veri alanındadır.

PostgreSQL bağlantısında pg8000 1.31.6 (BSD-3), scramp 1.5.0 (MIT-0) ve asn1crypto 1.5.1 (MIT) kullanılır. Lisans metinleri indirilen paketlerden kontrol edildi. Playwright Core 1.65.1 (Apache-2.0) tarayıcı testinde kullanılır. [pg8000](https://pypi.org/project/pg8000/) ve [Playwright Core](https://github.com/microsoft/playwright/blob/main/LICENSE).

## Tekrar edilebilir kabul

| Deneme | Doğrulama |
|---|---|
| `tests/test_live_refresh.py` | Gerçek SQL Server'da tek satırlık saat sorgusu, yayımlama, Arrow aktarımı, raporda yeni değer, hatalı giriş ve çevrimdışında önceki sürüm. `FLOEM_TEST_SQL_CONNECTION=auto` tek kayıtlı SQL bağlantısını seçer. |
| `tests/test_refresh_schedule.py` | Yaz/kış saati, yetki, yeniden başlatma, aynı Floemway'de bekleme, hata postası ve SMTP arızası. |
| `tests/test_postgres_deployment.py` | Geçici PostgreSQL kümesi, ilk yönetici, gerçek yayımlama, sorgu, ayarlar, `pg_dump` ve ayrı veritabanına `pg_restore`. `FLOEM_TEST_PG_BIN` PostgreSQL bin klasörüdür. |
| `tests/test_browser_refresh.py` | Gerçek Chromium'da oturum, rapor satırı, saat kaydetme, yeniden yükleme, yenileme geçmişi ve bildirim. Önce web'i derleyin ve `npm install --prefix build/h9-browser --no-save --ignore-scripts playwright-core@1.65.1` çalıştırın. `FLOEM_TEST_BROWSER` tarayıcı exe yoludur. |
| `tests/test_packaged_desktop.py` | Paketli Desktop'a boşluklu dosya yolu verilmesi ve çalışan pencereye ikinci raporun aktarılması. `FLOEM_TEST_PACKAGED_DESKTOP` paketli exe yoludur. |
| `tests/test_floemway_service.py` | Makine DPAPI kaydı, paketli Floemway'in kimlik doğrulaması ve bağlantı kesilince yeniden bağlanması. `FLOEM_TEST_PACKAGED_GATEWAY` paketli worker exe yoludur. |
| `scripts/benchmark-report.py` | 1 ve 5 milyon sentetik satış satırında 100 bölgeye göre FDX toplamı. İlk sorgu ve sonraki beş sorgunun medyanı ayrı ölçülür. Her koşuda toplam bağımsız formülle karşılaştırılır. |

24 Kasım 2026'da bu bilgisayarda, diğer doğrulamalarla eşzamanlı koşuda 1 milyon satırda ilk sorgu **239 ms**, sonraki beş sorgunun medyanı **33 ms** oldu. 5 milyon satırda sırasıyla **113 ms** ve **74 ms** ölçüldü. İkinci boyut aynı Python sürecinde çalıştı. Ölçüm tek kullanıcılıdır ve tarayıcı çizim süresini içermez.

Bu oturumda Windows hizmetinin sistem geneline kurulması ve kaldırılması yönetici erişimi gerektiriyor. Docker Desktop başlatılırken grup üyeliği hatası verdi. Compose yapılandırması denetlendi ve PostgreSQL kurtarması bağımsız kümede çalıştırıldı. Konteynerlerle tam kurtarma ve gerçek hizmet hesabıyla oturumu kapatma sahada doğrulanacak.
