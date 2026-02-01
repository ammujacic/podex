'use client';

import { forwardRef, type SVGProps } from 'react';

export interface PodexIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  /** Whether to use the full favicon style with dark background (default: true) */
  variant?: 'full' | 'mark';
}

/**
 * Podex logo icon - matches the official favicon exactly.
 * - 'full' variant (default): Dark rounded background with white P{x}
 * - 'mark' variant: Just the P{x} shape using currentColor
 */
export const PodexIcon = forwardRef<SVGSVGElement, PodexIconProps>(
  ({ size = 24, className, variant = 'full', ...props }, ref) => {
    if (variant === 'mark') {
      // Single-color P{x} mark using currentColor (matches podex.svg)
      return (
        <svg
          ref={ref}
          role="img"
          viewBox="0 0 24 24"
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
            d="M4 3H12C15.3137 3 18 5.68629 18 9C18 12.3137 15.3137 15 12 15H8V19H4V3ZM8 6V12H11.5C13.1569 12 14.5 10.6569 14.5 9C14.5 7.34315 13.1569 6 11.5 6H8Z"
          />
          {/* Left curly brace */}
          <path
            d="M11.5 15 Q10.5 15 10.5 16 Q10.5 17 10 17 Q10.5 17 10.5 18 Q10.5 19 11.5 19"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
          />
          {/* Small x */}
          <path
            d="M13.5 15.5L17.5 19.5M17.5 15.5L13.5 19.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
          />
          {/* Right curly brace */}
          <path
            d="M19.5 15 Q20.5 15 20.5 16 Q20.5 17 21 17 Q20.5 17 20.5 18 Q20.5 19 19.5 19"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    }

    // Full favicon style with dark background (matches podex.svg)
    return (
      <svg
        ref={ref}
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        className={className}
        {...props}
      >
        <title>Podex</title>
        {/* Dark background */}
        <rect width="24" height="24" rx="4.5" fill="#07070a" />
        {/* Large P */}
        <path
          d="M4 3H12C15.3137 3 18 5.68629 18 9C18 12.3137 15.3137 15 12 15H8V19H4V3Z"
          fill="white"
          opacity="0.9"
        />
        {/* Inner hole (same as background) */}
        <path
          d="M8 6H11.5C13.1569 6 14.5 7.34315 14.5 9C14.5 10.6569 13.1569 12 11.5 12H8V6Z"
          fill="#07070a"
        />
        {/* Left curly brace */}
        <path
          d="M11.5 15 Q10.5 15 10.5 16 Q10.5 17 10 17 Q10.5 17 10.5 18 Q10.5 19 11.5 19"
          stroke="white"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
        />
        {/* Small x */}
        <path
          d="M13.5 15.5L17.5 19.5M17.5 15.5L13.5 19.5"
          stroke="white"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        {/* Right curly brace */}
        <path
          d="M19.5 15 Q20.5 15 20.5 16 Q20.5 17 21 17 Q20.5 17 20.5 18 Q20.5 19 19.5 19"
          stroke="white"
          strokeWidth="1"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
);

PodexIcon.displayName = 'PodexIcon';
