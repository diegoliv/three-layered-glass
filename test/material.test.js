import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LayeredGlassMaterial,
  sortGlassObjectsBackToFront,
} from '../src/index.js';
import { createBVHResolverFragmentShader } from '../src/shaders/bvhResolver.js';
import { createVolumeResolverFragmentShader } from '../src/shaders/volumeResolver.js';

test('LayeredGlassMaterial separates optical data from optional analytic proxies', () => {
  const material = new LayeredGlassMaterial({
    ior: 1.52,
    roughness: 0.12,
    attenuationColor: '#ff88aa',
    bodyTintStrength: 0.8,
    mode: 'thin',
    thickness: 0.025,
    iterations: 5,
  });

  assert.equal(material.isLayeredGlassMaterial, true);
  assert.equal(material.ior, 1.52);
  assert.equal(material.roughness, 0.12);
  assert.equal(material.bodyTintStrength, 0.8);
  assert.equal(material.mode, 'thin');
  assert.equal(material.thickness, 0.025);
  assert.equal(material.shape, 'auto');
  assert.equal(material.iterations, 5);

  material.dispersion = 0.014;
  material.attenuationDistance = 4.5;
  assert.equal(material.dispersion, 0.014);
  assert.equal(material.attenuationDistance, 4.5);

  material.dispose();
});

test('rough transmission keeps the geometric interface normals stable', () => {
  const bvhShader = createBVHResolverFragmentShader({ roughSamples: 2 });
  const analyticShader = createVolumeResolverFragmentShader();

  for (const shader of [bvhShader, analyticShader]) {
    assert.doesNotMatch(shader, /perturbNormal|microEntryNormal|microExitNormal/);
  }

  assert.match(
    bvhShader,
    /terminalRoughness \* terminalRoughness/,
  );
  assert.match(bvhShader, /#if ROUGH_SAMPLES > 1/);
  assert.match(
    analyticShader,
    /roughnessIntegral \+= roughScatter/,
  );
});

test('legacy object sorting remains exported for migration', () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld(true);

  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const far = new THREE.Mesh(geometry, new LayeredGlassMaterial());
  const near = new THREE.Mesh(geometry, new LayeredGlassMaterial());
  const forcedFront = new THREE.Mesh(
    geometry,
    new LayeredGlassMaterial({ priority: 10 }),
  );

  far.position.z = -4;
  near.position.z = 2;
  forcedFront.position.z = -10;
  far.updateMatrixWorld(true);
  near.updateMatrixWorld(true);
  forcedFront.updateMatrixWorld(true);

  const sorted = sortGlassObjectsBackToFront(
    [near, forcedFront, far],
    camera,
  );

  assert.deepEqual(sorted, [far, near, forcedFront]);

  far.material.dispose();
  near.material.dispose();
  forcedFront.material.dispose();
  geometry.dispose();
});
