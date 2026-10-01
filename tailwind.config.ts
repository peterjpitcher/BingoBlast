import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // The Anchor palette. The values live in globals.css (:root), the one
      // source; these only name them as utilities.
      colors: {
        anchor: {
          green: "var(--anchor-green)", // bingo balls
          "green-dark": "var(--anchor-green-dark)",
          "green-deep": "var(--anchor-green-deep)", // the page
          "green-raised": "var(--anchor-green-raised)", // rows and chips on a card
          "green-card": "var(--anchor-green-card)", // cards, sheets, dialogs
          "green-light": "var(--anchor-green-light)",
          sunk: "var(--surface-sunk)",
          sage: "var(--anchor-sage)", // muted text
          gold: "var(--anchor-gold)", // fills (the primary button)
          "gold-dark": "var(--anchor-gold-dark)",
          "gold-bright": "var(--anchor-gold-bright)", // accents and text on dark
          charcoal: "var(--anchor-charcoal)", // text on gold
          cream: "var(--anchor-cream)",
          "cream-text": "var(--anchor-cream-text)", // body text
          sand: "var(--anchor-sand)",
          "grey-500": "var(--anchor-grey-500)",
          success: "var(--anchor-success)",
          "success-text": "var(--anchor-success-text)",
          danger: "var(--anchor-danger)", // fills and borders
          "danger-text": "var(--anchor-danger-text)", // text on a dark surface
        },
        // Gold hairlines: border-line (rows), border-line-strong (inputs,
        // emphasis), border-line-gold (cards, bars).
        line: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
          gold: "var(--border-gold)",
        },
        scrim: "var(--scrim)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Times New Roman", "serif"],
        script: ["var(--font-script)", "Brush Script MT", "cursive"],
      },
      // Four shapes only: 3px dark cards and number tiles, 6px inputs, and
      // rounded-full for buttons, badges, balls and chips.
      borderRadius: {
        card: "3px",
        input: "6px",
      },
      boxShadow: {
        gold: "var(--shadow-gold)",
        lift: "var(--shadow-lg)",
        sheet: "0 -20px 60px rgba(0, 0, 0, 0.4)",
      },
      transitionTimingFunction: {
        anchor: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      // Fades and short rises only (150 to 400ms), no bounces and no loops on
      // content. globals.css switches all of them off for reduced motion.
      animation: {
        "fade-up": "anchor-fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "anchor-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) both",
        "sheet-up": "anchor-sheet-up 0.3s cubic-bezier(0.16, 1, 0.3, 1) both",
        "ball-in": "anchor-ball-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      // Pub TV text (spec 5.7). Each is clamp(size at 1280x720, vh term, cap),
      // with the vh term landing on the 1920x1080 size, so the floors hold on
      // both: 32px and 22px for any text, 44px and 30px for key information.
      // Heights only: the TV's layout is budgeted in rem (display-ui.tsx), and
      // the root font size must not change.
      //   tv-xs to tv-base stop growing at 1080p, because they sit in the
      //   TV's fixed-height top bar and footer; the larger sizes are only used
      //   on slides and overlays, so they keep growing on bigger screens.
      // Use them through tvText() in src/components/display/tv-text.ts. They are
      // also registered as font sizes with tailwind-merge in src/lib/utils.ts,
      // so cn() keeps them; keep that list in step with these names (a test
      // checks it).
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
