import type { Metadata } from 'next';
import Link from 'next/link';
import { Target, Heart, Zap, Users, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About Us',
  description:
    'Learn about Podex, our mission to democratize AI-powered development, and the team building the future of coding.',
  alternates: {
    canonical: '/about',
  },
};

const values = [
  {
    icon: Target,
    title: 'Developer-First',
    description:
      'Every feature we build starts with one question: will this make developers more productive and happy?',
  },
  {
    icon: Heart,
    title: 'Open & Transparent',
    description:
      'We believe in building in public. Our roadmap is open, and we share our learnings with the community.',
  },
  {
    icon: Zap,
    title: 'Ship Fast, Iterate Faster',
    description:
      'We move quickly but thoughtfully. Small, frequent releases let us learn and improve continuously.',
  },
  {
    icon: Users,
    title: 'Community Driven',
    description:
      'Our best features come from user feedback. We listen, we learn, and we build what developers need.',
  },
];

const stats = [
  { value: '10,000+', label: 'Active Developers' },
  { value: '500K+', label: 'Projects Created' },
  { value: '50M+', label: 'Lines of Code Generated' },
  { value: '4.9/5', label: 'Average Rating' },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-void">
      {/* Hero */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent-primary/10 rounded-full blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6">
            Building the Future of <span className="text-accent-primary">Development</span>
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            We&apos;re on a mission to make every developer 10x more productive by harnessing the
            power of AI agents that truly understand code.
          </p>
        </div>
      </section>

      {/* Story */}
      <section className="py-16 lg:py-24 bg-surface">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-text-primary mb-6">Our Story</h2>
          <div className="prose prose-invert max-w-none">
            <p className="text-text-secondary text-lg leading-relaxed mb-4">
              Podex was born from a simple observation: developers spend too much time on repetitive
              tasks that AI could handle better. We saw the potential of large language models and
              knew they could transform how software is built.
            </p>
            <p className="text-text-secondary text-lg leading-relaxed mb-4">
              But existing tools felt like bolted-on copilots. We wanted something different - a
              true AI development environment where multiple specialized agents work together,
              remember context, plan ahead, and execute in parallel.
            </p>
            <p className="text-text-secondary text-lg leading-relaxed">
              Today, Podex powers development teams around the world, from solo indie hackers to
              enterprise engineering organizations. We&apos;re just getting started.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-text-primary mb-12 text-center">Our Values</h2>
          <div className="grid gap-8 md:grid-cols-2">
            {values.map((value) => (
              <div key={value.title} className="flex gap-4">
                <div className="p-3 rounded-xl bg-accent-primary/10 h-fit">
                  <value.icon className="h-6 w-6 text-accent-primary" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-text-primary mb-2">{value.title}</h3>
                  <p className="text-text-secondary">{value.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 lg:py-24 bg-surface">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl lg:text-5xl font-bold text-accent-primary mb-2">
                  {stat.value}
                </div>
                <div className="text-text-muted">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-text-primary mb-4">Join Us on This Journey</h2>
          <p className="text-text-secondary mb-8">
            Whether you&apos;re building the next big thing or just learning to code, we&apos;re
            here to help you succeed.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/auth/signup"
              className="px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all inline-flex items-center gap-2"
            >
              Start Building Free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/careers"
              className="px-6 py-3 rounded-xl bg-surface border border-border-default text-text-primary font-medium hover:border-border-strong transition-all"
            >
              Join Our Team
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
