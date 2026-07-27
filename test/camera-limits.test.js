import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrbitDistanceLimits } from '../demo/cameraLimits.js';

test('mobile OrbitControls expose a wider zoom range', () => {
  const mobile = getOrbitDistanceLimits(10, true);
  const desktop = getOrbitDistanceLimits(10, false);

  assert.equal(mobile.minDistance, 2.6);
  assert.equal(mobile.maxDistance, 30);
  assert.equal(desktop.minDistance, 4.2);
  assert.equal(desktop.maxDistance, 25);
  assert.ok(mobile.minDistance < desktop.minDistance);
  assert.ok(mobile.maxDistance > desktop.maxDistance);
});

test('OrbitControls retain practical close-zoom floors', () => {
  assert.deepEqual(
    getOrbitDistanceLimits(4, true),
    { minDistance: 1.8, maxDistance: 12 },
  );
  assert.deepEqual(
    getOrbitDistanceLimits(4, false),
    { minDistance: 3.2, maxDistance: 10 },
  );
});
