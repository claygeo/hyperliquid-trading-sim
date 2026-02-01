import { useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';

interface MobileNavProps {
  activeTab?: 'chart' | 'trade';
  onTabChange?: (tab: 'chart' | 'trade') => void;
}

export function MobileNav({ activeTab = 'chart', onTabChange }: MobileNavProps) {
  const location = useLocation();
  
  // Check if we're on profile page
  const isProfile = location.pathname === '/profile';
  
  const handleTabClick = (tab: 'chart' | 'trade' | 'account') => {
    if (tab === 'account') {
      window.location.href = '/profile';
    } else if (onTabChange) {
      onTabChange(tab as 'chart' | 'trade');
    }
  };

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-[#0d0f11] border-t border-[#1e2126] z-40 safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {/* Markets */}
        <button
          onClick={() => handleTabClick('chart')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full gap-0.5 touch-manipulation transition-colors',
            !isProfile && activeTab === 'chart' ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
          <span className="text-[10px] font-medium">Markets</span>
        </button>

        {/* Trade */}
        <button
          onClick={() => handleTabClick('trade')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full gap-0.5 touch-manipulation transition-colors',
            !isProfile && activeTab === 'trade' ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-[10px] font-medium">Trade</span>
        </button>

        {/* Account */}
        <button
          onClick={() => handleTabClick('account')}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full gap-0.5 touch-manipulation transition-colors',
            isProfile ? 'text-[#00d4ff]' : 'text-gray-500'
          )}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="text-[10px] font-medium">Account</span>
        </button>
      </div>
    </div>
  );
}
