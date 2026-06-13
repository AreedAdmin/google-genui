"use client";

import { create } from "zustand";
import type { CanvasKind } from "@trellis/shared";

/**
 * Canvas / UI state (graph-canvas.md §7). Server state lives in react-query;
 * this store holds ephemeral selection, layout mode, density controls, and the
 * live run/progress overlay keyed by node id.
 */

export interface RunProgress {
  runId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  /** 0..1 */
  progress: number;
  /** rolling log tail for the inspector diff/log viewer */
  log: string[];
  tokens: number;
}

export interface CanvasState {
  // selection
  selectedNodeId: string | null;
  multiSelection: string[];
  // layout / density
  layoutMode: CanvasKind | null;
  hideSoftEdges: boolean;
  focusedBranchId: string | null;
  collapsedChips: boolean;
  expandedSuperNodes: string[];
  // live overlay: nodeId -> progress
  runProgress: Record<string, RunProgress>;

  // actions
  selectNode: (id: string | null) => void;
  toggleMultiSelect: (id: string) => void;
  setMultiSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setLayoutMode: (mode: CanvasKind | null) => void;
  toggleSoftEdges: () => void;
  setFocusedBranch: (id: string | null) => void;
  toggleCollapsedChips: () => void;
  toggleSuperNode: (id: string) => void;
  setRunProgress: (nodeId: string, p: Partial<RunProgress> & { runId: string }) => void;
  appendRunLog: (nodeId: string, line: string) => void;
  clearRunProgress: (nodeId: string) => void;
  reset: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  selectedNodeId: null,
  multiSelection: [],
  layoutMode: null,
  hideSoftEdges: false,
  focusedBranchId: null,
  collapsedChips: false,
  expandedSuperNodes: [],
  runProgress: {},

  selectNode: (id) => set({ selectedNodeId: id }),

  toggleMultiSelect: (id) =>
    set((s) => ({
      multiSelection: s.multiSelection.includes(id)
        ? s.multiSelection.filter((x) => x !== id)
        : [...s.multiSelection, id],
    })),

  setMultiSelection: (ids) => set({ multiSelection: ids }),

  clearSelection: () => set({ selectedNodeId: null, multiSelection: [] }),

  setLayoutMode: (mode) => set({ layoutMode: mode }),

  toggleSoftEdges: () => set((s) => ({ hideSoftEdges: !s.hideSoftEdges })),

  setFocusedBranch: (id) => set((s) => ({ focusedBranchId: s.focusedBranchId === id ? null : id })),

  toggleCollapsedChips: () => set((s) => ({ collapsedChips: !s.collapsedChips })),

  toggleSuperNode: (id) =>
    set((s) => ({
      expandedSuperNodes: s.expandedSuperNodes.includes(id)
        ? s.expandedSuperNodes.filter((x) => x !== id)
        : [...s.expandedSuperNodes, id],
    })),

  setRunProgress: (nodeId, p) =>
    set((s) => {
      const prev = s.runProgress[nodeId];
      return {
        runProgress: {
          ...s.runProgress,
          [nodeId]: {
            runId: p.runId,
            status: p.status ?? prev?.status ?? "queued",
            progress: p.progress ?? prev?.progress ?? 0,
            log: p.log ?? prev?.log ?? [],
            tokens: p.tokens ?? prev?.tokens ?? 0,
          },
        },
      };
    }),

  appendRunLog: (nodeId, line) =>
    set((s) => {
      const prev = s.runProgress[nodeId];
      if (!prev) return s;
      const log = [...prev.log, line].slice(-200);
      return { runProgress: { ...s.runProgress, [nodeId]: { ...prev, log } } };
    }),

  clearRunProgress: (nodeId) =>
    set((s) => {
      const next = { ...s.runProgress };
      delete next[nodeId];
      return { runProgress: next };
    }),

  reset: () =>
    set({
      selectedNodeId: null,
      multiSelection: [],
      hideSoftEdges: false,
      focusedBranchId: null,
      collapsedChips: false,
      expandedSuperNodes: [],
      runProgress: {},
    }),
}));
