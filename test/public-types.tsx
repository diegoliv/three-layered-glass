import { createRef } from 'react';
import {
  FrontSide,
  PerspectiveCamera,
  Scene,
  type Mesh,
  type WebGLRenderer,
} from 'three';
import {
  LayeredGlassComposer as CoreComposer,
  LayeredGlassMaterial as CoreMaterial,
} from 'three-layered-glass';
import {
  LayeredGlassComposer as AdvancedCoreComposer,
  LayeredGlassAdaptiveQuality,
  QUALITY_PRESETS,
} from 'three-layered-glass/advanced';
import { LegacyLayeredGlassComposer } from 'three-layered-glass/legacy';
import { LayeredGlassPass } from 'three-layered-glass/postprocessing';
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
  useLayeredGlass,
} from 'three-layered-glass/r3f';
import {
  LayeredGlassComposer as AdvancedLayeredGlassComposer,
  useLayeredGlassComposer,
} from 'three-layered-glass/r3f/advanced';
import { LayeredGlassEffectPass } from 'three-layered-glass/r3f/postprocessing';

declare const renderer: WebGLRenderer;
declare const effectComposer: import('three/addons/postprocessing/EffectComposer.js').EffectComposer;

const material = new CoreMaterial({
  ior: 1.5,
  roughness: 0.1,
  attenuationColor: '#cceeff',
});
const composer = new CoreComposer(renderer, { quality: 'medium' });
const advancedCoreComposer = new AdvancedCoreComposer(renderer, {
  backend: 'bvh',
  sceneSync: 'manual',
  maxTraversals: 8,
});
const adaptive = new LayeredGlassAdaptiveQuality(composer);
const legacy = new LegacyLayeredGlassComposer(renderer);
const pass = new LayeredGlassPass(
  new Scene(),
  new PerspectiveCamera(),
);

material.dispose();
adaptive.reset();
legacy.dispose();
pass.dispose();
advancedCoreComposer.dispose();
void QUALITY_PRESETS.medium;

function Status() {
  const state = useLayeredGlass();
  state.status satisfies 'preparing' | 'ready' | 'error';
  return null;
}

function AdvancedStatus() {
  const advancedComposer = useLayeredGlassComposer();
  void advancedComposer.outputTexture;
  return null;
}

export function PublicR3FScene() {
  const meshRef = createRef<Mesh>();
  return (
    <>
      <LayeredGlassComposer
        adaptive
        quality="medium"
        onError={(error) => { void error; }}
      >
        <Status />
      </LayeredGlassComposer>

      <mesh ref={meshRef}>
        <boxGeometry />
        <LayeredGlassMaterial
          side={FrontSide}
          roughness={0.2}
          attenuationColor="#ffffff"
        />
      </mesh>

      <AdvancedLayeredGlassComposer
        backend="bvh"
        renderPriority={2}
        sceneSync="manual"
      >
        <AdvancedStatus />
      </AdvancedLayeredGlassComposer>

      <LayeredGlassEffectPass composer={effectComposer} />
    </>
  );
}

// The common R3F entrypoint intentionally hides integration-only controls.
// @ts-expect-error backend belongs to three-layered-glass/r3f/advanced
const invalidPrimaryProps = <LayeredGlassComposer backend="analytic" />;
void invalidPrimaryProps;

// @ts-expect-error backend belongs to three-layered-glass/advanced
const invalidPrimaryComposer = new CoreComposer(renderer, { backend: 'bvh' });
void invalidPrimaryComposer;

// @ts-expect-error compositor-owned material invariants are not public props
const invalidMaterialProps = <LayeredGlassMaterial transparent />;
void invalidMaterialProps;
