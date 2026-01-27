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

export function calculateNotionalValue(size: number, price: number): number {
  return size * price;
}

export function roundToDecimals(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
