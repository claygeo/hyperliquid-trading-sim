import type { Trade } from '../../types/market';

export function groupTradesByPrice(trades: Trade[]): Map<number, { totalSize: number; count: number; side: 'buy' | 'sell' }> {
  const grouped = new Map<number, { totalSize: number; count: number; side: 'buy' | 'sell' }>();

  trades.forEach((trade) => {
    const existing = grouped.get(trade.price);
    if (existing) {
      existing.totalSize += trade.size;
      existing.count += 1;
    } else {
      grouped.set(trade.price, {
        totalSize: trade.size,
        count: 1,
        side: trade.side,
      });
    }
  });

  return grouped;
}

export function calculateVWAP(trades: Trade[]): number {
  if (trades.length === 0) return 0;

  let totalValue = 0;
  let totalVolume = 0;

  trades.forEach((trade) => {
    totalValue += trade.price * trade.size;
    totalVolume += trade.size;
  });

  return totalVolume > 0 ? totalValue / totalVolume : 0;
}

export function calculateBuySellRatio(trades: Trade[]): { buyPercent: number; sellPercent: number } {
  if (trades.length === 0) return { buyPercent: 50, sellPercent: 50 };

  let buyVolume = 0;
  let sellVolume = 0;

  trades.forEach((trade) => {
    if (trade.side === 'buy') {
      buyVolume += trade.size;
    } else {
      sellVolume += trade.size;
    }
  });

  const total = buyVolume + sellVolume;
  if (total === 0) return { buyPercent: 50, sellPercent: 50 };

  return {
    buyPercent: (buyVolume / total) * 100,
    sellPercent: (sellVolume / total) * 100,
  };
}
