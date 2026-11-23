import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Grid2x2,
  Play,
  RotateCcw,
  Shuffle,
  Sun,
  Moon,
  Volume2,
  Maximize,
} from 'lucide-react';
import { StudioState, TextLayer } from '../types/studio';
import { renderStudioCanvas, TextLayerBounds } from '../utils/canvasRenderer';
import { formatBytes } from '../utils/bmpEncoder';

interface CanvasStageProps {
  state: StudioState;
  canvasWidth: number;
  canvasHeight: number;
  resolutionLabel: string;
  onSelectText: (id: string | null) => void;
  onUpdateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  onToggleSafeZones: () => void;
  onRandomizeAll: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onQuickExportWatermark: () => void;
}

export function CanvasStage({
  state,
  canvasWidth,
  canvasHeight,
  resolutionLabel,
  onSelectText,
  onUpdateTextLayer,
  onToggleSafeZones,
  onRandomizeAll,
  onUndo,
  canUndo,
  onQuickExportWatermark,
}: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const watermarkThumbRef = useRef<HTMLCanvasElement | null>(null);
  const boundsRef = useRef<TextLayerBounds[]>([]);

  const [dragState, setDragState] = useState<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const [snapGuide, setSnapGuide] = useState<{ x: boolean; y: boolean }>({
    x: false,
    y: false,
  });

  const [playerScene, setPlayerScene] = useState<'dark' | 'light'>('dark');
  const [wmByteSize, setWmByteSize] = useState<number | null>(null);
  const [fontsLoadedTick, setFontsLoadedTick] = useState(0);

  const isWatermarkMode =
    state.activeTab === 'youtube' && state.youtubeSubMode === 'watermark';
  const isYouTubeTextMode =
    state.activeTab === 'youtube' &&
    (state.youtubeSubMode === 'thumbnail' || state.youtubeSubMode === 'banner');

  // Re-render once Google Fonts finish loading
  useEffect(() => {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        setFontsLoadedTick((t) => t + 1);
      });
    }
  }, []);

  // Compute preview canvas resolution (keeps crisp detail without lagging on 4K edits)
  const previewScale = isWatermarkMode
    ? 2 // 300x300 retina preview for crisp 150x150 display
    : Math.min(1, 1440 / Math.max(canvasWidth, canvasHeight));
  const renderW = Math.max(150, Math.round(canvasWidth * previewScale));
  const renderH = Math.max(150, Math.round(canvasHeight * previewScale));

  // Main render pass
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = renderW;
    canvas.height = renderH;
    boundsRef.current = renderStudioCanvas(ctx, renderW, renderH, state);

    // Also mirror into exact 150x150 watermark thumbnail for the video player preview & exact byte calculation
    if (isWatermarkMode && watermarkThumbRef.current) {
      const wmCanvas = watermarkThumbRef.current;
      wmCanvas.width = 150;
      wmCanvas.height = 150;
      const wctx = wmCanvas.getContext('2d');
      if (wctx) {
        renderStudioCanvas(wctx, 150, 150, state);
        wmCanvas.toBlob((blob) => {
          if (blob) setWmByteSize(blob.size);
        }, 'image/png');
      }
    }
  }, [state, renderW, renderH, isWatermarkMode, fontsLoadedTick]);

  // Hit-testing in canvas pixel coordinates
  const hitTestTextLayer = (canvasX: number, canvasY: number): string | null => {
    const list = boundsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      // Transform point into layer's rotated frame
      const dx = canvasX - b.cx;
      const dy = canvasY - b.cy;
      const rad = (-b.rotation * Math.PI) / 180;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(lx) <= b.width / 2 + 12 && Math.abs(ly) <= b.height / 2 + 12) {
        return b.id;
      }
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isYouTubeTextMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const hitId = hitTestTextLayer(cx, cy);
    if (hitId) {
      const layer = state.textLayers.find((l) => l.id === hitId);
      if (!layer) return;
      onSelectText(hitId);
      canvas.setPointerCapture(e.pointerId);
      setDragState({
        id: hitId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: layer.x,
        origY: layer.y,
      });
    } else {
      onSelectText(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragState || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dxNorm = (e.clientX - dragState.startClientX) / rect.width;
    const dyNorm = (e.clientY - dragState.startClientY) / rect.height;

    let nextX = Math.max(0.04, Math.min(0.96, dragState.origX + dxNorm));
    let nextY = Math.max(0.05, Math.min(0.95, dragState.origY + dyNorm));

    // Gentle magnetic snap to center axes
    const snapX = Math.abs(nextX - 0.5) < 0.015;
    const snapY = Math.abs(nextY - 0.5) < 0.018;
    if (snapX) nextX = 0.5;
    if (snapY) nextY = 0.5;

    setSnapGuide({ x: snapX, y: snapY });
    onUpdateTextLayer(dragState.id, { x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragState && canvasRef.current) {
      try {
        canvasRef.current.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if already released
      }
      setDragState(null);
      setSnapGuide({ x: false, y: false });
    }
  };

  const selectedBounds = isYouTubeTextMode
    ? boundsRef.current.find((b) => b.id === state.selectedTextId) ?? null
    : null;

  return (
    <main className="flex-1 flex flex-col min-w-0 studio-stage-grid overflow-hidden">
      {/* Workspace Canvas Toolbar */}
      <div className="h-12 px-5 border-b border-[#1E2028] bg-[#101116]/90 backdrop-blur-sm flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2.5 text-[12px] text-zinc-400 min-w-0">
          <span className="font-medium text-zinc-200 truncate">{resolutionLabel}</span>
          <span aria-hidden="true" className="text-zinc-600">
            ·
          </span>
          <span className="font-mono tabular-nums text-zinc-400 whitespace-nowrap">
            {canvasWidth} × {canvasHeight} px
          </span>
          {isWatermarkMode && wmByteSize !== null && (
            <>
              <span aria-hidden="true" className="text-zinc-600 hidden sm:inline">
                ·
              </span>
              <span className="font-mono tabular-nums text-emerald-400 whitespace-nowrap hidden sm:inline">
                PNG {formatBytes(wmByteSize)} / 1 MB máx.
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isYouTubeTextMode && (
            <button
              type="button"
              onClick={onToggleSafeZones}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                state.showSafeZones
                  ? 'bg-[#252834] border-zinc-400 text-white'
                  : 'bg-[#171920] border-[#262934] text-zinc-300 hover:text-white hover:border-[#3A3F50]'
              }`}
            >
              <Grid2x2 className="w-3.5 h-3.5" aria-hidden="true" />
              Áreas seguras
            </button>
          )}

          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Desfazer última ação"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-[#171920] border border-[#262934] text-zinc-300 hover:text-white hover:border-[#3A3F50] disabled:opacity-35 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            Desfazer
          </button>

          <button
            type="button"
            onClick={onRandomizeAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#1E212B] border border-[#323747] text-zinc-100 hover:bg-[#272B38] transition-colors whitespace-nowrap cursor-pointer"
          >
            <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
            Aleatorizar
          </button>
        </div>
      </div>

      {/* Main Viewport Area */}
      <div className="flex-1 overflow-auto p-6 lg:p-10 flex items-center justify-center">
        {isWatermarkMode ? (
          <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left: Zoomed 150x150 Watermark Inspector Canvas */}
            <div className="lg:col-span-5 flex flex-col items-center gap-4">
              <div className="w-full p-6 rounded-xl bg-[#13151B] border border-[#242731] flex flex-col items-center gap-4">
                <div className="w-full flex items-center justify-between text-[12px]">
                  <span className="font-medium text-zinc-200">Arte da Marca d&apos;Água</span>
                  <span className="font-mono tabular-nums text-zinc-400">150 × 150 px</span>
                </div>

                <div className="p-5 rounded-lg checkerboard-bg border border-[#2B2F3B] flex items-center justify-center">
                  <canvas
                    ref={canvasRef}
                    className="w-[180px] h-[180px] block"
                    style={{ imageRendering: 'auto' }}
                  />
                </div>

                <div className="w-full pt-1 flex items-center justify-between text-[12px] text-zinc-400">
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Compatível com YouTube
                  </span>
                  <button
                    type="button"
                    onClick={onQuickExportWatermark}
                    className="text-zinc-100 hover:underline font-medium cursor-pointer"
                  >
                    Baixar 150×150 PNG
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Live YouTube Video Player Bottom-Right Preview */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium text-zinc-200">
                  Prévia no player do YouTube
                </div>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#16181F] border border-[#252832]">
                  <button
                    type="button"
                    onClick={() => setPlayerScene('dark')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      playerScene === 'dark'
                        ? 'bg-[#282C38] text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Moon className="w-3 h-3" aria-hidden="true" />
                    Cena escura
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlayerScene('light')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      playerScene === 'light'
                        ? 'bg-[#282C38] text-white'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Sun className="w-3 h-3" aria-hidden="true" />
                    Cena clara
                  </button>
                </div>
              </div>

              {/* 16:9 Simulated Video Player Frame */}
              <div
                className={`relative w-full aspect-video rounded-xl overflow-hidden border border-[#2A2E39] shadow-2xl ${
                  playerScene === 'dark'
                    ? 'bg-gradient-to-br from-zinc-900 via-slate-900 to-zinc-950'
                    : 'bg-gradient-to-br from-zinc-200 via-slate-100 to-zinc-300'
                }`}
              >
                {/* Subtle studio scene lines to simulate video footage */}
                <div
                  className={`absolute inset-0 ${
                    playerScene === 'dark'
                      ? 'bg-[radial-gradient(circle_at_30%_35%,rgba(59,130,246,0.18),transparent_55%)]'
                      : 'bg-[radial-gradient(circle_at_30%_35%,rgba(15,23,42,0.08),transparent_55%)]'
                  }`}
                />

                {/* Center subtle play indicator */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    className={`w-14 h-10 rounded-xl flex items-center justify-center ${
                      playerScene === 'dark'
                        ? 'bg-black/45 text-white/80'
                        : 'bg-black/65 text-white'
                    }`}
                  >
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  </div>
                </div>

                {/* Live 150x150 Watermark positioned accurately in bottom-right above scrubber */}
                <div className="absolute right-4 bottom-12 group">
                  <canvas
                    ref={watermarkThumbRef}
                    className="w-11 h-11 sm:w-12 sm:h-12 block rounded-none opacity-90 group-hover:opacity-100 transition-opacity"
                  />
                </div>

                {/* Bottom Player Scrubber Chrome */}
                <div className="absolute inset-x-0 bottom-0 pt-6 pb-2.5 px-3.5 bg-gradient-to-t from-black/80 via-black/35 to-transparent">
                  <div className="w-full h-1 bg-white/25 rounded-full overflow-hidden mb-2">
                    <div className="w-[38%] h-full bg-red-600" />
                  </div>
                  <div className="flex items-center justify-between text-white/85 text-[11px] font-mono tabular-nums">
                    <div className="flex items-center gap-3">
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>04:18 / 11:24</span>
                    </div>
                    <Maximize className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              <p className="text-[12px] text-zinc-400 leading-relaxed">
                Dica: teste o contraste entre cena escura e clara para garantir que suas iniciais continuem legíveis em qualquer trecho do vídeo.
              </p>
            </div>
          </div>
        ) : (
          /* Standard & YouTube Thumbnail/Banner Stage */
          <div className="relative flex flex-col items-center justify-center max-w-full max-h-full">
            <div
              className="relative shadow-[0_24px_80px_rgba(0,0,0,0.65)] ring-1 ring-white/10 rounded-[2px] overflow-hidden select-none"
              style={{
                aspectRatio: `${canvasWidth} / ${canvasHeight}`,
                maxWidth: 'min(100%, 960px)',
                maxHeight: 'calc(100vh - 170px)',
                width:
                  canvasWidth >= canvasHeight
                    ? 'min(100%, 920px)'
                    : 'auto',
                height:
                  canvasHeight > canvasWidth
                    ? 'min(calc(100vh - 180px), 680px)'
                    : 'auto',
              }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className={`w-full h-full block ${
                  isYouTubeTextMode
                    ? dragState
                      ? 'cursor-grabbing'
                      : 'cursor-grab'
                    : 'cursor-default'
                }`}
              />

              {/* Center Snap Guides during drag */}
              {dragState && snapGuide.x && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-1/2 w-[1px] bg-sky-400/90"
                />
              )}
              {dragState && snapGuide.y && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-1/2 h-[1px] bg-sky-400/90"
                />
              )}

              {/* Selected Text Layer Bounding Box Indicator */}
              {isYouTubeTextMode && selectedBounds && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute border border-dashed border-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                  style={{
                    left: `${(selectedBounds.cx / renderW) * 100}%`,
                    top: `${(selectedBounds.cy / renderH) * 100}%`,
                    width: `${(selectedBounds.width / renderW) * 100}%`,
                    height: `${(selectedBounds.height / renderH) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${selectedBounds.rotation}deg)`,
                  }}
                >
                  <span className="absolute -top-1 -left-1 w-2 h-2 bg-white border border-zinc-900" />
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-white border border-zinc-900" />
                  <span className="absolute -bottom-1 -left-1 w-2 h-2 bg-white border border-zinc-900" />
                  <span className="absolute -bottom-1 -right-1 w-2 h-2 bg-white border border-zinc-900" />
                </div>
              )}

              {/* YouTube Safe Zone Guides */}
              {isYouTubeTextMode && state.showSafeZones && state.youtubeSubMode === 'banner' && (
                <div className="pointer-events-none absolute inset-0">
                  {/* Desktop strip: 2560 x 423 centered vertically */}
                  <div
                    className="absolute inset-x-0 border-y border-amber-400/70 bg-black/25"
                    style={{
                      top: `${((1440 - 423) / 2 / 1440) * 100}%`,
                      height: `${(423 / 1440) * 100}%`,
                    }}
                  >
                    <span className="absolute right-2 top-1 text-[10px] font-mono text-amber-300 bg-black/65 px-1.5 py-0.5 rounded">
                      Desktop 2560×423
                    </span>
                    {/* Mobile & Logo Safe Zone: 1546 x 423 centered */}
                    <div
                      className="h-full mx-auto border-x border-emerald-400/90 bg-emerald-400/5 relative"
                      style={{ width: `${(1546 / 2560) * 100}%` }}
                    >
                      <span className="absolute left-2 top-1 text-[10px] font-mono text-emerald-300 bg-black/70 px-1.5 py-0.5 rounded">
                        Área Segura Mobile 1546×423
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {isYouTubeTextMode &&
                state.showSafeZones &&
                state.youtubeSubMode === 'thumbnail' && (
                  <div className="pointer-events-none absolute inset-0">
                    {/* Rule of thirds */}
                    <div className="absolute inset-y-0 left-1/3 w-[1px] bg-white/25" />
                    <div className="absolute inset-y-0 left-2/3 w-[1px] bg-white/25" />
                    <div className="absolute inset-x-0 top-1/3 h-[1px] bg-white/25" />
                    <div className="absolute inset-x-0 top-2/3 h-[1px] bg-white/25" />
                    {/* YouTube Duration Badge Zone */}
                    <div className="absolute right-3 bottom-3 px-2 py-0.5 rounded bg-black/85 border border-amber-400/70 font-mono text-[11px] tabular-nums text-amber-300">
                      12:34 (Zona do player)
                    </div>
                  </div>
                )}
            </div>

            {isYouTubeTextMode && (
              <p className="mt-3 text-[12px] text-zinc-500">
                Clique e arraste qualquer texto diretamente na prévia · Use as setas do teclado para ajuste fino
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
