'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listInvoices, getInvoice, type InvoiceResponse } from '@/lib/api';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const statusColors: Record<string, string> = {
  draft: 'bg-neutral-500/20 text-neutral-400',
  open: 'bg-amber-500/20 text-amber-400',
  paid: 'bg-emerald-500/20 text-emerald-400',
  void: 'bg-neutral-500/20 text-neutral-400',
  uncollectible: 'bg-red-500/20 text-red-400',
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceResponse[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    async function loadInvoices() {
      try {
        setLoading(true);
        const data = await listInvoices(1, 20);
        setInvoices(data);
        setHasMore(data.length === 20);
      } catch (err) {
        console.error('Failed to load invoices:', err);
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, []);

  const loadMore = async () => {
    try {
      const data = await listInvoices(page + 1, 20);
      setInvoices((prev) => [...prev, ...data]);
      setPage((prev) => prev + 1);
      setHasMore(data.length === 20);
    } catch (err) {
      console.error('Failed to load more invoices:', err);
    }
  };

  const handleViewInvoice = async (invoiceId: string) => {
    try {
      setDetailLoading(true);
      const data = await getInvoice(invoiceId);
      setSelectedInvoice(data);
    } catch (err) {
      console.error('Failed to load invoice:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-neutral-700 rounded w-1/4" />
          <div className="h-64 bg-neutral-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto">
      <div>
        <Link
          href="/settings/billing"
          className="text-sm text-neutral-400 hover:text-white mb-2 block"
        >
          &larr; Back to Billing
        </Link>
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <p className="text-neutral-400 mt-1">View and download your billing history</p>
      </div>

      {/* Invoice List */}
      <div className="bg-neutral-800/50 rounded-xl border border-neutral-700">
        {invoices.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-neutral-400 border-b border-neutral-700">
                    <th className="p-4 font-medium">Invoice</th>
                    <th className="p-4 font-medium">Date</th>
                    <th className="p-4 font-medium">Period</th>
                    <th className="p-4 font-medium">Amount</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-700">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="text-sm hover:bg-neutral-700/30">
                      <td className="p-4">
                        <span className="text-white font-mono">{invoice.invoice_number}</span>
                      </td>
                      <td className="p-4 text-neutral-300">{formatDate(invoice.created_at)}</td>
                      <td className="p-4 text-neutral-400">
                        {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                      </td>
                      <td className="p-4 text-white font-medium">
                        {formatCurrency(invoice.total)}
                      </td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            statusColors[invoice.status] || 'bg-neutral-500/20 text-neutral-400'
                          }`}
                        >
                          {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewInvoice(invoice.id)}
                            className="text-blue-400 hover:text-blue-300 text-sm"
                          >
                            View
                          </button>
                          {invoice.pdf_url && (
                            <a
                              href={invoice.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-neutral-400 hover:text-white text-sm"
                            >
                              PDF
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="p-4 text-center border-t border-neutral-700">
                <button
                  onClick={loadMore}
                  className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors"
                >
                  Load More
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center">
            <p className="text-neutral-400">No invoices yet</p>
            <p className="text-sm text-neutral-500 mt-1">
              Your invoices will appear here after your first billing cycle
            </p>
          </div>
        )}
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-neutral-800 rounded-xl border border-neutral-700 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-6 border-b border-neutral-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  Invoice {selectedInvoice.invoice_number}
                </h2>
                <p className="text-sm text-neutral-400 mt-1">
                  {formatDate(selectedInvoice.created_at)}
                </p>
              </div>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-neutral-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Status</span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    statusColors[selectedInvoice.status] || 'bg-neutral-500/20 text-neutral-400'
                  }`}
                >
                  {selectedInvoice.status.charAt(0).toUpperCase() + selectedInvoice.status.slice(1)}
                </span>
              </div>

              {/* Period */}
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Billing Period</span>
                <span className="text-white">
                  {formatDate(selectedInvoice.period_start)} -{' '}
                  {formatDate(selectedInvoice.period_end)}
                </span>
              </div>

              {/* Line Items */}
              <div>
                <h3 className="text-sm font-medium text-neutral-400 mb-3">Line Items</h3>
                <div className="bg-neutral-700/30 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-neutral-400 border-b border-neutral-600">
                        <th className="p-3 font-medium">Description</th>
                        <th className="p-3 font-medium text-right">Qty</th>
                        <th className="p-3 font-medium text-right">Unit Price</th>
                        <th className="p-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-600">
                      {selectedInvoice.line_items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="p-3 text-white">{item.description}</td>
                          <td className="p-3 text-neutral-300 text-right">{item.quantity}</td>
                          <td className="p-3 text-neutral-300 text-right">
                            {formatCurrency(item.unit_price)}
                          </td>
                          <td className="p-3 text-white text-right">
                            {formatCurrency(item.total)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-2 pt-4 border-t border-neutral-700">
                <div className="flex justify-between text-sm">
                  <span className="text-neutral-400">Subtotal</span>
                  <span className="text-white">{formatCurrency(selectedInvoice.subtotal)}</span>
                </div>
                {selectedInvoice.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-400">Discount</span>
                    <span className="text-emerald-400">
                      -{formatCurrency(selectedInvoice.discount)}
                    </span>
                  </div>
                )}
                {selectedInvoice.tax > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-neutral-400">Tax</span>
                    <span className="text-white">{formatCurrency(selectedInvoice.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-semibold pt-2">
                  <span className="text-white">Total</span>
                  <span className="text-white">{formatCurrency(selectedInvoice.total)}</span>
                </div>
              </div>

              {/* Payment Info */}
              {selectedInvoice.paid_at && (
                <div className="text-sm text-neutral-400">
                  Paid on {formatDate(selectedInvoice.paid_at)}
                  {selectedInvoice.payment_method && ` via ${selectedInvoice.payment_method}`}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4">
                {selectedInvoice.pdf_url && (
                  <a
                    href={selectedInvoice.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-center rounded-lg transition-colors"
                  >
                    Download PDF
                  </a>
                )}
                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="flex-1 py-2 px-4 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay for detail */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
        </div>
      )}
    </div>
  );
}
