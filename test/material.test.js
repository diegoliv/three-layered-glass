import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  LayeredGlassMaterial,
  sortGlassObjectsBackToFront,
} from '../src/index.js';
import { createBVHResolverFragmentShader } from '../src/shaders/bvhResolver.js';
import { createVolumeResolverFragmentShader } from '../src/shaders/volumeResolver.js';
import {
  coverageCompositeFragmentShader,
  roughTransmissionBlurFragmentShader,
} from '../src/shaders/passes.js';

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
  const composerSource = readFileSync(
    new URL('../src/BVHLayeredGlassComposer.js', import.meta.url),
    'utf8',
  );
  const demoHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const demoSource = readFileSync(
    new URL('../demo/main.js', import.meta.url),
    'utf8',
  );

  for (const shader of [bvhShader, analyticShader]) {
    assert.doesNotMatch(shader, /perturbNormal|microEntryNormal|microExitNormal/);
  }

  assert.match(
    bvhShader,
    /terminalRoughness \* terminalRoughness/,
  );
  assert.match(bvhShader, /#if ROUGH_SAMPLES > 1/);
  assert.match(bvhShader, /float layerClarity = 1\.0/);
  assert.match(bvhShader, /layerClarity \*= exp/);
  assert.match(
    bvhShader,
    /surface\.roughness \* surface\.roughness \* 12\.0/,
  );
  assert.match(bvhShader, /smoothstep\(0\.45, 1\.0, terminalRoughness\)/);
  assert.match(bvhShader, /firstRoughnessAlpha/);
  assert.match(
    bvhShader,
    /layout\(location = 1\) out vec4 outFrontSurface/,
  );
  assert.match(bvhShader, /frontSurfaceRadiance/);
  assert.match(roughTransmissionBlurFragmentShader, /uOffset/);
  assert.match(
    roughTransmissionBlurFragmentShader,
    /textureSize\(uSourceTexture, 0\)/,
  );
  assert.match(roughTransmissionBlurFragmentShader, /vec2 diagonal/);
  assert.match(roughTransmissionBlurFragmentShader, /vec2 axial/);
  assert.match(roughTransmissionBlurFragmentShader, /supportAlpha/);
  assert.doesNotMatch(roughTransmissionBlurFragmentShader, /uDirection/);
  assert.match(coverageCompositeFragmentShader, /uBlurTexture/);
  assert.match(coverageCompositeFragmentShader, /uFrontTexture/);
  assert.match(coverageCompositeFragmentShader, /blurAmount/);
  assert.doesNotMatch(coverageCompositeFragmentShader, /filterRoughRay/);
  assert.match(composerSource, /RoughBlurEighth/);
  assert.equal(
    composerSource.match(/_renderRoughTransmissionBlur\(/g)?.length,
    7,
  );
  assert.match(composerSource, /_coverageTarget = createTarget\(width, height/);
  assert.match(composerSource, /samples: Math\.min\(2,/);
  assert.match(demoSource, /mobileResolutionScale = mobileHighFidelity/);
  assert.match(demoSource, /mobileHighFidelity \? 1\.4 : 1\.25/);
  assert.match(demoSource, /isMobile \? 0\.44 : 0\.50/);
  assert.match(bvhShader, /frostAmount \* 0\.30/);
  assert.match(analyticShader, /float layerClarity = 1\.0/);
  assert.match(analyticShader, /roughScatter \* 12\.0/);
  assert.match(analyticShader, /frostAmount \* 0\.30/);
  assert.match(demoHtml, /id="roughness"[^>]*max="1"/);
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
