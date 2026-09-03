import type { Config } from 'tailwindcss';

/**
 * Colours resolve to CSS variables defined in globals.css, in
 * space-separated RGB form so Tailwind's opacity modifiers still work
 * (`bg-surface/60`). One token set, two themes, no duplicated palette.
 */
export default {
  darkMode: 'media',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas:      'rgb(var(--canvas) / <alpha-value>)',
        surface:     'rgb(var(--surface) / <alpha-value>)',
        raised:      'rgb(var(--raised) / <alpha-value>)',
        line:        'rgb(var(--line) / <alpha-value>)',
        ink:         'rgb(var(--ink) / <alpha-value>)',
        muted:       'rgb(var(--muted) / <alpha-value>)',
        brand:       'rgb(var(--brand) / <alpha-value>)',
        'brand-ink': 'rgb(var(--brand-ink) / <alpha-value>)',
        'brand-sub': 'rgb(var(--brand-sub) / <alpha-value>)',
        accent:      'rgb(var(--accent) / <alpha-value>)',
        positive:    'rgb(var(--positive) / <alpha-value>)',
        caution:     'rgb(var(--caution) / <alpha-value>)',
        critical:    'rgb(var(--critical) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.25rem' },
      boxShadow: {
        subtle: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        lift: '0 4px 6px -1px rgb(15 23 42 / 0.07), 0 12px 24px -8px rgb(15 23 42 / 0.12)',
        panel: '0 24px 48px -24px rgb(15 23 42 / 0.35)',
      },
      maxWidth: { content: '72rem' },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'fade-up': 'fade-up 0.4s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
