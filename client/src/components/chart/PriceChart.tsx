import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  createChart, 
  type IChartApi, 
  type ISeriesApi, 
  type CandlestickData, 
  type HistogramData,
  type Time 
} from 'lightweight-charts';
import { ChartControls } from './ChartControls';
import { CandleTooltip } from './CandleTooltip';
import { chartConfig, mobileChartConfig, candlestickConfig, volumeConfig, getMinBarSpacing } from './chartConfig';
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

const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

const DOUBLE_TAP_DELAY = 300;

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
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [containerWidth, setContainerWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [showHelperText, setShowHelperText] = useState(true);
  
  const prevAssetRef = useRef<string>(selectedAsset);
  const prevTimeframeRef = useRef<string>(selectedTimeframe);
  const initialLoadRef = useRef<boolean>(true);
  
  const touchStateRef = useRef<{
    isActive: boolean;
    lastTapTime: number;
    tapCount: number;
  }>({
    isActive: false,
    lastTapTime: 0,
    tapCount: 0,
  });

  const sortedCandles = useMemo(() => {
    return [...candles].sort((a, b) => a.time - b.time);
  }, [candles]);

  useEffect(() => {
    const map = new Map<number, Candle>();
    sortedCandles.forEach(c => {
      map.set(Math.floor(c.time / 1000), c);
    });
    candleMapRef.current = map;
  }, [sortedCandles]);

  useEffect(() => {
    setIsMobile(isTouchDevice());
  }, []);

  useEffect(() => {
    if (isMobile && showHelperText) {
      const timer = setTimeout(() => setShowHelperText(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [isMobile, showHelperText]);

  const resetChartZoom = useCallback(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, []);

  // Initialize chart with volume
  useEffect(() => {
    if (!containerRef.current) return;

    const config = isMobile ? mobileChartConfig : chartConfig;
    
    const chart = createChart(containerRef.current, {
      ...config,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      ...candlestickConfig,
      priceScaleId: 'right',
    });

    // Add volume histogram series
    const volumeSeries = chart.addHistogramSeries({
      ...volumeConfig,
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
    });

    // Configure volume price scale
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.85,
        bottom: 0,
      },
      borderVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    setContainerWidth(containerRef.current.clientWidth);

    chart.applyOptions({
      timeScale: {
        minBarSpacing: getMinBarSpacing(selectedTimeframe),
      },
    });

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

    chart.subscribeCrosshairMove((param) => {
      if (!param.point || !param.time || !candleSeriesRef.current) {
        setHoveredCandle(null);
        return;
      }

      if (touchStateRef.current.isActive) {
        setHoveredCandle(null);
        return;
      }

      const timeKey = param.time as number;
      const data = param.seriesData.get(candleSeriesRef.current) as CandlestickData;
      
      if (data) {
        const fullCandle = candleMapRef.current.get(timeKey);
        
        setHoveredCandle({
          time: timeKey * 1000,
          open: data.open,
          high: data.high,
          low: data.low,
          close: data.close,
          volume: fullCandle?.volume ?? 0,
        });
        setTooltipPosition({ x: param.point.x, y: param.point.y });
      }
    });

    const chartElement = containerRef.current;
    
    const handleTouchStart = (e: TouchEvent) => {
      touchStateRef.current.isActive = true;
      setHoveredCandle(null);
      
      if (e.touches.length === 1) {
        const now = Date.now();
        const timeSinceLastTap = now - touchStateRef.current.lastTapTime;
        
        if (timeSinceLastTap < DOUBLE_TAP_DELAY) {
          touchStateRef.current.tapCount++;
        } else {
          touchStateRef.current.tapCount = 1;
        }
        
        touchStateRef.current.lastTapTime = now;
      }
    };
    
    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        const now = Date.now();
        const timeSinceLastTap = now - touchStateRef.current.lastTapTime;
        
        if (touchStateRef.current.tapCount >= 2 && timeSinceLastTap < DOUBLE_TAP_DELAY) {
          resetChartZoom();
          touchStateRef.current.tapCount = 0;
        }
        
        setTimeout(() => {
          touchStateRef.current.isActive = false;
        }, 100);
      }
    };
    
    const handleTouchMove = () => {
      touchStateRef.current.tapCount = 0;
      setHoveredCandle(null);
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
  }, [isMobile, resetChartZoom]);

  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        timeScale: {
          minBarSpacing: getMinBarSpacing(selectedTimeframe),
        },
      });
    }
  }, [selectedTimeframe]);

  // Update chart data with volume
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || sortedCandles.length === 0) return;

    const candleData: CandlestickData[] = sortedCandles.map((c) => ({
      time: Math.floor(c.time / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = sortedCandles.map((c) => ({
      time: Math.floor(c.time / 1000) as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 51, 102, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    const assetChanged = prevAssetRef.current !== selectedAsset;
    const timeframeChanged = prevTimeframeRef.current !== selectedTimeframe;
    const isInitialLoad = initialLoadRef.current;
    
    if (isInitialLoad || assetChanged || timeframeChanged) {
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
    if (!candleSeriesRef.current || !volumeSeriesRef.current || sortedCandles.length === 0 || !currentPrice || currentPrice <= 0) return;

    const lastCandle = sortedCandles[sortedCandles.length - 1];
    
    const priceDiff = Math.abs(currentPrice - lastCandle.close) / lastCandle.close;
    if (priceDiff > 0.2) return;
    
    candleSeriesRef.current.update({
      time: Math.floor(lastCandle.time / 1000) as Time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, currentPrice),
      low: Math.min(lastCandle.low, currentPrice),
      close: currentPrice,
    });

    volumeSeriesRef.current.update({
      time: Math.floor(lastCandle.time / 1000) as Time,
      value: lastCandle.volume,
      color: currentPrice >= lastCandle.open ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 51, 102, 0.3)',
    });
  }, [sortedCandles, currentPrice]);

  useEffect(() => {
    updateLivePrice();
  }, [updateLivePrice]);

  const displayPrice = currentPrice && currentPrice > 0 
    ? currentPrice 
    : (sortedCandles.length > 0 ? sortedCandles[sortedCandles.length - 1]?.close : 0);

  const priceColor = sortedCandles.length > 0 
    ? (displayPrice >= sortedCandles[sortedCandles.length - 1]?.open ? 'text-accent-green' : 'text-accent-red')
    : 'text-text-primary';

  const handleDoubleClick = useCallback(() => {
    resetChartZoom();
  }, [resetChartZoom]);

  return (
    <div 
      className="relative h-full w-full bg-bg-primary rounded-xl border border-border overflow-hidden"
      onDoubleClick={handleDoubleClick}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-bg-primary/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-3">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            <h2 className="text-base md:text-lg font-semibold font-mono truncate">
              {selectedAsset}-PERP
            </h2>
            {displayPrice > 0 && (
              <span className={`text-lg md:text-xl font-mono font-bold tabular-nums ${priceColor}`}>
                ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
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
        <div className="md:hidden px-3 pb-2">
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

      {/* Chart container */}
      <div 
        ref={containerRef} 
        className="h-full w-full pt-[76px] md:pt-14 touch-manipulation"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      />

      {/* Loading overlay */}
      {isLoading && sortedCandles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/80 backdrop-blur-sm z-20">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <span className="text-sm text-text-muted">Loading chart...</span>
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
      {isMobile && showHelperText && sortedCandles.length > 0 && !isLoading && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-muted/70 pointer-events-none bg-bg-primary/80 px-3 py-1 rounded-full backdrop-blur-sm">
          Pinch to zoom - Double-tap to reset
        </div>
      )}
    </div>
  );
}
