import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Clock, ArrowRight, Briefcase, Heart, Zap, Globe } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Join the Podex team and help build the future of AI-powered development. View open positions and benefits.',
  alternates: {
    canonical: '/careers',
  },
};

const benefits = [
  {
    icon: Globe,
    title: 'Remote First',
    description: 'Work from anywhere in the world. We value results over location.',
  },
  {
    icon: Heart,
    title: 'Health & Wellness',
    description: 'Comprehensive health insurance and wellness stipend for you and your family.',
  },
  {
    icon: Zap,
    title: 'Latest Tech',
    description: 'Top-of-the-line equipment and software. Use what works best for you.',
  },
  {
    icon: Briefcase,
    title: 'Equity',
    description: 'Meaningful equity stake. We all succeed together.',
  },
];

const openings = [
  {
    title: 'Senior Full-Stack Engineer',
    department: 'Engineering',
    location: 'Remote',
    type: 'Full-time',
    description:
      'Build the core Podex platform using Next.js, TypeScript, and Python. Work on real-time collaboration, AI integration, and cloud infrastructure.',
  },
  {
    title: 'Machine Learning Engineer',
    department: 'AI',
    location: 'Remote',
    type: 'Full-time',
    description:
      'Develop and optimize our AI agents. Work with LLMs, fine-tuning, and building novel agent architectures.',
  },
  {
    title: 'Developer Advocate',
    department: 'Developer Relations',
    location: 'Remote',
    type: 'Full-time',
    description:
      'Create content, build community, and help developers succeed with Podex. Represent us at conferences and online.',
  },
  {
    title: 'Product Designer',
    department: 'Design',
    location: 'Remote',
    type: 'Full-time',
    description:
      'Design intuitive interfaces for complex AI interactions. Create experiences that feel magical yet simple.',
  },
];

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-void">
      {/* Hero */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent-secondary/10 rounded-full blur-3xl" />
        </div>

        <div className="mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent-success/30 bg-accent-success/10 px-4 py-1.5 text-sm text-accent-success mb-6">
            We&apos;re Hiring!
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-text-primary mb-6">
            Build the Future <span className="text-accent-secondary">With Us</span>
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Join a team of passionate builders working on one of the most exciting problems in
            software: making developers superpowered with AI.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 lg:py-24 bg-surface">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-text-primary mb-12 text-center">
            Why Join Podex?
          </h2>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="text-center">
                <div className="p-4 rounded-2xl bg-accent-secondary/10 w-fit mx-auto mb-4">
                  <benefit.icon className="h-8 w-8 text-accent-secondary" />
                </div>
                <h3 className="text-lg font-bold text-text-primary mb-2">{benefit.title}</h3>
                <p className="text-sm text-text-muted">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open Positions */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <h2 className="text-3xl font-bold text-text-primary mb-12 text-center">Open Positions</h2>
          <div className="space-y-6">
            {openings.map((job) => (
              <article
                key={job.title}
                className="group p-6 rounded-2xl bg-surface border border-border-default hover:border-border-strong transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-2">
                      <span className="px-2 py-0.5 rounded text-xs bg-elevated text-text-muted">
                        {job.department}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold text-text-primary group-hover:text-accent-primary transition-colors mb-2">
                      {job.title}
                    </h3>
                    <p className="text-sm text-text-muted mb-3">{job.description}</p>
                    <div className="flex items-center gap-4 text-sm text-text-muted">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {job.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {job.type}
                      </span>
                    </div>
                  </div>
                  <Link
                    href="/contact"
                    className="px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all inline-flex items-center gap-2 shrink-0"
                  >
                    Apply Now
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 lg:py-24 bg-surface">
        <div className="mx-auto max-w-4xl px-4 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-text-primary mb-4">Don&apos;t See Your Role?</h2>
          <p className="text-text-secondary mb-8">
            We&apos;re always looking for talented people. Send us your resume and let&apos;s talk.
          </p>
          <Link
            href="/contact"
            className="px-6 py-3 rounded-xl bg-surface border border-border-default text-text-primary font-medium hover:border-border-strong transition-all inline-flex items-center gap-2"
          >
            Get in Touch
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
