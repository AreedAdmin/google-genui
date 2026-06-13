"""Trellis dependency-analysis service.

A FastAPI service that grounds the dependency-inference engine in a repo's real
symbol/import/call graphs (tree-sitter + networkx). See
``plan/02-agent-system/dependency-inference-engine.md`` §7 for the API contract.
"""

__version__ = "0.1.0"
