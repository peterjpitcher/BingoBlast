import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        bingo: {
          primary: "#EC4899", // Pink-500
          secondary: "#F59E0B", // Amber-500
          accent: "#6366F1", // Indigo-500
          dark: "#0F172A", // Slate-900
          surface: "#1E293B", // Slate-800
        }
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
      },
      // Pub TV text (spec 5.7). Each is clamp(size at 1280x720, vh term, cap),
      // with the vh term landing on the 1920x1080 size, so the floors hold on
      // both: 32px and 22px for any text, 44px and 30px for key information.
      // Heights only: the TV's layout is budgeted in rem (display-ui.tsx), and
      // the root font size must not change.
      //   tv-xs to tv-base stop growing at 1080p, because they sit in the
      //   TV's fixed-height top bar and footer; the larger sizes are only used
      //   on slides and overlays, so they keep growing on bigger screens.
      // Use them through tvText() in src/components/display/tv-text.ts, not
      // cn(): tailwind-merge reads `text-tv-*` as a text colour and drops it.
      fontSize: {
        "tv-xs": ["clamp(22px, 3vh, 32.4px)", { lineHeight: "1.25" }], // 22 / 32.4: the floor
        "tv-sm": ["clamp(26px, 3.5vh, 37.8px)", { lineHeight: "1.2" }], // 26 / 37.8: second lines
        "tv-base": ["clamp(30px, 4.1vh, 44.3px)", { lineHeight: "1.15" }], // 30 / 44.3: key information
        "tv-lg": ["clamp(36px, 5.2vh, 96px)", { lineHeight: "1.05" }], // 37.4 / 56.2: slide titles
        "tv-xl": ["clamp(40px, 6.5vh, 120px)", { lineHeight: "1.05" }], // 46.8 / 70.2: screen headlines
        "tv-2xl": ["clamp(44px, 8vh, 140px)", { lineHeight: "1.05" }], // 57.6 / 86.4: whole-slide headlines
        "tv-3xl": ["clamp(56px, 11vh, 200px)", { lineHeight: "0.95" }], // 79.2 / 118.8: countdown, win over balls
        // The one width-based size, as the win headline always was: 128 / 144.
        "tv-4xl": ["clamp(48px, 10vw, 144px)", { lineHeight: "0.9" }], // the win on its own
      },
    },
  },
  plugins: [],
};
export default config;
