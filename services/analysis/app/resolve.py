"""Touch-set resolution (Stage 3) and blast-radius expansion.

Maps a Planner-predicted touch-set onto the real symbol graph (fuzzy match on
name + file + kind), flags unresolved predictions as NEW symbols, then expands
the blast radius:

  * modify(symbol)        -> file + reverse-call-graph callers
  * change_signature(sym) -> all call sites (hard dependency)
  * modify(type)          -> all symbols referencing the type

Returns the canonical ``resolved`` shape (data-model §5) plus a confidence in
[0,1]; unresolved predictions lower confidence and surface as new symbols.
"""

from __future__ import annotations

from difflib import SequenceMatcher

from .graph import SymbolGraph
from .models import (
    BlastRadius,
    PredictedSymbol,
    PredictedTouchSet,
    ResolutionMatch,
    ResolvedTouchSet,
    SymbolNode,
)

# Below this fuzzy score we treat a prediction as a NEW (unresolved) symbol.
MATCH_THRESHOLD = 0.55

# Heuristic kinds that indicate schema / config surfaces.
_SCHEMA_KINDS = {"table", "column", "migration", "schema"}
_CONFIG_KINDS = {"config", "env", "route", "di", "registration"}


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def _name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _file_basename(path: str | None) -> str:
    if not path:
        return ""
    return path.replace("\\", "/").rsplit("/", 1)[-1]


def _score_candidate(pred: PredictedSymbol, sym: SymbolNode) -> float:
    """Fuzzy score in [0,1] of how well ``sym`` matches ``pred``."""
    name_score = _name_similarity(pred.name, sym.name)

    # File component: exact path > same basename > unknown/none.
    if pred.file:
        if _norm(pred.file) == _norm(sym.file):
            file_score = 1.0
        elif _file_basename(pred.file) and _file_basename(pred.file) == _file_basename(
            sym.file
        ):
            file_score = 0.75
        elif _norm(pred.file) in _norm(sym.file) or _norm(sym.file) in _norm(pred.file):
            file_score = 0.5
        else:
            file_score = 0.0
    else:
        file_score = 0.5  # no file hint — neutral

    # Kind component.
    pk = _norm(pred.kind)
    if not pk or pk == "unknown":
        kind_score = 0.5
    elif pk == _norm(sym.kind):
        kind_score = 1.0
    elif {pk, _norm(sym.kind)} <= {"function", "method", "variable"}:
        kind_score = 0.7  # callable-ish kinds are interchangeable
    else:
        kind_score = 0.2

    # Weighted: name dominates, file is a strong disambiguator, kind a tiebreak.
    return 0.55 * name_score + 0.30 * file_score + 0.15 * kind_score


def _best_match(
    pred: PredictedSymbol, graph: SymbolGraph
) -> tuple[str | None, float]:
    """Return (best_symbol_id, score). Prefers name-indexed candidates."""
    # Narrow candidate set: exact-name first, else all symbols (bounded by name
    # index when the name is close enough is too restrictive, so scan all).
    candidates: list[SymbolNode]
    exact = graph.name_index.get(pred.name)
    if exact:
        candidates = [graph.symbols[i] for i in exact]
        # Also include near-name matches when there is a file hint to help.
        if pred.file:
            for sid in graph.file_symbols.get(pred.file, []):
                node = graph.symbols.get(sid)
                if node and node not in candidates:
                    candidates.append(node)
    else:
        candidates = list(graph.symbols.values())

    best_id: str | None = None
    best_score = 0.0
    for sym in candidates:
        score = _score_candidate(pred, sym)
        if score > best_score:
            best_score = score
            best_id = sym.id
    return best_id, best_score


