import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_GAP,
  createModelQueueLayout,
  createPanelQueueSpacing,
} from '../demo/modelLayout.js';

const SHAPES = [
  { horizontalRadius: 0.42 },
  { horizontalRadius: 0.73 },
  { horizontalRadius: 0.31 },
  { horizontalRadius: 0.58 },
];

function spacingLength(spacing) {
  return Math.hypot(spacing.x, spacing.z);
}

test('panel queue expands monotonically with the shared gap control', () => {
  for (const count of [2, 5, 12]) {
    const compact = createPanelQueueSpacing(count, 0.05);
    const defaultSpacing = createPanelQueueSpacing(count, MODEL_GAP);
    const expanded = createPanelQueueSpacing(count, 1.5);

    assert.ok(spacingLength(compact) < spacingLength(defaultSpacing));
    assert.ok(spacingLength(defaultSpacing) < spacingLength(expanded));
    assert.ok(Math.abs(compact.x / compact.z - expanded.x / expanded.z) < 1e-12);
  }
});

test('GLB queue maintains the requested gap at every exposed scale', () => {
  for (const gap of [0.05, MODEL_GAP, 1.5]) {
    for (const scale of [0.55, 0.8, 1.2]) {
      const layout = createModelQueueLayout(
        SHAPES,
        SHAPES.length,
        scale,
        gap,
      );

      assert.equal(layout.gap, gap);
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
          Math.abs(surfaceGap - gap) < 1e-10,
          `expected ${gap} gap at scale ${scale}, got ${surfaceGap}`,
        );
      }
    }
  }
});

test('GLB queue remains centered when scale and gap change', () => {
  for (const [scale, gap] of [[0.55, 0.05], [1.2, 1.5]]) {
    const { placements } = createModelQueueLayout(
      SHAPES,
      SHAPES.length,
      scale,
      gap,
    );
    const first = placements[0];
    const last = placements.at(-1);

    assert.ok(Math.abs(first[0] + last[0]) < 1e-12);
    assert.ok(Math.abs(first[2] + last[2]) < 1e-12);
  }
});
