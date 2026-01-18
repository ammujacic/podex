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
      // Single-color P mark using currentColor
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
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10 8H18.5C21.5376 8 24 10.4624 24 13.5C24 16.5376 21.5376 19 18.5 19H14V24H10V8ZM14 11.5V15.5H18C19.1046 15.5 20 14.6046 20 13.5C20 12.3954 19.1046 11.5 18 11.5H14Z"
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
        {/* White P shape */}
        <path
          d="M10 8H18.5C21.5376 8 24 10.4624 24 13.5C24 16.5376 21.5376 19 18.5 19H14V24H10V8Z"
          fill="white"
        />
        {/* Inner hole (same as background) */}
        <path
          d="M14 11.5H18C19.1046 11.5 20 12.3954 20 13.5C20 14.6046 19.1046 15.5 18 15.5H14V11.5Z"
          fill="#07070a"
        />
      </svg>
    );
  }
);

PodexIcon.displayName = 'PodexIcon';
