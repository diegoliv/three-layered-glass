import {
  BackSide,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Matrix3,
  Vector3,
} from 'three';
import {
  GLASS_MODE,
  RAY_SURFACE_KIND,
  RAY_VISIBILITY,
} from './constants.js';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _na = new Vector3();
const _nb = new Vector3();
const _nc = new Vector3();
const _edgeA = new Vector3();
const _edgeB = new Vector3();
const _faceNormal = new Vector3();
const _normalMatrix = new Matrix3();
const _color = new Color();

function asMaterialArray(material) {
  return Array.isArray(material) ? material : [material];
}

function getMaterialForTriangle(mesh, triangleOffset) {
  const materials = asMaterialArray(mesh.material);
  if (materials.length === 1) return materials[0] ?? null;

  const groups = mesh.geometry.groups;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (
      triangleOffset >= group.start
      && triangleOffset < group.start + group.count
    ) {
      return materials[group.materialIndex] ?? null;
    }
  }

  return materials[0] ?? null;
}

function getExplicitRayVisibility(mesh, material) {
  return material?.userData?.layeredGlass?.rayVisibility
    ?? mesh.userData?.layeredGlass?.rayVisibility
    ?? mesh.userData?.layeredGlassRayVisibility
    ?? RAY_VISIBILITY.AUTO;
}

function getRayVisibility(mesh, material, options = {}) {
  const override = getExplicitRayVisibility(mesh, material);
  if (override !== RAY_VISIBILITY.AUTO) return override;
  if (material?.isLayeredGlassMaterial) {
    return options.autoDiscoverGlass === false
      ? RAY_VISIBILITY.IGNORE
      : RAY_VISIBILITY.GLASS;
  }

  if (
    material
    && material.visible !== false
    && material.transparent !== true
    && Number(material.opacity ?? 1) >= 0.999
  ) {
    return RAY_VISIBILITY.OPAQUE;
  }

  return RAY_VISIBILITY.IGNORE;
}

function matchesIncludedLayer(mesh, includeLayers) {
  if (!includeLayers || includeLayers.length === 0) return true;
  return includeLayers.some((layer) => {
    if (!Number.isInteger(layer) || layer < 0 || layer > 31) return false;
    return (mesh.layers.mask & (1 << layer)) !== 0;
  });
}

function shouldIncludeMesh(mesh, options) {
  if (!mesh?.isMesh || !mesh.visible || !mesh.geometry?.attributes?.position) {
    return false;
  }

  if (!matchesIncludedLayer(mesh, options.includeLayers)) return false;
  if (options.exclude?.(mesh) === true) return false;

  const explicitVisibility = getExplicitRayVisibility(mesh, null);
  if (explicitVisibility === RAY_VISIBILITY.IGNORE) return false;

  if (mesh.isInstancedMesh || mesh.isBatchedMesh) {
    options.onWarning?.(
      `Skipping instanced or batched mesh "${mesh.name || mesh.uuid}". `
      + 'Version 0.4 static BVH preparation currently supports regular Mesh objects.',
      mesh,
    );
    return false;
  }

  const hasMorphTargets = Boolean(
    mesh.morphTargetInfluences
    && mesh.morphTargetInfluences.length > 0,
  );
  if (mesh.isSkinnedMesh || hasMorphTargets) {
    options.onWarning?.(
      `Skipping deforming mesh "${mesh.name || mesh.uuid}". `
      + 'Version 0.4 static BVH preparation targets non-deforming BufferGeometry.',
      mesh,
    );
    return false;
  }

  return true;
}

function readPosition(attribute, index, target, matrixWorld) {
  target.fromBufferAttribute(attribute, index).applyMatrix4(matrixWorld);
  return target;
}

function readNormal(attribute, index, target, normalMatrix, fallback) {
  if (!attribute) return target.copy(fallback);
  target.fromBufferAttribute(attribute, index).applyNormalMatrix(normalMatrix);
  if (target.lengthSq() < 1e-12) return target.copy(fallback);
  return target.normalize();
}

function pushVec3(target, value) {
  target.push(value.x, value.y, value.z);
}

function pushRepeated(target, values, count = 3) {
  for (let i = 0; i < count; i += 1) target.push(...values);
}

function getDrawRange(geometry) {
  const sourceCount = geometry.index
    ? geometry.index.count
    : geometry.attributes.position.count;
  const rawStart = Math.max(0, Math.min(sourceCount, geometry.drawRange.start ?? 0));
  const rawCount = Number.isFinite(geometry.drawRange.count)
    ? Math.max(0, Math.min(geometry.drawRange.count, sourceCount - rawStart))
    : sourceCount - rawStart;
  const rawEnd = rawStart + rawCount;
  const start = rawStart + ((3 - (rawStart % 3)) % 3);
  const end = rawEnd - (rawEnd % 3);
  return { start, end: Math.max(start, end) };
}

