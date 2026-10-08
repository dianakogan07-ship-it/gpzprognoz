import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { DEFAULT: "#0B0B99", hover: "#08087A", soft: "#8B8BD6", light: "#EEF0FB" }, page: "#F4F5F9",
        report: { navy: "#101A7A", blue: "#1E4FD8", sky: "#4FB3F6", violet: "#7B5CE6", teal: "#14B8A6", bg: "#F2F4F8", ink: "#141B34", muted: "#5B6478" } },
      fontFamily: { sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
