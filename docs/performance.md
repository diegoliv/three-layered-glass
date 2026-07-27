# Performance and quality

Layered refraction is fill-rate and traversal intensive. The default `medium` preset is designed as the starting point; measure the complete scene before overriding individual controls.

## Quality presets

| Tier | Transmission resolution | Spectral paths | Rough filter rings | Max traversals | BVH leaf size |
| --- | ---: | ---: | ---: | ---: | ---: |
| `low` | `0.5×` | 1 | 1 | 4 | 4 |
| `medium` | `0.75×` | 3 | 1 | 8 | 2 |
| `high` | `1×` | 3 | 2 | 12 | 1 |

The opaque scene and primary glass contour are not rendered at the transmission resolution. A full-resolution base pass and a separate glass-surface coverage pass preserve the silhouette while the expensive BVH resolver runs at `resolutionScale`.

Start with:

```js
const glass = new LayeredGlassComposer(renderer, {
  quality: 'medium',
});
```

or in R3F:

```jsx
<LayeredGlassComposer quality="medium" />
```

## Adaptive R3F quality

```jsx
<LayeredGlassComposer adaptive />
```

Adaptive quality observes frame time and changes only `resolutionScale`. It does not rebuild the BVH, change Canvas DPR, or resize the opaque scene.

The object form accepts the same values as `LayeredGlassAdaptiveQuality`:

```jsx
<LayeredGlassComposer
  adaptive={{
    minScale: 0.45,
    maxScale: 0.7,
    initialScale: 0.6,
    targetFrameTime: 1000 / 30,
    adjustmentInterval: 1200,
  }}
/>
```

Avoid supplying both `adaptive` and a continuously controlled `resolutionScale`; they would compete for the same setting.

## Runtime controls

```js
glass.setResolutionScale(0.6);
glass.setCoverageScale(1);
glass.setCoverageSamples(0);
glass.setTransmissionAntialias(true);
```

### resolutionScale

Range: `0.1..1`.

This is the most effective glass-specific performance control. It changes the BVH transmission target, optional transmission FXAA target, and rough-blur chain. It does not downscale the normal scene.

### coverageScale

Range: `0.25..1`; default `1`.

Coverage controls rasterized glass silhouettes and the nearest front-surface reflection. Keep it at `1` unless profiling shows the surface pass itself is expensive.

### coverageSamples

Default: `0`.

This enables MSAA for the coverage target. Try `2` before `4`. It consumes additional memory and bandwidth and does not antialias internal refracted contours.

### transmissionAntialias

Default: `false`.

This enables a validity-aware FXAA pass at transmission resolution. It is useful when a reduced `resolutionScale` produces visible internal stair-stepping, especially on mobile.

## Canvas DPR and render-on-demand

Canvas DPR affects every pass. Cap it separately from transmission resolution when mobile fill rate is limited:

```jsx
<Canvas dpr={[1, 1.5]}>
```

For scenes that become idle, R3F render-on-demand can reduce battery and fan usage:

```jsx
<Canvas frameloop="demand">
```

The layered-glass integration invalidates the Canvas when asynchronous preparation completes. Controls or other imperative animation systems must still invalidate frames according to normal R3F rules.

## Scene synchronization

Automatic synchronization checks geometry and optical signatures no more than once per `sceneSyncInterval` (`250` ms by default). It is convenient for external scene mutations but has a CPU cost proportional to scene complexity.

Use manual mode for a known-static scene or an editor that already knows what changed:

```js
const glass = new LayeredGlassComposer(renderer, {
  sceneSync: 'manual',
});
```

Then distinguish the cheap and expensive update paths:

```js
glass.invalidateMaterial(mesh); // refresh optical metadata

glass.invalidateGeometry(mesh); // static BVH rebuild required
await glass.prepare(scene);
```

Do not call `prepare()` for every React render or every frame. It reconstructs the static ray scene.

## Geometry budget

The BVH contains expanded world-space triangles from glass and participating opaque meshes. Reduce unseen or irrelevant geometry by:

- excluding helpers with `setRayVisibility(object, 'ignore')`;
- using lower-complexity opaque proxy geometry only when the visual difference is acceptable;
- avoiding duplicate hidden meshes in the scene;
- using `sceneSync: 'manual'` after a known-final build.

Inspect the current cost:

```js
console.table(glass.getMemoryReport());
```

The report includes glass and opaque triangle counts, flattened geometry bytes, BVH bytes, estimated GPU bytes, and total bytes.

## Renderer statistics

The composer performs multiple renderer calls per output frame. By default it manages `renderer.info.autoReset` so the complete layered frame remains measurable. If another renderer pipeline owns statistics, use the advanced `manageRendererInfo` option and reset `renderer.info` once after the full frame.

## Practical order of operations

1. Start with `quality="medium"`, `coverageScale=1`, and `coverageSamples=0`.
2. Cap Canvas DPR for the target devices.
3. Enable `adaptive` in R3F or lower `resolutionScale` in Three.js.
4. Enable `transmissionAntialias` only when reduced-resolution internal edges need it.
5. Profile before increasing coverage MSAA or choosing `high` quality.
6. Switch static production scenes to manual synchronization when the application can invalidate explicitly.
