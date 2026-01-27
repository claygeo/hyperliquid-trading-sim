import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatPrice(price: number, decimals = 2): string {
  if (price >= 1000) {
    return price.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return price.toFixed(decimals);
}

export function formatUSD(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatPercent(value: number, showSign = true): string {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatSize(size: number, decimals = 4): string {
  if (size < 0.0001) {
    return size.toExponential(2);
  }
  return size.toFixed(decimals);
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function calculatePnl(
  entryPrice: number,
  currentPrice: number,
  size: number,
  side: 'long' | 'short'
): number {
  const priceDiff =
    side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
  return priceDiff * size;
}

export function calculatePnlPercent(
  entryPrice: number,
  currentPrice: number,
  side: 'long' | 'short',
  leverage: number
): number {
  const priceDiff =
    side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
  const basePercent = (priceDiff / entryPrice) * 100;
  return basePercent * leverage;
}

export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'long' | 'short',
  maintenanceMargin = 0.05
): number {
  const liquidationPercent = (1 - maintenanceMargin) / leverage;
  if (side === 'long') {
    return entryPrice * (1 - liquidationPercent);
  }
  return entryPrice * (1 + liquidationPercent);
}

export function calculateMargin(
  size: number,
  price: number,
  leverage: number
): number {
  return (size * price) / leverage;
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
