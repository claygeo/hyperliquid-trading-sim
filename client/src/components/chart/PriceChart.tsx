import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time } from 'lightweight-charts';
import { ChartControls } from './ChartControls';
import { CandleTooltip } from './CandleTooltip';
import { chartConfig, mobileChartConfig, candlestickConfig, getTimeFormatter, getMinBarSpacing } from './chartConfig';
import type { Candle } from '../../types/market';
import { Spinner } from '../ui/Spinner';

interface PriceChartProps {
  candles: Candle[];
  selectedAsset: string;
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  onAssetChange?: (asset: string) => void;
  isLoading?: boolean;
  currentPrice?: number;
  showAssetSelector?: boolean;
}

// Detect if device is mobile/touch
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

export function PriceChart({
  candles,
  selectedAsset,
  selectedTimeframe,
  onTimeframeChange,
  onAssetChange,
  isLoading,
  currentPrice,
  showAssetSelector = false,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  
  // Store candles in a map for fast volume lookup during hover
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  
  // Track previous asset/timeframe to know when to fit content
  const prevAssetRef = useRef<string>(selectedAsset);
  const prevTimeframeRef = useRef<string>(selectedTimeframe);
  const initialLoadRef = useRef<boolean>(true);
  
  // Track touch state for better mobile UX
  const touchStateRef = useRef<{ isActive: boolean; startTime: number }>({
    isActive: false,
    startTime: 0,
  });

  // Memoize sorted candles
  const sortedCandles = useMemo(() => {
    return [...candles].sort((a, b) => a.time - b.time);
  }, [candles]);

  // Update candle map when candles change
  useEffect(() => {
    const map = new Map<number, Candle>();
    sortedCandles.forEach(c => {
      // Store by time in seconds (as used by lightweight-charts)
      map.set(Math.floor(c.time / 1000), c);
    });
    candleMapRef.current = map;
  }, [sortedCandles]);

  // Detect mobile on mount
  useEffect(() => {
    setIsMobile(isTouchDevice());
  }, []);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const config = isMobile ? mobileChartConfig : chartConfig;
    
    const chart = createChart(containerRef.current, {
      ...config,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addCandlestickSeries(candlestickConfig);

    chartRef.current = chart;
    seriesRef.current = series;
    setContainerWidth(containerRef.current.clientWidth);

    // Apply initial time formatter
    chart.applyOptions({
      timeScale: {
        tickMarkFormatter: getTimeFormatter(selectedTimeframe),
        minBarSpacing: getMinBarSpacing(selectedTimeframe),
      },
    });

    // Handle resize with debounce
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (containerRef.current && chartRef.current) {
          const width = containerRef.current.clientWidth;
          const height = containerRef.current.clientHeight;
          chartRef.current.applyOptions({ width, height });
          setContainerWidth(width);
        }
      }, 50);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Handle crosshair move for tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !seriesRef.current) {
        setHoveredCandle(null);
        return;
      }

      // Don't show tooltip during active touch/drag
      if (touchStateRef.current.isActive) {
        setHoveredCandle(null);
        return;
      }

      const timeKey = param.time as number;
      const data = param.seriesData.get(seriesRef.current) as CandlestickData;
      
      if (data) {
        // Look up the full candle data including volume
        const fullCandle = candleMapRef.current.get(timeKey);
        
        setHoveredCandle({
          time: timeKey * 1000, // Convert back to ms for display
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: fullCandle?.volume ?? 0,
        });
        setTooltipPosition({ x: param.point.x, y: param.point.y });
      }
    });

    // Touch event handlers for mobile optimization
    const chartElement = containerRef.current;
    
    const handleTouchStart = () => {
      touchStateRef.current = { isActive: true, startTime: Date.now() };
      setHoveredCandle(null);
    };
    
    const handleTouchEnd = () => {
      const touchDuration = Date.now() - touchStateRef.current.startTime;
      touchStateRef.current.isActive = false;
      
      // If it was a quick tap (< 200ms), let the crosshair show
      if (touchDuration >= 200) {
        setHoveredCandle(null);
      }
    };
    
    const handleTouchMove = () => {
      // During drag/pinch, hide tooltip
      if (touchStateRef.current.isActive) {
        setHoveredCandle(null);
      }
    };

    chartElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    chartElement.addEventListener('touchend', handleTouchEnd, { passive: true });
    chartElement.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      chartElement.removeEventListener('touchstart', handleTouchStart);
      chartElement.removeEventListener('touchend', handleTouchEnd);
      chartElement.removeEventListener('touchmove', handleTouchMove);
      chart.remove();
    };
  }, [isMobile]); // Recreate chart if mobile state changes

  // Update time formatter when timeframe changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        timeScale: {
          tickMarkFormatter: getTimeFormatter(selectedTimeframe),
          minBarSpacing: getMinBarSpacing(selectedTimeframe),
        },
      });
    }
  }, [selectedTimeframe]);

  // Update chart data
  useEffect(() => {
    if (!seriesRef.current || sortedCandles.length === 0) return;

    const chartData: CandlestickData[] = sortedCandles.map((c) => ({
      time: Math.floor(c.time / 1000) as Time, // Convert to seconds for lightweight-charts
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    seriesRef.current.setData(chartData);

    // Only fit content on initial load or when asset/timeframe changes
    const assetChanged = prevAssetRef.current !== selectedAsset;
    const timeframeChanged = prevTimeframeRef.current !== selectedTimeframe;
    const isInitialLoad = initialLoadRef.current;
    
    if (isInitialLoad || assetChanged || timeframeChanged) {
      // Small delay to ensure data is rendered before fitting
      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
      });
      initialLoadRef.current = false;
      prevAssetRef.current = selectedAsset;
      prevTimeframeRef.current = selectedTimeframe;
    }
  }, [sortedCandles, selectedAsset, selectedTimeframe]);

  // Update last candle with live price
  const updateLivePrice = useCallback(() => {
    if (!seriesRef.current || sortedCandles.length === 0 || !currentPrice || currentPrice <= 0) return;

    const lastCandle = sortedCandles[sortedCandles.length - 1];
    
    // Only update if current price is within 20% of the candle's close
    // This prevents wild jumps when candle data is stale
    const priceDiff = Math.abs(currentPrice - lastCandle.close) / lastCandle.close;
    if (priceDiff > 0.2) {
      return;
    }
    
    seriesRef.current.update({
      time: Math.floor(lastCandle.time / 1000) as Time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, currentPrice),
      low: Math.min(lastCandle.low, currentPrice),
      close: currentPrice,
    });
  }, [sortedCandles, currentPrice]);

  useEffect(() => {
    updateLivePrice();
  }, [updateLivePrice]);

  // Display price - prefer currentPrice, fallback to last candle
  const displayPrice = currentPrice && currentPrice > 0 
    ? currentPrice 
    : (sortedCandles.length > 0 ? sortedCandles[sortedCandles.length - 1]?.close : 0);

  const priceColor = sortedCandles.length > 0 
    ? (displayPrice >= sortedCandles[sortedCandles.length - 1]?.open ? 'text-accent-green' : 'text-accent-red')
    : 'text-text-primary';

  // Handle double-click to reset zoom
  const handleDoubleClick = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  return (
    <div 
      className="relative h-full w-full bg-bg-secondary rounded-xl border border-border overflow-hidden"
      onDoubleClick={handleDoubleClick}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-bg-secondary/90 backdrop-blur-sm border-b border-border">
        {/* Price row */}
        <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-3">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <h2 className="text-base md:text-lg font-semibold font-display truncate">
              {selectedAsset}/USD
            </h2>
            {displayPrice > 0 && (
              <div className="flex items-center gap-1 md:gap-2">
                <span className={`text-lg md:text-xl font-mono font-bold tabular-nums ${priceColor}`}>
                  ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {isLoading && (
                  <div className="w-4 h-4">
                    <Spinner size="sm" />
                  </div>
                )}
              </div>
            )}
          </div>
          {/* Desktop: show controls inline */}
          <div className="hidden md:block">
            <ChartControls
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={onTimeframeChange}
              selectedAsset={selectedAsset}
              onAssetChange={onAssetChange}
              isLoading={isLoading}
              showAssetSelector={showAssetSelector}
            />
          </div>
        </div>
        {/* Mobile: controls on separate row */}
        <div className="md:hidden px-3 pb-2">
          <div className="flex items-center justify-between gap-2">
            <ChartControls
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={onTimeframeChange}
              selectedAsset={selectedAsset}
              onAssetChange={onAssetChange}
              isLoading={isLoading}
              showAssetSelector={showAssetSelector}
            />
          </div>
        </div>
      </div>

      {/* Chart container */}
      <div 
        ref={containerRef} 
        className="h-full w-full pt-[80px] md:pt-14 touch-pan-x touch-pinch-zoom"
      />

      {/* Loading overlay */}
      {isLoading && sortedCandles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/80 backdrop-blur-sm z-20">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <span className="text-sm text-text-muted">Loading chart data...</span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredCandle && (
        <CandleTooltip
          candle={hoveredCandle}
          position={tooltipPosition}
          containerWidth={containerWidth}
          isMobile={isMobile}
        />
      )}

      {/* Mobile helper text */}
      {isMobile && !hoveredCandle && sortedCandles.length > 0 && !isLoading && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-muted/60 pointer-events-none">
          Pinch to zoom • Double-tap to reset
        </div>
      )}
    </div>
  );
}