"use client";

import * as React from "react";
import type { PlanNode, ShareRole } from "@trellis/shared";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/primitives";
import { useDelegate, useShare, useReplan } from "@/lib/hooks";
import { Check, Copy } from "lucide-react";

const ROLES: ShareRole[] = ["viewer", "runner", "editor"];

function RoleSelect({ value, onChange }: { value: ShareRole; onChange: (r: ShareRole) => void }) {
  return (
    <div className="flex gap-1">
      {ROLES.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors ${
            value === r ? "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function ShareDialog({ open, onClose, planId }: { open: boolean; onClose: () => void; planId: string }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<ShareRole>("viewer");
  const share = useShare();
  const link = typeof window !== "undefined" ? `${window.location.origin}/p/${planId}` : `/p/${planId}`;
  const [copied, setCopied] = React.useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Share plan"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={share.isPending}
            disabled={!email}
            onClick={() => share.mutate({ resource_type: "plan", resource_id: planId, principal_email: email, role }, { onSuccess: onClose })}
          >
            Share
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Invite by email">
          <input className={inputCls} type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <Field label="Or copy link">
          <div className="flex gap-1.5">
            <input className={`${inputCls} font-mono text-xs`} readOnly value={link} />
            <Button
              variant="secondary"
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </Field>
        {share.isError && <p className="text-xs text-[var(--st-failed)]">Couldn&apos;t share — check the email and try again.</p>}
      </div>
    </Dialog>
  );
}

export function DelegateDialog({ open, onClose, planId, node }: { open: boolean; onClose: () => void; planId: string; node: PlanNode | null }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<ShareRole>("runner");
  const delegate = useDelegate(planId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delegate subtree"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={delegate.isPending}
            disabled={!node}
            onClick={() => node && delegate.mutate({ subtree_root_node: node.id, assigned_to_email: email || undefined, role }, { onSuccess: onClose })}
          >
            Delegate
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs">
          <p className="text-fg-muted">Exports the subtree rooted at</p>
          <p className="font-medium text-fg">{node?.title ?? "—"}</p>
          <p className="mt-1 text-fg-muted">as a portable spec, pinned to the current base commit.</p>
        </div>
        <Field label="Assign to (email, optional)">
          <input className={inputCls} type="email" placeholder="builder@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
      </div>
    </Dialog>
  );
}

export function AddContextDialog({ open, onClose, planId }: { open: boolean; onClose: () => void; planId: string }) {
  const [context, setContext] = React.useState("");
  const replan = useReplan(planId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add context · re-plan"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={replan.isPending}
            disabled={!context.trim()}
            onClick={() =>
              replan.mutate(context, {
                onSuccess: () => {
                  setContext("");
                  onClose();
                },
              })
            }
          >
            Re-plan
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-fg-muted">
          Add a constraint, a correction, or new requirements. The planner re-derives the graph and the canvas re-flows to the new revision.
        </p>
        <textarea
          className={`${inputCls} min-h-[120px] resize-y`}
          placeholder="e.g. We must keep the existing /login route working for mobile clients during the migration…"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          autoFocus
        />
        {replan.isError && <p className="text-xs text-[var(--st-failed)]">Re-plan failed — try again.</p>}
      </div>
    </Dialog>
  );
}
