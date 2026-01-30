import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Glossary - AI Development Terms',
  description:
    'Definitions of key terms used in Podex and AI-powered development. Learn about agents, memory, orchestration, and more.',
  alternates: {
    canonical: '/glossary',
  },
};

const glossaryTerms = [
  {
    term: 'Agent',
    definition:
      'An AI-powered assistant specialized for a specific task. In Podex, agents include the Orchestrator, Architect, Coder, Reviewer, and Tester, each with distinct capabilities and responsibilities.',
    related: ['Multi-Agent System', 'Orchestrator', 'Agent Memory'],
  },
  {
    term: 'Agent Memory',
    definition:
      'A persistent storage system that allows AI agents to remember context, preferences, and project details across sessions. Agent memory enables personalized assistance that improves over time based on your coding style and feedback.',
    related: ['Context Window', 'Agent'],
  },
  {
    term: 'Agentic IDE',
    definition:
      'An integrated development environment where AI agents actively participate in the development process, not just responding to queries but proactively planning, coding, reviewing, and testing. Podex is an example of an agentic IDE.',
    related: ['Agent', 'Cloud IDE'],
  },
  {
    term: 'Architect Agent',
    definition:
      'A specialized AI agent in Podex responsible for system design and planning. The Architect analyzes requirements, creates execution plans, identifies dependencies, and breaks down complex tasks into manageable steps.',
    related: ['Agent', 'Planning Mode'],
  },
  {
    term: 'Cloud IDE',
    definition:
      'A web-based integrated development environment that runs entirely in the browser. Cloud IDEs like Podex provide full development capabilities without local installation, enabling coding from any device with internet access.',
    related: ['Agentic IDE', 'Local Pod'],
  },
  {
    term: 'Coder Agent',
    definition:
      "A specialized AI agent in Podex focused on writing production-ready code. The Coder follows best practices, implements features based on the Architect's plan, and generates clean, maintainable code with proper documentation.",
    related: ['Agent', 'Code Generation'],
  },
  {
    term: 'Code Generation',
    definition:
      'The process of automatically creating source code using AI models. In Podex, code generation is context-aware, considering project structure, coding standards, and agent memory to produce relevant, high-quality code.',
    related: ['Coder Agent', 'LLM'],
  },
  {
    term: 'Context Window',
    definition:
      'The amount of text (measured in tokens) that an AI model can process at once. Larger context windows allow agents to understand more of your codebase simultaneously. Podex optimizes context usage through agent memory and smart retrieval.',
    related: ['Agent Memory', 'Token'],
  },
  {
    term: 'LLM (Large Language Model)',
    definition:
      'An AI model trained on vast amounts of text data, capable of understanding and generating human-like text including code. Podex uses multiple LLMs optimized for different tasks like planning, coding, and review.',
    related: ['Agent', 'Code Generation'],
  },
  {
    term: 'Local Pod',
    definition:
      'A secure connection between Podex cloud IDE and your local development machine. Local Pods allow agents to access local files, run commands on your machine, and integrate with local development tools and environments.',
    related: ['Cloud IDE', 'Pod'],
  },
  {
    term: 'MCP (Model Context Protocol)',
    definition:
      'A standard protocol for connecting AI models with external tools and data sources. Podex supports MCP integrations, allowing agents to interact with databases, APIs, and other services.',
    related: ['Agent', 'Integration'],
  },
  {
    term: 'Multi-Agent System',
    definition:
      'An architecture where multiple specialized AI agents collaborate to complete complex tasks. Unlike single-agent systems, multi-agent systems can parallelize work, with each agent focusing on its area of expertise.',
    related: ['Agent', 'Orchestrator'],
  },
  {
    term: 'Orchestrator',
    definition:
      "The coordinating agent in Podex's multi-agent system. The Orchestrator manages task delegation, monitors progress, handles dependencies between agents, and ensures smooth parallel execution of development tasks.",
    related: ['Multi-Agent System', 'Agent'],
  },
  {
    term: 'Planning Mode',
    definition:
      'A Podex feature where the Architect agent creates a detailed execution plan before any code is written. Planning mode breaks down requirements into tasks, identifies dependencies, and creates a roadmap for implementation.',
    related: ['Architect Agent', 'Agent'],
  },
  {
    term: 'Pod',
    definition:
      'A containerized development environment in Podex. Each pod includes compute resources, storage, and configured tools. The term also refers to the group of AI agents working together on your project (a "pod of agents").',
    related: ['Local Pod', 'Cloud IDE'],
  },
  {
    term: 'Reviewer Agent',
    definition:
      'A specialized AI agent in Podex that analyzes code quality, identifies potential bugs, checks for security vulnerabilities, and suggests improvements. The Reviewer ensures code meets quality standards before deployment.',
    related: ['Agent', 'Tester Agent'],
  },
  {
    term: 'Session',
    definition:
      'An active development workspace in Podex where you interact with AI agents. Sessions maintain state, history, and context. You can have multiple sessions for different projects or features.',
    related: ['Agent Memory', 'Pod'],
  },
  {
    term: 'Tester Agent',
    definition:
      'A specialized AI agent in Podex responsible for creating and running tests. The Tester generates unit tests, integration tests, and end-to-end tests, ensuring code reliability and catching issues early.',
    related: ['Agent', 'Reviewer Agent'],
  },
  {
    term: 'Token',
    definition:
      'The basic unit of text processing for AI models. Tokens can be words, parts of words, or characters. Podex usage is often measured in tokens, which determines how much AI processing your plan includes.',
    related: ['Context Window', 'LLM'],
  },
  {
    term: 'Vision Analysis',
    definition:
      'A Podex feature that uses AI to analyze images, screenshots, and design mockups. Vision analysis can convert visual designs into code, identify UI components, and provide feedback on user interfaces.',
    related: ['Agent', 'Code Generation'],
  },
  {
    term: 'Voice Commands',
    definition:
      'A hands-free input method in Podex that converts spoken instructions into actions. Voice commands allow you to dictate code, give instructions to agents, and control the IDE without typing.',
    related: ['Agentic IDE'],
  },
];

