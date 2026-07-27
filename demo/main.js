import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import {
  LayeredGlassAdaptiveQuality,
  LayeredGlassComposer,
  LayeredGlassMaterial,
  supportsLayeredGlass,
} from '../src/index.js';

const MAX_PANELS = 12;
const PANEL_WIDTH = 2.55;
const PANEL_HEIGHT = 3.85;
const PANEL_RADIUS = 0.11;
const PANEL_STEP_X_WIDE = 0.92;
const PANEL_STEP_X_DENSE = 0.46;
const PANEL_STEP_Z_WIDE = 0.60;
const PANEL_STEP_Z_DENSE = 0.38;
const PANEL_Y = PANEL_HEIGHT * 0.5 + 0.035;
const HDR_URLS = [
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
  'https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr',
];

const app = document.querySelector('#app');
const errorElement = document.querySelector('#error');
const errorMessageElement = document.querySelector('#error-message');
const loadingIndicator = document.querySelector('#loading-indicator');
const environmentBadge = document.querySelector('#environment-badge');
const bufferBadge = document.querySelector('#buffer-badge');
const fpsBadge = document.querySelector('#fps-badge');
const compactStatus = document.querySelector('#compact-status');
const glassCountBadge = document.querySelector('#glass-count');
const opaqueCountBadge = document.querySelector('#opaque-count');

function fail(message, error) {
  console.error(message, error || '');
  errorMessageElement.textContent = error?.message
    ? `${message}: ${error.message}`
    : message;
  errorElement.classList.add('is-visible');
}

const isMobile = window.matchMedia('(max-width: 680px)').matches;
const maximumPixelRatio = isMobile ? 1 : 1.25;
const initialResolutionScale = isMobile ? 0.55 : 0.75;

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  depth: true,
  powerPreference: 'high-performance',
});

if (!supportsLayeredGlass(renderer)) {
  fail('WebGL2 is required for the layered glass BVH demo.');
  throw new Error('WebGL2 is required.');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maximumPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute(
  'aria-label',
  'Per-pixel triangle-BVH layered glass panel demo',
);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

function createStudioBackdropTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#c8d0dc');
  gradient.addColorStop(0.42, '#929dab');
  gradient.addColorStop(0.72, '#46505d');
  gradient.addColorStop(1, '#171b22');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const leftSoftbox = context.createRadialGradient(210, 250, 10, 210, 250, 330);
  leftSoftbox.addColorStop(0, 'rgba(255,255,255,0.82)');
  leftSoftbox.addColorStop(0.45, 'rgba(210,230,255,0.22)');
  leftSoftbox.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = leftSoftbox;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  context.fillStyle = '#d6d8da';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(64,72,82,0.18)';
  context.lineWidth = 2;

  for (let position = 0; position <= canvas.width; position += 64) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, canvas.height);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(canvas.width, position);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(7, 7);
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

scene.background = createStudioBackdropTexture();
scene.fog = new THREE.Fog(0x6d7682, 22, 54);

const camera = new THREE.PerspectiveCamera(
  34,
  window.innerWidth / window.innerHeight,
  0.05,
  100,
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, PANEL_HEIGHT * 0.5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.enablePan = false;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.48;

scene.add(new THREE.HemisphereLight(0xffffff, 0x87919f, 0.48));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
keyLight.position.set(-5, 8, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -12;
keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12;
keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 32;
keyLight.shadow.bias = -0.0002;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x9dbaff, 0.42);
fillLight.position.set(7, 3, 2);
scene.add(fillLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(48, 48),
  new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: createFloorTexture(),
    roughness: 0.27,
    metalness: 0.08,
    clearcoat: 0.34,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.05,
  }),
);
floor.rotation.x = -Math.PI * 0.5;
floor.receiveShadow = true;
scene.add(floor);

const panelGroup = new THREE.Group();
scene.add(panelGroup);

const layeredComposer = new LayeredGlassComposer(renderer, {
  backend: 'bvh',
  quality: isMobile ? 'low' : 'medium',
  resolutionScale: initialResolutionScale,
  coverageScale: 1,
  coverageSamples: isMobile ? 0 : 2,
  colorType: isMobile ? THREE.UnsignedByteType : undefined,
  maxMedia: isMobile ? 4 : 8,
  worker: true,
  sceneSync: 'manual',
  layered: true,
  autoDiscover: true,
  autoOpaqueIntersections: true,
  depthMode: 'opaque',
});

