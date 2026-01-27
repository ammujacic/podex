import { withSentryConfig } from '@sentry/nextjs';
import withSerwist from '@serwist/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow dev server access from local network (mobile testing)
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*'],
  transpilePackages: [
    '@podex/shared',
    '@podex/ui',
  ],
  // Exclude Monaco packages from server-side bundling to avoid --localstorage-file warnings
  // These packages are only used on the client via dynamic imports
  serverExternalPackages: [
    // Monaco core
    '@codingame/monaco-vscode-api',
    '@codingame/monaco-vscode-editor-api',
    '@codingame/monaco-vscode-textmate-service-override',
    '@codingame/monaco-vscode-theme-service-override',
    '@codingame/monaco-vscode-languages-service-override',
    '@codingame/monaco-vscode-theme-defaults-default-extension',
    'vscode-oniguruma',
    // Web languages
    '@codingame/monaco-vscode-typescript-basics-default-extension',
    '@codingame/monaco-vscode-json-default-extension',
    '@codingame/monaco-vscode-css-default-extension',
    '@codingame/monaco-vscode-html-default-extension',
    '@codingame/monaco-vscode-markdown-basics-default-extension',
    '@codingame/monaco-vscode-xml-default-extension',
    // Systems programming
    '@codingame/monaco-vscode-cpp-default-extension',
    '@codingame/monaco-vscode-rust-default-extension',
    '@codingame/monaco-vscode-go-default-extension',
    // JVM languages
    '@codingame/monaco-vscode-java-default-extension',
    '@codingame/monaco-vscode-groovy-default-extension',
    '@codingame/monaco-vscode-clojure-default-extension',
    // .NET languages
    '@codingame/monaco-vscode-csharp-default-extension',
    '@codingame/monaco-vscode-fsharp-default-extension',
    // Scripting languages
    '@codingame/monaco-vscode-python-default-extension',
    '@codingame/monaco-vscode-ruby-default-extension',
    '@codingame/monaco-vscode-php-default-extension',
    '@codingame/monaco-vscode-perl-default-extension',
    '@codingame/monaco-vscode-lua-default-extension',
    '@codingame/monaco-vscode-r-default-extension',
    // Apple ecosystem
    '@codingame/monaco-vscode-swift-default-extension',
    '@codingame/monaco-vscode-objective-c-default-extension',
    // Shell & scripting
    '@codingame/monaco-vscode-shellscript-default-extension',
    '@codingame/monaco-vscode-powershell-default-extension',
    '@codingame/monaco-vscode-bat-default-extension',
    // Config & data
    '@codingame/monaco-vscode-yaml-default-extension',
    '@codingame/monaco-vscode-sql-default-extension',
    '@codingame/monaco-vscode-docker-default-extension',
    '@codingame/monaco-vscode-make-default-extension',
  ],
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
      // Redirect monaco-editor imports to monaco-vscode-editor-api
      'monaco-editor': '@codingame/monaco-vscode-editor-api',
      'monaco-editor/esm/vs/editor/editor.api': '@codingame/monaco-vscode-editor-api',
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

// Serwist PWA configuration
const withSerwistConfig = withSerwist({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
});

// Wrap the config: Serwist -> Sentry
export default withSentryConfig(withSerwistConfig(nextConfig), sentryWebpackPluginOptions);
