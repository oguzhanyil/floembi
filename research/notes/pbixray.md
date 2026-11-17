# pbixray
- URL: https://github.com/Hugoberry/pbixray
- Lisans: MIT (doğrulandı: kök `LICENSE`, "Copyright (c) 2024 Igor Cotruta"; `setup.py` → `license="MIT"`). `find . -iname "LICENSE*"` yalnızca kök `LICENSE` dosyasını döndürüyor, alt klasör lisansı yok. `docs/*.ksy` Kaitai şemaları kendi başlığında `license: CC0-1.0` taşıyor (kamu malı, sorun yok).
- Dil: Python (>=3.8). PyPI paketi `pbixray` 0.15.5
- Son commit tarihi: 2026-08-27

### Bağımlılık lisans zinciri (`setup.py` `install_requires`, PyPI metadata'sından kontrol edildi)
| Paket | Ne için | Lisans | Not |
|---|---|---|---|
| `xpress9` (Hugoberry/xpress9-python) | DataModel akışının XPress9 açılması | MIT | README'ye göre altta Microsoft'un Xpress9 C kütüphanesi var, "MIT License" diye belirtilmiş. C kaynağının kendi başlığı ayrıca kontrol edilmeli |
| `xpress8` (Hugoberry/xpress8-python) | ABF içindeki tekil dosyaların XPress8 açılması (`utils.get_data_slice`) | MIT | |
| `xmhuffman` (Hugoberry/xmhuffman-cython) | Sözlük sayfalarının Huffman çözümü | MIT | Cython native kernel |
| `kaitaistruct` | `.idf`, `.dictionary`, `.idfmeta` ikili parse runtime'ı | MIT | |
| `apsw` | Gömülü `metadata.sqlitedb`'yi bellekte `deserialize` etmek | "any-OSI" (zlib/libpng benzeri izin verici) | MIT/Apache/BSD listesinde **değil**; hukuki onay gerekir ya da stdlib `sqlite3.Connection.deserialize` (Py ≥3.11) ile değiştirilebilir |
| `numpy`, `pandas` | Dizi/DataFrame | BSD-3 | |

Sonuç: Bağımlılıklar arasında copyleft yok. Tek gri alan `apsw` (izin verici ama listede yok).

