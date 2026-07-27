import type { Mesh } from 'three';
import type {
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from 'react';
import type { ThreeElements } from '@react-three/fiber';
import type {
  LayeredGlassAdaptiveQualityOptions,
} from '../advanced.js';
import type {
  LayeredGlassComposer as CoreLayeredGlassComposer,
  LayeredGlassMaterial as CoreLayeredGlassMaterial,
  LayeredGlassMaterialParameters,
  LayeredGlassQualityName,
} from '../index.js';

export type LayeredGlassStatus = 'preparing' | 'ready' | 'error';

export interface LayeredGlassState {
  readonly status: LayeredGlassStatus;
  readonly progress: number;
  readonly error: unknown | null;
  readonly ready: boolean;
}

export interface LayeredGlassComposerProps {
  children?: ReactNode;
  enabled?: boolean;
  quality?: LayeredGlassQualityName;
  adaptive?: boolean | LayeredGlassAdaptiveQualityOptions;
  onReady?: (composer: CoreLayeredGlassComposer) => void;
  onProgress?: (progress: number) => void;
  onError?: (error: unknown, composer: CoreLayeredGlassComposer) => void;
}

export function LayeredGlassComposer(props: LayeredGlassComposerProps): ReactNode;
export function useLayeredGlass(): LayeredGlassState;

type SafeShaderMaterialProps = Omit<
  ThreeElements['shaderMaterial'],
  | 'args'
  | 'children'
  | 'ref'
  | 'dispose'
  | 'uniforms'
  | 'defines'
  | 'vertexShader'
  | 'fragmentShader'
  | 'glslVersion'
  | 'transparent'
  | 'opacity'
  | 'depthTest'
  | 'depthWrite'
  | 'blending'
  | 'toneMapped'
>;

export type LayeredGlassMaterialProps = SafeShaderMaterialProps
  & LayeredGlassMaterialParameters
  & {
    dispose?: boolean;
  };

export const LayeredGlassMaterial: ForwardRefExoticComponent<
  LayeredGlassMaterialProps & RefAttributes<CoreLayeredGlassMaterial>
>;

export interface LayeredGlassProps
  extends Omit<ThreeElements['mesh'], 'material' | 'ref'> {
  materialProps?: LayeredGlassMaterialProps;
}

export const LayeredGlass: ForwardRefExoticComponent<
  LayeredGlassProps & RefAttributes<Mesh>
>;

export function useLayeredGlassMaterial(
  parameters?: LayeredGlassMaterialParameters,
): CoreLayeredGlassMaterial;
