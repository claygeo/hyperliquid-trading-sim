jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe('Hyperliquid asset discovery', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('filters delisted markets and preserves mixed-case canonical symbols', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        universe: [
          { name: 'BTC', szDecimals: 5, maxLeverage: 50 },
          { name: 'kPEPE', szDecimals: 0, maxLeverage: 25 },
          { name: 'MATIC', szDecimals: 1, maxLeverage: 20, isDelisted: true },
        ],
      }),
    }) as any;

    const assetsModule = await import('../config/assets');
    const assets = await assetsModule.fetchAssetsFromHyperliquid();

    expect(assets.map((asset) => asset.symbol)).toEqual(['BTC', 'kPEPE']);
    expect(assetsModule.getAssetConfig('KPEPE')?.symbol).toBe('kPEPE');
    expect(assetsModule.isValidAsset('kpepe')).toBe(true);
    expect(assetsModule.isValidAsset('MATIC')).toBe(false);
    expect(assetsModule.isValidAsset('ETH')).toBe(false);
  });

  it('does not re-expose known delisted or renamed markets in fallback mode', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('upstream unavailable')) as any;

    const { fetchAssetsFromHyperliquid } = await import('../config/assets');
    const assets = await fetchAssetsFromHyperliquid();
    const symbols = assets.map((asset) => asset.symbol);

    expect(symbols).not.toEqual(expect.arrayContaining([
      'MATIC', 'FTM', 'MKR', 'MANA', 'GRT', 'SHIB', 'PEPE',
    ]));
    expect(symbols).toEqual(expect.arrayContaining(['BTC', 'ETH', 'SOL']));
  });
});
