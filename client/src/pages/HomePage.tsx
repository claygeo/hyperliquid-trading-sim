import { Link } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';

export function HomePage() {
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="h-[100dvh] bg-black text-white overflow-hidden flex flex-col">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(0,212,255,0.12),transparent)]" />
      </div>

      {/* Header - only show auth buttons when not logged in */}
      {!isAuthenticated && (
        <header className="relative z-10 py-3 px-4 md:px-6 flex justify-end">
          <nav className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                Login
              </Button>
            </Link>
            <Link to="/register">
              <Button variant="primary" size="sm">Sign Up</Button>
            </Link>
          </nav>
        </header>
      )}

      {/* Main Content - centered vertically */}
      <main className={`relative z-10 flex-1 flex flex-col items-center justify-center px-4 md:px-8 ${isAuthenticated ? '' : '-mt-8'}`}>
        <div className="text-center max-w-2xl mx-auto">
          {/* Hero Text */}
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold font-mono mb-4 leading-tight tracking-tight">
            Paper Trade
            <br />
            <span className="text-accent-cyan">Perpetuals</span>
          </h1>

          <p className="text-base sm:text-lg text-gray-400 mb-8 max-w-md mx-auto">
            Practice trading with $100K virtual USDC. Real-time prices. Zero risk.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            <Link to="/trade">
              <Button size="lg" className="px-10 py-3 text-base font-semibold">
                Start Trading
              </Button>
            </Link>
            <Link to="/leaderboard">
              <Button variant="secondary" size="lg" className="px-10 py-3 text-base">
                Leaderboard
              </Button>
            </Link>
          </div>

          {/* Stats Row */}
          <div className="flex items-center justify-center gap-4 sm:gap-8 md:gap-12">
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold font-mono text-accent-cyan">$100K</div>
              <div className="text-xs text-gray-500 mt-1">Starting Balance</div>
            </div>
            <div className="w-px h-10 bg-gray-800" />
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold font-mono text-accent-green">100+</div>
              <div className="text-xs text-gray-500 mt-1">Trading Pairs</div>
            </div>
            <div className="w-px h-10 bg-gray-800" />
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold font-mono text-accent-cyan">50x</div>
              <div className="text-xs text-gray-500 mt-1">Max Leverage</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center">
        <span className="text-gray-600 text-xs">Powered by Hyperliquid</span>
      </footer>
    </div>
  );
}