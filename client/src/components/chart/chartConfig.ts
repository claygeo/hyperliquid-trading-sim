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

// Base chart configuration - Hyperliquid-style dark theme
export const chartConfig: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d0f11' },
    textColor: '#848e9c',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: 'rgba(42, 46, 57, 0.3)' },
    horzLines: { color: 'rgba(42, 46, 57, 0.3)' },
  },
  crosshair: {
    mode: 1,
    vertLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#1e2126',
      labelVisible: true,
    },
    horzLine: {
      color: '#758696',
      width: 1,
      style: 2,
      labelBackgroundColor: '#1e2126',
      labelVisible: true,
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(42, 46, 57, 0.5)',
    scaleMargins: {
      top: 0.1,
      bottom: 0.2,
    },
    autoScale: true,
    alignLabels: true,
    borderVisible: false,
    entireTextOnly: true,
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
    borderVisible: false,
    visible: true,
    ticksVisible: true,
    tickMarkFormatter: (time: number) => {
      const date = new Date(time * 1000);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    },
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
  localization: {
    priceFormatter: (price: number) => {
      if (price >= 1000) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (price >= 1) {
        return price.toFixed(4);
      } else if (price >= 0.0001) {
        return price.toFixed(6);
      } else {
        return price.toFixed(8);
      }
    },
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
      bottom: 0.15,
    },
    autoScale: true,
    alignLabels: true,
    borderVisible: false,
    entireTextOnly: true,
  },
  timeScale: {
    ...chartConfig.timeScale,
    barSpacing: 6,
    minBarSpacing: 0.5,
    rightOffset: 3,
    visible: true,
    borderVisible: false,
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

// Candlestick series configuration - Hyperliquid colors
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
