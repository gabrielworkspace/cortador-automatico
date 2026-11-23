import { Download } from 'lucide-react';
import { MainTab } from '../types/studio';

interface TopBarProps {
  activeTab: MainTab;
  onSelectTab: (tab: MainTab) => void;
  onOpenExport: () => void;
}

const TABS: { id: MainTab; label: string }[] = [
  { id: 'gradient', label: 'Gradiente' },
  { id: 'shapes', label: 'Formas' },
  { id: 'youtube', label: 'YouTube & Texto' },
];

export function TopBar({ activeTab, onSelectTab, onOpenExport }: TopBarProps) {
  return (
    <header className="h-14 border-b border-[#22252D] bg-[#111216] px-5 flex items-center justify-between gap-8 shrink-0">
      {/* Zone 1: Single text wordmark */}
      <button
        type="button"
        onClick={() => onSelectTab('gradient')}
        className="text-[16px] font-bold tracking-tight text-zinc-100 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 rounded-sm"
      >
        Croma Studio
      </button>

      {/* Zone 2: Primary 3-tab navigation */}
      <nav aria-label="Abas principais" className="flex items-center gap-6 h-full">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`relative h-full px-1 flex items-center text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:text-white ${
                isActive
                  ? 'text-zinc-50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-100"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Single primary action */}
      <div className="shrink-0">
        <button
          type="button"
          onClick={onOpenExport}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-[13px] font-semibold hover:bg-white active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          Exportar
        </button>
      </div>
    </header>
  );
}
