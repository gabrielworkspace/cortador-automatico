/**
 * Encodes an HTMLCanvasElement into a valid 24-bit Windows BMP Blob.
 * Allows genuine BMP export for YouTube Video Watermarks (150x150, <= 1 MB)
 * and general studio exports.
 */
export function canvasToBmpBlob(canvas: HTMLCanvasElement): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Contexto 2D indisponível para codificação BMP.');
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Row size must be a multiple of 4 bytes
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // BITMAPFILEHEADER (14 bytes)
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4d); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true); // reserved
  view.setUint32(10, 54, true); // pixel data offset

  // BITMAPINFOHEADER (40 bytes)
  view.setUint32(14, 40, true); // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true); // positive = bottom-up
  view.setUint16(26, 1, true); // color planes
  view.setUint16(28, 24, true); // 24 bits per pixel
  view.setUint32(30, 0, true); // BI_RGB (uncompressed)
  view.setUint32(34, pixelArraySize, true);
  view.setInt32(38, 2835, true); // 72 DPI X
  view.setInt32(42, 2835, true); // 72 DPI Y
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Pixel data (BGR order, bottom-up; composite transparent pixels over dark #0B0C0F)
  let offset = 54;
  for (let y = height - 1; y >= 0; y--) {
    let rowByte = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3] / 255;
      const r = Math.round(data[idx] * alpha + 11 * (1 - alpha));
      const g = Math.round(data[idx + 1] * alpha + 12 * (1 - alpha));
      const b = Math.round(data[idx + 2] * alpha + 15 * (1 - alpha));

      view.setUint8(offset + rowByte++, b);
      view.setUint8(offset + rowByte++, g);
      view.setUint8(offset + rowByte++, r);
    }
    while (rowByte < rowSize) {
      view.setUint8(offset + rowByte++, 0);
    }
    offset += rowSize;
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
