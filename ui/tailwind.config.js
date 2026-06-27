/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1.5rem",
      screens: { "2xl": "1200px" },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Arial", "sans-serif"],
        mono: ["JetBrains Mono", "IBM Plex Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          muted: "hsl(var(--destructive-muted))",
          border: "hsl(var(--destructive-border))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          muted: "hsl(var(--success-muted))",
          border: "hsl(var(--success-border))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          muted: "hsl(var(--warning-muted))",
          border: "hsl(var(--warning-border))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.30)",
        sm: "0 1px 3px 0 rgb(0 0 0 / 0.40), 0 1px 2px -1px rgb(0 0 0 / 0.30)",
        md: "0 8px 24px -6px rgb(0 0 0 / 0.55), 0 2px 8px -2px rgb(0 0 0 / 0.40)",
        lg: "0 24px 60px -16px rgb(0 0 0 / 0.70)",
      },
      keyframes: {
        "overlay-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "dialog-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.985)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "flash": {
          "0%": { backgroundColor: "hsl(var(--success-muted))" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-red": {
          "0%": { backgroundColor: "hsl(var(--destructive-muted))" },
          "100%": { backgroundColor: "transparent" },
        },
        "flash-amber": {
          "0%": { backgroundColor: "hsl(var(--warning-muted))" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "overlay-in": "overlay-in 140ms ease-out",
        "dialog-in": "dialog-in 160ms cubic-bezier(0.16,1,0.3,1)",
        "fade-in": "fade-in 200ms ease-out",
        flash: "flash 1.4s ease-out",
        "flash-red": "flash-red 1.4s ease-out",
        "flash-amber": "flash-amber 1.4s ease-out",
      },
    },
  },
  plugins: [],
};
