import {
  BlendModeOption,
  GeometricConfig,
  GeometricPatternType,
  GradientConfig,
  GradientPalette,
  GradientType,
  ResolutionPreset,
  StudioState,
  TextLayer,
  WatermarkConfig,
} from '../types/studio';

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  // Social
  {
    id: 'ig-post',
    label: 'Post Quadrado',
    platform: 'Instagram',
    width: 1080,
    height: 1080,
    category: 'social',
  },
  {
    id: 'ig-portrait',
    label: 'Feed Retrato 4:5',
    platform: 'Instagram',
    width: 1080,
    height: 1350,
    category: 'social',
  },
  {
    id: 'ig-story',
    label: 'Story / Reels / TikTok',
    platform: 'Vertical 9:16',
    width: 1080,
    height: 1920,
    category: 'social',
  },
  {
    id: 'linkedin-cover',
    label: 'Capa de Perfil',
    platform: 'LinkedIn',
    width: 1584,
    height: 396,
    category: 'social',
  },
  {
    id: 'x-header',
    label: 'Cabeçalho',
    platform: 'X / Twitter',
    width: 1500,
    height: 500,
    category: 'social',
  },
  // YouTube
  {
    id: 'yt-thumbnail',
    label: 'Thumbnail',
    platform: 'YouTube',
    width: 2048,
    height: 1152,
    category: 'youtube',
  },
  {
    id: 'yt-banner',
    label: 'Banner do Canal',
    platform: 'YouTube',
    width: 2560,
    height: 1440,
    category: 'youtube',
  },
  {
    id: 'yt-watermark',
    label: "Marca d'Água",
    platform: 'YouTube',
    width: 150,
    height: 150,
    category: 'youtube',
  },
  // Web & Desktop
  {
    id: 'web-og',
    label: 'Open Graph / Blog',
    platform: 'Web',
    width: 1200,
    height: 630,
    category: 'web',
  },
  {
    id: 'desktop-fhd',
    label: 'Full HD 1080p',
    platform: 'Desktop / Web',
    width: 1920,
    height: 1080,
    category: 'web',
  },
  {
    id: 'desktop-4k',
    label: 'Ultra HD 4K',
    platform: 'Desktop / TV',
    width: 3840,
    height: 2160,
    category: 'web',
  },
  {
    id: 'custom',
    label: 'Personalizado',
    platform: 'Livre',
    width: 1600,
    height: 900,
    category: 'web',
  },
];

