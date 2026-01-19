'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

const faqs = [
  {
    question: 'What is Podex and how is it different from GitHub Copilot?',
    answer:
      'Podex is a multi-agent AI development platform, while GitHub Copilot is a single-agent code completion tool. Podex uses multiple specialized agents (Orchestrator, Architect, Coder, Reviewer, Tester) that work together with persistent memory and planning capabilities. Copilot provides inline suggestions; Podex manages entire development workflows from planning to deployment.',
  },
  {
    question: 'Is Podex free to use?',
    answer:
      'Yes, Podex offers a free tier with limited tokens and compute for public projects. No credit card is required. Paid plans start at $29/month (Pro) with additional features like private projects, agent memory, planning mode, and priority support. Annual billing provides a 17% discount.',
  },
  {
    question: 'What programming languages does Podex support?',
    answer:
      'Podex supports all major programming languages including JavaScript, TypeScript, Python, Go, Rust, Java, C++, Ruby, PHP, and more. The AI agents are trained on diverse codebases and can work with any language or framework you use.',
  },
  {
    question: 'Is my code private and secure on Podex?',
    answer:
      'Yes. Podex uses AES-256 encryption at rest and TLS 1.3 encryption in transit. Your code is never used to train AI models. The platform runs on SOC 2 compliant infrastructure with role-based access controls. Enterprise plans include additional security features like SSO, audit logs, and self-hosting options.',
  },
  {
    question: 'Can I use Podex offline or on mobile devices?',
    answer:
      'Podex is a cloud-based platform that requires an internet connection. However, it works on any device with a modern browser, including tablets and smartphones. The mobile experience includes voice commands, touch-optimized UI, and the ability to review and approve agent work on the go.',
  },
  {
    question: 'How does agent memory work?',
    answer:
      'Agent memory allows Podex AI agents to remember your coding style, project context, and preferences across sessions. When you return to a project, agents recall previous decisions, code patterns, and your feedback. This creates increasingly personalized and accurate assistance over time.',
  },
];

function FaqItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [isOpen, setIsOpen] = useState(index === 0); // First one open by default

  return (
    <div
      className="border-b border-border-subtle last:border-b-0"
      itemScope
      itemProp="mainEntity"
      itemType="https://schema.org/Question"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-5 text-left group"
        aria-expanded={isOpen}
      >
        <span
          className="font-medium text-text-primary pr-4 group-hover:text-accent-primary transition-colors"
          itemProp="name"
        >
          {question}
        </span>
        <ChevronDown
          className={`h-5 w-5 text-text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96 pb-5' : 'max-h-0'}`}
        itemScope
        itemProp="acceptedAnswer"
        itemType="https://schema.org/Answer"
      >
        <p className="text-text-muted leading-relaxed" itemProp="text">
          {answer}
        </p>
      </div>
    </div>
  );
}

export function LandingFaqSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="faq"
      ref={ref}
      className="py-16 lg:py-24 bg-void"
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      <div className="mx-auto max-w-4xl px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl sm:text-4xl font-bold text-text-primary mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-text-secondary">
            Quick answers to help you understand Podex better.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="rounded-2xl bg-surface border border-border-default p-6 lg:p-8"
        >
          {faqs.map((faq, index) => (
            <FaqItem key={faq.question} question={faq.question} answer={faq.answer} index={index} />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center mt-8"
        >
          <p className="text-text-muted">
            Have more questions?{' '}
            <Link href="/faq" className="text-accent-primary hover:underline">
              View all FAQs
            </Link>{' '}
            or{' '}
            <Link href="/contact" className="text-accent-primary hover:underline">
              contact us
            </Link>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
