import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          black: "#f6f3ea",
          panel: "#fffdf7",
          raised: "#eee9dc",
          elevated: "#faf7ee",
          line: "#d8d2c4",
          blue: "#2457ff",
          electric: "#4172ff",
          text: "#15201c",
          muted: "#66736d",
          mint: "#10a878",
          cyan: "#0ea5a8",
          amber: "#b7791f",
          rose: "#c23b55"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(16, 168, 120, 0.18)",
        panel: "0 12px 32px rgba(35, 41, 36, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
