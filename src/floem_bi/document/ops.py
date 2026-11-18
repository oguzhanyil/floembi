"""Model düzenleme işlemleri (komut nesneleri).

Arayüzdeki her düzenleme (tabloyu yeniden adlandır, ilişki ekle, sütunu gizle…) bir
işlem olarak servise gönderilir. İşlemler modelin kopyasına uygulanır, model
doğrulanır, veriye dokunan adımlar (tablo silme, tip değiştirme) tek bir DuckDB
işleminde (transaction) çalışır. Bir adım başarısız olursa hiçbir şey değişmez.

Aynı işlem listesi ileride floembi.app'te web'den düzenleme için de kullanılacak.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Annotated, Callable, Literal, Union

import duckdb
from pydantic import BaseModel, ConfigDict, Field

from ..dax.rename import rename_column as dax_rename_column
from ..dax.rename import rename_measure as dax_rename_measure
from ..dax.rename import rename_table as dax_rename_table
from ..importer.loader import qident
from ..importer.types import DUCKDB_TYPE, tip_family
from ..model.schema import (
    Hiyerarsi, Iliski, ModelTanimi, Olcu, Sutun, Tablo, TabloKaynak, TarihTablosu, parse_column_ref,
)
from ..model.semantic import ModelError
from ..report.schema import rename_column_refs, rename_measure_refs, rename_table_refs

DATA_SCHEMA = "veri"
_BAD = re.compile(r"[\[\]']")

Check = Callable[[duckdb.DuckDBPyConnection], None]


def clean_name(name: str, what: str) -> str:
    n = " ".join((name or "").split())
    if not n:
        raise ModelError(f"{what} adı boş olamaz")
    if _BAD.search(n):
        raise ModelError(f"{what} adında ' [ ] karakterleri kullanılamaz")
    if len(n) > 128:
        raise ModelError(f"{what} adı en fazla 128 karakter olabilir")
    return n


def sanitize_name(name: str, fallback: str) -> str:
    """İçe aktarımda kaynak adını model adına çevirir (yasak karakterler → _)."""
    n = _BAD.sub("_", " ".join((name or "").split()))[:128]
    return n or fallback


def phys_table(t: Tablo) -> str:
    return f"{qident(DATA_SCHEMA)}.{qident(t.kaynak.tablo)}"


def phys_col(c: Sutun) -> str:
    return qident(c.kaynak or c.ad)


@dataclass
class OpContext:
    tanim: ModelTanimi
    diagram: dict
    checks: list[Check] = field(default_factory=list)      # sırayla, tek transaction içinde
    report: dict = field(default_factory=dict)             # rapordaki alan referansları da güncellenir
    measure_checks: list[str] = field(default_factory=list)  # derlenebilirliği denetlenecek ölçüler

    def table(self, name: str) -> Tablo:
        for t in self.tanim.tablolar:
            if t.ad.lower() == name.lower():
                return t
        raise ModelError(f"Tablo bulunamadı: {name}")

    def column(self, t: Tablo, name: str) -> Sutun:
        for c in t.sutunlar:
            if c.ad.lower() == name.lower():
                return c
        raise ModelError(f"Sütun bulunamadı: {t.ad}[{name}]")

    def resolve(self, ref: str) -> tuple[Tablo, Sutun]:
        try:
            tn, cn = parse_column_ref(ref)
        except ValueError as e:
            raise ModelError(str(e)) from e
        t = self.table(tn)
        return t, self.column(t, cn)

    def relationship(self, kimden: str, kime: str) -> Iliski:
        a, b = self.resolve(kimden), self.resolve(kime)
        for r in self.tanim.iliskiler:
            if self.resolve(r.kimden) == a and self.resolve(r.kime) == b:
                return r
        raise ModelError(f"İlişki bulunamadı: {kimden} → {kime}")

    def all_dax(self):
        """Modeldeki tüm DAX ifadelerini (sahibi tabloyla) gezer: ölçüler, hesaplanmış sütunlar, RLS."""
        for t in self.tanim.tablolar:
            for m in t.olculer:
                yield m, "ifade", None
            for c in t.sutunlar:
                if c.ifade:
                    yield c, "ifade", t.ad
        for rol in self.tanim.roller:
            for iz in rol.tablo_izinleri:
                yield iz, "filtre", iz.tablo


def _ref(table: str, column: str) -> str:
    return f"{table}[{column}]"


class _Op(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def apply(self, ctx: OpContext) -> None:  # pragma: no cover - alt sınıflar uygular
        raise NotImplementedError


# ------------------------------------------------------------------ tablolar
class RenameTable(_Op):
    op: Literal["rename_table"]
    table: str
    new_name: str

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        new = clean_name(self.new_name, "Tablo")
        if any(o is not t and o.ad.lower() == new.lower() for o in ctx.tanim.tablolar):
            raise ModelError(f"'{new}' adlı bir tablo zaten var")
        old = t.ad
        t.ad = new
        for r in ctx.tanim.iliskiler:
            for attr in ("kimden", "kime"):
                tn, cn = parse_column_ref(getattr(r, attr))
                if tn.lower() == old.lower():
                    setattr(r, attr, _ref(new, cn))
        for rol in ctx.tanim.roller:
            for iz in rol.tablo_izinleri:
                if iz.tablo.lower() == old.lower():
                    iz.tablo = new
            for sz in rol.sutun_izinleri:
                tn, cn = parse_column_ref(sz.sutun)
                if tn.lower() == old.lower():
                    sz.sutun = _ref(new, cn)
        for obj, attr, _ in ctx.all_dax():
            setattr(obj, attr, dax_rename_table(getattr(obj, attr), old, new))
        tables = ctx.diagram.get("tables", {})
        if old in tables:
            tables[new] = tables.pop(old)
        rename_table_refs(ctx.report, old, new)


class UpdateTable(_Op):
    op: Literal["update_table"]
    table: str
    gizli: bool | None = None
    aciklama: str | None = None

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        if "gizli" in self.model_fields_set and self.gizli is not None:
            t.gizli = self.gizli
        if "aciklama" in self.model_fields_set:
            t.aciklama = (self.aciklama or "").strip() or None


class DeleteTable(_Op):
    op: Literal["delete_table"]
    table: str

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        name = t.ad.lower()
        ctx.tanim.tablolar.remove(t)
        ctx.tanim.iliskiler = [
            r for r in ctx.tanim.iliskiler
            if parse_column_ref(r.kimden)[0].lower() != name and parse_column_ref(r.kime)[0].lower() != name
        ]
        for rol in ctx.tanim.roller:
            rol.tablo_izinleri = [iz for iz in rol.tablo_izinleri if iz.tablo.lower() != name]
            rol.sutun_izinleri = [sz for sz in rol.sutun_izinleri if parse_column_ref(sz.sutun)[0].lower() != name]
        ctx.diagram.get("tables", {}).pop(t.ad, None)
        used = {o.kaynak.tablo.lower() for o in ctx.tanim.tablolar if o.kaynak.katman == DATA_SCHEMA}
        if t.kaynak.katman == DATA_SCHEMA and t.kaynak.tablo.lower() not in used:
            target = phys_table(t)
            ctx.checks.append(lambda cur: cur.execute(f"DROP TABLE IF EXISTS {target}"))


# ------------------------------------------------------------------ sütunlar
class RenameColumn(_Op):
    op: Literal["rename_column"]
    table: str
    column: str
    new_name: str

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        c = ctx.column(t, self.column)
        new = clean_name(self.new_name, "Sütun")
        if any(o is not c and o.ad.lower() == new.lower() for o in t.sutunlar):
            raise ModelError(f"{t.ad} tablosunda '{new}' adlı bir sütun zaten var")
        if any(m.ad.lower() == new.lower() for m in t.olculer):
            raise ModelError(f"'{new}' adı bir ölçü tarafından kullanılıyor")
        old = c.ad
        if c.ifade is None and c.kaynak is None:
            c.kaynak = old                                   # fiziksel ad sabit kalır
        c.ad = new
        if c.kaynak == new:
            c.kaynak = None
        for r in ctx.tanim.iliskiler:
            for attr in ("kimden", "kime"):
                tn, cn = parse_column_ref(getattr(r, attr))
                if tn.lower() == t.ad.lower() and cn.lower() == old.lower():
                    setattr(r, attr, _ref(tn, new))
        for h in t.hiyerarsiler:
            h.seviyeler = [new if s.lower() == old.lower() else s for s in h.seviyeler]
        for o in t.sutunlar:
            if o.siralama_sutunu and o.siralama_sutunu.lower() == old.lower():
                o.siralama_sutunu = new
        if t.tarih_tablosu and t.tarih_tablosu.anahtar_sutun.lower() == old.lower():
            t.tarih_tablosu.anahtar_sutun = new
        for rol in ctx.tanim.roller:
            for sz in rol.sutun_izinleri:
                tn, cn = parse_column_ref(sz.sutun)
                if tn.lower() == t.ad.lower() and cn.lower() == old.lower():
                    sz.sutun = _ref(tn, new)
        for obj, attr, home in ctx.all_dax():
            setattr(obj, attr, dax_rename_column(getattr(obj, attr), t.ad, old, new, home))
        rename_column_refs(ctx.report, t.ad, old, new)


class UpdateColumn(_Op):
    op: Literal["update_column"]
    table: str
    column: str
    gizli: bool | None = None
    tip: Literal["int32", "int64", "decimal", "double", "string", "date", "datetime", "bool"] | None = None
    bicim: str | None = None
    ozet: Literal["sum", "avg", "min", "max", "count", "none"] | None = None
    siralama_sutunu: str | None = None
    veri_kategorisi: str | None = None

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        c = ctx.column(t, self.column)
        s = self.model_fields_set
        if "gizli" in s and self.gizli is not None:
            c.gizli = self.gizli
        if "bicim" in s:
            c.bicim = (self.bicim or "").strip() or None
        if "ozet" in s:
            c.ozet = self.ozet
        if "veri_kategorisi" in s:
            c.veri_kategorisi = (self.veri_kategorisi or "").strip() or None
        if "siralama_sutunu" in s:
            if self.siralama_sutunu:
                other = ctx.column(t, self.siralama_sutunu)
                if other is c:
                    raise ModelError("Bir sütun kendisine göre sıralanamaz")
                c.siralama_sutunu = other.ad
                a, b, target = phys_col(c), phys_col(other), phys_table(t)
                label = f"{t.ad}[{c.ad}]"

                def check_sort(cur, a=a, b=b, target=target, label=label, by=other.ad):
                    # Power BI kuralı: her değerin tek bir sıralama değeri olmalı
                    bad = cur.execute(
                        f"SELECT count(*) FROM (SELECT {a} FROM {target} GROUP BY {a} HAVING count(DISTINCT {b}) > 1)"
                    ).fetchone()[0]
                    if bad:
                        raise ModelError(f"{label}, [{by}] sütununa göre sıralanamaz: bazı değerlerin birden fazla sıralama değeri var")

                ctx.checks.append(check_sort)
            else:
                c.siralama_sutunu = None
        if "tip" in s and self.tip and self.tip != c.tip:
            if c.ifade is not None:
                c.tip = self.tip
                return
            old_tip, new_tip = c.tip, self.tip
            c.tip = new_tip
            target, col = phys_table(t), phys_col(c)
            label = f"{t.ad}[{c.ad}]"

            def alter(cur, target=target, col=col, label=label, old_tip=old_tip, new_tip=new_tip):
                try:
                    cur.execute(f"ALTER TABLE {target} ALTER {col} TYPE {DUCKDB_TYPE[new_tip]}")
                except duckdb.Error as e:
                    raise ModelError(
                        f"{label} {TIP_ADI[old_tip]} tipinden {TIP_ADI[new_tip]} tipine çevrilemedi: dönüştürülemeyen değerler var",
                    ) from e

            ctx.checks.append(alter)


TIP_ADI = {
    "int32": "tam sayı", "int64": "tam sayı", "decimal": "sabit ondalık", "double": "ondalık sayı",
    "string": "metin", "date": "tarih", "datetime": "tarih/saat", "bool": "doğru/yanlış",
}


# ------------------------------------------------------------------ ilişkiler
def _check_relationship(ctx: OpContext, r: Iliski) -> None:
    ta, ca = ctx.resolve(r.kimden)
    tb, cb = ctx.resolve(r.kime)
    if ta is tb:
        raise ModelError("İlişki iki farklı tablo arasında olmalı")
    if tip_family(ca.tip) != tip_family(cb.tip):
        raise ModelError(
            f"Sütun tipleri uyumsuz: {ta.ad}[{ca.ad}] {TIP_ADI[ca.tip]}, {tb.ad}[{cb.ad}] {TIP_ADI[cb.tip]}"
        )
    mine = {(id(ta), id(ca)), (id(tb), id(cb))}
    for other in ctx.tanim.iliskiler:
        if other is r:
            continue
        (oa, oca), (ob, ocb) = ctx.resolve(other.kimden), ctx.resolve(other.kime)
        if {(id(oa), id(oca)), (id(ob), id(ocb))} == mine:
            raise ModelError("Bu iki sütun arasında zaten bir ilişki var")
    sides = [(tb, cb)] + ([(ta, ca)] if r.kardinalite == "1:1" else [])
    for t, c in sides:
        target, col, label = phys_table(t), phys_col(c), f"{t.ad}[{c.ad}]"

        def unique(cur, target=target, col=col, label=label):
            dup, nulls = cur.execute(
                f"SELECT count({col}) - count(DISTINCT {col}), count(*) - count({col}) FROM {target}"
            ).fetchone()
            if dup or nulls > 1:
                raise ModelError(
                    f"{label} ilişkinin 'bir' tarafında olamaz: sütunda yinelenen değerler var. "
                    "Kardinaliteyi ya da ilişkinin yönünü değiştirin."
                )

        ctx.checks.append(unique)


class _RelFields(_Op):
    kardinalite: Literal["*:1", "1:1"] = "*:1"
    filtre_yonu: Literal["tek", "cift"] = "tek"
    aktif: bool = True
    referans_butunlugu: bool = False


class AddRelationship(_RelFields):
    op: Literal["add_relationship"]
    kimden: str
    kime: str

    def apply(self, ctx: OpContext) -> None:
        ta, ca = ctx.resolve(self.kimden)
        tb, cb = ctx.resolve(self.kime)
        r = Iliski(
            kimden=_ref(ta.ad, ca.ad), kime=_ref(tb.ad, cb.ad), kardinalite=self.kardinalite,
            filtre_yonu=self.filtre_yonu, aktif=self.aktif, referans_butunlugu=self.referans_butunlugu,
        )
        ctx.tanim.iliskiler.append(r)
        _check_relationship(ctx, r)
        for c in (ca, cb):
            if c.ozet is None or c.ozet == "sum":
                c.ozet = "none"                      # anahtar sütunlar toplanmaz


class UpdateRelationship(_Op):
    op: Literal["update_relationship"]
    kimden: str                                  # mevcut ilişkiyi bulmak için
    kime: str
    yeni_kimden: str | None = None
    yeni_kime: str | None = None
    kardinalite: Literal["*:1", "1:1"] | None = None
    filtre_yonu: Literal["tek", "cift"] | None = None
    aktif: bool | None = None
    referans_butunlugu: bool | None = None

    def apply(self, ctx: OpContext) -> None:
        r = ctx.relationship(self.kimden, self.kime)
        if self.yeni_kimden:
            t, c = ctx.resolve(self.yeni_kimden)
            r.kimden = _ref(t.ad, c.ad)
        if self.yeni_kime:
            t, c = ctx.resolve(self.yeni_kime)
            r.kime = _ref(t.ad, c.ad)
        for attr in ("kardinalite", "filtre_yonu", "aktif", "referans_butunlugu"):
            v = getattr(self, attr)
            if v is not None:
                setattr(r, attr, v)
        _check_relationship(ctx, r)


class DeleteRelationship(_Op):
    op: Literal["delete_relationship"]
    kimden: str
    kime: str

    def apply(self, ctx: OpContext) -> None:
        ctx.tanim.iliskiler.remove(ctx.relationship(self.kimden, self.kime))


# ------------------------------------------------------------- tarih tablosu
class MarkDateTable(_Op):
    """Power BI: 'Tarih tablosu olarak işaretle'. column=None işareti kaldırır."""
    op: Literal["mark_date_table"]
    table: str
    column: str | None = None

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        if not self.column:
            t.tarih_tablosu = None
            return
        c = ctx.column(t, self.column)
        if c.tip not in ("date", "datetime"):
            raise ModelError(f"Tarih tablosu anahtarı tarih tipinde olmalı: {t.ad}[{c.ad}] {TIP_ADI[c.tip]}")
        for o in ctx.tanim.tablolar:
            if o is not t:
                o.tarih_tablosu = None             # MVP: modelde tek tarih tablosu
        t.tarih_tablosu = TarihTablosu(anahtar_sutun=c.ad)
        target, col, label = phys_table(t), phys_col(c), f"{t.ad}[{c.ad}]"

        def check(cur, target=target, col=col, label=label):
            n, d, nn = cur.execute(f"SELECT count(*), count(DISTINCT {col}), count({col}) FROM {target}").fetchone()
            if nn != n:
                raise ModelError(f"{label} boş değer içeriyor; tarih tablosu anahtarı boş olamaz")
            if d != n:
                raise ModelError(f"{label} yinelenen tarihler içeriyor; her gün bir kez yer almalı")

        ctx.checks.append(check)


# ------------------------------------------------------------------ ölçüler
def _find_measure(ctx: OpContext, name: str) -> tuple[Tablo, Olcu]:
    for t in ctx.tanim.tablolar:
        for m in t.olculer:
            if m.ad.lower() == name.lower():
                return t, m
    raise ModelError(f"Ölçü bulunamadı: [{name}]")


class AddMeasure(_Op):
    """Power BI "Yeni ölçü": ana tabloya ölçü ekler. İfade derlenebilir olmalı."""
    op: Literal["add_measure"]
    table: str
    name: str
    expression: str = Field(min_length=1)
    bicim: str | None = None
    klasor: str | None = None
    aciklama: str | None = None

    def apply(self, ctx: OpContext) -> None:
        t = ctx.table(self.table)
        name = clean_name(self.name, "Ölçü")
        t.olculer.append(Olcu(
            ad=name, ifade=self.expression.strip(), bicim=(self.bicim or "").strip() or None,
            klasor=(self.klasor or "").strip() or None, aciklama=(self.aciklama or "").strip() or None,
        ))
        ctx.measure_checks.append(name)


class UpdateMeasure(_Op):
    """Ölçüyü düzenler; yeniden adlandırmada onu kullanan ölçüler ve rapor görselleri güncellenir."""
    op: Literal["update_measure"]
    name: str
    new_name: str | None = None
    expression: str | None = None
    table: str | None = None                       # ana tabloyu değiştir
    bicim: str | None = None
    klasor: str | None = None
    aciklama: str | None = None

    def apply(self, ctx: OpContext) -> None:
        t, m = _find_measure(ctx, self.name)
        s = self.model_fields_set
        if "expression" in s and self.expression is not None:
            if not self.expression.strip():
                raise ModelError("Ölçü ifadesi boş olamaz")
            m.ifade = self.expression.strip()
        for attr in ("bicim", "klasor", "aciklama"):
            if attr in s:
                setattr(m, attr, (getattr(self, attr) or "").strip() or None)
        if self.new_name and self.new_name.strip() != m.ad:
            old, new = m.ad, clean_name(self.new_name, "Ölçü")
            m.ad = new
            for obj, attr, _ in ctx.all_dax():
                setattr(obj, attr, dax_rename_measure(getattr(obj, attr), old, new))
            rename_measure_refs(ctx.report, old, new)
        if self.table and self.table.lower() != t.ad.lower():
            dest = ctx.table(self.table)
            t.olculer.remove(m)
            dest.olculer.append(m)
        ctx.measure_checks.append(m.ad)


class DeleteMeasure(_Op):
    op: Literal["delete_measure"]
    name: str

    def apply(self, ctx: OpContext) -> None:
        t, m = _find_measure(ctx, self.name)
        t.olculer.remove(m)


# ------------------------------------------------------------------ tarih tablosu
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
GUNLER = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]


class CreateDateTable(_Op):
    """Power BI'daki takvim tablosu: Yıl, Çeyrek, Ay, Gün sütunları, sıralamalar, hiyerarşi,
    "tarih tablosu" işareti ve isteğe bağlı olarak olgu tablolarındaki tarih sütunlarına ilişki.

    Aralık verilmezse ilişkilendirilecek (yoksa modeldeki tüm) tarih sütunlarının en küçük ve
    en büyük değerinden bulunur ve tam yıllara genişletilir.
    """
    op: Literal["create_date_table"]
    name: str = "Tarih"
    start: str | None = None                      # "2024-01-01"
    end: str | None = None
    relate: list[str] = Field(default_factory=list)   # ["OINV[DocDate]", ...]

    def apply(self, ctx: OpContext) -> None:
        name = clean_name(self.name, "Tablo")
        if any(t.ad.lower() == name.lower() for t in ctx.tanim.tablolar):
            raise ModelError(f"'{name}' adlı bir tablo zaten var")
        phys = name
        used = {t.kaynak.tablo.lower() for t in ctx.tanim.tablolar}
        n = 2
        while phys.lower() in used:
            phys = f"{name}_{n}"
            n += 1
        sources: list[tuple[Tablo, Sutun]] = []
        for ref in self.relate:
            st, sc = ctx.resolve(ref)
            if sc.tip != "date":
                raise ModelError(
                    f"{st.ad}[{sc.ad}] {TIP_ADI[sc.tip]} tipinde; tarih tablosuna bağlamak için önce tipini 'Tarih' yapın"
                )
            sources.append((st, sc))
        scan = sources or [
            (t, c) for t in ctx.tanim.tablolar for c in t.sutunlar
            if c.tip in ("date", "datetime") and c.ifade is None and t.kaynak.katman == DATA_SCHEMA
        ]
        num = lambda ad, gizli=False: Sutun(ad=ad, tip="int64", ozet="none", gizli=gizli)  # noqa: E731
        txt = lambda ad, sort=None: Sutun(ad=ad, tip="string", siralama_sutunu=sort)  # noqa: E731
        table = Tablo(
            ad=name,
            kaynak=TabloKaynak(katman=DATA_SCHEMA, tablo=phys),
            sutunlar=[
                Sutun(ad="Tarih", tip="date", anahtar=True, bicim="dd.MM.yyyy"),
                num("Yıl"), num("Çeyrek No", True), txt("Çeyrek", "Çeyrek No"),
                num("Ay No"), txt("Ay", "Ay No"), txt("Yıl Ay", "Yıl Ay No"), num("Yıl Ay No", True),
                num("Gün"), num("Haftanın Günü No", True), txt("Haftanın Günü", "Haftanın Günü No"),
            ],
            hiyerarsiler=[Hiyerarsi(ad="Takvim", seviyeler=["Yıl", "Çeyrek", "Ay", "Tarih"])],
            tarih_tablosu=TarihTablosu(anahtar_sutun="Tarih"),
            aciklama="Floem BI tarafından oluşturulan takvim tablosu",
        )
        for o in ctx.tanim.tablolar:
            o.tarih_tablosu = None                    # MVP: modelde tek tarih tablosu
        ctx.tanim.tablolar.append(table)
        for st, sc in sources:
            ctx.tanim.iliskiler.append(Iliski(kimden=_ref(st.ad, sc.ad), kime=_ref(name, "Tarih")))
            if sc.ozet is None or sc.ozet == "sum":
                sc.ozet = "none"
        ctx.diagram.setdefault("tables", {})
        target = f"{qident(DATA_SCHEMA)}.{qident(phys)}"
        bounds = [(phys_table(t), phys_col(c)) for t, c in scan]
        start, end = self.start, self.end
        label = name

        def build(cur, target=target, bounds=bounds, start=start, end=end, label=label):
            lo, hi = start, end
            if not (lo and hi):
                found = []
                for tbl, col in bounds:
                    found.append(cur.execute(f"SELECT min(CAST({col} AS DATE)), max(CAST({col} AS DATE)) FROM {tbl}").fetchone())
                mins = [f[0] for f in found if f[0] is not None]
                maxs = [f[1] for f in found if f[1] is not None]
                today = cur.execute("SELECT current_date").fetchone()[0]
                lo = lo or f"{(min(mins) if mins else today).year}-01-01"
                hi = hi or f"{(max(maxs) if maxs else today).year}-12-31"
            if str(lo) > str(hi):
                raise ModelError(f"{label}: başlangıç tarihi bitişten sonra olamaz")
            aylar = "[" + ", ".join(f"'{a}'" for a in AYLAR) + "]"
            gunler = "[" + ", ".join(f"'{g}'" for g in GUNLER) + "]"
            cur.execute(f"""
                CREATE TABLE {target} AS
                SELECT CAST(d AS DATE) AS "Tarih",
                       year(d) AS "Yıl",
                       quarter(d) AS "Çeyrek No",
                       'Ç' || quarter(d) AS "Çeyrek",
                       month(d) AS "Ay No",
                       {aylar}[month(d)] AS "Ay",
                       CAST(year(d) AS VARCHAR) || '-' || lpad(CAST(month(d) AS VARCHAR), 2, '0') AS "Yıl Ay",
                       year(d) * 100 + month(d) AS "Yıl Ay No",
                       day(d) AS "Gün",
                       isodow(d) AS "Haftanın Günü No",
                       {gunler}[isodow(d)] AS "Haftanın Günü"
                FROM generate_series(DATE '{lo}', DATE '{hi}', INTERVAL 1 DAY) AS t(d)
            """)

        ctx.checks.append(build)


Op = Annotated[
    Union[
        RenameTable, UpdateTable, DeleteTable, RenameColumn, UpdateColumn,
        AddRelationship, UpdateRelationship, DeleteRelationship, MarkDateTable,
        AddMeasure, UpdateMeasure, DeleteMeasure, CreateDateTable,
    ],
    Field(discriminator="op"),
]


class OpsIn(BaseModel):
    ops: list[Op] = Field(min_length=1, max_length=500)
