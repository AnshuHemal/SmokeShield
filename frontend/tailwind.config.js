/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        ink: { 950: "#0a0b0f", 900: "#101218", 800: "#171a22", 700: "#222632", 600: "#2f3443" },
        ember: { 400: "#ff8a4c", 500: "#ff6a2b", 600: "#e5501a" },
      },
      keyframes: {
        pulseRing: { "0%": { boxShadow: "0 0 0 0 rgba(239,68,68,.6)" }, "100%": { boxShadow: "0 0 0 14px rgba(239,68,68,0)" } },
      },
      animation: { pulseRing: "pulseRing 1.4s ease-out infinite" },
    },
  },
  plugins: [],
};
