export function getOrbitDistanceLimits(distance, isMobile) {
  const safeDistance = Math.max(0.1, Number(distance) || 0.1);
  const minimumDistance = isMobile ? 1.8 : 3.2;
  const minimumDistanceFactor = isMobile ? 0.26 : 0.42;

  return {
    minDistance: Math.max(
      minimumDistance,
      safeDistance * minimumDistanceFactor,
    ),
    maxDistance: safeDistance * (isMobile ? 3 : 2.5),
  };
}
