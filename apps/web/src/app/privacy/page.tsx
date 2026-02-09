import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/landing/Footer';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'Podex Privacy Policy. Learn how we collect, use, and protect your personal information.',
  alternates: {
    canonical: '/privacy',
  },
};

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <div className="min-h-screen bg-void py-24 lg:py-32">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <h1 className="text-4xl font-bold text-text-primary mb-4">Privacy Policy</h1>
          <p className="text-text-muted mb-12">Last updated: January 1, 2025</p>

          <div className="prose prose-invert max-w-none">
            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">1. Introduction</h2>
              <p className="text-text-secondary mb-4">
                Podex (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to
                protecting your privacy. This Privacy Policy explains how we collect, use, disclose,
                and safeguard your information when you use our web-based development platform.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                2. Information We Collect
              </h2>
              <h3 className="text-xl font-semibold text-text-primary mb-3">
                2.1 Information You Provide
              </h3>
              <ul className="list-disc pl-6 text-text-secondary mb-4 space-y-2">
                <li>Account information (name, email, password)</li>
                <li>Profile information (avatar, preferences)</li>
                <li>Payment information (processed by our payment provider)</li>
                <li>Code and project data you create or upload</li>
                <li>Communications with our support team</li>
              </ul>

              <h3 className="text-xl font-semibold text-text-primary mb-3">
                2.2 Information Collected Automatically
              </h3>
              <ul className="list-disc pl-6 text-text-secondary mb-4 space-y-2">
                <li>Device and browser information</li>
                <li>IP address and location data</li>
                <li>Usage data and analytics</li>
                <li>Cookies and similar technologies</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                3. How We Use Your Information
              </h2>
              <ul className="list-disc pl-6 text-text-secondary space-y-2">
                <li>Provide and improve our services</li>
                <li>Process transactions and send related information</li>
                <li>Send administrative information and updates</li>
                <li>Respond to inquiries and offer support</li>
                <li>Monitor and analyze usage patterns</li>
                <li>Protect against fraudulent or illegal activity</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">4. Data Sharing</h2>
              <p className="text-text-secondary mb-4">We may share your information with:</p>
              <ul className="list-disc pl-6 text-text-secondary space-y-2">
                <li>Service providers who assist in our operations</li>
                <li>Business partners with your consent</li>
                <li>Legal authorities when required by law</li>
                <li>Other parties in connection with a merger or acquisition</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">5. Data Security</h2>
              <p className="text-text-secondary">
                We implement appropriate technical and organizational measures to protect your
                personal information against unauthorized access, alteration, disclosure, or
                destruction. However, no method of transmission over the Internet is 100% secure.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">6. Your Rights</h2>
              <p className="text-text-secondary mb-4">
                Depending on your location, you may have the right to:
              </p>
              <ul className="list-disc pl-6 text-text-secondary space-y-2">
                <li>Access your personal data</li>
                <li>Correct inaccurate data</li>
                <li>Delete your data</li>
                <li>Object to or restrict processing</li>
                <li>Data portability</li>
                <li>Withdraw consent</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">7. Cookies</h2>
              <p className="text-text-secondary">
                We use cookies and similar tracking technologies to collect information and improve
                our services. You can control cookies through your browser settings.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                8. Children&apos;s Privacy
              </h2>
              <p className="text-text-secondary">
                Our services are not directed to individuals under 16. We do not knowingly collect
                personal information from children. If we become aware of such collection, we will
                take steps to delete the information.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-text-primary mb-4">
                9. Changes to This Policy
              </h2>
              <p className="text-text-secondary">
                We may update this Privacy Policy from time to time. We will notify you of any
                changes by posting the new policy on this page and updating the &quot;Last
                updated&quot; date.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-bold text-text-primary mb-4">10. Contact Us</h2>
              <p className="text-text-secondary">
                If you have questions about this Privacy Policy, please contact us at{' '}
                <a href="mailto:privacy@podex.dev" className="text-accent-primary hover:underline">
                  privacy@podex.dev
                </a>
              </p>
            </section>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
