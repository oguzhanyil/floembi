# frp (fatedier/frp)
- **URL:** https://github.com/fatedier/frp
- **Lisans:** Apache 2.0. **Doğrulandı** (kök `LICENSE`; `find` yalnızca `./LICENSE` döndürdü, alt lisans yok)
- **Dil:** Go. Önemli bağımlılıklar: `github.com/fatedier/yamux v0.3.0` (multiplexing, hashicorp/yamux fork'u, MPL-2.0 kökenli, aşağıya bakınız), `github.com/quic-go/quic-go`, `github.com/fatedier/golib`
- **Sürüm / son commit:** `pkg/util/version/version.go` → `0.72.0`; son commit 2026-11-10

## Ne yapıyor (3-5 cümle)
NAT/firewall arkasındaki bir servisi dışarıya açan reverse proxy. `frpc` (client) iç ağda çalışır, `frps` (server) public sunucudadır. Client dışarıya tek bir kontrol bağlantısı açar, server'a hangi proxy'leri (tcp, udp, http, https, stcp, xtcp...) istediğini bildirir. Bir kullanıcı server'daki porta bağlandığında server kontrol kanalından "work connection" ister, client yeni bir stream açar ve trafiği yerel servise köprüler. Yani bağlantı her zaman içeriden dışarıya açılır; müşteri firewall'unda inbound port gerekmez.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `cmd/frpc`, `cmd/frps` | CLI giriş noktaları |
| `client/` | `service.go` (login döngüsü, yeniden bağlanma), `connector.go` (TCP/KCP/QUIC/WebSocket + TLS + yamux), `control.go` (kontrol mesajları, heartbeat), `proxy/` (yerel servise köprü) |
| `server/` | `service.go` (listener'lar, login kabulü), `control.go` (`ControlManager`, runID başına kontrol, work conn havuzu), `proxy/`, `registry/` (bağlı client kayıtları), `ports/` (port tahsisi) |
| `pkg/msg/` | Kontrol protokolü mesaj tipleri (`msg.go`), framing (`wire_v2.go`) |
| `pkg/auth/` | `token.go`, `oidc.go` |
| `pkg/transport/tls.go`, `pkg/util/net/` | TLS config, websocket/kcp/proxy-protocol dial hook'ları |
| `pkg/plugin/server/` | Server-side HTTP plugin hook'ları (`OpLogin`, `OpNewProxy`, `OpPing`, `OpNewWorkConn`, `OpNewUserConn`) |

**Akış:** `frpc` → dial (`client/connector.go`) → TLS → yamux session → `Login` mesajı → `LoginResp{RunID}` → `NewProxy` → server porta gelen kullanıcı için `ReqWorkConn` → client yeni yamux stream açar, `NewWorkConn` gönderir → server `StartWorkConn` yollar → iki yönlü kopyalama.

## Floem BI için kritik kısımlar
- `client/service.go` → `loopLoginUntilSuccess` + backoff (Jitter 0.1, `MaxDuration` 20s, `FastRetryCount` 3) → Gateway ajanının yeniden bağlanma döngüsü
- `client/connector.go` → tek TCP üzerinde yamux; `TCPMuxKeepaliveInterval`; `Protocol` = tcp/kcp/quic/websocket/wss → Gateway'in tek outbound bağlantı üzerinden çoklu sorgu stream'i
- `pkg/msg/msg.go` → `Login`, `LoginResp`, `NewProxy`, `ReqWorkConn`, `NewWorkConn`, `StartWorkConn`, `Ping/Pong` → Gateway kontrol protokolü tasarımı için şablon
- `server/control.go` → `ControlManager` (runID ile eski kontrolü değiştirme, work conn havuzu `GetWorkConn`) → Floem Cloud tarafında "bağlı gateway kayıt defteri"
- `pkg/auth/token.go` + `pkg/util/util/util.go::GetAuthKey` → `md5(token + timestamp)` privilege key; `AuthScopeHeartBeats`, `AuthScopeNewWorkConns` ile ping ve work conn'da da doğrulama → Gateway kimlik doğrulaması (zayıf, aşağıya bakınız)
- `pkg/plugin/server/plugin.go` → Login/NewProxy için harici HTTP hook → çok kiracılıkta tenant/gateway yetkilendirmesini dış servise devretme fikri
- `pkg/config/v1/client.go` → `ProxyURL` (`http_proxy` env), `PoolCount` (önceden açılmış work conn havuzu) → kurumsal proxy ve gecikme optimizasyonu

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz.

## Sorgu nasıl üretiliyor
Uygulanamaz.

## Alınacak fikirler
- Kontrol kanalı + istek başına stream (yamux) ayrımı; Gateway'de "control" ve "query stream" mesaj tiplerini benzer tutmak
- `RunID` ile oturum devri: aynı gateway yeniden bağlandığında eski oturumu kapatmak
- Work connection pool (`PoolCount`) ile ilk sorgu gecikmesini düşürmek
- WebSocket/wss transport seçeneği: 443 üzerinden kurumsal firewall'u geçmek
- Server plugin hook'ları ile login'i merkezi tenant servisinde doğrulamak

## Kaçınılacaklar / zayıf yönler
- Token auth tek paylaşımlı sır ve MD5 tabanlı; replay için yalnızca timestamp var. Floem BI'da gateway başına ayrı kimlik (mTLS client cert veya kısa ömürlü JWT) kullanılmalı
- frp genel amaçlı port açar; Floem Cloud'un müşteri DB'sine ham TCP erişimi güvenlik ve RLS açısından istenmez. Power BI Gateway modelinde sorgu ajan tarafında çalışır, sadece sonuç döner
- Ajan Python (`agent/`); frp Go. Doğrudan gömmek mümkün değil, ancak sidecar binary olabilir
- `fatedier/yamux` hashicorp/yamux fork'u; hashicorp/yamux MPL-2.0. Bağımlılık olarak dağıtılacaksa fork'un lisansı ayrıca doğrulanmalı (bu analizde klonlanmadı)

## Kullanım kararı: Fikir al
Protokol tasarımı (control/work conn, yeniden bağlanma, keepalive, wss) için referans. Ham TCP tünel açmak yerine "sorgu ajanda çalışsın" modeli tercih edilmeli; frpc sidecar sadece acil fallback olarak düşünülebilir.
