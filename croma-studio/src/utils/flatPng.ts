const SIX_MB_SAFE_LIMIT = Math.floor(5.95 * 1024 * 1024); // Strictly under 6 MB

export interface FlatPngResult {
  blob: Blob;
  width: number;
  height: number;
  optimizedToFit: boolean;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar PNG achatado.'));
    }, 'image/png');
  });
}

function createFlattenedCanvas(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  quantStep = 0
): HTMLCanvasElement {
  const flat = document.createElement('canvas');
  flat.width = targetWidth;
  flat.height = targetHeight;

  // alpha: false flattens the backing store into a solid opaque 24-bit RGB surface
  const ctx = flat.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('Contexto 2D indisponível para achatamento PNG.');
  }

  ctx.fillStyle = '#0B0C0F';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

  if (quantStep > 1) {
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.round(data[i] / quantStep) * quantStep);
      data[i + 1] = Math.min(255, Math.round(data[i + 1] / quantStep) * quantStep);
      data[i + 2] = Math.min(255, Math.round(data[i + 2] / quantStep) * quantStep);
      data[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return flat;
}

/**
 * Flattens the canvas onto an opaque RGB surface (no alpha channel)
 * and guarantees the exported YouTube Thumbnail PNG stays strictly under 6 MB.
 */
export async function exportFlattenedThumbnailPng(
  source: HTMLCanvasElement,
  minWidth = 2048,
  minHeight = 1152
): Promise<FlatPngResult> {
  let width = source.width;
  let height = source.height;

  // Pass 1: Pure lossless flat opaque RGB PNG (no alpha channel)
  const pureFlat = createFlattenedCanvas(source, width, height, 0);
  let blob = await canvasToPngBlob(pureFlat);
  if (blob.size <= SIX_MB_SAFE_LIMIT) {
    return { blob, width, height, optimizedToFit: false };
  }

  // Pass 2: Progressive mild RGB quantization to improve PNG DEFLATE ratio while preserving resolution
  const steps = [4, 8, 12, 16];
  for (const step of steps) {
    const quantized = createFlattenedCanvas(source, width, height, step);
    blob = await canvasToPngBlob(quantized);
    if (blob.size <= SIX_MB_SAFE_LIMIT) {
      return { blob, width, height, optimizedToFit: true };
    }
  }

  // Pass 3: If scale > 1x still exceeds 6 MB (e.g. 4K + heavy grain), fit down to exact 2048x1152 flat PNG
  if (width > minWidth || height > minHeight) {
    width = minWidth;
    height = minHeight;
    const resizedFlat = createFlattenedCanvas(source, width, height, 0);
    blob = await canvasToPngBlob(resizedFlat);
    if (blob.size <= SIX_MB_SAFE_LIMIT) {
      return { blob, width, height, optimizedToFit: true };
    }
    for (const step of [4, 8, 12, 16, 24]) {
      const quantizedResized = createFlattenedCanvas(source, width, height, step);
      blob = await canvasToPngBlob(quantizedResized);
      if (blob.size <= SIX_MB_SAFE_LIMIT) {
        return { blob, width, height, optimizedToFit: true };
      }
    }
  }

  return { blob, width, height, optimizedToFit: true };
}
