import * as React from 'react';
import { cn } from '@/lib/utils';

const CollapsibleContext = React.createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>({
  open: false,
  onOpenChange: () => {},
});

export interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

const Collapsible = React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ open = false, onOpenChange = () => {}, children, className, ...props }, ref) => {
    return (
      <CollapsibleContext.Provider value={{ open, onOpenChange }}>
        <div ref={ref} className={cn(className)} {...props}>
          {children}
        </div>
      </CollapsibleContext.Provider>
    );
  }
);
Collapsible.displayName = 'Collapsible';

export interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ className, asChild, children, onClick, ...props }, ref) => {
    const { open, onOpenChange } = React.useContext(CollapsibleContext);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onOpenChange(!open);
      onClick?.(e);
    };

    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ref,
        onClick: handleClick,
        ...props,
      } as React.HTMLAttributes<HTMLElement>);
    }
    return (
      <button ref={ref} className={cn(className)} onClick={handleClick} {...props}>
        {children}
      </button>
    );
  }
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

export interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  forceMount?: boolean;
}

const CollapsibleContent = React.forwardRef<HTMLDivElement, CollapsibleContentProps>(
  ({ className, children, forceMount, ...props }, ref) => {
    const { open } = React.useContext(CollapsibleContext);

    if (!open && !forceMount) {
      return null;
    }

    return (
      <div ref={ref} className={cn('overflow-hidden', !open && 'hidden', className)} {...props}>
        {children}
      </div>
    );
  }
);
CollapsibleContent.displayName = 'CollapsibleContent';

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
