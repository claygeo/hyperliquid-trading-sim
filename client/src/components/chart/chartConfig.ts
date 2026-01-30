import { type ChartOptions, type DeepPartial, ColorType, type Time } from 'lightweight-charts';

// Time formatting based on timeframe
export function getTimeFormatter(timeframe: string) {
  return (time: Time) => {
    const date = new Date((time as number) * 1000);
    
    switch (timeframe) {
      case '1m':
      case '5m':
        // Show hours:minutes for short timeframes
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      case '15m':
      case '1h':
        // Show hours:minutes with date context
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        });
      case '4h':
        // Show month/day hour:minute
        return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:00`;
      case '1d':
        // Show month/day
        return `${date.getMonth() + 1}/${date.getDate()}`;
      default:
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
    }
  };
}

// Get minimum bar spacing based on timeframe
export function getMinBarSpacing(timeframe: string): number {
  switch (timeframe) {
    case '1m':
      return 2;
    case '5m':
      return 3;
    case '15m':
      return 4;
    case '1h':
      return 5;
    case '4h':
      return 6;
    case '1d':
      return 8;
    default:
      return 4;
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
    mode: 1, // Normal mode - shows crosshair
    vertLine: {
      color: '#00d4ff',
      width: 1,
      style: 2, // Dashed
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
    minBarSpacing: 4,
    fixLeftEdge: false,
    fixRightEdge: false,
    lockVisibleTimeRangeOnResize: true,
    rightBarStaysOnScroll: true,
    borderVisible: true,
    visible: true,
    ticksVisible: true,
    uniformDistribution: false,
    shiftVisibleRangeOnNewBar: true,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: false, // Disable vertical drag to prevent conflicts
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
  trackingMode: {
    exitMode: 1, // Exit on touch end
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
    minBarSpacing: 3,
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
      price: false, // Disable price axis drag on mobile
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