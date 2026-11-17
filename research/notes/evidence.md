# Evidence (evidence-dev/evidence)
- URL: https://github.com/evidence-dev/evidence
- Lisans: **MIT, doğrulandı.** Kök `LICENSE`: "MIT License, Copyright (c) 2026 Evidence". Kodda başka lisans dosyası yok; bulunan alt lisanslar yalnızca font dosyalarına ait (`cli/static/fonts/{geist,geist-mono,noto-color-emoji}/LICENSE.txt`).
  - **Dikkat 1:** `AGENTS.md`'ye göre bu repo, daha büyük **kapalı bir reponun salt okunur aynası** (Copybara, `copy.bara.sky`). `FILTER_SYSTEM.md` içinde adı geçen `studio/` SvelteKit uygulaması (editör, yayınlama, RLS, sayfa yetkileri, AI chat, Evidence Warehouse) bu repoda **yok**. MIT kapsamı yalnızca `core/` ve `cli/` için geçerli.
  - **Dikkat 2:** `core/package.json` içinde `@markdoc/markdoc` paketi `npm:@hughess/markdoc@^0.0.0-evidence.29` olarak, yani Evidence'a özel bir fork üzerinden geliyor. Upstream Markdoc MIT; fork'un lisansı ayrıca kontrol edilmeli.
- Dil: TypeScript + Svelte 5 (`core/`), Bun ile derlenen CLI + SvelteKit (`cli/`), dokümanlar Mintlify `.mdx` (`docs/`)
- Son commit tarihi: 2026-11-16

## Ne yapıyor (3-5 cümle)
Evidence, raporların **Markdown + SQL kod blokları + Markdoc bileşen etiketleriyle** (`{% bar_chart … /%}`) kod olarak yazıldığı bir "BI-as-code" aracı. Bu repodaki güncel sürüm ("Evidence Core / Studio") eski Evidence'tan tamamen farklı. Eski sürüm Svelte bileşenlerini kullanıyordu ve DuckDB-WASM ile tarayıcıda çalışan statik bir site üretiyordu. Yeni sürümde SQL **sunucu tarafında** çalışıyor: varsayılan olarak ClickHouse/chdb, isteğe bağlı olarak "direct connector" ile Snowflake, BigQuery, Postgres, SQL Server, Fabric gibi kaynakların kendi diyalektiyle. Bileşenler kendi SQL'lerini üretiyor; `y="sum(sales)"`, `date_grain`, `filters`, `where` ve karşılaştırma (`prior year`) gibi öznitelikleri SQL'e çeviriyorlar. Ayrıca YAML ile tanımlanan basit bir **metrics view** semantik katmanı ve AI ajanı için araçlar (`list_metrics`, `query_metric`, CLI `docs`, `validate`) var.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `core/src/user-components/` | Bileşen sistemi. `tags/<bileşen>/` içinde her bileşen için `schema.ts` (Zod öznitelik şeması), `*Model.svelte.ts` (öznitelik → SQL yapılandırması) ve `.svelte` (render) dosyaları var. `common/sql-options.ts::generateSQLQuery` ortak SQL üreticisi. Mimari dokümanları: `COMPONENT_SYSTEM.md`, `common/COMPARISON_SYSTEM.md`, `common/VARIABLE_PROCESSING.md`, `VALUE_FORMATTING.md` |
| `core/src/user-components/Renderer/MarkdocProcessor/` | Markdown/Markdoc ayrıştırma, değişken doğrulama |
| `core/src/metrics/` | Semantik katman: `metric-schema.ts` (YAML şeması ve doğrulama), `compile-metric.ts` (metrik ve boyut → `SQLQueryConfig`), `resolve-metric.ts`, `metrics-catalog.ts` |
| `core/src/sql-dialect/` + `sql-dialect.ts` | `SqlDialect` arayüzü ve 11 diyalekt (clickhouse, postgres, sqlserver, fabric, snowflake, bigquery, databricks, redshift, athena, motherduck, cube) |
| `core/src/Filter.svelte.ts`, `Filters.svelte.ts`, `FILTER_SYSTEM.md` | Girdi bileşenlerinin filtre durumu, URL senkronu, sayfalar arası kalıcılık |
| `core/src/Query.svelte.ts` (≈1100 satır) | Reaktif sorgu nesnesi, yükleme ve hata durumları |
| `core/src/connectors/`, `core/src/connection/` | Kaynak tip eşlemeleri, bağlantı kaydı, şema allowlist |
| `core/src/lineage/` | Sorgu ve sayfa lineage çıkarımı |
| `core/src/theme/`, `locale/`, `translations/` | Tema token'ları, yerelleştirme, çeviri |
| `cli/cli/` | `evidence` CLI: `init`, `dev`, `serve`, `validate`, `migrate`, `query`, `lineage`; `connection/*.ts` (kaynak başına sürücü) |
| `cli/src/routes/` | SvelteKit sunucusu. `[...path]` sayfa render'ı, `api/query/+server.ts` sorgu ucu, `api/validate`, `api/docs/*` (AI ajanı için dokümantasyon) |
| `docs/components/*.mdx` | 90'dan fazla bileşenin referansı |

