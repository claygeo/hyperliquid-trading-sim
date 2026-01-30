import { Link } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';

export function HomePage() {
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-[100dvh] bg-black text-white overflow-hidden">
      {/* Minimal background */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-gray-900 via-black to-black pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 py-4 md:py-6 px-4 md:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-accent-cyan to-accent-green rounded-lg flex items-center justify-center">
              <span className="text-base md:text-lg font-bold text-black font-mono">T</span>
            </div>
          </Link>

          <nav className="flex items-center gap-2 md:gap-4">
            {isAuthenticated ? (
              <Link to="/trade">
                <Button variant="primary" size="sm">Trade</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">Login</Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">Get Started</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 md:px-8 pt-16 md:pt-28 pb-20">
        <div className="text-center">
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold font-mono mb-6 leading-tight tracking-tight">
            Paper Trade
            <br />
            <span className="text-accent-cyan">Perpetuals</span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-xl mx-auto mb-10">
            Practice trading with $100K virtual USDC. Real-time prices. Zero risk.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
            <Link to="/trade">
              <Button size="lg" className="px-8 text-base">
                Start Trading
              </Button>
            </Link>
            <Link to="/leaderboard">
              <Button variant="secondary" size="lg" className="px-8 text-base">
                Leaderboard
              </Button>
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 md:gap-8 max-w-2xl mx-auto">
            <div className="p-4 md:p-6 bg-gray-900/50 border border-gray-800 rounded-xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-cyan mb-1">$100K</div>
              <div className="text-xs md:text-sm text-gray-500">Starting Balance</div>
            </div>
            <div className="p-4 md:p-6 bg-gray-900/50 border border-gray-800 rounded-xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-green mb-1">100+</div>
              <div className="text-xs md:text-sm text-gray-500">Trading Pairs</div>
            </div>
            <div className="p-4 md:p-6 bg-gray-900/50 border border-gray-800 rounded-xl">
              <div className="text-2xl md:text-4xl font-bold font-mono text-accent-purple mb-1">50x</div>
              <div className="text-xs md:text-sm text-gray-500">Max Leverage</div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-20 md:mt-32 text-center p-8 md:p-12 bg-gradient-to-b from-gray-900/50 to-transparent rounded-2xl border border-gray-800">
          <h2 className="text-2xl md:text-3xl font-bold font-mono mb-4">Ready to Trade?</h2>
          <p className="text-gray-400 mb-6">
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
      <footer className="relative z-10 border-t border-gray-800 py-6 px-4 md:px-8">
        <div className="max-w-7xl mx-auto text-center text-gray-600 text-sm">
          Powered by Hyperliquid
        </div>
      </footer>
    </div>
  );
}
