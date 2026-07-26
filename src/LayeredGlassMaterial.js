import {
  Color,
  FrontSide,
  GLSL3,
  NoBlending,
  Matrix4,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import {
  layeredGlassFragmentShader,
  layeredGlassVertexShader,
} from './shaders/glass.js';

const DEFAULTS = {
  ior: 1.48,
  roughness: 0.06,
  attenuationDistance: 3.2,
  attenuationColor: 0xb8dcff,
  refractionReach: 2.2,
  reflectionStrength: 1,
  dispersion: 0.008,
  iterations: 7,
  priority: 0,
  shape: 'auto',
  radius: 0,
  halfExtents: null,
  center: null,
  bodyTintStrength: 1,
  mode: 'volume',
  thickness: 0.01,
};

/**
 * Optical glass material consumed by LayeredGlassComposer.
 *
 * The BVH backend reads the public optical properties as per-triangle metadata.
 * The inherited ShaderMaterial program remains available to the analytic and
 * legacy backends for migration and fast-path rendering.
 */
export class LayeredGlassMaterial extends ShaderMaterial {
  constructor(parameters = {}) {
    const options = { ...DEFAULTS, ...parameters };

    super({
      name: 'LayeredGlassMaterial',
      glslVersion: GLSL3,
      vertexShader: layeredGlassVertexShader,
      fragmentShader: layeredGlassFragmentShader,
      defines: {
        LAYERED_GLASS_ITERATIONS: Math.max(1, Math.round(options.iterations)),
      },
      uniforms: {
        uSourceTexture: { value: null },
        uBackPositionTexture: { value: null },
        uBackNormalTexture: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uIor: { value: options.ior },
        uRoughness: { value: options.roughness },
        uAttenuationDistance: { value: options.attenuationDistance },
        uAttenuationColor: { value: new Color(options.attenuationColor) },
        uRefractionReach: { value: options.refractionReach },
        uReflectionStrength: { value: options.reflectionStrength },
        uDispersion: { value: options.dispersion },
        uProjectionMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
        uCameraPosition: { value: new Vector3() },
      },
      side: FrontSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      blending: NoBlending,
      toneMapped: false,
    });

    this.isLayeredGlassMaterial = true;
    this.priority = options.priority;
    this.shape = options.shape;
    this.radius = options.radius;
    this.halfExtents = options.halfExtents;
    this.center = options.center;
    this.bodyTintStrength = options.bodyTintStrength;
    this.mode = options.mode;
    this.thickness = options.thickness;
  }

  get ior() {
    return this.uniforms.uIor.value;
  }

  set ior(value) {
    this.uniforms.uIor.value = value;
  }

  get roughness() {
    return this.uniforms.uRoughness.value;
  }

  set roughness(value) {
    this.uniforms.uRoughness.value = value;
  }

  get attenuationDistance() {
    return this.uniforms.uAttenuationDistance.value;
  }

  set attenuationDistance(value) {
    this.uniforms.uAttenuationDistance.value = value;
  }

  get attenuationColor() {
    return this.uniforms.uAttenuationColor.value;
  }

  set attenuationColor(value) {
    this.uniforms.uAttenuationColor.value.set(value);
  }

  get refractionReach() {
    return this.uniforms.uRefractionReach.value;
  }

  set refractionReach(value) {
    this.uniforms.uRefractionReach.value = value;
  }

  get reflectionStrength() {
    return this.uniforms.uReflectionStrength.value;
  }

  set reflectionStrength(value) {
    this.uniforms.uReflectionStrength.value = value;
  }

  get dispersion() {
    return this.uniforms.uDispersion.value;
  }

  set dispersion(value) {
    this.uniforms.uDispersion.value = value;
  }

  get iterations() {
    return this.defines.LAYERED_GLASS_ITERATIONS;
  }

  set iterations(value) {
    const next = Math.max(1, Math.round(value));
    if (next === this.defines.LAYERED_GLASS_ITERATIONS) return;
    this.defines.LAYERED_GLASS_ITERATIONS = next;
    this.needsUpdate = true;
  }

  setSize(width, height) {
    this.uniforms.uResolution.value.set(width, height);
    return this;
  }


  setCamera(camera) {
    camera.updateMatrixWorld(true);
    this.uniforms.uProjectionMatrix.value.copy(camera.projectionMatrix);
    this.uniforms.uViewMatrix.value.copy(camera.matrixWorldInverse);
    this.uniforms.uCameraPosition.value.setFromMatrixPosition(camera.matrixWorld);
    return this;
  }

  setComposerTextures(sourceTexture, backPositionTexture, backNormalTexture) {
    this.uniforms.uSourceTexture.value = sourceTexture;
    this.uniforms.uBackPositionTexture.value = backPositionTexture;
    this.uniforms.uBackNormalTexture.value = backNormalTexture;
    return this;
  }

  copy(source) {
    super.copy(source);
    this.priority = source.priority;
    this.shape = source.shape;
    this.radius = source.radius;
    this.halfExtents = source.halfExtents;
    this.center = source.center;
    this.bodyTintStrength = source.bodyTintStrength;
    this.mode = source.mode;
    this.thickness = source.thickness;
    this.isLayeredGlassMaterial = true;
    return this;
  }
}
