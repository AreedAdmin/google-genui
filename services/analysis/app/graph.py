"""networkx symbol / import / call / type graphs built from parsed files.

Graphs
------
* ``symbols``      : dict[symbol_id -> SymbolNode]            (the node table)
* ``import_graph`` : DiGraph  file -> file   (edge attr: module, names)
* ``call_graph``   : DiGraph  caller_id -> callee_id   (symbol-level)
* ``type_graph``   : DiGraph  symbol_id -> type_id     (symbol references type)
* ``file_symbols`` : dict[file -> list[symbol_id]]    (file<->symbol map)
* ``name_index``   : dict[name -> set[symbol_id]]     (for fuzzy resolution)

The whole structure is JSON-serialisable via ``to_dict`` / ``from_dict`` so it
can be cached in Redis and rebuilt without re-parsing.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

import networkx as nx

from .models import (
    CallEdge,
    ImportEdge,
    SymbolNode,
    TypeRefEdge,
)
from .parser import (
    FileParseResult,
    ParsedImport,
    _resolve_module_path,
)


@dataclass
class SymbolGraph:
    project_id: str
    commit: str
    index_id: str

    symbols: dict[str, SymbolNode] = field(default_factory=dict)
    import_graph: nx.DiGraph = field(default_factory=nx.DiGraph)
    call_graph: nx.DiGraph = field(default_factory=nx.DiGraph)
    type_graph: nx.DiGraph = field(default_factory=nx.DiGraph)
    file_symbols: dict[str, list[str]] = field(default_factory=dict)
    name_index: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    # Raw import edges (preserve unresolved/external ones for the API response).
    raw_imports: list[ImportEdge] = field(default_factory=list)
    # Raw call/type edges with their resolution status.
    raw_calls: list[CallEdge] = field(default_factory=list)
    raw_type_refs: list[TypeRefEdge] = field(default_factory=list)
    skipped_files: int = 0
    languages: list[str] = field(default_factory=list)

    # ----------------------------------------------------------------- stats
    def stats(self) -> dict[str, int | list[str]]:
        return {
            "files": len(self.file_symbols),
            "symbols": len(self.symbols),
            "imports": self.import_graph.number_of_edges(),
            "calls": self.call_graph.number_of_edges(),
            "type_refs": self.type_graph.number_of_edges(),
            "exports": sum(1 for s in self.symbols.values() if s.exported),
            "skipped_files": self.skipped_files,
            "languages": list(self.languages),
        }

    # ------------------------------------------------------- query helpers
    def callers_of(self, symbol_id: str) -> set[str]:
        """Direct callers (reverse of the call graph)."""
        if symbol_id not in self.call_graph:
            return set()
        return set(self.call_graph.predecessors(symbol_id))

    def transitive_callers(self, symbol_id: str, max_depth: int | None = None) -> set[str]:
        """All symbols that (transitively) reach ``symbol_id`` via the call graph."""
        if symbol_id not in self.call_graph:
            return set()
        rev = self.call_graph.reverse(copy=False)
        if max_depth is None:
            reached = nx.descendants(rev, symbol_id)
        else:
            reached = set()
            frontier = {symbol_id}
            for _ in range(max_depth):
                nxt: set[str] = set()
                for n in frontier:
                    nxt |= set(rev.successors(n))
                nxt -= reached
                nxt.discard(symbol_id)
                if not nxt:
                    break
                reached |= nxt
                frontier = nxt
        reached.discard(symbol_id)
        return reached

    def type_referrers(self, type_id: str) -> set[str]:
        """Symbols that reference the given type symbol."""
        if type_id not in self.type_graph:
            return set()
        return set(self.type_graph.predecessors(type_id))

    def file_of(self, symbol_id: str) -> str | None:
        sym = self.symbols.get(symbol_id)
        return sym.file if sym else None

    # ---------------------------------------------------- serialisation
    def to_dict(self) -> dict:
        return {
            "project_id": self.project_id,
            "commit": self.commit,
            "index_id": self.index_id,
            "symbols": {k: v.model_dump() for k, v in self.symbols.items()},
            "import_edges": [
                {"from": u, "to": v, **d}
                for u, v, d in self.import_graph.edges(data=True)
            ],
            "call_edges": [
                {"from": u, "to": v} for u, v in self.call_graph.edges()
            ],
            "type_edges": [
                {"from": u, "to": v} for u, v in self.type_graph.edges()
            ],
            "file_symbols": self.file_symbols,
            "raw_imports": [e.model_dump() for e in self.raw_imports],
            "raw_calls": [e.model_dump() for e in self.raw_calls],
            "raw_type_refs": [e.model_dump() for e in self.raw_type_refs],
            "skipped_files": self.skipped_files,
            "languages": self.languages,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SymbolGraph":
        g = cls(
            project_id=data["project_id"],
            commit=data["commit"],
            index_id=data["index_id"],
        )
        g.symbols = {k: SymbolNode(**v) for k, v in data.get("symbols", {}).items()}
        g.file_symbols = data.get("file_symbols", {})
        g.skipped_files = data.get("skipped_files", 0)
        g.languages = data.get("languages", [])
        g.raw_imports = [ImportEdge(**e) for e in data.get("raw_imports", [])]
        g.raw_calls = [CallEdge(**e) for e in data.get("raw_calls", [])]
        g.raw_type_refs = [TypeRefEdge(**e) for e in data.get("raw_type_refs", [])]

        for e in data.get("import_edges", []):
            attrs = {k: v for k, v in e.items() if k not in ("from", "to")}
            g.import_graph.add_edge(e["from"], e["to"], **attrs)
        for e in data.get("call_edges", []):
            g.call_graph.add_edge(e["from"], e["to"])
        for e in data.get("type_edges", []):
            g.type_graph.add_edge(e["from"], e["to"])

        # Rebuild the in-memory name index.
        g.name_index = defaultdict(set)
        for sid, sym in g.symbols.items():
            g.name_index[sym.name].add(sid)
        return g

    # ------------------------------------------------ API projections
    def symbol_nodes(self) -> list[SymbolNode]:
        return list(self.symbols.values())

    def import_edges(self) -> list[ImportEdge]:
        return list(self.raw_imports)

    def call_edges(self) -> list[CallEdge]:
        return list(self.raw_calls)

    def type_edges(self) -> list[TypeRefEdge]:
        return list(self.raw_type_refs)


def build_graph(
    project_id: str,
    commit: str,
    index_id: str,
    file_results: list[FileParseResult],
    all_files: set[str],
    skipped_files: int,
    languages: list[str],
) -> SymbolGraph:
    """Assemble a :class:`SymbolGraph` from per-file parse results."""
    g = SymbolGraph(project_id=project_id, commit=commit, index_id=index_id)
    g.skipped_files = skipped_files
    g.languages = languages

    # 1) Symbol table + file<->symbol map + name index + export-name resolution.
    #    exported_in[file][name] -> symbol_id  (for import resolution).
    exported_in: dict[str, dict[str, str]] = defaultdict(dict)
    for fr in file_results:
        g.import_graph.add_node(fr.file)
        ids: list[str] = []
        for sym in fr.symbols:
            node = SymbolNode(
                id=sym.id,
                name=sym.name,
                file=sym.file,
                kind=sym.kind,  # type: ignore[arg-type]
                exported=sym.exported,
                start_line=sym.start_line,
                end_line=sym.end_line,
                signature=sym.signature,
            )
            # Last write wins on duplicate ids within a file (rare).
            g.symbols[node.id] = node
            ids.append(node.id)
            g.name_index[node.name].add(node.id)
            g.call_graph.add_node(node.id)
            if node.exported:
                exported_in[fr.file][node.name] = node.id
        g.file_symbols[fr.file] = ids

    # 2) Import graph (file -> resolved file) + raw import records.
    for fr in file_results:
        for imp in fr.imports:
            target = _resolve_module_path(imp.module, fr.file, all_files)
            g.raw_imports.append(
                ImportEdge(
                    from_file=fr.file,
                    to_file=target,
                    module=imp.module,
                    names=imp.names,
                )
            )
            if target is not None:
                g.import_graph.add_edge(
                    fr.file, target, module=imp.module, names=imp.names
                )

    # 3) Call graph. Resolve callee names to symbol ids, preferring same-file
    #    decls, then imported names from resolved import targets, then any
    #    unique global match.
    #    imported_names[file][name] -> symbol_id
    imported_names: dict[str, dict[str, str]] = defaultdict(dict)
    for fr in file_results:
        for imp in fr.imports:
            target = _resolve_module_path(imp.module, fr.file, all_files)
            if target is None:
                continue
            for nm in imp.names:
                resolved = exported_in.get(target, {}).get(nm)
                if resolved:
                    imported_names[fr.file][nm] = resolved

    same_file_names: dict[str, dict[str, str]] = defaultdict(dict)
    for sid, sym in g.symbols.items():
        same_file_names[sym.file][sym.name] = sid

    for fr in file_results:
        for call in fr.calls:
            callee_id = _resolve_callee(
                call.callee_name,
                fr.file,
                same_file_names,
                imported_names,
                g.name_index,
            )
            g.raw_calls.append(
                CallEdge(
                    caller=call.caller_symbol or f"{fr.file}#<module>",
                    callee_name=call.callee_name,
                    callee=callee_id,
                )
            )
            if call.caller_symbol and callee_id and call.caller_symbol != callee_id:
                g.call_graph.add_edge(call.caller_symbol, callee_id)

    # 4) Type graph. Resolve type names to interface/type/class/enum symbols.
    type_symbol_index: dict[str, set[str]] = defaultdict(set)
    for sid, sym in g.symbols.items():
        if sym.kind in ("type", "interface", "class", "enum"):
            type_symbol_index[sym.name].add(sid)

    for fr in file_results:
        for tref in fr.type_refs:
            type_id = _resolve_type(
                tref.type_name, fr.file, same_file_names, imported_names, type_symbol_index
            )
            g.raw_type_refs.append(
                TypeRefEdge(
                    symbol=tref.symbol or f"{fr.file}#<module>",
                    type_name=tref.type_name,
                    type_id=type_id,
                )
            )
            if tref.symbol and type_id and tref.symbol != type_id:
                g.type_graph.add_edge(tref.symbol, type_id)

    return g


def _resolve_callee(
    name: str,
    file: str,
    same_file_names: dict[str, dict[str, str]],
    imported_names: dict[str, dict[str, str]],
    name_index: dict[str, set[str]],
) -> str | None:
    if name in same_file_names.get(file, {}):
        return same_file_names[file][name]
    if name in imported_names.get(file, {}):
        return imported_names[file][name]
    matches = name_index.get(name)
    if matches and len(matches) == 1:
        return next(iter(matches))
    return None


def _resolve_type(
    name: str,
    file: str,
    same_file_names: dict[str, dict[str, str]],
    imported_names: dict[str, dict[str, str]],
    type_symbol_index: dict[str, set[str]],
) -> str | None:
    # Prefer a same-file or imported binding that is itself a type-like symbol.
    cand = same_file_names.get(file, {}).get(name) or imported_names.get(file, {}).get(name)
    if cand:
        return cand
    matches = type_symbol_index.get(name)
    if matches and len(matches) == 1:
        return next(iter(matches))
    return None
