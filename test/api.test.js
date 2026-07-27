import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import {
  LayeredGlassAdaptiveQuality,
  LayeredGlassComposer,
  LayeredGlassMaterial,
  LayeredGlassPass,
  LayeredGlassRenderer,
  LegacyLayeredGlassComposer,
  LegacyLayeredGlassPass,
  RaySceneBuilder,
  supportsLayeredGlass,
} from '../src/index.js';

function createRendererStub() {
  const context = {
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
    getExtension(name) {
      return name === 'EXT_color_buffer_float' ? {} : null;
    },
    getParameter(parameter) {
      return parameter === this.MAX_FRAGMENT_UNIFORM_VECTORS ? 256 : 0;
    },
  };

  return {
    isWebGLRenderer: true,
    capabilities: { isWebGL2: true, maxSamples: 4 },
    getContext() {
      return context;
    },
  };
}

test('LayeredGlassRenderer remains a compatibility alias', () => {
  const renderer = createRendererStub();
  const alias = new LayeredGlassRenderer(renderer);

  assert.ok(alias instanceof LayeredGlassComposer);
  assert.equal(alias.isLayeredGlassRenderer, true);

  alias.dispose();
});

test('composer exposes runtime BVH resolution and surface controls', () => {
  const composer = new LayeredGlassComposer(createRendererStub(), {
    quality: 'medium',
  });

  assert.equal(composer.resolutionScale, 0.75);
  assert.equal(composer.coverageScale, 1);
  assert.equal(composer.coverageSamples, 0);
  assert.equal(composer.transmissionAntialias, false);
  assert.equal(composer.setResolutionScale(0.55), composer);
  assert.equal(composer.setCoverageScale(0.8), composer);
  assert.equal(composer.setCoverageSamples(2), composer);
  assert.equal(composer.setTransmissionAntialias(true), composer);
  assert.equal(composer.resolutionScale, 0.55);
  assert.equal(composer.coverageScale, 0.8);
  assert.equal(composer.coverageSamples, 2);
  assert.equal(composer.transmissionAntialias, true);

  composer.dispose();
});

test('LayeredGlassPass exposes the automatic backend options', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const pass = new LayeredGlassPass(scene, camera, {
    backend: 'bvh',
    quality: 'low',
    transmissionAntialias: true,
  });

  assert.ok(pass instanceof Pass);
  assert.equal(pass.needsSwap, true);
  assert.equal(pass.backend, 'bvh');
  assert.equal(pass.quality, 'low');
  assert.equal(pass.transmissionAntialias, true);
  assert.equal(pass.setTransmissionAntialias(false), pass);
  assert.equal(pass.transmissionAntialias, false);

  pass.dispose();
});

test('adaptive quality changes only the scalable BVH transmission buffer', () => {
  const scales = [];
  const composer = {
    resolutionScale: 0.55,
    setResolutionScale(value) {
      this.resolutionScale = value;
      scales.push(value);
    },
  };
  const adaptive = new LayeredGlassAdaptiveQuality(composer, {
    minScale: 0.45,
    maxScale: 0.65,
    initialScale: 0.55,
    targetFrameTime: 1000 / 30,
    adjustmentInterval: 250,
    smoothing: 1,
    stepDown: 0.05,
    stepUp: 0.025,
  });

  assert.deepEqual(scales, [0.55]);
  assert.equal(adaptive.update(50, 0), true);
  assert.equal(adaptive.scale, 0.5);
  assert.equal(adaptive.update(50, 100), false);
  assert.equal(adaptive.update(50, 300), true);
  assert.equal(adaptive.scale, 0.45);
  assert.equal(adaptive.update(16, 600), true);
  assert.equal(adaptive.scale, 0.475);
  assert.equal(adaptive.reset(0.9), adaptive);
  assert.equal(adaptive.scale, 0.65);
  assert.deepEqual(scales, [0.55, 0.5, 0.45, 0.475, 0.65]);
});

test('legacy 0.2 classes remain available explicitly', () => {
  const renderer = createRendererStub();
  const legacy = new LegacyLayeredGlassComposer(renderer);
  const legacyPass = new LegacyLayeredGlassPass(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
  );

  assert.ok(legacy instanceof LegacyLayeredGlassComposer);
  assert.ok(legacyPass instanceof Pass);

  legacy.dispose();
  legacyPass.dispose();
});

test('RaySceneBuilder discovers opaque meshes and arbitrary glass geometry', () => {
  const scene = new THREE.Scene();
  const opaque = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2, 0.2),
    new THREE.MeshStandardMaterial({ color: '#ff8844' }),
  );
  const glass = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.8, 0.2, 24, 6),
    new LayeredGlassMaterial({ ior: 1.52 }),
  );
  scene.add(opaque, glass);

  const result = new RaySceneBuilder().build(scene);

  assert.ok(result.opaqueTriangleCount > 0);
  assert.ok(result.glassTriangleCount > 0);
  assert.equal(result.volumeCount, 1);
  assert.equal(
    result.triangleCount,
    result.opaqueTriangleCount + result.glassTriangleCount,
  );
  assert.equal(result.geometry.getAttribute('rayMeta').count, result.triangleCount * 3);

  result.geometry.dispose();
  opaque.geometry.dispose();
  opaque.material.dispose();
  glass.geometry.dispose();
  glass.material.dispose();
});

test('RaySceneBuilder preserves and refreshes glass attenuation color', () => {
  const scene = new THREE.Scene();
  const material = new LayeredGlassMaterial({
    attenuationColor: '#ff0000',
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(), material);
  scene.add(glass);

  const builder = new RaySceneBuilder();
  const result = builder.build(scene);
  const opticalB = result.geometry.getAttribute('rayOpticalB');

  assert.deepEqual(Array.from(opticalB.array.slice(0, 3)), [1, 0, 0]);

  material.attenuationColor = '#00ff00';
  assert.equal(
    builder.refreshMaterialAttributes(result.geometry, result.triangleSources),
    true,
  );
  assert.deepEqual(Array.from(opticalB.array.slice(0, 3)), [0, 1, 0]);

  result.geometry.dispose();
  glass.geometry.dispose();
  material.dispose();
});

test('ray visibility is opt-out for ordinary opaque meshes', () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.userData.layeredGlass = { rayVisibility: 'ignore' };
  scene.add(mesh);

  const result = new RaySceneBuilder().build(scene);
  assert.equal(result.triangleCount, 0);

  result.geometry.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('supportsLayeredGlass requires WebGL2 but not float color targets', () => {
  assert.equal(supportsLayeredGlass(createRendererStub()), true);
  assert.equal(
    supportsLayeredGlass({
      isWebGLRenderer: true,
      capabilities: { isWebGL2: false },
    }),
    false,
  );
});
