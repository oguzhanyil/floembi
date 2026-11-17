# Boring Semantic Layer (BSL)
- URL: https://github.com/boringdata/boring-semantic-layer
- Lisans: MIT — **doğrulandı** (kök `LICENSE`: "MIT License, Copyright (c) 2025 boringdata"; `pyproject.toml` → `license = "MIT"`). `find -iname "LICENSE*"` yalnızca kök dosyayı buldu, alt lisans yok.
- Dil: Python (>=3.11). Çekirdek bağımlılıklar: `ibis-framework>=11,<12`, `attrs`, `pyyaml`, `returns`, `toolz`. Opsiyonel: `xorq` (Apache 2.0), FastAPI/uvicorn, fastmcp, Altair/Plotly.
- Son commit tarihi: 2026-11-11 (sürüm 0.3.19)

## Ne yapıyor (3-5 cümle)
BSL, Ibis tablo ifadelerinin üstüne ince bir semantik katman koyar: bir `ibis.Table`'ı `to_semantic_table()` ile sarar, ona isimli dimension ve measure'lar (Ibis deferred `_` ifadeleri veya lambda) ve `join_one` / `join_many` ilişkileri ekler. Sorgu (`group_by().aggregate()` zinciri veya parametreli `query(dimensions=, measures=, filters=, time_grain=, time_range=)`) bir semantik ilişkisel operatör ağacına dönüşür, bu ağaç `to_untagged()` ile saf Ibis ifadesine "lowering" edilir ve Ibis/sqlglot SQL'i üretir. Fan trap / chasm trap problemini `join_many` gördüğünde her fact tablosunu kendi grain'inde **pre-aggregate edip sonra join ederek** çözer (Malloy'dan farklı olarak symmetric aggregate kullanmaz). Ek olarak YAML model formatı, `t.all(...)` ile "percent of total", `compare_periods`, MCP / LLM ajan entegrasyonu ve basit grafik/dashboard katmanı var. README: "Freely inspired by Malloy ... just took the Python route."

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
`src/boring_semantic_layer/`
- `api.py`, `expr.py` (2.3k satır) — kullanıcıya dönük fluent API: `SemanticModel`, `SemanticTable`, `SemanticAggregate`; `.with_dimensions()`, `.with_measures()`, `.join_one/join_many()`, `.filter()`, `.group_by()`, `.aggregate()`, `.sql()`, `.execute()`.
- `ops/_core.py` (5.4k satır) — Ibis `Relation` alt sınıfı olan semantik operatörler: `SemanticTableOp`, `SemanticFilterOp`, `SemanticProjectOp`, `SemanticGroupByOp`, `SemanticJoinOp`, `SemanticAggregateOp`; aggregation planı (`_build_aggregation_plan`, `_compile_aggregation`), join ağacı analizi (`_collect_join_tree_info`), filtre sahipliği / deferrable join tespiti.
- `ops/_compile_preagg.py` (1.5k satır) — fan-out güvenli derleme stratejisi: `to_untagged_with_preagg()`.
- `ops/_compile_nest.py`, `nested_compile.py`, `nested_access.py` — Malloy tarzı `nest` (iç içe sonuç) desteği.
- `calc_analyzer.py`, `calc_compiler.py` — ölçü üstüne ölçü (calculated measure) sınıflandırma ve derleme; `t.all()` ile toplam bağlamı (DAX `ALL` benzeri).
- `query.py` + `predicate.py` — parametreli sorgu arayüzü, JSON filtre AST'si (`Compare`, AND/OR), time grain (`TIME_GRAIN_*` → Ibis `truncate`), `time_range`, `having`, `compare_periods`.
- `yaml.py`, `serialization/` — YAML model yükleme ve xorq tag tabanlı serileştirme/round-trip.
- `server/api.py` (FastAPI), `agents/` (LangChain/MCP ajanları), `chart/` (Altair, Plotly, ECharts, markdown dashboard).
- `_xorq.py` — xorq'un vendored Ibis'i varsa onu, yoksa düz `ibis`'i kullanan shim.

Veri akışı:
```
ibis.Table ──to_semantic_table──▶ SemanticTableOp(dims, measures, calc_measures)
   └─ join_one/join_many ─▶ SemanticJoinOp ─ filter ─▶ SemanticFilterOp
      └─ group_by().aggregate() ─▶ SemanticAggregateOp
          └─ to_untagged(): join_many varsa to_untagged_with_preagg(), yoksa düz aggregate
              └─ ibis.Expr ─▶ ibis.to_sql(expr, dialect=...) (sqlglot) ─▶ SQL / execute()
```

## Floem BI için kritik kısımlar
- `src/boring_semantic_layer/ops/_compile_preagg.py` → `to_untagged_with_preagg()`: `_build_scope` → `_resolve_filter_ownership` (filtre hangi tabloya ait) → `_split_cross_table_legs` → `_partition_by_source` → `_preaggregate_sources` (her kaynağı kendi grain'inde toplar; AVG'yi `sum/count`'a ayrıştırır = `decomposed_means`, COUNT DISTINCT'i ertelenmiş ele alır) → `_combine_preaggregates` (boyut köprüsü ile join) → `_apply_calc_phase` → Floem BI'da **fan-out / çoklu fact tablosu** derleme stratejisinin (Power BI'daki "her tablo kendi ilişkisinden filtrelenir, sonra birleşir" davranışının) referansı.
- `ops/_core.py` `_collect_join_tree_info` / `_JoinTreeInfo` → join ağacındaki kardinaliteyi (`one`/`many`) miras alarak yürür → Floem BI ilişki grafiği (kardinalite + filtre yönü) analizörü.
- `calc_compiler.py` `all()` (satır ~284) ve `attach_calc_totals` / `_join_totals` → toplam bağlamında ölçüyü ayrı bir aggregate olarak hesaplayıp sonuca join eder → DAX `ALL()` / `CALCULATE(..., ALL(...))` derlemesinin basit bir örneği.
- `predicate.py` → JSON filtre AST'si (`{"field","operator","value"}`, `AND/OR` `conditions`) tek bir derleyiciyle pre-agg (WHERE) ve post-agg (HAVING) için kullanılıyor; `query._split_filter` ölçü referanslı filtreyi otomatik HAVING'e taşıyor → Floem BI slicer/visual-filter JSON'unun IR'ı.
- `query.py` `TIME_GRAIN_TRANSFORMATIONS`, `_validate_time_grain` (`smallest_time_grain` kontrolü), `_build_time_range_filters`, `compare_periods` → zaman boyutu, tarih hiyerarşisi drill ve "önceki dönem" karşılaştırması.
- `examples/flights.yml` → YAML semantik model şeması → Floem BI model dosya formatına fikir.
- `examples/fan_and_chasm_traps.py` → fan/chasm trap için hazır test senaryosu (müşteri/sipariş/destek talebi) → Floem BI derleyici regresyon testlerine birebir alınabilecek vaka.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Python:
```python
customers_st = (to_semantic_table(customers_tbl, name="customers")
    .with_dimensions(customer_id=lambda t: t.customer_id, region=lambda t: t.region)
    .with_measures(total_ltv=lambda t: t.lifetime_value.sum(), customer_count=lambda t: t.count()))
orders_st = (to_semantic_table(orders_tbl, name="orders")
    .with_dimensions(customer_id=lambda t: t.customer_id)
    .with_measures(order_count=lambda t: t.count(), total_order_amount=lambda t: t.amount.sum()))
customer_orders = customers_st.join_many(orders_st, on="customer_id")
customer_orders.group_by("customers.region").aggregate(
    "customers.total_ltv", "orders.order_count").execute()
```
Calculated measure (ölçü üstüne ölçü + toplam bağlamı):
```python
.with_measures(market_share=lambda t: t.flight_count / t.all(t.flight_count) * 100)
```
YAML (`examples/flights.yml`):
```yaml
flights:
  table: flights_tbl
  dimensions:
    origin: { expr: _.origin, description: "Origin airport code" }
    arr_time: { expr: _.arr_time, is_time_dimension: true, smallest_time_grain: "TIME_GRAIN_DAY" }
  measures:
    flight_count: { expr: _.count(), description: "Total number of flights" }
  joins:
    carriers: { model: carriers, type: one, left_on: carrier, right_on: code }
```
İçeride: `SemanticTableOp(table, dimensions: FrozenDict[str, Dimension], measures: FrozenDict[str, Measure], calc_measures, name, description)` — yani model = Ibis tablo + isim→Ibis-ifade sözlükleri. Ölçüler `base` (tek aggregate) ve `calc` (başka ölçülere başvuran) olarak `_classify_measure` tarafından **analizle** ayrılıyor (ADR 0001). YAML'de `t.all()` desteklenmiyor (dosyadaki not), self-join henüz yok ("Self-joins ... not yet supported").

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
1. `query(st, dimensions=[...], measures=[...], filters=[{"field":"country","operator":"=","value":"US"}], time_grain="TIME_GRAIN_MONTH", time_range={...})`.
2. Filtreler `Filter.to_callable()` ile `predicate.from_dict` → `predicate.compile` (Ibis boolean ifadesi). Ölçüye başvuran dict filtreler `_split_filter` ile HAVING'e ayrılır. String filtreler `safe_eval` ile `_.carrier == 'AA'` gibi Ibis deferred ifadesine çevrilir.
3. Zaman boyutları `TIME_GRAIN_TRANSFORMATIONS` ile `truncate("M")` vb. mutate edilir; `time_range` WHERE'e eklenir.
4. `SemanticFilterOp → SemanticGroupByOp → SemanticAggregateOp` ağacı kurulur.
5. `SemanticAggregateOp.to_untagged()`: join ağacında `many` kardinalite varsa `to_untagged_with_preagg()` (her kaynak tablo kendi grain + gruplama anahtarlarında toplanır, sonra boyut köprüsüyle join edilir, AVG = SUM/COUNT yeniden birleştirilir); yoksa tek `aggregate`.
6. `calc` ölçüleri sonuç üzerinde `apply_calc_measures` ile hesaplanır; `t.all()` için ayrı totals aggregate'i join edilir veya pencere fonksiyonu kullanılır.
7. `expr.sql()` → `ibis.to_sql(...)` (sqlglot) — lehçe Ibis backend'inden gelir.

