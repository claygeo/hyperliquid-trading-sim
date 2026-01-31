import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  
  const tabs = [
    { id: 'trade', path: '/', label: 'Trade' },
    { id: 'leaderboard', path: '/leaderboard', label: 'Leaderboard' },
    { id: 'profile', path: '/profile', label: 'Profile' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0d0f11] border-t border-[#1e2126] z-40 safe-area-bottom">
      <div className="flex items-center justify-around h-12">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigate(tab.path)}
            className={cn(
              'py-3 px-6 text-sm font-medium touch-manipulation transition-colors',
              isActive(tab.path) ? 'text-[#3dd9a4]' : 'text-gray-500'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
