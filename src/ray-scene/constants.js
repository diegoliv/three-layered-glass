export const RAY_SURFACE_KIND = Object.freeze({
  OPAQUE: 0,
  GLASS: 1,
});

export const RAY_VISIBILITY = Object.freeze({
  AUTO: 'auto',
  OPAQUE: 'opaque',
  GLASS: 'glass',
  IGNORE: 'ignore',
});

export const GLASS_MODE = Object.freeze({
  VOLUME: 'volume',
  THIN: 'thin',
});

export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    maxTraversals: 4,
    spectral: false,
    roughSamples: 1,
    resolutionScale: 0.5,
    bvhLeafSize: 4,
  }),
  medium: Object.freeze({
    maxTraversals: 8,
    spectral: true,
    roughSamples: 1,
    resolutionScale: 0.75,
    bvhLeafSize: 2,
  }),
  high: Object.freeze({
    maxTraversals: 12,
    spectral: true,
    roughSamples: 2,
    resolutionScale: 1,
    bvhLeafSize: 1,
  }),
});
