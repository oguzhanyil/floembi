# Wren Engine (Canner/wren-engine)
- URL: https://github.com/Canner/wren-engine
- Lisans: **Apache 2.0, doğrulandı.** Kök `LICENSE` Apache 2.0. Alt lisans olarak yalnızca `wren-core-wasm/LICENSE` var, o da Apache 2.0. Manifest dosyalarında da aynı: `wren-core/Cargo.toml`, `wren-core-py/Cargo.toml`, `wren-core-py/pyproject.toml`, `wren/pyproject.toml` hepsi `Apache-2.0`. Kaynak dosyalarında ASF tarzı Apache başlığı var.
  - **Önemli:** Repo **arşivlendi** (README: "merged into Canner/WrenAI under the `core/` directory and is now archived"). Yeni geliştirme WrenAI reposunun `core/` klasöründe sürüyor. WrenAI'ın kök `LICENSE` dosyası (17.11.2026'da WebFetch ile okundu) çok lisanslı bir yapı tarif ediyor: `core/**`, `sdk/**`, `skills/**` ve `examples/**` Apache 2.0, `docs/**` CC BY 4.0. Aynı dosya "ileride AGPL-3.0 modüller eklenebilir" diye uyarıyor. **Sonuç:** Bu arşiv repo ve WrenAI `core/` Apache 2.0, kullanılabilir. WrenAI'ın UI/AI servis kısımlarına (wren-ui, wren-ai-service) dokunmadan önce her seferinde ayrıca lisans kontrolü yapılmalı.
- Dil: Rust (çekirdek, `wren-core`), Python (`wren` CLI/SDK, `ibis-server` FastAPI, `mcp-server`), Java (`wren-core-legacy`, eski v2 motoru), TypeScript/WASM (`wren-core-wasm`)
- Son commit tarihi: 2026-05-06 (arşiv öncesi son commit)

## Ne yapıyor (3-5 cümle)
Wren Engine, ham tablolar üzerine MDL (Modeling Definition Language) adlı bir JSON/YAML semantik katman tanımlıyor. Bu katmanda model, kolon, ilişki, hesaplanmış kolon, view ve RLS/CLS kuralları yer alıyor. İstemci (bir LLM ajanı ya da BI aracı) model adlarıyla düz SQL yazıyor (`SELECT totalprice FROM customers`). Motor bu SQL'i Apache DataFusion ile mantıksal plana çeviriyor, MDL'ye göre modelleri, ilişki join'lerini ve hesaplanmış alanları genişletiyor, sonra hedef veritabanının diyalektinde SQL'e geri "unparse" ediyor. Üretilen SQL Ibis/sqlglot konnektörleriyle 18'den fazla kaynakta (SQL Server dahil) çalıştırılıyor. Ürün "AI ajanları için context engine" olarak konumlanıyor: MCP sunucusu, şema/sorgu hafızası (LanceDB) ve strict SQL policy modu içeriyor.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `wren-core-base/` | Paylaşılan Rust crate'i. MDL tipleri (`Manifest`, `Model`, `Column`, `Relationship`, `View`, `Cube`, `RowLevelAccessControl`, …) `manifest-macro/src/lib.rs` içindeki proc-macro'larla üretiliyor (PyO3 olan ve olmayan iki varyant). Ayrıca `builder.rs` (fluent builder), `migration.rs`, `cls.rs`. |
| `wren-core/core/` | Asıl motor. `mdl/mod.rs`: `AnalyzedWrenMDL`, `transform_sql_with_ctx` (≈4200 satır, unit testlerin çoğu da burada). `logical_plan/analyze/*`: DataFusion analyzer kuralları (`model_anlayze.rs`, `model_generation.rs`, `relation_chain.rs`, `access_control.rs`, `expand_view.rs`, `plan.rs`). `mdl/dialect/`: hedef diyalekte unparse. `mdl/lineage.rs`: kolon bağımlılık grafiği. |
| `wren-core/sqllogictest/` | Uçtan uca SQL testleri (`.slt`) |
| `wren-core/wren-example/examples/` | Çalıştırılabilir örnekler: `to-many-calculation.rs`, `row-level-access-control.rs`, `view.rs`, `plan-sql.rs` |
| `wren-core-py/` | PyO3 + Maturin ile Python binding'i |
| `wren-core-wasm/` | DataFusion + MDL'nin WASM'a derlenmiş hali; tarayıcıda Parquet üzerinde semantik SQL çalıştırıyor (binary ≈68 MB) |
| `ibis-server/` | FastAPI REST API (`/v3` router). Sorgu çalıştırma, doğrulama, metadata. Kaynak bağlantıları Ibis üzerinden. |
| `wren/` | `wren` CLI/SDK: YAML proje yönetimi (`models/<ad>/metadata.yml`), bağlantı profilleri, `mdl/cte_rewriter.py`, `policy.py` (strict mode), `memory/` (LanceDB + embedding ile şema ve örnek sorgu arama) |
| `mcp-server/` | MCP sunucusu (`app/wren.py`, `app/web.py`): MDL deploy, metadata araçları, read-only modu, `mdl.schema.json` |
| `wren-core-legacy/` | Java motoru, v2 API için yedek (eski `metrics`/`cumulativeMetrics` desteği burada) |

