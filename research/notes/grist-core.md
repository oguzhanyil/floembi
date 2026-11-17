# grist-core
- URL: https://github.com/gristlabs/grist-core
- Lisans: Apache 2.0, **doğrulandı** (kök `LICENSE.txt`, `package.json` → `"license": "Apache-2.0"`, `NOTICE.txt` "Copyright 2014-2022 Grist Labs Inc." — Apache 2.0 gereği türev çalışmada NOTICE korunmalı). Alt lisanslar:
  - `static/icons/locales/LICENSE` → MIT (Yummygum flagpack bayrak ikonları) — uygun.
  - `ee/` / `enterprise/` klasörü yok (ticari "Grist Enterprise" ayrı repoda; bu repo saf core).
- Dil: Python (formül/veri motoru, `sandbox/grist/`), TypeScript (Node.js sunucu + istemci, `app/`), depolama: belge başına SQLite
- Son commit tarihi: 2026-11-16

## Ne yapıyor (3-5 cümle)
Grist, ilişkisel veritabanı ile hesap tablosunu birleştiren bir "formüllü tablo" ürünüdür: her belge bir SQLite dosyasıdır, tablolar tipli sütunlardan oluşur ve sütunlar ya veri ya da **Python formülü** olabilir. Formüller Python koduna derlenip sandbox (gVisor / pyodide) içinde çalışan bir veri motorunda (`sandbox/grist/engine.py`) değerlendirilir; motor, formül çalışırken hangi hücrelere eriştiğini kaydederek **dinamik bağımlılık grafiği** kurar ve yalnızca kirlenen hücreleri yeniden hesaplar. `Ref:Tablo` / `RefList:Tablo` sütunları ilişki (foreign key) rolü görür; `$Musteri.Sehir` gibi zincirleme erişim ve `Tablo.lookupRecords(...)` ile ters ilişki sorguları yapılır. "Summary table" mekanizması group-by + `SUM($group.X)` ile ölçüye benzer toplu hesaplar üretir. Erişim kuralları (ACL), `user.Email == rec.Owner` gibi Python benzeri predicate formülleriyle satır/sütun düzeyinde izin verir.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör / dosya | Sorumluluk |
|---|---|
| `sandbox/grist/engine.py` | Veri motoru: tablo yükleme, `recompute_map`, `_update_loop`, `_recompute_step`, `_recompute_one_cell`, user action uygulama |
| `sandbox/grist/depend.py` | Bağımlılık grafiği: `Node(table_id, col_id)`, `Edge(out_node, in_node, relation)`, `Graph.invalidate_deps`, `ALL_ROWS` |
| `sandbox/grist/relation.py` | Satır eşlemesi: `IdentityRelation`, `ReferenceRelation` (ters indeks), `ComposedRelation` |
| `sandbox/grist/codebuilder.py` | Formül metni → Python fonksiyon gövdesi (`$x` → `rec.x`, otomatik `return`, `IF` gibi tembel argümanlar, astroid ile tip çıkarımı) |
| `sandbox/grist/gencode.py` | Tüm şemadan `@grist.UserTable class Tablo:` modülü üretir, formül önbelleği |
| `sandbox/grist/records.py`, `table.py` | `Record` / `RecordSet`; attribute erişimi `engine._use_node`'u çağırarak bağımlılık kaydeder |
| `sandbox/grist/column.py`, `usertypes.py` | Sütun tipleri; `ReferenceColumn`, `ReferenceListColumn` |
| `sandbox/grist/lookup.py`, `lookupset.py` | `lookupRecords/lookupOne` için `#lookup#Kolon` yardımcı indeks sütunları |
| `sandbox/grist/summary.py` | Summary table (group-by) üretimi; `Tablo_summary_Kolon1_Kolon2` |
| `sandbox/grist/functions/` | Excel benzeri fonksiyon kütüphanesi (`math.py`, `date.py`, `stats.py`, `lookup.py`, `text.py` ...) |
| `sandbox/grist/predicate_formula.py`, `acl.py` | ACL/dropdown predicate formüllerini JSON AST'ye çevirme |
| `app/common/PredicateFormula.ts` | AST → JS closure derleyicisi (`compilePredicateFormula`) |
| `app/common/ACLPermissions.ts`, `GranularAccessClause.ts`, `ACLRuleCollection.ts` | İzin bitleri (CRUDS), `RuleSet`/`RulePart`/`UserAttributeRule` |
| `app/server/lib/GranularAccess.ts` | Kuralların çalışma anında uygulanması: `filterData`, `_filterRowsAndCells`, `filterOutgoingDocActions` |
| `app/server/lib/ExpandedQuery.ts` | Basit referans formüllerini (`$ref.col`) SQL JOIN'e çevirerek SQLite'ta hesaplama |
| `app/server/lib/NSandbox.ts` | Python motorunu gVisor / pyodide / docker / unsandboxed çalıştırma |
| `app/server/lib/ActiveDoc.ts`, `DocStorage.ts` | Açık belge yaşam döngüsü, SQLite kalıcılığı |

