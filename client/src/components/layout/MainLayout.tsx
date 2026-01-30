import { type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { WebSocketProvider } from '../../context/WebSocketContext';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation();
  const isTradePage = location.pathname === '/' || location.pathname === '/trade';

  return (
    <WebSocketProvider>
      <div className="min-h-[100dvh] bg-bg-primary text-text-primary">
        {/* Background pattern - subtle */}
        <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,212,255,0.03),transparent_50%)] pointer-events-none" />

        {/* Content */}
        <div className="relative z-10">
          {/* Hide header on mobile trade page for more space */}
          <div className={isTradePage ? 'hidden md:block' : ''}>
            <Header />
          </div>
          
          <main className={
            isTradePage 
              ? 'h-[100dvh] md:h-[calc(100dvh-48px)]' 
              : 'min-h-[calc(100dvh-48px)] pb-16 md:pb-0'
          }>
            {children}
          </main>
        </div>

        {/* Hide mobile nav on trade page */}
        {!isTradePage && <MobileNav />}
      </div>
    </WebSocketProvider>
  );
}
