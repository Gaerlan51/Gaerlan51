import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#0f766e', fg: '#ffffff', muted: '#ccfbf1' },
      },
    },
  },
  plugins: [],
} satisfies Config;
