import type { Metadata } from 'next';
import { Shield, Lock, Eye, Server, CheckCircle, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'Learn about Podex security practices, data protection, and compliance. Your code and data security is our top priority.',
  alternates: {
    canonical: '/security',
  },
};

const securityFeatures = [
  {
    icon: Lock,
    title: 'Encryption at Rest',
    description:
      'All data is encrypted at rest using AES-256 encryption. Your code and files are protected even when stored.',
  },
  {
    icon: Shield,
    title: 'Encryption in Transit',
    description:
      'All communications are encrypted using TLS 1.3. Your data is protected as it travels between your browser and our servers.',
  },
  {
    icon: Eye,
    title: 'Access Controls',
    description:
      'Role-based access controls ensure only authorized users can access your projects. We follow the principle of least privilege.',
  },
  {
    icon: Server,
    title: 'Infrastructure Security',
    description:
      'Our infrastructure is hosted on SOC 2 compliant cloud providers with 24/7 monitoring and automated security patching.',
  },
];

const practices = [
  'Regular security audits and penetration testing',
  'Automated vulnerability scanning in CI/CD',
  'Security awareness training for all employees',
  'Incident response plan with defined procedures',
  'Bug bounty program for responsible disclosure',
  'Regular backup and disaster recovery testing',
];

const compliance = [
  { name: 'SOC 2 Type II', status: 'In Progress', description: 'Expected Q2 2025' },
  { name: 'GDPR', status: 'Compliant', description: 'EU data protection' },
  { name: 'CCPA', status: 'Compliant', description: 'California privacy law' },
  { name: 'HIPAA', status: 'Roadmap', description: 'Healthcare compliance' },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-4xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="p-4 rounded-2xl bg-accent-success/10 w-fit mx-auto mb-6">
            <Shield className="h-12 w-12 text-accent-success" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">
            Security at Podex
          </h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Your code is your intellectual property. We take security seriously to ensure your data
            stays safe and private.
          </p>
        </div>

        {/* Security Features */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-8">Security Features</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {securityFeatures.map((feature) => (
              <div
                key={feature.title}
                className="p-6 rounded-xl bg-surface border border-border-default"
              >
                <feature.icon className="h-8 w-8 text-accent-primary mb-4" />
                <h3 className="text-lg font-bold text-text-primary mb-2">{feature.title}</h3>
                <p className="text-sm text-text-muted">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Security Practices */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-8">Security Practices</h2>
          <div className="p-6 rounded-xl bg-surface border border-border-default">
            <ul className="space-y-4">
              {practices.map((practice) => (
                <li key={practice} className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-accent-success shrink-0 mt-0.5" />
                  <span className="text-text-secondary">{practice}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Compliance */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-8">Compliance</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {compliance.map((item) => (
              <div
                key={item.name}
                className="p-4 rounded-xl bg-surface border border-border-default flex items-center justify-between"
              >
                <div>
                  <h3 className="font-semibold text-text-primary">{item.name}</h3>
                  <p className="text-sm text-text-muted">{item.description}</p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm ${
                    item.status === 'Compliant'
                      ? 'bg-accent-success/10 text-accent-success'
                      : item.status === 'In Progress'
                        ? 'bg-accent-primary/10 text-accent-primary'
                        : 'bg-elevated text-text-muted'
                  }`}
                >
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Data Handling */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-text-primary mb-8">Data Handling</h2>
          <div className="p-6 rounded-xl bg-surface border border-border-default space-y-6">
            <div>
              <h3 className="font-semibold text-text-primary mb-2">Code Privacy</h3>
              <p className="text-text-muted text-sm">
                Your code is never used to train AI models. We process your code only to provide the
                requested services and features.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-text-primary mb-2">Data Retention</h3>
              <p className="text-text-muted text-sm">
                We retain your data only as long as your account is active. Upon deletion, your data
                is removed from our systems within 30 days.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-text-primary mb-2">Third-Party Access</h3>
              <p className="text-text-muted text-sm">
                We do not sell your data to third parties. Access is limited to service providers
                who help operate our platform, bound by strict confidentiality agreements.
              </p>
            </div>
          </div>
        </section>

        {/* Report Vulnerability */}
        <section>
          <div className="p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
            <Mail className="h-8 w-8 text-accent-primary mx-auto mb-4" />
            <h3 className="text-xl font-bold text-text-primary mb-2">Report a Vulnerability</h3>
            <p className="text-text-secondary mb-4">
              Found a security issue? We appreciate responsible disclosure. Please report it
              privately.
            </p>
            <a
              href="mailto:security@podex.dev"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
            >
              <Mail className="h-4 w-4" />
              security@podex.dev
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
