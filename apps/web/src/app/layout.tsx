import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Orbitron } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

const orbitron = Orbitron({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-logo',
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://podex.dev';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Podex',
    template: '%s | Podex',
  },
  description:
    'Web-based agentic IDE platform for AI-powered development. Deploy AI agents that remember, plan, and execute together.',
  keywords: [
    'IDE',
    'AI',
    'development',
    'agents',
    'coding',
    'programming',
    'AI coding assistant',
    'cloud IDE',
    'multi-agent',
    'code generation',
    'developer tools',
  ],
  authors: [{ name: 'Podex Team', url: siteUrl }],
  creator: 'Podex',
  publisher: 'Podex',
  formatDetection: {
    telephone: false,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: siteUrl,
    siteName: 'Podex',
    title: 'Podex | Code from anywhere',
    description:
      'Web-based agentic IDE platform for AI-powered development. Deploy AI agents that remember, plan, and execute together.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Podex - AI-powered cloud IDE with multi-agent collaboration',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@podexdev',
    creator: '@podexdev',
    title: 'Podex | Code from anywhere',
    description:
      'Web-based agentic IDE platform for AI-powered development. Deploy AI agents that remember, plan, and execute together.',
    images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07070a' },
    { media: '(prefers-color-scheme: light)', color: '#f8f9fa' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${orbitron.variable}`}
      suppressHydrationWarning
      data-theme="dark"
    >
      <head>
        {/* Preconnect to critical origins */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />

        {/* PWA meta tags */}
        <meta name="application-name" content="Podex" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Podex" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* PWA manifest and icons */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className="bg-void text-text-primary antialiased">
        {/* Skip to main content link for accessibility */}
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>

        <Providers>
          {/* Main content wrapper */}
          <div id="main-content" tabIndex={-1} className="outline-none">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
