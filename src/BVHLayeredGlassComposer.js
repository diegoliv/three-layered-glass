import {
  Color,
  DepthFormat,
  DepthTexture,
  DoubleSide,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import {
  copyFragmentShader,
  coverageCompositeFragmentShader,
  fullscreenVertexShader,
} from './shaders/passes.js';
import {
  bvhResolverVertexShader,
  createBVHResolverFragmentShader,
} from './shaders/bvhResolver.js';
import {
  LayeredRayScene,
  resolveLayeredGlassQuality,
} from './ray-scene/RayScene.js';
import { RAY_VISIBILITY } from './ray-scene/constants.js';

const _drawingBufferSize = new Vector2();
const _clearColor = new Color();
const _viewport = new Vector4();
const _scissor = new Vector4();

function createDepthTexture(width, height, name) {
  const texture = new DepthTexture(width, height, UnsignedIntType);
  texture.name = name;
  texture.format = DepthFormat;
  texture.type = UnsignedIntType;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createTarget(width, height, options = {}) {
  const target = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: options.type ?? UnsignedByteType,
    minFilter: options.minFilter ?? LinearFilter,
    magFilter: options.magFilter ?? LinearFilter,
    depthBuffer: options.depthBuffer ?? true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  target.texture.name = options.name ?? 'LayeredGlass.Target';
  target.texture.colorSpace = NoColorSpace;
  if (options.depthTexture) {
    target.depthTexture = createDepthTexture(
      width,
      height,
      `${target.texture.name}.Depth`,
    );
  }
  return target;
}

function asMaterialArray(material) {
  return Array.isArray(material) ? material : [material];
}

function isGlassMaterial(material) {
  return Boolean(material?.isLayeredGlassMaterial);
}

function isGlassSurface(object, material, autoDiscoverGlass = true) {
  return materialClassification(object, material, autoDiscoverGlass)
    === RAY_VISIBILITY.GLASS;
}

function isGlassObject(object, autoDiscoverGlass = true) {
  if (!object?.isMesh || !object.visible) return false;
  return asMaterialArray(object.material).some(
    (material) => isGlassSurface(object, material, autoDiscoverGlass),
  );
}

function isRenderableObject(object) {
  return Boolean(
    object?.isMesh
    || object?.isLine
    || object?.isPoints
    || object?.isSprite,
  );
}

function supportsFloatColorTargets(renderer) {
  return Boolean(renderer.getContext()?.getExtension?.('EXT_color_buffer_float'));
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 1e5) : value;
}

function colorSignature(color) {
  return color?.isColor
    ? `${roundNumber(color.r)},${roundNumber(color.g)},${roundNumber(color.b)}`
    : 'none';
}

function explicitRayVisibility(object, material) {
  return material?.userData?.layeredGlass?.rayVisibility
    ?? object.userData?.layeredGlass?.rayVisibility
    ?? object.userData?.layeredGlassRayVisibility
    ?? RAY_VISIBILITY.AUTO;
}

function materialClassification(object, material, autoDiscoverGlass) {
  const override = explicitRayVisibility(object, material);
  if (override !== RAY_VISIBILITY.AUTO) return override;
  if (isGlassMaterial(material)) {
    return autoDiscoverGlass ? RAY_VISIBILITY.GLASS : RAY_VISIBILITY.IGNORE;
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

function materialGeometrySignature(object, material, autoDiscoverGlass) {
  return [
    materialClassification(object, material, autoDiscoverGlass),
    material?.visible !== false ? 1 : 0,
    material?.transparent === true ? 1 : 0,
    roundNumber(Number(material?.opacity ?? 1)),
  ].join(':');
}

function materialOpticalSignature(material) {
  if (!material) return 'none';
  if (isGlassMaterial(material)) {
    return [
      material.uuid,
      material.mode ?? 'volume',
      roundNumber(Number(material.thickness ?? 0.01)),
      roundNumber(Number(material.ior ?? 1.48)),
      roundNumber(Number(material.roughness ?? 0)),
      roundNumber(Number(material.attenuationDistance ?? 1e6)),
      colorSignature(material.attenuationColor),
      roundNumber(Number(material.refractionReach ?? 2)),
      roundNumber(Number(material.reflectionStrength ?? 1)),
      roundNumber(Number(material.dispersion ?? 0)),
      roundNumber(Number(material.bodyTintStrength ?? 1)),
    ].join(':');
  }
  return [
    material.uuid,
    colorSignature(material.color),
    roundNumber(Number(material.roughness ?? 0.5)),
  ].join(':');
}

function createSceneSignatures(scene, autoDiscoverGlass = true) {
  const geometryParts = [];
  const materialParts = [];
  scene.updateMatrixWorld(true);

  scene.traverseVisible((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const materials = asMaterialArray(object.material);
    const matrix = object.matrixWorld.elements;
    const geometry = object.geometry;
    const groups = geometry.groups
      .map((group) => `${group.start},${group.count},${group.materialIndex}`)
      .join(';');

    geometryParts.push([
      object.uuid,
      geometry.uuid,
      geometry.attributes.position.version,
      geometry.attributes.normal?.version ?? -1,
      geometry.index?.version ?? -1,
      `${geometry.drawRange.start}:${geometry.drawRange.count}`,
      groups,
      materials
        .map((material) => materialGeometrySignature(
          object,
          material,
          autoDiscoverGlass,
        ))
        .join(','),
      matrix.map(roundNumber).join(','),
      object.userData?.layeredGlass?.rayVisibility ?? 'auto',
    ].join('|'));

    materialParts.push([
      object.uuid,
      materials.map(materialOpticalSignature).join(','),
    ].join('|'));
  });

  return {
    geometry: geometryParts.join('||'),
    material: materialParts.join('||'),
  };
}

function captureObjectState(state, object) {
  if (!state.has(object)) {
    state.set(object, {
      visible: object.visible,
      material: object.material,
    });
  }
}

function setObjectVisible(state, object, visible) {
  captureObjectState(state, object);
  object.visible = visible;
}

function setObjectMaterial(state, object, material) {
  captureObjectState(state, object);
  object.material = material;
}

function restoreObjectState(state) {
  for (const [object, previous] of state) {
    object.visible = previous.visible;
    object.material = previous.material;
  }
  state.clear();
}

function appendUnique(target, seen, object) {
  if (!object || seen.has(object)) return;
  seen.add(object);
  target.push(object);
}

/**
 * Static triangle-BVH renderer.
 *
 * Visible opaque meshes are included automatically and LayeredGlassMaterial
 * meshes use their real BufferGeometry triangles. Version 0.4 intentionally
 * targets static scenes; call prepare() or invalidateScene() after transforms
 * or topology change.
 */
export class BVHLayeredGlassComposer {
  constructor(renderer, options = {}) {
    if (!renderer?.isWebGLRenderer) {
      throw new TypeError(
        'BVHLayeredGlassComposer requires a THREE.WebGLRenderer.',
      );
    }

    this.renderer = renderer;
    this.layered = options.layered ?? true;
    this.autoDiscover = options.autoDiscover ?? true;
    this.autoDiscoverBlockers = options.autoDiscoverBlockers ?? true;
    this.autoOpaqueIntersections = options.autoOpaqueIntersections ?? true;
    this.renderToScreen = options.renderToScreen ?? true;
    this.manageRendererInfo = options.manageRendererInfo ?? true;
    this.foregroundLayer = options.foregroundLayer ?? null;
    this.depthMode = options.depthMode ?? 'opaque';
    this.sceneSync = options.sceneSync ?? 'auto';
    this.autoPrepare = options.autoPrepare ?? true;
    this.quality = resolveLayeredGlassQuality(
      options.quality ?? 'medium',
      options.qualityOverrides,
    );
    this.resolutionScale = options.resolutionScale
      ?? this.quality.resolutionScale;
    this.maxTraversals = options.maxTraversals
      ?? this.quality.maxTraversals;
    this.colorType = options.colorType ?? (
      supportsFloatColorTargets(renderer)
        ? HalfFloatType
        : UnsignedByteType
    );

    this.rayScene = new LayeredRayScene({
      ...options.rayScene,
      quality: this.quality,
      worker: options.worker ?? true,
      autoOpaqueIntersections: this.autoOpaqueIntersections,
      autoDiscoverGlass: this.autoDiscover,
      onWarning: options.onWarning,
    });

    this._registeredForegroundObjects = new Set();
    this._foregroundVisibilityOverrides = new Map();
    this._explicitRayObjects = new Set();
    this._userRayExclude = options.rayScene?.exclude ?? null;
    this._glassObjects = [];
    this._foregroundObjects = [];
    this._size = new Vector2(1, 1);
    this._resolveSize = new Vector2(1, 1);
    this._scene = null;
    this._sceneSignatures = null;
    this._preparePromise = null;
    this._invalidated = true;
    this._materialInvalidated = false;
    this._outputTexture = null;
    this._outputRenderTarget = null;

    this._resolverMaterial = new ShaderMaterial({
      name: 'LayeredGlassBVHResolver',
      glslVersion: GLSL3,
      vertexShader: bvhResolverVertexShader,
      fragmentShader: createBVHResolverFragmentShader({
        maxTraversals: this.maxTraversals,
        maxMedia: options.maxMedia ?? 8,
        spectral: options.spectral ?? this.quality.spectral,
        roughSamples: options.roughSamples ?? this.quality.roughSamples,
      }),
      uniforms: {
        uBaseColor: { value: null },
        uBaseDepth: { value: null },
        uCoverage: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uInverseProjection: { value: new Matrix4() },
        uCameraMatrixWorld: { value: new Matrix4() },
        uProjectionMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
        uCameraPosition: { value: new Vector3() },
        uBVH: { value: this.rayScene.uniform },
        uNormalAttribute: { value: this.rayScene.normalAttribute },
        uMetaAttribute: { value: this.rayScene.metaAttribute },
        uOpticalAAttribute: { value: this.rayScene.opticalAAttribute },
        uOpticalBAttribute: { value: this.rayScene.opticalBAttribute },
        uOpticalCAttribute: { value: this.rayScene.opticalCAttribute },
        uBaseColorAttribute: { value: this.rayScene.baseColorAttribute },
        uLayered: { value: this.layered ? 1 : 0 },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: false,
    });

    this._copyMaterial = new ShaderMaterial({
      name: 'LayeredGlassBVHCopy',
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: copyFragmentShader,
      uniforms: { uTexture: { value: null } },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: false,
    });
    this._compositeMaterial = new ShaderMaterial({
      name: 'LayeredGlassBVHComposite',
      glslVersion: GLSL3,
      vertexShader: fullscreenVertexShader,
      fragmentShader: coverageCompositeFragmentShader,
      uniforms: {
        uBaseTexture: { value: null },
        uRayTexture: { value: null },
        uCoverageTexture: { value: null },
      },
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: false,
    });
    this._displayMaterial = new MeshBasicMaterial({
      name: 'LayeredGlassBVHDisplay',
      map: null,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: true,
    });
    this._coverageMaterial = new MeshBasicMaterial({
      name: 'LayeredGlassCoverage',
      color: 0xffffff,
      side: DoubleSide,
      depthTest: true,
      depthWrite: true,
      blending: NoBlending,
      toneMapped: false,
    });
    this._skipMaterial = new MeshBasicMaterial({
      name: 'LayeredGlassSkip',
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });

    this._fullscreenScene = new Scene();
    this._fullscreenCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fullscreenQuad = new Mesh(
      new PlaneGeometry(2, 2),
      this._resolverMaterial,
    );
    this._fullscreenQuad.frustumCulled = false;
    this._fullscreenScene.add(this._fullscreenQuad);

    this._allocateTargets(1, 1);
  }

  get ready() { return this.rayScene.ready; }
  get building() { return this.rayScene.building; }
  get outputTexture() { return this._outputTexture; }
  get outputRenderTarget() { return this._outputRenderTarget; }
  get depthTexture() {
    return this.depthMode === 'none' ? null : this._baseTarget.depthTexture;
  }
  get opaqueDepthTexture() { return this._baseTarget.depthTexture; }
  get width() { return this._size.x; }
  get height() { return this._size.y; }

  add(...objects) {
    for (const object of objects) {
      this.setRayVisibility(object, RAY_VISIBILITY.GLASS);
    }
    return this;
  }

  remove(...objects) {
    for (const object of objects) {
      this.setRayVisibility(object, RAY_VISIBILITY.AUTO);
    }
    return this;
  }

  clear() {
    for (const object of [...this._explicitRayObjects]) {
      if (
        object.userData?.layeredGlass?.rayVisibility
        === RAY_VISIBILITY.GLASS
      ) {
        this.setRayVisibility(object, RAY_VISIBILITY.AUTO);
      }
    }
    return this.invalidateScene();
  }

  /** @deprecated Opaque meshes are discovered automatically. */
  addBlocker(object) {
    return this.setRayVisibility(object, RAY_VISIBILITY.OPAQUE);
  }

  addBlockers(...objects) {
    objects.forEach((object) => this.addBlocker(object));
    return this;
  }

  addOpaque(object) { return this.addBlocker(object); }
  removeBlocker(...objects) { return this.remove(...objects); }
  removeOpaque(...objects) { return this.remove(...objects); }

  clearBlockers() {
    for (const object of [...this._explicitRayObjects]) {
      if (
        object.userData?.layeredGlass?.rayVisibility
        === RAY_VISIBILITY.OPAQUE
      ) {
        this.setRayVisibility(object, RAY_VISIBILITY.AUTO);
      }
    }
    return this;
  }

  setRayVisibility(object, visibility = RAY_VISIBILITY.AUTO) {
    if (!object?.userData) return this;
    object.userData.layeredGlass ??= {};
    const current = object.userData.layeredGlass.rayVisibility
      ?? RAY_VISIBILITY.AUTO;
    if (current === visibility) return this;
    if (visibility === RAY_VISIBILITY.AUTO) {
      delete object.userData.layeredGlass.rayVisibility;
      this._explicitRayObjects.delete(object);
    } else {
      object.userData.layeredGlass.rayVisibility = visibility;
      this._explicitRayObjects.add(object);
    }
    return this.invalidateScene();
  }

  addForeground(...objects) {
    for (const object of objects) {
      this._registeredForegroundObjects.add(object);
      if (object?.userData) {
        object.userData.layeredGlass ??= {};
        if (!this._foregroundVisibilityOverrides.has(object)) {
          this._foregroundVisibilityOverrides.set(
            object,
            object.userData.layeredGlass.rayVisibility
              ?? RAY_VISIBILITY.AUTO,
          );
        }
        object.userData.layeredGlass.rayVisibility = RAY_VISIBILITY.IGNORE;
      }
    }
    return this.invalidateScene();
  }

  removeForeground(...objects) {
    for (const object of objects) {
      this._registeredForegroundObjects.delete(object);
      if (this._foregroundVisibilityOverrides.has(object)) {
        const previous = this._foregroundVisibilityOverrides.get(object);
        this._foregroundVisibilityOverrides.delete(object);
        object.userData.layeredGlass ??= {};
        if (previous === RAY_VISIBILITY.AUTO) {
          delete object.userData.layeredGlass.rayVisibility;
        } else {
          object.userData.layeredGlass.rayVisibility = previous;
        }
      }
    }
    return this.invalidateScene();
  }

  clearForeground() {
    return this.removeForeground(...this._registeredForegroundObjects);
  }

  invalidateScene() {
    this._invalidated = true;
    return this;
  }

  invalidateGeometry() { return this.invalidateScene(); }

  invalidateMaterial() {
    this._materialInvalidated = true;
    return this;
  }

  _syncRaySceneOptions() {
    this.rayScene.builder.options.autoOpaqueIntersections
      = this.autoOpaqueIntersections;
    this.rayScene.builder.options.autoDiscoverGlass = this.autoDiscover;
    this.rayScene.builder.options.exclude = (object) => {
      if (
        this.foregroundLayer != null
        && object.layers.isEnabled(this.foregroundLayer)
      ) {
        return true;
      }
      return this._userRayExclude?.(object) === true;
    };
  }

  async prepare(scene, options = {}) {
    this._scene = scene;
    if (this._preparePromise) return this._preparePromise;

    this._syncRaySceneOptions();
    const requestedSignatures = createSceneSignatures(
      scene,
      this.autoDiscover,
    );

    this._preparePromise = this.rayScene.build(scene, options)
      .then(() => {
        this._sceneSignatures = requestedSignatures;
        const currentSignatures = createSceneSignatures(
          scene,
          this.autoDiscover,
        );
        this._invalidated = currentSignatures.geometry
          !== requestedSignatures.geometry;
        this._materialInvalidated = currentSignatures.material
          !== requestedSignatures.material;
        this._bindRaySceneUniforms();
        return this;
      })
      .finally(() => {
        this._preparePromise = null;
      });

    return this._preparePromise;
  }

  _refreshMaterialData(scene) {
    this._syncRaySceneOptions();
    const refreshed = this.rayScene.refreshMaterials(scene);
    if (!refreshed) {
      this._materialInvalidated = false;
      this._invalidated = true;
      return false;
    }

    this._bindRaySceneUniforms();
    this._sceneSignatures = createSceneSignatures(
      scene,
      this.autoDiscover,
    );
    this._materialInvalidated = false;
    return true;
  }

  _bindRaySceneUniforms() {
    const uniforms = this._resolverMaterial.uniforms;
    uniforms.uBVH.value = this.rayScene.uniform;
    uniforms.uNormalAttribute.value = this.rayScene.normalAttribute;
    uniforms.uMetaAttribute.value = this.rayScene.metaAttribute;
    uniforms.uOpticalAAttribute.value = this.rayScene.opticalAAttribute;
    uniforms.uOpticalBAttribute.value = this.rayScene.opticalBAttribute;
    uniforms.uOpticalCAttribute.value = this.rayScene.opticalCAttribute;
    uniforms.uBaseColorAttribute.value = this.rayScene.baseColorAttribute;
  }

  _allocateTargets(width, height) {
    this._baseTarget?.dispose();
    this._rayTarget?.dispose();
    this._resolveTarget?.dispose();
    this._coverageTarget?.dispose();

    this._baseTarget = createTarget(width, height, {
      type: this.colorType,
      depthTexture: true,
      name: 'LayeredGlass.BVH.Base',
    });

    const resolveWidth = Math.max(
      1,
      Math.floor(width * this.resolutionScale),
    );
    const resolveHeight = Math.max(
      1,
      Math.floor(height * this.resolutionScale),
    );
    this._resolveSize.set(resolveWidth, resolveHeight);

    this._rayTarget = createTarget(resolveWidth, resolveHeight, {
      type: this.colorType,
      name: 'LayeredGlass.BVH.RayResolve',
    });
    this._coverageTarget = createTarget(resolveWidth, resolveHeight, {
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      name: 'LayeredGlass.BVH.Coverage',
    });
    this._resolveTarget = createTarget(width, height, {
      type: this.colorType,
      name: 'LayeredGlass.BVH.Composite',
    });
  }

  setSize(width, height) {
    const resolvedWidth = Math.max(1, Math.floor(width));
    const resolvedHeight = Math.max(1, Math.floor(height));
    if (
      this._size.x === resolvedWidth
      && this._size.y === resolvedHeight
    ) {
      return this;
    }
    this._size.set(resolvedWidth, resolvedHeight);
    this._allocateTargets(resolvedWidth, resolvedHeight);
    return this;
  }

  _syncSize(outputTarget, width, height) {
    if (width != null && height != null) return this.setSize(width, height);
    if (outputTarget?.isRenderTarget) {
      return this.setSize(outputTarget.width, outputTarget.height);
    }
    this.renderer.getDrawingBufferSize(_drawingBufferSize);
    return this.setSize(_drawingBufferSize.x, _drawingBufferSize.y);
  }

  _collectGlass(scene, provided) {
    this._glassObjects.length = 0;
    const seen = new Set();
    const append = (object) => {
      if (isGlassObject(object, this.autoDiscover)) {
        appendUnique(this._glassObjects, seen, object);
      }
    };

    if (provided) {
      provided.forEach((root) => {
        if (root?.traverseVisible) root.traverseVisible(append);
        else append(root);
      });
    } else {
      scene.traverseVisible(append);
    }
    return this._glassObjects;
  }

  _collectForeground(scene, provided) {
    this._foregroundObjects.length = 0;
    const seen = new Set();
    const append = (object) => {
      if (
        isRenderableObject(object)
        && !isGlassObject(object, this.autoDiscover)
      ) {
        appendUnique(this._foregroundObjects, seen, object);
      }
    };

    const roots = provided ?? [...this._registeredForegroundObjects];
    roots.forEach((root) => {
      if (root?.traverseVisible) root.traverseVisible(append);
      else append(root);
    });

    if (this.foregroundLayer != null) {
      scene.traverseVisible((object) => {
        if (object.layers.isEnabled(this.foregroundLayer)) append(object);
      });
    }
    return this._foregroundObjects;
  }

  _applyBaseFilter(glassObjects, foregroundObjects) {
    const state = new Map();
    const glassSet = new Set(glassObjects);

    for (const object of glassObjects) {
      if (!object.isMesh) continue;
      const materials = asMaterialArray(object.material);
      const hasOpaque = materials.some(
        (material) => !isGlassSurface(object, material, this.autoDiscover),
      );
      if (!hasOpaque) {
        setObjectVisible(state, object, false);
      } else {
        setObjectMaterial(
          state,
          object,
          materials.map((material) => (
            isGlassSurface(object, material, this.autoDiscover)
              ? this._skipMaterial
              : material
          )),
        );
      }
    }

    for (const object of foregroundObjects) {
      if (!glassSet.has(object)) setObjectVisible(state, object, false);
    }
    return state;
  }

  _applyCoverageFilter(scene, glassObjects) {
    const state = new Map();
    const glassSet = new Set(glassObjects);

    scene.traverseVisible((object) => {
      if (!isRenderableObject(object)) return;
      if (!object.isMesh || !glassSet.has(object)) {
        setObjectVisible(state, object, false);
        return;
      }

      const materials = asMaterialArray(object.material);
      if (Array.isArray(object.material)) {
        setObjectMaterial(
          state,
          object,
          materials.map((material) => (
            isGlassSurface(object, material, this.autoDiscover)
              ? this._coverageMaterial
              : this._skipMaterial
          )),
        );
      } else if (
        isGlassSurface(object, object.material, this.autoDiscover)
      ) {
        setObjectMaterial(state, object, this._coverageMaterial);
      } else {
        setObjectVisible(state, object, false);
      }
    });

    return state;
  }

  _renderFullscreen(material, target, clear = true) {
    this._fullscreenQuad.material = material;
    this.renderer.setRenderTarget(target);
    if (clear) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }
    this.renderer.render(this._fullscreenScene, this._fullscreenCamera);
  }

  _renderCoverage(scene, camera, glassObjects) {
    const state = this._applyCoverageFilter(scene, glassObjects);
    const previousOverride = scene.overrideMaterial;
    try {
      scene.overrideMaterial = null;
      this.renderer.setRenderTarget(this._coverageTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
      this.renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = previousOverride;
      restoreObjectState(state);
    }
  }

  _renderForeground(scene, camera, objects) {
    if (objects.length === 0) return;
    const foregroundSet = new Set(objects);
    const state = new Map();
    scene.traverseVisible((object) => {
      if (isRenderableObject(object) && !foregroundSet.has(object)) {
        setObjectVisible(state, object, false);
      }
    });

    try {
      this.renderer.setRenderTarget(this._resolveTarget);
      this.renderer.clearDepth();
      this.renderer.render(scene, camera);
    } finally {
      restoreObjectState(state);
    }
  }

  _schedulePrepare(scene) {
    if (!this.autoPrepare || this._preparePromise) return;
    this.prepare(scene).catch((error) => {
      console.error('LayeredGlass BVH prepare failed.', error);
    });
  }

  _syncScene(scene) {
    if (this.sceneSync !== 'auto' || !this.rayScene.ready) return;
    const signatures = createSceneSignatures(scene, this.autoDiscover);
    if (
      !this._sceneSignatures
      || signatures.geometry !== this._sceneSignatures.geometry
    ) {
      this._invalidated = true;
      return;
    }
    if (signatures.material !== this._sceneSignatures.material) {
      this._materialInvalidated = true;
    }
  }

  render(scene, camera, options = {}) {
    const outputTarget = options.outputTarget ?? null;
    this._syncSize(outputTarget, options.width, options.height);
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    if (options.blockerObjects || options.blockers) {
      for (const object of options.blockerObjects ?? options.blockers) {
        this.setRayVisibility(object, RAY_VISIBILITY.OPAQUE);
      }
    }

    this._syncScene(scene);
    if (this._materialInvalidated && this.rayScene.ready) {
      this._refreshMaterialData(scene);
    }
    if (this._invalidated || !this.rayScene.ready) {
      this._schedulePrepare(scene);
    }

    const glassObjects = this._collectGlass(scene, options.glassObjects);
    const foregroundObjects = this._collectForeground(
      scene,
      options.foregroundObjects,
    );
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousToneMapping = renderer.toneMapping;
    const previousXr = renderer.xr.enabled;
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousClearAlpha = renderer.getClearAlpha();
    const previousScissorTest = renderer.getScissorTest();
    const previousInfoAutoReset = renderer.info.autoReset;
    renderer.getClearColor(_clearColor);
    renderer.getViewport(_viewport);
    renderer.getScissor(_scissor);
    const previousOverride = scene.overrideMaterial;

    if (this.manageRendererInfo && previousInfoAutoReset) {
      renderer.info.reset();
      renderer.info.autoReset = false;
    }
    renderer.autoClear = false;
    renderer.toneMapping = NoToneMapping;
    renderer.xr.enabled = false;

    try {
      const baseState = this._applyBaseFilter(
        glassObjects,
        foregroundObjects,
      );
      try {
        renderer.setRenderTarget(this._baseTarget);
        renderer.setClearColor(_clearColor, previousClearAlpha);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      } finally {
        restoreObjectState(baseState);
      }
      renderer.shadowMap.autoUpdate = false;

      if (
        this.rayScene.ready
        && this.rayScene.glassTriangleCount > 0
        && glassObjects.length > 0
      ) {
        this._renderCoverage(scene, camera, glassObjects);
        const uniforms = this._resolverMaterial.uniforms;
        uniforms.uBaseColor.value = this._baseTarget.texture;
        uniforms.uBaseDepth.value = this._baseTarget.depthTexture;
        uniforms.uCoverage.value = this._coverageTarget.texture;
        uniforms.uResolution.value.copy(this._resolveSize);
        uniforms.uInverseProjection.value.copy(camera.projectionMatrixInverse);
        uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);
        uniforms.uProjectionMatrix.value.copy(camera.projectionMatrix);
        uniforms.uViewMatrix.value.copy(camera.matrixWorldInverse);
        uniforms.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
        uniforms.uLayered.value = this.layered ? 1 : 0;
        this._renderFullscreen(this._resolverMaterial, this._rayTarget);

        const compositeUniforms = this._compositeMaterial.uniforms;
        compositeUniforms.uBaseTexture.value = this._baseTarget.texture;
        compositeUniforms.uRayTexture.value = this._rayTarget.texture;
        compositeUniforms.uCoverageTexture.value = this._coverageTarget.texture;
        this._renderFullscreen(this._compositeMaterial, this._resolveTarget);
      } else {
        this._copyMaterial.uniforms.uTexture.value = this._baseTarget.texture;
        this._renderFullscreen(this._copyMaterial, this._resolveTarget);
      }

      this._renderForeground(scene, camera, foregroundObjects);
      this._outputTexture = this._resolveTarget.texture;
      this._outputRenderTarget = this._resolveTarget;

      const shouldPresent = options.present ?? this.renderToScreen;
      if (shouldPresent) {
        const toneMap = options.toneMap ?? outputTarget === null;
        renderer.toneMapping = toneMap ? previousToneMapping : NoToneMapping;
        if (toneMap) {
          const mapChanged = this._displayMaterial.map
            !== this._resolveTarget.texture;
          this._displayMaterial.map = this._resolveTarget.texture;
          if (mapChanged) this._displayMaterial.needsUpdate = true;
          this._renderFullscreen(this._displayMaterial, outputTarget);
        } else {
          this._copyMaterial.uniforms.uTexture.value
            = this._resolveTarget.texture;
          this._renderFullscreen(this._copyMaterial, outputTarget);
        }
      }

      return this._resolveTarget.texture;
    } finally {
      scene.overrideMaterial = previousOverride;
      renderer.autoClear = previousAutoClear;
      renderer.toneMapping = previousToneMapping;
      renderer.xr.enabled = previousXr;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      renderer.info.autoReset = previousInfoAutoReset;
      renderer.setClearColor(_clearColor, previousClearAlpha);
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(_viewport);
      renderer.setScissor(_scissor);
      renderer.setScissorTest(previousScissorTest);
    }
  }

  getMemoryReport() { return this.rayScene.getMemoryReport(); }

  dispose() {
    this.clearForeground();
    this.rayScene.dispose();
    this._baseTarget.dispose();
    this._rayTarget.dispose();
    this._resolveTarget.dispose();
    this._coverageTarget.dispose();
    this._resolverMaterial.dispose();
    this._copyMaterial.dispose();
    this._compositeMaterial.dispose();
    this._displayMaterial.dispose();
    this._coverageMaterial.dispose();
    this._skipMaterial.dispose();
    this._fullscreenQuad.geometry.dispose();
  }
}
