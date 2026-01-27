import { type ReactNode } from 'react';
import { Header } from './Header';
import { WebSocketProvider } from '../../context/WebSocketContext';

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <WebSocketProvider>
      <div className="min-h-screen bg-bg-primary text-text-primary">
        {/* Background pattern */}
        <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />
        
        {/* Gradient overlay */}
        <div className="fixed inset-0 bg-gradient-radial from-accent-cyan/5 via-transparent to-transparent pointer-events-none" />

        {/* Content */}
        <div className="relative z-10">
          <Header />
          <main className="h-[calc(100vh-64px)]">
            {children}
          </main>
        </div>
      </div>
    </WebSocketProvider>
  );
}