// Group terms alphabetically
const groupedTerms = glossaryTerms.reduce(
  (acc, term) => {
    const letter = term.term?.[0]?.toUpperCase();
    if (!letter) return acc;
    if (!acc[letter]) {
      acc[letter] = [];
    }
    acc[letter].push(term);
    return acc;
  },
  {} as Record<string, typeof glossaryTerms>
);

const alphabet = Object.keys(groupedTerms).sort();

export default function GlossaryPage() {
  return (
    <>
      <Header />
      <div
        className="min-h-screen bg-void py-24 lg:py-32"
        itemScope
        itemType="https://schema.org/DefinedTermSet"
      >
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="p-4 rounded-2xl bg-accent-primary/10 w-fit mx-auto mb-6">
              <BookOpen className="h-12 w-12 text-accent-primary" />
            </div>
            <h1 className="text-4xl font-bold text-text-primary mb-4" itemProp="name">
              Glossary
            </h1>
            <p className="text-xl text-text-secondary max-w-2xl mx-auto" itemProp="description">
              Definitions of key terms used in Podex and AI-powered development.
            </p>
          </div>

          {/* Alphabet Navigation */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {alphabet.map((letter) => (
              <a
                key={letter}
                href={`#letter-${letter}`}
                className="w-10 h-10 rounded-lg bg-surface border border-border-default flex items-center justify-center text-text-primary hover:bg-accent-primary hover:text-text-inverse hover:border-accent-primary transition-all font-medium"
              >
                {letter}
              </a>
            ))}
          </div>

          {/* Terms */}
          <div className="space-y-12">
            {alphabet.map((letter) => (
              <section key={letter} id={`letter-${letter}`}>
                <h2 className="text-3xl font-bold text-accent-primary mb-6 sticky top-4 bg-void py-2">
                  {letter}
                </h2>
                <div className="space-y-6">
                  {groupedTerms[letter]?.map((item) => (
                    <article
                      key={item.term}
                      className="p-6 rounded-xl bg-surface border border-border-default"
                      itemScope
                      itemProp="hasDefinedTerm"
                      itemType="https://schema.org/DefinedTerm"
                    >
                      <h3
                        className="text-xl font-bold text-text-primary mb-3"
                        id={item.term.toLowerCase().replace(/\s+/g, '-')}
                        itemProp="name"
                      >
                        {item.term}
                      </h3>
                      <p
                        className="text-text-secondary leading-relaxed mb-4"
                        itemProp="description"
                      >
                        {item.definition}
                      </p>
                      {item.related.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-sm text-text-muted">Related:</span>
                          {item.related.map((rel) => (
                            <a
                              key={rel}
                              href={`#${rel.toLowerCase().replace(/\s+/g, '-')}`}
                              className="text-sm px-2 py-1 rounded bg-elevated text-accent-primary hover:bg-accent-primary/10 transition-colors"
                            >
                              {rel}
                            </a>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
            <h3 className="text-xl font-bold text-text-primary mb-2">Ready to Get Started?</h3>
            <p className="text-text-secondary mb-4">
              Now that you know the terminology, try Podex for free.
            </p>
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              Start Building Free
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