**Veri akışı** (`.claude/CLAUDE.md`'den, kodla teyit edildi):
```
Kullanıcı/LLM SQL'i (model adlarıyla)
 → ibis-server /v3 veya wren CLI
 → (wren/mdl/cte_rewriter.py: sqlglot ile parse + qualify_columns; her model için
    "SELECT kolonlar FROM model" üretip wren-core'a gönderir, sonucu CTE olarak enjekte eder)
 → wren-core-py (PyO3) → wren-core: AnalyzedWrenMDL → DataFusion LogicalPlan
 → Wren analyzer kuralları (ModelPlanNode / ModelSourceNode / PartialModelPlanNode / RLS)
 → DataFusion optimize → Unparser(WrenDialect(data_source)) → hedef SQL
 → Ibis konnektörü → native veritabanında çalıştırma
```

## Floem BI için kritik kısımlar
- `wren-core-base/manifest-macro/src/lib.rs` → MDL'nin kesin şeması (struct alanları, serde `camelCase`, `JoinType` enum: `ONE_TO_ONE|ONE_TO_MANY|MANY_TO_ONE|MANY_TO_MANY`) → Floem BI semantik model JSON şemasına doğrudan referans
- `wren-core/core/src/mdl/mod.rs::transform_sql_with_ctx` → SQL → LogicalPlan → analyze/optimize → `Unparser::plan_to_sql` hattı → Floem BI "ölçü dili → SQL derleyici"nin son aşaması (mantıksal plandan diyalekte SQL üretimi)
- `wren-core/core/src/logical_plan/analyze/plan.rs` (`ModelPlanNode`, `ModelSourceNode`, `PartialModelPlanNode`, `SqlReferenceNode`) → modelleri ve ilişki zincirlerini DataFusion'a özel `UserDefinedLogicalNode` olarak temsil ediyor → Floem BI sorgu planlayıcısındaki "semantik düğüm" katmanı
- `wren-core/core/src/logical_plan/analyze/relation_chain.rs` → hesaplanmış alanın gerektirdiği ilişki yolunu join zincirine çeviriyor → Power BI'daki RELATED/RELATEDTABLE ve otomatik join çözümü
- `wren-core/core/src/logical_plan/analyze/access_control.rs` + `wren-core/wren-example/examples/row-level-access-control.rs` → oturum özellikli (`@session_tenant_id`) RLS koşulları → Floem BI RLS ve çok kiracılık
- `wren-core-base/src/mdl/cls.rs` → kolon seviyesinde erişim kontrolü (CLS) → Floem BI'da OLS (Object Level Security) karşılığı
- `wren-core/core/src/mdl/dialect/wren_dialect.rs` + `inner_dialect.rs` → DataFusion `Dialect` trait'ini kaynağa göre özelleştirme → SQL Server / Postgres diyalekt katmanı
- `wren-core/core/src/mdl/lineage.rs` → kolonlar arası bağımlılık grafiği → ölçü bağımlılık analizi ve etki analizi
- `wren/src/wren/memory/schema_indexer.py` → MDL'yi LLM için düz metne çeviriyor (`describe_schema`); 30K karakter eşiğinin altında tüm şema prompt'a giriyor, üstünde embedding araması devreye giriyor → Floem BI "AI ile sorgulama"daki şema bağlamı stratejisi
- `wren/src/wren/policy.py` → AI'nın ürettiği SQL'i sqlglot AST'si üzerinden denetliyor: yalnızca MDL modelleri kullanılabilir, yasaklı fonksiyonlar engellenir → AI sorgu güvenlik kapısı
- `mcp-server/mdl.schema.json` → MDL için JSON Schema → Floem BI model dosyasının doğrulanması

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Kök `Manifest` (`manifest-macro/src/lib.rs`): `layoutVersion`, `catalog`, `schema`, `models[]`, `relationships[]`, `views[]`, `dataSource`, `cubes[]`.

**Model** alanları: `name`, `refSql` | `baseObject` | `tableReference`, `columns[]`, `primaryKey`, `cached`, `refreshTime`, `rowLevelAccessControls[]`, `dialect`.
**Column** alanları: `name`, `type`, `relationship`, `isCalculated`, `notNull`, `expression`, `isHidden`, `columnLevelAccessControl`.
**Relationship** alanları: `name`, `models[2]`, `joinType`, `condition`.

Gerçek örnek, `wren-core/wren-example/examples/to-many-calculation.rs`'den (builder → JSON eşdeğeri):
```json
{
  "name": "customers",
  "tableReference": "datafusion.public.customers",
  "primaryKey": "id",
  "columns": [
    {"name": "id", "type": "varchar"},
    {"name": "state", "type": "varchar"},
    {"name": "orders", "type": "orders", "relationship": "orders_customer"},
    {"name": "totalprice", "type": "double", "isCalculated": true,
     "expression": "sum(orders.order_items.price)"}
  ]
}
```
`order_items` modelinde ise ters yönde bir to-one hesaplanmış alan var: `customer_state = orders.customers.state`.

RLS örneği (`row-level-access-control.rs`):
```
add_row_level_access_control("multitenant",
   [SessionProperty::new_required("session_tenant_id")],
   "tenant_id = @session_tenant_id")
```

**Ölçüler (metrics) hakkında:** Rust v3 çekirdeğinde ayrı bir "metric" nesnesi **yok**. Toplama işlemi, ilişki üzerinden giden hesaplanmış kolonla (`sum(orders.o_totalprice)`) ya da kullanıcının SQL'indeki `GROUP BY` ile yapılıyor. Eski Java motorunda `Metric` (`baseObject`, `dimension[]`, `measure[]`, `timeGrain[]`) ve `CumulativeMetric` (`measure`, `window`) vardı (`wren-core-legacy/wren-base/src/main/java/io/wren/base/dto/Metric.java`). Yeni çekirdeğe `Cube` (`baseObject`, `measures[]`, `dimensions[]`, `timeDimensions[]`, `hierarchies: {ad: [kaba→ince]}`) tipi eklenmiş, ancak `wren-core/core/src` içinde hiç kullanılmıyor. Yani tip tanımlı, planlayıcıya bağlanmamış (arşivlenirken yarım kalmış bir özellik).

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Wren'de "ölçü + boyut + filtre" API'si yok. Girdi her zaman **SQL**: `SELECT p_sex, totalcost FROM profile WHERE p_sex='M'`.
1. `create_wren_ctx` + `apply_wren_on_ctx`: Her model, DataFusion catalog'una (`wrenai.public.<model>`) sanal tablo olarak kaydediliyor.
2. `ctx.state().create_logical_plan(sql)`: Standart DataFusion planı oluşuyor.
3. Wren analyzer kuralları, model taramalarını `ModelPlanNode`'a çeviriyor. Bu düğüm, sorgunun gerektirdiği alanları topluyor. Hesaplanmış alan to-many bir ilişkiye bakıyorsa (`sum(orders.x)`), `PartialModelPlanNode` ve `relation_chain` ile **önce ilişkili tarafta `GROUP BY <pk>` alt sorgusu, sonra ana modelle join** üretiliyor. Bu, fan-out (satır çoğalması) problemini çözüyor.
4. RLS koşulları oturum özellikleriyle model kaynağına `WHERE` olarak ekleniyor. CLS, izin verilmeyen kolonu şemaya hiç kaydetmiyor (hata "column not found" olarak çıkıyor, `permission_analyze` bunu daha anlaşılır bir mesaja çeviriyor).
5. DataFusion optimize ediyor, sonra `Unparser` + `WrenDialect` hedef SQL'i üretiyor.

Üretilen SQL'den gerçek bir kesit (`mdl/mod.rs` satır 806 snapshot testi, kısaltıldı):
```sql
SELECT "profile".totalcost FROM (... SELECT __relation__2.p_custkey AS p_custkey,
  sum(CAST(__relation__2.o_totalprice AS BIGINT)) AS totalcost
  FROM (... orders RIGHT OUTER JOIN (customer RIGHT OUTER JOIN profile ...)) AS __relation__2
  GROUP BY __relation__2.p_custkey) AS totalcost
RIGHT OUTER JOIN (SELECT __source.p_custkey ... FROM "profile" AS __source) AS "profile"
  ON totalcost.p_custkey = "profile".p_custkey ...
```
Snapshot'ta görüldüğü gibi çıktı derin iç içe alt sorgulardan oluşuyor ve okunması zor.

## Alınacak fikirler
1. **"Önce mantıksal plan, sonra diyalekte unparse" mimarisi.** Floem ölçü dili doğrudan string SQL üretmek yerine DataFusion `LogicalPlan`'a (veya kendi IR'ımıza) derlenmeli, diyalekt farkı en son aşamada `Unparser` + özel `Dialect` ile çözülmeli. DataFusion Apache 2.0; SQL Server diyalekti için `Dialect` trait'i genişletilebilir.
2. **To-many ilişkide "önce grupla, sonra join et" kalıbı** (`PartialModelPlanNode`). DAX'taki ilişki üzerinden toplama (`SUMX(RELATEDTABLE(...))`) ve fan-out güvenliği için doğrudan şablon.
3. **Kolon tabanlı ilişki handle'ı** (`{"name":"customer","type":"customers","relationship":"orders_customers"}` → `orders.customer.first_name` noktalı yol). Rapor alanı seçerken join'i otomatik çözmek için iyi bir fikir.
4. **Oturum değişkenli RLS ifadesi** (`tenant_id = @session_tenant_id`, required/optional property ve default değer). Floem RLS rolleri için basit ve güçlü bir model.
5. **AI için:** Şema 30K karakterin altındaysa tam metin, üstündeyse embedding araması (`schema_indexer.py`). AI'nın ürettiği SQL'in AST üzerinden policy kontrolü (`policy.py`). Kolonlarda `properties.description` ve LLM bağlamı. MCP sunucusunda read-only mod.
6. **`Cube.hierarchies` (kaba→ince sıralı drill yolu) ve `timeDimensions`** tasarımı. Floem hiyerarşi tanımı için uygun bir şekil.
7. **Model başına `dialect` override'ı** (karma kaynaklı projelerde `refSql` diyalekti).
8. sqllogictest ile uçtan uca SQL üretim testleri ve `insta` snapshot testleri. Floem derleyicisinin regresyon testleri için örnek alınacak yaklaşım.

