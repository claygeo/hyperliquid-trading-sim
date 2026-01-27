export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },
  
  hyperliquid: {
    apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
    wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
  },
} as const;
