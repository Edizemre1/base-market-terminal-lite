import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          black: "#03050a",
          panel: "#070b13",
          raised: "#0b1220",
          elevated: "#111827",
          line: "#1f2a44",
          blue: "#0052ff",
          electric: "#00a3ff",
          text: "#eaf1ff",
          muted: "#8b9bb4",
          mint: "#20d49b",
          cyan: "#55d7ff",
          amber: "#f5b84b",
          rose: "#ff5c7a"
        }
      },
      boxShadow: {
        glow: "0 0 44px rgba(0, 82, 255, 0.22)",
        panel: "0 18px 60px rgba(0, 0, 0, 0.32)"
      }
    }
  },
  plugins: []
};

export default config;
