# Casbin (casbin/casbin) + pycasbin
- **URL:** https://github.com/casbin/casbin (Python portu: https://github.com/casbin/pycasbin)
- **Lisans:** Apache 2.0. **Doğrulandı** (kök `LICENSE`, `NOTICE`; `find` başka lisans dosyası döndürmedi). **pycasbin:** Apache 2.0 (repo `LICENSE` dosyası raw olarak okundu; PyPI `casbin` paketi license alanı "Apache 2.0", son sürüm 1.43.0)
- **Dil:** Go. Modül `github.com/casbin/casbin/v3` (`go.mod`). Bağımlılıklar: `github.com/casbin/govaluate` (ifade değerlendirici; lisansı bu analizde ayrıca doğrulanmadı), `bmatcuk/doublestar/v4`, `google/uuid`
- **Son commit:** 2026-11-15 (`--depth 1` klonda tag yok; modül major sürümü v3)

## Ne yapıyor (3-5 cümle)
Yetkilendirme kütüphanesi. Erişim modeli bir `.conf` dosyasında PERM metamodeli (Policy, Effect, Request, Matchers) ile tanımlanır; politikalar CSV/DB'de satır olarak durur. `Enforce(sub, dom, obj, act)` çağrısı matcher ifadesini politikalara karşı değerlendirip allow/deny döner. ACL, RBAC (rol hiyerarşisi, domain/tenant), ABAC (`eval()` ile attribute kuralları), BLP/Biba gibi modeller aynı motorla ifade edilir. Adapter'lar ile politikalar herhangi bir DB'de, watcher'lar ile birden çok node arasında senkron tutulur.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Yol | Sorumluluk |
|---|---|
| `enforcer.go`, `enforcer_cached.go`, `enforcer_synced.go`, `enforcer_distributed.go` | Enforcer varyantları (cache'li, thread-safe, dağıtık) |
| `model/` | `.conf` parse (`model.go`, `assertion.go`), politika depolama (`policy.go`), yerleşik fonksiyonlar (`function.go`: `keyMatch*`, `regexMatch`, `globMatch`, `ipMatch`) |
| `rbac/default-role-manager/` | Rol grafı, domain'li rol kalıtımı, pattern'li domain eşleme |
| `rbac_api.go`, `rbac_api_with_domains.go` | `GetRolesForUserInDomain`, `GetPermissionsForUserInDomain`, `GetAllUsersByDomain`, `DeleteDomains`... |
| `management_api.go` | Politika CRUD, `GetFilteredPolicy` |
| `persist/` | `adapter.go`, `adapter_filtered.go` (tenant bazlı kısmi yükleme), `watcher.go`, `dispatcher.go` |
| `effector/` | `some(where allow)`, `!some(where deny)`, öncelik efektleri |
| `examples/` | Hazır model/policy çiftleri |

**Akış:** `NewEnforcer(model.conf, adapter)` → politikalar belleğe yüklenir → `Enforce(req...)` → matcher govaluate ile her politika satırı için çalışır → effector sonucu birleştirir.

## Floem BI için kritik kısımlar
- `examples/rbac_with_domains_model.conf` → `r = sub, dom, obj, act`, `g = _, _, _`, `m = g(r.sub, p.sub, r.dom) && r.dom == p.dom && ...` → tenant (workspace) başına rol: "alice, domain1'de admin" → Floem BI workspace RBAC
- `examples/rbac_with_domain_pattern_model.conf` → domain wildcard → tüm tenant'larda geçerli sistem rolleri
- `examples/abac_rule_model.conf` → `p = sub_rule, obj, act`, `eval(p.sub_rule)` → kullanıcı attribute'u ile kural (ör. `r.sub.Region == "TR"`)
- `rbac_api_with_domains.go::GetPermissionsForUserInDomain` → kullanıcının tenant içindeki tüm izinleri → RLS filtre ifadelerini çekmek için kullanılabilir
- `persist/adapter_filtered.go` → sadece ilgili tenant politikalarını yükleme → çok kiracılıkta bellek ölçeği
- `frontend.go::CasbinJsGetPermissionForUser` → izinleri frontend'e (casbin.js) aktarma → UI'da buton/menü gizleme

## Semantik model / ölçü tanımı nasıl temsil ediliyor
Uygulanamaz. Ancak RLS için örnek politika şeması önerisi:
```
p = sub, dom, obj, act, filter   # obj = "model:sales/table:Customer", act = "read", filter = "[Region] = USERATTR('region')"
g = _, _, _                      # kullanıcı, rol, tenant
```

## Sorgu nasıl üretiliyor
Casbin SQL üretmez; yalnızca allow/deny verir. RLS için Floem BI tarafında: `GetImplicitPermissionsForUser` / `GetFilteredPolicy` ile kullanıcının rol(ler)ine bağlı `filter` alanları alınır → semantik model derleyicisinde tablo filtresi olarak `WHERE`'e eklenir (Power BI RLS rol DAX filtresine karşılık).

## Alınacak fikirler
- PERM metamodeli: yetki modelini koddan ayırıp konfigürasyona taşımak
- `g = _, _, _` ile tenant-scoped rol ataması; domain pattern ile global roller
- Filtered adapter + watcher: tenant başına lazy load, çok instance'ta cache invalidation
- Deny-override effect (`!some(where (p.eft == deny))`) ile açık reddetme

## Kaçınılacaklar / zayıf yönler
- Satır seviyesinde değerlendirme yapmaz; satır başına `Enforce` çağırmak performans felaketi olur. RLS mutlaka SQL predicate'e derlenmeli
- `eval()` ile serbest ifade politikaları güvenlik ve denetim açısından riskli; RLS ifadeleri Floem'in kendi ifade dilinde tutulmalı
- Go ve Python sürümleri arasında özellik farkı olabilir (backend dili hangisiyse o port test edilmeli)

## Kullanım kararı: Bağımlılık olarak kullan
Nesne seviyesi RBAC (workspace/rapor/dataset izinleri) için pycasbin (Python backend) veya casbin (Go) doğrudan kullanılabilir. RLS için Casbin yalnızca "hangi rol hangi filtreyi alır" deposu olarak; filtre → SQL derlemesi Floem semantik katmanında yapılmalı.
