"""Overlap scoring between two resolved touch-sets (Stage 5).

Implements the weighted overlap formula from
``dependency-inference-engine.md`` §3/§5:

    overlap_score = weighted(
        file_overlap            * 1.0   // hard blocker
      + symbol_overlap          * 1.0   // hard blocker
      + shared_signature_target * 0.9
      + shared_schema_key       * 0.9
      + shared_config_key       * 0.7
    )

Score is clamped to [0,1]. Any shared file or symbol is a hard blocker and
pins the score at 1.0 (a corrupted merge is far costlier than lost parallelism).
"""

from __future__ import annotations

from .models import OverlapResponse, ResolvedTouchSet, SharedSets

# Per-dimension weights (engine doc §3).
W_FILE = 1.0
W_SYMBOL = 1.0
W_SIGNATURE = 0.9
W_SCHEMA = 0.9
W_CONFIG = 0.7


def _signature_target(sig: str) -> str:
    """Strip the trailing ``::<signature text>`` so two touch-sets that touch the
    same symbol's signature compare equal even if the captured text differs."""
    return sig.split("::", 1)[0]


def compute_overlap(a: ResolvedTouchSet, b: ResolvedTouchSet) -> OverlapResponse:
    files_a, files_b = set(a.files), set(b.files)
    syms_a, syms_b = set(a.symbols), set(b.symbols)
    schema_a, schema_b = set(a.schema_keys), set(b.schema_keys)
    config_a, config_b = set(a.config_keys), set(b.config_keys)

    sig_a = {_signature_target(s): s for s in a.signatures_changed}
    sig_b = {_signature_target(s): s for s in b.signatures_changed}

    shared_files = sorted(files_a & files_b)
    shared_symbols = sorted(syms_a & syms_b)
    shared_sig_targets = set(sig_a) & set(sig_b)
    shared_signatures = sorted(
        {sig_a[t] for t in shared_sig_targets} | {sig_b[t] for t in shared_sig_targets}
    )
    shared_schema = sorted(schema_a & schema_b)
    shared_config = sorted(config_a & config_b)

    shared = SharedSets(
        files=shared_files,
        symbols=shared_symbols,
        signatures=shared_signatures,
        schema_=shared_schema,
        config=shared_config,
    )

    hard_conflict = bool(shared_files or shared_symbols)

    if hard_conflict:
        # Hard blocker: clamp to 1.0 regardless of the other dimensions.
        return OverlapResponse(overlap_score=1.0, shared=shared, hard_conflict=True)

    # Soft dimensions: take the max weighted signal (asymmetric caution — any
    # single strong shared resource should dominate), then clamp.
    signals: list[float] = []
    if shared_sig_targets:
        signals.append(W_SIGNATURE)
    if shared_schema:
        signals.append(W_SCHEMA)
    if shared_config:
        signals.append(W_CONFIG)

    score = max(signals) if signals else 0.0
    score = max(0.0, min(1.0, score))

    return OverlapResponse(overlap_score=round(score, 4), shared=shared, hard_conflict=False)
