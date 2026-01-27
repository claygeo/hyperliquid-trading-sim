import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export function Tooltip({ content, children, position = 'top', className }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-bg-elevated border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-bg-elevated border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-bg-elevated border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-bg-elevated border-y-transparent border-l-transparent',
  };

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={cn(
            'absolute z-50 px-3 py-2 text-sm bg-bg-elevated rounded-lg shadow-lg',
            'whitespace-nowrap animate-fade-in',
            positions[position],
            className
          )}
        >
          {content}
          <div
            className={cn(
              'absolute w-0 h-0 border-4',
              arrows[position]
            )}
          />
        </div>
      )}
    </div>
  );
}
