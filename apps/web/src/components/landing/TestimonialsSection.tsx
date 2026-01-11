'use client';

import { motion, useInView, AnimatePresence } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { Quote, ChevronLeft, ChevronRight, Star } from 'lucide-react';

const testimonials = [
  {
    quote:
      "Podex completely changed how I build software. What used to take days now takes hours. The multi-agent collaboration is unlike anything I've seen.",
    author: 'Sarah Chen',
    role: 'Senior Engineer',
    company: 'TechCorp',
    avatar: 'SC',
    rating: 5,
  },
  {
    quote:
      'The agent memory feature is a game-changer. It remembers my coding style and preferences, making suggestions that actually match how I work.',
    author: 'Marcus Johnson',
    role: 'Full Stack Developer',
    company: 'StartupXYZ',
    avatar: 'MJ',
    rating: 5,
  },
  {
    quote:
      'We deployed Podex for our entire engineering team. The productivity gains are measurable - 40% faster feature delivery in the first month.',
    author: 'Emily Rodriguez',
    role: 'VP of Engineering',
    company: 'ScaleUp Inc',
    avatar: 'ER',
    rating: 5,
  },
  {
    quote:
      'The vision analysis is incredible. I upload a design mockup and the agents generate production-ready React components. Magic.',
    author: 'David Kim',
    role: 'Frontend Lead',
    company: 'DesignLab',
    avatar: 'DK',
    rating: 5,
  },
  {
    quote:
      'Finally, an AI coding tool that understands context. The planning and memory features make it feel like working with a real team.',
    author: 'Alex Thompson',
    role: 'Independent Developer',
    company: 'Freelance',
    avatar: 'AT',
    rating: 5,
  },
];

const stats = [
  { value: '10,000+', label: 'Developers' },
  { value: '500K+', label: 'Projects Built' },
  { value: '50x', label: 'Faster Development' },
  { value: '4.9/5', label: 'Average Rating' },
];

export function TestimonialsSection() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const goToPrevious = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  const goToNext = () => {
    setIsAutoPlaying(false);
    setCurrentIndex((prev) => (prev + 1) % testimonials.length);
  };

  return (
    <section ref={ref} className="py-24 lg:py-32 bg-void relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-accent-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-agent-4/30 bg-agent-4/10 px-4 py-1.5 text-sm text-agent-4 mb-6">
              <Star className="h-4 w-4 fill-current" />
              Loved by Developers
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-text-primary mb-4"
          >
            Developers are <span className="text-agent-4">building faster</span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg text-text-secondary max-w-2xl mx-auto"
          >
            Join thousands of developers who have transformed their workflow with Podex.
          </motion.p>
        </div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-16"
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="text-center p-6 rounded-xl bg-surface/50 border border-border-subtle"
            >
              <div className="text-3xl lg:text-4xl font-bold text-accent-primary mb-1">
                {stat.value}
              </div>
              <div className="text-sm text-text-muted">{stat.label}</div>
            </div>
          ))}
        </motion.div>

        {/* Testimonial carousel */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="relative"
        >
          <div className="absolute -inset-4 bg-gradient-to-r from-agent-4/10 via-accent-primary/10 to-accent-secondary/10 rounded-3xl blur-2xl opacity-50" />

          <div className="relative bg-surface border border-border-default rounded-2xl p-8 lg:p-12">
            <Quote className="h-12 w-12 text-accent-primary/20 mb-6" />

            <AnimatePresence mode="wait">
              {testimonials[currentIndex] && (
                <motion.div
                  key={currentIndex}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Stars */}
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: testimonials[currentIndex].rating }).map((_, i) => (
                      <Star key={i} className="h-5 w-5 text-agent-4 fill-current" />
                    ))}
                  </div>

                  {/* Quote */}
                  <blockquote className="text-xl lg:text-2xl text-text-primary font-medium mb-8 leading-relaxed">
                    &ldquo;{testimonials[currentIndex].quote}&rdquo;
                  </blockquote>

                  {/* Author */}
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center text-text-inverse font-bold">
                      {testimonials[currentIndex].avatar}
                    </div>
                    <div>
                      <div className="font-semibold text-text-primary">
                        {testimonials[currentIndex].author}
                      </div>
                      <div className="text-sm text-text-muted">
                        {testimonials[currentIndex].role} at {testimonials[currentIndex].company}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 pt-8 border-t border-border-subtle">
              <div className="flex gap-2">
                {testimonials.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setIsAutoPlaying(false);
                      setCurrentIndex(i);
                    }}
                    className={`w-2 h-2 rounded-full transition-all ${
                      i === currentIndex
                        ? 'bg-accent-primary w-6'
                        : 'bg-border-default hover:bg-border-strong'
                    }`}
                  />
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={goToPrevious}
                  className="p-2 rounded-lg bg-elevated hover:bg-overlay transition-colors"
                >
                  <ChevronLeft className="h-5 w-5 text-text-primary" />
                </button>
                <button
                  onClick={goToNext}
                  className="p-2 rounded-lg bg-elevated hover:bg-overlay transition-colors"
                >
                  <ChevronRight className="h-5 w-5 text-text-primary" />
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Company logos */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-16 text-center"
        >
          <p className="text-sm text-text-muted mb-6">Trusted by developers at leading companies</p>
          <div className="flex flex-wrap justify-center items-center gap-8 lg:gap-12 opacity-50">
            {['Vercel', 'Stripe', 'Linear', 'Notion', 'Figma', 'GitHub'].map((company) => (
              <span key={company} className="text-xl font-bold text-text-muted">
                {company}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
