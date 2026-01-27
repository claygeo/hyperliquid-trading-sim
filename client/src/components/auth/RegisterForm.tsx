import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface RegisterFormProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  onErrorClear?: () => void;
}

export function RegisterForm({ onSubmit, isLoading, error, onErrorClear }: RegisterFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onErrorClear?.();
    setValidationError('');

    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setValidationError('Password must be at least 6 characters');
      return;
    }

    if (username.length < 3) {
      setValidationError('Username must be at least 3 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setValidationError('Username can only contain letters, numbers, and underscores');
      return;
    }

    await onSubmit(username, password);
  };

  const displayError = validationError || error;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username"
        type="text"
        placeholder="satoshi"
        value={username}
        onChange={(e) => setUsername(e.target.value.toLowerCase())}
        required
        autoComplete="username"
      />

      <Input
        label="Password"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="new-password"
      />

      <Input
        label="Confirm Password"
        type="password"
        placeholder="••••••••"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        autoComplete="new-password"
      />

      {displayError && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg">
          <p className="text-sm text-accent-red">{displayError}</p>
        </div>
      )}

      <Button type="submit" variant="primary" className="w-full" isLoading={isLoading}>
        Create Account
      </Button>

      <div className="p-3 bg-bg-tertiary rounded-lg">
        <p className="text-xs text-text-muted text-center">
          No email required. This is a paper trading simulator - no real money involved.
        </p>
      </div>
    </form>
  );
}
