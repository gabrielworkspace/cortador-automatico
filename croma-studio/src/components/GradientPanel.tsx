import { ArrowLeftRight, Plus, Shuffle, Trash2 } from 'lucide-react';
import { CURATED_PALETTES, RESOLUTION_PRESETS } from '../data/presets';
import { ColorStop, GradientConfig, GradientPalette, GradientType } from '../types/studio';

interface GradientPanelProps {
  gradient: GradientConfig;
  resolutionId: string;
  customWidth: number;
  customHeight: number;
  onChangeGradient: (next: GradientConfig) => void;
  onApplyPalette: (palette: GradientPalette) => void;
  onSelectResolution: (id: string) => void;
  onChangeCustomDimensions: (w: number, h: number) => void;
  onRandomizeGradient: () => void;
}

const GRADIENT_TYPES: { id: GradientType; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'conic', label: 'Cônico' },
  { id: 'mesh', label: 'Mesh' },
];

export function GradientPanel({
  gradient,
  resolutionId,
  customWidth,
  customHeight,
  onChangeGradient,
  onApplyPalette,
  onSelectResolution,
  onChangeCustomDimensions,
  onRandomizeGradient,
}: GradientPanelProps) {
  const updateStop = (id: string, patch: Partial<ColorStop>) => {
    onChangeGradient({
      ...gradient,
      stops: gradient.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };

  const addStop = () => {
    if (gradient.stops.length >= 5) return;
    const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2] ?? last;
    const midPos = Math.round((last.position + prev.position) / 2);
    const nextStop: ColorStop = {
      id: `stop-${Date.now()}`,
      color: '#38BDF8',
      position: midPos === last.position ? 50 : midPos,
    };
    onChangeGradient({
      ...gradient,
      stops: [...gradient.stops, nextStop],
    });
  };

  const removeStop = (id: string) => {
    if (gradient.stops.length <= 2) return;
    onChangeGradient({
      ...gradient,
      stops: gradient.stops.filter((s) => s.id !== id),
    });
  };

  const reverseStops = () => {
    onChangeGradient({
      ...gradient,
      stops: gradient.stops.map((s) => ({ ...s, position: 100 - s.position })),
    });
  };

  return (
    <div className="divide-y divide-[#22252D]">
      {/* Resolution & Social Formats */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-100">Resolução e formato</h2>
          <span className="text-[11px] font-mono tabular-nums text-zinc-400">
            {resolutionId === 'custom'
              ? `${customWidth} × ${customHeight}`
              : (() => {
                  const p = RESOLUTION_PRESETS.find((r) => r.id === resolutionId);
                  return p ? `${p.width} × ${p.height}` : '';
                })()}
          </span>
        </div>

        <select
          aria-label="Selecionar resolução"
          value={resolutionId}
          onChange={(e) => onSelectResolution(e.target.value)}
          className="w-full h-9 px-3 rounded-lg bg-[#1A1C23] border border-[#2A2E39] text-[13px] text-zinc-100 focus:outline-none focus:border-zinc-400 cursor-pointer"
        >
          <optgroup label="Redes Sociais">
            {RESOLUTION_PRESETS.filter((r) => r.category === 'social').map((r) => (
              <option key={r.id} value={r.id}>
                {r.platform} — {r.label} ({r.width}×{r.height})
              </option>
            ))}
          </optgroup>
          <optgroup label="YouTube">
            {RESOLUTION_PRESETS.filter((r) => r.category === 'youtube').map((r) => (
              <option key={r.id} value={r.id}>
                {r.platform} — {r.label} ({r.width}×{r.height})
              </option>
            ))}
          </optgroup>
          <optgroup label="Web e Desktop">
            {RESOLUTION_PRESETS.filter((r) => r.category === 'web').map((r) => (
              <option key={r.id} value={r.id}>
                {r.platform} — {r.label} ({r.width}×{r.height})
              </option>
            ))}
          </optgroup>
        </select>

        {resolutionId === 'custom' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Largura (px)</span>
              <input
                type="number"
                min={100}
                max={4096}
                value={customWidth}
                onChange={(e) =>
                  onChangeCustomDimensions(
                    Math.max(100, Math.min(4096, Number(e.target.value) || 100)),
                    customHeight
                  )
                }
                className="w-full h-8 px-2.5 rounded-md bg-[#1A1C23] border border-[#2A2E39] font-mono text-[12px] tabular-nums text-zinc-100 focus:outline-none focus:border-zinc-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-400">Altura (px)</span>
              <input
                type="number"
                min={100}
                max={4096}
                value={customHeight}
                onChange={(e) =>
                  onChangeCustomDimensions(
                    customWidth,
                    Math.max(100, Math.min(4096, Number(e.target.value) || 100))
                  )
                }
                className="w-full h-8 px-2.5 rounded-md bg-[#1A1C23] border border-[#2A2E39] font-mono text-[12px] tabular-nums text-zinc-100 focus:outline-none focus:border-zinc-400"
              />
            </label>
          </div>
        )}
      </section>

      {/* Gradient Type & Geometry */}
      <section className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-100">Tipo de gradiente</h2>
          <button
            type="button"
            onClick={onRandomizeGradient}
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            Sortear cores
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#181A20] border border-[#252832]">
          {GRADIENT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeGradient({ ...gradient, type: t.id })}
              className={`py-1.5 text-[12px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                gradient.type === t.id
                  ? 'bg-[#2A2E3B] text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(gradient.type === 'linear' || gradient.type === 'conic' || gradient.type === 'mesh') && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-zinc-400">Ângulo</span>
              <span className="font-mono tabular-nums text-zinc-200">{gradient.angle}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={360}
              value={gradient.angle}
              onChange={(e) =>
                onChangeGradient({ ...gradient, angle: Number(e.target.value) })
              }
              className="studio-slider"
            />
          </div>
        )}

        {(gradient.type === 'radial' || gradient.type === 'conic' || gradient.type === 'mesh') && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Centro X</span>
                <span className="font-mono tabular-nums text-zinc-200">{gradient.focalX}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={gradient.focalX}
                onChange={(e) =>
                  onChangeGradient({ ...gradient, focalX: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Centro Y</span>
                <span className="font-mono tabular-nums text-zinc-200">{gradient.focalY}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={gradient.focalY}
                onChange={(e) =>
                  onChangeGradient({ ...gradient, focalY: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>
          </div>
        )}

        {gradient.type === 'mesh' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Difusão</span>
                <span className="font-mono tabular-nums text-zinc-200">{gradient.meshSpread}%</span>
              </div>
              <input
                type="range"
                min={35}
                max={100}
                value={gradient.meshSpread}
                onChange={(e) =>
                  onChangeGradient({ ...gradient, meshSpread: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-400">Disposição</span>
                <span className="font-mono tabular-nums text-zinc-200">#{gradient.meshSeed}</span>
              </div>
              <input
                type="range"
                min={1}
                max={200}
                value={gradient.meshSeed}
                onChange={(e) =>
                  onChangeGradient({ ...gradient, meshSeed: Number(e.target.value) })
                }
                className="studio-slider"
              />
            </div>
          </div>
        )}
      </section>

      {/* Color Stops */}
      <section className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-zinc-100">Paradas de cor</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reverseStops}
              title="Inverter direção das cores"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-[#1E2129] transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={addStop}
              disabled={gradient.stops.length >= 5}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-zinc-200 bg-[#1E2129] hover:bg-[#272B36] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              Cor
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {gradient.stops.map((stop, index) => (
            <div
              key={stop.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-[#16181F] border border-[#232630]"
            >
              <label className="relative w-7 h-7 rounded-md overflow-hidden border border-white/15 shrink-0 cursor-pointer">
                <input
                  type="color"
                  aria-label={`Cor ${index + 1}`}
                  value={stop.color}
                  onChange={(e) => updateStop(stop.id, { color: e.target.value.toUpperCase() })}
                  className="absolute inset-0 w-10 h-10 -translate-x-1 -translate-y-1 cursor-pointer border-0"
                />
              </label>

              <input
                type="text"
                aria-label={`Código hexadecimal da cor ${index + 1}`}
                value={stop.color}
                onChange={(e) => {
                  const val = e.target.value;
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
                    updateStop(stop.id, { color: val.toUpperCase() });
                  }
                }}
                className="w-[74px] h-7 px-1.5 rounded bg-[#0F1014] border border-[#252832] font-mono text-[11px] text-zinc-200 focus:outline-none focus:border-zinc-400"
              />

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={stop.position}
                  onChange={(e) => updateStop(stop.id, { position: Number(e.target.value) })}
                  className="studio-slider"
                />
                <span className="w-8 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                  {stop.position}%
                </span>
              </div>

              <button
                type="button"
                onClick={() => removeStop(stop.id)}
                disabled={gradient.stops.length <= 2}
                aria-label={`Remover cor ${index + 1}`}
                className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-25 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Curated Palettes */}
      <section className="p-4 space-y-3">
        <h2 className="text-[13px] font-semibold text-zinc-100">Paletas prontas</h2>
        <div className="grid grid-cols-3 gap-2">
          {CURATED_PALETTES.map((palette) => {
            const cssStops = palette.stops
              .map((s) => `${s.color} ${s.position}%`)
              .join(', ');
            return (
              <button
                key={palette.id}
                type="button"
                onClick={() => onApplyPalette(palette)}
                className="group text-left rounded-lg overflow-hidden border border-[#262934] hover:border-zinc-400 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                <div
                  className="h-10 w-full"
                  style={{
                    background: `linear-gradient(${palette.angle}deg, ${cssStops})`,
                  }}
                />
                <div className="px-2 py-1.5 bg-[#16181F]">
                  <span className="block text-[11px] font-medium text-zinc-300 group-hover:text-white truncate">
                    {palette.name}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Texture & Finish */}
      <section className="p-4 space-y-3.5">
        <h2 className="text-[13px] font-semibold text-zinc-100">Textura e acabamento</h2>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Granulação (Ruído)</span>
            <span className="font-mono tabular-nums text-zinc-200">{gradient.noiseOpacity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={gradient.noiseOpacity}
            onChange={(e) =>
              onChangeGradient({ ...gradient, noiseOpacity: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-zinc-400">Vinheta nas bordas</span>
            <span className="font-mono tabular-nums text-zinc-200">{gradient.vignetteOpacity}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={gradient.vignetteOpacity}
            onChange={(e) =>
              onChangeGradient({ ...gradient, vignetteOpacity: Number(e.target.value) })
            }
            className="studio-slider"
          />
        </div>
      </section>
    </div>
  );
}
