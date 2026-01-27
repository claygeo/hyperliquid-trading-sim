import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface AnimatedNumberProps {
  value: number;
  format?: (value: number) => string;
  className?: string;
  duration?: number;
  showChange?: boolean;
}

export function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  className,
  duration = 300,
  showChange = false,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const [changeDirection, setChangeDirection] = useState<'up' | 'down' | null>(null);
  const prevValueRef = useRef(value);
  const animationRef = useRef<number>();

  useEffect(() => {
    const startValue = prevValueRef.current;
    const endValue = value;
    const startTime = performance.now();

    // Set change direction for flash effect
    if (showChange && startValue !== endValue) {
      setChangeDirection(endValue > startValue ? 'up' : 'down');
      setTimeout(() => setChangeDirection(null), 300);
    }

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (endValue - startValue) * easeOut;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = endValue;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration, showChange]);

  return (
    <span
      className={cn(
        'transition-colors duration-200',
        changeDirection === 'up' && 'text-accent-green',
        changeDirection === 'down' && 'text-accent-red',
        className
      )}
    >
      {format(displayValue)}
    </span>
  );
}

// Simpler version that just has CSS transition (for less critical numbers)
export function SmoothNumber({
  value,
  format = (v) => v.toFixed(2),
  className,
}: Omit<AnimatedNumberProps, 'duration' | 'showChange'>) {
  return (
    <span className={cn('transition-all duration-200', className)}>
      {format(value)}
    </span>
  );
}
