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
      // Single-color P{x} mark using currentColor
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
            d="M7 5H16C19.866 5 23 8.13401 23 12C23 15.866 19.866 19 16 19H12V25H7V5ZM12 9V15H15.5C17.157 15 18.5 13.657 18.5 12C18.5 10.343 17.157 9 15.5 9H12Z"
          />
          {/* Left curly brace */}
          <path
            d="M15 19 Q13.5 19 13.5 20.5 Q13.5 22 12.5 22 Q13.5 22 13.5 23.5 Q13.5 25 15 25"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
          />
          {/* Small x */}
          <path
            d="M17.5 19.5L21.5 23.5M21.5 19.5L17.5 23.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* Right curly brace */}
          <path
            d="M24 19 Q25.5 19 25.5 20.5 Q25.5 22 26.5 22 Q25.5 22 25.5 23.5 Q25.5 25 24 25"
            stroke="currentColor"
            strokeWidth="1.2"
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
          d="M7 5H16C19.866 5 23 8.13401 23 12C23 15.866 19.866 19 16 19H12V25H7V5Z"
          fill="white"
        />
        {/* Inner hole (same as background) */}
        <path
          d="M12 9H15.5C17.157 9 18.5 10.343 18.5 12C18.5 13.657 17.157 15 15.5 15H12V9Z"
          fill="#07070a"
        />
        {/* Left curly brace */}
        <path
          d="M15 19 Q13.5 19 13.5 20.5 Q13.5 22 12.5 22 Q13.5 22 13.5 23.5 Q13.5 25 15 25"
          stroke="white"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
        />
        {/* Small x */}
        <path
          d="M17.5 19.5L21.5 23.5M21.5 19.5L17.5 23.5"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* Right curly brace */}
        <path
          d="M24 19 Q25.5 19 25.5 20.5 Q25.5 22 26.5 22 Q25.5 22 25.5 23.5 Q25.5 25 24 25"
          stroke="white"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
);

PodexIcon.displayName = 'PodexIcon';
