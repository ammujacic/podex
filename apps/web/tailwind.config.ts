import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        void: 'var(--bg-void)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        overlay: 'var(--bg-overlay)',
        active: 'var(--bg-active)',

        // Borders
        'border-subtle': 'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        'border-focus': 'var(--border-focus)',

        // Text
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        'text-inverse': 'var(--text-inverse)',

        // Accents
        accent: {
          primary: 'var(--accent-primary)',
          'primary-hover': 'var(--accent-primary-hover)',
          secondary: 'var(--accent-secondary)',
          'secondary-hover': 'var(--accent-secondary-hover)',
          success: 'var(--accent-success)',
          'success-hover': 'var(--accent-success-hover)',
          warning: 'var(--accent-warning)',
          'warning-hover': 'var(--accent-warning-hover)',
          error: 'var(--accent-error)',
          'error-hover': 'var(--accent-error-hover)',
        },

        // Agent colors
        agent: {
          1: 'var(--agent-1)',
          2: 'var(--agent-2)',
          3: 'var(--agent-3)',
          4: 'var(--agent-4)',
          5: 'var(--agent-5)',
          6: 'var(--agent-6)',
        },

        // Syntax highlighting
        syntax: {
          keyword: 'var(--syntax-keyword)',
          string: 'var(--syntax-string)',
          number: 'var(--syntax-number)',
          function: 'var(--syntax-function)',
          comment: 'var(--syntax-comment)',
          variable: 'var(--syntax-variable)',
          type: 'var(--syntax-type)',
        },

        // Glass morphism
        glass: {
          bg: 'var(--glass-bg)',
          border: 'var(--glass-border)',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'JetBrains Mono', 'Fira Code', 'SF Mono', 'monospace'],
        sans: ['var(--font-sans)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '112': '28rem',
        '128': '32rem',
        'safe-bottom': 'env(safe-area-inset-bottom, 0)',
        'safe-top': 'env(safe-area-inset-top, 0)',
      },
      minHeight: {
        touch: '44px',
        'touch-lg': '48px',
      },
      minWidth: {
        touch: '44px',
        'touch-lg': '48px',
      },
      boxShadow: {
        glow: 'var(--glow-primary)',
        'glow-intense': 'var(--glow-primary-intense)',
        'glow-secondary': 'var(--glow-secondary)',
        'glow-success': 'var(--glow-success)',
        'glow-error': 'var(--glow-error)',
        panel: 'var(--shadow-panel)',
        dropdown: 'var(--shadow-dropdown)',
        modal: 'var(--shadow-modal)',
      },
      backdropBlur: {
        glass: 'var(--glass-blur)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      zIndex: {
        dropdown: 'var(--z-dropdown)',
        sticky: 'var(--z-sticky)',
        modal: 'var(--z-modal)',
        popover: 'var(--z-popover)',
        toast: 'var(--z-toast)',
        tooltip: 'var(--z-tooltip)',
        max: 'var(--z-max)',
      },
      transitionDuration: {
        fast: '100ms',
        normal: '200ms',
        slow: '300ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'fade-out': 'fadeOut 200ms ease-in',
        'slide-up': 'slideUp 200ms ease-out',
        'slide-down': 'slideDown 200ms ease-out',
        'slide-in-left': 'slideInLeft 200ms ease-out',
        'slide-in-right': 'slideInRight 200ms ease-out',
        'slide-in-bottom': 'slideInBottom 300ms ease-out',
        'slide-out-bottom': 'slideOutBottom 200ms ease-in',
        'scale-in': 'scaleIn 200ms ease-out',
        'scale-out': 'scaleOut 150ms ease-in',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'spin-slow': 'spinSlow 3s linear infinite',
        'bounce-soft': 'bounceSoft 1s ease-in-out infinite',
        shake: 'shake 0.5s ease-in-out',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        gradient: 'gradient 3s ease-in-out infinite',
        ripple: 'ripple 600ms linear',
        typing: 'typing 1s steps(3) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInBottom: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        slideOutBottom: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100%)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        scaleOut: {
          '0%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0', transform: 'scale(0.95)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 229, 255, 0.25)' },
          '50%': { boxShadow: '0 0 30px rgba(0, 229, 255, 0.4)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        spinSlow: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-4px)' },
          '75%': { transform: 'translateX(4px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        gradient: {
          '0%, 100%': { backgroundPosition: '0% center' },
          '50%': { backgroundPosition: '100% center' },
        },
        ripple: {
          to: { transform: 'scale(4)', opacity: '0' },
        },
        typing: {
          '0%': { opacity: '0' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      screens: {
        xs: '480px',
        touch: { raw: '(hover: none)' },
        pointer: { raw: '(hover: hover)' },
        'reduced-motion': { raw: '(prefers-reduced-motion: reduce)' },
      },
    },
  },
  plugins: [],
};

export default config;
