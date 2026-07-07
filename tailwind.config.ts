import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        base: {
          black: "#070908",
          panel: "#101411",
          raised: "#171d19",
          line: "#28342d",
          mint: "#3ddc97",
          cyan: "#5ec8f2",
          amber: "#f2b84b",
          rose: "#ff6f91"
        }
      },
      boxShadow: {
        glow: "0 0 48px rgba(61, 220, 151, 0.16)"
      }
    }
  },
  plugins: []
};

export default config;
