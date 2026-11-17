# sqlglot
- URL: https://github.com/tobymao/sqlglot
- Lisans: **MIT** — doğrulandı (kök `LICENSE`, "Copyright (c) 2026 Toby Mao"; `pyproject.toml` → `license = "MIT"`). Alt lisans: yalnızca `tests/fixtures/jsonpath/LICENSE` (test fixture, dağıtıma girmez). Opsiyonel derlenmiş hızlandırıcı `sqlglotc/` (mypyc ile derleniyor) de MIT.
- Dil: Saf Python (bağımlılıksız çekirdek), opsiyonel mypyc derlemesi
- Sürüm: CHANGELOG'da son `v30.32.0` (2026-11-16); `pyproject.toml` sürümü dinamik (setuptools-scm)
- Son commit tarihi: 2026-11-17

## Ne yapıyor (3-5 cümle)
SQL'i tokenize/parse edip lehçeden bağımsız bir AST'ye (`exp.*`) çeviren, bu AST'yi 30+ lehçeye geri üreten (transpile) bir kütüphane. AST'yi programatik olarak kurmak için akıcı bir builder API (`exp.select().from_().where()`) sunar. `optimizer/` modülü şema bilgisiyle kolonları niteler, predicate/projection pushdown, subquery birleştirme, tip çıkarımı ve sadeleştirme yapar. Ayrıca `lineage.py` (kolon soy ağacı), `diff.py` (AST diff) ve saf Python `executor/` içerir.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör/Dosya | Sorumluluk |
|---|---|
| `sqlglot/tokens.py`, `tokenizer_core.py` | Tokenizer (lehçe başına alt sınıf) |
| `sqlglot/parser.py` + `sqlglot/parsers/<lehçe>.py` | Recursive-descent parser → `exp.Expr` ağacı |
| `sqlglot/expressions/` | AST düğüm sınıfları (`query.py`, `aggregate.py`, `temporal.py`, `functions.py`…) ve builder'lar (`builders.py`: `select`, `from_`, `merge`, `cast`, `func`, `subquery`, `replace_placeholders`) |
| `sqlglot/generator.py` + `sqlglot/generators/<lehçe>.py` | AST → SQL metni; `TRANSFORMS` sözlüğü ile düğüm başına özel üretim |
| `sqlglot/dialects/<lehçe>.py` | Tokenizer+Parser+Generator'ı bir `Dialect` sınıfında birleştirir (`tsql.py`, `fabric.py` (TSQL'den türer), `duckdb.py`, `postgres.py`, hatta `dax.py`) |
| `sqlglot/transforms.py` | Lehçe uyumsuzluklarını AST seviyesinde yeniden yazma (`eliminate_qualify`, `eliminate_distinct_on`, `eliminate_semi_and_anti_joins`…) |
| `sqlglot/optimizer/` | `optimizer.py` RULES: `qualify → pushdown_projections → normalize → unnest_subqueries → pushdown_predicates → optimize_joins → eliminate_subqueries → merge_subqueries → eliminate_joins → eliminate_ctes → quote_identifiers → annotate_types → canonicalize → simplify` |
| `sqlglot/schema.py` | `MappingSchema` — tablo→kolon→tip sözlüğü (qualify/annotate için) |

Akış: `sql → Tokenizer → Parser → exp AST → (transforms/optimizer) → Generator(dialect) → sql`.

