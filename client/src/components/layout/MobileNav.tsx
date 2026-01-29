import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

const navItems = [
  { path: '/trade', label: 'Trade' },
  { path: '/leaderboard', label: 'Leaderboard' },
  { path: '/profile', label: 'Profile' },
];

export function MobileNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-bg-secondary/95 backdrop-blur-md border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'flex flex-col items-center justify-center flex-1 h-full transition-colors',
              location.pathname === item.path
                ? 'text-accent-cyan'
                : 'text-text-muted'
            )}
          >
            <span className="text-xs font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}