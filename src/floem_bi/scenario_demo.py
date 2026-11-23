"""F15: iskonto/hacim/maliyet senaryosu ve uygulama içi öneri akışı için sentetik pilot."""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from .document.document import Document
from .model import ModelTanimi
from .process_demo import process_model, seed_process_data


def scenario_model():
    model = process_model()
    model["model"]["ad"] = "F15 · Sentetik Senaryo Atölyesi"
    sales = next(t for t in model["tablolar"] if t["ad"] == "Satis")
    sales["sutunlar"].append({"ad": "Maliyet", "tip": "double"})
    additions = [("Varsayım iskonto yüzdesi", "0", "0.0"), ("Varsayım hacim yüzdesi", "0", "0.0"), ("Varsayım maliyet yüzdesi", "0", "0.0"),
        ("Senaryo net satışı", "SUM(Satis[Tutar]) * (1 - [Varsayım iskonto yüzdesi] / 100) * (1 + [Varsayım hacim yüzdesi] / 100)", "₺ #,##0.00"),
        ("Senaryo maliyeti", "SUM(Satis[Maliyet]) * (1 + [Varsayım maliyet yüzdesi] / 100) * (1 + [Varsayım hacim yüzdesi] / 100)", "₺ #,##0.00"),
        ("Senaryo brüt kârı", "[Senaryo net satışı] - [Senaryo maliyeti]", "₺ #,##0.00"),
        ("Senaryo brüt kâr oranı", "DIVIDE([Senaryo brüt kârı], [Senaryo net satışı])", "0.0%")]
    sales["olculer"] += [{"ad": n, "ifade": e, "bicim": f, "klasor": "F15 · Sentetik senaryo"} for n, e, f in additions]
    return model


def scenario_report():
    def field(table, column): return {"table": table, "column": column}
    def node(id, type, x, y, w, h, **props):
        return {"id": id, "type": type, "x": x, "y": y, "w": w, "h": h, "group": [], "values": [], "filters": [], "format": {"showTitle": False}, **props}
    visuals = [node("heading", "text", 32, 24, 1216, 56, format={"showTitle": False, "text": "Senaryo Atölyesi · iskonto, hacim ve maliyet", "fontSize": 30, "padding": 0, "textOverflow": "wrap"}),
        node("intro", "text", 32, 90, 1216, 64, format={"showTitle": False, "text": "SENTETİK PİLOT · Varsayımları değiştirin; satış, maliyet ve kâr etkisini aynı firma/dönemde görün. Web'de öneri oluşturabilir, yönetici/üye hesabıyla onaylayabilir veya reddedebilirsiniz.", "fontSize": 16, "padding": 0, "textOverflow": "wrap"})]
    for id, x, title, f, value in [("company", 32, "Firma", field("Firma", "Kod"), "F1"), ("period", 446, "Dönem", field("Tarih", "Donem"), "2026-02"), ("customer", 858, "Müşteri kodu", field("Musteri", "Kod"), "C001")]:
        visuals.append(node(id, "slicer", x, 174, 390, 100, title=title, group=[f], state={"selected": [value]}, format={"showTitle": True, "slicerStyle": "dropdown"}))
    visuals.append(node("scenario", "scenario", 32, 304, 1216, 1040, title="Satış ve brüt kâr senaryosu", format={"showTitle": True, "scenarioId": "sales.margin", "radius": 14}))
    visuals.append(node("scope-note", "text", 32, 1376, 1216, 100, format={"showTitle": False, "padding": 0, "fontSize": 16, "textOverflow": "wrap", "text": "Örnek: F1 / 2026-02 / C001 başlangıç satışı 180, sentetik maliyeti 108, kârı 72 TRY. İskonto %10 olursa satış 162, kâr 54 TRY olur. Bu varsayım modelidir; vergi, kur ve gerçek maliyet mutabakatı içermez. Öneri onayı uygulama içi karardır; ERP belgesi oluşturmaz."}))
    overrides, top = {}, 20
    for v in visuals:
        height = 120 if v["id"] == "heading" else 180 if v["id"] == "intro" else 110 if v["type"] == "slicer" else 1660 if v["type"] == "scenario" else 270
        overrides[v["id"]] = {"x": 20, "y": top, "w": 350, "h": height, "format": {"fontSize": 24 if v["id"] == "heading" else 15}}
        top += height + 16
    params = [("discount", "İskonto", "Varsayım iskonto yüzdesi", 0, 50), ("volume", "Hacim değişimi", "Varsayım hacim yüzdesi", -50, 100), ("cost", "Birim maliyet değişimi", "Varsayım maliyet yüzdesi", -50, 100)]
    return {"version": 1, "scenarios": [{"id": "sales.margin", "label": "Satış ve brüt kâr", "description": "Varsayımsal iskonto ve hacim tüm satış satırlarına; birim maliyet değişimi sentetik maliyete uygulanır. Negatif iade satırları kendi işaretiyle kalır.",
        "company": field("Firma", "Kod"), "parameters": [{"id": id, "label": label, "measure": measure, "unit": "%", "minimum": lo, "maximum": hi, "step": 1, "defaultValue": 0} for id, label, measure, lo, hi in params],
        "outputs": [{"measure": measure, "label": label, "unit": unit} for measure, label, unit in [("Senaryo net satışı", "Net satış", "TRY"), ("Senaryo maliyeti", "Maliyet", "TRY"), ("Senaryo brüt kârı", "Brüt kâr", "TRY"), ("Senaryo brüt kâr oranı", "Brüt kâr oranı", "oran (0–1)")]],
        "proposalEnabled": True, "submitRoles": ["admin", "member", "contributor", "viewer"]}],
        "pages": [{"id": "studio", "name": "Senaryo Atölyesi", "width": 1280, "height": 1510, "backgroundColor": "#f2f5fa", "visuals": visuals,
            "layouts": [{"id": "phone", "name": "Telefon", "width": 390, "height": top + 16, "maxWidth": 620, "displayOption": "FitToWidth", "overrides": overrides}]}]}


def seed_scenario_data(doc):
    seed_process_data(doc)
    doc.con.execute("ALTER TABLE veri.Satis ADD COLUMN Maliyet DOUBLE")
    doc.con.execute("UPDATE veri.Satis SET Maliyet=Tutar*0.6")


def create_demo(target: Path):
    target = target.resolve()
    if target.exists() or target.suffix.lower() != ".floem":
        raise ValueError("Önceki dosyayı korumak için yeni bir .floem hedefi seçin")
    with tempfile.TemporaryDirectory(prefix="floem-f15-") as folder:
        doc = Document.new(Path(folder), "F15 Senaryo Atölyesi")
        try:
            doc.content.tanim = ModelTanimi.model_validate(scenario_model())
            seed_scenario_data(doc)
            doc.set_report(scenario_report())
            doc.save(target)
        finally: doc.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path)
    create_demo(parser.parse_args().target)
    print("F15 sentetik senaryo atölyesi oluşturuldu.")
