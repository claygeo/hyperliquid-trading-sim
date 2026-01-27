import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../hooks/useAuth';
import type { User, Profile } from '../types/user';

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, username: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useAuthStore();

  useEffect(() => {
    store.initialize();
  }, []);

  return (
    <AuthContext.Provider value={store}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    // Return store directly if not wrapped in provider
    return useAuthStore();
  }
  return context;
}
