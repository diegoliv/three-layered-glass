# Changelog

## 1.0.0 - 2026-07-27

### Simplified public API

- Reduced the primary Three.js entrypoint to `LayeredGlassComposer`, `LayeredGlassMaterial`, and `supportsLayeredGlass`.
- Added dedicated `/advanced`, `/postprocessing`, and `/legacy` subpaths.
- Reduced the primary R3F entrypoint to the common declarative material/composer path and moved integration controls to matching subpaths.
- Preserved the 0.2/0.3 implementations behind explicit legacy imports.

### React Three Fiber lifecycle

- Added a self-closing composer setup as the recommended scene integration.
- Added `useLayeredGlass()` preparation state with `preparing`, `ready`, and `error` statuses.
- Added `onError` and the `adaptive` quality prop.
- Invalidated render-on-demand canvases after asynchronous preparation or failure.
- Prevented callback identity changes from rebuilding the static BVH.
- Expanded material typing with a safe standard R3F shader-material prop surface.
- Added official React Three Test Renderer coverage for exports, reactive materials, disposal, status, and callback stability.

### Documentation and packaging

- Rewrote the README around minimal R3F and Three.js quick starts.
- Added focused Three.js API, R3F, performance, and 1.0 migration guides.
- Fixed release checks on early Node 20 versions by replacing `import.meta.dirname`.
- Added package-export validation for every 1.0 subpath.

### Rendering quality and performance

- Split the BVH pipeline into a high-resolution raster surface/coverage pass and a separately scalable transmission pass, preserving glass silhouettes and primary reflections at lower ray resolutions.
- Added edge-aware transmission reconstruction, single-hit reuse across spectral paths, and roughness-dependent base sampling.
- Added runtime `setResolutionScale()`, `setCoverageScale()`, and `setCoverageSamples()` controls across the core composer, pass, and React Three Fiber integrations.
- Added `LayeredGlassAdaptiveQuality` for frame-time-driven transmission scaling without BVH rebuilds.
- Added optional validity-aware transmission FXAA for low-resolution internal contours, with runtime controls across core, pass, and React Three Fiber integrations.
- Rate-limited automatic scene signature checks and removed redundant fullscreen clears.
- Updated the mobile demo with an adaptive ray budget, reduced render-target bandwidth, static shadow updates, and a lower-cost UI compositing path.

## 0.4.0

### Static triangle-BVH backend

- Added a static world-space triangle ray scene for arbitrary `BufferGeometry` and GLB meshes.
- Added automatic discovery of visible opaque meshes; blocker registration is no longer required by the BVH backend.
- Added asynchronous BVH generation through `three-mesh-bvh/worker`, with safe main-thread fallback.
- Added real triangle entry/exit traversal for closed glass volumes and a `thin` mode for single-surface glass.
- Added a glass coverage pass so BVH traversal exits immediately outside rasterized glass silhouettes.
- Added a full-resolution final composite so reduced-resolution quality tiers affect glass processing without downscaling the ordinary opaque scene.
- Added low, medium, and high quality presets controlling resolution, spectral paths, rough paths, traversal depth, and BVH leaf size.
- Added material-only metadata refreshes that avoid rebuilding the BVH when optical properties change.
- Added automatic scene signatures for static transform, topology, classification, and optical material changes.
- Added memory reporting for triangle, geometry, BVH, and estimated GPU storage.

### Scene integration

- Opaque meshes keep their ordinary Three.js materials and raster path while also participating in world-space refracted intersections.
- Mixed material arrays and geometry groups are classified per triangle.
- Added `setRayVisibility(object, 'auto' | 'opaque' | 'glass' | 'ignore')` as an opt-out / override workflow.
- Added `useLayeredGlassRayVisibility()` for React Three Fiber.
- Deprecated blocker-first APIs in documentation while retaining compatibility aliases.

### Backends and compatibility

- Added `backend: 'auto' | 'bvh' | 'analytic'`.
- Preserved the 0.3 analytic backend as `AnalyticLayeredGlassComposer`.
- Preserved the 0.2 pipeline as `LegacyLayeredGlassComposer` and `LegacyLayeredGlassPass`.
- Analytic shape properties remain available only as optional fast-path proxies.

### Current scope

- Version 0.4 targets static regular meshes. Rigid transform changes require BVH preparation again.
- Instanced, batched, continuously skinned, and live morph-deformed geometry are excluded from the static ray scene.
- Opaque off-screen shading uses a material-color and environment fallback rather than a full duplicate Three.js material evaluator.

## 0.3.0

### New analytic renderer

- Replaced the default object-sorted ping-pong compositor with a single per-pixel analytic volume traversal pass.
- Glass volumes no longer jump between global render-order positions as the camera rotates.
- Registered opaque blockers participate in the same nearest-hit search as glass volumes, fixing opaque/glass overlap order.
- Added exact entry/exit traversal for box, rounded-box, sphere, and uniformly transformed ellipsoid-like volumes.
- Added per-volume optical parameters instead of one shared glass configuration.
- Added spectral red, green, and blue paths so dispersion accumulates through every glass layer.
- Added deterministic microfacet-normal perturbation at every interface so rough transmission affects glass behind glass.
- Added screen-space opaque fallback for unregistered opaque scene geometry.
- Added unsigned-byte color-target fallback when floating-point color targets are unavailable.

### API

- Added `LayeredGlassComposer.addBlocker()` and aliases `addOpaque()` / `removeOpaque()`.
- Added `setLayeredGlassBlocker()`, `clearLayeredGlassBlocker()`, and `isLayeredGlassBlocker()`.
- Added analytic shape options to `LayeredGlassMaterial`: `shape`, `radius`, `halfExtents`, and `center`.
- Added `bodyTintStrength` to `LayeredGlassMaterial`.
- Added composer controls: `maxVolumes`, `maxTraversals`, `entrySteps`, `exitSteps`, and `opaqueSteps`.
- Added R3F `<LayeredGlassBlocker>` and `useLayeredGlassBlocker()`.
- `supportsLayeredGlass()` now requires WebGL2, but no longer requires `EXT_color_buffer_float`.

### Compatibility

- The 0.2 implementation remains available as `LegacyLayeredGlassComposer` and `LegacyLayeredGlassPass` for arbitrary closed meshes.
- Fixed the legacy material camera-uniform bug that caused fragment shader compilation failures on some browsers.

### Breaking behavior

- `LayeredGlassComposer` now supports analytic shapes rather than arbitrary mesh silhouettes.
- Arbitrary closed meshes must use `LegacyLayeredGlassComposer` until a BVH-backed traversal mode is implemented.
- Opaque objects that must interleave exactly with refracted paths need to be registered as blockers.
