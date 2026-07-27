import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import * as publicR3F from '../src/r3f/index.js';
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
  useLayeredGlass,
} from '../src/r3f/index.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function nextTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('R3F primary entrypoint stays focused on the common path', () => {
  assert.deepEqual(Object.keys(publicR3F).sort(), [
    'LayeredGlass',
    'LayeredGlassComposer',
    'LayeredGlassMaterial',
    'useLayeredGlass',
    'useLayeredGlassMaterial',
  ]);
});

test('R3F material updates declaratively and disposes on unmount', async () => {
  let material;
  const renderer = await ReactThreeTestRenderer.create(
    createElement(
      'mesh',
      null,
      createElement('boxGeometry'),
      createElement(LayeredGlassMaterial, {
        ref(value) { material = value; },
        roughness: 0.2,
        attenuationColor: '#ff88aa',
      }),
    ),
  );

  assert.equal(material.isLayeredGlassMaterial, true);
  assert.equal(material.roughness, 0.2);
  assert.equal(material.attenuationColor.getHexString(), 'ff88aa');

  let disposed = false;
  material.addEventListener('dispose', () => { disposed = true; });
  await renderer.unmount();
  assert.equal(disposed, true);
});

test('R3F preparation callbacks do not rebuild when callback identity changes', async () => {
  let readyCalls = 0;
  let state;

  function StatusProbe() {
    state = useLayeredGlass();
    return null;
  }

  const renderTree = (onReady) => createElement(
    LayeredGlassComposer,
    { backend: 'analytic', onReady },
    createElement(StatusProbe),
  );

  const renderer = await ReactThreeTestRenderer.create(
    renderTree(() => { readyCalls += 1; }),
  );
  await nextTask();

  assert.equal(readyCalls, 1);
  assert.equal(state.status, 'ready');
  assert.equal(state.progress, 1);
  assert.equal(state.ready, true);
  assert.equal(state.error, null);

  await renderer.update(renderTree(() => { readyCalls += 10; }));
  await nextTask();

  assert.equal(readyCalls, 1);
  await renderer.unmount();
});

test('R3F preparation errors are exposed to callbacks and context', async () => {
  let caughtError;
  let state;
  const invalidScene = {
    updateMatrixWorld() {
      throw new Error('Expected preparation failure.');
    },
  };

  function StatusProbe() {
    state = useLayeredGlass();
    return null;
  }

  const renderer = await ReactThreeTestRenderer.create(
    createElement(
      LayeredGlassComposer,
      {
        backend: 'bvh',
        scene: invalidScene,
        worker: false,
        onError(error) { caughtError = error; },
      },
      createElement(StatusProbe),
    ),
  );
  await nextTask();

  assert.equal(state.status, 'error');
  assert.equal(state.ready, false);
  assert.equal(state.error, caughtError);
  assert.match(caughtError.message, /Expected preparation failure/);

  await renderer.unmount();
});
