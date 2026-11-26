# Windows yayın sunucusuna geçiş

## RDP üzerinden ilk kontrol

ZIP dosyasını hedef Windows x64 sunucusuna kopyalayıp uygulamaya ayrılmış bir klasöre çıkarın. **01-KONTROL.cmd** dosyasını çalıştırın. `KONTROL BASARILI` mesajı, paketteki gerçek web sayfası ve JavaScript dosyasının yüklendiğini, API'nin sağlık yanıtı verdiğini ve oturumsuz rapor isteğinin 401 döndüğünü gösterir. Kontrol geçici bir klasörde ve boş bir yerel portta çalışır. Paket kendi Python çalışma ortamını ve derlenmiş web arayüzünü içerir. Kaynaklar **FloemBI-Proje.zip** içindedir.

## Yalnızca hesapları ve e-posta ayarını taşıma

Yeni sunucuda raporları sıfırdan yayımlayacaksanız kaynak bilgisayarda `FloemBI-Sunucu.exe ayarlari-aktar ayarlar.enc` çalıştırıp aktarım kodunu gizli istemde belirleyin. Ayar paketi kullanıcıların parola özetlerini, çalışma alanlarını, üyelikleri ve SMTP ayarını şifreli taşır. Bu sırada eski yayın çalışabilir.

Yeni sunucuda aynı Windows hesabıyla `FloemBI-Sunucu.exe ayarlari-al ayarlar.enc` komutuna aynı kodu girip `FloemBI-Sunucu.exe sunucu` çalıştırın. Var olan hedef klasör korunur. Yeni yayında rapor ve model sayısı sıfırdır. Kullanıcılar kendi parolalarıyla yeniden oturum açar. Dış erişim ve tünel geçişi için aşağıdaki 5–7. adımları kullanın.

## Mevcut Windows yayınını raporlarıyla birlikte aynı adresle taşıma

1. Hedefte Floem BI'ı çalıştıracak Windows hesabını seçin. İçe aktarma, sunucu ve tünel aynı Windows hesabında çalışır. Canlı SQLite, DuckDB ve giden kutusu için hesabın erişebildiği özel bir klasör kullanın. Varsayılan hedef `%LOCALAPPDATA%\FloemBI\pilot-server` olur. Farklı bir hedef için `FLOEM_SERVER_DATA` değerini içe aktarma ve sonraki başlatmalarda aynı mutlak klasöre ayarlayın.
2. Eski bilgisayarda paket klasöründen aşağıdaki ilk komutu çalıştırın. Aktarım parolası konsolda gizli alınır. Bu dosya, mevcut oturum imzalama ve SMTP şifreleme anahtarını parolayla korur. Tünel belirteci ayrıca hedefte girilir.
3. Son kopya için yeni yayımlamaları durdurun. Eski bilgisayarda yalnızca bu yayına ait tüneli ve 8811 portundaki yayın sürecini kapatın. **Mevcut** `%LOCALAPPDATA%\FloemBI\pilot-server` klasörünün soğuk kopyasını ve şifreli anahtar dosyasını RDP üzerinden hedef hesabın özel hazırlık klasörüne kopyalayın. SQLite ve DuckDB günlüklerini ana dosyalarıyla birlikte kopyalayın. Eski klasörü geri dönüş için saklayın.
4. Hedefte paketin klasöründen ikinci komutu çalıştırın. Örnekteki hazırlık yolunu kendi yolunuzla değiştirin. Araç metadata ve dış anahtar bütünlüğünü denetler, veri modelleri ve giden kutusu yollarını yeni klasöre yazar, ardından hazırlanan klasörü tek adımda devreye alır. Hedef klasör önceden varsa işlem durur.

**Eski bilgisayarda** anahtarı dışa aktarın.

```powershell
.\FloemBI-Sunucu.exe anahtari-aktar "$env:LOCALAPPDATA\FloemBI\yayin-gecis.enc"
```

**Hedef Windows hesabında** veriyi alıp sunucuyu başlatın.

```powershell
.\FloemBI-Sunucu.exe veriyi-al "$env:LOCALAPPDATA\FloemGecis\pilot-server" "$env:LOCALAPPDATA\FloemGecis\yayin-gecis.enc"
.\FloemBI-Sunucu.exe sunucu
```

5. Sunucunun tarayıcısında **http://127.0.0.1:8811** adresini açın. Mevcut yöneticiyle oturum açın, çalışma alanındaki rapor ve veri modeli sayılarını karşılaştırın, gerçek bir raporu açıp bilinen bir sayı ile eşleştirin. İzleyiciyle paylaşılan raporu ve o hesaba kapalı başka bir raporu kontrol edin.
6. Aynı alan adını korumak için hedef sunucuda `cloudflared.exe` çalıştırılabilir olmalı ve `PATH` içinde bulunmalı. Eski Floem BI tünel bağlayıcısı kapalıyken aşağıdaki komutlarla **Floem BI yayın tüneli** için alınan belirteci gizli istemden girin. Mevcut rotanın hedefi `http://127.0.0.1:8811` olmalı. Aynı tüneli iki farklı veri kopyasını dışarı sunacak şekilde eşzamanlı başlatmak istekleri iki makine arasında dağıtabilir.

```powershell
.\FloemBI-Sunucu.exe tunel-belirteci
.\FloemBI-Sunucu.exe tunel
```

7. **https://bi.floemdata.com** üzerinden oturum açın. Paylaşılan raporu izleyici olarak okuyun, Desktop'tan bir deneme raporunu yayımlayın. SMTP için hedef adresi belirledikten sonra web yönetimindeki test gönderimini kullanabilirsiniz. Yayını kalıcı işletime alırken sunucu ve tüneli hedefteki aynı Windows hesabı altında oturum kapalıyken çalışacak hizmet veya zamanlanmış görev olarak yapılandırıp yeniden başlatma denemesi yapın. Elle başlatılan konsol oturum kapanınca durur.
8. Kabulden önce geri dönmek gerekirse hedef bağlayıcıyı durdurup eski sunucuyu ve eski bağlayıcıyı açın. Yeni sunucuya yazma açıldıktan sonra geri dönüş için aradaki yayımlama ve yetki değişikliklerini de taşıyın.
