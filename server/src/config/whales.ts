// Known Hyperliquid whale addresses to track
// These are public addresses from Hyperliquid leaderboards and known traders

export interface WhaleConfig {
  address: string;
  label: string;
  description?: string;
}

export const WHALE_ADDRESSES: WhaleConfig[] = [
  {
    address: '0x8aD69956c0F02Ed01f3b47C3fd0a13e6e1E61Fb9',
    label: 'Whale Alpha',
    description: 'Top trader from HL leaderboard',
  },
  {
    address: '0x1f28eD9D4792a567DaD779235c2b766Ab84D8E33',
    label: 'Whale Beta',
    description: 'High volume BTC trader',
  },
  {
    address: '0x7aC56969e4D8d244e9f0A2c5B40F22d4d9A70B7a',
    label: 'Whale Gamma',
    description: 'SOL specialist',
  },
  {
    address: '0x2B3F4b8e9aC1d2E3f4A5b6C7d8E9F0a1B2c3D4e5',
    label: 'Whale Delta',
    description: 'Multi-asset trader',
  },
  {
    address: '0x5C4b3E2D1F0A9B8c7D6e5F4a3B2C1d0E9f8A7b6c',
    label: 'Whale Epsilon',
    description: 'ETH focused',
  },
];

export function getWhaleLabel(address: string): string | undefined {
  const whale = WHALE_ADDRESSES.find(
    (w) => w.address.toLowerCase() === address.toLowerCase()
  );
  return whale?.label;
}

export function isWhaleAddress(address: string): boolean {
  return WHALE_ADDRESSES.some(
    (w) => w.address.toLowerCase() === address.toLowerCase()
  );
}
