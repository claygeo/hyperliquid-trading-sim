import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

const navItems = [
  { path: '/trade', label: 'Trade', icon: '📈' },
  { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { path: '/profile', label: 'Profile', icon: '👤' },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-bg-secondary border-r border-border p-4">
      <nav className="space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-lg transition-colors',
              location.pathname === item.path
                ? 'bg-accent-cyan/10 text-accent-cyan'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            )}
          >
            <span>{item.icon}</span>
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