Veri akışı (bir hücre değiştiğinde):
```
İstemci UserAction (UpdateRecord) → ActiveDoc → GranularAccess (yazma izni kontrolü)
  → NSandbox → engine.apply_user_actions()
      → doc_action uygula → dep_graph.invalidate_deps(node, rows, recompute_map)   # kirlenen hücreler
      → _bring_all_up_to_date() → _update_loop(work_items)
           → _recompute_step(node) → her satır için _recompute_one_cell()
                → col.method(rec, table)   # formül fonksiyonu
                     → rec.X erişimi → table._get_col_obj_value → engine._use_node()
                          → dep_graph.add_edge(current_node, node, relation)  # bağımlılık kaydı
                          → node kirliyse önce onu hesapla (gerekirse OrderError ile yeniden sırala)
      → hesaplanan değerler BulkUpdateRecord "calc" action olarak döner
  → DocStorage (SQLite'a yaz) → GranularAccess.filterOutgoingDocActions (kullanıcıya göre filtrele) → istemciler
```

## Floem BI için kritik kısımlar
- `sandbox/grist/depend.py` → Sütun düzeyinde düğüm, ilişki etiketli kenar, iteratif (özyinelemesiz) `invalidate_deps`; `ALL_ROWS` ile tüm sütunu geçersiz kılma ve bu durumda o sütunun bağımlılıklarını sıfırlayıp yeniden keşfetme → Floem BI'da **hesaplanmış sütun (calculated column) yeniden hesaplama** ve model yenilemede hangi tabloların/sütunların yeniden işleneceğini belirleyen grafik. Ninja build sisteminden esinlenmiş (dosyada not var).
- `sandbox/grist/relation.py` → `ReferenceRelation.get_affected_rows`: hedef tablodaki değişen satırlardan, onlara referans veren satırlara ters indeks (`inverse_map`, tembel kurulur); `ComposedRelation` zincirleme `$a.b.c` için kompozisyon → Floem BI'da **RELATED() tarzı hesaplanmış sütunların** ilişki üzerinden artımlı geçersiz kılınması; ilişki yolunun (Person→School→Address) temsil edilmesi.
- `sandbox/grist/engine.py::_use_node` → bağımlılıkların **statik analizle değil çalışma anında erişim izlenerek** kaydedilmesi (formül hangi hücreye dokunduysa o kenar eklenir) → Floem BI'da Import modunda satır bazlı hesaplanmış sütunlar için bir seçenek; ancak SQL'e derlenecek ölçüler için statik analiz (AST'den sütun referanslarını çıkarma) gerekir.
- `sandbox/grist/engine.py::_update_loop` + `OrderError` → hesaplama sırası topolojik sıralama ile önceden bulunmaz; değerlendirme sırasında henüz hesaplanmamış bir bağımlılıkla karşılaşılırsa `OrderError` atılır, iş yığına geri konur, bağımlılık önce hesaplanır; `_locked_cells` ile döngü (`CircularRefError`) tespiti → Floem BI'da döngüsel hesaplanmış sütun/ölçü tespiti ve hata mesajı.
- `sandbox/grist/engine.py::_recompute_one_cell` → formül hatası tüm sütunu düşürmez; hücre değeri `objtypes.RaisedException` olur (Power BI'daki "Error" hücresi gibi), yan etkiler `_undo_to_checkpoint` ile geri alınır → Floem BI'da hücre/satır düzeyinde hata temsili.
- `sandbox/grist/codebuilder.py` + `gencode.py` → formül metni (`$Fiyat * $Adet`) Python fonksiyonuna dönüştürülür:
  ```python
  @grist.UserTable
  class Satis:
    Fiyat = grist.Numeric()
    Musteri = grist.Reference('Musteriler')
    @grist.formulaType(grist.Numeric())
    def Tutar(rec, table):
      return rec.Fiyat * rec.Adet
  ```
  Formül önbelleği anahtarı `(table_id, col_id, formula)` → Floem BI'da ölçü/hesaplanmış sütun derleme önbelleği; `LAZY_ARG_FUNCTIONS` (IF, IFERROR argümanlarını lambda'ya sarma) DAX `IF`/`IFERROR` tembel değerlendirmesi için doğrudan fikir.
- `sandbox/grist/column.py::ReferenceColumn` + `usertypes.py` (`Ref:Tablo`, `RefList:Tablo`, `reverse_of=`) → ilişki sütun tipinin kendisi; `0` = boş referans (tüm tablolarda 0. satır varsayılan kayıt) → Floem BI semantik modelinde ilişkiler ayrı nesne (TOM Relationship gibi) olmalı; Grist'in "ilişki = sütun tipi" yaklaşımı fikir olarak not edilmeli ama birebir alınmamalı.
- `sandbox/grist/lookup.py` → `lookupRecords(Email=$Email)` için hedef tabloda `#lookup#Email` gizli indeks sütunu; değişince yalnızca etkilenen anahtarları geçersiz kılar → Floem BI'da `LOOKUPVALUE` / `RELATEDTABLE` karşılığı ve artımlı indeks fikri.
- `sandbox/grist/summary.py` → group-by sütunlarından `Satis_summary_Bolge_Yil` tablosu üretir, sayısal sütunlar için varsayılan formül `SUM($group.Tutar)`; `$group` kaynak satırların `RecordSet`'i → Floem BI'da **ölçü + boyut → toplu sonuç** kavramının en yakın karşılığı (ama bellek içi, SQL'e derlenmiyor).
- `app/common/ACLPermissions.ts` + `GranularAccessClause.ts` → izinler `+CRUDS/-CRUDS` metni; `RuleSet {tableId, colIds: '*'|string[], body: RulePart[]}`, `RulePart {aclFormula, permissions, memo}`; sıralı kural listesi, ilk eşleşen kazanır, son eleman boş formüllü varsayılan → Floem BI **RLS/OLS rol tanımı** için doğrudan model.
- `UserAttributeRule {name, tableId, lookupColId, charId}` → kullanıcının e-postası ile bir tabloda (ör. `Personel`) lookup yapıp `user.Personel.Bolge` gibi öznitelikler türetme → Floem BI'da RLS için **kullanıcı öznitelik tablosu** (Power BI'daki `USERPRINCIPALNAME()` + eşleme tablosu kalıbı).
- `sandbox/grist/predicate_formula.py` → `app/common/PredicateFormula.ts::compilePredicateFormula` → kısıtlı Python ifade alt kümesi (And/Or/Eq/In/Attr/Const...) JSON AST'ye çevrilir, Node tarafında JS closure'a derlenir; Python sandbox'ına gerek kalmadan hızlı değerlendirme → Floem BI'da RLS filtre ifadesinin AST'si; Floem BI'da bu AST JS closure yerine **SQL WHERE** parçasına derlenmeli.
- `app/server/lib/GranularAccess.ts::filterData` → tablo izni `"mixed"` ise satır satır kural değerlendirip satır siler, sütun izni `deny` ise sütunu atar; `TablePermissionValue = "allow"|"deny"|"mixed"|"mixedColumns"` ile satır değerlendirmesi gerekip gerekmediğini önceden anlar → Floem BI'da RLS'in gerekli olup olmadığını önceden belirleyip gereksiz filtre eklememe optimizasyonu.
- `app/server/lib/ExpandedQuery.ts` → basit `$ref.col` formüllerini SQL `LEFT JOIN` + `SELECT`'e çevirip SQLite'ta hesaplama ("on-demand formulas") → Floem BI'nın asıl ihtiyacı olan **formül → SQL derlemesinin** Grist'teki tek (ve sınırlı) örneği.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Ayrı bir semantik model yok; model belgenin meta tablolarıdır (SQLite içinde):
- `_grist_Tables` (tableId, summarySourceTable ...), `_grist_Tables_column` (colId, type, isFormula, formula, widgetOptions, reverseCol ...), `_grist_ACLRules`, `_grist_ACLResources`.
- `gencode.py` belgesindeki şema:
  ```
  <table_info>  = {"tableId": <string>, "columns": [<column_info>]}
  <column_info> = {"id": <string>, "type": "Numeric|Text|Date|Ref:Musteriler|RefList:Urunler|Any...",
                   "isFormula": <bool>, "formula": "<python>"}
  ```
- Ölçü kavramı yok; en yakını summary table formül sütunu:
  ```
  tableId: Satis_summary_Bolge
  columns: Bolge (Text, group-by), group (RefList:Satis, formula "table.getSummarySourceGroup(rec)"),
           count (formula "len($group)"), Tutar (formula "SUM($group.Tutar)")
  ```
  Yani "ölçü" sabit bir group-by tablosuna bağlı bir sütundur; Power BI'daki gibi filtre bağlamına göre dinamik değerlendirilmez.
- ACL kural örneği (UI'da girilen, `_grist_ACLRules`'ta saklanan):
  ```
  resource: Satis, colIds: *
  aclFormula: "user.Access != OWNER and rec.Bolge != user.Personel.Bolge"   permissions: "-R"
  aclFormula: ""                                                             permissions: "+R"
  ```

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Genel olarak SQL üretilmiyor: tüm belge Python motorunun belleğine yüklenir, formüller satır satır Python'da hesaplanır ve sonuç değerleri SQLite'a "calc" olarak yazılır. Filtre/sıralama istemci tarafında yapılır. İki istisna:
1. `app/server/lib/ExpandedQuery.ts::expandQuery` — `ServerQuery {tableId, filters, where, limit}` + yalnızca `$ref.col` biçimindeki formüller için `LEFT JOIN` ve `SELECT` ifadeleri üretir (hedef sütun formül olamaz, filtreli sütun formül olamaz).
2. ACL predicate formülleri SQL'e değil JS closure'a derlenir; satır filtresi SQLite'tan veri çekildikten sonra bellekte uygulanır.

Bu nedenle "ölçü + boyut + filtre → SQL" akışı için Grist referans değildir (bu konuda MetricFlow/Cube/Rill notlarına bakılmalı).

## Alınacak fikirler
1. **Sütun düzeyinde bağımlılık grafiği + ilişki etiketli kenarlar** (`depend.py`, `relation.py`): Import modunda hesaplanmış sütunların artımlı yeniden hesaplanması; yenilemede sadece etkilenen tabloların işlenmesi. `ReferenceRelation` ters indeksinin tembel kurulması iyi bir bellek optimizasyonu.
2. **`ALL_ROWS` vs satır kümesi** ayrımı: şema değişikliğinde tam yeniden hesaplama + bağımlılıkları sıfırlama, veri değişikliğinde satır bazlı artımlı hesaplama.
3. **Döngü tespiti ve hesaplama sırası**: `OrderError` + `_locked_cells` + "ilerleme yoksa hata" koruması; Floem BI'da ölçü/hesaplanmış sütun bağımlılık döngüsü için anlamlı hata mesajı.
4. **Hücre düzeyinde hata değeri** (`RaisedException`) — bir satırdaki hata tüm sütunu/raporu düşürmesin.
5. **Formül derleme önbelleği** `(table, col, formula)` anahtarıyla; **tembel argümanlı fonksiyonlar** (`IF`, `IFERROR`) listesi.
6. **ACL modeli**: kaynak (tablo + sütun listesi) → sıralı kural parçaları → `+CRUDS/-CRUDS`; ilk eşleşen kazanır; **user attribute lookup tablosu**; `allow/deny/mixed/mixedColumns` ile ön değerlendirme. Floem BI RLS/OLS tasarımına doğrudan uyarlanabilir, sadece hedef SQL WHERE olmalı.
7. **Kısıtlı ifade dili + JSON AST** (`predicate_formula.py` → `PredicateFormula.ts`): güvenlik kuralları için tam programlama dili yerine küçük, analiz edilebilir bir alt küme; yeniden adlandırmada (`acl_renames`) kural ifadelerinin otomatik güncellenmesi (`NamedEntity` konumları).
8. **Yeniden adlandırma dayanıklılığı**: formül ve ACL ifadelerinde tablo/sütun yeniden adlandırıldığında metnin otomatik güncellenmesi (`relabeling.py`, `test_acl_renames.py`) — Floem BI ölçü editöründe zorunlu özellik.
9. Excel benzeri fonksiyon kütüphanesi (`sandbox/grist/functions/`) — fonksiyon adları/semantiği ve docstring tabanlı dokümantasyon/otomatik tamamlama fikri.

## Kaçınılacaklar / zayıf yönler
- **Tüm belge bellekte, satır satır Python değerlendirmesi**: Grist belgeleri pratikte yüz binlerce satırla sınırlı. Floem BI'nın SAP B1/SQL Server hacimleri için bu motor kullanılamaz; ölçüler SQL/DuckDB'ye derlenmeli.
- **Ölçüler filtre bağlamına duyarlı değil**: summary table sabit group-by; CALCULATE / filtre bağlamı / zaman zekâsı karşılığı yok.
- **Rastgele Python formülü** güçlü ama SQL'e derlenemez ve güvenlik için sandbox (gVisor/pyodide, `NSandbox.ts`) gerektirir; işletim karmaşıklığı yüksek. Floem BI kendi DSL'ini (DAX benzeri) kullanmalı.
- **Çalışma anında bağımlılık keşfi**: koşullu dallarda erişilmeyen sütunlar bağımlılık olarak kaydedilmez, değerlendirme yapılmadan grafik bilinmez; SQL derleme için statik analiz şart.
- **İlişki = sütun tipi** (`Ref:Tablo`, satır id'sine işaret eder): kardinalite, filtre yönü, iş anahtarı üzerinden join kavramları yok; dış kaynaklardaki doğal anahtarlarla (ör. SAP B1 `CardCode`) çalışmaya uygun değil.
- ACL satır filtresi veri çekildikten sonra bellekte uygulanıyor (`_filterRowsAndCells`); DirectQuery'de kaynağa itilmesi gereken RLS için bu yaklaşım yanlış.
- `GranularAccess.ts` 3.5k satır, çok karmaşık; doğrudan port edilmemeli, sadece kavramsal model alınmalı.
- Python/TS iki dilli kod tabanı; motor tek başına kütüphane olarak paketlenmemiş (`sandbox/grist` modülleri birbirini düz import ile kullanıyor).

## Kullanım kararı: Fikir al
Apache 2.0 olduğu için kod uyarlaması hukuken mümkün (NOTICE korunarak); `depend.py` + `relation.py` (~320 satır, saf Python, tek dış bağımlılık `sortedcontainers` — Apache 2.0) Import modu hesaplanmış sütun motoru için uyarlanabilecek tek somut parça. Ancak Grist'in bellek içi, satır bazlı Python formül motoru Floem BI'nın SQL'e derlenen ölçü mimarisine uymuyor; bağımlılık grafiği tasarımı, hata/döngü yönetimi ve ACL kural modeli (user attribute + sıralı kural + CRUDS) fikir olarak alınmalı.
