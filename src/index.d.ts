import type {
  Camera,
  Color,
  ColorRepresentation,
  Object3D,
  Scene,
  ShaderMaterial,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

export type LayeredGlassMode = 'volume' | 'thin';
export type LayeredGlassQualityName = 'low' | 'medium' | 'high';
export type LayeredGlassSceneSync = 'auto' | 'manual';
export type LayeredGlassRayVisibility = 'auto' | 'opaque' | 'glass' | 'ignore';

export interface LayeredGlassMaterialParameters {
  mode?: LayeredGlassMode;
  /** Used by thin mode. Volume mode derives optical distance from geometry. */
  thickness?: number;
  ior?: number;
  roughness?: number;
  attenuationDistance?: number;
  attenuationColor?: ColorRepresentation;
  refractionReach?: number;
  reflectionStrength?: number;
  dispersion?: number;
  bodyTintStrength?: number;
}

export class LayeredGlassMaterial extends ShaderMaterial {
  readonly isLayeredGlassMaterial: true;
  mode: LayeredGlassMode;
  thickness: number;
  bodyTintStrength: number;
  ior: number;
  roughness: number;
  attenuationDistance: number;
  attenuationColor: Color;
  refractionReach: number;
  reflectionStrength: number;
  dispersion: number;
  constructor(parameters?: LayeredGlassMaterialParameters);
  copy(source: LayeredGlassMaterial): this;
}

export interface LayeredGlassComposerOptions {
  quality?: LayeredGlassQualityName;
  worker?: boolean;
  sceneSync?: LayeredGlassSceneSync;
  /** Minimum milliseconds between automatic scene signature checks. */
  sceneSyncInterval?: number;
  autoPrepare?: boolean;
  /** Resolution of the expensive transmission pass, from 0.1 to 1. */
  resolutionScale?: number;
  /** Resolution of glass coverage and front reflection, from 0.25 to 1. */
  coverageScale?: number;
  /** MSAA samples for the coverage target. */
  coverageSamples?: number;
  /** Enables FXAA for the scalable transmission buffer. */
  transmissionAntialias?: boolean;
}

export interface LayeredGlassPrepareOptions {
  worker?: boolean;
  onProgress?: (progress: number) => void;
}

export interface LayeredGlassRenderOptions {
  outputTarget?: WebGLRenderTarget | null;
  present?: boolean;
  toneMap?: boolean;
  width?: number;
  height?: number;
}

export interface LayeredGlassMemoryReport {
  triangles: number;
  glassTriangles: number;
  opaqueTriangles: number;
  volumes: number;
  geometryBytes: number;
  bvhBytes: number;
  estimatedGpuBytes: number;
  totalBytes: number;
}

export class LayeredGlassComposer {
  readonly renderer: WebGLRenderer;
  readonly activeBackend: 'analytic' | 'bvh';
  readonly ready: boolean;
  readonly building: boolean;
  readonly outputTexture: Texture | null;
  readonly outputRenderTarget: WebGLRenderTarget | null;
  readonly depthTexture: Texture | null;
  readonly opaqueDepthTexture: Texture | null;
  readonly width: number;
  readonly height: number;
  readonly resolutionScale: number;
  readonly coverageScale: number;
  readonly coverageSamples: number;
  readonly transmissionAntialias: boolean;
  constructor(renderer: WebGLRenderer, options?: LayeredGlassComposerOptions);
  prepare(scene: Scene, options?: LayeredGlassPrepareOptions): Promise<this>;
  invalidateScene(): this;
  invalidateGeometry(object?: Object3D): this;
  invalidateMaterial(object?: Object3D): this;
  setRayVisibility(
    object: Object3D,
    visibility?: LayeredGlassRayVisibility,
  ): this;
  setResolutionScale(value: number): this;
  setCoverageScale(value: number): this;
  setCoverageSamples(value: number): this;
  setTransmissionAntialias(value: boolean): this;
  render(
    scene: Scene,
    camera: Camera,
    options?: LayeredGlassRenderOptions,
  ): Texture;
  getMemoryReport(): LayeredGlassMemoryReport;
  dispose(): void;
}

export function supportsLayeredGlass(renderer: WebGLRenderer): boolean;
