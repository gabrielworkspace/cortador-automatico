import { Shuffle } from 'lucide-react';
import { BLEND_MODES, GEOMETRIC_PATTERNS } from '../data/presets';
import { BlendModeOption, GeometricConfig, ShapeFillMode } from '../types/studio';

interface ShapesPanelProps {
  geometric: GeometricConfig;
  onChangeGeometric: (next: GeometricConfig) => void;
  onRandomizeGeometric: () => void;
}

const FILL_MODES: { id: ShapeFillMode; label: string }[] = [
  { id: 'stroke', label: 'Contorno' },
  { id: 'fill', label: 'Preenchido' },
  { id: 'mixed', label: 'Misto' },
];

export function ShapesPanel({
  geometric,
  onChangeGeometric,
  onRandomizeGeometric,
}: ShapesPanelProps) {
  const isEnabled = geometric.type !== 'none';

  return (
    <div className="divide-y divide-[#22252D]">
      {/* Pattern Selector */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-100">Formas e padrões</h2>
          <button
            type="button"
            onClick={onRandomizeGeometric}
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            Sortear formas
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {GEOMETRIC_PATTERNS.map((pattern) => {
            const active = geometric.type === pattern.id;
            return (
              <button
                key={pattern.id}
                type="button"
                onClick={() => onChangeGeometric({ ...geometric, type: pattern.id })}
                className={`px-3 py-2 rounded-lg text-left text-[12px] font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#252834] border-zinc-400 text-white'
                    : 'bg-[#16181F] border-[#232630] text-zinc-400 hover:text-zinc-200 hover:border-[#323645]'
                }`}
              >
                {pattern.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Appearance & Blend */}
      <section className={`p-4 space-y-4 ${!isEnabled ? 'opacity-45 pointer-events-none' : ''}`}>
        <h2 className="text-[13px] font-semibold text-zinc-100">Estilo e mesclagem</h2>

        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#181A20] border border-[#252832]">
          {FILL_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeGeometric({ ...geometric, fillMode: m.id })}
              className={`py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                geometric.fillMode === m.id
                  ? 'bg-[#2A2E3B] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-[12px] text-zinc-400 block">Cor principal</span>
            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-[#16181F] border border-[#232630]">
              <input
                type="color"
                value={geometric.color}
                onChange={(e) =>
                  onChangeGeometric({ ...geometric, color: e.target.value.toUpperCase() })
                }
                className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
              />
              <span className="font-mono text-[11px] text-zinc-300">{geometric.color}</span>
            </div>
          </label>

          <label className="space-y-1.5">
            <span className="text-[12px] text-zinc-400 block">Cor secundária</span>
            <div className="flex items-center gap-2 p-1.5 rounded-lg bg-[#16181F] border border-[#232630]">
              <input
                type="color"
                value={geometric.secondaryColor}
                onChange={(e) =>
                  onChangeGeometric({
                    ...geometric,
                    secondaryColor: e.target.value.toUpperCase(),
                  })
                }
                className="w-6 h-6 rounded border-0 bg-transparent cursor-pointer"
              />
              <span className="font-mono text-[11px] text-zinc-300">
                {geometric.secondaryColor}
              </span>
            </div>
          </label>
        </div>

        <label className="space-y-1.5 block">
          <span className="text-[12px] text-zinc-400 block">Modo de mesclagem</span>
          <select
            value={geometric.blendMode}
            onChange={(e) =>
              onChangeGeometric({
                ...geometric,
                blendMode: e.target.value as BlendModeOption,
              })
            }
            className="w-full h-9 px-3 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-400 cursor-pointer"
          >
            {BLEND_MODES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Geometry Controls */}
      <section className={`p-4 space-y-3.5 ${!isEnabled ? 'opacity-45 pointer-events-none' : ''}`}>
        <h2 className="text-[13px] font-semibold text-zinc-100">Geometria</h2>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Opacidade</span>
            <span className="font-mono tabular-nums text-zinc-200">{geometric.opacity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={geometric.opacity}
            onChange={(e) =>
              onChangeGeometric({ ...geometric, opacity: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Escala / Espaçamento</span>
            <span className="font-mono tabular-nums text-zinc-200">{geometric.scale} px</span>
          </div>
          <input
            type="range"
            min={20}
            max={220}
            value={geometric.scale}
            onChange={(e) =>
              onChangeGeometric({ ...geometric, scale: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Espessura do traço</span>
            <span className="font-mono tabular-nums text-zinc-200">
              {geometric.strokeWidth.toFixed(1)} px
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={geometric.strokeWidth}
            onChange={(e) =>
              onChangeGeometric({ ...geometric, strokeWidth: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Rotação</span>
            <span className="font-mono tabular-nums text-zinc-200">{geometric.rotation}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={geometric.rotation}
            onChange={(e) =>
              onChangeGeometric({ ...geometric, rotation: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>

        {(geometric.type === 'bauhaus' ||
          geometric.type === 'orbs' ||
          geometric.type === 'triangles' ||
          geometric.type === 'hexagons') && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {(geometric.type === 'bauhaus' || geometric.type === 'orbs') && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-400">Quantidade</span>
                  <span className="font-mono tabular-nums text-zinc-200">{geometric.count}</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={24}
                  value={geometric.count}
                  onChange={(e) =>
                    onChangeGeometric({ ...geometric, count: Number(e.target.value) })
                  }
                  className="studio-slider"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Variação</span>
                <span className="font-mono tabular-nums text-zinc-200">#{geometric.seed}</span>
              </div>
              <input
                type="range"
                min={1}
                max={999}
                value={geometric.seed}
                onChange={(e) =>
                  onChangeGeometric({ ...geometric, seed: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
