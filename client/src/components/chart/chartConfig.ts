import { type ChartOptions, type DeepPartial, ColorType } from 'lightweight-charts';

export const chartConfig: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: 'transparent' },
    textColor: '#a0a0b0',
    fontFamily: "'JetBrains Mono', monospace",
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
    },
    horzLine: {
      color: '#00d4ff',
      width: 1,
      style: 2,
      labelBackgroundColor: '#00d4ff',
    },
  },
  rightPriceScale: {
    borderColor: 'rgba(42, 42, 58, 0.5)',
    scaleMargins: {
      top: 0.1,
      bottom: 0.1,
    },
  },
  timeScale: {
    borderColor: 'rgba(42, 42, 58, 0.5)',
    timeVisible: true,
    secondsVisible: false,
    tickMarkFormatter: (time: number) => {
      const date = new Date(time * 1000);
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    },
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    mouseWheel: true,
    pinch: true,
  },
};
