import { type ChartOptions, type DeepPartial, ColorType } from 'lightweight-charts';

export function getMinBarSpacing(timeframe: string): number {
  switch (timeframe) {
    case '1m': return 1;
    case '5m': return 1;
    case '15m': return 1;
    case '1h': return 2;
    case '4h': return 2;
    case '1d': return 3;
    default: return 1;
  }
}

// Base chart configuration - darker theme
export const chartConfig: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: '#000000' },
    textColor: '#848e9c',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
    horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
  },
  crosshair: {
    mode: 1,
    vertLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#2a2e37',
      labelVisible: true,
    },
    horzLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#2a2e37',
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(42, 46, 57, 0.5)',
    scaleMargins: {
      top: 0.1,
      bottom: 0.2, // Leave room for volume
    },
    autoScale: true,
    alignLabels: true,
  },
  timeScale: {
    borderColor: 'rgba(42, 46, 57, 0.5)',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 5,
    barSpacing: 8,
    minBarSpacing: 1,
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
  rightPriceScale: {
    borderColor: 'rgba(42, 46, 57, 0.5)',
    scaleMargins: {
      top: 0.05,
      bottom: 0.15, // Leave room for volume at bottom
    },
    autoScale: true,
    alignLabels: true,
  },
  timeScale: {
    ...chartConfig.timeScale,
    barSpacing: 6,
    minBarSpacing: 0.5,
    rightOffset: 3,
    visible: true,
    borderVisible: true,
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
};

// Candlestick series configuration - Binance colors
export const candlestickConfig = {
  upColor: '#0ecb81',
  downColor: '#f6465d',
  borderUpColor: '#0ecb81',
  borderDownColor: '#f6465d',
  wickUpColor: '#0ecb81',
  wickDownColor: '#f6465d',
  borderVisible: true,
  wickVisible: true,
};

// Volume histogram configuration
export const volumeConfig = {
  color: 'rgba(0, 212, 255, 0.3)',
  priceFormat: {
    type: 'volume' as const,
  },
  priceLineVisible: false,
  lastValueVisible: false,
};
