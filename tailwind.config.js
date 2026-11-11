/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          50: '#f8fafc',
          100: '#e8ecf1',
          200: '#d0d5dd',
          300: '#b0b8c4',
          400: '#8892a0',
          500: '#636d7b',
          600: '#4a5363',
          700: '#343c4a',
          800: '#222930',
          900: '#181C23',
          950: '#0F1115',
        },
        surface: {
          DEFAULT: '#0F1115',
          card: '#181C23',
          hover: '#1f242d',
          elevated: '#1e232c',
        },
        border: {
          DEFAULT: '#2A313D',
          light: '#333b48',
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
        snapvision: {
          dark: '#0F1115',
          primary: '#E8ECF1',
          secondary: '#8892a0',
          tertiary: '#636d7b',
          muted: '#4a5363',
          'price-up': '#26A69A',
          'price-down': '#EF5350',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"PingFang SC"',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
        numeric: ['"JetBrains Mono"', '"SF Mono"', '"SF Pro Text"', 'monospace'],
      },
      fontSize: {
        'price-main': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'price-change': ['0.875rem', { lineHeight: '1.3', letterSpacing: '-0.01em' }],
        'section-header': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.02em' }],
        'body-data': ['0.8125rem', { lineHeight: '1.4' }],
        'auxiliary': ['0.6875rem', { lineHeight: '1.3' }],
      },

      letterSpacing: {
        tightest: '-0.02em',
        tighter: '-0.01em',
        tight: '0',
        normal: '0.005em',
        wide: '0.02em',
      },
      borderRadius: {
        card: '8px',
        button: '6px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.3)',
        'card-hover': '0 2px 8px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'price-flash-up': 'priceFlashUp 0.15s ease-out',
        'price-flash-down': 'priceFlashDown 0.15s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        priceFlashUp: {
          '0%': { color: '#26A69A' },
          '100%': { color: '#E8ECF1' },
        },
        priceFlashDown: {
          '0%': { color: '#EF5350' },
          '100%': { color: '#E8ECF1' },
        },
      },
    },
  },
  plugins: [],
};
