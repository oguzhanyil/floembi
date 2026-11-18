"""Veri dönüştürme adımları (Power Query "Uygulanan adımlar" karşılığı).

Adımlar tabloyla birlikte modelde (TabloSorgu.adimlar) saklanır ve her yenilemede ham
veriye sırayla yeniden uygulanır. Her adımın `tur` alanı Türkçe bir anahtardır.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

Scalar = str | int | float | bool | None
Tip = Literal["int64", "decimal", "double", "string", "date", "datetime", "bool"]


class _S(BaseModel):
    model_config = ConfigDict(extra="forbid")


class YenidenAdlandir(_S):
    tur: Literal["yeniden_adlandir"]
    sutun: str
    yeni_ad: str = Field(min_length=1, max_length=128)


class SutunKaldir(_S):
    tur: Literal["sutun_kaldir"]
    sutunlar: list[str] = Field(min_length=1)


class SutunSec(_S):
    """Diğer sütunları kaldır (ve sırala)."""
    tur: Literal["sutun_sec"]
    sutunlar: list[str] = Field(min_length=1)


class TipDegistir(_S):
    tur: Literal["tip_degistir"]
    sutun: str
    tip: Tip


FiltreIslem = Literal[
    "esit", "esit_degil", "buyuk", "buyuk_esit", "kucuk", "kucuk_esit", "icinde", "icinde_degil",
    "icerir", "icermez", "ile_baslar", "ile_biter", "bos", "bos_degil", "arasinda",
]


class SatirFiltrele(_S):
    tur: Literal["satir_filtrele"]
    sutun: str
    islem: FiltreIslem
    degerler: list[Scalar] = Field(default_factory=list)


class DegerDegistir(_S):
    """Metin sütununda metin içinde değiştirir; diğer tiplerde değerin tamamını."""
    tur: Literal["deger_degistir"]
    sutun: str
    bul: Scalar
    yerine: Scalar


class Metin(_S):
    tur: Literal["metin"]
    sutun: str
    islem: Literal["kirp", "buyuk", "kucuk"]


class SutunBol(_S):
    tur: Literal["sutun_bol"]
    sutun: str
    ayirici: str = Field(min_length=1)
    adet: int = Field(default=2, ge=2, le=20)


class SutunBirlestir(_S):
    tur: Literal["sutun_birlestir"]
    sutunlar: list[str] = Field(min_length=2)
    ayirici: str = ""
    yeni_ad: str = Field(min_length=1, max_length=128)


class OzelSutun(_S):
    """Özel sütun: DuckDB SQL ifadesi (ör. "Quantity" * "Price"); güvenlik denetiminden geçer."""
    tur: Literal["ozel_sutun"]
    ad: str = Field(min_length=1, max_length=128)
    ifade: str = Field(min_length=1, max_length=4000)


class YinelenenleriKaldir(_S):
    tur: Literal["yinelenenleri_kaldir"]
    sutunlar: list[str] = Field(default_factory=list)   # boş: tüm sütunlar


class Toplama(_S):
    sutun: str | None = None
    islem: Literal["toplam", "ortalama", "en_kucuk", "en_buyuk", "say", "farkli_say"]
    ad: str = Field(min_length=1, max_length=128)


class Grupla(_S):
    tur: Literal["grupla"]
    gruplar: list[str] = Field(min_length=1)
    toplamalar: list[Toplama] = Field(min_length=1)


class TersOzet(_S):
    """Unpivot: seçili sütunlar Nitelik/Değer satırlarına dönüşür."""
    tur: Literal["ters_ozet"]
    sutunlar: list[str] = Field(min_length=1)
    nitelik_adi: str = "Nitelik"
    deger_adi: str = "Değer"


class SorguBirlestir(_S):
    """Merge: başka bir model tablosuyla birleştirip seçilen sütunlarını getirir."""
    tur: Literal["sorgu_birlestir"]
    tablo: str
    sol: list[str] = Field(min_length=1)
    sag: list[str] = Field(min_length=1)
    birlesim: Literal["sol", "ic"] = "sol"
    sutunlar: list[str] = Field(min_length=1)
    onek: str = ""


class SorguEkle(_S):
    """Append: başka tabloların satırlarını alt alta ekler (sütunlar ada göre eşlenir)."""
    tur: Literal["sorgu_ekle"]
    tablolar: list[str] = Field(min_length=1)


Adim = Annotated[
    Union[
        YenidenAdlandir, SutunKaldir, SutunSec, TipDegistir, SatirFiltrele, DegerDegistir, Metin, SutunBol,
        SutunBirlestir, OzelSutun, YinelenenleriKaldir, Grupla, TersOzet, SorguBirlestir, SorguEkle,
    ],
    Field(discriminator="tur"),
]


class Adimlar(BaseModel):
    adimlar: list[Adim] = Field(default_factory=list, max_length=200)


ADIM_ADI = {
    "yeniden_adlandir": "Sütunu yeniden adlandır",
    "sutun_kaldir": "Sütunları kaldır",
    "sutun_sec": "Diğer sütunları kaldır",
    "tip_degistir": "Tipi değiştir",
    "satir_filtrele": "Satırları filtrele",
    "deger_degistir": "Değerleri değiştir",
    "metin": "Metin dönüştür",
    "sutun_bol": "Sütunu böl",
    "sutun_birlestir": "Sütunları birleştir",
    "ozel_sutun": "Özel sütun",
    "yinelenenleri_kaldir": "Yinelenenleri kaldır",
    "grupla": "Grupla",
    "ters_ozet": "Ters özet (unpivot)",
    "sorgu_birlestir": "Sorguları birleştir",
    "sorgu_ekle": "Sorgu ekle",
}


def parse_steps(raw: list[dict]) -> list:
    return Adimlar.model_validate({"adimlar": raw}).adimlar
