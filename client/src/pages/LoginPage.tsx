import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';
import { LoginForm } from '../components/auth/LoginForm';

export function LoginPage() {
  const { login, isLoading, error, setError } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (username: string, password: string) => {
    try {
      await login(username, password);
      navigate('/trade');
    } catch (err) {
      // Error is handled by the store
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-radial from-accent-cyan/10 via-transparent to-transparent pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-gradient-to-br from-accent-cyan to-accent-purple rounded-xl flex items-center justify-center">
            <span className="text-2xl font-bold text-bg-primary font-display">H</span>
          </div>
          <span className="text-2xl font-bold font-display tracking-wider">
            <span className="text-accent-cyan">HYPER</span>
            <span className="text-text-primary">SIM</span>
          </span>
        </Link>

        {/* Login form card */}
        <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome back</h1>
          <p className="text-text-secondary mb-6">Sign in to continue trading</p>

          <LoginForm
            onSubmit={handleLogin}
            isLoading={isLoading}
            error={error}
            onErrorClear={() => setError(null)}
          />

          <p className="mt-6 text-center text-text-secondary">
            Don't have an account?{' '}
            <Link to="/register" className="text-accent-cyan hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
