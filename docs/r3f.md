# React Three Fiber

The R3F integration owns the render step, prepares the static ray scene, keeps material props reactive, requests a frame when asynchronous preparation completes, and disposes its resources on unmount.

## Minimal scene

```jsx
import {
  LayeredGlassComposer,
  LayeredGlassMaterial,
} from 'three-layered-glass/r3f';

function Scene() {
  return (
    <>
      <LayeredGlassComposer />

      <mesh>
        <icosahedronGeometry args={[1, 5]} />
        <LayeredGlassMaterial
          ior={1.5}
          roughness={0.04}
          attenuationColor="#c6e7ff"
        />
      </mesh>
    </>
  );
}
```

The composer can be self-closing because it discovers the complete R3F scene. Its position among scene siblings does not define which objects participate.

The primary composer props are:

| Prop | Default | Purpose |
| --- | ---: | --- |
| `enabled` | `true` | Enables layered rendering; disabled mode renders the normal scene |
| `quality` | `'medium'` | `low`, `medium`, or `high` |
| `adaptive` | `false` | Dynamically adjusts only transmission resolution |
| `onProgress` | — | Receives preparation progress from `0` to `1` |
| `onReady` | — | Receives the prepared core composer |
| `onError` | — | Receives preparation errors and the core composer |

`backend`, worker policy, render priority, custom targets, and shader limits are intentionally kept in the advanced entrypoint.

## Loading and errors

`useLayeredGlass()` reads preparation state when called below the provider:

```jsx
import {
  LayeredGlassComposer,
  useLayeredGlass,
} from 'three-layered-glass/r3f';

function Status() {
  const { status, progress, error, ready } = useLayeredGlass();
  return null;
}

function Scene() {
  return (
    <LayeredGlassComposer>
      <Status />
      <Product />
    </LayeredGlassComposer>
  );
}
```

The status is `preparing`, `ready`, or `error`. Inline callback functions are safe: changing only callback identity does not trigger another BVH build.

The integration calls R3F `invalidate()` after preparation or failure, so it also works with:

```jsx
<Canvas frameloop="demand">
```

## Adaptive quality

The short form targets a stable 30 FPS budget and varies only the expensive transmission buffer between conservative limits:

```jsx
<LayeredGlassComposer adaptive />
```

Tune it when necessary:

```jsx
<LayeredGlassComposer
  adaptive={{
    minScale: 0.45,
    maxScale: 0.75,
    targetFrameTime: 1000 / 30,
  }}
/>
```

This does not change Canvas DPR, opaque-scene resolution, or the high-resolution front-glass silhouette.

## Material component

`LayeredGlassMaterial` attaches to its parent mesh, applies prop changes with R3F, forwards a ref to the core material, and disposes the owned material by default:

```jsx
const materialRef = useRef();

<mesh>
  <sphereGeometry args={[1, 64, 32]} />
  <LayeredGlassMaterial
    ref={materialRef}
    roughness={frosted ? 0.7 : 0.05}
    attenuationColor={tint}
  />
</mesh>
```

Set `dispose={false}` only when ownership lives elsewhere and the same material remains in use after unmount.

The optional `LayeredGlass` component remains as a mesh convenience:

```jsx
import { LayeredGlass } from 'three-layered-glass/r3f';

<LayeredGlass materialProps={{ roughness: 0.08 }}>
  <boxGeometry />
</LayeredGlass>
```

Normal `<mesh>` plus `<LayeredGlassMaterial>` is preferred because it matches standard R3F composition and GLTF JSX output.

## Loaded GLB materials

Use the owned material hook when a loaded mesh cannot declare its material as JSX:

```jsx
import { useLayoutEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import { useLayeredGlassMaterial } from 'three-layered-glass/r3f';

function Product() {
  const { scene, nodes } = useGLTF('/product.glb');
  const glassMaterial = useLayeredGlassMaterial({
    ior: 1.5,
    roughness: 0.03,
    attenuationColor: '#d9f2ff',
  });

  useLayoutEffect(() => {
    const previousMaterial = nodes.Glass.material;
    nodes.Glass.material = glassMaterial;
    return () => {
      nodes.Glass.material = previousMaterial;
    };
  }, [nodes.Glass, glassMaterial]);

  return <primitive object={scene} />;
}
```

The composer detects the material assignment and prepares the updated scene. Large applications can use the manual synchronization controls from the advanced entrypoint.

## Explicit ray visibility

Helpers and overlays can be excluded through the advanced hook:

```jsx
import {
  useLayeredGlassRayVisibility,
} from 'three-layered-glass/r3f/advanced';

function Helper() {
  const ref = useRef();
  useLayeredGlassRayVisibility(ref, 'ignore');
  return (
    <mesh ref={ref}>
      <boxGeometry />
      <meshBasicMaterial wireframe />
    </mesh>
  );
}
```

This hook must be rendered below `<LayeredGlassComposer>` because it uses the composer context.

## Advanced composer props

Import the same component from the advanced subpath when an integration needs full control:

```jsx
import {
  LayeredGlassComposer,
  useLayeredGlassComposer,
} from 'three-layered-glass/r3f/advanced';
```

The advanced prop surface includes:

- scene and camera overrides;
- output targets, presentation, and tone mapping;
- backend and worker selection;
- render priority and foreground objects;
- scene synchronization policy;
- transmission and coverage resolution controls;
- spectral, traversal, media, and analytic-backend limits.

Use `useLayeredGlassComposer()` for imperative invalidation, memory diagnostics, or output textures.

## Existing EffectComposer

Register the pass through its dedicated subpath:

```jsx
import { LayeredGlassEffectPass } from 'three-layered-glass/r3f/postprocessing';

<LayeredGlassEffectPass
  composer={effectComposer}
  index={0}
/>
```

The external `EffectComposer` should own rendering. Set `renderPriority` only when this component must also call `effectComposer.render(delta)`.

## Legacy blockers

Opaque geometry is automatic. `LayeredGlassBlocker` and `useLayeredGlassBlocker` now live only in:

```js
import { LayeredGlassBlocker } from 'three-layered-glass/r3f/legacy';
```

Use a normal opaque mesh for new code.
