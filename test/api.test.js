import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import {
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
    capabilities: { isWebGL2: true },
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

test('LayeredGlassPass exposes the automatic backend options', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const pass = new LayeredGlassPass(scene, camera, {
    backend: 'bvh',
    quality: 'low',
  });

  assert.ok(pass instanceof Pass);
  assert.equal(pass.needsSwap, true);
  assert.equal(pass.backend, 'bvh');
  assert.equal(pass.quality, 'low');

  pass.dispose();
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
