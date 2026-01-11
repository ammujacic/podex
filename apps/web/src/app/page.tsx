import { Header } from '@/components/layout/Header';
import { HeroSection } from '@/components/landing/HeroSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { AgentShowcase } from '@/components/landing/AgentShowcase';
import { FeaturesSection } from '@/components/landing/FeaturesSection';
import { LiveDemoSection } from '@/components/landing/LiveDemoSection';
import { PricingSection } from '@/components/landing/PricingSection';
import { Footer } from '@/components/landing/Footer';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <HowItWorksSection />
        <AgentShowcase />
        <FeaturesSection />
        <LiveDemoSection />
        <PricingSection />
      </main>
      <Footer />
    </div>
  );
}