const adaptiveQuality = isMobile
  ? new LayeredGlassAdaptiveQuality(layeredComposer, {
      minScale: 0.45,
      maxScale: 0.62,
      initialScale: initialResolutionScale,
      targetFrameTime: 1000 / 30,
      adjustmentInterval: 1200,
      stepDown: 0.05,
      stepUp: 0.025,
    })
  : null;
let preparedMemoryReport = null;

function renderProfileLabel() {
  if (!adaptiveQuality) return 'desktop';
  return `mobile adaptive · ${adaptiveQuality.scale.toFixed(2)}× ray`;
}

function updateBufferBadge() {
  if (!preparedMemoryReport) return;
  bufferBadge.textContent = [
    `BVH · ${preparedMemoryReport.triangles.toLocaleString()} tris`,
    renderProfileLabel(),
  ].join(' · ');
}

const state = {
  layered: true,
  panelCount: 5,
  panelThickness: 0.36,
  glassColor: '#8bcfff',
  ior: 1.48,
  roughness: 0.05,
  attenuationDistance: 1.15,
  refractionReach: 2.10,
  reflectionStrength: 1.85,
  dispersion: 0.006,
  assignment: 'glass',
};

const opaquePalette = [
  0xf4f1eb,
  0xff8b74,
  0xf5c05c,
  0x62c8bd,
  0x8aa9ff,
  0xb58be0,
];
let panelRecords = [];
let sharedPanelGeometry = null;
let randomKinds = [];

function disposePanelScene() {
  panelGroup.clear();
  sharedPanelGeometry?.dispose();
  for (const record of panelRecords) record.material?.dispose?.();
  panelRecords = [];
}

function makeRandomKinds() {
  const kinds = Array.from(
    { length: state.panelCount },
    () => Math.random() < 0.66 ? 'glass' : 'opaque',
  );
  const glassCount = kinds.filter((kind) => kind === 'glass').length;
  if (glassCount < Math.min(2, state.panelCount)) {
    kinds[0] = 'glass';
    if (state.panelCount > 1) kinds[state.panelCount - 1] = 'glass';
  }
  if (state.panelCount >= 3 && kinds.every((kind) => kind === 'glass')) {
    kinds[Math.floor(state.panelCount * 0.5)] = 'opaque';
  }
  return kinds;
}

function getKinds() {
  if (state.assignment === 'glass') {
    return Array.from({ length: state.panelCount }, () => 'glass');
  }
  if (randomKinds.length !== state.panelCount) randomKinds = makeRandomKinds();
  return randomKinds;
}

function getPanelSpacing() {
  const density = THREE.MathUtils.clamp((state.panelCount - 2) / 10, 0, 1);
  return {
    x: THREE.MathUtils.lerp(PANEL_STEP_X_WIDE, PANEL_STEP_X_DENSE, density),
    z: THREE.MathUtils.lerp(PANEL_STEP_Z_WIDE, PANEL_STEP_Z_DENSE, density),
  };
}

function fitCamera() {
  const spacing = getPanelSpacing();
  const depthSpan = Math.max(0, state.panelCount - 1) * spacing.z;
  const lateralSpan = Math.max(0, state.panelCount - 1) * spacing.x;
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const heightDistance = (
    PANEL_HEIGHT * (isMobile ? 0.79 : 0.72)
  ) / Math.tan(verticalFov * 0.5);
  const distance = heightDistance
    + depthSpan * 0.13
    + lateralSpan * 0.08
    + 0.75;
  const target = new THREE.Vector3(
    0,
    PANEL_HEIGHT * (isMobile ? 0.44 : 0.50),
    -depthSpan * 0.04,
  );
  const direction = new THREE.Vector3(0.54, 0.14, 1).normalize();

  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  controls.minDistance = Math.max(5.4, distance * 0.58);
  controls.maxDistance = distance * 2.1;
  camera.near = Math.max(0.035, distance * 0.0035);
  camera.far = Math.max(90, distance * 6);
  camera.updateProjectionMatrix();
  controls.update();
}

