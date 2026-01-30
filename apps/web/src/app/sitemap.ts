import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://podex.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    // Homepage
    {
      url: siteUrl,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    // Authentication
    {
      url: `${siteUrl}/auth/login`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/auth/signup`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    // Product
    {
      url: `${siteUrl}/agents`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${siteUrl}/changelog`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${siteUrl}/roadmap`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    // Resources
    {
      url: `${siteUrl}/docs`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    // Company
    {
      url: `${siteUrl}/about`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/contact`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    // Legal
    {
      url: `${siteUrl}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${siteUrl}/security`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    // Support
    {
      url: `${siteUrl}/status`,
      lastModified,
      changeFrequency: 'always',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/faq`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    // GEO-optimized pages
    {
      url: `${siteUrl}/compare`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${siteUrl}/glossary`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.6,
    },
  ];

  return staticPages;
}
