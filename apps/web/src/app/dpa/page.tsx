import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Download, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Data Processing Agreement',
  description:
    'Podex Data Processing Agreement (DPA) for GDPR and data protection compliance. Review our data processing terms.',
  alternates: {
    canonical: '/dpa',
  },
};

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-void py-24 lg:py-32">
      <div className="mx-auto max-w-3xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="p-4 rounded-2xl bg-accent-primary/10 w-fit mx-auto mb-6">
            <FileText className="h-12 w-12 text-accent-primary" />
          </div>
          <h1 className="text-4xl font-bold text-text-primary mb-4">Data Processing Agreement</h1>
          <p className="text-text-secondary">
            This Data Processing Agreement (&quot;DPA&quot;) forms part of our Terms of Service
          </p>
          <p className="text-text-muted mt-2">Last updated: January 1, 2025</p>
        </div>

        {/* Download CTA */}
        <div className="p-6 rounded-xl bg-surface border border-border-default mb-12 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-text-primary">Need a signed copy?</h3>
            <p className="text-sm text-text-muted">
              Download our pre-signed DPA or request a custom agreement.
            </p>
          </div>
          <div className="flex gap-3">
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_20px_rgba(0,229,255,0.3)] transition-all">
              <Download className="h-4 w-4" />
              Download PDF
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="prose prose-invert max-w-none">
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">1. Definitions</h2>
            <p className="text-text-secondary mb-4">
              For the purposes of this DPA, the following definitions apply:
            </p>
            <ul className="list-disc pl-6 text-text-secondary space-y-2">
              <li>
                <strong>&quot;Controller&quot;</strong> means the entity that determines the
                purposes and means of processing Personal Data.
              </li>
              <li>
                <strong>&quot;Processor&quot;</strong> means the entity that processes Personal Data
                on behalf of the Controller.
              </li>
              <li>
                <strong>&quot;Personal Data&quot;</strong> means any information relating to an
                identified or identifiable natural person.
              </li>
              <li>
                <strong>&quot;Data Subject&quot;</strong> means an identified or identifiable
                natural person whose Personal Data is processed.
              </li>
              <li>
                <strong>&quot;Sub-processor&quot;</strong> means any Processor engaged by Podex to
                process Personal Data.
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">2. Scope and Roles</h2>
            <p className="text-text-secondary">
              This DPA applies to all processing of Personal Data by Podex on behalf of Customer in
              connection with the Services. Customer acts as the Controller and Podex acts as the
              Processor with respect to Personal Data.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              3. Data Processing Details
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">Subject Matter</h3>
                <p className="text-text-secondary">
                  Provision of the Podex development platform and related services.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">Duration</h3>
                <p className="text-text-secondary">
                  For the term of the Agreement plus any retention period required by law.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">
                  Categories of Data Subjects
                </h3>
                <p className="text-text-secondary">
                  Customer&apos;s employees, contractors, and end users.
                </p>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-text-primary mb-2">Types of Data</h3>
                <p className="text-text-secondary">
                  Names, email addresses, account credentials, usage data, and any Personal Data
                  contained in content uploaded to the Services.
                </p>
              </div>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">4. Processor Obligations</h2>
            <p className="text-text-secondary mb-4">Podex shall:</p>
            <ul className="list-disc pl-6 text-text-secondary space-y-2">
              <li>Process Personal Data only on documented instructions from Customer</li>
              <li>Ensure persons authorized to process are bound by confidentiality</li>
              <li>Implement appropriate technical and organizational measures</li>
              <li>Assist Customer in responding to Data Subject requests</li>
              <li>Assist Customer with data protection impact assessments</li>
              <li>Delete or return all Personal Data upon termination</li>
              <li>Make available information to demonstrate compliance</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">5. Sub-processors</h2>
            <p className="text-text-secondary mb-4">
              Customer authorizes Podex to engage Sub-processors to process Personal Data. Podex
              shall:
            </p>
            <ul className="list-disc pl-6 text-text-secondary space-y-2">
              <li>Enter into written agreements with Sub-processors</li>
              <li>Remain liable for Sub-processor compliance</li>
              <li>Notify Customer of changes to Sub-processors</li>
              <li>Provide Customer opportunity to object to new Sub-processors</li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">6. Security Measures</h2>
            <p className="text-text-secondary">
              Podex implements and maintains appropriate technical and organizational measures to
              protect Personal Data, including encryption, access controls, and regular security
              testing. Details are available in our{' '}
              <Link href="/security" className="text-accent-primary hover:underline">
                Security Policy
              </Link>
              .
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-text-primary mb-4">
              7. International Transfers
            </h2>
            <p className="text-text-secondary">
              When Personal Data is transferred outside the EEA, Podex ensures appropriate
              safeguards are in place, including Standard Contractual Clauses approved by the
              European Commission.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-text-primary mb-4">8. Contact</h2>
            <p className="text-text-secondary">
              For questions about this DPA or to request a custom agreement, contact us at{' '}
              <a href="mailto:legal@podex.dev" className="text-accent-primary hover:underline">
                legal@podex.dev
              </a>
            </p>
          </section>
        </div>

        {/* Contact CTA */}
        <div className="mt-12 p-8 rounded-2xl bg-surface border border-border-default text-center">
          <Mail className="h-8 w-8 text-accent-primary mx-auto mb-4" />
          <h3 className="text-xl font-bold text-text-primary mb-2">Need Enterprise Terms?</h3>
          <p className="text-text-secondary mb-4">
            We can customize our DPA to meet your organization&apos;s specific requirements.
          </p>
          <a
            href="mailto:legal@podex.dev"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent-primary text-text-inverse font-medium hover:shadow-[0_0_30px_rgba(0,229,255,0.4)] transition-all"
          >
            Contact Legal Team
          </a>
        </div>
      </div>
    </div>
  );
}
