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
        shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
        alarm: { "0%,100%": { boxShadow: "0 0 0 1px rgba(239,68,68,.9), 0 0 18px 0 rgba(239,68,68,.25)" }, "50%": { boxShadow: "0 0 0 2px rgba(239,68,68,1), 0 0 34px 4px rgba(239,68,68,.55)" } },
      },
      animation: {
        pulseRing: "pulseRing 1.4s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        alarm: "alarm 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
