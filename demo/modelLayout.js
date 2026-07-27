export const MODEL_GAP = 0.28;

const DIRECTION_X = 0.72;
const DIRECTION_Z = 0.69;
const DIRECTION_LENGTH = Math.hypot(DIRECTION_X, DIRECTION_Z);
const QUEUE_DIRECTION_X = DIRECTION_X / DIRECTION_LENGTH;
const QUEUE_DIRECTION_Z = DIRECTION_Z / DIRECTION_LENGTH;

export function createModelQueueLayout(
  shapes,
  count,
  objectScale = 1,
) {
  const safeScale = Math.max(0.01, Number(objectScale) || 1);
  const selectedShapes = shapes.slice(0, count);
  const radii = selectedShapes.map((shape) => (
    Math.max(0, Number(shape.horizontalRadius) || 0) * safeScale
  ));

  if (selectedShapes.length === 0) {
    return {
      gap: MODEL_GAP,
      lateralSpan: 0,
      depthSpan: 0,
      placements: [],
      radii,
    };
  }

  const centerDistances = [0];
  for (let index = 1; index < selectedShapes.length; index += 1) {
    centerDistances.push(
      centerDistances[index - 1] +
      radii[index - 1] +
      radii[index] +
      MODEL_GAP,
    );
  }

  const queueLength = centerDistances.at(-1);
  const queueCenter = queueLength * 0.5;
  const placements = centerDistances.map((distance) => {
    const centeredDistance = distance - queueCenter;
    return [
      centeredDistance * QUEUE_DIRECTION_X,
      0,
      centeredDistance * QUEUE_DIRECTION_Z,
    ];
  });
  const endpointRadii = radii[0] + radii.at(-1);

  return {
    gap: MODEL_GAP,
    lateralSpan:
      queueLength * Math.abs(QUEUE_DIRECTION_X) + endpointRadii,
    depthSpan:
      queueLength * Math.abs(QUEUE_DIRECTION_Z) + endpointRadii,
    placements,
    radii,
  };
}
