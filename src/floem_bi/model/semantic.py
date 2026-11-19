"""Yüklenmiş semantik model: ad çözümleme, ilişki grafiği, doğrulama."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path

import yaml

from ..dax import ast, parse
from ..dax.lexer import DaxSyntaxError
from .schema import Iliski, ModelTanimi, Olcu, Sutun, Tablo, parse_column_ref


class ModelError(Exception):
    pass


@dataclass(frozen=True, order=True)
class ColKey:
    """Kanonik sütun anahtarı (modeldeki yazımıyla)."""
    table: str
    column: str

    def __str__(self) -> str:
        return f"{self.table}[{self.column}]"


@dataclass(frozen=True)
class Edge:
    """Çok → bir yönünde ilişki kenarı."""
    from_col: ColKey
    to_col: ColKey
    inner: bool


class SemanticModel:
    def __init__(self, tanim: ModelTanimi):
        self.tanim = tanim
        self._tables = {t.ad.lower(): t for t in tanim.tablolar}
        if len(self._tables) != len(tanim.tablolar):
            raise ModelError("Tablo adları benzersiz olmalı (büyük/küçük harf duyarsız)")
        self._measures: dict[str, tuple[Tablo, Olcu]] = {}
        for t in tanim.tablolar:
            cols = {c.ad.lower() for c in t.sutunlar}
            if len(cols) != len(t.sutunlar):
                raise ModelError(f"{t.ad}: sütun adları benzersiz olmalı")
            for m in t.olculer:
                key = m.ad.lower()
                if key in self._measures:
                    raise ModelError(f"Ölçü adı model genelinde benzersiz olmalı: {m.ad}")
                if key in cols:
                    raise ModelError(f"{t.ad}: '{m.ad}' hem sütun hem ölçü adı olamaz")
                self._measures[key] = (t, m)
        self._edges: dict[str, list[Edge]] = {}
        self.warnings: list[str] = []
        for r in tanim.iliskiler:
            self._add_relationship(r)

    # --- yükleme ------------------------------------------------------------
    @classmethod
    def from_yaml(cls, path: str | Path) -> "SemanticModel":
        data = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
        return cls(ModelTanimi.model_validate(data))

    # --- ad çözümleme -------------------------------------------------------
    def table(self, name: str) -> Tablo:
        t = self._tables.get(name.lower())
        if t is None:
            raise ModelError(f"Tablo bulunamadı: {name}")
        return t

    def has_table(self, name: str) -> bool:
        return name.lower() in self._tables

    def column(self, table: str, column: str) -> tuple[ColKey, Sutun]:
        t = self.table(table)
        for c in t.sutunlar:
            if c.ad.lower() == column.lower():
                return ColKey(t.ad, c.ad), c
        raise ModelError(f"Sütun bulunamadı: {t.ad}[{column}]")

    def col_key(self, ref: str) -> ColKey:
        t, c = parse_column_ref(ref)
        return self.column(t, c)[0]

    def sutun(self, key: ColKey) -> Sutun:
        return self.column(key.table, key.column)[1]

    def measure(self, name: str) -> tuple[Tablo, Olcu] | None:
        return self._measures.get(name.lower())

    @property
    def measures(self) -> list[Olcu]:
        return [m for _, m in self._measures.values()]

    def date_table(self) -> Tablo | None:
        for t in self.tanim.tablolar:
            if t.tarih_tablosu is not None:
                return t
        return None

    # --- ilişki grafiği -----------------------------------------------------
    def _add_relationship(self, r: Iliski) -> None:
        f = self.col_key(r.kimden)
        to = self.col_key(r.kime)
        if not r.aktif:
            return  # pasif ilişkiler USERELATIONSHIP ile (v1)
        if r.filtre_yonu == "cift":
            # MVP: çift yönlü filtre henüz derlenmiyor; tek yön gibi davranılır
            self.warnings.append(f"{r.kimden} ↔ {r.kime}: çift yönlü filtre MVP'de tek yön olarak uygulanır")
        self._edges.setdefault(f.table.lower(), []).append(Edge(f, to, r.referans_butunlugu))

    def relationship_between(self, a: ColKey, b: ColKey) -> tuple[ColKey, ColKey] | None:
        """İki sütun arasındaki ilişkiyi (etkin ya da pasif) (çok, bir) sırasıyla döndürür."""
        for r in self.tanim.iliskiler:
            many, one = self.col_key(r.kimden), self.col_key(r.kime)
            if {many, one} == {a, b}:
                return many, one
        return None

    def _edges_with(self, activate: frozenset) -> dict[str, list[Edge]]:
        """USERELATIONSHIP: verilen ilişkiler etkinleşir; aynı iki tablo arasındaki etkin ilişki devre dışı kalır."""
        if not activate:
            return self._edges
        edges = {k: list(v) for k, v in self._edges.items()}
        for many, one in activate:
            pair = {many.table.lower(), one.table.lower()}
            for k in edges:
                edges[k] = [e for e in edges[k] if {e.from_col.table.lower(), e.to_col.table.lower()} != pair]
            edges.setdefault(many.table.lower(), []).append(Edge(many, one, False))
        return edges

    def path(self, base: str, target: str, activate: frozenset = frozenset()) -> list[Edge] | None:
        """`base` tablosundan `target`a çok→bir yönünde en kısa yol (filtre yayılım yönünün tersi)."""
        base_l, target_l = base.lower(), target.lower()
        if base_l == target_l:
            return []
        all_edges = self._edges_with(activate)
        seen = {base_l}
        queue: deque[tuple[str, list[Edge]]] = deque([(base_l, [])])
        while queue:
            node, p = queue.popleft()
            for e in all_edges.get(node, []):
                nxt = e.to_col.table.lower()
                if nxt in seen:
                    continue
                np = p + [e]
                if nxt == target_l:
                    return np
                seen.add(nxt)
                queue.append((nxt, np))
        return None

    def reachable(self, base: str, target: str, activate: frozenset = frozenset()) -> bool:
        return self.path(base, target, activate) is not None

    # --- doğrulama ----------------------------------------------------------
    @cached_property
    def parsed_measures(self) -> dict[str, ast.Node]:
        out = {}
        for key, (_, m) in self._measures.items():
            out[key] = parse(m.ifade)
        return out

    def validate(self) -> list[str]:
        """Model hatalarını döndürür (boş liste = geçerli)."""
        errors: list[str] = []
        deps: dict[str, set[str]] = {}
        for key, (t, m) in self._measures.items():
            try:
                node = parse(m.ifade)
            except DaxSyntaxError as e:
                errors.append(f"[{m.ad}] {e.render()}")
                continue
            refs: set[str] = set()
            self._collect(node, refs, errors, m.ad)
            deps[key] = refs
        for t in self.tanim.tablolar:
            for c in t.sutunlar:
                if c.ifade:
                    try:
                        parse(c.ifade)
                    except DaxSyntaxError as e:
                        errors.append(f"[{t.ad}[{c.ad}]] {e.render()}")
        # döngüsel bağımlılık
        state: dict[str, int] = {}

        def visit(k: str, stack: list[str]) -> None:
            if state.get(k) == 2:
                return
            if state.get(k) == 1:
                cycle = stack[stack.index(k):] + [k]
                names = [self._measures[x][1].ad for x in cycle]
                errors.append("Döngüsel ölçü bağımlılığı: " + " → ".join(names))
                return
            state[k] = 1
            for d in deps.get(k, ()):
                visit(d, stack + [k])
            state[k] = 2

        for k in deps:
            visit(k, [])
        return errors

    def _collect(self, node: ast.Node, refs: set[str], errors: list[str], owner: str) -> None:
        if isinstance(node, ast.BracketRef):
            if self.measure(node.name):
                refs.add(node.name.lower())
            else:
                errors.append(f"[{owner}] Ölçü bulunamadı: [{node.name}]")
        elif isinstance(node, ast.ColumnRef):
            try:
                self.column(node.table, node.column)
            except ModelError as e:
                errors.append(f"[{owner}] {e}")
        for child in _children(node):
            self._collect(child, refs, errors, owner)


def _children(node: ast.Node) -> list[ast.Node]:
    if isinstance(node, ast.Call):
        return list(node.args)
    if isinstance(node, ast.Binary):
        return [node.left, node.right]
    if isinstance(node, ast.Unary):
        return [node.operand]
    if isinstance(node, ast.TableConstructor):
        return list(node.items)
    if isinstance(node, ast.VarBlock):
        return [e for _, e in node.variables] + [node.body]
    return []


def find_ambiguity(iliskiler: list[Iliski]) -> Iliski | None:
    """Motorun çok→bir grafiğinde döngü veya ikinci yönlü yol açan ilişki.

    İki olgu tablosunun aynı tarih ve müşteri boyutuna bağlanması geçerlidir.
    Yönsüz döngü testi bu olağan yıldız modelini yanlışlıkla reddederdi.
    Çift yön seçimi motorun mevcut tek yön davranışıyla değerlendirilir;
    SemanticModel bu sınırlama için ayrıca uyarı verir.
    """
    graph: dict[str, list[str]] = {}
    for r in iliskiler:
        if not r.aktif:
            continue
        a = parse_column_ref(r.kimden)[0].lower()
        b = parse_column_ref(r.kime)[0].lower()
        graph.setdefault(a, []).append(b)
        graph.setdefault(b, [])
        for start in graph:
            counts: dict[str, int] = {}
            visiting: set[str] = set()

            def visit(node: str) -> bool:
                counts[node] = counts.get(node, 0) + 1
                if node in visiting or counts[node] > 1:
                    return True
                visiting.add(node)
                if any(visit(nxt) for nxt in graph[node]):
                    return True
                visiting.remove(node)
                return False

            if visit(start):
                return r
    return None
