'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';

interface SneakPeekSectionProps {
  icon: LucideIcon;
  title: string;
  tagline: string;
  description: string;
  color: string;
  gradient: string;
  index: number;
  isReversed?: boolean;
}

export function SneakPeekSection({
  icon: Icon,
  title,
  tagline,
  description,
  color,
  gradient,
  index,
  isReversed = false,
}: SneakPeekSectionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  // Enhanced scroll-linked transforms
  const y = useTransform(scrollYProgress, [0, 0.5, 1], [80, 0, -80]);
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0.8, 1, 1, 0.8]);
  const rotate = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [isReversed ? 5 : -5, 0, isReversed ? -5 : 5]
  );
  const x = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    [isReversed ? -30 : 30, 0, isReversed ? 30 : -30]
  );

  // Background gradient animation
  const gradientOpacity = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [0, 0.4, 0.4, 0]);
  const gradientScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.8, 1.2, 0.8]);

  return (
    <section
      ref={sectionRef}
      className="relative min-h-[50vh] flex items-center py-12 px-6 overflow-hidden"
    >
      {/* Background gradient - scroll animated */}
      <motion.div
        className={`absolute inset-0 bg-gradient-to-br ${gradient}`}
        style={{
          opacity: gradientOpacity,
          scale: gradientScale,
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 70%)',
        }}
      />

      <div className="max-w-6xl mx-auto w-full">
        <div
          className={`flex flex-col ${isReversed ? 'md:flex-row-reverse' : 'md:flex-row'} items-center gap-8 md:gap-12`}
        >
          {/* Visual */}
          <motion.div className="flex-1 relative" style={{ y, opacity, scale, rotate, x }}>
            <div className="relative w-56 h-56 mx-auto">
              {/* Outer glow ring */}
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`,
                }}
                animate={{
                  scale: [1, 1.1, 1],
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  delay: index * 0.5,
                  ease: 'easeInOut',
                }}
              />

              {/* Icon container */}
              <motion.div
                className="absolute inset-8 rounded-full flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${color}15, ${color}05)`,
                  border: `1px solid ${color}30`,
                }}
                whileInView={{
                  boxShadow: [`0 0 20px ${color}20`, `0 0 40px ${color}30`, `0 0 20px ${color}20`],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                <Icon className="w-16 h-16" style={{ color }} strokeWidth={1.5} />
              </motion.div>

              {/* Floating dots */}
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: color,
                    top: `${20 + i * 30}%`,
                    left: i % 2 === 0 ? '10%' : '85%',
                  }}
                  animate={{
                    y: [0, -10, 0],
                    opacity: [0.3, 0.6, 0.3],
                  }}
                  transition={{
                    duration: 2 + i * 0.5,
                    repeat: Infinity,
                    delay: i * 0.3,
                    ease: 'easeInOut',
                  }}
                />
              ))}
            </div>
          </motion.div>

          {/* Content */}
          <motion.div
            className={`flex-1 ${isReversed ? 'text-right md:text-left' : ''}`}
            initial={{ opacity: 0, x: isReversed ? -50 : 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <motion.span
              className="inline-block text-sm font-medium tracking-wider uppercase mb-4"
              style={{ color }}
            >
              {title}
            </motion.span>

            <h3 className="text-4xl md:text-5xl font-bold text-primary mb-4">{tagline}</h3>

            <p className="text-lg text-muted max-w-md">{description}</p>

            {/* Decorative line */}
            <motion.div
              className="mt-6 h-px w-24"
              style={{ backgroundColor: color }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.4 }}
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
