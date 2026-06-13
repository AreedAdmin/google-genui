"""Pydantic request/response models for the analysis service.

Field names that cross the wire to the Node engine MUST match the canonical
``touch_set`` shape in ``plan/01-architecture/data-model.md`` §5:

    resolved = { files, symbols, signatures_changed, schema_keys, config_keys }

and the edge ``evidence`` shape. Keep these names stable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --------------------------------------------------------------------------- #
# Shared symbol-graph primitives                                              #
# --------------------------------------------------------------------------- #

SymbolKind = Literal[
    "function",
    "class",
    "interface",
    "type",
    "enum",
    "variable",
    "method",
    "export",
    "route",
    "table",
    "config",
    "unknown",
]


class SymbolNode(BaseModel):
    """A declared symbol. ``id`` is the canonical ``"<file>#<name>"`` ref."""

    id: str = Field(..., description="Canonical ref: '<file>#<name>'.")
    name: str
    file: str
    kind: SymbolKind = "unknown"
    exported: bool = False
    start_line: int | None = None
    end_line: int | None = None
    signature: str | None = Field(
        default=None, description="Best-effort source signature string."
    )


class ImportEdge(BaseModel):
    """A file→file import dependency, with the imported names if known."""

    from_file: str
    to_file: str | None = Field(
        default=None,
        description="Resolved target file, or None for an external/bare module.",
    )
    module: str = Field(..., description="Raw module specifier as written.")
    names: list[str] = Field(default_factory=list)


class CallEdge(BaseModel):
    """A symbol→symbol call/use edge (caller -> callee)."""

    caller: str = Field(..., description="Caller symbol id.")
    callee_name: str = Field(..., description="Referenced name (may be unresolved).")
    callee: str | None = Field(default=None, description="Resolved callee symbol id.")


class TypeRefEdge(BaseModel):
    """A symbol→type reference edge (symbol uses a type)."""

    symbol: str = Field(..., description="Referencing symbol id.")
    type_name: str
    type_id: str | None = Field(default=None, description="Resolved type symbol id.")


# --------------------------------------------------------------------------- #
# /index                                                                      #
# --------------------------------------------------------------------------- #


class IndexRequest(BaseModel):
    project_id: str
    repo_path: str = Field(..., description="Path to a checked-out repo directory.")
    commit: str


class IndexStats(BaseModel):
    files: int = 0
    symbols: int = 0
    imports: int = 0
    calls: int = 0
    type_refs: int = 0
    exports: int = 0
    skipped_files: int = 0
    languages: list[str] = Field(default_factory=list)


class IndexResponse(BaseModel):
    index_id: str
    stats: IndexStats


# --------------------------------------------------------------------------- #
# GET /symbol-graph                                                           #
# --------------------------------------------------------------------------- #


class SymbolGraphResponse(BaseModel):
    index_id: str
    project_id: str
    commit: str
    symbols: list[SymbolNode]
    imports: list[ImportEdge]
    calls: list[CallEdge]
    types: list[TypeRefEdge]
    stats: IndexStats


# --------------------------------------------------------------------------- #
# Predicted touch-set (input from the Planner)                               #
# --------------------------------------------------------------------------- #


class PredictedSymbol(BaseModel):
    """One predicted add/modify/delete entry (data-model §5 ``predicted``)."""

    kind: str = "unknown"
    name: str
    file: str | None = None
    # Optional hint for signature changes, surfaced by the planner.
    change_signature: bool = False


class PredictedTouchSet(BaseModel):
    add: list[PredictedSymbol] = Field(default_factory=list)
    modify: list[PredictedSymbol] = Field(default_factory=list)
    delete: list[PredictedSymbol] = Field(default_factory=list)
    # Optional cross-cutting hints the planner may already know.
    schema_keys: list[str] = Field(default_factory=list)
    config_keys: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Resolved touch-set (data-model §5 ``resolved`` — names are CANONICAL)        #
# --------------------------------------------------------------------------- #


class ResolvedTouchSet(BaseModel):
    files: list[str] = Field(default_factory=list)
    symbols: list[str] = Field(default_factory=list)
    signatures_changed: list[str] = Field(default_factory=list)
    schema_keys: list[str] = Field(default_factory=list)
    config_keys: list[str] = Field(default_factory=list)


class ResolutionMatch(BaseModel):
    """Audit record: how a predicted entry mapped to the real graph."""

    predicted_name: str
    predicted_file: str | None = None
    predicted_kind: str = "unknown"
    matched_symbol: str | None = None
    score: float = 0.0
    is_new: bool = False


class BlastRadius(BaseModel):
    """Expanded impact set beyond the directly-touched symbols."""

    callers: list[str] = Field(
        default_factory=list, description="Symbol ids that call a modified symbol."
    )
    signature_call_sites: list[str] = Field(
        default_factory=list,
        description="Caller symbol ids hitting a changed signature (hard dep).",
    )
    type_refs: list[str] = Field(
        default_factory=list,
        description="Symbol ids referencing a modified type.",
    )
    files: list[str] = Field(
        default_factory=list, description="All files in the blast radius."
    )
    symbols: list[str] = Field(
        default_factory=list, description="All symbols in the blast radius."
    )


class ResolveTouchsetRequest(BaseModel):
    project_id: str
    commit: str
    predicted_touchset: PredictedTouchSet


class ResolveTouchsetResponse(BaseModel):
    resolved: ResolvedTouchSet
    blast_radius: BlastRadius
    confidence: float = Field(..., ge=0.0, le=1.0)
    matches: list[ResolutionMatch] = Field(default_factory=list)
    new_symbols: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# /overlap                                                                    #
# --------------------------------------------------------------------------- #


class SharedSets(BaseModel):
    # The wire key is ``schema`` (engine §7 contract). We alias it so the Python
    # attribute is ``schema_`` and does not shadow pydantic's deprecated
    # ``BaseModel.schema`` while still (de)serialising as ``schema``.
    model_config = ConfigDict(populate_by_name=True)

    files: list[str] = Field(default_factory=list)
    symbols: list[str] = Field(default_factory=list)
    signatures: list[str] = Field(default_factory=list)
    schema_: list[str] = Field(default_factory=list, alias="schema")
    config: list[str] = Field(default_factory=list)


class OverlapRequest(BaseModel):
    project_id: str
    commit: str
    touchset_a: ResolvedTouchSet
    touchset_b: ResolvedTouchSet


class OverlapResponse(BaseModel):
    overlap_score: float = Field(..., ge=0.0, le=1.0)
    shared: SharedSets
    # True when a hard blocker (shared file or symbol) is present.
    hard_conflict: bool = False


# --------------------------------------------------------------------------- #
# /callgraph-impact                                                           #
# --------------------------------------------------------------------------- #


class CallgraphImpactRequest(BaseModel):
    project_id: str
    commit: str
    symbol: str = Field(..., description="Symbol id ('<file>#<name>') or bare name.")
    kind: Literal["signature", "body"] = "signature"


class CallgraphImpactResponse(BaseModel):
    affected_symbols: list[str] = Field(default_factory=list)
    affected_files: list[str] = Field(default_factory=list)
    root: str | None = None


# --------------------------------------------------------------------------- #
# /health                                                                     #
# --------------------------------------------------------------------------- #


class HealthResponse(BaseModel):
    ok: bool = True