## Floem BI için kritik kısımlar
- `sqlglot/expressions/builders.py` → `select/from_/merge/cast/func` builder'ları → Floem ölçü derleyicisinin **çıktı katmanı**: derleyici string birleştirmek yerine `exp` ağacı kurar, sonra `.sql(dialect="duckdb"|"tsql")` ile iki hedefe üretilir.
- `sqlglot/generators/tsql.py` (763 satır) + `parsers/tsql.py` (891) → T-SQL olgun: `LIMIT_FETCH="FETCH"` / TOP, `BOOLEAN→BIT` + `ENSURE_BOOLS`, `DATETRUNC`, `eliminate_qualify` (QUALIFY'ı alt sorguya çevirir), `qualify_derived_table_outputs` (CTE/subquery kolonlarına zorunlu alias), CTE'leri `CREATE VIEW` için yukarı taşıma. `tests/dialects/test_tsql.py` 3304 satır. → SQL Server DirectQuery ve Gateway tarafı sorgu üretimi.
- `sqlglot/dialects/fabric.py` → Fabric Warehouse lehçesi (TSQL türevi) → İleride Fabric uyumu.
- `sqlglot/optimizer/qualify.py`, `pushdown_predicates.py`, `merge_subqueries.py`, `simplify.py` → Derleyicinin ürettiği iç içe CTE/subquery'leri sadeleştirme, RLS filtrelerini en içe itme. → Floem "SQL optimize" aşaması.
- `sqlglot/generator.py` (`unsupported_level`, L958) + `errors.py` `ErrorLevel.RAISE` → Hedef lehçede desteklenmeyen ifade olursa sessiz hatalı SQL yerine istisna. → Floem'de `RAISE` zorunlu olmalı.
- `sqlglot/lineage.py` → Kolon soy ağacı → Gold tablo/ölçü bağımlılık grafiği, etki analizi.
- `sqlglot/dialects/dax.py`, `parsers/dax.py` (48 satır) → Yalnızca `EVALUATE <tablo>` / `FILTER(...)` → SELECT. Ölçü dili için **kullanılamaz**, oyuncak düzeyde.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Uygulanamaz (semantik model yok). Yalnızca fiziksel şema: `MappingSchema({"dbo.OINV": {"DocEntry": "INT", "DocTotal": "DECIMAL"}})`.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Ölçü kavramı yok; ama Floem derleyicisi şöyle kullanabilir:
```python
from sqlglot import exp
q = (exp.select(exp.column("CardCode", "f"), exp.func("SUM", exp.column("DocTotal","f")).as_("Ciro"))
       .from_(exp.to_table("gold.fact_sales").as_("f"))
       .where(exp.column("Year","d").eq(2026)).group_by(exp.column("CardCode","f")))
q.sql(dialect="tsql", unsupported_level=ErrorLevel.RAISE); q.sql(dialect="duckdb")
```

## Alınacak fikirler
- Derleyici IR'ı → `exp` AST; lehçe farkları için kendi `transforms` benzeri AST yeniden yazma kuralları.
- `optimizer` zincirini seçici kullanmak (qualify + pushdown_predicates + merge_subqueries + simplify).
- Dialect sınıf hiyerarşisi (Fabric ⊂ TSQL) — SAP B1 HANA vs MSSQL için örnek.
- Kullanıcı tarafından yazılan "native SQL" kaynaklarını parse edip doğrulama ve tablo/kolon çıkarma.

## Kaçınılacaklar / zayıf yönler
- Çok sık sürüm (major 30.x); API kırılmaları olabilir → sürümü sabitle (`sqlglot==30.x`), regresyon testleri yaz.
- Transpile %100 semantik eşdeğerlik garanti etmez (tarih fonksiyonları, NULL sıralaması `NULL_ORDERING_SUPPORTED=None` T-SQL'de, collation, integer bölme). Kritik fonksiyonlar için Floem kendi test setini tutmalı.
- `optimizer` doğru şema olmadan yanlış qualify yapabilir; büyük sorgularda yavaş olabilir.
- `dax` lehçesi işe yaramaz; DAX parser'ı başka yerden (pbi_parsers/ANTLR) gelmeli.

## Kullanım kararı: **Bağımlılık olarak kullan**
Floem ölçü dili → SQL derleyicisinin hedef AST'si ve DuckDB/T-SQL/PostgreSQL üreticisi olarak doğrudan bağımlılık.
