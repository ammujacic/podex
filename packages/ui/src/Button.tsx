import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from './utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer',
    'transition-all duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed',
    'active:scale-[0.98]',
    'select-none touch-manipulation',
  ],
  {
    variants: {
      variant: {
        primary: [
          'bg-accent-primary text-text-inverse font-semibold',
          'shadow-[0_2px_8px_rgba(139,92,246,0.25)]',
          'hover:bg-accent-primary-hover hover:shadow-[0_4px_16px_rgba(139,92,246,0.35)] hover:-translate-y-0.5',
          'active:bg-accent-primary-active active:shadow-[0_2px_8px_rgba(139,92,246,0.25)] active:translate-y-0',
        ],
        secondary: [
          'bg-elevated border border-border-default text-text-primary',
          'hover:bg-overlay hover:border-border-strong hover:-translate-y-0.5',
          'active:bg-active active:translate-y-0',
        ],
        ghost: [
          'text-text-secondary bg-transparent',
          'hover:bg-overlay hover:text-text-primary',
          'active:bg-active',
        ],
        danger: [
          'bg-accent-error text-white font-semibold',
          'shadow-[0_2px_8px_rgba(239,68,68,0.25)]',
          'hover:bg-accent-error-hover hover:shadow-[0_4px_16px_rgba(239,68,68,0.35)] hover:-translate-y-0.5',
          'active:bg-accent-error-active active:shadow-[0_2px_8px_rgba(239,68,68,0.25)] active:translate-y-0',
        ],
        success: [
          'bg-accent-success text-white font-semibold',
          'shadow-[0_2px_8px_rgba(34,197,94,0.25)]',
          'hover:bg-accent-success-hover hover:shadow-[0_4px_16px_rgba(34,197,94,0.35)] hover:-translate-y-0.5',
          'active:bg-accent-success-active active:shadow-[0_2px_8px_rgba(34,197,94,0.25)] active:translate-y-0',
        ],
        link: [
          'text-accent-primary underline-offset-4',
          'hover:underline',
          'active:text-accent-primary-hover',
        ],
        outline: [
          'border-2 border-accent-primary text-accent-primary bg-transparent',
          'hover:bg-accent-primary/10 hover:-translate-y-0.5',
          'active:bg-accent-primary/20 active:translate-y-0',
        ],
      },
      size: {
        xs: 'h-7 px-2 text-xs min-w-[28px]',
        sm: 'h-9 px-3 text-sm min-h-[36px] min-w-[36px]',
        md: 'h-10 px-4 min-h-[44px] min-w-[44px]',
        lg: 'h-12 px-6 text-base min-h-[48px] min-w-[48px]',
        xl: 'h-14 px-8 text-lg min-h-[56px] min-w-[56px]',
        icon: 'h-10 w-10 min-h-[44px] min-w-[44px] p-0',
        'icon-sm': 'h-8 w-8 min-h-[36px] min-w-[36px] p-0',
        'icon-lg': 'h-12 w-12 min-h-[48px] min-w-[48px] p-0',
      },
      fullWidth: {
        true: 'w-full',
      },
      loading: {
        true: 'relative text-transparent cursor-wait',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      loading,
      asChild = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, fullWidth, loading, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner size={size === 'sm' || size === 'xs' ? 'sm' : 'md'} />
          </span>
        )}
        {leftIcon && !loading && <span className="flex-shrink-0">{leftIcon}</span>}
        {children}
        {rightIcon && !loading && <span className="flex-shrink-0">{rightIcon}</span>}
      </Comp>
    );
  }
);
Button.displayName = 'Button';

// Loading spinner component
function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <svg
      className={cn('animate-spin', sizeClasses[size])}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// Button group for related actions
interface ButtonGroupProps {
  children: ReactNode;
  className?: string;
  attached?: boolean;
}

function ButtonGroup({ children, className, attached = false }: ButtonGroupProps) {
  return (
    <div
      className={cn(
        'inline-flex',
        attached
          ? '[&>*:first-child]:rounded-r-none [&>*:last-child]:rounded-l-none [&>*:not(:first-child):not(:last-child)]:rounded-none [&>*:not(:first-child)]:-ml-px'
          : 'gap-2',
        className
      )}
      role="group"
    >
      {children}
    </div>
  );
}

// Icon button variant with tooltip support
interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leftIcon' | 'rightIcon'> {
  icon: ReactNode;
  label: string;
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, size = 'icon', variant = 'ghost', ...props }, ref) => {
    return (
      <Button ref={ref} size={size} variant={variant} aria-label={label} {...props}>
        {icon}
      </Button>
    );
  }
);
IconButton.displayName = 'IconButton';

export { Button, ButtonGroup, IconButton, buttonVariants };
