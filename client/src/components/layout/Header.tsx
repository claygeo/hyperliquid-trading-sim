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
      <header className="h-16 bg-bg-secondary/80 backdrop-blur-md border-b border-border sticky top-0 z-40">
        <div className="h-full max-w-[1920px] mx-auto px-4 flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 md:gap-3 group">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-accent-cyan to-accent-purple rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform duration-200">
              <span className="text-lg md:text-xl font-bold text-bg-primary font-display">H</span>
            </div>
            <span className="text-lg md:text-xl font-bold font-display tracking-wider">
              <span className="text-accent-cyan">HYPER</span>
              <span className="text-text-primary">SIM</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              to="/trade"
              className="text-text-secondary hover:text-text-primary transition-colors duration-200 font-medium"
            >
              Trade
            </Link>
            <Link
              to="/leaderboard"
              className="text-text-secondary hover:text-text-primary transition-colors duration-200 font-medium"
            >
              Leaderboard
            </Link>
          </nav>

          {/* Account section */}
          <div className="flex items-center gap-2 md:gap-4">
            {isAuthenticated ? (
              <>
                {/* Balance - hidden on mobile */}
                {account && (
                  <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-bg-tertiary rounded-lg border border-border">
                    <span className="text-text-muted text-sm">Balance:</span>
                    <span className="text-text-primary font-mono font-semibold">
                      <AnimatedNumber
                        value={account.balance}
                        format={formatUSD}
                        duration={300}
                      />
                    </span>
                  </div>
                )}

                {/* Mobile: Compact balance */}
                {account && (
                  <div className="flex lg:hidden items-center px-2 py-1 bg-bg-tertiary rounded-lg border border-border">
                    <span className="text-text-primary font-mono text-sm font-semibold">
                      {formatUSD(account.balance)}
                    </span>
                  </div>
                )}

                {/* Desktop user menu */}
                <div className="hidden md:flex items-center gap-3">
                  <Link
                    to="/profile"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg-tertiary transition-colors duration-200"
                  >
                    <div className="w-8 h-8 bg-accent-purple/20 rounded-full flex items-center justify-center">
                      <span className="text-accent-purple font-semibold">
                        {user?.username?.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <span className="hidden sm:block text-text-primary font-medium">
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
                  className="md:hidden p-2 text-text-primary"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="md:hidden fixed inset-x-0 top-16 z-30 bg-bg-secondary/95 backdrop-blur-md border-b border-border">
          <div className="p-4 space-y-3">
            <Link
              to="/profile"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center gap-3 p-3 rounded-lg bg-bg-tertiary"
            >
              <div className="w-10 h-10 bg-accent-purple/20 rounded-full flex items-center justify-center">
                <span className="text-accent-purple font-semibold text-lg">
                  {user?.username?.charAt(0).toUpperCase()}
                </span>
              </div>
              <div>
                <div className="text-text-primary font-medium">{user?.username}</div>
                <div className="text-text-muted text-sm">View Profile</div>
              </div>
            </Link>
            <button
              onClick={handleLogout}
              className="w-full p-3 text-left text-accent-red rounded-lg hover:bg-bg-tertiary transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      )}
    </>
  );
}