## Ne yapıyor (3-5 cümle)
`.pbix`, Power Pivot'lu `.xlsx` ve SSAS `.abf` dosyalarını Power BI veya Excel kurulu olmadan, salt okunur şekilde açan bir Python kütüphanesi. Zip zarfından `DataModel` akışını çıkarıyor, XPress9 ile açıyor, ABF (Analysis Services backup) dosya sistemini çözüyor. İçindeki `metadata.sqlitedb` üzerinden TOM metadata'sını (tablolar, kolonlar, ölçüler, ilişkiler, RLS/OLS, hiyerarşiler, calculation group'lar vb.) pandas DataFrame olarak döndürüyor. VertiPaq kolon dosyalarını (`.idf`, `.dictionary`, `.hidx`) çözerek tablo verisinin kendisini de okuyabiliyor. Ayrıca `DataMashup` (MS-QDEFF) içinden Power Query `Section1.m` kodunu çıkarıyor.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
```
pbixray/
  core.py               PBIXRay public API (tables, schema, dax_measures, relationships, power_query, get_table, ...)
  loader.py             DataModelLoader: zip/abf tespiti, XPress9 açma (tek/çok thread), on_disk mmap
  abf/                  ABF konteyner formatı: BackupLogHeader, VirtualDirectory, BackupLog → file_log
  meta/                 Metadata kaynakları: sqlite_source.py (PBIX, 1377 satır, ~50 TMSCHEMA sorgusu), xml_source.py (eski xlsx)
  xldm/                 Eski Excel Power Pivot (MS-XLDM XML) nesne modeli: cube, dimension, measure_group, mdx_script
  column_data/          Kaitai ile üretilmiş parser'lar: idf.py, dictionary.py, hidx.py, idfmeta.py
  vertipaq_decoder.py   RLE + bit-packed hibrit decode, sözlük eşleme, get_table/iter_table
  mashup/               qdeff.py (MS-QDEFF ikili akış), section_document.py (Section1.m → sorgu/parametre listesi)
  connections.py        Live/thin rapor "Connections" manifesti
docs/                   .ksy şemaları, TMSCHEMA_MAPPING.md (DMV ↔ SQLite sorgu eşlemesi)
```
Veri akışı:
1. `loader.py` → `zipfile` ile `DataModel` (pbix) veya `xl/model/item.data` (xlsx) üyesini bul; `DataMashup` ve `Connections` byte'larını ayrıca al.
2. `__detect_compression` → imzaya göre sıkıştırmasız / tek thread XPress9 / çok thread XPress9; `xpress9.Xpress9().decompress(...)` ile chunk chunk aç.
3. `abf/parser.py` → offset 72'den 4096 byte'lık `BackupLogHeader`, ardından `VirtualDirectory` (XML) ve `BackupLog` eşleştirilerek `file_log` (dosya adı → offset/size) oluşturulur.
4. `utils.get_data_slice(data_model, 'metadata.sqlitedb')` → ilgili byte aralığı (gerekirse XPress8 ile açılır) → `apsw.Connection(":memory:").deserialize("main", buf)`.
5. `SqliteMetadataSource` tembel (lazy) DataFrame'ler üretir; `VertiPaqDecoder` şema satırlarındaki `IDF`/`Dictionary`/`HIDX` dosya adlarıyla kolon verisini çözer.

## Floem BI için kritik kısımlar
- `pbixray/loader.py` → zip/abf tespiti, XPress9 çok thread açma, `on_disk` mmap → Floem BI geçiş aracının "PBIX içe aktar" adımının ilk katmanı.
- `pbixray/abf/parser.py` + `abf/backup_log*.py`, `virtual_directory.py` → ABF sanal dosya sistemi → Gerekirse kendi Rust/Go/Python ABF okuyucumuzun referansı.
- `pbixray/meta/sqlite_source.py` → TOM metadata'sını SQL ile okuma (`Measure`, `[Table]`, `Column`, `Relationship`, `Partition`, `Expression`, `TablePermission`, `Hierarchy`, `Level`, `CalculationItem`...) → Floem semantik modelinin (tablo, kolon, ölçü, ilişki, hiyerarşi, RLS) **eşleme kaynağı**.
- `__populate_relationships` → `FromCardinality/ToCardinality = 2 → 'M'`, `CrossFilteringBehavior 1=Single, 2=Both`, `IsActive` → Floem ilişki modelindeki kardinalite + filtre yönü + aktif/pasif alanları.
- `__populate_dax_measures` (`Measure.Expression`, `DisplayFolder`, `Description`), `__populate_dax_columns` (`Column.Type = 2` hesaplanmış kolon), `__populate_dax_tables` (`Partition.Type = 2` hesaplanmış tablo), `__populate_m` (`Partition.Type = 4` M bölümü) → Floem DAX parser'ına verilecek ham ifadeler + kaynak sorguları.
- `__populate_rls` / `ols_df` → Floem RLS rol tanımlarına geçiş.
- `pbixray/mashup/qdeff.py` + `section_document.py` → Power Query M kodu ve parametreleri → Floem kaynak/bağlayıcı tanımına (SQL Server, PostgreSQL, Excel) dönüştürme girdisi.
- `pbixray/vertipaq_decoder.py` → Import modundaki verinin kendisi → Kaynağa erişim yoksa, "PBIX içindeki snapshot'ı Bronze katmanına yükle" senaryosu.
- `docs/TMSCHEMA_MAPPING.md` → DMV ↔ SQLite tablo eşlemesi; TOM alan adlarının referans sözlüğü.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
pbixray kendi semantik modelini tanımlamıyor. Power BI'ın iç TOM şemasını (SQLite tabloları) olduğu gibi DataFrame'e düzleştiriyor. Ölçü sorgusu (`meta/sqlite_source.py`):
```sql
SELECT t.Name AS TableName, m.Name, m.Expression, m.DisplayFolder, m.Description
FROM Measure m JOIN [Table] t ON m.TableID = t.ID;
```
İlişki çıktısı kolonları: `FromTableName, FromColumnName, ToTableName, ToColumnName, IsActive, Cardinality ('M:1' vb.), CrossFilteringBehavior ('Single'/'Both'), FromKeyCount, ToKeyCount, RelyOnReferentialIntegrity`. Sistem tabloları `WHERE ft.SystemFlags = 0 AND tt.SystemFlags = 0` ile eleniyor.
Kolon tipi eşlemesi (`utils.py` `AMO_PANDAS_TYPE_MAPPING`): `2:string, 6:Int64, 8:Float64, 9:datetime, 10:Decimal, 11:bool, 17:bytes`.
Eski şema sürümleri için `_has_column` / `_rel_col` ile sütun adı farkları (`FromColumnID` ↔ `FromEndColumnID`) tolere ediliyor.

Floem geçiş aracı için hedef eşleme (öneri):
```
pbix.tables_df / columns_df       → floem.Table / floem.Column (dataType, isHidden, formatString, sortByColumn)
pbix.dax_measures                 → floem.Measure { table, name, expression (Floem DAX), folder, description }
pbix.relationships                → floem.Relationship { from, to, cardinality, crossFilter, isActive }
pbix.hierarchies_df / levels_df   → floem.Hierarchy
pbix.rls                          → floem.Role { table, filterExpression }
pbix.power_query / mashup_queries → floem.Source + dönüşüm adımları (M → SQL/Python; elle onay)
```

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
Yok. pbixray sorgu motoru değil, salt okuyucu. Ölçüleri değerlendirmiyor, DAX'ı parse etmiyor (yalnızca metin olarak döndürüyor). İçeride ürettiği tek SQL, gömülü `metadata.sqlitedb` üzerine metadata sorguları.

## Alınacak fikirler
- **Geçiş aracı akışı:** `PBIXRay(path)` → `tables/schema/dax_measures/relationships/rls/power_query` → Floem model JSON/YAML → her ölçü ifadesi Floem DAX parser'ından geçirilip uyumluluk raporu (desteklenen/desteklenmeyen fonksiyonlar).
- Metadata'yı ayrı servis olarak okumak (tembel `_lazy_populators` sözlüğü): model açılınca 40 sorgu çalışmıyor, istenen DataFrame ilk erişimde üretiliyor.
- Büyük dosyalar için `on_disk=True` + mmap ve STORED zip üyesini kopyasız okuma (`__map_stored_member`).
- `iter_table(chunk_size=...)` segment bazlı akış → Import verisini Bronze katmanına parça parça yazma.
- Live/thin rapor tespiti (`LiveConnectionError`, `connections.py`) → geçiş aracında "bu rapor modeli içermiyor, kaynak dataset'i iste" uyarısı.
- Şema sürümü toleransı (`_has_column`, `_col_or_null`) → eski PBIX'lerde kırılmayan okuyucu.

## Kaçınılacaklar / zayıf yönler
- **Rapor katmanını okumuyor:** `Report/Layout` (sayfalar, görseller, filtreler, bookmark'lar) parse edilmiyor (`grep Layout` sadece sözlük sayfa düzenini buluyor). Görsel geçişi için ayrı bir Layout JSON parser'ı gerekir (ör. `pbi_parsers` veya kendi kodumuz).
- **PBIP/TMDL/`.bim` desteği yok:** Yeni Power BI proje formatı (PBIP, TMDL) okunmuyor. Geçiş aracı TMDL'i ayrıca desteklemeli.
- Her şey pandas DataFrame; tipli bir nesne modeli (TOM benzeri) yok. Floem tarafında kendi tipli modelimize çevirmek gerekir.
- DAX ve M yalnızca ham metin; çözümleme/bağımlılık analizi yok.
- `apsw` lisansı MIT/Apache/BSD dışında; Python ≥3.11 `sqlite3.deserialize` ile değiştirilebilir.
- `xpress9` native C uzantısı: platform tekerleği (wheel) bağımlılığı; Microsoft Xpress9 C kaynağının lisans başlığı ayrıca teyit edilmeli.
- Ters mühendislik ürünü: Microsoft resmi olarak desteklemiyor, format değişikliklerinde kırılabilir. `data/` altında test için Microsoft örnek `.pbix`/`.abf` dosyaları var; bunları dağıtmayın.
- Salt okuma: PBIX yazamaz (geri dönüş/çift yönlü senkron mümkün değil, Floem için gerekli de değil).

## Kullanım kararı: Bağımlılık olarak kullan
Geçiş aracının (offline, sunucu tarafı Python servisi) "PBIX → Floem model" adımında `pbixray` doğrudan pip bağımlılığı olarak kullanılabilir (MIT, aktif bakım, son commit 2026-08-27). `apsw` için hukuki onay alınmalı ya da fork'ta stdlib `sqlite3` ile değiştirilmeli. Rapor/görsel katmanı ve TMDL için ek bileşen yazılmalı.
