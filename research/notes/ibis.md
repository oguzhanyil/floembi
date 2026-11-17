# ibis
- URL: https://github.com/ibis-project/ibis
- Lisans: **Apache 2.0** — doğrulandı (kök `LICENSE.txt`; `pyproject.toml` → `license = { text = "Apache-2.0" }`). Alt klasörde ayrı LICENSE yok.
- Dil: Python
- Sürüm: `pyproject.toml` → `version = "12.0.0"`; bağımlılık `sqlglot>=23.4,!=26.32.0`
- Son commit tarihi: 2026-11-05

## Ne yapıyor (3-5 cümle)
Pandas/dplyr benzeri tembel (lazy) bir DataFrame API'si sunar; ifadeler tipli bir operasyon ağacına (`ibis.expr.operations`) dönüşür ve seçilen backend'de çalıştırılır. SQL backend'lerinde (DuckDB, MSSQL, Postgres, Snowflake… 20+) bu ağaç **sqlglot AST'sine** derlenip ilgili lehçede SQL üretilir. `ibis.table(schema, name=...)` + `ibis.to_sql(expr, dialect="mssql")` ile bağlantı olmadan da SQL üretilebilir. Backend'ler bağlantı, tip eşleme, tablo oluşturma ve Arrow/pandas sonucu döndürmeyi üstlenir.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör/Dosya | Sorumluluk |
|---|---|
| `ibis/expr/types/` | Kullanıcı API'si: `Table` (`relations.py`: `filter/group_by/aggregate/join/mutate`), `Column`, `Scalar`, `temporal.py`, `groupby.py`, `joins.py` |
| `ibis/expr/operations/` | Değişmez, tipli IR düğümleri (`relations.py`, `reductions.py`, `window.py`, `temporal.py`, `analytic.py`) |
| `ibis/expr/rewrites.py`, `ibis/backends/sql/rewrites.py` | IR→IR yeniden yazma kuralları (`sqlize`, `merge_select_select`, `extract_ctes`, `exclude_unsupported_window_frame_*`) |
| `ibis/backends/sql/compilers/base.py` | `SQLGlotCompiler`: `translate()` (L608) / `visit_node()` (L706) ile her `ops.X` → `sge.*` (sqlglot) |
| `ibis/backends/sql/compilers/{duckdb,mssql,postgres}.py` | Lehçe başına derleyici; `UNSUPPORTED_OPS` listesi, özel `visit_*` metotları |
| `ibis/backends/{duckdb,mssql}/__init__.py` | Bağlantı (`mssql` → `pyodbc`), şema okuma, veri alma |
| `ibis/expr/sql.py` | `ibis.to_sql()` (L464) – bağlantısız derleme |

Akış: `Python API → ops.* ağacı → rewrites → SQLGlotCompiler.visit_node → sqlglot AST → .sql(dialect)`.

## Floem BI için kritik kısımlar
- `ibis/backends/sql/compilers/base.py` → ops→sqlglot ziyaretçi (visitor) deseni → Floem ölçü derleyicisinin "IR→SQL AST" aşaması için okunacak en iyi referans (fonksiyon eşleme tabloları, window/aggregate üretimi).
- `ibis/backends/sql/compilers/mssql.py` (598 satır) → `UNSUPPORTED_OPS` içinde **`DateDiff`, `TimestampDiff`, `IntervalAdd/Subtract`, `Median`, `Mode`, `RegexReplace`** var. → Zaman zekâsı (SAMEPERIODLASTYEAR, DATEADD) için MSSQL backend'inde ibis tek başına yetmez; Floem'in kendi `DATEADD`/`DATEDIFF` üretimi gerekir.
- `ibis/backends/sql/compilers/duckdb.py` (717 satır) → DuckDB tarafı çok daha eksiksiz. → Import modu / Gold katmanı sorguları.
- `ibis/backends/sql/rewrites.py` (`merge_select_select`, `extract_ctes`, `sqlize`) → İç içe SELECT'leri birleştirme, ortak alt ağaçları CTE'ye çıkarma → Floem derleyicide CALCULATE alt sorgularının sadeleştirilmesi.
- `ibis/backends/mssql/__init__.py` → `pyodbc` ile MSSQL bağlantısı, tip eşleme (`sql/datatypes.py` `MSSQLType`) → Gateway ajanında kaynak şema keşfi için örnek.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Uygulanamaz (semantik katman yok). Ölçüler sadece Python ifadesi: `t.DocTotal.sum().name("Ciro")`. (Not: boring-semantic-layer projesi ibis üzerine semantik katman kurar — bkz. `boring-semantic-layer.md`.)

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
```python
t = ibis.table({"CardCode": "string", "DocTotal": "decimal(19,6)", "Year": "int32"}, name="fact_sales")
expr = t.filter(t.Year == 2026).group_by("CardCode").aggregate(Ciro=t.DocTotal.sum())
ibis.to_sql(expr, dialect="mssql"); ibis.to_sql(expr, dialect="duckdb")
```
Filtre → `ops.Filter`, boyut → `ops.Aggregate.groups`, ölçü → `ops.Aggregate.metrics`; `sqlize` ile SELECT düğümüne indirgenip sqlglot'a çevrilir.

## Alınacak fikirler
- Kendi IR'ımızı (ölçü/filtre bağlamı) tipli, değişmez düğümler + pattern tabanlı rewrite kuralları olarak tasarlamak.
- Lehçe başına `UNSUPPORTED_OPS` listesi → derleme zamanında "bu ölçü DirectQuery-MSSQL'de desteklenmez" uyarısı.
- Bağlantısız `to_sql` → derleyici testlerinde golden SQL snapshot'ları.

## Kaçınılacaklar / zayıf yönler
- DataFrame API'si DAX filtre bağlamını (CALCULATE, filtre yayılımı, ALL/REMOVEFILTERS) modellemez; ara katman olarak eklenirse iki IR (Floem IR + ibis ops) bakımı gerekir.
- MSSQL backend'i ikinci sınıf (çok sayıda unsupported op, tarih aritmetiği eksik).
- Ağır bağımlılık zinciri (pyarrow, pandas/polars opsiyonel, sqlglot sürüm aralığı) → sqlglot sürümünü ibis belirler, çakışma riski.
- Major sürümler arası API kırılmaları (12.0.0).

## Kullanım kararı: **Fikir al**
Derleyici hedef IR'ı olarak doğrudan sqlglot `exp` AST'si daha uygun; ibis'in `SQLGlotCompiler` ve rewrite desenleri referans alınmalı. (Opsiyonel: dahili veri hazırlama/Python dönüşümlerinde DuckDB üzerinde bağımlılık olarak kullanılabilir.)
