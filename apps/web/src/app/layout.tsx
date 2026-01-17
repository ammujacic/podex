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

export const metadata: Metadata = {
  title: {
    default: 'Podex',
    template: '%s | Podex',
  },
  description: 'Web-based agentic IDE platform for AI-powered development',
  keywords: ['IDE', 'AI', 'development', 'agents', 'coding', 'programming'],
  authors: [{ name: 'Podex Team' }],
  creator: 'Podex',
  publisher: 'Podex',
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Podex',
    title: 'Podex | Code from anywhere',
    description: 'Web-based agentic IDE platform for AI-powered development',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Podex | Code from anywhere',
    description: 'Web-based agentic IDE platform for AI-powered development',
  },
  robots: {
    index: true,
    follow: true,
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
