"""Power BI model metadatasını Floem şemasına alır; bağlantı ve sorgu taşımaz."""
from __future__ import annotations

from pathlib import Path
import re

from .dax.rename import bracket_token, table_token
from .model.schema import Iliski, ModelBilgisi, ModelTanimi, Olcu, Rol, Sutun, Tablo, TabloIzni, TabloKaynak
from .model.semantic import SemanticModel, find_ambiguity
from .powerbi_layout import contained, read_json
from .semantic_import import read_tmdl, _name

TYPES = {"int64": "int64", "int32": "int32", "double": "double", "decimal": "decimal", "boolean": "bool", "bool": "bool", "datetime": "datetime", "date": "date", "string": "string"}


def issue(code, message, detail="", severity="warning"):
    return {"code": code, "message": message, "detail": str(detail), "severity": severity}


def _ref(table, column): return table_token(str(table)) + bracket_token(str(column))


def add_relationship(model, source, issues):
    a, ac, b, bc, cardinality, both, active = source
    if cardinality in {"1:M", "1:*"}: a, ac, b, bc, cardinality = b, bc, a, ac, "*:1"
    if cardinality not in {"M:1", "*:1", "1:1"} or both:
        issues.append(issue("RELATIONSHIP_NOT_IMPORTED", "İlişki motor desteği nedeniyle aktarılmadı.", f"{a}[{ac}] → {b}[{bc}]", "error")); return
    candidate = Iliski(kimden=_ref(a, ac), kime=_ref(b, bc), kardinalite="1:1" if cardinality == "1:1" else "*:1", aktif=bool(active))
    try:
        SemanticModel(model.model_copy(update={"iliskiler": [*model.iliskiler, candidate]}))
        if find_ambiguity([*model.iliskiler, candidate]): raise ValueError()
        model.iliskiler.append(candidate)
    except Exception:
        issues.append(issue("RELATIONSHIP_NOT_IMPORTED", "İlişki uçları veya filtre yolu doğrulanamadı.", f"{a}[{ac}] → {b}[{bc}]", "error"))


def deny_role(model, name):
    return Rol(ad=name, tablo_izinleri=[TabloIzni(tablo=t.ad, filtre="1 = 0") for t in model.tablolar])


def tmdl_roles(path, model, issues):
    roles = []
    for file in sorted((path / "definition/roles").glob("*.tmdl")):
        contained(file, path)
        text = file.read_text(encoding="utf-8-sig")
        name = _name(re.search(r"(?m)^role\s+(.+)$", text).group(1))
        # RLS/OLS kaybında veriyi açmak yerine doğrulama gerektiren kapalı rol.
        role = deny_role(model, name)
        roles.append(role)
    if roles:
        model.roller = roles
        issues.append(issue("SECURITY_REVIEW_REQUIRED", "Power BI proje rolleri kapalı olarak alındı; Floem RLS kuralları ve üyeleri yayımlamadan önce doğrulanmalı.", severity="error"))


def project_model(path: Path, issues: list) -> ModelTanimi | None:
    if (path / "definition/tables").is_dir():
        for file in (path / "definition").rglob("*.tmdl"):
            contained(file, path)
            if file.stat().st_size > 64 * 1024 ** 2: raise ValueError("TMDL dosyası boyut sınırını aşıyor")
        source = read_tmdl(path)
        model = source.model
        for r in source.relationships:
            if not r["supported"]:
                issues.append(issue("RELATIONSHIP_NOT_IMPORTED", "Kaynak ilişki desteklenmiyor.", " → ".join("[".join(v) + "]" for v in [r["from"], r["to"]]), "error"))
        tmdl_roles(path, model, issues)
    elif (path / "model.bim").is_file():
        raw = read_json(contained(path / "model.bim", path)); raw = raw.get("model", raw)
        model = ModelTanimi(model=ModelBilgisi(ad=path.stem))
        for i, table in enumerate(raw.get("tables", [])):
            columns = [Sutun(ad=c["name"], tip=TYPES.get(str(c.get("dataType", "string")).lower(), "string"), gizli=bool(c.get("isHidden")), ifade=c.get("expression") if isinstance(c.get("expression"), str) else None, bicim=c.get("formatString")) for c in table.get("columns", [])]
            measures = [Olcu(ad=m["name"], ifade="\n".join(m["expression"]) if isinstance(m.get("expression"), list) else m.get("expression") or "BLANK()", bicim=m.get("formatString"), klasor=m.get("displayFolder")) for m in table.get("measures", [])]
            model.tablolar.append(Tablo(ad=table["name"], kaynak=TabloKaynak(katman="veri", tablo=f"pbi_{i}"), sutunlar=columns, olculer=measures))
        for r in raw.get("relationships", []):
            add_relationship(model, (r.get("fromTable"), r.get("fromColumn"), r.get("toTable"), r.get("toColumn"), "1:1" if r.get("fromCardinality") == "one" else "*:1" if r.get("toCardinality", "one") == "one" else "M:M", r.get("crossFilteringBehavior") == "bothDirections", r.get("isActive", True)), issues)
        for role in raw.get("roles", []): model.roller.append(deny_role(model, role["name"]))
        if model.roller: issues.append(issue("SECURITY_REVIEW_REQUIRED", "Kaynak roller kapalı alındı; RLS uyarlaması ve kullanıcı ataması gerekli.", severity="error"))
    else:
        return None
    model.veri_kaynaklari = []
    for i, table in enumerate(model.tablolar):
        table.kaynak = TabloKaynak(katman="veri", tablo=f"pbi_{i}")
        table.sorgu = None
    return model


