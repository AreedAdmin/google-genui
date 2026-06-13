import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-bold text-fg-muted">404</p>
      <p className="text-sm text-fg-muted">That page doesn&apos;t exist.</p>
      <Link href="/">
        <Button variant="secondary" icon={<ArrowLeft size={14} />}>
          Back home
        </Button>
      </Link>
    </main>
  );
}
