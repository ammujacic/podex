import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@podex/shared', '@podex/ui'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
  // ESLint is configured via eslint.config.mjs (flat config format)
  // Next.js's built-in detection doesn't recognize flat config, but the plugin
  // IS correctly configured in eslint.config.mjs with all recommended rules.
  // We skip Next.js's detection to avoid the false-positive warning.
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'cdn.simpleicons.org',
      },
    ],
  },
  webpack: (config) => {
    // Handle monaco-editor
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    return config;
  },
};

// Sentry webpack plugin options
const sentryWebpackPluginOptions = {
  // Organization and project from environment
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Only upload source maps in production builds
  silent: !process.env.CI,

  // Upload source maps to Sentry
  sourcemaps: {
    // Delete source maps after upload to not expose them publicly
    deleteSourcemapsAfterUpload: true,
  },

  // Automatically tree-shake Sentry logger statements
  disableLogger: true,

  // Tunnel Sentry requests to avoid ad blockers (optional)
  // tunnelRoute: '/monitoring-tunnel',

  // Disable Sentry in development if no DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Hide source maps from being served
  hideSourceMaps: true,

  // Widen the upload scope for monorepo setups
  widenClientFileUpload: true,

  // Automatically annotate React components with Sentry instrumentation
  reactComponentAnnotation: {
    enabled: true,
  },

  // Release name
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'podex-web@0.1.0',
};

// Wrap the config with Sentry
export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
