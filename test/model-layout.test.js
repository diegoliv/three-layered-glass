import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_GAP,
  createModelQueueLayout,
} from '../demo/modelLayout.js';

const SHAPES = [
  { horizontalRadius: 0.42 },
  { horizontalRadius: 0.73 },
  { horizontalRadius: 0.31 },
  { horizontalRadius: 0.58 },
];

test('GLB queue maintains its minimum gap at every exposed scale', () => {
  for (const scale of [0.55, 0.8, 1.2]) {
    const layout = createModelQueueLayout(
      SHAPES,
      SHAPES.length,
      scale,
    );

    for (let index = 1; index < layout.placements.length; index += 1) {
      const previous = layout.placements[index - 1];
      const current = layout.placements[index];
      const centerDistance = Math.hypot(
        current[0] - previous[0],
        current[2] - previous[2],
      );
      const surfaceGap = centerDistance -
        layout.radii[index - 1] -
        layout.radii[index];

      assert.ok(
        surfaceGap >= MODEL_GAP - Number.EPSILON * 16,
        `expected ${MODEL_GAP} gap at scale ${scale}, got ${surfaceGap}`,
      );
    }
  }
});

test('GLB queue remains centered when scale changes', () => {
  for (const scale of [0.55, 1.2]) {
    const { placements } = createModelQueueLayout(
      SHAPES,
      SHAPES.length,
      scale,
    );
    const first = placements[0];
    const last = placements.at(-1);

    assert.ok(Math.abs(first[0] + last[0]) < 1e-12);
    assert.ok(Math.abs(first[2] + last[2]) < 1e-12);
  }
});
