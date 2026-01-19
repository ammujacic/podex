import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, X, Minus, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Podex vs Alternatives - Compare AI Coding Tools',
  description:
    'Compare Podex with GitHub Copilot, Cursor, Replit, and other AI coding tools. See features, pricing, and capabilities side by side.',
  alternates: {
    canonical: '/compare',
  },
};

const tools = [
  { name: 'Podex', highlight: true },
  { name: 'GitHub Copilot' },
  { name: 'Cursor' },
  { name: 'Replit AI' },
  { name: 'Cody' },
];

const features = [
  {
    category: 'AI Capabilities',
    items: [
      {
        name: 'Multi-agent collaboration',
        description: 'Multiple specialized AI agents working together',
        podex: true,
        copilot: false,
        cursor: false,
        replit: false,
        cody: false,
      },
      {
        name: 'Agent memory (persistent context)',
        description: 'AI remembers your preferences across sessions',
        podex: true,
        copilot: false,
        cursor: 'partial',
        replit: false,
        cody: 'partial',
      },
      {
        name: 'Planning mode',
        description: 'AI creates execution plans before coding',
        podex: true,
        copilot: false,
        cursor: 'partial',
        replit: false,
        cody: false,
      },
      {
        name: 'Code completion',
        description: 'Inline code suggestions as you type',
        podex: true,
        copilot: true,
        cursor: true,
        replit: true,
        cody: true,
      },
      {
        name: 'Chat interface',
        description: 'Conversational AI for code questions',
        podex: true,
        copilot: true,
        cursor: true,
        replit: true,
        cody: true,
      },
      {
        name: 'Vision/image analysis',
        description: 'Convert screenshots/designs to code',
        podex: true,
        copilot: false,
        cursor: true,
        replit: false,
        cody: false,
      },
      {
        name: 'Voice commands',
        description: 'Control IDE with voice',
        podex: true,
        copilot: false,
        cursor: false,
        replit: false,
        cody: false,
      },
    ],
  },
  {
    category: 'Development Environment',
    items: [
      {
        name: 'Cloud-based IDE',
        description: 'Full IDE in the browser',
        podex: true,
        copilot: false,
        cursor: false,
        replit: true,
        cody: false,
      },
      {
        name: 'Local IDE support',
        description: 'Works with VS Code, JetBrains, etc.',
        podex: 'partial',
        copilot: true,
        cursor: true,
        replit: false,
        cody: true,
      },
      {
        name: 'Real-time collaboration',
        description: 'Multiple users editing together',
        podex: true,
        copilot: false,
        cursor: false,
        replit: true,
        cody: false,
      },
      {
        name: 'Built-in terminal',
        description: 'Run commands in browser',
        podex: true,
        copilot: false,
        cursor: true,
        replit: true,
        cody: false,
      },
      {
        name: 'Git integration',
        description: 'Version control built-in',
        podex: true,
        copilot: true,
        cursor: true,
        replit: true,
        cody: true,
      },
    ],
  },
  {
    category: 'Enterprise & Security',
    items: [
      {
        name: 'Code privacy (no training)',
        description: 'Your code not used for AI training',
        podex: true,
        copilot: 'partial',
        cursor: true,
        replit: 'partial',
        cody: true,
      },
      {
        name: 'SOC 2 compliance',
        description: 'Enterprise security certification',
        podex: 'partial',
        copilot: true,
        cursor: 'partial',
        replit: true,
        cody: true,
      },
      {
        name: 'SSO/SAML',
        description: 'Enterprise single sign-on',
        podex: true,
        copilot: true,
        cursor: true,
        replit: true,
        cody: true,
      },
      {
        name: 'Self-hosted option',
        description: 'Run on your own infrastructure',
        podex: true,
        copilot: false,
        cursor: false,
        replit: false,
        cody: true,
      },
      {
        name: 'Audit logs',
        description: 'Track all user activities',
        podex: true,
        copilot: true,
        cursor: 'partial',
        replit: true,
        cody: true,
      },
    ],
  },
];

