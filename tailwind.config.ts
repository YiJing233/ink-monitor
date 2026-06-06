import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  // E-ink: avoid dark mode (B&W only), keep design tokens extremely restrained.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Pure B&W palette, mapped to shadcn naming
        background: '#ffffff',
        foreground: '#000000',
        muted: '#f4f4f4',
        'muted-foreground': '#3a3a3a',
        card: '#ffffff',
        'card-foreground': '#000000',
        popover: '#ffffff',
        'popover-foreground': '#000000',
        border: '#000000',
        input: '#000000',
        ring: '#000000',
        primary: '#000000',
        'primary-foreground': '#ffffff',
        secondary: '#e8e8e8',
        'secondary-foreground': '#000000',
        accent: '#000000',
        'accent-foreground': '#ffffff',
        destructive: '#000000',
        'destructive-foreground': '#ffffff',
      },
      fontFamily: {
        // Use system fonts only — no Web Font download on e-ink devices
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Sharper corners feel crisper on e-ink
        DEFAULT: '2px',
        sm: '0',
        md: '2px',
        lg: '4px',
      },
      keyframes: {},
      animation: {},
    },
  },
  plugins: [],
};

export default config;