**Veri akışı:**
```
pages/*.md (frontmatter + ```sql ad``` blokları + {% bileşen %})
 → Markdoc parse → bileşen Model'i (Svelte 5 $derived)
 → öznitelikler + sayfa filtreleri + metrik tanımı → SQLQueryConfig
 → generateSQLQuery(config, filterContexts, inlineQueries, dialect) → SQL
 → /api/query (sunucu) → warehouse (ClickHouse veya direct connector)
 → satırlar → ECharts / tablo render
```
Inline sorgular `{{query_name}}` ile birbirine referans veriyor ve alt sorgu olarak yerine yazılıyor.

## Floem BI için kritik kısımlar
- `core/src/metrics/compile-metric.ts` → metrik adları + boyut adları → `SQLQueryConfig`. `{revenue}/{orders}` referanslarını inline açıyor, döngü tespiti yapıyor, metrik başına filtreyi aggregate'in içine katlıyor (`FILTER (WHERE …)` veya `CASE WHEN`) → Floem BI ölçü derleyicisinin **minimum çekirdeği** (CALCULATE'in en basit, sabit filtreli biçimi)
- `core/src/metrics/metric-schema.ts` → metrics view YAML şeması ve validasyonu → Floem ölçü tanım dosyası
- `core/src/user-components/common/sql-options.ts::generateSQLQuery` → SELECT/WHERE/HAVING/arama/tarih aralığı/sayfalama birleştirme → Floem görsel → SQL üreticisi
- `core/src/user-components/common/build-comparisons.ts` + `COMPARISON_SYSTEM.md` → "prior year / prior period" karşılaştırmaları ve benchmark'lar için CTE + JOIN üretimi → **zaman zekâsı** (SAMEPERIODLASTYEAR, DATEADD) karşılığı
- `core/src/user-components/tags/table/build-table-sql.ts` + `docs/core-concepts/metrics.mdx` → tablo toplam satırı `GROUP BY GROUPING SETS` ile toplam seviyesinde yeniden hesaplanıyor (satırların toplamı değil) → Power BI'daki "total satırı filtre bağlamında yeniden hesaplanır" davranışı
- `core/src/Filter.svelte.ts`, `FILTER_SYSTEM.md` → filtre durumu, URL'de yalnızca kullanıcı niyeti, `setDefault` / `normalize` ayrımı → slicer ve cross-filter durum yönetimi
- `core/src/sql-dialect/common.ts` + `sqlserver.ts` → diyalekt soyutlaması (quote, cast, case-insensitive like, countDistinct, tarih fonksiyonları) → Floem SQL Server / Postgres diyalekt katmanı
- `cli/src/routes/api/docs/*`, `cli/cli/validate.ts` → AI ajanının bileşen dokümanlarını sorgulayıp raporu doğrulayabildiği uçlar → Floem "AI ile rapor üretimi" döngüsü (üret → validate → düzelt)

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Gerçek örnek, `docs/core-concepts/metrics.mdx`'ten (`metrics/sales.yaml`):
```yaml
base: demo.order_details          # veya base_sql: "select ..."
date: created_at
default_date_grain: month
dimensions:                        # map: ad → kaynak ifade
  region: region
  product: product_line
metrics:                           # map; isimler proje genelinde tekil
  revenue:
    sql: sum(unit_price * quantity)
    fmt: usd
    label: Revenue
    description: Total revenue from all order line items
    # synonyms: [...]  -> AI eşleştirmesi için
  orders:
    sql: count(distinct order_id)
    fmt: num0
  aov:
    sql: '{revenue} / nullif({orders}, 0)'   # hesaplanmış metrik
    fmt: usd
  electronics_revenue:
    sql: sum(unit_price * quantity)
    filter: category = 'Electronics'         # aggregate içine katlanır
```
Kısıtlar: tek tablo tabanlı (join yok, view'lar arası referans "v2"ye bırakılmış), hiyerarşi yok, ilişki modeli yok. Rapor tarafında kullanım:
```
{% table %}
  {% dimension value="region" /%}
  {% measure metric="revenue" comparison={compare_vs: "prior year"} /%}
{% /table %}
{% bar_chart metric=["revenue","orders"] series="region" /%}
```

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
1. Bileşen öznitelikleri Zod şemasıyla doğrulanıyor. `{{filter}}` değişkenleri çözümleniyor (`VARIABLE_PROCESSING.md`).
2. `metric=` varsa `compileMetric(view, {metrics, dimensions})` çalışıyor. Yalnızca istenen boyutlar SELECT/GROUP BY'a giriyor, böylece sorgu tam istenen tanecikte (grain) kuruluyor. Metrik filtresi `applyAggregateFilter` ile aggregate'e katlanıyor. Hesaplanmış metrikler parantezle inline açılıyor.
3. `generateSQLQuery`, sayfa filtrelerini (`filters=["category"]`, `processFilterIds`), `where=`, `date_range` ve aramayı WHERE'de birleştiriyor. Ölçü varsa arama HAVING'e gidiyor. Gerektiğinde sayfalama için alt sorgu kuruluyor.
4. Karşılaştırmalar (`prior year`) ayrı CTE'ler ve JOIN'lerle ekleniyor. Tablo toplamları için `GROUPING SETS` kullanılıyor.
5. SQL, sunucuda `/api/query` üzerinden çalışıyor. Dönen sonuç ECharts ile çiziliyor.

## Alınacak fikirler
1. **Rapor tanım formatı = metin (Markdown + deklaratif bileşen etiketleri), JS çalıştırılmıyor.** "Core expresses config not code" ilkesi var. Floem rapor dosyası için Git'te diff'lenebilir, AI'nın yazabileceği, şema ile doğrulanabilir bir format; sürükle-bırak tasarımcı da aynı yapıyı (JSON/YAML) üretebilir.
2. **Bileşen kendi SQL'ini üretir** (`y="sum(sales)"`, `date_grain`, `comparison`). Kullanıcı ham SQL yazmıyor. Floem görselleri de "alan + toplama + filtre bağlamı → SQL" mantığıyla çalışmalı.
3. **Metrik filtresini WHERE yerine aggregate içine katlamak** (`SUM(x) FILTER (WHERE …)` / `CASE WHEN`). Farklı filtreli ölçüler aynı sorguda bir arada çalışabiliyor. CALCULATE(…, sabit filtre) derlemesinin temel tekniği.
4. **Toplam satırını GROUPING SETS ile toplam seviyesinde yeniden hesaplamak.** Toplanamayan ölçülerde (count distinct, oran) doğru sonuç veriyor.
5. **Metrik meta verisi:** `fmt`, `label`, `description`, `synonyms` (AI eşleştirmesi için), proje genelinde tekil isimler, editörde canlı doğrulama, döngü tespiti.
6. **AI ajanı için araç seti:** `list_metrics` / `get_metric` / `query_metric` (bileşenlerle aynı derleyiciyi kullandığı için sonuçlar tutarlı), `validate`, `docs component <ad>`. Floem AI katmanı da ölçü kataloğu üzerinden çalışmalı, ham SQL yazmamalı.
7. **Filtre durumu tasarımı:** URL'de yalnızca kullanıcının yaptığı seçim tutuluyor, varsayılanlar URL'e yazılmıyor. Paylaşılabilir ve yer imine eklenebilir filtreli görünümler sağlıyor.
8. **`SqlDialect` arayüzü** (11 diyalekt). Floem'in SQL Server ve Postgres hedefleri için TypeScript tarafında hazır bir referans.

## Kaçınılacaklar / zayıf yönler
- **DuckDB-WASM ile tarayıcıda sorgu artık yok.** Bu yaklaşım "Legacy Evidence"a ait ve geçiş rehberinde (`docs/migration-guide.mdx`) terk edildiği açıkça yazıyor: "~2M rows" sınırı, her veri değişikliğinde build gerekmesi. Evidence bu sınırlar yüzünden sunucu tarafı yürütmeye geçmiş. Floem için de ana yol bu olmalı; WASM ancak küçük veri setleri veya çevrimdışı önbellek için düşünülebilir.
- **Semantik katman zayıf:** tek tablo, join yok, ilişki/kardinalite yok, hiyerarşi yok, view'lar arası metrik referansı yok. Gerçek bir filtre bağlamı (ALL, REMOVEFILTERS, bağlam geçişi) yok. Power BI benzeri bir model için yetersiz. Doküman da "joins belong in models (önceden materyalize edin)" diyor.
- **Değerli kurumsal parçalar kapalı:** RLS, sayfa yetkileri, SSO, AI chat, warehouse (Studio-only). Self-host (`evidence serve`) yalnızca Basic Auth ve tek warehouse kimliğiyle çalışıyor, kullanıcı başına RLS yok (`docs/self-host/authentication.mdx`).
- Repo kapalı bir monorepo'nun aynası. Markdoc özel bir fork'tan geliyor. Bağımlılık olarak almak, üreticinin yön değişikliklerine (bu repoda zaten bir kez köklü bir değişiklik yaşandı) açık olmak demek.
- SQL üretimi string birleştirmeye dayanıyor (`generateSQLQuery`), bir AST/IR yok. Karmaşık ölçü bileşimlerinde ölçeklenmesi zor.
- Bileşen öznitelikleri içinde serbest SQL ifadesi (`where=`, `y="sum(...)"`) var. Floem'de güvenlik (injection) ve yönetişim açısından kısıtlanmalı.

## Kullanım kararı: Fikir al
MIT olduğu için kod parçası kopyalanabilir (telif bildirimi korunarak). Özellikle `compile-metric.ts`, `SqlDialect` arayüzü, `GROUPING SETS` ile toplam yaklaşımı ve filtre/URL durum modeli uyarlanabilir. Ancak ürünün bütünü (Svelte 5 + Markdoc fork + ClickHouse varsayımı + kapalı Studio) Floem BI mimarisine bağımlılık olarak alınmaya uygun değil. Rapor tanım formatı ve "bileşen SQL'ini kendisi üretir" ilkesi Floem BI için temel referans olmalı.
