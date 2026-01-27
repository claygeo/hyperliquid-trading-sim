interface StressTestStatsProps {
  tps: {
    current: number;
    average: number;
    peak: number;
    messageCount: number;
    latency: number;
  };
}

export function StressTestStats({ tps }: StressTestStatsProps) {
  const stats = [
    { label: 'Average TPS', value: tps.average.toFixed(1) },
    { label: 'Peak TPS', value: tps.peak.toLocaleString() },
    { label: 'Total Messages', value: tps.messageCount.toLocaleString() },
    { label: 'Latency', value: `${tps.latency.toFixed(1)}ms` },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 mt-4">
      {stats.map((stat) => (
        <div key={stat.label} className="p-2 bg-bg-tertiary rounded-lg">
          <div className="text-xs text-text-muted">{stat.label}</div>
          <div className="text-sm font-mono text-text-primary">{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
