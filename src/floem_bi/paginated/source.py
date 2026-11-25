"""Model ve RLS derleyicisi üzerinden detay satırları. Tekrarlanan kayıtlar korunur."""

from ..compiler.sqlgen import CompiledQuery, SqlGenerator
from ..compiler.table_query import Scope, TablePlan

MAX_ROWS = 100_000


def used_fields(template):
    fields = {x.field for x in [*template.sort, *template.groups, *template.params]}
    for band in template.bands:
        for o in band.objects:
            fields.update([o.field, o.column, o.measure])
            if o.rule:
                fields.add(o.rule.field)
            if o.formula:
                fields.update([o.formula.field, o.formula.other])
                if o.formula.condition:
                    fields.add(o.formula.condition.field)
    return sorted(fields - {""})


class SnapshotSource:
    def __init__(self, model, engine, user=None, roles=None):
        self.model, self.engine = model, engine
        self.generator = SqlGenerator(model, "duckdb", user=user, roles=roles or [])
        self.cache = {}

    def rows(self, template, link=""):
        names = sorted(set(used_fields(template)) | ({link} if link else set()))
        if not template.table:
            if names:
                raise ValueError("Veri alanlarını kullanmak için raporun model tablosunu seçin.")
            return [{}]
        key = (template.table, tuple(names))
        if key not in self.cache:
            table = self.model.table(template.table)
            fields = [self.model.column(table.ad, n)[0] for n in names]
            plan = TablePlan(self.generator)
            scope = Scope(plan.cte("SELECT 1 AS scope_id"), "scope_id", ())
            rows = plan.scan(table.ad, fields, scope)
            ctes = ", ".join(f"{name} AS ({sql})" for sql, name in plan.ctes.items())
            projection = ", ".join(c.alias for c in rows.columns) or "1"
            sql = f"WITH {ctes} SELECT {projection} FROM {rows.name} LIMIT {MAX_ROWS + 1}"
            data = self.engine.execute(CompiledQuery(sql, "duckdb", names, set())).rows
            if len(data) > MAX_ROWS:
                raise ValueError(
                    f"{table.ad} için {MAX_ROWS} satır sınırı aşıldı. Daha dar bir kaynak sorgusu seçin."
                )
            self.cache[key] = [dict(zip(names, values)) for values in data]
        return self.cache[key]
