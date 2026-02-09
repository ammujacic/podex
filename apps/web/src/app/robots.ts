import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://podex.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin/',
          '/api/',
          '/auth/callback',
          '/_next/',
          '/settings/',
          '/dashboard/',
          '/workspace/',
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
