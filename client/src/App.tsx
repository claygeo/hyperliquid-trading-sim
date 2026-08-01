import { Routes, Route, Navigate } from '@/lib/router';
import { useEffect } from 'react';
import { useAuthStore } from './hooks/useAuth';
import { MainLayout } from './components/layout/MainLayout';
import { AuthGuard } from './components/auth/AuthGuard';
import { TradingPage } from './pages/TradingPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

export default function App() {
  const { initialize, isAuthenticated, isLoading } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent-cyan border-t-transparent rounded-full animate-spin" />
          <p className="text-text-secondary font-mono">Initializing...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Trading page is the default - no landing page fluff */}
      <Route
        path="/"
        element={
          <MainLayout>
            <TradingPage />
          </MainLayout>
        }
      />
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/trade" replace /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={isAuthenticated ? <Navigate to="/trade" replace /> : <RegisterPage />}
      />
      <Route
        path="/trade"
        element={
          <MainLayout>
            <TradingPage />
          </MainLayout>
        }
      />
      <Route
        path="/leaderboard"
        element={
          <MainLayout>
            <LeaderboardPage />
          </MainLayout>
        }
      />
      <Route
        path="/profile"
        element={
          <AuthGuard>
            <MainLayout>
              <ProfilePage />
            </MainLayout>
          </AuthGuard>
        }
      />
      <Route element={<Navigate to="/" replace />} />
    </Routes>
  );
}
