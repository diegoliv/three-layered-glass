import {
  BufferGeometry,
  Camera,
  Color,
  ColorRepresentation,
  Mesh,
  Object3D,
  Scene,
  ShaderMaterial,
  Texture,
  TextureDataType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';

export type LayeredGlassBackend = 'auto' | 'analytic' | 'bvh';
export type LayeredGlassQualityName = 'low' | 'medium' | 'high';
export type LayeredGlassSceneSync = 'auto' | 'manual';
export type LayeredGlassRayVisibility = 'auto' | 'opaque' | 'glass' | 'ignore';
export type LayeredGlassMode = 'volume' | 'thin';
export type LayeredGlassDepthMode = 'none' | 'opaque' | 'front-surface';
export type LayeredGlassShape = 'auto' | 'box' | 'roundedBox' | 'rounded-box' | 'sphere';
export type LayeredGlassVector3Like = Vector3 | [number, number, number];

export interface LayeredGlassQualityOptions {
  maxTraversals?: number;
  spectral?: boolean;
  roughSamples?: 1 | 2 | 3 | number;
  resolutionScale?: number;
  bvhLeafSize?: number;
}

export interface LayeredGlassRaySceneOptions {
  autoOpaqueIntersections?: boolean;
  autoDiscoverGlass?: boolean;
  /** Layer indices, not bit masks. */
  includeLayers?: number[] | null;
  exclude?: ((object: Object3D) => boolean) | null;
  onWarning?: ((message: string, object?: Object3D) => void) | null;
  quality?: LayeredGlassQualityName | LayeredGlassQualityOptions;
  worker?: boolean;
}

/** @deprecated Analytic shape proxies are optional fast paths in 0.4. */
export interface LayeredGlassVolumeOptions {
  shape?: LayeredGlassShape;
  radius?: number;
  halfExtents?: LayeredGlassVector3Like | null;
  center?: LayeredGlassVector3Like | null;
}

export interface LayeredGlassMaterialParameters extends LayeredGlassVolumeOptions {
  mode?: LayeredGlassMode;
  /** Used by `mode: 'thin'`. Volume mode derives distance from geometry. */
  thickness?: number;
  ior?: number;
  roughness?: number;
  attenuationDistance?: number;
  attenuationColor?: ColorRepresentation;
  refractionReach?: number;
  reflectionStrength?: number;
  dispersion?: number;
  bodyTintStrength?: number;
  /** Used by analytic / legacy backends. */
  iterations?: number;
  /** Used by the legacy backend. */
  priority?: number;
}

export class LayeredGlassMaterial extends ShaderMaterial {
  readonly isLayeredGlassMaterial: true;
  mode: LayeredGlassMode;
  thickness: number;
  priority: number;
  /** @deprecated Analytic proxy setting. */
  shape: LayeredGlassShape;
  /** @deprecated Analytic proxy setting. */
  radius: number;
  /** @deprecated Analytic proxy setting. */
  halfExtents: LayeredGlassVector3Like | null;
  /** @deprecated Analytic proxy setting. */
  center: LayeredGlassVector3Like | null;
  bodyTintStrength: number;
  ior: number;
  roughness: number;
  attenuationDistance: number;
  attenuationColor: Color;
  refractionReach: number;
  reflectionStrength: number;
  dispersion: number;
  iterations: number;
  constructor(parameters?: LayeredGlassMaterialParameters);
  setSize(width: number, height: number): this;
  setCamera(camera: Camera): this;
  setComposerTextures(
    sourceTexture: Texture,
    backPositionTexture: Texture,
    backNormalTexture: Texture,
  ): this;
  copy(source: LayeredGlassMaterial): this;
}

export interface LayeredGlassPrepareOptions {
  worker?: boolean;
  onProgress?: (progress: number) => void;
  strategy?: unknown;
  targetLeafSize?: number;
  indirect?: boolean;
  verbose?: boolean;
}

export interface LayeredGlassComposerOptions {
  backend?: LayeredGlassBackend;
  quality?: LayeredGlassQualityName | LayeredGlassQualityOptions;
  qualityOverrides?: LayeredGlassQualityOptions;
  worker?: boolean;
  sceneSync?: LayeredGlassSceneSync;
  autoPrepare?: boolean;
  autoOpaqueIntersections?: boolean;
  resolutionScale?: number;
  spectral?: boolean;
  roughSamples?: number;
  maxMedia?: number;
  rayScene?: LayeredGlassRaySceneOptions;
  layered?: boolean;
  autoDiscover?: boolean;
  /** @deprecated Opaque discovery is controlled by autoOpaqueIntersections. */
  autoDiscoverBlockers?: boolean;
  foregroundPrivateLayer?: number;
  foregroundLayer?: number | null;
  colorType?: TextureDataType;
  renderToScreen?: boolean;
  depthMode?: LayeredGlassDepthMode;
  manageRendererInfo?: boolean;
  /** Analytic backend option. */
  maxVolumes?: number;
  maxTraversals?: number;
  /** Analytic backend option. */
  entrySteps?: number;
  /** Analytic backend option. */
  exitSteps?: number;
  /** Analytic backend option. */
  opaqueSteps?: number;
  onWarning?: (message: string, object?: Object3D) => void;
}

export interface LayeredGlassRenderOptions {
  glassObjects?: Object3D[];
  /** @deprecated Opaque meshes are automatic in the BVH backend. */
  blockerObjects?: Mesh[];
  /** @deprecated Opaque meshes are automatic in the BVH backend. */
  blockers?: Mesh[];
  foregroundObjects?: Object3D[];
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

export interface LayeredGlassObjectRecord {
  object: Mesh;
  firstTriangle: number;
  triangleCount: number;
  glassTriangles: number;
  opaqueTriangles: number;
  volumeId: number;
}

export interface LayeredGlassTriangleSource {
  mesh: Mesh;
  offset: number;
  visibility: LayeredGlassRayVisibility;
  volumeId: number;
}

export interface LayeredGlassRaySceneBuildResult {
  geometry: BufferGeometry;
  meshes: Mesh[];
  objects: LayeredGlassObjectRecord[];
  triangleSources: LayeredGlassTriangleSource[];
  triangleCount: number;
  glassTriangleCount: number;
  opaqueTriangleCount: number;
  volumeCount: number;
}

export class LayeredGlassComposer {
  readonly renderer: WebGLRenderer;
  backend: LayeredGlassBackend;
  readonly activeBackend: 'analytic' | 'bvh';
  readonly ready: boolean;
  readonly building: boolean;
  readonly rayScene: LayeredRayScene | null;
  layered: boolean;
  autoDiscover: boolean;
  autoDiscoverBlockers: boolean;
  autoOpaqueIntersections: boolean;
  foregroundLayer: number | null;
  renderToScreen: boolean;
  depthMode: LayeredGlassDepthMode;
  manageRendererInfo: boolean;
  readonly outputTexture: Texture | null;
  readonly outputRenderTarget: WebGLRenderTarget | null;
  readonly depthTexture: Texture | null;
  readonly opaqueDepthTexture: Texture | null;
  readonly width: number;
  readonly height: number;
  constructor(renderer: WebGLRenderer, options?: LayeredGlassComposerOptions);
  prepare(scene: Scene, options?: LayeredGlassPrepareOptions): Promise<this>;
  invalidateScene(): this;
  invalidateGeometry(object?: Object3D): this;
  invalidateMaterial(object?: Object3D): this;
  setRayVisibility(object: Object3D, visibility?: LayeredGlassRayVisibility): this;
  /** Optional analytic fast-path proxy. Not required by the BVH backend. */
  setIntersectionProxy(object: Object3D, proxy: LayeredGlassVolumeOptions): this;
  add(...objects: Mesh[]): this;
  remove(...objects: Mesh[]): this;
  clear(): this;
  /** @deprecated Opaque meshes are discovered automatically. */
  addBlocker(object: Mesh, options?: LayeredGlassVolumeOptions): this;
  /** @deprecated Opaque meshes are discovered automatically. */
  addBlockers(...objects: Mesh[]): this;
  /** @deprecated Opaque meshes are discovered automatically. */
  addOpaque(object: Mesh, options?: LayeredGlassVolumeOptions): this;
  removeBlocker(...objects: Mesh[]): this;
  removeOpaque(...objects: Mesh[]): this;
  clearBlockers(): this;
  addForeground(...objects: Object3D[]): this;
  removeForeground(...objects: Object3D[]): this;
  clearForeground(): this;
  setSize(width: number, height: number): this;
  render(scene: Scene, camera: Camera, options?: LayeredGlassRenderOptions): Texture;
  getMemoryReport(): LayeredGlassMemoryReport;
  dispose(): void;
}

export class BVHLayeredGlassComposer {
  readonly renderer: WebGLRenderer;
  readonly rayScene: LayeredRayScene;
  readonly ready: boolean;
  readonly building: boolean;
  layered: boolean;
  autoDiscover: boolean;
  autoOpaqueIntersections: boolean;
  foregroundLayer: number | null;
  readonly outputTexture: Texture | null;
  readonly outputRenderTarget: WebGLRenderTarget | null;
  readonly depthTexture: Texture | null;
  readonly opaqueDepthTexture: Texture | null;
  constructor(renderer: WebGLRenderer, options?: LayeredGlassComposerOptions);
  prepare(scene: Scene, options?: LayeredGlassPrepareOptions): Promise<this>;
  invalidateScene(): this;
  invalidateGeometry(object?: Object3D): this;
  invalidateMaterial(object?: Object3D): this;
  setRayVisibility(object: Object3D, visibility?: LayeredGlassRayVisibility): this;
  add(...objects: Mesh[]): this;
  remove(...objects: Mesh[]): this;
  clear(): this;
  addForeground(...objects: Object3D[]): this;
  removeForeground(...objects: Object3D[]): this;
  clearForeground(): this;
  setSize(width: number, height: number): this;
  render(scene: Scene, camera: Camera, options?: LayeredGlassRenderOptions): Texture;
  getMemoryReport(): LayeredGlassMemoryReport;
  dispose(): void;
}

export class AnalyticLayeredGlassComposer {
  constructor(renderer: WebGLRenderer, options?: LayeredGlassComposerOptions);
  render(scene: Scene, camera: Camera, options?: LayeredGlassRenderOptions): Texture;
  dispose(): void;
}

export class LayeredRayScene {
  readonly geometry: BufferGeometry | null;
  readonly triangleCount: number;
  readonly glassTriangleCount: number;
  readonly opaqueTriangleCount: number;
  readonly volumeCount: number;
  readonly ready: boolean;
  readonly building: boolean;
  constructor(options?: LayeredGlassRaySceneOptions);
  build(scene: Scene, options?: LayeredGlassPrepareOptions): Promise<this>;
  rebuild(scene: Scene, options?: LayeredGlassPrepareOptions): Promise<this>;
  refreshMaterials(scene: Scene): boolean;
  getMemoryReport(): LayeredGlassMemoryReport;
  dispose(): void;
}

export class RaySceneBuilder {
  constructor(options?: LayeredGlassRaySceneOptions);
  collect(scene: Scene): Mesh[];
  build(scene: Scene): LayeredGlassRaySceneBuildResult;
  refreshMaterialAttributes(
    targetGeometry: BufferGeometry,
    triangleSources: LayeredGlassTriangleSource[],
  ): boolean;
}

export const QUALITY_PRESETS: Readonly<
  Record<LayeredGlassQualityName, Readonly<LayeredGlassQualityOptions>>
>;
export const RAY_VISIBILITY: Readonly<
  Record<'AUTO' | 'OPAQUE' | 'GLASS' | 'IGNORE', LayeredGlassRayVisibility>
>;
export const RAY_SURFACE_KIND: Readonly<{
  OPAQUE: 0;
  GLASS: 1;
}>;
export const GLASS_MODE: Readonly<Record<'VOLUME' | 'THIN', LayeredGlassMode>>;
export function resolveLayeredGlassQuality(
  quality?: LayeredGlassQualityName | LayeredGlassQualityOptions,
  overrides?: LayeredGlassQualityOptions,
): LayeredGlassQualityOptions;

/** @deprecated Use LayeredGlassComposer. */
export class LayeredGlassRenderer extends LayeredGlassComposer {
  readonly isLayeredGlassRenderer: true;
}

export interface LayeredGlassPassOptions extends LayeredGlassComposerOptions {
  glassObjects?: Object3D[];
  blockerObjects?: Mesh[];
  blockers?: Mesh[];
  foregroundObjects?: Object3D[];
}

export class LayeredGlassPass extends Pass {
  scene: Scene;
  camera: Camera;
  backend: LayeredGlassBackend;
  quality: LayeredGlassQualityName | LayeredGlassQualityOptions;
  layered: boolean;
  readonly composer: LayeredGlassComposer | null;
  readonly outputTexture: Texture | null;
  readonly depthTexture: Texture | null;
  constructor(scene: Scene, camera: Camera, options?: LayeredGlassPassOptions);
  prepare(options?: LayeredGlassPrepareOptions): Promise<LayeredGlassComposer>;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function supportsLayeredGlass(renderer: WebGLRenderer): boolean;
export function supportsLayeredGlassFloatTargets(renderer: WebGLRenderer): boolean;

/** @deprecated Use composer.setRayVisibility(object, 'opaque'). */
export function setLayeredGlassBlocker(
  object: Mesh,
  options?: LayeredGlassVolumeOptions,
): Mesh;
/** @deprecated */
export function clearLayeredGlassBlocker(object: Mesh): Mesh;
/** @deprecated */
export function isLayeredGlassBlocker(object: Object3D): boolean;

export const LAYERED_GLASS_SHAPES: Readonly<{
  AUTO: 'auto';
  BOX: 'box';
  ROUNDED_BOX: 'roundedBox';
  SPHERE: 'sphere';
}>;

export class LegacyLayeredGlassComposer {
  constructor(renderer: WebGLRenderer, options?: Record<string, unknown>);
  render(scene: Scene, camera: Camera, options?: LayeredGlassRenderOptions): Texture;
  dispose(): void;
}
export class LegacyLayeredGlassPass extends Pass {
  constructor(scene: Scene, camera: Camera, options?: Record<string, unknown>);
  dispose(): void;
}
export function supportsLegacyLayeredGlass(renderer: WebGLRenderer): boolean;
export function sortGlassObjectsBackToFront<T extends Mesh>(
  objects: Iterable<T>,
  camera: Camera,
  target?: T[],
): T[];