## Alınacak fikirler
- **Ibis'i IR olarak değerlendirme sonucu:** Ibis (Apache 2.0) DuckDB ve MSSQL backend'lerine sahip ve sqlglot üzerinden `tsql` üretebiliyor; BSL kendi kodunda MSSQL'i hiç test etmiyor (`grep mssql|tsql` → 0 sonuç). Ibis, Floem BI için **son aşama (relational IR → SQL)** olarak uygun; ancak DAX benzeri dilin filtre bağlamı, CALCULATE, context transition gibi semantiklerini Ibis taşıyamaz. Öneri: Floem BI'nın **kendi semantik IR'ı** (ölçü ağacı + filtre bağlamı) olsun, planlayıcı bunu ilişkisel plana indirsin, son adımda Ibis veya doğrudan sqlglot kullanılsın. Sadece SQL üretimi gerekiyorsa sqlglot (MIT) Ibis'ten daha ince ve kontrol edilebilir bir seçenek.
- Fan-out çözümü olarak **source-grain pre-aggregation**: SQL Server'da HASHBYTES tabanlı symmetric aggregate'lerden daha okunur ve indeks dostu SQL üretir; Power BI'ın çoklu fact davranışına daha yakın.
- AVG'nin `sum/count` olarak ayrıştırılıp yeniden birleştirilmesi (`decomposed_means`) ve COUNT DISTINCT'in ayrı ele alınması — toplanamaz (non-additive) ölçüler için kural seti.
- Ölçü sınıflandırmasını AST etiketiyle değil **analizle** yapmak (ADR 0001): `base` vs `calc` ölçü otomatik tespit.
- Tek filtre AST'sinin hem WHERE hem HAVING için derlenmesi; ölçüye başvuran filtrenin otomatik HAVING'e taşınması.
- `smallest_time_grain` metadata'sı ile drill-down sınırı; `compare_periods` çıktısı (current/previous/delta kolonları) — zaman zekâsı için basit başlangıç.
- `examples/fan_and_chasm_traps.py` senaryolarının derleyici test paketine alınması.

