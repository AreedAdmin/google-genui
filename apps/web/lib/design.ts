import type { ChangeType, NodeStatus, EdgeType } from "@trellis/shared";
import {
  Database,
  Plug,
  Layout,
  FunctionSquare,
  GitBranch,
  Bug,
  SlidersHorizontal,
  Server,
  FlaskConical,
  FileText,
  Circle,
  Play,
  LoaderCircle,
  Check,
  GitMerge,
  X,
  Lock,
  Ban,
  type LucideIcon,
} from "lucide-react";

/**
 * The canonical visual language (component-library.md §2). change_type → icon +
 * accent token; node_status → pill + treatment. Color is NEVER the only signal:
 * every entry pairs a hue with an icon and a human label.
 */

export interface ChangeTypeVisual {
  icon: LucideIcon;
  /** CSS var token name, e.g. "--ct-migration". */
  accentVar: string;
  /** Tailwind text/border class fragment, e.g. "ct-migration". */
  token: string;
  label: string;
  reads: string;
}

export const CHANGE_TYPE: Record<ChangeType, ChangeTypeVisual> = {
  migration: { icon: Database, accentVar: "--ct-migration", token: "ct-migration", label: "Migration", reads: "schema/data" },
  api_contract: { icon: Plug, accentVar: "--ct-api", token: "ct-api", label: "API contract", reads: "interface" },
  ui_component: { icon: Layout, accentVar: "--ct-ui", token: "ct-ui", label: "UI component", reads: "front-end" },
  logic: { icon: FunctionSquare, accentVar: "--ct-logic", token: "ct-logic", label: "Logic", reads: "core logic" },
  refactor: { icon: GitBranch, accentVar: "--ct-refactor", token: "ct-refactor", label: "Refactor", reads: "restructure" },
  bugfix: { icon: Bug, accentVar: "--ct-bugfix", token: "ct-bugfix", label: "Bugfix", reads: "defect" },
  config: { icon: SlidersHorizontal, accentVar: "--ct-config", token: "ct-config", label: "Config", reads: "settings" },
  infra: { icon: Server, accentVar: "--ct-infra", token: "ct-infra", label: "Infra", reads: "platform" },
  test: { icon: FlaskConical, accentVar: "--ct-test", token: "ct-test", label: "Test", reads: "verification" },
  docs: { icon: FileText, accentVar: "--ct-docs", token: "ct-docs", label: "Docs", reads: "documentation" },
};

export function changeTypeVisual(ct: ChangeType): ChangeTypeVisual {
  return CHANGE_TYPE[ct] ?? CHANGE_TYPE.logic;
}

export interface StatusVisual {
  icon: LucideIcon;
  /** Tailwind token fragment, e.g. "st-running". */
  token: string;
  label: string;
  /** Glyph used in dense / a11y contexts. */
  glyph: string;
}

export const NODE_STATUS: Record<NodeStatus, StatusVisual> = {
  pending: { icon: Circle, token: "st-pending", label: "Pending", glyph: "○" },
  ready: { icon: Play, token: "st-ready", label: "Ready", glyph: "▸" },
  running: { icon: LoaderCircle, token: "st-running", label: "Running", glyph: "◐" },
  built: { icon: Check, token: "st-built", label: "Built", glyph: "✓" },
  merged: { icon: GitMerge, token: "st-merged", label: "Merged", glyph: "⛢" },
  failed: { icon: X, token: "st-failed", label: "Failed", glyph: "✕" },
  blocked: { icon: Lock, token: "st-blocked", label: "Blocked", glyph: "⚷" },
  skipped: { icon: Ban, token: "st-skipped", label: "Skipped", glyph: "⊘" },
};

export function statusVisual(s: NodeStatus): StatusVisual {
  return NODE_STATUS[s] ?? NODE_STATUS.pending;
}

/** Edge styling per edge_type (component-library.md §3 / graph-canvas.md §3). */
export interface EdgeVisual {
  label: string;
  dashed: boolean;
  width: number;
  /** Stroke color CSS var. */
  strokeVar: string;
  arrow: boolean;
}

export const EDGE_TYPE: Record<EdgeType, EdgeVisual> = {
  depends_on: { label: "depends on", dashed: false, width: 2, strokeVar: "--border-strong", arrow: true },
  data_flow: { label: "data flow", dashed: false, width: 2, strokeVar: "--ct-api", arrow: true },
  sequence: { label: "sequence", dashed: false, width: 2.5, strokeVar: "--fg-muted", arrow: true },
  soft_order: { label: "soft order", dashed: true, width: 1.5, strokeVar: "--border-strong", arrow: false },
};

export function edgeVisual(t: EdgeType): EdgeVisual {
  return EDGE_TYPE[t] ?? EDGE_TYPE.depends_on;
}

/** Stable branch tints — independent branches must be visually distinct. */
export const BRANCH_TINTS = [
  "#6366f1", // indigo
  "#06b6d4", // cyan
  "#f59e0b", // amber
  "#ec4899", // pink
  "#22c55e", // green
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#ef4444", // red
] as const;

export function branchTint(index: number): string {
  const tints = BRANCH_TINTS;
  return tints[((index % tints.length) + tints.length) % tints.length] ?? tints[0];
}

export const SEVERITY = {
  low: { token: "sev-low", label: "Low", rank: 1 },
  medium: { token: "sev-medium", label: "Medium", rank: 2 },
  high: { token: "sev-high", label: "High", rank: 3 },
} as const;
