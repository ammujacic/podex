import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@podex/shared', '@podex/ui'],
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
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
  // Turbopack configuration for Monaco Editor compatibility
  turbopack: {
    resolveAlias: {
      fs: {
        browser: './empty.ts',
      },
      path: {
        browser: './empty.ts',
      },
    },
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

  // Tree-shake Sentry debug logging (Turbopack compatible)
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    reactComponentAnnotation: {
      enabled: true,
    },
  },

  // Tunnel Sentry requests to avoid ad blockers (optional)
  // tunnelRoute: '/monitoring-tunnel',

  // Disable Sentry in development if no DSN is configured
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Hide source maps from being served
  hideSourceMaps: true,

  // Widen the upload scope for monorepo setups
  widenClientFileUpload: true,

  // Release name
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || 'podex-web@0.1.0',
};

// Wrap the config with Sentry
export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
