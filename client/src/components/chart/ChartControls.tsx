import { useState, useRef, useEffect } from 'react';
import { TIMEFRAMES, ASSET_LIST } from '../../config/assets';
import { cn } from '../../lib/utils';

interface ChartControlsProps {
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  selectedAsset?: string;
  onAssetChange?: (asset: string) => void;
  isLoading?: boolean;
  showAssetSelector?: boolean;
}

export function ChartControls({ 
  selectedTimeframe, 
  onTimeframeChange,
  selectedAsset = 'BTC',
  onAssetChange,
  isLoading = false,
  showAssetSelector = false,
}: ChartControlsProps) {
  const [isAssetDropdownOpen, setIsAssetDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAssetDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    const timeframeValues = TIMEFRAMES.map(tf => tf.value);
    
    if (e.key === 'ArrowLeft' && currentIndex > 0) {
      e.preventDefault();
      onTimeframeChange(timeframeValues[currentIndex - 1]);
    } else if (e.key === 'ArrowRight' && currentIndex < timeframeValues.length - 1) {
      e.preventDefault();
      onTimeframeChange(timeframeValues[currentIndex + 1]);
    }
  };

  const handleAssetSelect = (asset: string) => {
    onAssetChange?.(asset);
    setIsAssetDropdownOpen(false);
  };

  const selectedAssetData = ASSET_LIST.find(a => a.symbol === selectedAsset);

  return (
    <div className="flex items-center gap-2">
      {/* Asset Selector */}
      {showAssetSelector && onAssetChange && (
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsAssetDropdownOpen(!isAssetDropdownOpen)}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all duration-200',
              'bg-bg-tertiary border border-border hover:border-accent-cyan/50',
              isLoading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <span className="text-lg">{selectedAssetData?.icon}</span>
            <span className="text-text-primary">{selectedAsset}</span>
            <svg 
              className={cn(
                'w-4 h-4 text-text-muted transition-transform duration-200',
                isAssetDropdownOpen && 'rotate-180'
              )} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {isAssetDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-36 bg-bg-elevated border border-border rounded-lg shadow-xl z-50 overflow-hidden">
              {ASSET_LIST.map((asset) => (
                <button
                  key={asset.symbol}
                  onClick={() => handleAssetSelect(asset.symbol)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                    asset.symbol === selectedAsset
                      ? 'bg-accent-cyan/20 text-accent-cyan'
                      : 'text-text-primary hover:bg-bg-tertiary'
                  )}
                >
                  <span className="text-lg">{asset.icon}</span>
                  <span>{asset.symbol}</span>
                  {asset.symbol === selectedAsset && (
                    <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeframe Selector */}
      <div className="flex items-center gap-0.5 bg-bg-tertiary rounded-lg p-0.5">
        {TIMEFRAMES.map((tf, index) => {
          const isSelected = selectedTimeframe === tf.value;
          return (
            <button
              key={tf.value}
              onClick={() => onTimeframeChange(tf.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              disabled={isLoading}
              className={cn(
                'relative px-2 md:px-3 py-1.5 text-xs md:text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap',
                'focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 focus:ring-offset-1 focus:ring-offset-bg-tertiary',
                'min-w-[32px] md:min-w-[40px] touch-manipulation',
                isSelected
                  ? 'bg-accent-cyan text-bg-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
              aria-pressed={isSelected}
              aria-label={`${tf.label} timeframe`}
            >
              {tf.label}
              {isSelected && isLoading && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-cyan opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-cyan" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}