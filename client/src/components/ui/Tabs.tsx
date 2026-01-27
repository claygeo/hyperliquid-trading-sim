import { cn } from '../../lib/utils';

interface Tab {
  value: string;
  label: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex gap-1 bg-bg-tertiary p-1 rounded-lg', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-md transition-all duration-200',
            activeTab === tab.value
              ? 'bg-bg-elevated text-text-primary shadow-sm'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
