'use client';

import { forwardRef, type SVGProps } from 'react';

export interface PodexIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  /** Whether to use the full favicon style with dark background (default: true) */
  variant?: 'full' | 'mark';
}

/**
 * Podex logo icon - matches the official favicon exactly.
 * - 'full' variant (default): Dark rounded background with white P
 * - 'mark' variant: Just the P shape using currentColor
 */
export const PodexIcon = forwardRef<SVGSVGElement, PodexIconProps>(
  ({ size = 24, className, variant = 'full', ...props }, ref) => {
    if (variant === 'mark') {
      // Single-color Px mark using currentColor
      return (
        <svg
          ref={ref}
          role="img"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          className={className}
          fill="currentColor"
          {...props}
        >
          <title>Podex</title>
          {/* Large P */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M9 7H17C19.7614 7 22 9.23858 22 12C22 14.7614 19.7614 17 17 17H13V22H9V7ZM13 10V14H16.5C17.6046 14 18.5 13.1046 18.5 12C18.5 10.8954 17.6046 10 16.5 10H13Z"
          />
          {/* Small x */}
          <path
            d="M17 19L21 23M21 19L17 23"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    }

    // Full favicon style with dark background
    return (
      <svg
        ref={ref}
        role="img"
        viewBox="0 0 32 32"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        className={className}
        {...props}
      >
        <title>Podex</title>
        {/* Dark background */}
        <rect width="32" height="32" rx="6" fill="#07070a" />
        {/* Large P */}
        <path
          d="M9 7H17C19.7614 7 22 9.23858 22 12C22 14.7614 19.7614 17 17 17H13V22H9V7Z"
          fill="white"
        />
        {/* Inner hole (same as background) */}
        <path
          d="M13 10H16.5C17.6046 10 18.5 10.8954 18.5 12C18.5 13.1046 17.6046 14 16.5 14H13V10Z"
          fill="#07070a"
        />
        {/* Small x */}
        <path d="M17 19L21 23M21 19L17 23" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
);

PodexIcon.displayName = 'PodexIcon';
