import { useEffect, useRef, useState } from 'react';
import { createChart, type IChartApi, type ISeriesApi, type CandlestickData, type Time } from 'lightweight-charts';
import { ChartControls } from './ChartControls';
import { CandleTooltip } from './CandleTooltip';
import { chartConfig } from './chartConfig';
import type { Candle } from '../../types/market';
import { Spinner } from '../ui/Spinner';

interface PriceChartProps {
  candles: Candle[];
  selectedAsset: string;
  selectedTimeframe: string;
  onTimeframeChange: (timeframe: string) => void;
  isLoading?: boolean;
  currentPrice?: number;
}

export function PriceChart({
  candles,
  selectedAsset,
  selectedTimeframe,
  onTimeframeChange,
  isLoading,
  currentPrice,
}: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  
  // Track previous asset/timeframe to know when to fit content
  const prevAssetRef = useRef<string>(selectedAsset);
  const prevTimeframeRef = useRef<string>(selectedTimeframe);
  const initialLoadRef = useRef<boolean>(true);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...chartConfig,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addCandlestickSeries({
      upColor: '#00ff88',
      downColor: '#ff3366',
      borderUpColor: '#00ff88',
      borderDownColor: '#ff3366',
      wickUpColor: '#00ff88',
      wickDownColor: '#ff3366',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    // Handle crosshair move for tooltip
    chart.subscribeCrosshairMove((param) => {
      if (param.point && param.time && seriesRef.current) {
        const data = param.seriesData.get(seriesRef.current) as CandlestickData;
        if (data) {
          setHoveredCandle({
            time: (data.time as number) * 1000, // Convert back to ms for display
            open: data.open,
            high: data.high,
            low: data.low,
            close: data.close,
            volume: 0,
          });
          setTooltipPosition({ x: param.point.x, y: param.point.y });
        }
      } else {
        setHoveredCandle(null);
      }
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update data - only fitContent on initial load or asset/timeframe change
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;

    // Sort candles by time ascending (required by lightweight-charts)
    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
    
    const chartData: CandlestickData[] = sortedCandles.map((c) => ({
      time: (c.time / 1000) as Time, // Convert to seconds for lightweight-charts
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
      chartRef.current?.timeScale().fitContent();
      initialLoadRef.current = false;
      prevAssetRef.current = selectedAsset;
      prevTimeframeRef.current = selectedTimeframe;
    }
  }, [candles, selectedAsset, selectedTimeframe]);

  // Update last candle with live price - but only if price is reasonable
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0 || !currentPrice || currentPrice <= 0) return;

    const sortedCandles = [...candles].sort((a, b) => a.time - b.time);
    const lastCandle = sortedCandles[sortedCandles.length - 1];
    
    // Only update if current price is within 20% of the candle's close
    // This prevents wild jumps when candle data is stale
    const priceDiff = Math.abs(currentPrice - lastCandle.close) / lastCandle.close;
    if (priceDiff > 0.2) {
      // Price is too different - candle data might be stale, don't update
      return;
    }
    
    // Update last candle with live price
    seriesRef.current.update({
      time: (lastCandle.time / 1000) as Time,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, currentPrice),
      low: Math.min(lastCandle.low, currentPrice),
      close: currentPrice,
    });
  }, [currentPrice]); // Only depend on currentPrice, not candles

  // Display price - prefer currentPrice, fallback to last candle
  const displayPrice = currentPrice && currentPrice > 0 
    ? currentPrice 
    : (candles.length > 0 ? candles[candles.length - 1]?.close : 0);

  const priceColor = candles.length > 0 
    ? (displayPrice >= candles[candles.length - 1]?.open ? 'text-accent-green' : 'text-accent-red')
    : 'text-text-primary';

  return (
    <div className="relative h-full w-full bg-bg-secondary rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-bg-secondary/90 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold font-display">{selectedAsset}/USD</h2>
          {displayPrice > 0 && (
            <div className="flex items-center gap-2">
              <span className={`text-xl font-mono font-bold ${priceColor}`}>
                ${displayPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
        <ChartControls
          selectedTimeframe={selectedTimeframe}
          onTimeframeChange={onTimeframeChange}
        />
      </div>

      {/* Chart container */}
      <div ref={containerRef} className="h-full w-full pt-14" />

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/80 backdrop-blur-sm">
          <Spinner size="lg" />
        </div>
      )}

      {/* Tooltip */}
      {hoveredCandle && (
        <CandleTooltip
          candle={hoveredCandle}
          position={tooltipPosition}
        />
      )}
    </div>
  );
}
