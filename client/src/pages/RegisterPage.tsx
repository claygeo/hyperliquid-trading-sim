import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../hooks/useAuth';
import { RegisterForm } from '../components/auth/RegisterForm';

export function RegisterPage() {
  const { register, isLoading, error, setError } = useAuthStore();
  const navigate = useNavigate();

  const handleRegister = async (username: string, password: string) => {
    try {
      await register(username, password);
      navigate('/trade');
    } catch (err) {
      // Error is handled by the store
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4">
      {/* Background effects */}
      <div className="fixed inset-0 bg-grid-pattern bg-grid opacity-30 pointer-events-none" />
      <div className="fixed inset-0 bg-gradient-radial from-accent-purple/10 via-transparent to-transparent pointer-events-none" />

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

        {/* Register form card */}
        <div className="bg-bg-secondary border border-border rounded-2xl p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-text-primary mb-2">Create account</h1>
          <p className="text-text-secondary mb-6">Start trading with $100k virtual USDC</p>

          <RegisterForm
            onSubmit={handleRegister}
            isLoading={isLoading}
            error={error}
            onErrorClear={() => setError(null)}
          />

          <p className="mt-6 text-center text-text-secondary">
            Already have an account?{' '}
            <Link to="/login" className="text-accent-cyan hover:underline">
              Sign in
            </Link>
          </p>
        </div>

        {/* Features list */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-accent-cyan font-bold text-lg">$100K</p>
            <p className="text-text-muted text-xs">Starting Balance</p>
          </div>
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-accent-green font-bold text-lg">50x</p>
            <p className="text-text-muted text-xs">Max Leverage</p>
          </div>
          <div className="bg-bg-secondary/50 rounded-lg p-3">
            <p className="text-accent-purple font-bold text-lg">3</p>
            <p className="text-text-muted text-xs">Assets</p>
          </div>
        </div>
      </div>
    </div>
  );
}
