"""RLS uygulanmış semantik sonucun parametreli araması ve kararlı sayfalaması."""
import hashlib
import json

from ..compiler import CompiledQuery


def paged_result(model, engine, q, compile_for, group, labels, meta, revision, user, roles):
    from .query import QueryError, _num
    page = q.page
    snapshot = hashlib.sha256(json.dumps([revision, getattr(user, "upn", None), roles], sort_keys=True).encode()).hexdigest()
    if page.snapshot is not None and page.snapshot != snapshot:
        raise QueryError("Veri veya erişim kapsamı değişti. İlk sayfadan yeniden yükleyin.")
    scope = q.model_dump(mode="json")
    scope["page"] = {"search": page.search, "column_filters": [f.model_dump(mode="json") for f in page.column_filters]}
    token = hashlib.sha256(json.dumps([revision, getattr(user, "upn", None), roles, scope], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if page.revision is not None and page.revision != token:
        raise QueryError("Veri veya sorgu kapsamı değişti. İlk sayfadan yeniden yükleyin.")
    count = len(group) + len(labels)
    compiled = compile_for(group, None, [])
    aliases = [f'"c{i}"' for i in range(count)]
    source = f'({compiled.sql}) AS _grid({",".join(aliases)})'
    predicates, params = [], []
    text = lambda col: f"lower(coalesce(CAST({col} AS VARCHAR), ''))"
    if page.search:
        predicates.append("(" + " OR ".join(f"contains({text(col)}, lower(?))" for col in aliases) + ")")
        params.extend([page.search] * count)
    for f in page.column_filters:
        if f.index >= count:
            raise QueryError("Filtre sütunu sonuçta yok")
        col = aliases[f.index]
        if f.op in ("blank", "notBlank"):
            condition = f"({col} IS NULL OR CAST({col} AS VARCHAR) = '')"
            predicates.append(f"NOT {condition}" if f.op == "notBlank" else condition)
        elif f.kind == "number":
            # Sayı filtresi yalnız sayısal sonuç türlerinde; dönüşüm hatası/gizli metin sırası yok.
            typ = str(model.sutun(group[f.index]).tip) if f.index < len(group) else str(meta[f.index - len(group)]["type"])
            if typ not in ("int64", "int32", "int", "decimal", "double", "float", "number"):
                raise QueryError("Sayı filtresi sayısal bir sütun ister")
            op = {"equals": "=", "notEqual": "<>", "lessThan": "<", "lessThanOrEqual": "<=", "greaterThan": ">", "greaterThanOrEqual": ">="}.get(f.op)
            predicates.append(f"{col} BETWEEN ? AND ?" if f.op == "inRange" else f"{col} {op} ?")
            params.extend([f.value, f.value2] if f.op == "inRange" else [f.value])
        else:
            if f.op in ("contains", "notContains", "startsWith", "endsWith"):
                fn = {"contains": "contains", "notContains": "contains", "startsWith": "starts_with", "endsWith": "ends_with"}[f.op]
                predicates.append(("NOT " if f.op == "notContains" else "") + f"{fn}({text(col)}, lower(?))")
            else:
                predicates.append(f"{text(col)} {'=' if f.op == 'equals' else '<>'} lower(?)")
            params.append(f.value)
    where = " WHERE " + " AND ".join(predicates) if predicates else ""
    def execute(sql, columns):
        return engine.execute(CompiledQuery(sql, compiled.dialect, columns, compiled.time_keys, params))
    total_rows = execute(f"SELECT count(*) FROM {source}{where}", ["count"]).rows[0][0]
    ordering = [(o.index, o.desc) for o in q.order_by]
    ordering += [(i, False) for i in range(len(group)) if i not in {o.index for o in q.order_by}]
    if not ordering:
        ordering = [(i, False) for i in range(count)]
    order = ",".join(f"{aliases[i]} {'DESC' if desc else 'ASC'} NULLS LAST" for i, desc in ordering)
    result = execute(f"SELECT * FROM {source}{where} ORDER BY {order} LIMIT {page.size} OFFSET {page.offset}", compiled.columns)
    total = None
    if q.totals and group and labels:
        t = engine.execute(compile_for([], None, []))
        if t.rows:
            by_name = dict(zip(t.columns, t.rows[0])); total = [_num(by_name.get(n)) for n in labels]
    columns = [{"name": g.column, "ref": str(g), "kind": "group", "type": model.sutun(g).tip, "format": model.sutun(g).bicim} for g in group]
    columns += [{"name": n, "kind": "value", **m} for n, m in zip(labels, meta)]
    return {"columns": columns, "rows": [[_num(v) for v in row] for row in result.rows], "total": total,
            "truncated": page.offset > 0 or page.offset + len(result.rows) < total_rows,
            "page": {"offset": page.offset, "size": page.size, "totalRows": total_rows,
                     "hasMore": page.offset + len(result.rows) < total_rows, "revision": token, "snapshot": snapshot, "totalScope": "report_filters"}}
