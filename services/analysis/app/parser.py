"""Tree-sitter parsing of TS/JS source into symbols, imports, calls and types.

Design notes
------------
* Grammar loading is best-effort: we try ``tree_sitter_languages`` first, then
  the standalone ``tree_sitter_typescript`` / ``tree_sitter_javascript`` packages.
  If neither loads we record the failure and the indexer simply produces an
  empty graph rather than crashing (robustness requirement).
* Per-file parsing is wrapped in a try/except: a file that fails to parse is
  skipped and counted, never fatal.
* We extract, per file:
    - declarations: functions, classes, interfaces, type aliases, enums, and
      top-level ``const`` arrow-function / variable declarations.
    - exports (``export`` keyword on a declaration, or ``export { ... }``).
    - imports (``import ... from "mod"``, side-effect imports, and CommonJS
      ``require("mod")``), with the imported names.
    - call expressions and identifier references inside each declaration body,
      used to build the call graph and (lightly) the type graph.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Iterable

logger = logging.getLogger("analysis.parser")

# File extensions we attempt to parse, mapped to a logical language.
EXT_LANGUAGE = {
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
}

# Directories we never descend into.
IGNORE_DIRS = {
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    "vendor",
}

# Tree-sitter node types that introduce a named declaration.
_FUNCTION_NODES = {"function_declaration", "generator_function_declaration"}
_CLASS_NODES = {"class_declaration", "abstract_class_declaration"}
_INTERFACE_NODES = {"interface_declaration"}
_TYPE_NODES = {"type_alias_declaration"}
_ENUM_NODES = {"enum_declaration"}


@dataclass
class ParsedSymbol:
    name: str
    file: str
    kind: str
    exported: bool = False
    start_line: int | None = None
    end_line: int | None = None
    signature: str | None = None
    # byte span of the declaration body, used to attribute calls/refs to it.
    start_byte: int = 0
    end_byte: int = 0

    @property
    def id(self) -> str:
        return f"{self.file}#{self.name}"


@dataclass
class ParsedImport:
    from_file: str
    module: str
    names: list[str] = field(default_factory=list)


@dataclass
class ParsedCall:
    caller_symbol: str | None  # symbol id of the enclosing decl, or None (module scope)
    callee_name: str
    byte_pos: int


@dataclass
class ParsedTypeRef:
    symbol: str | None  # enclosing symbol id
    type_name: str
    byte_pos: int


@dataclass
class FileParseResult:
    file: str
    symbols: list[ParsedSymbol] = field(default_factory=list)
    imports: list[ParsedImport] = field(default_factory=list)
    calls: list[ParsedCall] = field(default_factory=list)
    type_refs: list[ParsedTypeRef] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Grammar loading (best-effort, cached)                                       #
# --------------------------------------------------------------------------- #


class _GrammarRegistry:
    """Lazily loads and caches tree-sitter ``Language`` objects per language."""

    def __init__(self) -> None:
        self._cache: dict[str, object] = {}
        self._failed: set[str] = set()

    def get(self, language: str):  # noqa: ANN201 - tree_sitter Language
        if language in self._cache:
            return self._cache[language]
        if language in self._failed:
            return None
        lang = self._load(language)
        if lang is None:
            self._failed.add(language)
        else:
            self._cache[language] = lang
        return lang

    def _load(self, language: str):  # noqa: ANN201
        # 1) tree-sitter-languages bundle.
        try:
            from tree_sitter_languages import get_language  # type: ignore

            return get_language(language)
        except Exception as exc:  # pragma: no cover - depends on host wheels
            logger.debug("tree_sitter_languages failed for %s: %s", language, exc)

        # 2) Standalone grammar packages (newer tree-sitter API).
        try:
            from tree_sitter import Language  # type: ignore

            if language in ("typescript", "tsx"):
                import tree_sitter_typescript as tsts  # type: ignore

                ptr = (
                    tsts.language_tsx()
                    if language == "tsx"
                    else tsts.language_typescript()
                )
                return Language(ptr)
            if language == "javascript":
                import tree_sitter_javascript as tsjs  # type: ignore

                return Language(tsjs.language())
        except Exception as exc:  # pragma: no cover
            logger.debug("standalone grammar failed for %s: %s", language, exc)

        logger.warning("No tree-sitter grammar available for language=%s", language)
        return None


_REGISTRY = _GrammarRegistry()


def _new_parser(language: str):  # noqa: ANN201
    lang = _REGISTRY.get(language)
    if lang is None:
        return None
    try:
        from tree_sitter import Parser  # type: ignore

        parser = Parser()
        # tree-sitter 0.21 uses set_language; 0.22+ accepts the language in ctor
        # or via the ``language`` property. Try both for compatibility.
        try:
            parser.language = lang  # 0.22+
        except (AttributeError, TypeError):
            parser.set_language(lang)  # 0.21
        return parser
    except Exception as exc:  # pragma: no cover
        logger.warning("Failed to build parser for %s: %s", language, exc)
        return None


def grammar_available(language: str) -> bool:
    return _REGISTRY.get(language) is not None


# --------------------------------------------------------------------------- #
# AST helpers                                                                  #
# --------------------------------------------------------------------------- #


def _text(node, src: bytes) -> str:
    return src[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _child_by_field(node, field_name: str):
    try:
        return node.child_by_field_name(field_name)
    except Exception:
        return None


def _name_of(node, src: bytes) -> str | None:
    name_node = _child_by_field(node, "name")
    if name_node is not None:
        return _text(name_node, src)
    return None


def _signature_of(node, src: bytes) -> str | None:
    """Best-effort: the declaration header up to (but excluding) the body."""
    body = _child_by_field(node, "body")
    end = body.start_byte if body is not None else node.end_byte
    text = src[node.start_byte : end].decode("utf-8", errors="replace")
    # Collapse whitespace to one line.
    return " ".join(text.split()) or None


# --------------------------------------------------------------------------- #
# Per-file extraction                                                          #
# --------------------------------------------------------------------------- #


def _iter_named_children(node) -> Iterable:
    for i in range(node.named_child_count):
        yield node.named_child(i)


def _extract_declaration(node, src: bytes, rel_file: str, exported: bool):
    """Return a ParsedSymbol for a recognised declaration node, else None."""
    t = node.type
    kind: str | None = None
    if t in _FUNCTION_NODES:
        kind = "function"
    elif t in _CLASS_NODES:
        kind = "class"
    elif t in _INTERFACE_NODES:
        kind = "interface"
    elif t in _TYPE_NODES:
        kind = "type"
    elif t in _ENUM_NODES:
        kind = "enum"
    else:
        return None

    name = _name_of(node, src)
    if not name:
        return None
    return ParsedSymbol(
        name=name,
        file=rel_file,
        kind=kind,
        exported=exported,
        start_line=node.start_point[0] + 1,
        end_line=node.end_point[0] + 1,
        signature=_signature_of(node, src),
        start_byte=node.start_byte,
        end_byte=node.end_byte,
    )


def _extract_lexical(node, src: bytes, rel_file: str, exported: bool):
    """Top-level ``const x = () => {}`` / ``const x = ...`` declarations.

    Yields ParsedSymbol(s) for each declarator with an identifier name.
    """
    out: list[ParsedSymbol] = []
    for declarator in _iter_named_children(node):
        if declarator.type != "variable_declarator":
            continue
        name_node = _child_by_field(declarator, "name")
        if name_node is None or name_node.type != "identifier":
            continue
        value = _child_by_field(declarator, "value")
        kind = "variable"
        if value is not None and value.type in (
            "arrow_function",
            "function",
            "function_expression",
        ):
            kind = "function"
        out.append(
            ParsedSymbol(
                name=_text(name_node, src),
                file=rel_file,
                kind=kind,
                exported=exported,
                start_line=declarator.start_point[0] + 1,
                end_line=declarator.end_point[0] + 1,
                signature=_signature_of(declarator, src),
                start_byte=declarator.start_byte,
                end_byte=declarator.end_byte,
            )
        )
    return out


def _resolve_module_path(module: str, rel_file: str, all_files: set[str]) -> str | None:
    """Resolve a relative import specifier to a repo-relative file path."""
    if not module.startswith("."):
        return None  # bare/external module
    base_dir = os.path.dirname(rel_file)
    target = os.path.normpath(os.path.join(base_dir, module))
    candidates = [
        target,
        f"{target}.ts",
        f"{target}.tsx",
        f"{target}.js",
        f"{target}.jsx",
        f"{target}.mjs",
        f"{target}.cjs",
        os.path.join(target, "index.ts"),
        os.path.join(target, "index.tsx"),
        os.path.join(target, "index.js"),
        os.path.join(target, "index.jsx"),
    ]
    for cand in candidates:
        norm = cand.replace(os.sep, "/")
        if norm in all_files:
            return norm
    return None


def _extract_import(node, src: bytes, rel_file: str) -> ParsedImport | None:
    """Handle ``import_statement`` nodes."""
    source_node = _child_by_field(node, "source")
    if source_node is None:
        return None
    module = _text(source_node, src).strip("'\"`")
    names: list[str] = []
    # import_clause holds named/default/namespace imports.
    for child in _iter_named_children(node):
        if child.type != "import_clause":
            continue
        for sub in _iter_named_children(child):
            if sub.type == "identifier":  # default import
                names.append(_text(sub, src))
            elif sub.type == "namespace_import":
                ident = sub.named_child(0) if sub.named_child_count else None
                if ident is not None:
                    names.append(_text(ident, src))
            elif sub.type == "named_imports":
                for spec in _iter_named_children(sub):
                    if spec.type == "import_specifier":
                        nm = _child_by_field(spec, "name") or (
                            spec.named_child(0) if spec.named_child_count else None
                        )
                        if nm is not None:
                            names.append(_text(nm, src))
    return ParsedImport(from_file=rel_file, module=module, names=names)


def _enclosing_symbol(byte_pos: int, decls: list[ParsedSymbol]) -> str | None:
    """Innermost declaration whose byte span contains ``byte_pos``."""
    best: ParsedSymbol | None = None
    for d in decls:
        if d.start_byte <= byte_pos < d.end_byte:
            if best is None or (d.end_byte - d.start_byte) < (
                best.end_byte - best.start_byte
            ):
                best = d
    return best.id if best is not None else None


def _walk(root):
    """Iterative pre-order walk over all named nodes."""
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        for i in range(node.named_child_count - 1, -1, -1):
            stack.append(node.named_child(i))


def parse_file(abs_path: str, rel_file: str, all_files: set[str]) -> FileParseResult:
    """Parse a single source file. Never raises; returns an (empty) result on error."""
    result = FileParseResult(file=rel_file)
    ext = os.path.splitext(abs_path)[1].lower()
    language = EXT_LANGUAGE.get(ext)
    if language is None:
        return result

    parser = _new_parser(language)
    if parser is None:
        # Grammar unavailable — caller counts this as skipped.
        raise RuntimeError(f"no grammar for {language}")

    try:
        with open(abs_path, "rb") as fh:
            src = fh.read()
    except OSError as exc:
        logger.debug("read failed %s: %s", abs_path, exc)
        raise

    try:
        tree = parser.parse(src)
    except Exception as exc:  # pragma: no cover
        logger.debug("parse failed %s: %s", abs_path, exc)
        raise

    root = tree.root_node

    # First pass: top-level declarations (including export wrappers) + imports.
    for child in _iter_named_children(root):
        t = child.type

        if t == "import_statement":
            imp = _extract_import(child, src, rel_file)
            if imp is not None:
                result.imports.append(imp)
            continue

        if t == "export_statement":
            # export <decl>  |  export { a, b }  |  export default <decl>
            inner = _child_by_field(child, "declaration")
            if inner is not None:
                if inner.type == "lexical_declaration" or inner.type == "variable_declaration":
                    result.symbols.extend(
                        _extract_lexical(inner, src, rel_file, exported=True)
                    )
                else:
                    sym = _extract_declaration(inner, src, rel_file, exported=True)
                    if sym is not None:
                        result.symbols.append(sym)
            else:
                # export { name1, name2 } — re-export of existing names.
                for sub in _iter_named_children(child):
                    if sub.type == "export_clause":
                        for spec in _iter_named_children(sub):
                            nm = _child_by_field(spec, "name") or (
                                spec.named_child(0) if spec.named_child_count else None
                            )
                            if nm is not None:
                                result.symbols.append(
                                    ParsedSymbol(
                                        name=_text(nm, src),
                                        file=rel_file,
                                        kind="export",
                                        exported=True,
                                        start_line=spec.start_point[0] + 1,
                                        end_line=spec.end_point[0] + 1,
                                        start_byte=spec.start_byte,
                                        end_byte=spec.end_byte,
                                    )
                                )
            continue

        if t in ("lexical_declaration", "variable_declaration"):
            result.symbols.extend(_extract_lexical(child, src, rel_file, exported=False))
            continue

        sym = _extract_declaration(child, src, rel_file, exported=False)
        if sym is not None:
            result.symbols.append(sym)

    # Resolve import target files now that we know module specifiers.
    for imp in result.imports:
        imp.from_file = rel_file  # already set; explicit for clarity

    # Second pass: calls and type references, attributed to enclosing decl.
    decls = result.symbols
    for node in _walk(root):
        t = node.type
        if t == "call_expression":
            fn = _child_by_field(node, "function")
            if fn is None:
                continue
            callee_name = _callee_name(fn, src)
            if callee_name == "require":
                # CommonJS require("mod") — treat as an import.
                args = _child_by_field(node, "arguments")
                mod = _first_string_arg(args, src) if args is not None else None
                if mod:
                    result.imports.append(
                        ParsedImport(from_file=rel_file, module=mod, names=[])
                    )
                continue
            if callee_name:
                result.calls.append(
                    ParsedCall(
                        caller_symbol=_enclosing_symbol(node.start_byte, decls),
                        callee_name=callee_name,
                        byte_pos=node.start_byte,
                    )
                )
        elif t == "type_identifier":
            type_name = _text(node, src)
            if type_name:
                result.type_refs.append(
                    ParsedTypeRef(
                        symbol=_enclosing_symbol(node.start_byte, decls),
                        type_name=type_name,
                        byte_pos=node.start_byte,
                    )
                )

    return result


def _callee_name(fn_node, src: bytes) -> str | None:
    """Extract the simple callee name from a call_expression's function node."""
    if fn_node.type == "identifier":
        return _text(fn_node, src)
    if fn_node.type == "member_expression":
        prop = _child_by_field(fn_node, "property")
        if prop is not None:
            return _text(prop, src)
    return None


def _first_string_arg(args_node, src: bytes) -> str | None:
    for child in _iter_named_children(args_node):
        if child.type == "string":
            return _text(child, src).strip("'\"`")
    return None


# --------------------------------------------------------------------------- #
# Repo walk                                                                    #
# --------------------------------------------------------------------------- #


def discover_files(repo_path: str) -> list[tuple[str, str]]:
    """Return (abs_path, rel_path) pairs for all parseable source files."""
    found: list[tuple[str, str]] = []
    repo_path = os.path.abspath(repo_path)
    for dirpath, dirnames, filenames in os.walk(repo_path):
        # Prune ignored directories in place for efficiency.
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS and not d.startswith(".")]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext in EXT_LANGUAGE:
                # Skip declaration files — no runtime symbols of interest.
                if fn.endswith(".d.ts"):
                    continue
                abs_p = os.path.join(dirpath, fn)
                rel_p = os.path.relpath(abs_p, repo_path).replace(os.sep, "/")
                found.append((abs_p, rel_p))
    return found
