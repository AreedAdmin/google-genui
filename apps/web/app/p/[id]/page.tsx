import { CanvasPage } from "@/components/canvas/CanvasPage";

/**
 * /p/[id] — the generative canvas for a single plan. The PlanGraph is fetched
 * client-side via react-query (with realtime subscriptions) inside CanvasPage.
 */
export default async function PlanCanvasRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CanvasPage planId={id} />;
}
