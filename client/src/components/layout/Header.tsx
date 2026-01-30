import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../hooks/useAuth';
import { useAccountStore } from '../../hooks/useAccount';
import { Button } from '../ui/Button';
import { AnimatedNumber } from '../ui/AnimatedNumber';
import { formatUSD } from '../../lib/utils';
import { cn } from '../../lib/utils';

export function Header() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const { account } = useAccountStore();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
    navigate('/');
  };

  return (
    <>
      <header className="h-14 bg-black/90 backdrop-blur-md border-b border-gray-800 sticky top-0 z-40">
        <div className="h-full max-w-[1920px] mx-auto px-4 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 bg-gradient-to-br from-accent-cyan to-accent-green rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
              <span className="text-base font-bold text-black font-mono">T</span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              to="/trade"
              className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
            >
              Trade
            </Link>
            <Link
              to="/leaderboard"
              className="text-gray-400 hover:text-white transition-colors text-sm font-medium"
            >
              Leaderboard
            </Link>
          </nav>

          {/* Account section */}
          <div className="flex items-center gap-2 md:gap-4">
            {isAuthenticated ? (
              <>
                {/* Balance */}
                {account && (
                  <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-gray-900 rounded-lg border border-gray-800">
                    <span className="text-gray-500 text-xs">Balance:</span>
                    <span className="text-white font-mono text-sm font-medium">
                      <AnimatedNumber
                        value={account.balance}
                        format={formatUSD}
                        duration={300}
                      />
                    </span>
                  </div>
                )}

                {/* Mobile balance */}
                {account && (
                  <div className="flex lg:hidden items-center px-2 py-1 bg-gray-900 rounded border border-gray-800">
                    <span className="text-white font-mono text-sm">
                      {formatUSD(account.balance)}
                    </span>
                  </div>
                )}

                {/* Desktop user menu */}
                <div className="hidden md:flex items-center gap-3">
                  <Link
                    to="/profile"
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-900 transition-colors"
                  >
                    <div className="w-7 h-7 bg-accent-cyan/20 rounded-full flex items-center justify-center">
                      <span className="text-accent-cyan text-sm font-medium">
                        {user?.username?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-gray-300 text-sm">
                      {user?.username}
                    </span>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={handleLogout}>
                    Logout
                  </Button>
                </div>

                {/* Mobile hamburger */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden p-2 text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {mobileMenuOpen ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    )}
                  </svg>
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm">Login</Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">Sign Up</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && isAuthenticated && (
        <div className="md:hidden fixed inset-x-0 top-14 z-30 bg-black/95 backdrop-blur-md border-b border-gray-800">
          <div className="p-4 space-y-3">
            <Link
              to="/trade"
              onClick={() => setMobileMenuOpen(false)}
              className="block p-3 text-gray-300 hover:text-white rounded-lg hover:bg-gray-900"
            >
              Trade
            </Link>
            <Link
              to="/leaderboard"
              onClick={() => setMobileMenuOpen(false)}
              className="block p-3 text-gray-300 hover:text-white rounded-lg hover:bg-gray-900"
            >
              Leaderboard
            </Link>
            <Link
              to="/profile"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-900"
            >
              <div className="w-10 h-10 bg-accent-cyan/20 rounded-full flex items-center justify-center">
                <span className="text-accent-cyan font-medium text-lg">
                  {user?.username?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="text-white font-medium">{user?.username}</div>
                <div className="text-gray-500 text-sm">View Profile</div>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="w-full p-3 text-left text-red-400 rounded-lg hover:bg-gray-900 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </>
  );
}
