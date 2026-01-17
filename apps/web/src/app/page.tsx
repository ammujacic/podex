import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { AgentShowcase } from '@/components/landing/AgentShowcase';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { MobileSection } from '@/components/landing/MobileSection';
import { LiveDemoSection } from '@/components/landing/LiveDemoSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { TeamsSection } from '@/components/landing/TeamsSection';
import { LandingFaqSection } from '@/components/landing/LandingFaqSection';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Podex | Code from anywhere',
  description:
    'Deploy a pod of AI agents that remember, plan, and execute together. Web-based agentic IDE platform for AI-powered development.',
  alternates: {
    canonical: '/',
  },
};

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://podex.dev';

// JSON-LD Structured Data
const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Podex',
  url: siteUrl,
  logo: `${siteUrl}/icons/icon-512.png`,
  sameAs: [
    'https://twitter.com/podexdev',
    'https://github.com/podex',
    'https://linkedin.com/company/podex',
    'https://youtube.com/@podexdev',
  ],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    email: 'support@podex.dev',
  },
};

const webApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Podex',
  url: siteUrl,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Any',
  browserRequirements: 'Requires JavaScript. Requires HTML5.',
  description:
    'Web-based agentic IDE platform for AI-powered development. Deploy AI agents that remember, plan, and execute together.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Free',
      price: '0',
      priceCurrency: 'USD',
      description: 'Perfect for trying out Podex with limited tokens & compute',
    },
    {
      '@type': 'Offer',
      name: 'Pro',
      price: '29',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '29',
        priceCurrency: 'USD',
        billingDuration: 'P1M',
      },
      description: 'For professional developers with agent memory and planning mode',
    },
    {
      '@type': 'Offer',
      name: 'Team',
      price: '79',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '79',
        priceCurrency: 'USD',
        billingDuration: 'P1M',
      },
      description: 'For growing teams with collaboration and GPU access',
    },
  ],
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.9',
    ratingCount: '10000',
    bestRating: '5',
    worstRating: '1',
  },
  featureList: [
    'Multi-agent collaboration',
    'Agent memory',
    'Planning mode',
    'Vision analysis',
    'Voice commands',
    'Git integration',
    'Cloud compute',
    'Real-time collaboration',
  ],
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is Podex?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Podex is a web-based agentic IDE platform for AI-powered development. It allows you to deploy a pod of AI agents that remember, plan, and execute together to build software faster.',
      },
    },
    {
      '@type': 'Question',
      name: 'How does multi-agent collaboration work?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Podex features specialized AI agents (Orchestrator, Architect, Coder, Reviewer, Tester) that work together in parallel. The Orchestrator coordinates tasks, while specialized agents handle planning, coding, code review, and testing simultaneously.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is agent memory?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Agent memory allows AI agents to remember your coding style, preferences, and project context across sessions. This means suggestions and code generation improve over time and match how you work.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use Podex on mobile devices?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes! Podex is fully responsive and works on mobile devices. It includes voice-first coding, screenshot-to-code conversion, and cloud sync to work across all your devices.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is there a free tier?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes, Podex offers a free tier with limited tokens and compute for public projects. No credit card is required to get started.',
      },
    },
    {
      '@type': 'Question',
      name: 'What integrations does Podex support?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Podex supports Git integration (GitHub, GitLab, Bitbucket), MCP integrations, local pods for connecting to your local machine, and various compute options including GPU access for Team and Enterprise plans.',
      },
    },
  ],
};

const reviewSchema = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Podex',
  description: 'Web-based agentic IDE platform for AI-powered development',
  brand: {
    '@type': 'Brand',
    name: 'Podex',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.9',
    reviewCount: '5',
    bestRating: '5',
    worstRating: '1',
  },
  review: [
    {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: 'Sarah Chen' },
      reviewBody:
        "Podex completely changed how I build software. What used to take days now takes hours. The multi-agent collaboration is unlike anything I've seen.",
    },
    {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: 'Marcus Johnson' },
      reviewBody:
        'The agent memory feature is a game-changer. It remembers my coding style and preferences, making suggestions that actually match how I work.',
    },
    {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: 'Emily Rodriguez' },
      reviewBody:
        'We deployed Podex for our entire engineering team. The productivity gains are measurable - 40% faster feature delivery in the first month.',
    },
    {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: 'David Kim' },
      reviewBody:
        'The vision analysis is incredible. I upload a design mockup and the agents generate production-ready React components. Magic.',
    },
    {
      '@type': 'Review',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
      author: { '@type': 'Person', name: 'Alex Thompson' },
      reviewBody:
        'Finally, an AI coding tool that understands context. The planning and memory features make it feel like working with a real team.',
    },
  ],
};

export default function HomePage() {
  return (
    <>
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webApplicationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(reviewSchema) }}
      />

      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1">
          <HeroSection />
          <MobileSection />
          <HowItWorksSection />
          <AgentShowcase />
          <FeaturesSection />
          <LiveDemoSection />
          <TeamsSection />
          <PricingSection />
          <LandingFaqSection />
        </main>
        <Footer />
      </div>
    </>
  );
}