## Kaçınılacaklar / zayıf yönler
- **Repo arşivlendi.** Bağımlılık olarak alınırsa upstream WrenAI `core/`'a taşınmak gerekir. WrenAI çok lisanslı ve AGPL modül ekleme ihtimalini açıkça yazmış; risk izlenmeli.
- **Gerçek bir ölçü/filtre bağlamı motoru yok.** Ölçüler ya hesaplanmış kolon ya da kullanıcı SQL'i. CALCULATE benzeri bağlam değişimi, zaman zekâsı (YTD, SAMEPERIODLASTYEAR) ve hiyerarşik toplam yok. `Cube` yarım kalmış. DAX benzeri dil için yalnızca alt katman (join ve plan) olarak işe yarıyor.
- Üretilen SQL çok derin iç içe ve gereksiz `RIGHT OUTER JOIN`'lerle dolu. Okunabilirlik ve bazı motorlarda (SQL Server) performans riski taşıyor.
- `transform_sql` her çağrıda yeni bir tokio runtime oluşturuyor (`mdl/mod.rs` satır 466). Kod içinde "workaround" yorumları var (catalog prefix'i string replace ile siliniyor).
- Üç dil (Rust + Python + Java legacy) ve iki SQL katmanı (DataFusion + sqlglot CTE rewriter) aynı anda var. Karmaşıklık yüksek.
- WASM paketi ≈68 MB, tarayıcıda gömmek için pratik değil.
- Hata modeli zayıf: CLS ihlali önce "column not found" olarak çıkıyor, ikinci bir analiz turuyla izin hatasına çevriliyor.

## Kullanım kararı: Fikir al (+ seçici olarak kod referansı)
Lisans uygun (Apache 2.0), ama repo arşivlendiği ve ölçü/filtre bağlamı katmanı olmadığı için **bağımlılık olarak kullanılmamalı**. Floem BI'ın derleyici alt katmanı için **Apache DataFusion'ı doğrudan bağımlılık olarak değerlendirmek** ve Wren'in `ModelPlanNode`/`relation_chain`/RLS analyzer kalıplarını (gerekirse Apache 2.0 NOTICE ile parça parça) uyarlamak öneriliyor. MDL JSON şeması ve AI bağlam stratejisi tasarım referansı olarak alınmalı.
