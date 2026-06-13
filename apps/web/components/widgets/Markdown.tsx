"use client";

import * as React from "react";
import { z } from "zod";
import { FileText } from "lucide-react";
import { WidgetFrame } from "./WidgetFrame";

/**
 * markdown — for change_type: docs. Renders a SAFE markdown subset (headings,
 * lists, paragraphs, inline code, bold, fenced code) using a small line-based
 * parser into React elements. There is NO dangerouslySetInnerHTML / HTML pass-
 * through: every token renders as a text node, so model output can never inject
 * markup (widget-generation.md §3 honesty/safety constraint).
 */

export const MarkdownProps = z.object({
  title: z.string().optional(),
  markdown: z.string().default(""),
});
export type MarkdownProps = z.infer<typeof MarkdownProps>;

/** Inline: backtick code + **bold**, everything else plain text. */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((part, i) => {
    if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={`${keyBase}-c${i}`} className="rounded bg-surface-2/70 px-1 font-mono text-[11px] text-fg">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((b, j) => {
      if (b.length >= 4 && b.startsWith("**") && b.endsWith("**")) {
        return (
          <strong key={`${keyBase}-b${i}-${j}`} className="font-semibold text-fg">
            {b.slice(2, -2)}
          </strong>
        );
      }
      return <React.Fragment key={`${keyBase}-t${i}-${j}`}>{b}</React.Fragment>;
    });
  });
}

function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // fenced code block
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // consume closing fence
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md border border-border bg-surface-2/60 px-2 py-1.5 font-mono text-[10.5px] text-fg-muted">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    // heading (#, ##, ###)
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = (h[1] ?? "").length;
      const cls = level === 1 ? "text-sm" : level === 2 ? "text-xs" : "text-[11px]";
      blocks.push(
        <p key={key++} className={`${cls} mt-2 font-semibold text-fg first:mt-0`}>
          {renderInline(h[2] ?? "", `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="ml-3 list-disc space-y-0.5 text-xs text-fg-muted marker:text-fg-muted">
          {items.map((it, k) => (
            <li key={k}>{renderInline(it, `ul${key}-${k}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="ml-3 list-decimal space-y-0.5 text-xs text-fg-muted marker:text-fg-muted">
          {items.map((it, k) => (
            <li key={k}>{renderInline(it, `ol${key}-${k}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph (gather consecutive plain lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^\s*[-*]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "") &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !(lines[i] ?? "").trim().startsWith("```")
    ) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push(
      <p key={key++} className="text-xs leading-relaxed text-fg-muted">
        {renderInline(para.join(" "), `p${key}`)}
      </p>,
    );
  }

  return blocks;
}

export function Markdown(props: { spec: MarkdownProps; grounding: string[]; confidence?: number; onJump?: (r: string) => void }) {
  const { title, markdown } = props.spec;
  const blocks = React.useMemo(() => renderMarkdown(markdown), [markdown]);

  return (
    <WidgetFrame
      title={title ?? "notes"}
      icon={<FileText size={13} style={{ color: "var(--ct-docs)" }} />}
      grounding={props.grounding}
      confidence={props.confidence}
      onJump={props.onJump}
    >
      <div className="space-y-1.5">{blocks.length > 0 ? blocks : <p className="text-[11px] italic text-fg-muted">No content.</p>}</div>
    </WidgetFrame>
  );
}
