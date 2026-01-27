import { Tabs } from '../ui/Tabs';

interface LeaderboardTabsProps {
  activePeriod: 'daily' | 'alltime';
  onPeriodChange: (period: 'daily' | 'alltime') => void;
}

export function LeaderboardTabs({ activePeriod, onPeriodChange }: LeaderboardTabsProps) {
  const tabs = [
    { value: 'alltime', label: 'All Time' },
    { value: 'daily', label: 'Today' },
  ];

  return (
    <Tabs
      tabs={tabs}
      activeTab={activePeriod}
      onChange={(value) => onPeriodChange(value as 'daily' | 'alltime')}
    />
  );
}
