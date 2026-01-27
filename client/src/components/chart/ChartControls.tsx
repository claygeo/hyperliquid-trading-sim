import { TIMEFRAMES } from '../../config/assets';
import { cn } from '../../lib/utils';

interface ChartControlsProps {
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
}

export function ChartControls({ selectedTimeframe, onTimeframeChange }: ChartControlsProps) {
  return (
    <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          onClick={() => onTimeframeChange(tf.value)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200',
            selectedTimeframe === tf.value
              ? 'bg-accent-cyan text-bg-primary'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
