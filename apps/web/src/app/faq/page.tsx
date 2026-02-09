'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Search, MessageSquare } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

const faqs = [
  {
    category: 'General',
    questions: [
      {
        q: 'What is Podex?',
        a: 'Podex is a web-based agentic IDE platform for AI-powered development. It allows you to deploy a pod of AI agents that remember, plan, and execute together to build software faster.',
      },
      {
        q: 'How does multi-agent collaboration work?',
        a: 'Podex features specialized AI agents (Orchestrator, Architect, Coder, Reviewer, Tester) that work together in parallel. The Orchestrator coordinates tasks, while specialized agents handle planning, coding, code review, and testing simultaneously.',
      },
      {
        q: 'What is agent memory?',
        a: 'Agent memory allows AI agents to remember your coding style, preferences, and project context across sessions. This means suggestions and code generation improve over time and match how you work.',
      },
      {
        q: 'Can I use Podex on mobile devices?',
        a: 'Yes! Podex is fully responsive and works on mobile devices. It includes voice-first coding, screenshot-to-code conversion, and cloud sync to work across all your devices.',
      },
    ],
  },
  {
    category: 'Pricing & Plans',
    questions: [
      {
        q: 'Is there a free tier?',
        a: 'Yes, Podex offers a free tier with limited tokens and compute for public projects. No credit card is required to get started.',
      },
      {
        q: 'What is included in the Pro plan?',
        a: 'The Pro plan ($29/month) includes generous tokens and compute, private projects, agent memory, planning mode, vision analysis, Git integration, and email support.',
      },
      {
        q: 'Can I change plans at any time?',
        a: 'Yes, you can upgrade or downgrade your plan at any time. When upgrading, the new features are available immediately. When downgrading, the change takes effect at the end of your billing cycle.',
      },
      {
        q: 'Do you offer discounts for annual billing?',
        a: 'Yes, we offer a 17% discount when you choose annual billing instead of monthly.',
      },
    ],
  },
  {
    category: 'Features',
    questions: [
      {
        q: 'What integrations does Podex support?',
        a: 'Podex supports Git integration (GitHub, GitLab, Bitbucket), MCP integrations, local pods for connecting to your local machine, and various compute options including GPU access for Team and Enterprise plans.',
      },
      {
        q: 'How does the Vision agent work?',
        a: 'The Vision agent can analyze screenshots, design mockups, and images to generate code. Simply upload an image, and the agent will create React components, CSS styles, or other code based on the visual content.',
      },
      {
        q: 'Can I use voice commands?',
        a: 'Yes! Podex supports voice-first coding where you can dictate code, give instructions to agents, and control the IDE using natural language voice commands.',
      },
      {
        q: 'What is Local Pods?',
        a: 'Local Pods allows you to connect Podex to your local development machine. This enables agents to access local files, run commands on your machine, and interact with local development environments.',
      },
    ],
  },
  {
    category: 'Security & Privacy',
    questions: [
      {
        q: 'Is my code private?',
        a: 'Yes, your code is private and secure. We use encryption at rest (AES-256) and in transit (TLS 1.3). Your code is never used to train AI models.',
      },
      {
        q: 'Where is my data stored?',
        a: 'Your data is stored on secure cloud infrastructure in the United States. Enterprise customers can request specific data residency requirements.',
      },
      {
        q: 'What security certifications do you have?',
        a: 'We are actively working towards industry security certifications. See our Security page for details on our current security practices and compliance roadmap.',
      },
    ],
  },
  {
    category: 'Technical',
    questions: [
      {
        q: 'What languages and frameworks are supported?',
        a: 'Podex supports all major programming languages and frameworks. Our agents are trained on a wide variety of technologies including JavaScript/TypeScript, Python, Go, Rust, Java, and many more.',
      },
      {
        q: 'Can I use my own AI API keys?',
        a: 'Enterprise customers can configure custom LLM providers. For standard plans, Podex manages the AI infrastructure to ensure optimal performance and security.',
      },
      {
        q: 'What is the maximum project size?',
        a: 'There are no hard limits on project size. The free tier has storage limits, while paid plans offer generous storage that scales with your needs.',
      },
      {
        q: 'Can I export my code?',
        a: 'Absolutely! Your code is yours. You can push to any Git provider, download as a ZIP, or sync with your local machine using Local Pods.',
      },
    ],
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-4 text-left"
      >
        <span className="font-medium text-text-primary pr-4">{question}</span>
        <ChevronDown
          className={`h-5 w-5 text-text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {isOpen && <p className="pb-4 text-text-muted text-sm">{answer}</p>}
    </div>
  );
}

export default function FaqPage() {
  const [search, setSearch] = useState('');

  const filteredFaqs = faqs
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) =>
          q.q.toLowerCase().includes(search.toLowerCase()) ||
          q.a.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter((category) => category.questions.length > 0);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-void py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary mb-4">
              Frequently Asked Questions
            </h1>
            <p className="text-text-secondary mb-8">
              Find answers to common questions about Podex.
            </p>

            {/* Search */}
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions..."
                className="w-full pl-12 pr-4 py-3 rounded-xl bg-surface border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
            </div>
          </div>

          {/* FAQ Categories */}
          {filteredFaqs.length > 0 ? (
            <div className="space-y-8">
              {filteredFaqs.map((category) => (
                <section key={category.category}>
                  <h2 className="text-lg font-bold text-text-primary mb-4">{category.category}</h2>
                  <div className="rounded-xl bg-surface border border-border-default p-6">
                    {category.questions.map((faq) => (
                      <FaqItem key={faq.q} question={faq.q} answer={faq.a} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-text-muted mb-4">No questions found matching your search.</p>
              <button onClick={() => setSearch('')} className="text-accent-primary hover:underline">
                Clear search
              </button>
            </div>
          )}

          {/* Still Have Questions */}
          <div className="mt-12 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
            <MessageSquare className="h-8 w-8 text-accent-primary mx-auto mb-4" />
            <h3 className="text-xl font-bold text-text-primary mb-2">Still Have Questions?</h3>
            <p className="text-text-secondary mb-4">
              Can&apos;t find what you&apos;re looking for? We&apos;re here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