const pricing = [
  { tool: 'Podex', free: 'Yes', pro: '$29/mo', team: '$79/mo', enterprise: 'Custom' },
  { tool: 'GitHub Copilot', free: 'Limited', pro: '$19/mo', team: '$39/mo', enterprise: 'Custom' },
  { tool: 'Cursor', free: 'Yes', pro: '$20/mo', team: '$40/mo', enterprise: 'Custom' },
  { tool: 'Replit AI', free: 'Limited', pro: '$25/mo', team: '-', enterprise: 'Custom' },
  { tool: 'Cody', free: 'Yes', pro: '$9/mo', team: '$19/mo', enterprise: 'Custom' },
];

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) {
    return <Check className="h-5 w-5 text-accent-success mx-auto" />;
  }
  if (value === false) {
    return <X className="h-5 w-5 text-text-muted mx-auto" />;
  }
  return (
    <span title="Partial support">
      <Minus className="h-5 w-5 text-agent-4 mx-auto" />
    </span>
  );
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">
            Podex vs Alternatives
          </h1>
          <p className="text-xl text-text-secondary max-w-3xl mx-auto">
            Compare Podex with other AI coding tools. See how multi-agent collaboration, persistent
            memory, and cloud IDE capabilities stack up against single-agent assistants.
          </p>
        </div>

        {/* Key Differentiators */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          <div className="p-6 rounded-xl bg-accent-primary/10 border border-accent-primary/30">
            <h3 className="font-bold text-text-primary mb-2">Multi-Agent System</h3>
            <p className="text-sm text-text-muted">
              Unlike single-agent tools, Podex deploys specialized agents (Architect, Coder,
              Reviewer, Tester) that collaborate on complex tasks.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-accent-secondary/10 border border-accent-secondary/30">
            <h3 className="font-bold text-text-primary mb-2">Persistent Memory</h3>
            <p className="text-sm text-text-muted">
              Agents remember your coding style and project context across sessions. Other tools
              start fresh each time.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-agent-3/10 border border-agent-3/30">
            <h3 className="font-bold text-text-primary mb-2">Cloud IDE + AI</h3>
            <p className="text-sm text-text-muted">
              Full development environment in the browser with integrated AI, not just a plugin for
              existing editors.
            </p>
          </div>
        </div>

        {/* Feature Comparison Table */}
        <div className="mb-16 overflow-x-auto">
          <h2 className="text-2xl font-bold text-text-primary mb-6">Feature Comparison</h2>
          {features.map((category) => (
            <div key={category.category} className="mb-8">
              <h3 className="text-lg font-semibold text-text-primary mb-4">{category.category}</h3>
              <div className="rounded-xl border border-border-default overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface">
                      <th className="text-left p-4 text-text-primary font-medium">Feature</th>
                      {tools.map((tool) => (
                        <th
                          key={tool.name}
                          className={`p-4 text-center font-medium ${tool.highlight ? 'text-accent-primary bg-accent-primary/5' : 'text-text-primary'}`}
                        >
                          {tool.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {category.items.map((item, index) => (
                      <tr
                        key={item.name}
                        className={index % 2 === 0 ? 'bg-elevated' : 'bg-surface'}
                      >
                        <td className="p-4">
                          <div className="font-medium text-text-primary">{item.name}</div>
                          <div className="text-sm text-text-muted">{item.description}</div>
                        </td>
                        <td className={`p-4 ${tools[0]?.highlight ? 'bg-accent-primary/5' : ''}`}>
                          <FeatureCell value={item.podex} />
                        </td>
                        <td className="p-4">
                          <FeatureCell value={item.copilot} />
                        </td>
                        <td className="p-4">
                          <FeatureCell value={item.cursor} />
                        </td>
                        <td className="p-4">
                          <FeatureCell value={item.replit} />
                        </td>
                        <td className="p-4">
                          <FeatureCell value={item.cody} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>

        {/* Pricing Comparison */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-6">Pricing Comparison</h2>
          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  <th className="text-left p-4 text-text-primary font-medium">Tool</th>
                  <th className="p-4 text-center text-text-primary font-medium">Free Tier</th>
                  <th className="p-4 text-center text-text-primary font-medium">Pro</th>
                  <th className="p-4 text-center text-text-primary font-medium">Team</th>
                  <th className="p-4 text-center text-text-primary font-medium">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {pricing.map((row, index) => (
                  <tr
                    key={row.tool}
                    className={`${index % 2 === 0 ? 'bg-elevated' : 'bg-surface'} ${row.tool === 'Podex' ? 'bg-accent-primary/5' : ''}`}
                  >
                    <td className="p-4 font-medium text-text-primary">{row.tool}</td>
                    <td className="p-4 text-center text-text-secondary">{row.free}</td>
                    <td className="p-4 text-center text-text-secondary">{row.pro}</td>
                    <td className="p-4 text-center text-text-secondary">{row.team}</td>
                    <td className="p-4 text-center text-text-secondary">{row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-text-muted mt-4">
            * Pricing as of January 2025. Check each provider&apos;s website for current pricing.
          </p>
        </div>

        {/* CTA */}
        <div className="text-center p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default">
          <h2 className="text-2xl font-bold text-text-primary mb-4">Ready to Try Podex?</h2>
          <p className="text-text-secondary mb-6">
            Experience multi-agent AI development with a free account. No credit card required.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
          >
            Start Free Trial
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
