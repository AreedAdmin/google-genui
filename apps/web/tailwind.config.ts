import type { Config } from "tailwindcss";

/**
 * Trellis design system (component-library.md §1). All color decisions route
 * through semantic CSS variables defined in globals.css so dark mode and the
 * change_type / status hues are a single source of truth, never per-component.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        fg: "var(--fg)",
        "fg-muted": "var(--fg-muted)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        primary: "var(--primary)",
        "primary-fg": "var(--primary-fg)",
        accent: "var(--accent)",
        ring: "var(--ring)",
        overlay: "var(--overlay)",
        // change_type accents (component-library.md §2)
        "ct-migration": "var(--ct-migration)",
        "ct-api": "var(--ct-api)",
        "ct-ui": "var(--ct-ui)",
        "ct-logic": "var(--ct-logic)",
        "ct-refactor": "var(--ct-refactor)",
        "ct-bugfix": "var(--ct-bugfix)",
        "ct-config": "var(--ct-config)",
        "ct-infra": "var(--ct-infra)",
        "ct-test": "var(--ct-test)",
        "ct-docs": "var(--ct-docs)",
        // status hues (component-library.md §2)
        "st-pending": "var(--st-pending)",
        "st-ready": "var(--st-ready)",
        "st-running": "var(--st-running)",
        "st-built": "var(--st-built)",
        "st-merged": "var(--st-merged)",
        "st-failed": "var(--st-failed)",
        "st-blocked": "var(--st-blocked)",
        "st-skipped": "var(--st-skipped)",
        // severity hues
        "sev-low": "var(--sev-low)",
        "sev-medium": "var(--sev-medium)",
        "sev-high": "var(--sev-high)",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "14px",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        xs: ["12px", "1.5"],
        sm: ["13px", "1.5"],
        base: ["14px", "1.5"],
        md: ["15px", "1.5"],
        lg: ["18px", "1.4"],
        xl: ["22px", "1.3"],
        "2xl": ["28px", "1.2"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 0 rgb(0 0 0 / 0.04)",
        pop: "0 4px 14px -2px rgb(0 0 0 / 0.18)",
        modal: "0 24px 64px -12px rgb(0 0 0 / 0.32)",
      },
      keyframes: {
        "pulse-ring": {
          "0%, 100%": { boxShadow: "0 0 0 0 var(--st-running)" },
          "50%": { boxShadow: "0 0 0 4px color-mix(in srgb, var(--st-running) 22%, transparent)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 1.6s ease-in-out infinite",
        "fade-in": "fade-in var(--motion-base, 200ms) ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
