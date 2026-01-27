interface TPSDisplayProps {
  tps: {
    current: number;
    average: number;
    peak: number;
    messageCount: number;
    latency: number;
  };
}

export function TPSDisplay({ tps }: TPSDisplayProps) {
  return (
    <div className="p-4 bg-bg-tertiary rounded-lg">
      <div className="text-center mb-2">
        <span className="text-xs text-text-muted">Current TPS</span>
        <div className="text-4xl font-bold font-mono text-accent-cyan">
          {tps.current.toLocaleString()}
        </div>
      </div>

      {/* TPS bar visualization */}
      <div className="h-2 bg-bg-primary rounded-full overflow-hidden mt-3">
        <div
          className="h-full bg-gradient-to-r from-accent-cyan to-accent-green transition-all duration-200"
          style={{ width: `${Math.min((tps.current / 1000) * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-text-muted mt-1">
        <span>0</span>
        <span>500</span>
        <span>1000+</span>
      </div>
    </div>
  );
}
