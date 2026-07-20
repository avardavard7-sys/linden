import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F4F2ED",
        card: "#FCFBF7",
        ink: "#1E1B16",
        dim: "#6F675A",
        line: "#E5E0D3",
        linehard: "#CFC8B6",
        lacquer: "#211A12",
        lacquer2: "#161009",
        oak: "#B67F2E",
        oakdark: "#97671F",
        oaklight: "#EFE4CC",
        brand: "#FF4D00",
        branddark: "#D94100"
      },
      fontFamily: {
        display: ["Cormorant Garamond", "Georgia", "serif"],
        sans: ["Manrope", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      boxShadow: {
        soft: "0 1px 2px rgba(30,27,22,0.04), 0 8px 24px rgba(30,27,22,0.06)",
        lift: "0 2px 6px rgba(30,27,22,0.08), 0 16px 40px rgba(30,27,22,0.12)"
      }
    }
  },
  plugins: []
};

export default config;
