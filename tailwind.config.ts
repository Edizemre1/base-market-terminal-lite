import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          canvas: "rgb(var(--surface-canvas) / <alpha-value>)",
          panel: "rgb(var(--surface-panel) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
          interactive: "rgb(var(--surface-interactive) / <alpha-value>)",
          selected: "rgb(var(--surface-selected) / <alpha-value>)",
          overlay: "rgb(var(--surface-overlay) / <alpha-value>)",
          scrim: "rgb(var(--surface-scrim) / <alpha-value>)"
        },
        content: {
          primary: "rgb(var(--content-primary) / <alpha-value>)",
          secondary: "rgb(var(--content-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--content-tertiary) / <alpha-value>)",
          disabled: "rgb(var(--content-disabled) / <alpha-value>)",
          "on-accent": "rgb(var(--content-on-accent) / <alpha-value>)"
        },
        border: {
          subtle: "rgb(var(--border-subtle) / <alpha-value>)",
          DEFAULT: "rgb(var(--border-default) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
          selected: "rgb(var(--border-selected) / <alpha-value>)",
          focus: "rgb(var(--focus-ring) / <alpha-value>)"
        },
        focus: "rgb(var(--focus-ring) / <alpha-value>)",
        brand: {
          accent: "rgb(var(--brand-accent) / <alpha-value>)",
          action: "rgb(var(--action-primary) / <alpha-value>)"
        },
        network: { base: "rgb(var(--network-base) / <alpha-value>)" },
        market: {
          positive: "rgb(var(--market-positive) / <alpha-value>)",
          negative: "rgb(var(--market-negative) / <alpha-value>)",
          volume: "rgb(var(--market-volume) / <alpha-value>)"
        },
        freshness: {
          live: "rgb(var(--freshness-live) / <alpha-value>)",
          delayed: "rgb(var(--freshness-delayed) / <alpha-value>)",
          stale: "rgb(var(--freshness-stale) / <alpha-value>)"
        },
        trust: {
          verified: "rgb(var(--trust-verified) / <alpha-value>)",
          conflicting: "rgb(var(--trust-conflicting) / <alpha-value>)",
          risk: "rgb(var(--trust-risk) / <alpha-value>)"
        },
        operation: {
          ready: "rgb(var(--operation-ready) / <alpha-value>)",
          success: "rgb(var(--operation-success) / <alpha-value>)",
          failed: "rgb(var(--operation-failed) / <alpha-value>)",
          expired: "rgb(var(--operation-expired) / <alpha-value>)"
        }
      },
      fontSize: {
        meta: ["11px", { lineHeight: "14px" }],
        label: ["12px", { lineHeight: "16px" }],
        data: ["13px", { lineHeight: "18px" }],
        body: ["14px", { lineHeight: "20px" }],
        "title-sm": ["16px", { lineHeight: "20px" }],
        title: ["20px", { lineHeight: "24px" }],
        display: ["24px", { lineHeight: "30px" }]
      },
      letterSpacing: {
        label: "0.04em",
        eyebrow: "0.08em"
      },
      borderRadius: {
        seam: "var(--component-radius-none)",
        control: "var(--component-radius-small)",
        card: "var(--component-radius-medium)",
        panel: "var(--component-radius-large)",
        overlay: "var(--component-radius-overlay)",
        pill: "var(--component-radius-pill)"
      },
      spacing: {
        "control-s": "var(--component-control-s)",
        "control-m": "var(--component-control-m)",
        "control-touch": "var(--component-control-touch)",
        "row-compact": "var(--component-row-compact)",
        "row-comfortable": "var(--component-row-comfortable)",
        "shell-header": "var(--component-shell-header)",
        "shell-rail": "var(--component-shell-rail)",
        inspector: "var(--component-inspector-width)",
        popover: "var(--component-popover-width)",
        "modal-min": "var(--component-modal-min)",
        "modal-max": "var(--component-modal-max)",
        "sheet-max": "var(--component-sheet-max-height)",
        "chart-toolbar": "var(--component-chart-toolbar-offset)"
      },
      zIndex: {
        "layer-base": "0",
        "layer-sticky": "10",
        "layer-shell": "20",
        "layer-popover": "30",
        "layer-drawer": "40",
        "layer-modal": "50",
        "layer-toast": "60",
        "layer-a11y": "70"
      },
      boxShadow: {
        raised: "var(--component-shadow-raised)",
        popover: "var(--component-shadow-popover)",
        overlay: "var(--component-shadow-overlay)"
      },
      transitionDuration: {
        instant: "var(--component-motion-instant)",
        fast: "var(--component-motion-fast)",
        standard: "var(--component-motion-standard)",
        overlay: "var(--component-motion-overlay)",
        deliberate: "var(--component-motion-deliberate)"
      },
      transitionTimingFunction: {
        calm: "var(--component-ease-standard)",
        "calm-exit": "var(--component-ease-exit)"
      }
    }
  },
  plugins: []
};

export default config;
