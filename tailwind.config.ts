import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          black: "#f6f8f5",
          panel: "#fbfdfb",
          raised: "#eef5f1",
          elevated: "#f2f7f4",
          line: "#cfded7",
          blue: "#2d63f2",
          electric: "#244fd6",
          text: "#18231f",
          muted: "#7b8b86",
          mint: "#0f9f87",
          cyan: "#128f95",
          amber: "#a77719",
          rose: "#c93649"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(15, 159, 135, 0.18)",
        panel: "0 1px 0 rgba(24, 35, 31, 0.03)"
      }
    }
  },
  plugins: []
};

export default config;
