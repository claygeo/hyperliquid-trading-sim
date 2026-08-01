function parseTrustProxyHops(value: string | undefined): number {
  if (value === undefined || value === '') return 0;
  if (!/^\d+$/.test(value)) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5');
  }

  const hops = Number(value);
  if (hops < 0 || hops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer between 0 and 5');
  }
  return hops;
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxyHops: parseTrustProxyHops(process.env.TRUST_PROXY_HOPS),

  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },

  // Position tracker's Supabase (separate project, read-only bridge)
  tracker: {
    supabaseUrl: process.env.TRACKER_SUPABASE_URL || '',
    supabaseKey: process.env.TRACKER_SUPABASE_KEY || '',
    enabled: !!process.env.TRACKER_SUPABASE_URL,
  },

  hyperliquid: {
    apiUrl: process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz',
    wsUrl: process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws',
  },
} as const;
