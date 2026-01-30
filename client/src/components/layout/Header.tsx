import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
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
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    setMobileMenuOpen(false);
    navigate('/');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <header className="h-12 bg-black/95 backdrop-blur-md border-b border-gray-800/50 sticky top-0 z-40">
        <div className="h-full max-w-[1920px] mx-auto px-3 md:px-4 flex items-center justify-between">
          {/* Left: Navigation */}
          <nav className="flex items-center gap-1">
            <Link
              to="/trade"
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                isActive('/trade') 
                  ? 'text-white bg-gray-800/80' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              )}
            >
              Trade
            </Link>
            <Link
              to="/leaderboard"
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                isActive('/leaderboard') 
                  ? 'text-white bg-gray-800/80' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              )}
            >
              Leaderboard
            </Link>
          </nav>

          {/* Right: Account section */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <>
                {/* Balance */}
                {account && (
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-gray-900/80 rounded-lg border border-gray-800/50">
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
                  <div className="flex sm:hidden items-center px-2 py-1 bg-gray-900/80 rounded border border-gray-800/50">
                    <span className="text-white font-mono text-xs">
                      {formatUSD(account.balance)}
                    </span>
                  </div>
                )}

                {/* Desktop user menu */}
                <div className="hidden md:flex items-center gap-2">
                  <Link
                    to="/profile"
                    className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="w-6 h-6 bg-accent-cyan/20 rounded-full flex items-center justify-center">
                      <span className="text-accent-cyan text-xs font-medium">
                        {user?.username?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="text-gray-300 text-sm">
                      {user?.username}
                    </span>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={handleLogout} className="text-gray-400 hover:text-white">
                    Logout
                  </Button>
                </div>

                {/* Mobile hamburger */}
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="md:hidden p-2 text-gray-400 hover:text-white"
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
                  <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
                    Login
                  </Button>
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
        <div className="md:hidden fixed inset-x-0 top-12 z-30 bg-black/98 backdrop-blur-md border-b border-gray-800">
          <div className="p-3 space-y-2">
            <Link
              to="/profile"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-900/50"
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
              className="w-full p-3 text-left text-red-400 rounded-lg hover:bg-gray-900/50 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </>
  );
}