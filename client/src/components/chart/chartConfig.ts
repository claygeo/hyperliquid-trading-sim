import { type ChartOptions, type DeepPartial, ColorType } from 'lightweight-charts';

// Get minimum bar spacing based on timeframe - lower values allow more zoom out
export function getMinBarSpacing(timeframe: string): number {
  switch (timeframe) {
    case '1m':
      return 1;
    case '5m':
      return 1;
    case '15m':
      return 1;
    case '1h':
      return 2;
    case '4h':
      return 2;
    case '1d':
      return 3;
    default:
      return 1;
  }
}

// Base chart configuration
export const chartConfig: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#a0a0b0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(42, 42, 58, 0.5)' },
    horzLines: { color: 'rgba(42, 42, 58, 0.5)' },
  },
  crosshair: {
    mode: 1,
    vertLine: {
      color: '#00d4ff',
      width: 1,
      style: 2,
      labelBackgroundColor: '#00d4ff',
      labelVisible: true,
    },
    horzLine: {
      color: '#00d4ff',
      width: 1,
      style: 2,
      labelBackgroundColor: '#00d4ff',
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(42, 42, 58, 0.5)',
    scaleMargins: {
      top: 0.1,
      bottom: 0.1,
    },
    autoScale: true,
    alignLabels: true,
  },
  timeScale: {
    borderColor: 'rgba(42, 42, 58, 0.5)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 5,
    barSpacing: 8,
    minBarSpacing: 1, // Allow zooming out further
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
    borderVisible: true,
    visible: true,
    ticksVisible: true,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
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
  kineticScroll: {
    touch: true,
    mouse: true,
  },
};

// Mobile-specific overrides
export const mobileChartConfig: DeepPartial<ChartOptions> = {
  ...chartConfig,
  layout: {
    ...chartConfig.layout,
    fontSize: 10,
  },
  timeScale: {
    ...chartConfig.timeScale,
    barSpacing: 6,
    minBarSpacing: 0.5, // Allow even more zoom out on mobile
    rightOffset: 3,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false,
  },
  handleScale: {
    axisPressedMouseMove: {
      time: true,
      price: true, // Enable y-axis drag to zoom on mobile
    },
    axisDoubleClickReset: {
      time: true,
      price: true,
    },
    mouseWheel: true,
    pinch: true,
  },
};

// Candlestick series configuration
export const candlestickConfig = {
  upColor: '#00ff88',
  downColor: '#ff3366',
  borderUpColor: '#00ff88',
  borderDownColor: '#ff3366',
  wickUpColor: '#00ff88',
  wickDownColor: '#ff3366',
  borderVisible: true,
  wickVisible: true,
};