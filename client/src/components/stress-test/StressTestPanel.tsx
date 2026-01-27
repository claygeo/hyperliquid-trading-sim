import { useEffect } from 'react';
import { TPSDisplay } from './TPSDisplay';
import { StressTestStats } from './StressTestStats';
import { useStressTestStore } from '../../hooks/useStressTest';
import { STRESS_TEST_CONFIG } from '../../config/constants';
import { cn } from '../../lib/utils';
import type { StressTestSpeed } from '../../types/websocket';

export function StressTestPanel() {
  const { speed, tps, isChangingSpeed, setSpeed, subscribeToTPS } = useStressTestStore();

  useEffect(() => {
    subscribeToTPS();
  }, [subscribeToTPS]);

  const speeds: { value: StressTestSpeed; label: string; tps: number }[] = [
    { value: 'off', label: 'Off', tps: 0 },
    { value: 'slow', label: 'Slow', tps: STRESS_TEST_CONFIG.SLOW_TPS },
    { value: 'medium', label: 'Medium', tps: STRESS_TEST_CONFIG.MEDIUM_TPS },
    { value: 'fast', label: 'Fast', tps: STRESS_TEST_CONFIG.FAST_TPS },
  ];

  return (
    <div className="bg-bg-secondary rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Stress Test</h3>
        <div className={cn(
          'w-2 h-2 rounded-full',
          speed === 'off' ? 'bg-text-muted' : 'bg-accent-green animate-pulse'
        )} />
      </div>

      {/* Speed selector */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {speeds.map((s) => (
          <button
            key={s.value}
            onClick={() => setSpeed(s.value)}
            disabled={isChangingSpeed}
            className={cn(
              'py-2 px-3 rounded-lg text-sm font-medium transition-all',
              speed === s.value
                ? 'bg-accent-cyan text-bg-primary'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary',
              isChangingSpeed && 'opacity-50 cursor-not-allowed'
            )}
          >
            <div>{s.label}</div>
            {s.tps > 0 && (
              <div className="text-xs opacity-75">{s.tps} TPS</div>
            )}
          </button>
        ))}
      </div>

      {/* Live TPS display */}
      <TPSDisplay tps={tps} />

      {/* Stats */}
      <StressTestStats tps={tps} />

      {/* Info */}
      <p className="mt-4 text-xs text-text-muted">
        Stress test generates synthetic trades and orderbook updates to demonstrate
        the system's ability to handle high throughput.
      </p>
    </div>
  );
}
