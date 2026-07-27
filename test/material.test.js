import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LayeredGlassMaterial } from '../src/index.js';
import { sortGlassObjectsBackToFront } from '../src/legacy.js';
import { createBVHResolverFragmentShader } from '../src/shaders/bvhResolver.js';
import { createVolumeResolverFragmentShader } from '../src/shaders/volumeResolver.js';
import {
  coverageCompositeFragmentShader,
  glassSurfaceFragmentShader,
  roughTransmissionBlurFragmentShader,
  transmissionFxaaFragmentShader,
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
    new URL('../demo/main.jsx', import.meta.url),
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
  assert.match(bvhShader, /uvec4 initialFaceIndices/);
  assert.match(bvhShader, /if \(traversal == 0\)/);
  assert.doesNotMatch(bvhShader, /outFrontSurface|frontSurfaceRadiance/);
  assert.match(glassSurfaceFragmentShader, /uBaseDepth/);
  assert.match(glassSurfaceFragmentShader, /fresnelSchlick/);
  assert.match(roughTransmissionBlurFragmentShader, /uOffset/);
  assert.match(
    roughTransmissionBlurFragmentShader,
    /textureSize\(uSourceTexture, 0\)/,
  );
  assert.match(roughTransmissionBlurFragmentShader, /vec2 diagonal/);
  assert.match(roughTransmissionBlurFragmentShader, /vec2 axial/);
  assert.match(roughTransmissionBlurFragmentShader, /supportAlpha/);
  assert.doesNotMatch(roughTransmissionBlurFragmentShader, /uDirection/);
  assert.match(transmissionFxaaFragmentShader, /validTransmissionSample/);
  assert.match(transmissionFxaaFragmentShader, /textureSize\(uSourceTexture, 0\)/);
  assert.match(transmissionFxaaFragmentShader, /centerSample\.a/);
  assert.match(transmissionFxaaFragmentShader, /lumaRange/);
  assert.match(coverageCompositeFragmentShader, /uBlurTexture/);
  assert.match(coverageCompositeFragmentShader, /uFrontTexture/);
  assert.match(coverageCompositeFragmentShader, /uHasRoughBlur/);
  assert.match(coverageCompositeFragmentShader, /sampleEdgeAwareTransmission/);
  assert.match(coverageCompositeFragmentShader, /blurAmount/);
  assert.doesNotMatch(coverageCompositeFragmentShader, /filterRoughRay/);
  assert.match(composerSource, /RoughBlurEighth/);
  assert.equal(
    composerSource.match(/_renderRoughTransmissionBlur\(/g)?.length,
    7,
  );
  assert.match(composerSource, /LayeredGlass\.BVH\.Surface/);
  assert.match(composerSource, /samples: this\.coverageSamples/);
  assert.match(composerSource, /setResolutionScale\(value\)/);
  assert.match(composerSource, /LayeredGlass\.BVH\.TransmissionFXAA/);
  assert.match(composerSource, /setTransmissionAntialias\(value\)/);
  assert.doesNotMatch(composerSource, /count: 2/);
  assert.match(demoSource, /from '@react-three\/fiber'/);
  assert.match(demoSource, /from '\.\.\/src\/r3f\/index\.js'/);
  assert.match(demoSource, /from '\.\.\/src\/r3f\/advanced\.js'/);
  assert.match(demoSource, /<LayeredGlassComposer/);
  assert.match(demoSource, /<LayeredGlassMaterial/);
  assert.match(demoSource, /backend="bvh"/);
  assert.match(demoSource, /adaptive=\{IS_MOBILE \? MOBILE_ADAPTIVE_QUALITY : false\}/);
  assert.match(demoSource, /const MAXIMUM_PIXEL_RATIO = IS_MOBILE \? 1 : 1\.25/);
  assert.match(demoSource, /useLoader\(\s*GLTFLoader,\s*OBJECTS_URL/);
  assert.match(demoSource, /new URL\('\.\.\/static\/objects\.glb'/);
  assert.match(bvhShader, /frostAmount \* 0\.30/);
  assert.match(analyticShader, /float layerClarity = 1\.0/);
  assert.match(analyticShader, /roughScatter \* 12\.0/);
  assert.match(analyticShader, /frostAmount \* 0\.30/);
  assert.match(demoHtml, /src="\.\/demo\/main\.jsx"/);
  assert.match(demoSource, /label="Rough transmission"[\s\S]*?max=\{1\}/);
  assert.match(
    demoSource,
    /label="Queue gap"[\s\S]*?max=\{1\.5\}[\s\S]*?step=\{0\.01\}/,
  );
  assert.match(
    demoSource,
    /getOrbitDistanceLimits\(distance, IS_MOBILE\)/,
  );
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
