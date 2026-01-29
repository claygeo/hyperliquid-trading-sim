import { Link } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';

export function HomePage() {
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-[100dvh] bg-bg-primary text-text-primary overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-20 pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-radial from-accent-cyan/10 via-transparent to-transparent pointer-events-none" />
      <div className="fixed top-1/4 right-1/4 w-96 h-96 bg-accent-purple/20 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-1/4 left-1/4 w-96 h-96 bg-accent-cyan/20 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 py-4 md:py-6 px-4 md:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-gradient-to-br from-accent-cyan to-accent-purple rounded-xl flex items-center justify-center">
              <span className="text-xl md:text-2xl font-bold text-bg-primary font-display">H</span>
            </div>
            <span className="text-xl md:text-2xl font-bold font-display tracking-wider">
              <span className="text-accent-cyan">HYPER</span>
              <span className="text-text-primary">SIM</span>
            </span>
          </div>

          <nav className="flex items-center gap-2 md:gap-4">
            {isAuthenticated ? (
              <Link to="/trade">
                <Button variant="primary" size="sm" className="md:text-base">Go to Trading</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm" className="md:text-base">Login</Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm" className="md:text-base">Get Started</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero section */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 pt-12 md:pt-20 pb-20 md:pb-32">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold font-display mb-4 md:mb-6 leading-tight">
            <span className="text-text-primary">Paper Trade</span>
            <br />
            <span className="bg-gradient-to-r from-accent-cyan via-accent-green to-accent-purple bg-clip-text text-transparent">
              Like a Pro
            </span>
          </h1>

          <p className="text-base md:text-xl text-text-secondary max-w-2xl mx-auto mb-8 md:mb-12 px-2">
            Practice crypto trading with $100,000 virtual USDC. Real-time Hyperliquid
            prices. Zero risk. Climb the leaderboard.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 md:gap-4 mb-12 md:mb-16">
            <Link to="/register">
              <Button size="lg" className="px-6 md:px-8 text-sm md:text-base">
                Start Trading Free
              </Button>
            </Link>
            <Link to="/leaderboard">
              <Button variant="secondary" size="lg" className="px-6 md:px-8 text-sm md:text-base">
                View Leaderboard
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 md:gap-8 max-w-3xl mx-auto">
            <div className="p-3 md:p-6 bg-bg-secondary/50 backdrop-blur border border-border rounded-2xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-cyan mb-1 md:mb-2">$100K</div>
              <div className="text-xs md:text-base text-text-muted">Starting Balance</div>
            </div>
            <div className="p-3 md:p-6 bg-bg-secondary/50 backdrop-blur border border-border rounded-2xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-green mb-1 md:mb-2">3</div>
              <div className="text-xs md:text-base text-text-muted">Trading Pairs</div>
            </div>
            <div className="p-3 md:p-6 bg-bg-secondary/50 backdrop-blur border border-border rounded-2xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-purple mb-1 md:mb-2">50x</div>
              <div className="text-xs md:text-base text-text-muted">Max Leverage</div>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-16 md:mt-32 grid md:grid-cols-3 gap-4 md:gap-8">
          <div className="p-6 md:p-8 bg-bg-secondary border border-border rounded-2xl hover:border-accent-cyan/50 transition-colors">
            <div className="text-3xl md:text-4xl mb-3 md:mb-4">📈</div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 md:mb-3">Real-Time Data</h3>
            <p className="text-sm md:text-base text-text-secondary">
              Live prices, orderbooks, and trades from Hyperliquid. Professional
              TradingView charts with all timeframes.
            </p>
          </div>

          <div className="p-6 md:p-8 bg-bg-secondary border border-border rounded-2xl hover:border-accent-green/50 transition-colors">
            <div className="text-3xl md:text-4xl mb-3 md:mb-4">🏆</div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 md:mb-3">Compete Globally</h3>
            <p className="text-sm md:text-base text-text-secondary">
              Track your PnL, win rate, and max drawdown. Climb the leaderboard and
              prove your trading skills.
            </p>
          </div>

          <div className="p-6 md:p-8 bg-bg-secondary border border-border rounded-2xl hover:border-accent-purple/50 transition-colors">
            <div className="text-3xl md:text-4xl mb-3 md:mb-4">⚡</div>
            <h3 className="text-lg md:text-xl font-semibold mb-2 md:mb-3">Stress Tested</h3>
            <p className="text-sm md:text-base text-text-secondary">
              Run stress tests with 500+ TPS to see the platform handle extreme
              market conditions in real-time.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 md:mt-32 text-center p-6 md:p-12 bg-gradient-to-r from-accent-cyan/10 via-accent-purple/10 to-accent-green/10 rounded-3xl border border-border">
          <h2 className="text-2xl md:text-3xl font-bold font-display mb-3 md:mb-4">Ready to Trade?</h2>
          <p className="text-sm md:text-base text-text-secondary mb-6 md:mb-8">
            Create a free account and start paper trading in seconds.
          </p>
          <Link to="/register">
            <Button size="lg" className="px-12">
              Create Free Account
            </Button>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border py-6 md:py-8 px-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2 text-text-muted text-xs md:text-sm text-center md:text-left">
          <span>© 2024 HyperSim. Paper trading simulator.</span>
          <span>Powered by Hyperliquid</span>
        </div>
      </footer>
    </div>
  );
}