function createGlassMaterial() {
  return new LayeredGlassMaterial({
    ior: state.ior,
    roughness: state.roughness,
    attenuationDistance: state.attenuationDistance,
    attenuationColor: state.glassColor,
    refractionReach: state.refractionReach,
    reflectionStrength: state.reflectionStrength,
    dispersion: state.dispersion,
  });
}

function rebuildPanels({ resetCamera = true } = {}) {
  disposePanelScene();

  const radius = Math.min(PANEL_RADIUS, state.panelThickness * 0.42);
  sharedPanelGeometry = new RoundedBoxGeometry(
    PANEL_WIDTH,
    PANEL_HEIGHT,
    state.panelThickness,
    isMobile ? 4 : 6,
    radius,
  );

  const kinds = getKinds();
  const center = (state.panelCount - 1) * 0.5;
  const spacing = getPanelSpacing();

  kinds.forEach((kind, index) => {
    const offset = index - center;
    const normalized = state.panelCount > 1
      ? index / (state.panelCount - 1) - 0.5
      : 0;
    const holder = new THREE.Object3D();
    holder.position.set(
      offset * spacing.x,
      PANEL_Y,
      -offset * spacing.z,
    );
    const alternatingTilt = index % 2 === 0 ? -0.035 : 0.035;
    holder.rotation.y = -0.20 + normalized * 0.38 + alternatingTilt;
    panelGroup.add(holder);

    let material;
    let mesh;

    if (kind === 'glass') {
      material = createGlassMaterial();
      mesh = new THREE.Mesh(sharedPanelGeometry, material);
      holder.add(mesh);
    } else {
      material = new THREE.MeshPhysicalMaterial({
        color: opaquePalette[index % opaquePalette.length],
        roughness: 0.31,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.2,
        envMapIntensity: 1.05,
      });
      mesh = new THREE.Mesh(sharedPanelGeometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
    }

    panelRecords.push({ kind, holder, mesh, material, index });
  });

  const glassCount = panelRecords.filter((record) => record.kind === 'glass').length;
  glassCountBadge.textContent = `${glassCount} glass`;
  opaqueCountBadge.textContent = `${state.panelCount - glassCount} opaque`;
  compactStatus.textContent = `${state.panelCount} panels`;
  layeredComposer.invalidateScene();
  renderer.shadowMap.needsUpdate = true;

  if (resetCamera) fitCamera();
}

async function loadHdrEnvironment(urls) {
  const loader = new RGBELoader();
  for (const url of urls) {
    try {
      const texture = await loader.loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
      environmentBadge.textContent = url.includes('polyhaven')
        ? 'Poly Haven HDR global light'
        : 'HDR fallback global light';
      loadingIndicator.classList.add('is-hidden');
      return;
    } catch (error) {
      console.warn(`Unable to load HDR environment from ${url}.`, error);
    }
  }
  environmentBadge.textContent = 'Procedural studio light';
  loadingIndicator.classList.add('is-hidden');
}

loadHdrEnvironment(HDR_URLS);

const gl = renderer.getContext();
bufferBadge.textContent = gl.getExtension('EXT_color_buffer_float')
  ? 'Triangle BVH · HDR target'
  : 'Triangle BVH · mobile target';

renderer.debug.onShaderError = (context, program, vertexShader, fragmentShader) => {
  const log = [
    context.getShaderInfoLog(vertexShader),
    context.getShaderInfoLog(fragmentShader),
    context.getProgramInfoLog(program),
  ].filter(Boolean).join('\n');
  if (log) fail('The GPU rejected the layered glass shader', new Error(log));
};

function setLayeredMode(layered) {
  state.layered = layered;
  layeredComposer.layered = layered;
  document.querySelector('#layered-button').setAttribute('aria-pressed', String(layered));
  document.querySelector('#naive-button').setAttribute('aria-pressed', String(!layered));
}

document.querySelector('#layered-button').addEventListener('click', () => setLayeredMode(true));
document.querySelector('#naive-button').addEventListener('click', () => setLayeredMode(false));

function updateGlassMaterials(property, value) {
  for (const record of panelRecords) {
    if (record.kind === 'glass') record.material[property] = value;
  }
  layeredComposer.invalidateMaterial();
}

function bindRange(id, outputId, stateKey, property, digits = 2, rebuild = false) {
  const input = document.querySelector(`#${id}`);
  const output = document.querySelector(`#${outputId}`);
  const update = () => {
    const value = Number(input.value);
    state[stateKey] = value;
    output.textContent = value.toFixed(digits);
    if (property) updateGlassMaterials(property, value);
    if (rebuild) rebuildPanels({ resetCamera: false });
  };
  input.addEventListener('input', update);
  update();
}

bindRange('panel-thickness', 'panel-thickness-output', 'panelThickness', null, 2, true);
bindRange('ior', 'ior-output', 'ior', 'ior', 2);
bindRange('roughness', 'roughness-output', 'roughness', 'roughness', 2);
bindRange('attenuation', 'attenuation-output', 'attenuationDistance', 'attenuationDistance', 2);
bindRange('reach', 'reach-output', 'refractionReach', 'refractionReach', 2);
bindRange('reflection', 'reflection-output', 'reflectionStrength', 'reflectionStrength', 2);
bindRange('dispersion', 'dispersion-output', 'dispersion', 'dispersion', 3);

const panelCountInput = document.querySelector('#panel-count');
const panelCountOutput = document.querySelector('#panel-count-output');
panelCountInput.addEventListener('input', () => {
  state.panelCount = Number(panelCountInput.value);
  panelCountOutput.textContent = String(state.panelCount);
  if (state.assignment === 'random') randomKinds = makeRandomKinds();
  rebuildPanels();
});

const colorInput = document.querySelector('#glass-color');
const colorOutput = document.querySelector('#glass-color-output');
colorInput.addEventListener('input', () => {
  state.glassColor = colorInput.value;
  colorOutput.textContent = colorInput.value.toUpperCase();
  updateGlassMaterials('attenuationColor', colorInput.value);
});

const allGlassButton = document.querySelector('#all-glass-button');
const randomizeButton = document.querySelector('#randomize-button');

function setAssignment(mode) {
  state.assignment = mode;
  if (mode === 'random') randomKinds = makeRandomKinds();
  allGlassButton.setAttribute('aria-pressed', String(mode === 'glass'));
  randomizeButton.setAttribute('aria-pressed', String(mode === 'random'));
  rebuildPanels({ resetCamera: false });
}

allGlassButton.addEventListener('click', () => setAssignment('glass'));
randomizeButton.addEventListener('click', () => setAssignment('random'));

const controlPanel = document.querySelector('#control-panel');
const panelToggle = document.querySelector('#panel-toggle');
function setPanelExpanded(expanded) {
  controlPanel.dataset.expanded = String(expanded);
  panelToggle.setAttribute('aria-expanded', String(expanded));
}
panelToggle.addEventListener('click', () => {
  setPanelExpanded(controlPanel.dataset.expanded !== 'true');
});
if (isMobile) setPanelExpanded(false);

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maximumPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleResize);

let fpsFrames = 0;
let fpsTime = performance.now();
function updateFps(time) {
  fpsFrames += 1;
  if (time - fpsTime >= 700) {
    fpsBadge.textContent = `${Math.round((fpsFrames * 1000) / (time - fpsTime))} FPS`;
    fpsFrames = 0;
    fpsTime = time;
  }
}

rebuildPanels();
setLayeredMode(true);
panelCountOutput.textContent = String(state.panelCount);
colorOutput.textContent = state.glassColor.toUpperCase();

layeredComposer.prepare(scene, {
  worker: true,
  onProgress(progress) {
    bufferBadge.textContent = `Building BVH · ${Math.round(progress * 100)}%`;
  },
}).then(() => {
  preparedMemoryReport = layeredComposer.getMemoryReport();
  updateBufferBadge();
}).catch((error) => {
  fail('Unable to prepare the triangle BVH', error);
});

let previousFrameTime = performance.now();
function render(time) {
  const frameTime = time - previousFrameTime;
  previousFrameTime = time;
  controls.update();
  if (adaptiveQuality?.update(frameTime, time)) updateBufferBadge();
  layeredComposer.render(scene, camera);
  updateFps(time);
  requestAnimationFrame(render);
}

renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
requestAnimationFrame(render);
