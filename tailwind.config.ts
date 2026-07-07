import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          black: "rgb(var(--color-bg) / <alpha-value>)",
          panel: "rgb(var(--color-panel) / <alpha-value>)",
          raised: "rgb(var(--color-raised) / <alpha-value>)",
          elevated: "rgb(var(--color-elevated) / <alpha-value>)",
          line: "rgb(var(--color-line) / <alpha-value>)",
          blue: "rgb(var(--color-blue) / <alpha-value>)",
          electric: "rgb(var(--color-blue-soft) / <alpha-value>)",
          text: "rgb(var(--color-text) / <alpha-value>)",
          muted: "rgb(var(--color-muted) / <alpha-value>)",
          mint: "rgb(var(--color-mint) / <alpha-value>)",
          cyan: "rgb(var(--color-cyan) / <alpha-value>)",
          amber: "rgb(var(--color-amber) / <alpha-value>)",
          rose: "rgb(var(--color-rose) / <alpha-value>)"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(var(--color-mint) / 0.2)",
        panel: "0 1px 0 rgb(var(--color-text) / 0.04)"
      }
    }
  },
  plugins: []
};

export default config;