## Kaçınılacaklar / zayıf yönler
- Ibis'in iç yapısına derin bağımlılık: `pyproject.toml`'da `ibis-framework>=11.0.0,<12  # deep Relation/Deferred internals coupling`. Ibis majör sürümleri kırıcı; Floem BI'nın çekirdeğini buna bağlamak bakım riski.
- `ops/_core.py` 5.4k, `_compile_preagg.py` 1.5k satır, dosya başında "Extracted verbatim ... Decomposing the pipeline body ... is the follow-up" notu — derleyici büyük ve tek parça; okunması/genişletilmesi zor.
- Ölçü dili = Python lambda / Ibis ifadesi. Son kullanıcıya açılan bir DAX benzeri dil için uygun değil; string ifadeler `safe_eval` ile değerlendiriliyor (çok kiracılı ortamda saldırı yüzeyi).
- DAX tarzı filtre bağlamı, CALCULATE, filtre yönü (bi-directional), RLS, YTD/SAMEPERIODLASTYEAR gibi zaman zekâsı yok; `compare_periods` ve post-aggregate window fonksiyonları ile sınırlı.
- Self-join (rol oynayan boyut, ör. sipariş tarihi/teslim tarihi aynı Tarih tablosu) desteklenmiyor — Power BI'daki inactive relationship / USERELATIONSHIP senaryosu için eksik.
- xorq / vendored Ibis ikiliği (`_xorq.py`, `query._get_ibis_api`) karmaşıklık ve "flavor karışınca sessizce yanlış predicate" riski (kod yorumu açıkça belirtiyor).
- Proje 0.3.x; API hâlâ değişiyor (ADR'de `.mutate()` davranışı 2026-08'de kırıldı).

## Kullanım kararı: Fikir al
Bağımlılık olarak kullanılmamalı (Ibis iç yapısına sıkı bağlı, 0.x API, son kullanıcı dili için uygun değil). Fork gereksiz. Pre-aggregation fan-out stratejisi, filtre AST'si (WHERE/HAVING ayrımı), ölçü sınıflandırması ve test senaryoları fikir/referans olarak alınmalı. Ibis'in kendisi (Apache 2.0) Floem BI'da SQL üretim arka ucu olarak **opsiyonel** değerlendirilebilir; ama semantik IR Floem BI'ya ait olmalı ve T-SQL çıktısı ayrıca doğrulanmalı (sqlglot `tsql` doğrudan kullanımı daha hafif alternatif).
