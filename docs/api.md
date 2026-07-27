# Three.js API

The primary API has two classes: `LayeredGlassMaterial` describes the optics and `LayeredGlassComposer` renders every glass layer with the existing `WebGLRenderer`.

## LayeredGlassMaterial

```js
import { LayeredGlassMaterial } from 'three-layered-glass';

const material = new LayeredGlassMaterial({
  mode: 'volume',
  ior: 1.48,
  roughness: 0.06,
  attenuationColor: '#b8dcff',
  attenuationDistance: 3.2,
  dispersion: 0.008,
});
```

### Common parameters

| Parameter | Default | Notes |
| --- | ---: | --- |
| `mode` | `'volume'` | Use `'thin'` for a single surface |
| `thickness` | `0.01` | Used by thin mode; volume distance comes from geometry |
| `ior` | `1.48` | Index of refraction |
| `roughness` | `0.06` | Conventional `0..1` range |
| `attenuationColor` | `#b8dcff` | Accepts any Three.js color representation |
| `attenuationDistance` | `3.2` | Must be positive |
| `dispersion` | `0.008` | Spectral IOR separation |

### Additional optical parameters

| Parameter | Default | Notes |
| --- | ---: | --- |
| `refractionReach` | `2.2` | Maximum screen-space reach used by fallback sampling |
| `reflectionStrength` | `1` | Scales the front-surface reflection |
| `bodyTintStrength` | `1` | Scales tint-aware diffuse transmission at high roughness |

`iterations`, `priority`, `shape`, `radius`, `halfExtents`, and `center` are compatibility controls available through the advanced or legacy type surfaces. New static-BVH scenes should not use them.

The material extends `THREE.ShaderMaterial`. Change optical properties directly:

```js
material.ior = 1.52;
material.roughness = 0.12;
material.attenuationColor = '#ffe0ea';
```

With automatic scene synchronization these changes are detected. In manual mode, notify the composer with `invalidateMaterial(mesh)`.

Call `material.dispose()` when the material will no longer be used.

## LayeredGlassComposer

```js
import { LayeredGlassComposer } from 'three-layered-glass';

const glass = new LayeredGlassComposer(renderer, {
  quality: 'medium',
});
```

The default configuration is intended for the common case:

- `backend: 'auto'` prepares the static triangle BVH and uses a fallback until it is ready;
- `quality: 'medium'` balances traversal cost and resolution;
- `worker: true` prepares off the main thread when `Worker` is available;
- visible opaque meshes and `LayeredGlassMaterial` meshes are discovered automatically;
- scene signatures are checked periodically for optical or structural changes.

### Lifecycle

```js
await glass.prepare(scene, {
  onProgress(progress) {
    loadingBar.value = progress;
  },
});

renderer.setAnimationLoop(() => {
  glass.render(scene, camera);
});

glass.dispose();
```

`prepare(scene)` is safe to await during loading. Calling it again rebuilds the static ray scene, so use it only after geometry, visibility classification, or world transforms change.

`render(scene, camera)` automatically tracks the drawing-buffer size and returns the current output texture.

### Invalidating changes

```js
// Optical values only: metadata refresh, no BVH topology rebuild.
material.ior = 1.52;
glass.invalidateMaterial(glassMesh);

// Geometry, transform, groups, draw range, or classification changed.
glassMesh.position.x += 1;
glass.invalidateGeometry(glassMesh);
await glass.prepare(scene);
```

For an editor or another explicit synchronization pipeline:

```js
const glass = new LayeredGlassComposer(renderer, {
  sceneSync: 'manual',
});
```

### Ray visibility

Ordinary opaque meshes are included automatically. Opt out only for helpers, overlays, or geometry that should not affect refraction:

```js
glass.setRayVisibility(helperMesh, 'ignore');
```

Values are `auto`, `opaque`, `glass`, and `ignore`. The same override can be attached before preparation:

```js
helperMesh.userData.layeredGlass = {
  rayVisibility: 'ignore',
};
```

### Runtime quality controls

These controls reallocate render targets but do not rebuild the BVH:

```js
glass.setResolutionScale(0.6);
glass.setCoverageScale(1);
glass.setCoverageSamples(0);
glass.setTransmissionAntialias(true);
```

See [Performance and quality](./performance.md) before overriding the preset.

### Outputs and diagnostics

The composer exposes:

- `ready` and `building`;
- `activeBackend`;
- `outputTexture` and `outputRenderTarget`;
- `depthTexture` and `opaqueDepthTexture`;
- `width`, `height`, and active resolution controls;
- `getMemoryReport()` for triangle, BVH, and estimated GPU memory totals.

## Capability check

```js
import { supportsLayeredGlass } from 'three-layered-glass';

if (!supportsLayeredGlass(renderer)) {
  // Install a normal Three.js material fallback.
}
```

## Post-processing

```js
import { LayeredGlassPass } from 'three-layered-glass/postprocessing';

const pass = new LayeredGlassPass(scene, camera, {
  quality: 'medium',
});
effectComposer.addPass(pass);
```

Use it instead of a normal `RenderPass`. The pass implements `setSize()` and `dispose()` and exposes its underlying composer after preparation.

## Advanced and legacy imports

Static-BVH builders, backend-specific composers, constants, and adaptive-quality primitives live in:

```js
import {
  LayeredGlassComposer,
  LayeredRayScene,
} from 'three-layered-glass/advanced';
```

Importing the composer from this subpath exposes backend selection, custom targets, foreground layers, shader traversal limits, and the complete integration option type.

Migration-only classes and blocker aliases live in:

```js
import { LegacyLayeredGlassComposer } from 'three-layered-glass/legacy';
```

Application code should normally use only the primary entrypoint.
