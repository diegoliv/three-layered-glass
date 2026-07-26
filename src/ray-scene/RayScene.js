import {
  FloatVertexAttributeTexture,
  MeshBVH,
  MeshBVHUniformStruct,
  SAH,
  estimateMemoryInBytes,
} from 'three-mesh-bvh';
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { RaySceneBuilder } from './RaySceneBuilder.js';
import { QUALITY_PRESETS } from './constants.js';

function resolveQuality(quality, overrides = {}) {
  const preset = typeof quality === 'string'
    ? QUALITY_PRESETS[quality] ?? QUALITY_PRESETS.medium
    : QUALITY_PRESETS.medium;
  return {
    ...preset,
    ...(typeof quality === 'object' ? quality : {}),
    ...overrides,
  };
}

/**
 * Static world-space triangle scene used by the BVH resolver.
 *
 * Version 0.4 targets static BufferGeometry and static GLB meshes. Rebuild the
 * scene after topology, transforms, ray visibility, or material data changes.
 */
export class LayeredRayScene {
  constructor(options = {}) {
    this.options = { ...options };
    this.quality = resolveQuality(options.quality ?? 'medium');
    this.builder = new RaySceneBuilder(options);
    this.geometry = null;
    this.bvh = null;
    this.uniform = new MeshBVHUniformStruct();
    this.normalAttribute = new FloatVertexAttributeTexture();
    this.metaAttribute = new FloatVertexAttributeTexture();
    this.opticalAAttribute = new FloatVertexAttributeTexture();
    this.opticalBAttribute = new FloatVertexAttributeTexture();
    this.opticalCAttribute = new FloatVertexAttributeTexture();
    this.baseColorAttribute = new FloatVertexAttributeTexture();
    this.meshes = [];
    this.objects = [];
    this.triangleSources = [];
    this.triangleCount = 0;
    this.glassTriangleCount = 0;
    this.opaqueTriangleCount = 0;
    this.volumeCount = 0;
    this.ready = false;
    this.building = false;
    this.version = 0;
    this._worker = null;
    this._buildPromise = null;
  }

  async build(scene, options = {}) {
    if (this.building) return this._buildPromise;

    const buildOptions = {
      worker: options.worker ?? this.options.worker ?? true,
      onProgress: options.onProgress ?? this.options.onProgress ?? null,
      strategy: options.strategy ?? SAH,
      targetLeafSize: options.targetLeafSize
        ?? this.quality.bvhLeafSize
        ?? 2,
      indirect: options.indirect ?? true,
      verbose: options.verbose ?? false,
    };

    this.building = true;
    this.ready = false;
    buildOptions.onProgress?.(0);

    this._buildPromise = (async () => {
      let result = this.builder.build(scene);
      this._applyBuildResult(result);

      if (this.triangleCount === 0) {
        this._updateAttributeTextures();
        this.ready = true;
        this.version += 1;
        buildOptions.onProgress?.(1);
        return this;
      }

      const bvhOptions = {
        strategy: buildOptions.strategy,
        targetLeafSize: Math.max(1, Math.floor(buildOptions.targetLeafSize)),
        indirect: buildOptions.indirect,
        verbose: buildOptions.verbose,
        onProgress: buildOptions.onProgress ?? undefined,
      };

      if (buildOptions.worker && typeof Worker !== 'undefined') {
        try {
          this._worker ??= new GenerateMeshBVHWorker();
          this.bvh = await this._worker.generate(this.geometry, bvhOptions);
        } catch (error) {
          this.options.onWarning?.(
            `Worker BVH build failed; falling back to the main thread. ${error.message}`,
          );

          // The worker transfers position and index arrays. Rebuild the static
          // geometry before falling back in case those buffers were detached.
          result = this.builder.build(scene);
          this._applyBuildResult(result);
          this.bvh = new MeshBVH(this.geometry, bvhOptions);
        }
      } else {
        this.bvh = new MeshBVH(this.geometry, bvhOptions);
      }

      this.geometry.boundsTree = this.bvh;
      this.uniform.updateFrom(this.bvh);
      this._updateAttributeTextures();
      this.ready = true;
      this.version += 1;
      buildOptions.onProgress?.(1);
      return this;
    })().finally(() => {
      this.building = false;
      this._buildPromise = null;
    });

    return this._buildPromise;
  }

  rebuild(scene, options = {}) {
    return this.build(scene, options);
  }

  _applyBuildResult(result) {
    this._disposeGeometryOnly();
    this.geometry = result.geometry;
    this.meshes = result.meshes;
    this.objects = result.objects;
    this.triangleSources = result.triangleSources ?? [];
    this.triangleCount = result.triangleCount;
    this.glassTriangleCount = result.glassTriangleCount ?? 0;
    this.opaqueTriangleCount = result.opaqueTriangleCount ?? 0;
    this.volumeCount = result.volumeCount;
  }

  refreshMaterials(scene) {
    if (!this.ready || !this.geometry) return false;
    const refreshed = this.builder.refreshMaterialAttributes(
      this.geometry,
      this.triangleSources,
    );
    if (!refreshed) return false;
    this._updateAttributeTextures();
    this.version += 1;
    return true;
  }

  _updateAttributeTextures() {
    if (!this.geometry) return;
    const geometry = this.geometry;
    const update = (texture, name) => {
      const attribute = geometry.getAttribute(name);
      if (attribute) texture.updateFrom(attribute);
    };
    update(this.normalAttribute, 'normal');
    update(this.metaAttribute, 'rayMeta');
    update(this.opticalAAttribute, 'rayOpticalA');
    update(this.opticalBAttribute, 'rayOpticalB');
    update(this.opticalCAttribute, 'rayOpticalC');
    update(this.baseColorAttribute, 'rayBaseColor');
  }

  getMemoryReport() {
    const geometryBytes = this.geometry
      ? Object.values(this.geometry.attributes).reduce(
        (sum, attribute) => sum + attribute.array.byteLength,
        0,
      ) + (this.geometry.index?.array?.byteLength ?? 0)
      : 0;
    const bvhBytes = this.bvh ? estimateMemoryInBytes(this.bvh) : 0;
    return {
      triangles: this.triangleCount,
      glassTriangles: this.glassTriangleCount,
      opaqueTriangles: this.opaqueTriangleCount,
      volumes: this.volumeCount,
      geometryBytes,
      bvhBytes,
      // Attribute textures mirror the CPU attribute buffers on the GPU. BVH
      // texture storage is implementation-dependent, so this is an estimate.
      estimatedGpuBytes: geometryBytes + bvhBytes,
      totalBytes: geometryBytes + bvhBytes,
    };
  }

  _disposeGeometryOnly() {
    if (this.geometry) {
      this.geometry.boundsTree = null;
      this.geometry.dispose();
    }
    this.geometry = null;
    this.bvh = null;
  }

  dispose() {
    this._worker?.dispose();
    this._worker = null;
    this.uniform.dispose();
    this.normalAttribute.dispose();
    this.metaAttribute.dispose();
    this.opticalAAttribute.dispose();
    this.opticalBAttribute.dispose();
    this.opticalCAttribute.dispose();
    this.baseColorAttribute.dispose();
    this._disposeGeometryOnly();
    this.triangleSources = [];
    this.ready = false;
  }
}

export { resolveQuality as resolveLayeredGlassQuality };
