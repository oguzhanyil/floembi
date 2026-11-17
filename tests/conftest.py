from __future__ import annotations

from pathlib import Path

import pytest

from floem_bi.demo.sapb1 import generate
from floem_bi.engine.duckdb_engine import DuckDBEngine
from floem_bi.model import SemanticModel

ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = ROOT / "examples" / "sapb1_satis.yaml"


@pytest.fixture(scope="session")
def model() -> SemanticModel:
    return SemanticModel.from_yaml(MODEL_PATH)


@pytest.fixture(scope="session")
def demo_db(tmp_path_factory) -> Path:
    return generate(tmp_path_factory.mktemp("veri") / "demo.duckdb")


@pytest.fixture(scope="session")
def engine(demo_db, model) -> DuckDBEngine:
    eng = DuckDBEngine(demo_db, model)
    yield eng
    eng.close()


@pytest.fixture(scope="session")
def facts(engine) -> list[dict]:
    """Oracle için ham satırlar: derleyiciden bağımsız, düz bir JOIN ile."""
    cur = engine._con.cursor()
    rows = cur.execute("""
        SELECT f.DocDate, t.Yil, t.AyNo, u.ItmsGrpNam, m.GroupName, m.City, f.SlpCode, s.Email,
               f.DocEntry, f.DocType, f.Quantity, f.LineTotal
        FROM gold.fact_satis f
        LEFT JOIN gold.dim_tarih t ON t.Tarih = f.DocDate
        LEFT JOIN gold.dim_urun u ON u.ItemCode = f.ItemCode
        LEFT JOIN gold.dim_musteri m ON m.CardCode = f.CardCode
        LEFT JOIN gold.dim_temsilci s ON s.SlpCode = f.SlpCode
    """).fetchall()
    cur.close()
    keys = ["tarih", "yil", "ay", "kategori", "grup", "sehir", "slp", "eposta", "belge", "tur", "miktar", "tutar"]
    return [dict(zip(keys, r)) for r in rows]
