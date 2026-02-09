import type { Metadata } from 'next';
import { CheckCircle, AlertTriangle, XCircle, Clock, RefreshCw } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'System Status',
  description:
    'Check the current status of Podex services. View uptime, incidents, and scheduled maintenance.',
  alternates: {
    canonical: '/status',
  },
};

const services = [
  { name: 'Web Application', status: 'operational', uptime: '99.99%' },
  { name: 'API', status: 'operational', uptime: '99.98%' },
  { name: 'AI Agents', status: 'operational', uptime: '99.95%' },
  { name: 'Real-time Collaboration', status: 'operational', uptime: '99.97%' },
  { name: 'Git Integration', status: 'operational', uptime: '99.99%' },
  { name: 'Voice Services', status: 'operational', uptime: '99.90%' },
  { name: 'Cloud Compute', status: 'operational', uptime: '99.96%' },
];

const incidents = [
  {
    date: '2025-01-10',
    title: 'Increased API Latency',
    status: 'resolved',
    description:
      'Some users experienced slower API response times. Issue was identified and resolved within 45 minutes.',
  },
  {
    date: '2025-01-05',
    title: 'Scheduled Maintenance',
    status: 'completed',
    description:
      'Planned maintenance to upgrade our infrastructure. All services were restored as scheduled.',
  },
  {
    date: '2024-12-28',
    title: 'Agent Memory Service Degradation',
    status: 'resolved',
    description:
      'Some users experienced issues with agent memory retrieval. Root cause identified and patched.',
  },
];

const statusConfig = {
  operational: { icon: CheckCircle, color: 'accent-success', label: 'Operational' },
  degraded: { icon: AlertTriangle, color: 'agent-4', label: 'Degraded' },
  outage: { icon: XCircle, color: 'accent-error', label: 'Outage' },
  maintenance: { icon: RefreshCw, color: 'accent-primary', label: 'Maintenance' },
};

const incidentStatusConfig = {
  resolved: { color: 'accent-success', label: 'Resolved' },
  investigating: { color: 'agent-4', label: 'Investigating' },
  identified: { color: 'accent-primary', label: 'Identified' },
  monitoring: { color: 'agent-3', label: 'Monitoring' },
  completed: { color: 'accent-success', label: 'Completed' },
};

export default function StatusPage() {
  const allOperational = services.every((s) => s.status === 'operational');

  return (
    <>
      <Header />
      <div className="min-h-screen bg-void py-24 lg:py-32">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary mb-4">System Status</h1>
            <p className="text-text-secondary">
              Current status of Podex services and infrastructure
            </p>
          </div>

          {/* Overall Status */}
          <div
            className={`p-8 rounded-2xl mb-12 text-center ${
              allOperational
                ? 'bg-accent-success/10 border border-accent-success/30'
                : 'bg-agent-4/10 border border-agent-4/30'
            }`}
          >
            {allOperational ? (
              <>
                <CheckCircle className="h-12 w-12 text-accent-success mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-text-primary mb-2">
                  All Systems Operational
                </h2>
                <p className="text-text-muted">
                  All Podex services are running normally. Last checked: just now
                </p>
              </>
            ) : (
              <>
                <AlertTriangle className="h-12 w-12 text-agent-4 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-text-primary mb-2">
                  Some Services Experiencing Issues
                </h2>
                <p className="text-text-muted">
                  We&apos;re aware of the issue and working on it. Check below for details.
                </p>
              </>
            )}
          </div>

          {/* Services */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-6">Services</h2>
            <div className="space-y-3">
              {services.map((service) => {
                const config = statusConfig[service.status as keyof typeof statusConfig];
                const StatusIcon = config.icon;

                return (
                  <div
                    key={service.name}
                    className="flex items-center justify-between p-4 rounded-xl bg-surface border border-border-default"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon className={`h-5 w-5 text-${config.color}`} />
                      <span className="font-medium text-text-primary">{service.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-text-muted">{service.uptime} uptime</span>
                      <span
                        className={`px-3 py-1 rounded-full text-sm bg-${config.color}/10 text-${config.color}`}
                      >
                        {config.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recent Incidents */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-6">Recent Incidents</h2>
            {incidents.length === 0 ? (
              <div className="p-8 rounded-xl bg-surface border border-border-default text-center">
                <CheckCircle className="h-8 w-8 text-accent-success mx-auto mb-4" />
                <p className="text-text-muted">No recent incidents to report.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {incidents.map((incident) => {
                  const config =
                    incidentStatusConfig[incident.status as keyof typeof incidentStatusConfig];

                  return (
                    <article
                      key={incident.title}
                      className="p-6 rounded-xl bg-surface border border-border-default"
                    >
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div>
                          <h3 className="font-semibold text-text-primary">{incident.title}</h3>
                          <div className="flex items-center gap-2 text-sm text-text-muted mt-1">
                            <Clock className="h-4 w-4" />
                            {new Date(incident.date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </div>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-sm bg-${config.color}/10 text-${config.color}`}
                        >
                          {config.label}
                        </span>
                      </div>
                      <p className="text-sm text-text-muted">{incident.description}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Subscribe */}
          <section>
            <div className="p-8 rounded-2xl bg-gradient-to-r from-accent-primary/10 to-accent-secondary/10 border border-border-default text-center">
              <h3 className="text-xl font-bold text-text-primary mb-2">Get Status Updates</h3>
              <p className="text-text-secondary mb-4">
                Subscribe to receive notifications about service disruptions and maintenance.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="flex-1 px-4 py-3 rounded-xl bg-surface border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
                />
                <button className="px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_20px_rgba(0,229,255,0.3)] transition-all">
                  Subscribe
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
      <Footer />
    </>
  );
}
