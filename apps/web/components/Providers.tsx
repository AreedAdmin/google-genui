"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";
import { API_URL } from "@/lib/api";

/**
 * Client providers.
 * - TanStack Query owns server state (graph-canvas.md §7).
 * - CopilotKit is mounted **headless** (mandated-integrations.md §6): it provides
 *   `useCoAgent`/`useCopilotAction` for the canvas's agent state + human-in-the-loop,
 *   but renders NO chat UI — the React Flow canvas stays primary. AG-UI events are
 *   consumed by `useAgentStream` (lib/agui.ts), not a chat sidebar.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  // Points at a CopilotRuntime endpoint; defaults to the orchestration API.
  const runtimeUrl = process.env.NEXT_PUBLIC_COPILOT_RUNTIME_URL || `${API_URL}/v1/copilotkit`;

  return (
    <QueryClientProvider client={client}>
      <CopilotKit runtimeUrl={runtimeUrl} showDevConsole={false}>
        {children}
      </CopilotKit>
    </QueryClientProvider>
  );
}
