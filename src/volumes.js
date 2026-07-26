import { Matrix4, Vector3 } from 'three';

export const LAYERED_GLASS_SHAPES = Object.freeze({
  AUTO: 'auto',
  BOX: 'box',
  ROUNDED_BOX: 'roundedBox',
  SPHERE: 'sphere',
});

export const LAYERED_GLASS_VOLUME_KINDS = Object.freeze({
  BLOCKER: 0,
  GLASS: 1,
});

export const LAYERED_GLASS_SHAPE_CODES = Object.freeze({
  ROUNDED_BOX: 0,
  SPHERE: 1,
});

const _center = new Vector3();
const _size = new Vector3();
const _translation = new Matrix4();

function normalizeShape(shape = 'auto') {
  if (shape === 'rounded-box') return LAYERED_GLASS_SHAPES.ROUNDED_BOX;
  if (shape === 'roundedBox') return LAYERED_GLASS_SHAPES.ROUNDED_BOX;
  if (shape === 'box') return LAYERED_GLASS_SHAPES.BOX;
  if (shape === 'sphere') return LAYERED_GLASS_SHAPES.SPHERE;
  if (shape === 'auto' || shape == null) return LAYERED_GLASS_SHAPES.AUTO;
  throw new Error(
    `Unsupported layered glass shape "${shape}". Use "auto", "box", "roundedBox", or "sphere".`,
  );
}

function inferShape(object, explicitShape, radius) {
  const normalized = normalizeShape(explicitShape);
  if (normalized !== LAYERED_GLASS_SHAPES.AUTO) return normalized;

  const geometryType = String(object.geometry?.type ?? '').toLowerCase();

  if (geometryType.includes('sphere') || geometryType.includes('icosahedron')) {
    return LAYERED_GLASS_SHAPES.SPHERE;
  }

  if (geometryType.includes('roundedbox')) {
    return LAYERED_GLASS_SHAPES.ROUNDED_BOX;
  }

  if (geometryType.includes('box')) {
    return radius > 0
      ? LAYERED_GLASS_SHAPES.ROUNDED_BOX
      : LAYERED_GLASS_SHAPES.BOX;
  }

  throw new Error(
    `Unable to infer an analytic shape for geometry "${object.geometry?.type ?? 'unknown'}". ` +
    'Set material.shape or blocker options.shape explicitly. The analytic composer supports box, roundedBox, and sphere volumes.',
  );
}

function readBounds(object, shape, descriptor) {
  const geometry = object.geometry;
  if (!geometry) {
    throw new TypeError('Layered glass volumes require a THREE.BufferGeometry.');
  }

  if (descriptor.halfExtents) {
    const halfExtents = new Vector3().fromArray(
      descriptor.halfExtents.isVector3
        ? descriptor.halfExtents.toArray()
        : descriptor.halfExtents,
    );
    const center = descriptor.center
      ? new Vector3().fromArray(
        descriptor.center.isVector3
          ? descriptor.center.toArray()
          : descriptor.center,
      )
      : new Vector3();
    return { center, halfExtents };
  }

  if (shape === LAYERED_GLASS_SHAPES.SPHERE) {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    if (!geometry.boundingSphere) {
      throw new Error('Unable to compute a bounding sphere for a layered glass volume.');
    }
    const center = geometry.boundingSphere.center.clone();
    const radius = geometry.boundingSphere.radius;
    return {
      center,
      halfExtents: new Vector3(radius, radius, radius),
    };
  }

  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) {
    throw new Error('Unable to compute a bounding box for a layered glass volume.');
  }

  geometry.boundingBox.getCenter(_center);
  geometry.boundingBox.getSize(_size).multiplyScalar(0.5);

  return {
    center: _center.clone(),
    halfExtents: _size.clone(),
  };
}

/**
 * Mark a normally rendered opaque mesh as an exact analytic blocker for the
 * layered glass traversal. The mesh keeps its existing material and render path.
 */
export function setLayeredGlassBlocker(object, options = {}) {
  if (!object?.isMesh) {
    throw new TypeError('setLayeredGlassBlocker() requires a THREE.Mesh.');
  }

  object.userData.layeredGlassBlocker = {
    shape: options.shape ?? 'auto',
    radius: options.radius ?? 0,
    halfExtents: options.halfExtents ?? null,
    center: options.center ?? null,
  };

  return object;
}

export function clearLayeredGlassBlocker(object) {
  if (object?.userData) delete object.userData.layeredGlassBlocker;
  return object;
}

export function isLayeredGlassBlocker(object) {
  return Boolean(object?.isMesh && object.userData?.layeredGlassBlocker);
}

/**
 * Resolve a mesh into the centered analytic local frame consumed by the GPU.
 * The returned localToWorld matrix includes the geometry bounds center.
 */
export function resolveLayeredGlassVolume(object, kind, options = {}) {
  if (!object?.isMesh) {
    throw new TypeError('Layered glass volume resolution requires a THREE.Mesh.');
  }

  const source = kind === LAYERED_GLASS_VOLUME_KINDS.GLASS
    ? object.material
    : options;
  const explicitRadius = Number(source?.radius ?? options.radius ?? 0);
  const shape = inferShape(object, source?.shape ?? options.shape, explicitRadius);
  const bounds = readBounds(object, shape, source ?? options);
  const minimumExtent = Math.max(
    0,
    Math.min(bounds.halfExtents.x, bounds.halfExtents.y, bounds.halfExtents.z),
  );
  const radius = shape === LAYERED_GLASS_SHAPES.ROUNDED_BOX
    ? Math.min(Math.max(0, explicitRadius), minimumExtent)
    : 0;

  object.updateMatrixWorld(true);
  _translation.makeTranslation(bounds.center.x, bounds.center.y, bounds.center.z);
  const localToWorld = object.matrixWorld.clone().multiply(_translation);
  const worldToLocal = localToWorld.clone().invert();

  return {
    object,
    kind,
    shape,
    shapeCode: shape === LAYERED_GLASS_SHAPES.SPHERE
      ? LAYERED_GLASS_SHAPE_CODES.SPHERE
      : LAYERED_GLASS_SHAPE_CODES.ROUNDED_BOX,
    localToWorld,
    worldToLocal,
    halfExtents: bounds.halfExtents,
    radius,
  };
}
