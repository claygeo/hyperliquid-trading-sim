import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { WebSocketProvider } from '../../context/WebSocketContext';
import { MobileNav } from '../ui/MobileNav';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();
  const isTradePage = location.pathname === '/' || location.pathname === '/trade';

  return (
    <WebSocketProvider>
      <div className="min-h-[100dvh] bg-[#0d0f11] text-white">
        {/* Content */}
        <div className="relative z-10">
          {/* Only show header on desktop */}
          <div className="hidden md:block">
            <Header />
          </div>
          
          <main className={
            isTradePage 
              ? 'h-[100dvh] md:h-[calc(100dvh-48px)]' 
              : 'min-h-[calc(100dvh-48px)] md:pb-0'
          }>
            {children}
          </main>
        </div>

        {/* Mobile nav on all pages except trade (trade has its own) */}
        {!isTradePage && <MobileNav />}
      </div>
    </WebSocketProvider>
  );
}
