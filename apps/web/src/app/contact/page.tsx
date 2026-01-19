import type { Metadata } from 'next';
import { Mail, MessageSquare, MapPin, Clock, Github, Twitter, Linkedin } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Get in touch with the Podex team. We are here to help with questions, feedback, partnerships, and support.',
  alternates: {
    canonical: '/contact',
  },
};

const contactMethods = [
  {
    icon: Mail,
    title: 'Email',
    description: 'For general inquiries and support',
    value: 'hello@podex.dev',
    href: 'mailto:hello@podex.dev',
  },
  {
    icon: MessageSquare,
    title: 'Discord',
    description: 'Join our community for real-time help',
    value: 'Join Discord',
    href: 'https://discord.gg/podex',
  },
  {
    icon: Twitter,
    title: 'Twitter',
    description: 'Follow us for updates and tips',
    value: '@podexdev',
    href: 'https://twitter.com/podexdev',
  },
];

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-text-primary mb-4">Get in Touch</h1>
          <p className="text-xl text-text-secondary max-w-2xl mx-auto">
            Have a question, feedback, or just want to say hi? We&apos;d love to hear from you.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-12">
          {/* Contact Form */}
          <div className="p-8 rounded-2xl bg-surface border border-border-default">
            <h2 className="text-2xl font-bold text-text-primary mb-6">Send us a message</h2>
            <form className="space-y-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="firstName"
                    className="block text-sm font-medium text-text-secondary mb-2"
                  >
                    First name
                  </label>
                  <input
                    type="text"
                    id="firstName"
                    name="firstName"
                    className="w-full px-4 py-3 rounded-xl bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label
                    htmlFor="lastName"
                    className="block text-sm font-medium text-text-secondary mb-2"
                  >
                    Last name
                  </label>
                  <input
                    type="text"
                    id="lastName"
                    name="lastName"
                    className="w-full px-4 py-3 rounded-xl bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-text-secondary mb-2"
                >
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  className="w-full px-4 py-3 rounded-xl bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label
                  htmlFor="subject"
                  className="block text-sm font-medium text-text-secondary mb-2"
                >
                  Subject
                </label>
                <select
                  id="subject"
                  name="subject"
                  className="w-full px-4 py-3 rounded-xl bg-elevated border border-border-default text-text-primary focus:border-accent-primary focus:outline-none transition-colors"
                >
                  <option value="">Select a topic</option>
                  <option value="general">General Inquiry</option>
                  <option value="support">Technical Support</option>
                  <option value="sales">Sales & Pricing</option>
                  <option value="partnership">Partnership</option>
                  <option value="feedback">Feedback</option>
                  <option value="press">Press Inquiry</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="message"
                  className="block text-sm font-medium text-text-secondary mb-2"
                >
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  className="w-full px-4 py-3 rounded-xl bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none transition-colors resize-none"
                  placeholder="How can we help?"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3 px-6 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
              >
                Send Message
              </button>
            </form>
          </div>

          {/* Contact Info */}
          <div className="space-y-8">
            {/* Contact Methods */}
            <div className="space-y-4">
              {contactMethods.map((method) => (
                <a
                  key={method.title}
                  href={method.href}
                  target={method.href.startsWith('http') ? '_blank' : undefined}
                  rel={method.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="flex items-start gap-4 p-4 rounded-xl bg-surface border border-border-default hover:border-border-strong transition-all"
                >
                  <div className="p-2 rounded-lg bg-accent-primary/10">
                    <method.icon className="h-5 w-5 text-accent-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-text-primary">{method.title}</h3>
                    <p className="text-sm text-text-muted mb-1">{method.description}</p>
                    <span className="text-sm text-accent-primary">{method.value}</span>
                  </div>
                </a>
              ))}
            </div>

            {/* Office Info */}
            <div className="p-6 rounded-xl bg-surface border border-border-default">
              <h3 className="font-semibold text-text-primary mb-4">Company Info</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-text-muted shrink-0" />
                  <span className="text-text-secondary">
                    Remote-first company
                    <br />
                    San Francisco, CA (HQ)
                  </span>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-text-muted shrink-0" />
                  <span className="text-text-secondary">
                    Support available
                    <br />
                    Mon-Fri, 9am-6pm PST
                  </span>
                </div>
              </div>
            </div>

            {/* Social Links */}
            <div className="p-6 rounded-xl bg-surface border border-border-default">
              <h3 className="font-semibold text-text-primary mb-4">Follow Us</h3>
              <div className="flex gap-3">
                <a
                  href="https://github.com/podex"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3 rounded-lg bg-elevated hover:bg-overlay transition-colors"
                >
                  <Github className="h-5 w-5 text-text-muted" />
                </a>
                <a
                  href="https://twitter.com/podexdev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3 rounded-lg bg-elevated hover:bg-overlay transition-colors"
                >
                  <Twitter className="h-5 w-5 text-text-muted" />
                </a>
                <a
                  href="https://linkedin.com/company/podex"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-3 rounded-lg bg-elevated hover:bg-overlay transition-colors"
                >
                  <Linkedin className="h-5 w-5 text-text-muted" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
