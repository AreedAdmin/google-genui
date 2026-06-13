"use client";

import * as React from "react";
import { z } from "zod";
import { WidgetSpec, type WidgetKind } from "@trellis/shared";
import { FallbackWidget } from "./WidgetFrame";
import { SchemaDiff, SchemaDiffProps } from "./SchemaDiff";
import { ApiContract, ApiContractProps } from "./ApiContract";
import { ComponentPreview, ComponentPreviewProps } from "./ComponentPreview";
import { CallGraphImpact, CallGraphImpactProps } from "./CallGraphImpact";
import { KeyDiff, KeyDiffProps } from "./KeyDiff";
import { TestLinkage, TestLinkageProps } from "./TestLinkage";
import { ResourceDiagram, ResourceDiagramProps } from "./ResourceDiagram";
import { Markdown, MarkdownProps } from "./Markdown";
import { Checklist, ChecklistProps } from "./Checklist";
import { Composed, ComposedProps } from "./Composed";

/**
 * The TRUSTED WidgetSpec registry (widget-generation.md §3). The closed set of
 * renderable widgets is compiled in here. The render algorithm:
 *
 *   1. validate the envelope against @trellis/shared WidgetSpec (zod)
 *   2. look the key up in REGISTRY (closed set — unknown ⇒ fallback)
 *   3. size-cap props (anti-DoS) ⇒ fallback on oversize
 *   4. narrow props with the widget's own zod schema ⇒ fallback on invalid
 *   5. render the trusted component
 *
 * There is NO dangerouslySetInnerHTML / eval / string-to-DOM path anywhere here.
 * The worst case is FallbackWidget rendering fallback_text.
 */

type WidgetComponent = React.ComponentType<{
  spec: any;
  grounding: string[];
  confidence?: number;
  onJump?: (r: string) => void;
}>;

interface RegistryEntry {
  key: WidgetKind;
  version: number;
  /** Validates spec.props; output is narrowed by the component at the boundary. */
  propsSchema: z.ZodTypeAny;
  Component: WidgetComponent;
  maxPropsBytes: number;
}

export const REGISTRY: Partial<Record<WidgetKind, RegistryEntry>> = {
  schema_diff: {
    key: "schema_diff",
    version: 1,
    propsSchema: SchemaDiffProps,
    Component: SchemaDiff as WidgetComponent,
    maxPropsBytes: 64 * 1024,
  },
  api_contract: {
    key: "api_contract",
    version: 1,
    propsSchema: ApiContractProps,
    Component: ApiContract as WidgetComponent,
    maxPropsBytes: 64 * 1024,
  },
  component_preview: {
    key: "component_preview",
    version: 1,
    propsSchema: ComponentPreviewProps,
    Component: ComponentPreview as WidgetComponent,
    maxPropsBytes: 64 * 1024,
  },
  call_graph_impact: {
    key: "call_graph_impact",
    version: 1,
    propsSchema: CallGraphImpactProps,
    Component: CallGraphImpact as WidgetComponent,
    maxPropsBytes: 128 * 1024,
  },
  key_diff: {
    key: "key_diff",
    version: 1,
    propsSchema: KeyDiffProps,
    Component: KeyDiff as WidgetComponent,
    maxPropsBytes: 32 * 1024,
  },
  test_linkage: {
    key: "test_linkage",
    version: 1,
    propsSchema: TestLinkageProps,
    Component: TestLinkage as WidgetComponent,
    maxPropsBytes: 32 * 1024,
  },
  resource_diagram: {
    key: "resource_diagram",
    version: 1,
    propsSchema: ResourceDiagramProps,
    Component: ResourceDiagram as WidgetComponent,
    maxPropsBytes: 64 * 1024,
  },
  markdown: {
    key: "markdown",
    version: 1,
    propsSchema: MarkdownProps,
    Component: Markdown as WidgetComponent,
    maxPropsBytes: 32 * 1024,
  },
  checklist: {
    key: "checklist",
    version: 1,
    propsSchema: ChecklistProps,
    Component: Checklist as WidgetComponent,
    maxPropsBytes: 32 * 1024,
  },
  composed: {
    key: "composed",
    version: 1,
    propsSchema: ComposedProps,
    Component: Composed as WidgetComponent,
    maxPropsBytes: 256 * 1024,
  },
};

function byteLen(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch {
    return JSON.stringify(obj ?? "").length;
  }
}

/**
 * Render one widget spec from an UNTRUSTED source. Returns a React node that is
 * always renderable (a valid widget OR FallbackWidget) — never throws.
 */
export function renderWidget(rawSpec: unknown, onJump?: (ref: string) => void): React.ReactElement {
  const env = WidgetSpec.safeParse(rawSpec);
  if (!env.success) {
    const fallbackText = typeof (rawSpec as { fallback_text?: unknown })?.fallback_text === "string"
      ? (rawSpec as { fallback_text?: string }).fallback_text
      : undefined;
    return <FallbackWidget reason="bad_envelope" fallbackText={fallbackText} />;
  }

  const spec = env.data;
  const reg = REGISTRY[spec.widget];
  if (!reg) {
    return <FallbackWidget reason="unknown_widget" fallbackText={spec.fallback_text} />;
  }

  if (byteLen(spec.props) > reg.maxPropsBytes) {
    return <FallbackWidget reason="oversize" fallbackText={spec.fallback_text} />;
  }

  const parsed = reg.propsSchema.safeParse(spec.props);
  if (!parsed.success) {
    return <FallbackWidget reason="bad_props" fallbackText={spec.fallback_text} />;
  }

  // Derive a confidence signal: the shared WidgetSpec grounding is a flat
  // string[]; an empty grounding on a non-fallback widget reads as low-confidence.
  const grounding = spec.grounding ?? [];
  const confidence = grounding.length === 0 ? 0.4 : undefined;

  const Component = reg.Component;
  return <Component spec={parsed.data} grounding={grounding} confidence={confidence} onJump={onJump} />;
}

/** Render an ordered WidgetSpec[] (first is primary). */
export function WidgetSpecList({ specs, onJump }: { specs: unknown[]; onJump?: (ref: string) => void }) {
  if (!specs || specs.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {specs.map((spec, i) => (
        <div key={i} className="animate-fade-in">
          {renderWidget(spec, onJump)}
        </div>
      ))}
    </div>
  );
}

export function hasRenderableWidget(specs: unknown[] | undefined): boolean {
  if (!specs) return false;
  return specs.some((s) => {
    const env = WidgetSpec.safeParse(s);
    return env.success && REGISTRY[env.data.widget] !== undefined;
  });
}
