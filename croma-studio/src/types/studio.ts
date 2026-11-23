export type MainTab = 'gradient' | 'shapes' | 'youtube';

export type YouTubeSubMode = 'thumbnail' | 'banner' | 'watermark';

export type GradientType = 'linear' | 'radial' | 'conic' | 'mesh';

export interface ColorStop {
  id: string;
  color: string;
  position: number; // 0 to 100
}

export interface GradientConfig {
  type: GradientType;
  angle: number; // 0 to 360
  focalX: number; // 0 to 100
  focalY: number; // 0 to 100
  stops: ColorStop[];
  noiseOpacity: number; // 0 to 100
  vignetteOpacity: number; // 0 to 100
  meshSeed: number;
  meshSpread: number; // 30 to 100
}

export type GeometricPatternType =
  | 'none'
  | 'grid'
  | 'dots'
  | 'diagonals'
  | 'circles'
  | 'triangles'
  | 'hexagons'
  | 'waves'
  | 'bauhaus'
  | 'orbs';

export type ShapeFillMode = 'stroke' | 'fill' | 'mixed';

export type BlendModeOption =
  | 'source-over'
  | 'overlay'
  | 'screen'
  | 'soft-light'
  | 'multiply'
  | 'lighter';

export interface GeometricConfig {
  type: GeometricPatternType;
  color: string;
  secondaryColor: string;
  opacity: number; // 0 to 100
  scale: number; // 16 to 240
  strokeWidth: number; // 1 to 14
  rotation: number; // 0 to 360
  fillMode: ShapeFillMode;
  blendMode: BlendModeOption;
  seed: number;
  count: number; // used for floating shapes (bauhaus, orbs)
}

export type TextAlignOption = 'left' | 'center' | 'right';

export interface TextLayer {
  id: string;
  text: string;
  x: number; // normalized 0..1 relative to canvas width
  y: number; // normalized 0..1 relative to canvas height
  fontFamily: string;
  fontSize: number; // percentage of canvas height * 10 (or relative px at 720p base)
  fontWeight: number; // 400..900
  letterSpacing: number; // -6 to 30
  lineHeight: number; // 0.9 to 1.8
  uppercase: boolean;
  align: TextAlignOption;
  color: string;
  opacity: number; // 0 to 100
  rotation: number; // -45 to 45
  visible: boolean;
  // Outline / Stroke
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number; // 1 to 20
  // Shadow
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number; // 0 to 60
  shadowOffsetX: number; // -30 to 30
  shadowOffsetY: number; // -30 to 30
  shadowOpacity: number; // 0 to 100
  // Optional backdrop highlight
  backdropEnabled: boolean;
  backdropColor: string;
  backdropOpacity: number; // 0 to 100
  backdropPaddingX: number;
  backdropPaddingY: number;
  backdropRadius: number;
}

export type WatermarkShape = 'rounded' | 'circle' | 'square' | 'squircle' | 'hexagon' | 'cutout';

export interface WatermarkConfig {
  initials: string;
  subLabel: string;
  showSubLabel: boolean;
  shape: WatermarkShape;
  cornerRadius: number; // 0 to 50 (% of half size for rounded)
  fontFamily: string;
  fontSize: number; // 24 to 108 px on 150x150 canvas
  fontWeight: number;
  letterSpacing: number;
  textColor: string;
  textOpacity: number; // 0 to 100
  bgOpacity: number; // 10 to 100
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number; // 1 to 12
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number; // 1 to 10
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  usePattern: boolean;
}

export interface ResolutionPreset {
  id: string;
  label: string;
  platform: string;
  width: number;
  height: number;
  category: 'social' | 'youtube' | 'web';
}

export interface GradientPalette {
  id: string;
  name: string;
  stops: { color: string; position: number }[];
  angle: number;
  type: GradientType;
  shapeColor: string;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'bmp';

export interface StudioState {
  activeTab: MainTab;
  youtubeSubMode: YouTubeSubMode;
  resolutionId: string;
  customWidth: number;
  customHeight: number;
  gradient: GradientConfig;
  geometric: GeometricConfig;
  textLayers: TextLayer[];
  selectedTextId: string | null;
  backdropScrim: number; // 0 to 70% dark contrast overlay for YouTube text legibility
  showSafeZones: boolean;
  watermark: WatermarkConfig;
}