def cached_model(reader, name, issues):
    rows = reader.schema.to_dict(orient="records")
    model = ModelTanimi(model=ModelBilgisi(ad=name))
    try: column_metadata = {(str(c["TableName"]), str(c["Name"])): c for c in reader.tmschema_columns.to_dict(orient="records")}
    except Exception: column_metadata = {}
    for i, table_name in enumerate(reader.tables):
        columns = []
        for row in rows:
            if row["TableName"] != table_name: continue
            kind = str(row["PandasDataType"]).lower()
            tip = "datetime" if "datetime" in kind else "decimal" if "decimal" in kind else "int64" if "int" in kind else "double" if "float" in kind else "bool" if "bool" in kind else "string"
            meta = column_metadata.get((str(table_name), str(row["ColumnName"])), {})
            fmt = meta.get("FormatString")
            columns.append(Sutun(ad=str(row["ColumnName"]), tip=tip, gizli=meta.get("IsHidden") == 1, bicim=fmt if isinstance(fmt, str) else None))
        if columns: model.tablolar.append(Tablo(ad=str(table_name), kaynak=TabloKaynak(katman="veri", tablo=f"pbi_{i}"), sutunlar=columns))
    tables = {t.ad: t for t in model.tablolar}
    for measure in reader.dax_measures.to_dict(orient="records"):
        table_name = measure.get("TableName")
        if not isinstance(table_name, str): continue
        if table_name not in tables:
            table = Tablo(ad=table_name, kaynak=TabloKaynak(katman="veri", tablo=f"pbi_{len(tables)}"))
            model.tablolar.append(table); tables[table_name] = table
        expression = measure.get("Expression")
        folder, fmt = measure.get("DisplayFolder"), measure.get("FormatString")
        tables[table_name].olculer.append(Olcu(ad=str(measure["Name"]), ifade=expression if isinstance(expression, str) and expression else "BLANK()",
                                              klasor=folder if isinstance(folder,str) else None, bicim=fmt if isinstance(fmt,str) else None))
    for r in reader.relationships.to_dict(orient="records"):
        add_relationship(model, (r.get("FromTableName"), r.get("FromColumnName"), r.get("ToTableName"), r.get("ToColumnName"), r.get("Cardinality"), str(r.get("CrossFilteringBehavior", "")).lower() in {"bothdirections", "both", "2"}, r.get("IsActive", True)), issues)
    try:
        rls, ols = reader.rls.to_dict(orient="records"), reader.ols.to_dict(orient="records")
        names = {str(r["RoleName"]) for r in [*rls, *ols]}
        model.roller = [deny_role(model, n) for n in sorted(names)]
        if names: issues.append(issue("SECURITY_REVIEW_REQUIRED", "RLS/OLS rolleri güvenli kapalı durumla alındı; kurallar Floem'de uyarlanmalı ve kullanıcılar yeniden atanmalı.", severity="error"))
    except Exception:
        model.roller = [deny_role(model, "Power BI güvenlik incelemesi")]
        issues.append(issue("SECURITY_REVIEW_REQUIRED", "Kaynak güvenlik metadatası okunamadı; izleyici erişimi kapatıldı.", severity="error"))
    return model
