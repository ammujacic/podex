import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from './utils';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md bg-[#141419] border border-[#2a2a35] px-3 py-2',
        'text-[#f0f0f5] text-sm placeholder:text-[#5c5c6e]',
        'focus:border-[#00e5ff] focus:outline-none focus:ring-1 focus:ring-[#00e5ff]',
        'transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
