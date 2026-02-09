'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, CheckCircle, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

import { joinWaitlist } from '@/lib/api';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes('@')) {
      setStatus('error');
      setMessage('Please enter a valid email address');
      return;
    }

    setStatus('loading');

    startTransition(async () => {
      try {
        const result = await joinWaitlist(email);

        if (result.success) {
          setStatus('success');
          setMessage(result.message);
          setEmail('');
        } else {
          setStatus('error');
          setMessage('Something went wrong. Please try again.');
        }
      } catch (error) {
        setStatus('error');
        setMessage(
          error instanceof Error ? error.message : 'Something went wrong. Please try again.'
        );
      }
    });
  };

  const isLoading = status === 'loading' || isPending;

  return (
    <div className="w-full max-w-md mx-auto">
      <AnimatePresence mode="wait">
        {status === 'success' ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-center py-8"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
            >
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            </motion.div>
            <h3 className="text-xl font-bold text-primary mb-2">You&apos;re on the list!</h3>
            <p className="text-muted">{message}</p>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="relative"
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === 'error') setStatus('idle');
                  }}
                  placeholder="Enter your email"
                  className="w-full px-4 py-3 bg-surface border border-subtle rounded-lg text-primary placeholder:text-muted focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all"
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-500 to-violet-600 text-white font-medium rounded-lg hover:from-purple-600 hover:to-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Join Waitlist
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>

            <AnimatePresence>
              {status === 'error' && message && (
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute mt-2 text-sm text-red-400"
                >
                  {message}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
