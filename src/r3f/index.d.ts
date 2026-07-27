import type {
  Camera,
  Mesh,
  Object3D,
  Scene,
  TextureDataType,
  WebGLRenderTarget,
} from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type {
  ForwardRefExoticComponent,
  MutableRefObject,
  ReactNode,
  RefAttributes,
} from 'react';
import type { ThreeElements } from '@react-three/fiber';
import type {
  LayeredGlassBackend,
  LayeredGlassComposer as CoreLayeredGlassComposer,
  LayeredGlassMaterial as CoreLayeredGlassMaterial,
  LayeredGlassMaterialParameters,
  LayeredGlassPass as CoreLayeredGlassPass,
  LayeredGlassPassOptions,
  LayeredGlassQualityName,
  LayeredGlassQualityOptions,
  LayeredGlassRayVisibility,
  LayeredGlassShape,
  LayeredGlassVolumeOptions,
} from '../index.js';

export interface LayeredGlassComposerProps {
  children?: ReactNode;
  enabled?: boolean;
  renderPriority?: number;
  scene?: Scene;
  camera?: Camera;
  outputTarget?: WebGLRenderTarget | null;
  present?: boolean;
  toneMap?: boolean;
  glassObjects?: Mesh[];
  /** @deprecated Opaque meshes are automatic in the BVH backend. */
  blockerObjects?: Mesh[];
  /** @deprecated Opaque meshes are automatic in the BVH backend. */
  blockers?: Mesh[];
  foregroundObjects?: Object3D[];
  onCreated?: (composer: CoreLayeredGlassComposer) => void;
  onReady?: (composer: CoreLayeredGlassComposer) => void;
  onProgress?: (progress: number) => void;
  backend?: LayeredGlassBackend;
  quality?: LayeredGlassQualityName | LayeredGlassQualityOptions;
  worker?: boolean;
  sceneSync?: 'auto' | 'manual';
  sceneSyncInterval?: number;
  autoOpaqueIntersections?: boolean;
  resolutionScale?: number;
  coverageScale?: number;
  coverageSamples?: number;
  spectral?: boolean;
  roughSamples?: number;
  maxMedia?: number;
  layered?: boolean;
  autoDiscover?: boolean;
  autoDiscoverBlockers?: boolean;
  foregroundPrivateLayer?: number;
  foregroundLayer?: number | null;
  colorType?: TextureDataType;
  renderToScreen?: boolean;
  depthMode?: 'none' | 'opaque' | 'front-surface';
  manageRendererInfo?: boolean;
  maxVolumes?: number;
  maxTraversals?: number;
  entrySteps?: number;
  exitSteps?: number;
  opaqueSteps?: number;
}

export function LayeredGlassComposer(props: LayeredGlassComposerProps): ReactNode;
export function useLayeredGlassComposer(): CoreLayeredGlassComposer;

export interface LayeredGlassMaterialProps extends LayeredGlassMaterialParameters {
  attach?: string;
  dispose?: boolean;
}

export const LayeredGlassMaterial: ForwardRefExoticComponent<
  LayeredGlassMaterialProps & RefAttributes<CoreLayeredGlassMaterial>
>;

export interface LayeredGlassProps extends Omit<ThreeElements['mesh'], 'material' | 'ref'> {
  materialProps?: LayeredGlassMaterialProps;
}

export const LayeredGlass: ForwardRefExoticComponent<
  LayeredGlassProps & RefAttributes<Mesh>
>;

/** @deprecated Opaque meshes are included automatically by the BVH backend. */
export interface LayeredGlassBlockerProps
  extends Omit<ThreeElements['mesh'], 'ref'>,
    LayeredGlassVolumeOptions {
  shape?: LayeredGlassShape;
}

/** @deprecated Use a normal mesh. */
export const LayeredGlassBlocker: ForwardRefExoticComponent<
  LayeredGlassBlockerProps & RefAttributes<Mesh>
>;

export function useLayeredGlassMaterial(
  parameters?: LayeredGlassMaterialParameters,
): CoreLayeredGlassMaterial;

/** @deprecated Opaque meshes are automatic in the BVH backend. */
export function useLayeredGlassBlocker(
  objectRef: MutableRefObject<Mesh | null> | Mesh | null,
  options?: LayeredGlassVolumeOptions,
): void;

export function useLayeredGlassRayVisibility(
  objectRef: MutableRefObject<Object3D | null> | Object3D | null,
  visibility?: LayeredGlassRayVisibility,
): void;

export interface LayeredGlassEffectPassProps extends LayeredGlassPassOptions {
  composer: EffectComposer;
  index?: number;
  renderPriority?: number | null;
  enabled?: boolean;
  scene?: Scene;
  camera?: Camera;
  onCreated?: (pass: CoreLayeredGlassPass) => void;
}

export const LayeredGlassEffectPass: ForwardRefExoticComponent<
  LayeredGlassEffectPassProps & RefAttributes<CoreLayeredGlassPass>
>;
