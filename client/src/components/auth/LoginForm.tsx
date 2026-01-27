import { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface LoginFormProps {
  onSubmit: (username: string, password: string) => Promise<void>;
  isLoading?: boolean;
  error?: string | null;
  onErrorClear?: () => void;
}

export function LoginForm({ onSubmit, isLoading, error, onErrorClear }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onErrorClear?.();
    await onSubmit(username.toLowerCase(), password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Username"
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="satoshi"
        required
        autoComplete="username"
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••"
        required
        autoComplete="current-password"
      />

      {error && (
        <div className="p-3 bg-accent-red/10 border border-accent-red/20 rounded-lg">
          <p className="text-sm text-accent-red">{error}</p>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        isLoading={isLoading}
      >
        Sign In
      </Button>
    </form>
  );
}
