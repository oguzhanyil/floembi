# chisel (jpillora/chisel)
- **URL:** https://github.com/jpillora/chisel
- **Lisans:** MIT. **Doğrulandı** (kök `LICENSE`, "Copyright (c) 2024 Jaime Pillora"; alt lisans yok)
- **Dil:** Go. Bağımlılıklar: `golang.org/x/crypto` (SSH, BSD-3), `github.com/gorilla/websocket` (BSD-2), `github.com/armon/go-socks5` (MIT), `github.com/jpillora/backoff`
- **Sürüm / son commit:** son tag `v1.13.0` (commit mesajı: "prepare 1.13.0 prerelease notes"); protokol `chisel-v3` (`share/version.go`); son commit 2026-10-12

## Ne yapıyor (3-5 cümle)
Tek binary'de client ve server içeren, HTTP üzerinden çalışan TCP/UDP tünel aracı. Client server'a normal bir HTTP isteği atar, WebSocket'e upgrade eder ve WebSocket içinde bir SSH bağlantısı kurar. SSH kanalları tünel olarak kullanılır; şifreleme SSH'tan gelir, server kimliği fingerprint ile doğrulanır. `--reverse` ile client kendi ağındaki bir servisi server tarafına açabilir (`R:...` remote). Trafik görünüşte HTTP/WebSocket olduğu için kurumsal proxy ve firewall'lardan kolayca geçer.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `main.go` | CLI (`chisel server`, `chisel client`) |
| `client/client.go` | Config (Fingerprint, Auth, KeepAlive 25s, MaxRetryInterval 5dk, `Proxy` HTTP CONNECT/SOCKS5, `Headers`, TLS/mTLS) |
| `client/client_connect.go` | `connectionLoop` (`jpillora/backoff` ile yeniden bağlanma), `connectionOnce` (WS dial → SSH handshake) |
| `server/server.go`, `server_handler.go` | HTTP handler; `Upgrade: websocket` + `Sec-WebSocket-Protocol: chisel-v3` ise SSH'a devreder, değilse `--backend` reverse proxy'ye (kamuflaj) |
| `share/tunnel/` | Ortak tünel motoru: `tunnel.go` (SSH conn'u bağlama, keepalive), `tunnel_in_proxy.go` (dinleyen uç), `tunnel_out_ssh.go` (hedefe dial eden uç), SOCKS ve UDP |
| `share/cnet/conn_ws.go` | WebSocket'i `net.Conn` gibi kullanma adaptörü |
| `share/settings/` | `remote.go` (`R:local:host:port/proto` parse), `users.go`/`user.go` (users.json, adres regex'leri, dosya değişince otomatik reload) |
| `share/ccrypto/` | ECDSA anahtar üretimi, fingerprint |

**Akış:** client → (opsiyonel kurumsal proxy) → `https://server` → WS upgrade → SSH handshake (user/pass + host key fingerprint) → client remote listesini gönderir → server `users.json` regex'iyle yetki kontrolü yapar → her bağlantı için SSH kanalı açılır.

## Floem BI için kritik kısımlar
- `client/client.go` `Proxy` alanı + `client/client.go:177` civarı → HTTP CONNECT/SOCKS5 üzerinden dial → Gateway'in müşteri kurumsal proxy'sinden geçmesi
- `server/server_handler.go::handleClientHandler` → aynı portta normal HTTP + tünel ayrımı → Floem Cloud API ile gateway endpoint'ini 443'te birlikte sunmak
- `client/client_connect.go::connectionLoop` → üstel backoff, başarılı bağlantıdan sonra reset → Gateway yeniden bağlanma
- `share/settings/users.go` → kullanıcı başına izinli adres regex listesi, hot reload → gateway başına "hangi kaynaklara erişebilir" allowlist'i
- `client/client.go` `Fingerprint` → SSH host key pinning → Gateway'in sahte Floem sunucusuna bağlanmasını engelleme
- `TASKS.md` #1 "Keepalive ping has no timeout" (kapatıldı) → keepalive'da timeout zorunluluğu dersi

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz.

## Sorgu nasıl üretiliyor
Uygulanamaz.

## Alınacak fikirler
- Transport olarak WebSocket over TLS (443): proxy/DPI dostu; frp'deki `wss` seçeneğiyle aynı fikir
- Proxy desteği: `HTTP_PROXY`/`HTTPS_PROXY` env + kimlik bilgili URL
- Sunucu kimliği pinning (fingerprint) + opsiyonel mTLS
- Yetki listesinin dosyadan hot reload edilmesi; yeni tünellere uygulanıp mevcutları kesmemesi
- Tünel portunu "normal web sunucusu" arkasına gizleme

## Kaçınılacaklar / zayıf yönler
- Kimlik doğrulama user:pass + regex; regex'ler varsayılan olarak anchor'sız (README uyarıyor). Çok kiracılı kullanım için yetersiz
- Genel amaçlı port forwarding; uygulama seviyesinde sorgu, RLS, audit yok
- Tek geliştirici ağırlıklı proje; 1.13.0 henüz prerelease notu aşamasında
- Python ajanına gömülemez (Go)

## Kullanım kararı: Fikir al
"WebSocket + TLS üzerinde multiplex edilmiş kanal, kurumsal proxy desteği, server pinning" deseni Floem Gateway transport'u için doğrudan model. Python ajanında aynı desen `websockets` + kendi mesaj protokolü ile kurulabilir; chisel binary'si gerekirse sidecar olarak MIT lisansla dağıtılabilir.
