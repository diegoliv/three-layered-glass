export const volumeResolverVertexShader = /* glsl */ `
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function createVolumeResolverFragmentShader({
  maxVolumes = 12,
  maxTraversals = maxVolumes,
  entrySteps = 10,
  exitSteps = 12,
  opaqueSteps = 12,
} = {}) {
  return /* glsl */ `
    precision highp float;
    precision highp int;

    #define MAX_VOLUMES ${Math.max(1, Math.round(maxVolumes))}
    #define MAX_TRAVERSALS ${Math.max(1, Math.round(maxTraversals))}
    #define ENTRY_STEPS ${Math.max(2, Math.round(entrySteps))}
    #define EXIT_STEPS ${Math.max(2, Math.round(exitSteps))}
    #define OPAQUE_STEPS ${Math.max(2, Math.round(opaqueSteps))}
    #define EPSILON 0.0025
    #define SURFACE_EPSILON 0.0012
    #define FAR_DISTANCE 1e7

    uniform sampler2D uBaseColor;
    uniform sampler2D uBaseDepth;
    uniform vec2 uResolution;
    uniform mat4 uInverseProjection;
    uniform mat4 uCameraMatrixWorld;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uViewMatrix;
    uniform vec3 uCameraPosition;

    uniform mat4 uWorldToLocal[MAX_VOLUMES];
    uniform mat4 uLocalToWorld[MAX_VOLUMES];
    uniform vec4 uVolumeBounds[MAX_VOLUMES];
    uniform vec4 uVolumeOpticalA[MAX_VOLUMES];
    uniform vec4 uVolumeOpticalB[MAX_VOLUMES];
    uniform vec4 uVolumeMeta[MAX_VOLUMES];
    uniform int uVolumeCount;
    uniform int uLayered;
    uniform int uUseSpectral;
    uniform float uMaxDispersion;

    in vec2 vUv;
    out vec4 outColor;

    vec3 environmentColor(vec3 direction, float roughness) {
      vec3 d = normalize(direction);
      float vertical = d.y * 0.5 + 0.5;
      vec3 environment = mix(
        vec3(0.025, 0.03, 0.045),
        vec3(0.56, 0.64, 0.78),
        vertical
      );

      float stripLeft = pow(
        max(dot(d, normalize(vec3(-0.88, 0.12, 0.46))), 0.0),
        mix(96.0, 10.0, roughness)
      );
      float stripRight = pow(
        max(dot(d, normalize(vec3(0.84, 0.18, 0.51))), 0.0),
        mix(112.0, 12.0, roughness)
      );
      float stripTop = pow(
        max(dot(d, normalize(vec3(0.02, 0.94, 0.34))), 0.0),
        mix(78.0, 9.0, roughness)
      );
      float softBox = pow(
        max(dot(d, normalize(vec3(-0.22, 0.46, 0.86))), 0.0),
        mix(20.0, 5.0, roughness)
      );

      environment += vec3(1.0) * stripLeft * 2.15;
      environment += vec3(0.72, 0.88, 1.0) * stripRight * 1.55;
      environment += vec3(1.0, 0.96, 0.90) * stripTop * 1.05;
      environment += vec3(0.32, 0.42, 0.60) * softBox * 0.34;

      float luminance = dot(environment, vec3(0.2126, 0.7152, 0.0722));
      return mix(environment, vec3(luminance), roughness * 0.48);
    }

    vec3 reconstructRayDirection(vec2 uv) {
      vec2 ndc = uv * 2.0 - 1.0;
      vec4 viewPoint = uInverseProjection * vec4(ndc, 1.0, 1.0);
      viewPoint /= max(viewPoint.w, 1e-6);
      return normalize(
        (uCameraMatrixWorld * vec4(normalize(viewPoint.xyz), 0.0)).xyz
      );
    }

    vec3 projectWorld(vec3 worldPosition) {
      vec4 clip = uProjectionMatrix * uViewMatrix * vec4(worldPosition, 1.0);
      if (clip.w <= 1e-6) return vec3(-1.0, -1.0, 2.0);
      vec3 ndc = clip.xyz / clip.w;
      return vec3(ndc.xy * 0.5 + 0.5, ndc.z * 0.5 + 0.5);
    }

    float roundedBoxDistance(vec3 point, vec3 halfExtents, float radius) {
      vec3 q = abs(point) - halfExtents + vec3(radius);
      return length(max(q, vec3(0.0)))
        + min(max(q.x, max(q.y, q.z)), 0.0)
        - radius;
    }

    vec3 roundedBoxNormal(vec3 point, vec3 halfExtents, float radius) {
      vec3 inner = max(halfExtents - vec3(radius), vec3(0.0001));
      vec3 q = abs(point) - inner;
      vec3 outside = max(q, vec3(0.0));
      float outsideLength = length(outside);

      if (outsideLength > 1e-5) {
        return normalize(sign(point) * outside);
      }

      vec3 normalizedPoint = point / max(inner, vec3(1e-5));
      vec3 absolutePoint = abs(normalizedPoint);
      if (absolutePoint.x >= absolutePoint.y && absolutePoint.x >= absolutePoint.z) {
        return vec3(sign(point.x), 0.0, 0.0);
      }
      if (absolutePoint.y >= absolutePoint.z) {
        return vec3(0.0, sign(point.y), 0.0);
      }
      return vec3(0.0, 0.0, sign(point.z));
    }

    bool boundingBoxInterval(
      vec3 rayOrigin,
      vec3 rayDirection,
      vec3 halfExtents,
      out float nearDistance,
      out float farDistance
    ) {
      vec3 safeDirection = rayDirection;
      safeDirection.x = abs(safeDirection.x) < 1e-6
        ? (safeDirection.x < 0.0 ? -1e-6 : 1e-6)
        : safeDirection.x;
      safeDirection.y = abs(safeDirection.y) < 1e-6
        ? (safeDirection.y < 0.0 ? -1e-6 : 1e-6)
        : safeDirection.y;
      safeDirection.z = abs(safeDirection.z) < 1e-6
        ? (safeDirection.z < 0.0 ? -1e-6 : 1e-6)
        : safeDirection.z;

      vec3 firstDistances = (-halfExtents - rayOrigin) / safeDirection;
      vec3 secondDistances = (halfExtents - rayOrigin) / safeDirection;
      vec3 minimumDistances = min(firstDistances, secondDistances);
      vec3 maximumDistances = max(firstDistances, secondDistances);

      nearDistance = max(
        max(minimumDistances.x, minimumDistances.y),
        minimumDistances.z
      );
      farDistance = min(
        min(maximumDistances.x, maximumDistances.y),
        maximumDistances.z
      );
      return farDistance >= max(nearDistance, 0.0);
    }

    bool intersectRoundedBoxLocal(
      vec3 localOrigin,
      vec3 localDirection,
      vec3 halfExtents,
      float radius,
      out float entryDistance,
      out vec3 entryNormal
    ) {
      float nearBound;
      float farBound;
      if (!boundingBoxInterval(
        localOrigin,
        localDirection,
        halfExtents,
        nearBound,
        farBound
      )) return false;

      float distanceAlongRay = max(nearBound, 0.0);
      bool found = false;
      vec3 hitPoint = vec3(0.0);

      for (int step = 0; step < ENTRY_STEPS; step++) {
        if (distanceAlongRay > farBound + EPSILON) break;
        vec3 point = localOrigin + localDirection * distanceAlongRay;
        float surfaceDistance = roundedBoxDistance(point, halfExtents, radius);

        if (surfaceDistance <= SURFACE_EPSILON) {
          found = true;
          hitPoint = point;
          break;
        }

        distanceAlongRay += max(surfaceDistance, 0.003);
      }

      if (!found || distanceAlongRay <= EPSILON) return false;
      entryDistance = distanceAlongRay;
      entryNormal = roundedBoxNormal(hitPoint, halfExtents, radius);
      return true;
    }

    bool intersectSphereLocal(
      vec3 localOrigin,
      vec3 localDirection,
      float radius,
      out float entryDistance,
      out vec3 entryNormal
    ) {
      float b = dot(localOrigin, localDirection);
      float c = dot(localOrigin, localOrigin) - radius * radius;
      float discriminant = b * b - c;
      if (discriminant < 0.0) return false;

      float root = sqrt(discriminant);
      float nearDistance = -b - root;
      float farDistance = -b + root;
      float distanceAlongRay = nearDistance > EPSILON ? nearDistance : farDistance;
      if (distanceAlongRay <= EPSILON) return false;

      vec3 hitPoint = localOrigin + localDirection * distanceAlongRay;
      entryDistance = distanceAlongRay;
      entryNormal = normalize(hitPoint);
      return true;
    }

    bool intersectVolume(
      int volumeIndex,
      vec3 worldOrigin,
      vec3 worldDirection,
      out float entryDistance,
      out vec3 entryPosition,
      out vec3 entryNormal,
      out float edgeFactor
    ) {
      mat4 worldToLocal = uWorldToLocal[volumeIndex];
      mat4 localToWorld = uLocalToWorld[volumeIndex];
      vec4 bounds = uVolumeBounds[volumeIndex];
      vec4 meta = uVolumeMeta[volumeIndex];

      vec3 localOrigin = (worldToLocal * vec4(worldOrigin, 1.0)).xyz;
      vec3 localDirection = normalize(
        (worldToLocal * vec4(worldDirection, 0.0)).xyz
      );

      float localEntryDistance;
      vec3 localEntryNormal;
      bool hit;

      if (meta.y > 0.5) {
        hit = intersectSphereLocal(
          localOrigin,
          localDirection,
          bounds.x,
          localEntryDistance,
          localEntryNormal
        );
      } else {
        hit = intersectRoundedBoxLocal(
          localOrigin,
          localDirection,
          bounds.xyz,
          bounds.w,
          localEntryDistance,
          localEntryNormal
        );
      }

      if (!hit) return false;

      vec3 localEntry = localOrigin + localDirection * localEntryDistance;
      entryPosition = (localToWorld * vec4(localEntry, 1.0)).xyz;
      entryNormal = normalize(transpose(mat3(worldToLocal)) * localEntryNormal);
      entryDistance = distance(worldOrigin, entryPosition);

      if (meta.y > 0.5) {
        edgeFactor = 0.0;
      } else {
        vec2 edgeDistance = bounds.xy - abs(localEntry.xy);
        float minimumEdgeDistance = min(edgeDistance.x, edgeDistance.y);
        edgeFactor = 1.0 - smoothstep(0.02, 0.34, minimumEdgeDistance);
      }

      return true;
    }

    bool findNearestVolume(
      vec3 worldOrigin,
      vec3 worldDirection,
      int skippedVolume,
      out int volumeIndex,
      out float entryDistance,
      out vec3 entryPosition,
      out vec3 entryNormal,
      out float edgeFactor
    ) {
      bool found = false;
      float bestDistance = FAR_DISTANCE;
      int bestIndex = -1;
      vec3 bestPosition = vec3(0.0);
      vec3 bestNormal = vec3(0.0);
      float bestEdgeFactor = 0.0;

      for (int index = 0; index < MAX_VOLUMES; index++) {
        if (index >= uVolumeCount) break;
        if (index == skippedVolume) continue;

        float candidateDistance;
        vec3 candidatePosition;
        vec3 candidateNormal;
        float candidateEdgeFactor;

        if (
          intersectVolume(
            index,
            worldOrigin,
            worldDirection,
            candidateDistance,
            candidatePosition,
            candidateNormal,
            candidateEdgeFactor
          ) && candidateDistance < bestDistance
        ) {
          found = true;
          bestDistance = candidateDistance;
          bestIndex = index;
          bestPosition = candidatePosition;
          bestNormal = candidateNormal;
          bestEdgeFactor = candidateEdgeFactor;
        }
      }

      volumeIndex = bestIndex;
      entryDistance = bestDistance;
      entryPosition = bestPosition;
      entryNormal = bestNormal;
      edgeFactor = bestEdgeFactor;
      return found;
    }

    bool findVolumeExit(
      int volumeIndex,
      vec3 entryPosition,
      vec3 insideDirection,
      out vec3 exitPosition,
      out vec3 exitNormal,
      out float opticalDistance
    ) {
      mat4 worldToLocal = uWorldToLocal[volumeIndex];
      mat4 localToWorld = uLocalToWorld[volumeIndex];
      vec4 bounds = uVolumeBounds[volumeIndex];
      vec4 meta = uVolumeMeta[volumeIndex];

      vec3 worldInsideOrigin = entryPosition + insideDirection * (EPSILON * 2.0);
      vec3 localOrigin = (worldToLocal * vec4(worldInsideOrigin, 1.0)).xyz;
      vec3 localDirection = normalize(
        (worldToLocal * vec4(insideDirection, 0.0)).xyz
      );

      vec3 localExit;

      if (meta.y > 0.5) {
        float b = dot(localOrigin, localDirection);
        float c = dot(localOrigin, localOrigin) - bounds.x * bounds.x;
        float discriminant = b * b - c;
        if (discriminant < 0.0) return false;
        float distanceAlongRay = -b + sqrt(discriminant);
        if (distanceAlongRay <= EPSILON) return false;
        localExit = localOrigin + localDirection * distanceAlongRay;
      } else {
        float nearBound;
        float farBound;
        if (!boundingBoxInterval(
          localOrigin,
          localDirection,
          bounds.xyz,
          nearBound,
          farBound
        )) return false;

        float distanceAlongRay = 0.0;
        bool found = false;
        localExit = vec3(0.0);

        for (int step = 0; step < EXIT_STEPS; step++) {
          if (distanceAlongRay > farBound + EPSILON) break;
          vec3 point = localOrigin + localDirection * distanceAlongRay;
          float signedDistance = roundedBoxDistance(
            point,
            bounds.xyz,
            bounds.w
          );

          if (step > 0 && signedDistance >= -SURFACE_EPSILON) {
            found = true;
            localExit = point;
            break;
          }

          distanceAlongRay += max(abs(signedDistance), 0.0035);
        }

        if (!found) localExit = localOrigin + localDirection * farBound;
      }

      exitPosition = (localToWorld * vec4(localExit, 1.0)).xyz;
      vec3 localExitNormal = meta.y > 0.5
        ? normalize(localExit)
        : roundedBoxNormal(localExit, bounds.xyz, bounds.w);
      exitNormal = normalize(transpose(mat3(worldToLocal)) * localExitNormal);
      opticalDistance = distance(entryPosition, exitPosition);
      return opticalDistance > EPSILON;
    }

    float fresnelSchlick(float cosine, float etaIncident, float etaTransmitted) {
      float f0 = (etaIncident - etaTransmitted) / (etaIncident + etaTransmitted);
      f0 *= f0;
      return f0 + (1.0 - f0)
        * pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
    }

    bool opaqueBeforePosition(vec3 worldPosition) {
      vec3 projected = projectWorld(worldPosition);
      if (
        projected.x <= 0.001 || projected.x >= 0.999 ||
        projected.y <= 0.001 || projected.y >= 0.999
      ) return false;

      float opaqueDepth = texture(uBaseDepth, projected.xy).r;
      return opaqueDepth < projected.z - 0.00015;
    }

    bool findOpaqueScreenHit(
      vec3 rayOrigin,
      vec3 rayDirection,
      float reach,
      out vec2 hitUv
    ) {
      for (int step = 1; step <= OPAQUE_STEPS; step++) {
        float distanceAlongRay = reach * float(step) / float(OPAQUE_STEPS);
        vec3 projected = projectWorld(
          rayOrigin + rayDirection * distanceAlongRay
        );

        if (
          projected.x <= 0.002 || projected.x >= 0.998 ||
          projected.y <= 0.002 || projected.y >= 0.998 ||
          projected.z <= 0.0 || projected.z >= 1.0
        ) continue;

        float depth = texture(uBaseDepth, projected.xy).r;
        if (depth < 0.999999 && projected.z >= depth - 0.00065) {
          hitUv = projected.xy;
          return true;
        }
      }

      return false;
    }

    vec3 sampleRoughBase(vec2 uv, float radius) {
      vec2 texel = 1.0 / uResolution;
      vec2 spread = texel * radius;
      vec3 color = texture(uBaseColor, uv).rgb * 0.20;
      color += texture(uBaseColor, uv + vec2( 0.95,  0.10) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2(-0.82,  0.38) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2( 0.45, -0.88) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2(-0.24, -0.96) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2( 0.58,  0.74) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2(-0.92, -0.24) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2( 0.08,  0.98) * spread).rgb * 0.10;
      color += texture(uBaseColor, uv + vec2(-0.56,  0.78) * spread).rgb * 0.10;
      return color;
    }

    mat3 tangentFrame(vec3 normal) {
      vec3 helper = abs(normal.y) < 0.92
        ? vec3(0.0, 1.0, 0.0)
        : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(helper, normal));
      vec3 bitangent = normalize(cross(normal, tangent));
      return mat3(tangent, bitangent, normal);
    }

    vec3 perturbNormal(
      vec3 normal,
      vec2 sampleOffset,
      vec3 worldPosition,
      int volumeIndex,
      int traversal,
      float roughness
    ) {
      float phase = dot(worldPosition, vec3(1.71, 2.43, 3.17))
        + float(volumeIndex) * 1.91
        + float(traversal) * 2.37;
      float angle = sin(phase) * 3.14159265;
      mat2 rotation = mat2(
        cos(angle), -sin(angle),
        sin(angle),  cos(angle)
      );
      vec2 rotatedOffset = rotation * sampleOffset;
      float spread = roughness * roughness * 0.92;
      mat3 frame = tangentFrame(normal);
      return normalize(frame * vec3(rotatedOffset * spread, 1.0));
    }

    void traceGlass(
      vec2 screenUv,
      float spectralOffset,
      vec2 roughSample,
      out vec3 radiance,
      out bool touchedGlass
    ) {
      vec3 rayOrigin = uCameraPosition;
      vec3 rayDirection = reconstructRayDirection(screenUv);
      vec3 throughput = vec3(1.0);
      vec3 reflectedRadiance = vec3(0.0);
      vec3 layerRadiance = vec3(0.0);
      vec3 bodyTintRadiance = vec3(0.0);
      float totalOpticalDistance = 0.0;
      float roughnessIntegral = 0.0;
      float terminalReach = 2.0;
      bool stoppedAtBlocker = false;
      vec2 blockerUv = screenUv;
      int lastVolume = -1;
      touchedGlass = false;

      for (int traversal = 0; traversal < MAX_TRAVERSALS; traversal++) {
        int volumeIndex;
        float entryDistance;
        vec3 entryPosition;
        vec3 entryNormal;
        float edgeFactor;

        bool foundVolume = findNearestVolume(
          rayOrigin,
          rayDirection,
          lastVolume,
          volumeIndex,
          entryDistance,
          entryPosition,
          entryNormal,
          edgeFactor
        );

        if (!foundVolume) break;

        vec4 meta = uVolumeMeta[volumeIndex];
        if (meta.x < 0.5) {
          vec3 projectedBlocker = projectWorld(entryPosition);
          stoppedAtBlocker = true;
          blockerUv = clamp(projectedBlocker.xy, vec2(0.002), vec2(0.998));
          break;
        }

        vec4 opticalA = uVolumeOpticalA[volumeIndex];
        vec4 opticalB = uVolumeOpticalB[volumeIndex];
        float ior = max(1.001, opticalA.x + spectralOffset * opticalB.w * 1.85);
        float roughness = clamp(opticalA.y, 0.0, 1.0);
        float attenuationDistance = max(opticalA.z, 0.001);
        float reflectionStrength = opticalA.w;
        vec3 attenuationColor = max(opticalB.rgb, vec3(0.001));
        terminalReach = max(meta.z, 0.01);

        touchedGlass = true;
        if (dot(rayDirection, entryNormal) > 0.0) entryNormal = -entryNormal;

        vec3 microEntryNormal = perturbNormal(
          entryNormal,
          roughSample,
          entryPosition,
          volumeIndex,
          traversal,
          roughness
        );
        if (dot(rayDirection, microEntryNormal) > 0.0) {
          microEntryNormal = -microEntryNormal;
        }

        float entryCosine = clamp(
          -dot(rayDirection, microEntryNormal),
          0.0,
          1.0
        );
        float entryFresnel = fresnelSchlick(entryCosine, 1.0, ior);
        vec3 reflectedDirection = reflect(rayDirection, microEntryNormal);
        reflectedRadiance += throughput
          * entryFresnel
          * environmentColor(reflectedDirection, roughness)
          * reflectionStrength;

        vec3 insideDirection = refract(
          rayDirection,
          microEntryNormal,
          1.0 / ior
        );
        if (dot(insideDirection, insideDirection) < 1e-7) {
          reflectedRadiance += throughput
            * environmentColor(reflectedDirection, roughness);
          throughput = vec3(0.0);
          break;
        }
        insideDirection = normalize(insideDirection);

        vec3 exitPosition;
        vec3 exitNormal;
        float opticalDistance;
        if (!findVolumeExit(
          volumeIndex,
          entryPosition,
          insideDirection,
          exitPosition,
          exitNormal,
          opticalDistance
        )) break;

        vec3 microExitNormal = perturbNormal(
          -exitNormal,
          -roughSample * 0.72,
          exitPosition,
          volumeIndex,
          traversal + 1,
          roughness
        );
        if (dot(insideDirection, microExitNormal) > 0.0) {
          microExitNormal = -microExitNormal;
        }

        vec3 outsideDirection = refract(
          insideDirection,
          microExitNormal,
          ior
        );
        if (dot(outsideDirection, outsideDirection) < 1e-7) {
          reflectedRadiance += throughput
            * environmentColor(
              reflect(insideDirection, microExitNormal),
              roughness
            );
          throughput = vec3(0.0);
          break;
        }
        outsideDirection = normalize(outsideDirection);

        float exitCosine = clamp(
          -dot(insideDirection, microExitNormal),
          0.0,
          1.0
        );
        float exitFresnel = fresnelSchlick(exitCosine, ior, 1.0);
        vec3 absorption = pow(
          attenuationColor,
          vec3(opticalDistance / attenuationDistance)
        );

        float transmissionWeight = (1.0 - entryFresnel)
          * (1.0 - exitFresnel);
        float roughScatter = roughness * roughness;
        layerRadiance += throughput
          * attenuationColor
          * (edgeFactor * 0.035 + roughScatter * 0.055)
          * transmissionWeight
          * meta.w;

        bodyTintRadiance += throughput
          * attenuationColor
          * (0.012 + opticalDistance * 0.0025)
          * meta.w;

        throughput *= transmissionWeight * absorption;
        totalOpticalDistance += opticalDistance;
        roughnessIntegral += roughScatter * (1.0 + opticalDistance);
        rayOrigin = exitPosition + outsideDirection * EPSILON;
        rayDirection = outsideDirection;
        lastVolume = volumeIndex;

        if (uLayered == 0) break;
      }

      if (!touchedGlass) {
        radiance = texture(uBaseColor, screenUv).rgb;
        return;
      }

      vec2 terminalUv;
      if (stoppedAtBlocker) {
        terminalUv = blockerUv;
      } else if (!findOpaqueScreenHit(
        rayOrigin,
        rayDirection,
        terminalReach,
        terminalUv
      )) {
        vec3 terminalProjection = projectWorld(
          rayOrigin + rayDirection * terminalReach
        );
        terminalUv = clamp(terminalProjection.xy, vec2(0.003), vec2(0.997));
      }

      float blurRadius = roughnessIntegral
        * (48.0 + totalOpticalDistance * 18.0);
      vec3 transmitted = sampleRoughBase(terminalUv, blurRadius);
      radiance = reflectedRadiance
        + layerRadiance
        + bodyTintRadiance
        + transmitted * throughput;
    }

    void main() {
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      vec3 baseColor = texture(uBaseColor, screenUv).rgb;
      vec3 primaryRay = reconstructRayDirection(screenUv);

      int firstVolume;
      float firstDistance;
      vec3 firstPosition;
      vec3 firstNormal;
      float firstEdgeFactor;
      bool hasVolume = findNearestVolume(
        uCameraPosition,
        primaryRay,
        -1,
        firstVolume,
        firstDistance,
        firstPosition,
        firstNormal,
        firstEdgeFactor
      );

      if (
        !hasVolume ||
        uVolumeMeta[firstVolume].x < 0.5 ||
        opaqueBeforePosition(firstPosition)
      ) {
        outColor = vec4(baseColor, 1.0);
        return;
      }

      vec3 redRadiance;
      vec3 greenRadiance;
      vec3 blueRadiance;
      bool redTouched;
      bool greenTouched;
      bool blueTouched;

      if (uUseSpectral == 0) {
        traceGlass(
          screenUv,
          0.0,
          vec2(0.0),
          greenRadiance,
          greenTouched
        );
        redRadiance = greenRadiance;
        blueRadiance = greenRadiance;
      } else {
        traceGlass(
          screenUv,
          -1.0,
          vec2(-0.72, 0.36),
          redRadiance,
          redTouched
        );
        traceGlass(
          screenUv,
          0.0,
          vec2(0.18, -0.78),
          greenRadiance,
          greenTouched
        );
        traceGlass(
          screenUv,
          1.0,
          vec2(0.66, 0.42),
          blueRadiance,
          blueTouched
        );
      }

      vec3 averagedRadiance = (
        redRadiance + greenRadiance + blueRadiance
      ) / 3.0;
      vec3 spectralRadiance = vec3(
        redRadiance.r,
        greenRadiance.g,
        blueRadiance.b
      );
      float spectralMix = smoothstep(0.0005, 0.012, uMaxDispersion);
      vec3 finalColor = mix(
        averagedRadiance,
        spectralRadiance,
        spectralMix
      );

      outColor = vec4(finalColor, 1.0);
    }
  `;
}
