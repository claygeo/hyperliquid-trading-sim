import type { OrderbookLevel } from '../../types/market';

export function getMaxTotal(bids: OrderbookLevel[], asks: OrderbookLevel[]): number {
  const maxBid = bids.length > 0 ? bids[bids.length - 1].total : 0;
  const maxAsk = asks.length > 0 ? asks[asks.length - 1].total : 0;
  return Math.max(maxBid, maxAsk);
}

export function calculateDepth(
  levels: OrderbookLevel[]
): { totalSize: number; totalValue: number } {
  return levels.reduce(
    (acc, level) => ({
      totalSize: acc.totalSize + level.size,
      totalValue: acc.totalValue + level.price * level.size,
    }),
    { totalSize: 0, totalValue: 0 }
  );
}

export function groupOrderbook(
  levels: OrderbookLevel[],
  tickSize: number
): OrderbookLevel[] {
  const grouped = new Map<number, number>();

  levels.forEach((level) => {
    const groupedPrice = Math.floor(level.price / tickSize) * tickSize;
    const current = grouped.get(groupedPrice) || 0;
    grouped.set(groupedPrice, current + level.size);
  });

  let total = 0;
  return Array.from(grouped.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([price, size]) => {
      total += size;
      return { price, size, total };
    });
}
