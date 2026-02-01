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
    <div className={cn('flex gap-1 bg-[#1a1d21] p-1 rounded-lg', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 touch-manipulation',
            activeTab === tab.value
              ? 'bg-[#00d4ff] text-black shadow-sm'
              : 'text-gray-400 hover:text-white'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