def resolve_touchset(
    graph: SymbolGraph, predicted: PredictedTouchSet
) -> tuple[ResolvedTouchSet, BlastRadius, float, list[ResolutionMatch], list[str]]:
    """Resolve a predicted touch-set to real symbols and expand the blast radius."""
    resolved = ResolvedTouchSet()
    matches: list[ResolutionMatch] = []
    new_symbols: list[str] = []

    files: set[str] = set()
    symbols: set[str] = set()
    signatures_changed: set[str] = set()
    schema_keys: set[str] = set(predicted.schema_keys)
    config_keys: set[str] = set(predicted.config_keys)

    # Blast-radius accumulators.
    callers: set[str] = set()
    sig_call_sites: set[str] = set()
    type_refs: set[str] = set()

    # modify + add + delete all contribute to the touch-set; modify/delete also
    # contribute to the blast radius (add introduces new providers, not impact).
    score_total = 0.0
    score_count = 0

    def _classify_cross_cutting(pred: PredictedSymbol) -> bool:
        """Route schema/config-kind predictions into the right key sets."""
        k = _norm(pred.kind)
        if k in _SCHEMA_KINDS:
            schema_keys.add(pred.name)
            return True
        if k in _CONFIG_KINDS and k != "route":
            config_keys.add(pred.name)
            if pred.file:
                files.add(pred.file)
            return True
        if k == "route":
            config_keys.add(pred.name)
            if pred.file:
                files.add(pred.file)
            return True
        return False

    def _handle(pred: PredictedSymbol, *, expand: bool, is_signature_hint: bool) -> None:
        nonlocal score_total, score_count
        if _classify_cross_cutting(pred):
            # Still record a (low-weight) confidence contribution.
            score_total += 0.7
            score_count += 1
            return

        best_id, score = _best_match(pred, graph)
        is_new = best_id is None or score < MATCH_THRESHOLD
        matches.append(
            ResolutionMatch(
                predicted_name=pred.name,
                predicted_file=pred.file,
                predicted_kind=pred.kind,
                matched_symbol=None if is_new else best_id,
                score=round(score, 4),
                is_new=is_new,
            )
        )
        score_count += 1
        score_total += 0.0 if is_new else score

        if is_new:
            # NEW symbol — record its intended file/id but no blast radius.
            new_id = f"{pred.file}#{pred.name}" if pred.file else f"<new>#{pred.name}"
            new_symbols.append(new_id)
            symbols.add(new_id)
            if pred.file:
                files.add(pred.file)
            return

        sym = graph.symbols[best_id]
        symbols.add(best_id)
        files.add(sym.file)

        if not expand:
            return

        # modify(symbol) -> callers may break.
        # NOTE: use in-place ``.update()`` (not ``|=``) so these closed-over
        # sets are mutated rather than rebound as locals.
        direct_callers = graph.callers_of(best_id)
        callers.update(direct_callers)

        signature_change = is_signature_hint or pred.change_signature
        if signature_change:
            if sym.signature:
                signatures_changed.add(f"{best_id}::{sym.signature}")
            else:
                signatures_changed.add(best_id)
            # change_signature -> ALL call sites are a hard dependency.
            sig_call_sites.update(direct_callers)

        # modify(type) -> all referencing symbols.
        if _norm(sym.kind) in ("type", "interface", "enum", "class"):
            type_refs.update(graph.type_referrers(best_id))

    for pred in predicted.modify:
        _handle(pred, expand=True, is_signature_hint=pred.change_signature)
    for pred in predicted.delete:
        # Deleting a symbol breaks every caller — treat like a signature change.
        _handle(pred, expand=True, is_signature_hint=True)
    for pred in predicted.add:
        _handle(pred, expand=False, is_signature_hint=False)

    # Fold blast-radius symbols/files into the resolved touch-set's reachable
    # impact (callers + type refs become part of files/symbols touched).
    impacted_symbols = callers | sig_call_sites | type_refs
    radius_files: set[str] = set()
    for sid in impacted_symbols:
        f = graph.file_of(sid)
        if f:
            radius_files.add(f)

    resolved.files = sorted(files)
    resolved.symbols = sorted(symbols)
    resolved.signatures_changed = sorted(signatures_changed)
    resolved.schema_keys = sorted(schema_keys)
    resolved.config_keys = sorted(config_keys)

    blast = BlastRadius(
        callers=sorted(callers),
        signature_call_sites=sorted(sig_call_sites),
        type_refs=sorted(type_refs),
        files=sorted(radius_files | files),
        symbols=sorted(impacted_symbols | symbols),
    )

    confidence = _confidence(score_total, score_count, new_symbols)
    return resolved, blast, confidence, matches, new_symbols


def _confidence(score_total: float, score_count: int, new_symbols: list[str]) -> float:
    """Aggregate resolution confidence in [0,1].

    Mean match score, penalised by the fraction of unresolved (new) symbols so
    that lots of misses force a lower confidence (Stage 3: uncertainty ->
    soft_order rather than a hard claim).
    """
    if score_count == 0:
        return 1.0  # empty touch-set is trivially "resolved"
    mean = score_total / score_count
    new_fraction = len(new_symbols) / score_count if score_count else 0.0
    conf = mean * (1.0 - 0.5 * new_fraction)
    return round(max(0.0, min(1.0, conf)), 4)


# --------------------------------------------------------------------------- #
# /callgraph-impact — reverse reachability for a signature/body change         #
# --------------------------------------------------------------------------- #


def callgraph_impact(
    graph: SymbolGraph, symbol: str, kind: str
) -> tuple[list[str], list[str], str | None]:
    """Reverse-reachable symbols/files affected by changing ``symbol``.

    ``kind == "signature"`` -> transitive callers are all affected (a changed
    contract ripples up the call graph). ``kind == "body"`` -> only direct
    callers are conservatively flagged (internal change, shallower ripple).
    """
    root = _resolve_symbol_ref(graph, symbol)
    if root is None:
        return [], [], None

    if kind == "body":
        affected = graph.callers_of(root)
    else:  # signature
        affected = graph.transitive_callers(root)

    affected_files: set[str] = set()
    for sid in affected:
        f = graph.file_of(sid)
        if f:
            affected_files.add(f)
    # Include the root's own file.
    root_file = graph.file_of(root)
    if root_file:
        affected_files.add(root_file)

    return sorted(affected), sorted(affected_files), root


def _resolve_symbol_ref(graph: SymbolGraph, symbol: str) -> str | None:
    """Accept a full id ('<file>#<name>') or a bare name."""
    if symbol in graph.symbols:
        return symbol
    if "#" in symbol:
        # id-shaped but not present -> no match.
        return None
    matches = graph.name_index.get(symbol)
    if matches:
        if len(matches) == 1:
            return next(iter(matches))
        # Ambiguous bare name: pick a deterministic (sorted) choice.
        return sorted(matches)[0]
    return None