function createEmptyArrays() {
  return {
    position: [],
    normal: [],
    rayMeta: [],
    rayOpticalA: [],
    rayOpticalB: [],
    rayOpticalC: [],
    rayBaseColor: [],
  };
}

function getSideCode(material, isGlass) {
  if (isGlass) return DoubleSide;
  const side = material?.side ?? FrontSide;
  if (side === BackSide || side === DoubleSide) return side;
  return FrontSide;
}

function getMaterialColor(material, fallback = 0xffffff) {
  if (material?.color?.isColor) return _color.copy(material.color);
  return _color.set(fallback);
}

function appendSurfaceMetadata(arrays, material, visibility, volumeId) {
  const isGlass = visibility === RAY_VISIBILITY.GLASS;
  const kind = isGlass
    ? RAY_SURFACE_KIND.GLASS
    : RAY_SURFACE_KIND.OPAQUE;
  const modeCode = material?.mode === GLASS_MODE.THIN ? 1 : 0;
  const sideCode = getSideCode(material, isGlass);

  const ior = Number(material?.ior ?? 1.48);
  const roughness = Number(material?.roughness ?? 0);
  const attenuationDistance = Math.max(
    1e-5,
    Number(material?.attenuationDistance ?? 1e6),
  );
  const reflectionStrength = Number(material?.reflectionStrength ?? 1);
  const attenuationColor = material?.attenuationColor?.isColor
    ? _color.copy(material.attenuationColor)
    : _color.set(0xffffff);
  const dispersion = Number(material?.dispersion ?? 0);
  const refractionReach = Number(material?.refractionReach ?? 2);
  const bodyTintStrength = Number(material?.bodyTintStrength ?? 1);
  const thinThickness = Number(material?.thickness ?? 0.01);
  const baseColor = getMaterialColor(material);
  const materialRoughness = Number(material?.roughness ?? 0.5);

  pushRepeated(arrays.rayMeta, [
    kind,
    isGlass ? volumeId : 0,
    modeCode,
    sideCode,
  ]);
  pushRepeated(arrays.rayOpticalA, [
    ior,
    roughness,
    attenuationDistance,
    reflectionStrength,
  ]);
  pushRepeated(arrays.rayOpticalB, [
    attenuationColor.r,
    attenuationColor.g,
    attenuationColor.b,
    dispersion,
  ]);
  pushRepeated(arrays.rayOpticalC, [
    refractionReach,
    bodyTintStrength,
    thinThickness,
    0,
  ]);
  pushRepeated(arrays.rayBaseColor, [
    baseColor.r,
    baseColor.g,
    baseColor.b,
    materialRoughness,
  ]);
}

/**
 * Converts visible static Three.js meshes into one world-space triangle scene.
 *
 * The geometry is deliberately non-indexed and every triangle receives its own
 * duplicated metadata. This keeps material, volume, and optical data stable
 * when three-mesh-bvh reorders triangle indices internally.
 */
export class RaySceneBuilder {
  constructor(options = {}) {
    this.options = {
      autoOpaqueIntersections: options.autoOpaqueIntersections ?? true,
      autoDiscoverGlass: options.autoDiscoverGlass ?? true,
      includeLayers: options.includeLayers ?? null,
      exclude: options.exclude ?? null,
      onWarning: options.onWarning ?? ((message) => console.warn(message)),
    };
  }

  collect(scene) {
    const meshes = [];
    scene.updateMatrixWorld(true);
    scene.traverseVisible((object) => {
      if (shouldIncludeMesh(object, this.options)) meshes.push(object);
    });
    return meshes;
  }

