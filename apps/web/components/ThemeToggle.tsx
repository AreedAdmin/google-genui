"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui/primitives";

/**
 * Theme toggle — flips `.dark` on <html>, SSR-safe (no flash via the inline
 * script in layout.tsx). Respects the persisted choice.
 */
export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("trellis-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  return (
    <IconButton label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  );
}