export const ARTWORK_FONTS: { name: string; label: string; category: string }[] = [
  { name: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', category: 'Geométrica' },
  { name: 'Outfit', label: 'Outfit', category: 'Moderna' },
  { name: 'Anton', label: 'Anton', category: 'Impacto YouTube' },
  { name: 'Bebas Neue', label: 'Bebas Neue', category: 'Condensada' },
  { name: 'Oswald', label: 'Oswald', category: 'Editorial Forte' },
  { name: 'Bricolage Grotesque', label: 'Bricolage Grotesque', category: 'Expressiva' },
  { name: 'Syne', label: 'Syne', category: 'Contemporânea' },
  { name: 'Playfair Display', label: 'Playfair Display', category: 'Serifa Clássica' },
  { name: 'Fraunces', label: 'Fraunces', category: 'Serifa Orgânica' },
  { name: 'JetBrains Mono', label: 'JetBrains Mono', category: 'Técnica Mono' },
];

export const GEOMETRIC_PATTERNS: { id: GeometricPatternType; label: string }[] = [
  { id: 'none', label: 'Nenhum' },
  { id: 'grid', label: 'Grade' },
  { id: 'dots', label: 'Pontos' },
  { id: 'diagonals', label: 'Diagonais' },
  { id: 'circles', label: 'Anéis' },
  { id: 'triangles', label: 'Triângulos' },
  { id: 'hexagons', label: 'Hexágonos' },
  { id: 'waves', label: 'Ondas' },
  { id: 'bauhaus', label: 'Bauhaus' },
  { id: 'orbs', label: 'Esferas' },
];

export const BLEND_MODES: { id: BlendModeOption; label: string }[] = [
  { id: 'source-over', label: 'Normal' },
  { id: 'overlay', label: 'Sobrepor' },
  { id: 'screen', label: 'Tela (Screen)' },
  { id: 'soft-light', label: 'Luz Suave' },
  { id: 'multiply', label: 'Multiplicar' },
  { id: 'lighter', label: 'Aditivo' },
];

export const CURATED_PALETTES: GradientPalette[] = [
  {
    id: 'nordic-cobalt',
    name: 'Cobalto Nórdico',
    type: 'mesh',
    angle: 135,
    shapeColor: '#E2E8F0',
    stops: [
      { color: '#0B1120', position: 0 },
      { color: '#1D4ED8', position: 48 },
      { color: '#0EA5E9', position: 100 },
    ],
  },
  {
    id: 'sunset-amber',
    name: 'Âmbar Solar',
    type: 'linear',
    angle: 128,
    shapeColor: '#FFF7ED',
    stops: [
      { color: '#1C0F13', position: 0 },
      { color: '#C2410C', position: 52 },
      { color: '#F59E0B', position: 100 },
    ],
  },
  {
    id: 'emerald-abyss',
    name: 'Abismo Esmeralda',
    type: 'mesh',
    angle: 145,
    shapeColor: '#D1FAE5',
    stops: [
      { color: '#022C22', position: 0 },
      { color: '#047857', position: 50 },
      { color: '#34D399', position: 100 },
    ],
  },
  {
    id: 'crimson-studio',
    name: 'Carmim Cinema',
    type: 'radial',
    angle: 130,
    shapeColor: '#FFE4E6',
    stops: [
      { color: '#DC2626', position: 0 },
      { color: '#7F1D1D', position: 55 },
      { color: '#09090B', position: 100 },
    ],
  },
  {
    id: 'obsidian-gold',
    name: 'Obsidiana & Ouro',
    type: 'linear',
    angle: 142,
    shapeColor: '#FEF3C7',
    stops: [
      { color: '#09090B', position: 0 },
      { color: '#27272A', position: 52 },
      { color: '#CA8A04', position: 100 },
    ],
  },
  {
    id: 'aurora-teal',
    name: 'Aurora Boreal',
    type: 'mesh',
    angle: 115,
    shapeColor: '#ECFEFF',
    stops: [
      { color: '#0F172A', position: 0 },
      { color: '#0D9488', position: 42 },
      { color: '#38BDF8', position: 76 },
      { color: '#818CF8', position: 100 },
    ],
  },
  {
    id: 'terracotta-rose',
    name: 'Terracota Editorial',
    type: 'linear',
    angle: 120,
    shapeColor: '#FFF1F2',
    stops: [
      { color: '#451A03', position: 0 },
      { color: '#B45309', position: 45 },
      { color: '#FB7185', position: 100 },
    ],
  },
  {
    id: 'graphite-silver',
    name: 'Grafite Industrial',
    type: 'linear',
    angle: 160,
    shapeColor: '#F4F4F5',
    stops: [
      { color: '#09090B', position: 0 },
      { color: '#27272A', position: 50 },
      { color: '#52525B', position: 100 },
    ],
  },
  {
    id: 'indigo-coral',
    name: 'Índigo & Coral',
    type: 'mesh',
    angle: 135,
    shapeColor: '#FFFFFF',
    stops: [
      { color: '#1E1B4B', position: 0 },
      { color: '#4338CA', position: 45 },
      { color: '#F43F5E', position: 100 },
    ],
  },
  {
    id: 'polar-mint',
    name: 'Menta Polar',
    type: 'linear',
    angle: 130,
    shapeColor: '#0F172A',
    stops: [
      { color: '#CCFBF1', position: 0 },
      { color: '#99F6E4', position: 48 },
      { color: '#38BDF8', position: 100 },
    ],
  },
  {
    id: 'copper-night',
    name: 'Cobre Noturno',
    type: 'conic',
    angle: 45,
    shapeColor: '#FFEDD5',
    stops: [
      { color: '#0C0A09', position: 0 },
      { color: '#9A3412', position: 35 },
      { color: '#EA580C', position: 65 },
      { color: '#0C0A09', position: 100 },
    ],
  },
  {
    id: 'deep-ocean',
    name: 'Fossa Oceânica',
    type: 'radial',
    angle: 180,
    shapeColor: '#BAE6FD',
    stops: [
      { color: '#0284C7', position: 0 },
      { color: '#0C4A6E', position: 50 },
      { color: '#030712', position: 100 },
    ],
  },
];

export function createInitialTextLayers(mode: 'thumbnail' | 'banner'): TextLayer[] {
  if (mode === 'banner') {
    return [
      {
        id: 'layer-title',
        text: 'SEU CANAL AQUI',
        x: 0.5,
        y: 0.45,
        fontFamily: 'Anton',
        fontSize: 112,
        fontWeight: 700,
        letterSpacing: 4,
        lineHeight: 1.05,
        uppercase: true,
        align: 'center',
        color: '#FFFFFF',
        opacity: 100,
        rotation: 0,
        visible: true,
        strokeEnabled: true,
        strokeColor: '#09090B',
        strokeWidth: 4,
        shadowEnabled: true,
        shadowColor: '#000000',
        shadowBlur: 24,
        shadowOffsetX: 0,
        shadowOffsetY: 10,
        shadowOpacity: 65,
        backdropEnabled: false,
        backdropColor: '#09090B',
        backdropOpacity: 60,
        backdropPaddingX: 28,
        backdropPaddingY: 12,
        backdropRadius: 12,
      },
      {
        id: 'layer-subtitle',
        text: 'NOVOS VÍDEOS TODA TERÇA E QUINTA ÀS 19H',
        x: 0.5,
        y: 0.59,
        fontFamily: 'Plus Jakarta Sans',
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: 5,
        lineHeight: 1.2,
        uppercase: true,
        align: 'center',
        color: '#E4E4E7',
        opacity: 92,
        rotation: 0,
        visible: true,
        strokeEnabled: false,
        strokeColor: '#000000',
        strokeWidth: 2,
        shadowEnabled: true,
        shadowColor: '#000000',
        shadowBlur: 12,
        shadowOffsetX: 0,
        shadowOffsetY: 4,
        shadowOpacity: 50,
        backdropEnabled: true,
        backdropColor: '#09090B',
        backdropOpacity: 45,
        backdropPaddingX: 22,
        backdropPaddingY: 10,
        backdropRadius: 8,
      },
    ];
  }

  return [
    {
      id: 'layer-title',
      text: 'DESIGN QUE\nCHAMA ATENÇÃO',
      x: 0.5,
      y: 0.46,
      fontFamily: 'Anton',
      fontSize: 104,
      fontWeight: 700,
      letterSpacing: 2,
      lineHeight: 1.02,
      uppercase: true,
      align: 'center',
      color: '#FFFFFF',
      opacity: 100,
      rotation: -2,
      visible: true,
      strokeEnabled: true,
      strokeColor: '#09090B',
      strokeWidth: 6,
      shadowEnabled: true,
      shadowColor: '#000000',
      shadowBlur: 28,
      shadowOffsetX: 0,
      shadowOffsetY: 12,
      shadowOpacity: 70,
      backdropEnabled: false,
      backdropColor: '#09090B',
      backdropOpacity: 70,
      backdropPaddingX: 24,
      backdropPaddingY: 12,
      backdropRadius: 10,
    },
    {
      id: 'layer-subtitle',
      text: 'GUIA COMPLETO 2026',
      x: 0.5,
      y: 0.74,
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 36,
      fontWeight: 700,
      letterSpacing: 4,
      lineHeight: 1.2,
      uppercase: true,
      align: 'center',
      color: '#09090B',
      opacity: 100,
      rotation: 0,
      visible: true,
      strokeEnabled: false,
      strokeColor: '#000000',
      strokeWidth: 2,
      shadowEnabled: true,
      shadowColor: '#000000',
      shadowBlur: 16,
      shadowOffsetX: 0,
      shadowOffsetY: 6,
      shadowOpacity: 40,
      backdropEnabled: true,
      backdropColor: '#FACC15',
      backdropOpacity: 100,
      backdropPaddingX: 26,
      backdropPaddingY: 10,
      backdropRadius: 8,
    },
  ];
}

export const INITIAL_WATERMARK_CONFIG: WatermarkConfig = {
  initials: 'CS',
  subLabel: 'INSCREVA-SE',
  showSubLabel: false,
  shape: 'rounded',
  cornerRadius: 24,
  fontFamily: 'Outfit',
  fontSize: 64,
  fontWeight: 800,
  letterSpacing: -1,
  textColor: '#FFFFFF',
  textOpacity: 100,
  bgOpacity: 95,
  borderEnabled: true,
  borderColor: '#FFFFFF',
  borderWidth: 3,
  strokeEnabled: false,
  strokeColor: '#09090B',
  strokeWidth: 2,
  shadowEnabled: true,
  shadowColor: '#000000',
  shadowBlur: 12,
  shadowOffsetY: 4,
  shadowOpacity: 50,
  usePattern: true,
};

export const INITIAL_STUDIO_STATE: StudioState = {
  activeTab: 'gradient',
  youtubeSubMode: 'thumbnail',
  resolutionId: 'desktop-fhd',
  customWidth: 1600,
  customHeight: 900,
  gradient: {
    type: 'mesh',
    angle: 135,
    focalX: 50,
    focalY: 45,
    stops: [
      { id: 'stop-1', color: '#0B1120', position: 0 },
      { id: 'stop-2', color: '#1D4ED8', position: 48 },
      { id: 'stop-3', color: '#0EA5E9', position: 100 },
    ],
    noiseOpacity: 14,
    vignetteOpacity: 24,
    meshSeed: 42,
    meshSpread: 72,
  },
  geometric: {
    type: 'grid',
    color: '#E2E8F0',
    secondaryColor: '#38BDF8',
    opacity: 16,
    scale: 64,
    strokeWidth: 1.5,
    rotation: 0,
    fillMode: 'stroke',
    blendMode: 'overlay',
    seed: 17,
    count: 9,
  },
  textLayers: createInitialTextLayers('thumbnail'),
  selectedTextId: 'layer-title',
  backdropScrim: 18,
  showSafeZones: false,
  watermark: INITIAL_WATERMARK_CONFIG,
};

// HSL to HEX helper for tasteful harmonic randomization
function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function generateRandomGradient(): GradientConfig {
  const types: GradientType[] = ['linear', 'radial', 'conic', 'mesh'];
  const type = types[Math.floor(Math.random() * types.length)];

  // 50% chance to build a custom harmonic palette, 50% chance to riff on a curated mood
  const baseHue = Math.floor(Math.random() * 360);
  const harmony = Math.floor(Math.random() * 3); // 0: analogous, 1: split-complementary, 2: monochrome depth
  const stopCount = Math.random() > 0.45 ? 3 : 2;

  const stops = [];
  if (harmony === 0) {
    // Rich dark-to-vivid analogous
    stops.push({
      id: `stop-${Date.now()}-1`,
      color: hslToHex(baseHue, 45 + Math.random() * 30, 8 + Math.random() * 10),
      position: 0,
    });
    if (stopCount === 3) {
      stops.push({
        id: `stop-${Date.now()}-2`,
        color: hslToHex(baseHue + 28, 65 + Math.random() * 20, 34 + Math.random() * 16),
        position: 48,
      });
    }
    stops.push({
      id: `stop-${Date.now()}-3`,
      color: hslToHex(baseHue + 55, 72 + Math.random() * 20, 52 + Math.random() * 18),
      position: 100,
    });
  } else if (harmony === 1) {
    // Bold editorial split-tone
    stops.push({
      id: `stop-${Date.now()}-1`,
      color: hslToHex(baseHue, 55 + Math.random() * 25, 12 + Math.random() * 10),
      position: 0,
    });
    if (stopCount === 3) {
      stops.push({
        id: `stop-${Date.now()}-2`,
        color: hslToHex(baseHue + 135, 65 + Math.random() * 20, 38 + Math.random() * 14),
        position: 52,
      });
    }
    stops.push({
      id: `stop-${Date.now()}-3`,
      color: hslToHex(baseHue + 170, 75 + Math.random() * 15, 56 + Math.random() * 14),
      position: 100,
    });
  } else {
    // Sleek studio light or deep monochrome
    const isLight = Math.random() > 0.75;
    stops.push({
      id: `stop-${Date.now()}-1`,
      color: hslToHex(baseHue, isLight ? 45 : 35, isLight ? 88 : 9),
      position: 0,
    });
    if (stopCount === 3) {
      stops.push({
        id: `stop-${Date.now()}-2`,
        color: hslToHex(baseHue + 15, isLight ? 60 : 58, isLight ? 72 : 30),
        position: 50,
      });
    }
    stops.push({
      id: `stop-${Date.now()}-3`,
      color: hslToHex(baseHue + 32, isLight ? 68 : 65, isLight ? 58 : 54),
      position: 100,
    });
  }

  return {
    type,
    angle: Math.floor(Math.random() * 360),
    focalX: 25 + Math.floor(Math.random() * 50),
    focalY: 25 + Math.floor(Math.random() * 50),
    stops,
    noiseOpacity: 8 + Math.floor(Math.random() * 18),
    vignetteOpacity: 12 + Math.floor(Math.random() * 30),
    meshSeed: Math.floor(Math.random() * 1000),
    meshSpread: 55 + Math.floor(Math.random() * 35),
  };
}

export function generateRandomGeometric(): GeometricConfig {
  const activeTypes: GeometricPatternType[] = [
    'grid',
    'dots',
    'diagonals',
    'circles',
    'triangles',
    'hexagons',
    'waves',
    'bauhaus',
    'orbs',
  ];
  const type = activeTypes[Math.floor(Math.random() * activeTypes.length)];
  const blendModes: BlendModeOption[] = ['source-over', 'overlay', 'screen', 'soft-light'];
  const fillModes: ('stroke' | 'fill' | 'mixed')[] = ['stroke', 'fill', 'mixed'];
  const colors = ['#FFFFFF', '#F8FAFC', '#E2E8F0', '#FEF3C7', '#BAE6FD', '#09090B'];

  return {
    type,
    color: colors[Math.floor(Math.random() * colors.length)],
    secondaryColor: colors[Math.floor(Math.random() * colors.length)],
    opacity: 12 + Math.floor(Math.random() * 26),
    scale: 36 + Math.floor(Math.random() * 96),
    strokeWidth: Number((1 + Math.random() * 3.5).toFixed(1)),
    rotation: Math.floor(Math.random() * 8) * 15,
    fillMode: fillModes[Math.floor(Math.random() * fillModes.length)],
    blendMode: blendModes[Math.floor(Math.random() * blendModes.length)],
    seed: Math.floor(Math.random() * 9999),
    count: 5 + Math.floor(Math.random() * 10),
  };
}