  build(scene) {
    const arrays = createEmptyArrays();
    const meshes = this.collect(scene);
    const objects = [];
    const triangleSources = [];
    let nextVolumeId = 1;
    let triangleCount = 0;
    let glassTriangleCount = 0;
    let opaqueTriangleCount = 0;

    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      const position = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      const index = geometry.index;
      const range = getDrawRange(geometry);
      const meshVolumeId = nextVolumeId;
      const negativeDeterminant = mesh.matrixWorld.determinant() < 0;
      const meshRecord = {
        object: mesh,
        firstTriangle: triangleCount,
        triangleCount: 0,
        glassTriangles: 0,
        opaqueTriangles: 0,
        volumeId: 0,
      };

      _normalMatrix.getNormalMatrix(mesh.matrixWorld);

      for (let offset = range.start; offset < range.end; offset += 3) {
        const material = getMaterialForTriangle(mesh, offset);
        const visibility = getRayVisibility(mesh, material, this.options);
        if (visibility === RAY_VISIBILITY.IGNORE) continue;
        if (
          visibility === RAY_VISIBILITY.OPAQUE
          && !this.options.autoOpaqueIntersections
        ) {
          continue;
        }

        let ia = index ? index.getX(offset + 0) : offset + 0;
        let ib = index ? index.getX(offset + 1) : offset + 1;
        let ic = index ? index.getX(offset + 2) : offset + 2;
        if (negativeDeterminant) [ib, ic] = [ic, ib];

        readPosition(position, ia, _a, mesh.matrixWorld);
        readPosition(position, ib, _b, mesh.matrixWorld);
        readPosition(position, ic, _c, mesh.matrixWorld);

        _edgeA.subVectors(_b, _a);
        _edgeB.subVectors(_c, _a);
        _faceNormal.crossVectors(_edgeA, _edgeB);
        if (_faceNormal.lengthSq() < 1e-12) continue;
        _faceNormal.normalize();

        readNormal(normal, ia, _na, _normalMatrix, _faceNormal);
        readNormal(normal, ib, _nb, _normalMatrix, _faceNormal);
        readNormal(normal, ic, _nc, _normalMatrix, _faceNormal);

        pushVec3(arrays.position, _a);
        pushVec3(arrays.position, _b);
        pushVec3(arrays.position, _c);
        pushVec3(arrays.normal, _na);
        pushVec3(arrays.normal, _nb);
        pushVec3(arrays.normal, _nc);

        const isGlass = visibility === RAY_VISIBILITY.GLASS;
        appendSurfaceMetadata(
          arrays,
          material,
          visibility,
          meshVolumeId,
        );
        triangleSources.push({
          mesh,
          offset,
          visibility,
          volumeId: isGlass ? meshVolumeId : 0,
        });

        triangleCount += 1;
        meshRecord.triangleCount += 1;
        if (isGlass) {
          glassTriangleCount += 1;
          meshRecord.glassTriangles += 1;
          meshRecord.volumeId = meshVolumeId;
        } else {
          opaqueTriangleCount += 1;
          meshRecord.opaqueTriangles += 1;
        }
      }

      if (meshRecord.triangleCount > 0) objects.push(meshRecord);
      if (meshRecord.glassTriangles > 0) nextVolumeId += 1;
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(arrays.position, 3),
    );
    geometry.setAttribute(
      'normal',
      new Float32BufferAttribute(arrays.normal, 3),
    );
    geometry.setAttribute(
      'rayMeta',
      new Float32BufferAttribute(arrays.rayMeta, 4),
    );
    geometry.setAttribute(
      'rayOpticalA',
      new Float32BufferAttribute(arrays.rayOpticalA, 4),
    );
    geometry.setAttribute(
      'rayOpticalB',
      new Float32BufferAttribute(arrays.rayOpticalB, 4),
    );
    geometry.setAttribute(
      'rayOpticalC',
      new Float32BufferAttribute(arrays.rayOpticalC, 4),
    );
    geometry.setAttribute(
      'rayBaseColor',
      new Float32BufferAttribute(arrays.rayBaseColor, 4),
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return {
      geometry,
      meshes,
      objects,
      triangleSources,
      triangleCount,
      glassTriangleCount,
      opaqueTriangleCount,
      volumeCount: nextVolumeId - 1,
    };
  }

  refreshMaterialAttributes(targetGeometry, triangleSources) {
    if (!targetGeometry || !triangleSources) return false;
    const arrays = createEmptyArrays();

    for (const source of triangleSources) {
      const material = getMaterialForTriangle(source.mesh, source.offset);
      const visibility = getRayVisibility(source.mesh, material, this.options);

      // Classification changes alter which triangles belong in the ray scene.
      // They require a full rebuild rather than a metadata-only refresh.
      if (visibility !== source.visibility) return false;

      appendSurfaceMetadata(
        arrays,
        material,
        visibility,
        source.volumeId,
      );
    }

    const update = (name, values) => {
      const attribute = targetGeometry.getAttribute(name);
      if (!attribute || attribute.array.length !== values.length) return false;
      attribute.array.set(values);
      attribute.needsUpdate = true;
      return true;
    };

    return update('rayMeta', arrays.rayMeta)
      && update('rayOpticalA', arrays.rayOpticalA)
      && update('rayOpticalB', arrays.rayOpticalB)
      && update('rayOpticalC', arrays.rayOpticalC)
      && update('rayBaseColor', arrays.rayBaseColor);
  }

}
