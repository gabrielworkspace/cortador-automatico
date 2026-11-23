import { useEffect, useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { ExportFormat, StudioState } from '../types/studio';
import { renderStudioCanvas } from '../utils/canvasRenderer';
import { canvasToBmpBlob, formatBytes } from '../utils/bmpEncoder';
import { exportFlattenedThumbnailPng } from '../utils/flatPng';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  state: StudioState;
  width: number;
  height: number;
  baseFilename: string;
}

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'png', label: 'PNG', note: 'Sem perdas + transparência' },
  { id: 'jpeg', label: 'JPEG', note: 'Arquivo leve para web' },
  { id: 'webp', label: 'WebP', note: 'Alta compressão moderna' },
  { id: 'bmp', label: 'BMP', note: 'Bitmap sem compressão' },
];

const SIX_MB_BYTES = 6 * 1024 * 1024;

export function ExportModal({
  open,
  onClose,
  state,
  width,
  height,
  baseFilename,
}: ExportModalProps) {
  const isWatermarkMode =
    state.activeTab === 'youtube' && state.youtubeSubMode === 'watermark';
  const isThumbnailMode =
    (state.activeTab === 'youtube' && state.youtubeSubMode === 'thumbnail') ||
    (state.activeTab !== 'youtube' && state.resolutionId === 'yt-thumbnail');

  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState<number>(95);
  const [scale, setScale] = useState<1 | 2>(1);
  const [flattenThumbnailPng, setFlattenThumbnailPng] = useState<boolean>(true);
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [actualOutDims, setActualOutDims] = useState<{ w: number; h: number } | null>(null);
  const [flatOptimizedToFit, setFlatOptimizedToFit] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Force 1x (150x150) when exporting watermark
  useEffect(() => {
    if (open && isWatermarkMode) {
      setScale(1);
      if (format === 'webp') setFormat('png');
    }
  }, [open, isWatermarkMode, format]);

  const outWidth = isWatermarkMode ? 150 : width * scale;
  const outHeight = isWatermarkMode ? 150 : height * scale;
  const shouldFlattenPng = isThumbnailMode && format === 'png' && flattenThumbnailPng;

  const generateExportOutput = async (): Promise<{
    blob: Blob;
    w: number;
    h: number;
    optimizedToFit: boolean;
  }> => {
    const offscreen = document.createElement('canvas');
    offscreen.width = outWidth;
    offscreen.height = outHeight;
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('Falha ao inicializar canvas de exportação.');
    }

    if (format === 'jpeg') {
      // Fill solid dark backdrop before drawing transparent watermark onto JPEG
      ctx.fillStyle = '#0B0C0F';
      ctx.fillRect(0, 0, outWidth, outHeight);
    }

    renderStudioCanvas(ctx, outWidth, outHeight, state);

    // Flatten image exclusively for YouTube Thumbnail PNG export (<= 6 MB)
    if (shouldFlattenPng) {
      const flatResult = await exportFlattenedThumbnailPng(offscreen, 2048, 1152);
      return {
        blob: flatResult.blob,
        w: flatResult.width,
        h: flatResult.height,
        optimizedToFit: flatResult.optimizedToFit,
      };
    }

    if (format === 'bmp') {
      return {
        blob: canvasToBmpBlob(offscreen),
        w: outWidth,
        h: outHeight,
        optimizedToFit: false,
      };
    }

    const mime =
      format === 'png'
        ? 'image/png'
        : format === 'jpeg'
        ? 'image/jpeg'
        : 'image/webp';

    const blob = await new Promise<Blob>((resolve, reject) => {
      offscreen.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Falha ao gerar arquivo de imagem.'));
        },
        mime,
        format === 'png' ? undefined : quality / 100
      );
    });

    return { blob, w: outWidth, h: outHeight, optimizedToFit: false };
  };

  // Compute real file size preview whenever parameters change while modal is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEstimatedBytes(null);
    setActualOutDims(null);
    setFlatOptimizedToFit(false);

    const timer = window.setTimeout(async () => {
      try {
        const result = await generateExportOutput();
        if (!cancelled) {
          setEstimatedBytes(result.blob.size);
          setActualOutDims({ w: result.w, h: result.h });
          setFlatOptimizedToFit(result.optimizedToFit);
        }
      } catch {
        if (!cancelled) {
          setEstimatedBytes(null);
          setActualOutDims(null);
          setFlatOptimizedToFit(false);
        }
      }
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, format, quality, scale, outWidth, outHeight, shouldFlattenPng, state]);

  if (!open) return null;

  const displayW = actualOutDims?.w ?? outWidth;
  const displayH = actualOutDims?.h ?? outHeight;

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const result = await generateExportOutput();
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseFilename}-${result.w}x${result.h}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyClipboard = async () => {
    setIsGenerating(true);
    try {
      const offscreen = document.createElement('canvas');
      offscreen.width = outWidth;
      offscreen.height = outHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) return;
      renderStudioCanvas(ctx, outWidth, outHeight, state);

      const blob =
        isThumbnailMode && flattenThumbnailPng
          ? (await exportFlattenedThumbnailPng(offscreen, 2048, 1152)).blob
          : await new Promise<Blob | null>((res) =>
              offscreen.toBlob((b) => res(b), 'image/png')
            );

      if (blob && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard may be blocked inside iframe sandbox; fail silently
    } finally {
      setIsGenerating(false);
    }
  };

  const availableFormats = isWatermarkMode
    ? FORMATS.filter((f) => f.id !== 'webp')
    : FORMATS;

  const exceedsWatermarkLimit =
    isWatermarkMode && estimatedBytes !== null && estimatedBytes > 1024 * 1024;
  const exceedsThumbnailLimit =
    isThumbnailMode && estimatedBytes !== null && estimatedBytes > SIX_MB_BYTES;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[#14161D] border border-[#282C38] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#22252F] flex items-center justify-between">
          <div>
            <h2 id="export-modal-title" className="text-[15px] font-semibold text-zinc-100">
              {isWatermarkMode
                ? "Exportar Marca d'Água YouTube"
                : isThumbnailMode
                ? 'Exportar Thumbnail YouTube'
                : 'Exportar imagem em alta qualidade'}
            </h2>
            <p className="text-[12px] text-zinc-400 font-mono tabular-nums mt-0.5">
              {displayW} × {displayH} px
              {estimatedBytes !== null ? ` · ${formatBytes(estimatedBytes)}` : ' · calculando...'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de exportação"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-[#222530] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Format Grid */}
          <div className="space-y-2">
            <span className="text-[12px] font-medium text-zinc-300 block">
              Formato do arquivo
            </span>
            <div className={`grid gap-2 ${availableFormats.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {availableFormats.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id)}
                  className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    format === f.id
                      ? 'bg-[#222634] border-zinc-300 text-white'
                      : 'bg-[#191B23] border-[#262A36] text-zinc-300 hover:border-[#393F50]'
                  }`}
                >
                  <div className="text-[13px] font-semibold">{f.label}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {isThumbnailMode && f.id === 'png'
                      ? 'Imagem flat · máx. 6 MB'
                      : f.note}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Flat PNG toggle exclusively for YouTube Thumbnail + PNG */}
          {isThumbnailMode && format === 'png' && (
            <label className="flex items-start justify-between gap-3 p-3 rounded-lg bg-[#191C24] border border-[#272B38] cursor-pointer">
              <div className="space-y-0.5">
                <div className="text-[12px] font-medium text-zinc-100">
                  Achatar imagem antes de exportar (Flat PNG)
                </div>
                <div className="text-[11px] text-zinc-400 leading-relaxed">
                  Remove o canal alfa (transparência) e otimiza o PNG para manter o arquivo abaixo de 6 MB.
                </div>
              </div>
              <input
                type="checkbox"
                checked={flattenThumbnailPng}
                onChange={(e) => setFlattenThumbnailPng(e.target.checked)}
                className="accent-zinc-100 w-4 h-4 mt-0.5 shrink-0 cursor-pointer"
              />
            </label>
          )}

          {/* Quality slider for lossy formats */}
          {(format === 'jpeg' || format === 'webp') && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-300">Qualidade de compressão</span>
                <span className="font-mono tabular-nums text-zinc-100">{quality}%</span>
              </div>
              <input
                type="range"
                min={60}
                max={100}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="studio-slider"
              />
            </div>
          )}

          {/* Resolution Scale (non-watermark) */}
          {!isWatermarkMode && (
            <div className="space-y-2">
              <span className="text-[12px] font-medium text-zinc-300 block">
                Escala de saída
              </span>
              <div className="grid grid-cols-2 gap-2">
                {([1, 2] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScale(s)}
                    className={`py-2 px-3 rounded-lg border text-[12px] font-medium flex items-center justify-between transition-colors cursor-pointer ${
                      scale === s
                        ? 'bg-[#222634] border-zinc-300 text-white'
                        : 'bg-[#191B23] border-[#262A36] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <span>{s === 1 ? 'Padrão (1×)' : 'Retina (2×)'}</span>
                    <span className="font-mono tabular-nums text-[11px]">
                      {width * s}×{height * s}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* YouTube Thumbnail Compliance Notice (>= 2048x1152 and <= 6 MB) */}
          {isThumbnailMode && (
            <div className="p-3 rounded-lg bg-[#191C24] border border-[#272B38] text-[12px] leading-relaxed text-zinc-300">
              <div className="font-medium text-zinc-100 mb-1">
                Especificação YouTube Thumbnail
              </div>
              Mínimo <span className="font-mono">2048 × 1152 px</span> ·{' '}
              {exceedsThumbnailLimit ? (
                <span className="text-amber-400">
                  Acima de 6 MB ({estimatedBytes ? formatBytes(estimatedBytes) : '...'}). Ative o PNG flat ou use JPEG.
                </span>
              ) : (
                <span className="text-emerald-400">
                  Dentro do limite de 6 MB ({estimatedBytes ? formatBytes(estimatedBytes) : '...'}).
                </span>
              )}
              {shouldFlattenPng && flatOptimizedToFit && (
                <div className="text-[11px] text-zinc-400 mt-1">
                  Otimização automática aplicada ao PNG flat para respeitar o teto de 6 MB.
                </div>
              )}
            </div>
          )}

          {/* YouTube Watermark Compliance Notice */}
          {isWatermarkMode && (
            <div className="p-3 rounded-lg bg-[#191C24] border border-[#272B38] text-[12px] leading-relaxed text-zinc-300">
              <div className="font-medium text-zinc-100 mb-1">
                Especificação YouTube Video Watermark
              </div>
              Dimensão travada em <span className="font-mono">150 × 150 px</span> ·{' '}
              {exceedsWatermarkLimit ? (
                <span className="text-amber-400">
                  Arquivo acima de 1 MB, prefira PNG ou JPEG.
                </span>
              ) : (
                <span className="text-emerald-400">
                  Dentro do limite de 1 MB ({estimatedBytes ? formatBytes(estimatedBytes) : '...'}).
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-[#22252F] bg-[#111218] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleCopyClipboard}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1C1F28] border border-[#2D3140] text-[12px] font-medium text-zinc-200 hover:bg-[#242834] transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copiar PNG
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-zinc-100 text-zinc-950 text-[13px] font-semibold hover:bg-white disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4" />
            {isGenerating ? 'Gerando...' : `Baixar ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
