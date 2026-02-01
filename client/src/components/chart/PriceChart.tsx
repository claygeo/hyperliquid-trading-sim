import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { 
  createChart, 
  type IChartApi, 
  type ISeriesApi, 
  type CandlestickData, 
  type HistogramData,
  type Time,
  CrosshairMode,
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
  compact?: boolean;
}

const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

const DOUBLE_TAP_DELAY = 300;

// Helper to format price based on asset
const formatPriceForAsset = (price: number): string => {
  if (price >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (price >= 1) {
    return price.toFixed(4);
  } else if (price >= 0.0001) {
    return price.toFixed(6);
  } else {
    return price.toFixed(8);
  }
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
  compact = false,
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
  const [chartReady, setChartReady] = useState(false);
  
  const prevAssetRef = useRef<string>(selectedAsset);
  const prevTimeframeRef = useRef<string>(selectedTimeframe);
  const initialLoadRef = useRef<boolean>(true);
  const initAttemptRef = useRef<number>(0);
  
  const touchStateRef = useRef<{
    isActive: boolean;
    lastTapTime: number;
    tapCount: number;
  }>({
    isActive: false,
    lastTapTime: 0,
    tapCount: 0,
  });

  // Filter and validate candles - ensure they have reasonable price data
  const sortedCandles = useMemo(() => {
    if (!candles || candles.length === 0) return [];
    
    // Sort by time
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    
    // Filter out any invalid candles (where prices are 0 or undefined)
    const validCandles = sorted.filter(c => 
      c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0
    );
    
    return validCandles;
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

  // Initialize chart with mobile-safe dimension checking
  useEffect(() => {
    let retryTimeout: ReturnType<typeof setTimeout>;
    let resizeTimeout: ReturnType<typeof setTimeout>;
    let resizeObserver: ResizeObserver | null = null;
    
    const createChartInstance = (): boolean => {
      if (!containerRef.current) return false;
      
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      // Don't create if container has no/tiny dimensions (mobile tab switch)
      if (width < 50 || height < 50) {
        return false;
      }

      // Remove existing chart
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          // Ignore removal errors
        }
        chartRef.current = null;
        candleSeriesRef.current = null;
        volumeSeriesRef.current = null;
      }

      const config = isMobile ? mobileChartConfig : chartConfig;
      
      const chart = createChart(containerRef.current, {
        ...config,
        width,
        height,
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            width: 1,
            color: 'rgba(255, 255, 255, 0.1)',
            style: 0,
          },
          horzLine: {
            width: 1,
            color: 'rgba(255, 255, 255, 0.1)',
            style: 0,
          },
        },
        handleScroll: {
          vertTouchDrag: true,
          horzTouchDrag: true,
          mouseWheel: true,
          pressedMouseMove: true,
        },
        handleScale: {
          axisPressedMouseMove: {
            time: true,
            price: true,
          },
          axisDoubleClickReset: {
            time: true,
            price: true,
          },
          mouseWheel: true,
          pinch: true,
        },
      });

      const candleSeries = chart.addCandlestickSeries({
        ...candlestickConfig,
        priceScaleId: 'right',
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
      });

      const volumeSeries = chart.addHistogramSeries({
        ...volumeConfig,
        priceScaleId: 'volume',
        priceFormat: { type: 'volume' },
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: {
          top: compact ? 0.85 : 0.80,
          bottom: 0,
        },
        borderVisible: false,
      });

      chartRef.current = chart;
      candleSeriesRef.current = candleSeries;
      volumeSeriesRef.current = volumeSeries;
      setContainerWidth(width);
      setChartReady(true);

      chart.applyOptions({
        timeScale: {
          minBarSpacing: getMinBarSpacing(selectedTimeframe),
          rightOffset: 5,
          barSpacing: isMobile ? 6 : 8,
        },
      });

      // Setup resize observer
      const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          if (containerRef.current && chartRef.current) {
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            if (w > 50 && h > 50) {
              chartRef.current.applyOptions({ width: w, height: h });
              setContainerWidth(w);
              chartRef.current.timeScale().fitContent();
            }
          }
        }, 100);
      };

      resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(containerRef.current);

      // Crosshair move handler
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

      // Touch handlers for mobile
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

      return true;
    };

    // Try to create chart, retry if dimensions aren't ready
    const attemptCreate = () => {
      initAttemptRef.current++;
      const success = createChartInstance();
      
      if (!success && initAttemptRef.current < 10) {
        // Retry after a short delay (helps with mobile tab switching)
        retryTimeout = setTimeout(attemptCreate, 100);
      }
    };

    // Initial delay for mobile to ensure layout is ready
    retryTimeout = setTimeout(attemptCreate, isMobile ? 50 : 0);

    return () => {
      clearTimeout(retryTimeout);
      clearTimeout(resizeTimeout);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          // Ignore
        }
      }
      setChartReady(false);
      initAttemptRef.current = 0;
    };
  }, [isMobile, resetChartZoom, compact, selectedTimeframe]);

  // Update chart data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || sortedCandles.length === 0 || !chartReady) return;

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
      color: c.close >= c.open ? 'rgba(14, 203, 129, 0.4)' : 'rgba(246, 70, 93, 0.4)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Configure price precision based on asset price range
    const avgPrice = sortedCandles.reduce((acc, c) => acc + c.close, 0) / sortedCandles.length;
    let precision = 2;
    let minMove = 0.01;
    
    if (avgPrice < 0.01) {
      precision = 8;
      minMove = 0.00000001;
    } else if (avgPrice < 1) {
      precision = 6;
      minMove = 0.000001;
    } else if (avgPrice < 100) {
      precision = 4;
      minMove = 0.0001;
    }
    
    candleSeriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove,
      },
    });

    const assetChanged = prevAssetRef.current !== selectedAsset;
    const timeframeChanged = prevTimeframeRef.current !== selectedTimeframe;
    const isInitialLoad = initialLoadRef.current;
    
    // Always fit content and scroll to latest
    if (isInitialLoad || assetChanged || timeframeChanged || sortedCandles.length > 1) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (chartRef.current) {
            chartRef.current.timeScale().fitContent();
            chartRef.current.timeScale().scrollToRealTime();
          }
        });
      });
      initialLoadRef.current = false;
      prevAssetRef.current = selectedAsset;
      prevTimeframeRef.current = selectedTimeframe;
    }
  }, [sortedCandles, selectedAsset, selectedTimeframe, chartReady]);

  // Update last candle with live price
  const updateLivePrice = useCallback(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || sortedCandles.length === 0 || !currentPrice || currentPrice <= 0) return;

    const lastCandle = sortedCandles[sortedCandles.length - 1];
    
    // Validate price is within reasonable range (within 20% of last close)
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
      color: currentPrice >= lastCandle.open ? 'rgba(14, 203, 129, 0.4)' : 'rgba(246, 70, 93, 0.4)',
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

  // Compact header for mobile - just timeframes
  const headerPadding = compact ? 'px-2 py-1' : 'px-3 md:px-4 py-2 md:py-3';
  const headerHeight = compact ? 'pt-[28px]' : 'pt-[76px] md:pt-14';

  return (
    <div 
      className="relative h-full w-full bg-[#0d0f11] rounded-lg border border-[#1e2126] overflow-hidden"
      onDoubleClick={handleDoubleClick}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-[#0d0f11]/95 backdrop-blur-sm border-b border-[#1e2126]">
        {compact ? (
          /* Compact: just timeframe buttons, minimal */
          <div className="px-2 py-1 flex items-center gap-1">
            <ChartControls
              selectedTimeframe={selectedTimeframe}
              onTimeframeChange={onTimeframeChange}
              selectedAsset={selectedAsset}
              onAssetChange={onAssetChange}
              isLoading={isLoading}
              showAssetSelector={showAssetSelector}
              compact
            />
          </div>
        ) : (
          <>
            <div className={`flex items-center justify-between ${headerPadding}`}>
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-base md:text-lg font-semibold font-mono">
                  {selectedAsset}-PERP
                </h2>
                {displayPrice > 0 && (
                  <span className={`text-lg md:text-xl font-mono font-bold tabular-nums ${priceColor}`}>
                    ${formatPriceForAsset(displayPrice)}
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
          </>
        )}
      </div>

      {/* Chart container */}
      <div 
        ref={containerRef} 
        className={`h-full w-full ${headerHeight} touch-manipulation`}
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      />

      {/* Loading overlay */}
      {(isLoading || !chartReady) && sortedCandles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0d0f11]/80 backdrop-blur-sm z-20">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <span className="text-sm text-text-muted">Loading chart...</span>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {hoveredCandle && !compact && (
        <CandleTooltip
          candle={hoveredCandle}
          position={tooltipPosition}
          containerWidth={containerWidth}
          isMobile={isMobile}
        />
      )}

      {/* Mobile helper text */}
      {isMobile && showHelperText && sortedCandles.length > 0 && !isLoading && !compact && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-text-muted/70 pointer-events-none bg-[#0d0f11]/80 px-3 py-1 rounded-full backdrop-blur-sm">
          Pinch to zoom • Double-tap to reset
        </div>
      )}
    </div>
  );
}
