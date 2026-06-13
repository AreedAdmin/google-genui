import type { ReactNode } from "react";
import Link from "next/link";
import { PromptBox } from "@/components/home/PromptBox";
import { PlanList } from "@/components/home/PlanList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GitBranch, Boxes, ShieldCheck } from "lucide-react";

/**
 * Home — the web entry. A prominent "Describe what to build" prompt box +
 * recent plans. Submitting routes to /p/[id] (the generated canvas).
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-5 py-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <GitBranch size={16} />
          </span>
          <span className="text-sm font-bold tracking-tight">Trellis</span>
        </Link>
        <ThemeToggle />
      </header>

      <section className="mt-14 text-center">
        <h1 className="text-balance text-[28px] font-bold leading-tight tracking-tight text-fg sm:text-[34px]">
          Describe what to build.
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-balance text-[15px] text-fg-muted">
          Trellis turns a prompt into a grounded dependency graph you can run, branch, and delegate. The interface is{" "}
          <span className="text-fg">generated per plan</span> from a validated spec — granularity picks the canvas, change-type picks each node&apos;s widgets.
        </p>
      </section>

      <section className="mt-7">
        <PromptBox />
      </section>

      <section className="mt-6 grid grid-cols-3 gap-2 text-center">
        <Feature icon={<Boxes size={15} />} title="Adaptive canvas" body="Four layouts across G1–G4" />
        <Feature icon={<ShieldCheck size={15} />} title="Grounded & safe" body="Validated specs, never raw HTML" />
        <Feature icon={<GitBranch size={15} />} title="Operable" body="Run · dispatch · delegate" />
      </section>

      <section className="mt-12">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Recent plans</h2>
          <span className="text-xs text-fg-muted">acme-app</span>
        </div>
        <PlanList />
      </section>

      <footer className="mt-auto pt-12 text-center text-[11px] text-fg-muted">
        The agent writes a spec for the UI; a trusted registry renders it.
      </footer>
    </main>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3">
      <div className="mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-accent">{icon}</div>
      <p className="text-xs font-semibold text-fg">{title}</p>
      <p className="text-[11px] text-fg-muted">{body}</p>
    </div>
  );
}
