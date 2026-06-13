"""FastAPI app: the Trellis dependency-analysis service.

Endpoints (dependency-inference-engine.md §7):
    POST /index             build symbol/import/call/type graphs for a repo
    GET  /symbol-graph       return the built graphs
    POST /resolve-touchset   map predicted symbols -> real graph + blast radius
    POST /overlap            file/symbol/signature/schema/config overlap scoring
    POST /callgraph-impact   reverse-reachability for a signature/body change
    GET  /health             liveness probe
"""

from __future__ import annotations

import hashlib
import logging
import os

from fastapi import FastAPI, HTTPException, Query

from .cache import graph_cache
from .graph import SymbolGraph, build_graph
from .models import (
    CallgraphImpactRequest,
    CallgraphImpactResponse,
    HealthResponse,
    IndexRequest,
    IndexResponse,
    IndexStats,
    OverlapRequest,
    OverlapResponse,
    ResolveTouchsetRequest,
    ResolveTouchsetResponse,
    SymbolGraphResponse,
)
from .overlap import compute_overlap
from .parser import (
    FileParseResult,
    discover_files,
    grammar_available,
    parse_file,
)
from .resolve import callgraph_impact, resolve_touchset
from .settings import settings

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger("analysis.main")

app = FastAPI(
    title="Trellis Analysis Service",
    version="0.1.0",
    description="tree-sitter + networkx symbol/import/call graphs for grounded "
    "dependency inference (plan/02-agent-system/dependency-inference-engine.md).",
)


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #


def _make_index_id(project_id: str, commit: str) -> str:
    digest = hashlib.sha1(f"{project_id}:{commit}".encode()).hexdigest()[:16]
    return f"idx_{digest}"


def _get_graph_or_404(project_id: str, commit: str) -> SymbolGraph:
    graph = graph_cache.get(project_id, commit)
    if graph is None:
        raise HTTPException(
            status_code=404,
            detail=f"No index for project={project_id} commit={commit}. POST /index first.",
        )
    return graph


def _index_repo(req: IndexRequest) -> SymbolGraph:
    repo_path = os.path.abspath(req.repo_path)
    if not os.path.isdir(repo_path):
        raise HTTPException(status_code=400, detail=f"repo_path not a directory: {repo_path}")

    discovered = discover_files(repo_path)
    all_files = {rel for _, rel in discovered}

    results: list[FileParseResult] = []
    skipped = 0
    for abs_p, rel_p in discovered:
        try:
            res = parse_file(abs_p, rel_p, all_files)
            results.append(res)
        except Exception as exc:  # robustness: skip the file, keep indexing
            skipped += 1
            logger.debug("skipping %s: %s", rel_p, exc)

    # Which configured languages actually loaded a working grammar?
    wanted = {lang.lower() for lang in settings.tree_sitter_languages}
    candidate_langs: set[str] = set()
    if "typescript" in wanted:
        candidate_langs |= {"typescript", "tsx"}
    if "javascript" in wanted:
        candidate_langs.add("javascript")
    if not candidate_langs:  # nothing configured -> try all supported grammars
        candidate_langs = {"typescript", "tsx", "javascript"}
    active = sorted(lang for lang in candidate_langs if grammar_available(lang))

    index_id = _make_index_id(req.project_id, req.commit)
    graph = build_graph(
        project_id=req.project_id,
        commit=req.commit,
        index_id=index_id,
        file_results=results,
        all_files=all_files,
        skipped_files=skipped,
        languages=active,
    )
    graph_cache.put(graph)
    return graph


# --------------------------------------------------------------------------- #
# Routes                                                                       #
# --------------------------------------------------------------------------- #


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True)


@app.post("/index", response_model=IndexResponse)
def index(req: IndexRequest) -> IndexResponse:
    graph = _index_repo(req)
    stats = graph.stats()
    return IndexResponse(index_id=graph.index_id, stats=IndexStats(**stats))


@app.get("/symbol-graph", response_model=SymbolGraphResponse)
def symbol_graph(
    project: str = Query(..., description="project_id"),
    commit: str = Query(...),
) -> SymbolGraphResponse:
    graph = _get_graph_or_404(project, commit)
    return SymbolGraphResponse(
        index_id=graph.index_id,
        project_id=graph.project_id,
        commit=graph.commit,
        symbols=graph.symbol_nodes(),
        imports=graph.import_edges(),
        calls=graph.call_edges(),
        types=graph.type_edges(),
        stats=IndexStats(**graph.stats()),
    )


@app.post("/resolve-touchset", response_model=ResolveTouchsetResponse)
def resolve_touchset_route(req: ResolveTouchsetRequest) -> ResolveTouchsetResponse:
    graph = _get_graph_or_404(req.project_id, req.commit)
    resolved, blast, confidence, matches, new_symbols = resolve_touchset(
        graph, req.predicted_touchset
    )
    return ResolveTouchsetResponse(
        resolved=resolved,
        blast_radius=blast,
        confidence=confidence,
        matches=matches,
        new_symbols=new_symbols,
    )


@app.post("/overlap", response_model=OverlapResponse)
def overlap_route(req: OverlapRequest) -> OverlapResponse:
    # The graph isn't strictly required to compare two resolved touch-sets, but
    # we validate it exists so callers fail fast on a stale commit.
    _get_graph_or_404(req.project_id, req.commit)
    return compute_overlap(req.touchset_a, req.touchset_b)


@app.post("/callgraph-impact", response_model=CallgraphImpactResponse)
def callgraph_impact_route(req: CallgraphImpactRequest) -> CallgraphImpactResponse:
    graph = _get_graph_or_404(req.project_id, req.commit)
    affected_symbols, affected_files, root = callgraph_impact(
        graph, req.symbol, req.kind
    )
    return CallgraphImpactResponse(
        affected_symbols=affected_symbols,
        affected_files=affected_files,
        root=root,
    )
