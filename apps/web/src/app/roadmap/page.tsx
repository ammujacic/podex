import type { Metadata } from 'next';
import { Check, Clock, Sparkles, Rocket } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Roadmap',
  description:
    'See what we are building next at Podex. Our public roadmap shows planned features, improvements, and what is coming soon.',
  alternates: {
    canonical: '/roadmap',
  },
};

const roadmapItems = [
  {
    quarter: 'Q1 2025',
    status: 'in-progress',
    items: [
      {
        name: 'Advanced Agent Memory',
        status: 'completed',
        description: 'Long-term memory across sessions',
      },
      {
        name: 'Multi-Agent Orchestration',
        status: 'completed',
        description: 'Coordinate multiple agents on complex tasks',
      },
      {
        name: 'Vision Analysis',
        status: 'completed',
        description: 'Screenshot-to-code and design analysis',
      },
      {
        name: 'Voice Commands',
        status: 'in-progress',
        description: 'Natural language voice interface',
      },
      {
        name: 'Local Pod Connections',
        status: 'in-progress',
        description: 'Connect to your local machine',
      },
    ],
  },
  {
    quarter: 'Q2 2025',
    status: 'planned',
    items: [
      {
        name: 'Custom Agent Builder',
        status: 'planned',
        description: 'Create and share custom agents',
      },
      {
        name: 'Plugin Marketplace',
        status: 'planned',
        description: 'Extend Podex with community plugins',
      },
      {
        name: 'Advanced Git Workflows',
        status: 'planned',
        description: 'PR reviews, merge conflict resolution',
      },
      { name: 'Mobile App', status: 'planned', description: 'Native iOS and Android apps' },
    ],
  },
  {
    quarter: 'Q3 2025',
    status: 'planned',
    items: [
      {
        name: 'Enterprise SSO/SAML',
        status: 'planned',
        description: 'Single sign-on for organizations',
      },
      {
        name: 'Self-Hosted Option',
        status: 'planned',
        description: 'Run Podex on your infrastructure',
      },
      { name: 'Advanced Analytics', status: 'planned', description: 'Team productivity insights' },
      { name: 'Audit Logs', status: 'planned', description: 'Compliance and security logging' },
    ],
  },
  {
    quarter: 'Q4 2025',
    status: 'planned',
    items: [
      {
        name: 'AI Code Review',
        status: 'planned',
        description: 'Automated PR reviews with explanations',
      },
      {
        name: 'Deployment Automation',
        status: 'planned',
        description: 'One-click deployments to cloud providers',
      },
      {
        name: 'Database Integration',
        status: 'planned',
        description: 'Query and modify databases with AI',
      },
      {
        name: 'API Generation',
        status: 'planned',
        description: 'Generate APIs from specifications',
      },
    ],
  },
];

const statusIcons = {
  completed: Check,
  'in-progress': Clock,
  planned: Sparkles,
};

const statusColors = {
  completed: 'accent-success',
  'in-progress': 'accent-primary',
  planned: 'text-muted',
};

export default function RoadmapPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-5xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent-primary/30 bg-accent-primary/10 px-4 py-1.5 text-sm text-accent-primary mb-6">
            <Rocket className="h-4 w-4" />
            Public Roadmap
          </span>
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">
            What We&apos;re Building
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Our commitment to transparency. See what&apos;s coming next and help shape the future of
            Podex.
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap justify-center gap-6 mb-12">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-accent-success" />
            <span className="text-text-secondary">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-accent-primary" />
            <span className="text-text-secondary">In Progress</span>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-text-muted" />
            <span className="text-text-secondary">Planned</span>
          </div>
        </div>

        {/* Roadmap */}
        <div className="space-y-12">
          {roadmapItems.map((quarter) => (
            <section key={quarter.quarter} className="relative">
              <div className="sticky top-4 z-10 mb-6">
                <h2 className="inline-block px-4 py-2 rounded-full bg-surface border border-border-default text-text-primary font-bold">
                  {quarter.quarter}
                </h2>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {quarter.items.map((item) => {
                  const StatusIcon = statusIcons[item.status as keyof typeof statusIcons];
                  const color = statusColors[item.status as keyof typeof statusColors];

                  return (
                    <div
                      key={item.name}
                      className="p-6 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <StatusIcon className={`h-5 w-5 mt-0.5 text-${color} shrink-0`} />
                        <div>
                          <h3 className="font-semibold text-text-primary mb-1">{item.name}</h3>
                          <p className="text-sm text-text-muted">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        {/* Feedback CTA */}
        <div className="mt-16 p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
          <h3 className="text-xl font-bold text-text-primary mb-2">Have a Feature Request?</h3>
          <p className="text-text-secondary mb-4">
            We&apos;d love to hear what you want to see in Podex.
          </p>
          <a
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
          >
            Submit Feedback
          </a>
        </div>
      </div>
    </div>
  );
}
