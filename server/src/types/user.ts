export interface User {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

export interface Profile {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  updatedAt: string;
}

export interface UserStats {
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  maxDrawdown: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  bestTrade: number;
  worstTrade: number;
  averageTrade: number;
  averageWin: number;
  averageLoss: number;
  profitFactor: number;
}
