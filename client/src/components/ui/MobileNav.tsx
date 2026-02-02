import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';

interface MobileNavProps {
  activeTab?: 'markets' | 'trade' | 'account';
  onTabChange?: (tab: 'markets' | 'trade') => void;
}

export function MobileNav({ activeTab = 'markets', onTabChange }: MobileNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const isProfile = location.pathname === '/profile';
  const isTradingPage = location.pathname === '/' || location.pathname === '/trade';
  
  const handleTabClick = (tab: 'markets' | 'trade' | 'account') => {
    if (tab === 'account') {
      navigate('/profile');
    } else if (tab === 'markets' || tab === 'trade') {
      // If we have onTabChange (on TradingPage), use it
      // Otherwise navigate to home with state
      if (onTabChange && isTradingPage) {
        onTabChange(tab);
      } else {
        // Navigate to trading page with the selected tab as state
        navigate('/', { state: { activeTab: tab } });
      }
    }
  };

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0d0f11] border-t border-[#1e2126] z-40 safe-area-bottom">
      <div className="flex items-center justify-around h-12">
        <button
          onClick={() => handleTabClick('markets')}
          className={cn(
            'flex-1 h-full flex items-center justify-center text-sm font-medium transition-colors',
            !isProfile && activeTab === 'markets' ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          Markets
        </button>

        <button
          onClick={() => handleTabClick('trade')}
          className={cn(
            'flex-1 h-full flex items-center justify-center text-sm font-medium transition-colors',
            !isProfile && activeTab === 'trade' ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          Trade
        </button>

        <button
          onClick={() => handleTabClick('account')}
          className={cn(
            'flex-1 h-full flex items-center justify-center text-sm font-medium transition-colors',
            isProfile ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          Account
        </button>
      </div>
    </div>
  );
}
