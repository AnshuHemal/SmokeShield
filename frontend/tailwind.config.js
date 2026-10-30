/** @type {import('tailwindcss').Config} */

// Every themed colour is a CSS variable holding space-separated RGB channels (see src/index.css),
// so Tailwind opacity modifiers like `bg-ink-800/50` keep working in both themes.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
      colors: {
        // surfaces: 950 page, 900 cards, 800 inputs / subtle fills, 700 borders, 600 strong borders
        ink: { 950: v("ink-950"), 900: v("ink-900"), 800: v("ink-800"), 700: v("ink-700"), 600: v("ink-600") },
        ember: { 400: v("ember-400"), 500: v("ember-500"), 600: v("ember-600"), solid: v("ember-solid"), "solid-hover": v("ember-solid-hover") },
        heading: v("heading"),
        fire: v("fire"),
        smoke: v("smoke"),
        warn: v("warn"),
        // text greys flip between themes; only the shades the app uses are overridden
        slate: { 100: v("slate-100"), 200: v("slate-200"), 300: v("slate-300"), 400: v("slate-400"), 500: v("slate-500"), 600: v("slate-600") },
        // status colours: text shades get darker in light mode so they stay readable on pale tints
        emerald: { 300: v("emerald-300"), 400: v("emerald-400") },
        amber: { 200: v("amber-200"), 300: v("amber-300"), 400: v("amber-400") },
        red: { 200: v("red-200"), 300: v("red-300"), 400: v("red-400") },
        sky: { 300: v("sky-300"), 400: v("sky-400") },
      },
      boxShadow: { card: "var(--card-shadow)" },
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
