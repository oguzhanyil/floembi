"""Floem BI semantik model şeması (YAML/JSON).

Nesne modeli Tabular/TOM'dan alınmıştır (bkz. research/notes/TabularEditor.md);
alan adları Türkçedir. Örnek: examples/sapb1_satis.yaml
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Sutun(_Base):
    ad: str
    kaynak: str | None = None            # fiziksel sütun adı; yoksa `ad`
    ifade: str | None = None             # hesaplanmış sütun (satır bağlamında DAX)
    tip: Literal["int32", "int64", "decimal", "double", "string", "date", "datetime", "bool"] = "string"
    gizli: bool = False
    anahtar: bool = False
    ozet: Literal["sum", "avg", "min", "max", "count", "none"] | None = None
    bicim: str | None = None
    siralama_sutunu: str | None = None
    veri_kategorisi: str | None = None


class Olcu(_Base):
    ad: str
    ifade: str
    bicim: str | None = None
    klasor: str | None = None
    aciklama: str | None = None


class Hiyerarsi(_Base):
    ad: str
    seviyeler: list[str]


class TabloKaynak(_Base):
    katman: str = "gold"                 # warehouse katmanı → SQL şeması (Desktop içe aktarımında "veri")
    tablo: str                           # fiziksel tablo adı


class VeriKaynagi(_Base):
    """Kaynak sunucu (Power BI'daki veri kaynağı ayarları). Şifre burada tutulmaz."""
    id: str
    tur: Literal["sqlserver"] = "sqlserver"
    sunucu: str
    veritabani: str | None = None
    kimlik: Literal["sql", "windows"] = "sql"
    kullanici: str | None = None


class TabloSorgu(_Base):
    """Tablonun kaynaktaki karşılığı: ya bir tablo/görünüm ya da SQL sorgusu.

    Yenileme (Desktop'ta ya da gateway üzerinden) bu tanımı yeniden çalıştırır.
    """
    kaynak: str                          # VeriKaynagi.id
    veritabani: str | None = None
    sema: str | None = None
    tablo: str | None = None
    sql: str | None = None

    @model_validator(mode="after")
    def _one_of(self) -> "TabloSorgu":
        if bool(self.tablo) == bool(self.sql):
            raise ValueError("Tablo sorgusunda 'tablo' ya da 'sql' alanlarından yalnızca biri olmalı")
        return self


class TarihTablosu(_Base):
    anahtar_sutun: str


class Tablo(_Base):
    ad: str
    kaynak: TabloKaynak
    sorgu: TabloSorgu | None = None
    mod: Literal["import", "directquery", "dual"] = "import"
    gizli: bool = False
    aciklama: str | None = None
    sutunlar: list[Sutun] = Field(default_factory=list)
    olculer: list[Olcu] = Field(default_factory=list)
    hiyerarsiler: list[Hiyerarsi] = Field(default_factory=list)
    tarih_tablosu: TarihTablosu | None = None


_REF = re.compile(r"^\s*'?([^'\[]+?)'?\s*\[([^\]]+)\]\s*$")


def parse_column_ref(text: str) -> tuple[str, str]:
    m = _REF.match(text)
    if not m:
        raise ValueError(f"Sütun referansı 'Tablo[Sütun]' biçiminde olmalı: {text!r}")
    return m.group(1).strip(), m.group(2).strip()


class Iliski(_Base):
    kimden: str                          # çok tarafı:  Satis[Tarih]
    kime: str                            # bir tarafı:  Tarih[Tarih]
    kardinalite: Literal["*:1", "1:1"] = "*:1"
    filtre_yonu: Literal["tek", "cift"] = "tek"
    aktif: bool = True
    referans_butunlugu: bool = False     # True → INNER JOIN

    @field_validator("kimden", "kime")
    @classmethod
    def _check_ref(cls, v: str) -> str:
        parse_column_ref(v)
        return v


class TabloIzni(_Base):
    tablo: str
    filtre: str                          # DAX boolean ifadesi (satır bağlamı)


class SutunIzni(_Base):
    sutun: str
    izin: Literal["yok", "okuma"] = "yok"


class Rol(_Base):
    ad: str
    uyeler: dict[str, str] = Field(default_factory=dict)
    tablo_izinleri: list[TabloIzni] = Field(default_factory=list)
    sutun_izinleri: list[SutunIzni] = Field(default_factory=list)


class ModelBilgisi(_Base):
    ad: str
    surum: int = 1
    kultur: str = "tr-TR"
    varsayilan_mod: Literal["import", "directquery", "dual"] = "import"


class ModelTanimi(_Base):
    model: ModelBilgisi
    veri_kaynaklari: list[VeriKaynagi] = Field(default_factory=list)
    tablolar: list[Tablo] = Field(default_factory=list)
    iliskiler: list[Iliski] = Field(default_factory=list)
    roller: list[Rol] = Field(default_factory=list)
