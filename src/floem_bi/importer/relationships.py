"""İlişkileri otomatik algılama (Power BI'daki "İlişkileri otomatik algıla").

1. Kaynaktaki yabancı anahtarlar (tek sütunlu olanlar).
2. Ad eşleşmesi: A[CardCode] → B[CardCode]; B tarafındaki sütun B'nin tek sütunlu birincil
   anahtarı olmalı (anahtar bilgisi yoksa verideki benzersizlikle karar verilir).
   SAP B1'de yabancı anahtar tanımlı olmadığından asıl iş bu adımda yapılır.
3. Etkin ilişkiler döngü (belirsiz filtre yolu) oluşturmamalı; oluşturan ilişki pasif eklenir.
"""

from __future__ import annotations

from dataclasses import dataclass

import duckdb

from ..connectors import ForeignKey
from ..model.schema import Iliski, ModelTanimi, Sutun, Tablo
from ..model.semantic import find_ambiguity
from .loader import qident
from .types import tip_family

DATA_SCHEMA = "veri"


@dataclass
class Suggestion:
    iliski: Iliski
    neden: str            # "yabancı anahtar" | "ad eşleşmesi"


def ref(t: Tablo, c: Sutun) -> str:
    # Model adlarında ' [ ] bulunmaz (içe aktarımda ve yeniden adlandırmada temizlenir)
    return f"{t.ad}[{c.ad}]"


def _phys(c: Sutun) -> str:
    return c.kaynak or c.ad


class _Profile:
    def __init__(self, cur: duckdb.DuckDBPyConnection, tanim: ModelTanimi):
        self.cur = cur
        self.tables = {t.ad.lower(): t for t in tanim.tablolar}
        self._rows: dict[str, int] = {}
        self._unique: dict[tuple[str, str], bool] = {}

    def rows(self, t: Tablo) -> int:
        if t.ad not in self._rows:
            self._rows[t.ad] = self.cur.execute(
                f"SELECT count(*) FROM {qident(DATA_SCHEMA)}.{qident(t.kaynak.tablo)}"
            ).fetchone()[0]
        return self._rows[t.ad]

    def unique_non_null(self, t: Tablo, c: Sutun) -> bool:
        k = (t.ad, c.ad)
        if k not in self._unique:
            n, d, nn = self.cur.execute(
                f"SELECT count(*), count(DISTINCT {qident(_phys(c))}), count({qident(_phys(c))}) "
                f"FROM {qident(DATA_SCHEMA)}.{qident(t.kaynak.tablo)}"
            ).fetchone()
            self._unique[k] = n > 1 and d == n and nn == n
        return self._unique[k]

    def one_side_columns(self, t: Tablo) -> list[Sutun]:
        keys = [c for c in t.sutunlar if c.anahtar]
        if keys:
            return keys if len(keys) == 1 else []      # birleşik anahtar "bir" tarafı olamaz
        # Anahtar bilgisi yok (görünüm ya da SQL sorgusu): verideki benzersizliğe bak
        return [
            c for c in t.sutunlar
            if not c.gizli and tip_family(c.tip) in ("num", "string") and self.unique_non_null(t, c)
        ]


def detect(
    cur: duckdb.DuckDBPyConnection,
    tanim: ModelTanimi,
    new_tables: set[str],
    foreign_keys: list[tuple[str, ForeignKey]] | None = None,
) -> list[Suggestion]:
    """`new_tables` içindeki tablolardan en az birine dokunan yeni ilişkileri önerir.

    foreign_keys: (veritabanı, ForeignKey) çiftleri; tablolar `sorgu` alanıyla eşlenir.
    Dönen ilişkiler `tanim.iliskiler`e eklenmeye hazırdır (etkin/pasif ayarlı).
    """
    prof = _Profile(cur, tanim)
    new_l = {n.lower() for n in new_tables}
    existing = list(tanim.iliskiler)
    taken = {(r.kimden.lower(), r.kime.lower()) for r in existing}
    taken |= {(b, a) for a, b in taken}

    by_source: dict[tuple[str, str, str], Tablo] = {}
    for t in tanim.tablolar:
        if t.sorgu and t.sorgu.tablo:
            by_source[((t.sorgu.veritabani or "").lower(), (t.sorgu.sema or "dbo").lower(), t.sorgu.tablo.lower())] = t

    def col_by_phys(t: Tablo, name: str) -> Sutun | None:
        for c in t.sutunlar:
            if _phys(c).lower() == name.lower():
                return c
        return None

    candidates: list[tuple[tuple, Suggestion]] = []

    # 1) yabancı anahtarlar
    fks = foreign_keys or []
    per_constraint: dict[tuple[str, str], int] = {}
    for db, fk in fks:
        per_constraint[(db, fk.constraint)] = per_constraint.get((db, fk.constraint), 0) + 1
    for db, fk in fks:
        if fk.constraint and per_constraint[(db, fk.constraint)] > 1:
            continue
        a = by_source.get((db.lower(), fk.from_schema.lower(), fk.from_table.lower()))
        b = by_source.get((db.lower(), fk.to_schema.lower(), fk.to_table.lower()))
        if not a or not b or a is b or not ({a.ad.lower(), b.ad.lower()} & new_l):
            continue
        ca, cb = col_by_phys(a, fk.from_column), col_by_phys(b, fk.to_column)
        if ca and cb:
            r = Iliski(kimden=ref(a, ca), kime=ref(b, cb))
            candidates.append(((0, 0, 0), Suggestion(r, "yabancı anahtar")))

    # 2) ad eşleşmesi
    tables = tanim.tablolar
    for b in tables:
        ones = prof.one_side_columns(b)
        if not ones:
            continue
        for a in tables:
            if a is b or not ({a.ad.lower(), b.ad.lower()} & new_l):
                continue
            a_cols = {c.ad.lower(): c for c in a.sutunlar}
            a_keys = [c for c in a.sutunlar if c.anahtar]
            for cb in ones:
                ca = a_cols.get(cb.ad.lower())
                if ca is None or tip_family(ca.tip) != tip_family(cb.tip):
                    continue
                a_unique = (len(a_keys) == 1 and a_keys[0] is ca) or (not a_keys and prof.unique_non_null(a, ca))
                if a_unique:
                    # iki taraf da benzersiz → 1:1; aynı çifti iki kez önermemek için tek yönde
                    if a.ad.lower() > b.ad.lower():
                        continue
                    r = Iliski(kimden=ref(a, ca), kime=ref(b, cb), kardinalite="1:1")
                else:
                    r = Iliski(kimden=ref(a, ca), kime=ref(b, cb))
                # Büyük "bir" tablosu (fatura başlığı) önce; eşitlikte en ayrıntılı olgu tablosu önce
                candidates.append(((1, -prof.rows(b), -prof.rows(a)), Suggestion(r, "ad eşleşmesi")))

    candidates.sort(key=lambda x: x[0])
    out: list[Suggestion] = []
    current = list(existing)
    for _, s in candidates:
        key = (s.iliski.kimden.lower(), s.iliski.kime.lower())
        if key in taken:
            continue
        taken |= {key, (key[1], key[0])}
        # aynı iki tablo arasında zaten bir ilişki varsa yenisi pasif olur (find_ambiguity bunu da yakalar)
        if find_ambiguity(current + [s.iliski]) is not None:
            s.iliski.aktif = False
        current.append(s.iliski)
        out.append(s)
    return out
