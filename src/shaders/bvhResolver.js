import { BVHShaderGLSL } from 'three-mesh-bvh';

export const bvhResolverVertexShader = /* glsl */`
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export function createBVHResolverFragmentShader({
  maxTraversals = 8,
  maxMedia = 8,
  spectral = true,
  roughSamples = 1,
} = {}) {
  const resolvedRoughSamples = Math.min(3, Math.max(1, Math.floor(roughSamples)));

  return /* glsl */`
    precision highp float;
    precision highp int;
    precision highp usampler2D;

    #define MAX_TRAVERSALS ${Math.max(1, Math.floor(maxTraversals))}
    #define MAX_MEDIA ${Math.max(2, Math.floor(maxMedia))}
    #define ROUGH_SAMPLES ${resolvedRoughSamples}
    #define USE_SPECTRAL ${spectral ? 1 : 0}
    #define RAY_EPSILON 0.0015

    ${BVHShaderGLSL.common_functions}
    ${BVHShaderGLSL.bvh_struct_definitions}
    ${BVHShaderGLSL.bvh_ray_functions}

    uniform sampler2D uBaseColor;
    uniform sampler2D uBaseDepth;
    uniform sampler2D uCoverage;
    uniform vec2 uResolution;
    uniform mat4 uInverseProjection;
    uniform mat4 uCameraMatrixWorld;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uViewMatrix;
    uniform vec3 uCameraPosition;
    uniform BVH uBVH;
    uniform sampler2D uNormalAttribute;
    uniform sampler2D uMetaAttribute;
    uniform sampler2D uOpticalAAttribute;
    uniform sampler2D uOpticalBAttribute;
    uniform sampler2D uOpticalCAttribute;
    uniform sampler2D uBaseColorAttribute;
    uniform int uLayered;

    in vec2 vUv;
    out vec4 outColor;

    struct SurfaceData {
      float kind;
      int volumeId;
      int mode;
      int sideMode;
      float ior;
      float roughness;
      float attenuationDistance;
      float reflectionStrength;
      vec3 attenuationColor;
      float dispersion;
      float refractionReach;
      float bodyTintStrength;
      float thinThickness;
      vec3 baseColor;
      float baseRoughness;
      vec3 smoothNormal;
    };

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
      environment += vec3(1.0) * stripLeft * 2.15;
      environment += vec3(0.72, 0.88, 1.0) * stripRight * 1.55;
      environment += vec3(1.0, 0.96, 0.90) * stripTop * 1.05;
      float luminance = dot(environment, vec3(0.2126, 0.7152, 0.0722));
      return mix(environment, vec3(luminance), roughness * 0.48);
    }

    vec3 projectWorld(vec3 worldPosition) {
      vec4 clip = uProjectionMatrix * uViewMatrix * vec4(worldPosition, 1.0);
      if (clip.w <= 1e-6) return vec3(-1.0, -1.0, 2.0);
      vec3 ndc = clip.xyz / clip.w;
      return vec3(ndc.xy * 0.5 + 0.5, ndc.z * 0.5 + 0.5);
    }

    vec3 reconstructRayDirection(vec2 uv) {
      vec3 origin;
      vec3 direction;
      ndcToCameraRay(
        uv * 2.0 - 1.0,
        uCameraMatrixWorld,
        uInverseProjection,
        origin,
        direction
      );
      return normalize(direction);
    }

    float fresnelSchlick(float cosine, float etaIncident, float etaTransmitted) {
      float f0 = (etaIncident - etaTransmitted) / (etaIncident + etaTransmitted);
      f0 *= f0;
      return f0 + (1.0 - f0) * pow(
        1.0 - clamp(cosine, 0.0, 1.0),
        5.0
      );
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
      int traversal,
      float roughness
    ) {
      float phase = dot(worldPosition, vec3(1.71, 2.43, 3.17))
        + float(traversal) * 2.37;
      float angle = sin(phase) * 3.14159265;
      mat2 rotation = mat2(
        cos(angle), -sin(angle),
        sin(angle), cos(angle)
      );
      vec2 offset = rotation * sampleOffset;
      float spread = roughness * roughness * 0.92;
      return normalize(tangentFrame(normal) * vec3(offset * spread, 1.0));
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

    SurfaceData readSurface(vec3 barycoord, uvec3 faceIndices) {
      vec4 meta = textureSampleBarycoord(
        uMetaAttribute,
        barycoord,
        faceIndices
      );
      vec4 opticalA = textureSampleBarycoord(
        uOpticalAAttribute,
        barycoord,
        faceIndices
      );
      vec4 opticalB = textureSampleBarycoord(
        uOpticalBAttribute,
        barycoord,
        faceIndices
      );
      vec4 opticalC = textureSampleBarycoord(
        uOpticalCAttribute,
        barycoord,
        faceIndices
      );
      vec4 base = textureSampleBarycoord(
        uBaseColorAttribute,
        barycoord,
        faceIndices
      );
      vec3 normal = textureSampleBarycoord(
        uNormalAttribute,
        barycoord,
        faceIndices
      ).xyz;

      SurfaceData result;
      result.kind = meta.x;
      result.volumeId = int(round(meta.y));
      result.mode = int(round(meta.z));
      result.sideMode = int(round(meta.w));
      result.ior = opticalA.x;
      result.roughness = opticalA.y;
      result.attenuationDistance = opticalA.z;
      result.reflectionStrength = opticalA.w;
      result.attenuationColor = opticalB.xyz;
      result.dispersion = opticalB.w;
      result.refractionReach = opticalC.x;
      result.bodyTintStrength = opticalC.y;
      result.thinThickness = opticalC.z;
      result.baseColor = base.xyz;
      result.baseRoughness = base.w;
      result.smoothNormal = normalize(normal);
      return result;
    }

    bool intersectRay(
      vec3 rayOrigin,
      vec3 rayDirection,
      out uvec4 faceIndices,
      out vec3 faceNormal,
      out vec3 barycoord,
      out float side,
      out float distanceAlongRay
    ) {
      faceIndices = uvec4(0u);
      faceNormal = vec3(0.0, 0.0, 1.0);
      barycoord = vec3(0.0);
      side = 1.0;
      distanceAlongRay = 0.0;
      return bvhIntersectFirstHit(
        uBVH,
        rayOrigin,
        rayDirection,
        faceIndices,
        faceNormal,
        barycoord,
        side,
        distanceAlongRay
      );
    }

    bool opaqueBeforePosition(vec3 worldPosition) {
      vec3 projected = projectWorld(worldPosition);
      if (
        projected.x <= 0.001 || projected.x >= 0.999
        || projected.y <= 0.001 || projected.y >= 0.999
      ) {
        return false;
      }
      float opaqueDepth = texture(uBaseDepth, projected.xy).r;
      return opaqueDepth < projected.z - 0.00015;
    }

    int findMediumIndex(int volumeId, int mediumCount, int mediumIds[MAX_MEDIA]) {
      int result = -1;
      for (int i = 0; i < MAX_MEDIA; i++) {
        if (i < mediumCount && mediumIds[i] == volumeId) result = i;
      }
      return result;
    }

    bool surfaceSideAllowed(int sideMode, float side) {
      if (sideMode == 2) return true;
      if (sideMode == 1) return side < 0.0;
      return side > 0.0;
    }

    vec3 shadeOpaqueFallback(
      vec3 baseColor,
      vec3 normal,
      vec3 rayDirection,
      float roughness
    ) {
      float facing = 0.30 + 0.70 * abs(dot(normalize(normal), -rayDirection));
      vec3 environment = environmentColor(reflect(rayDirection, normal), roughness);
      return baseColor * facing + environment * (1.0 - roughness) * 0.12;
    }

    vec3 resolveOpaqueColor(
      vec3 hitPosition,
      vec3 fallbackColor,
      vec3 normal,
      vec3 rayDirection,
      float roughness
    ) {
      vec3 projected = projectWorld(hitPosition);
      vec3 fallback = shadeOpaqueFallback(
        fallbackColor,
        normal,
        rayDirection,
        roughness
      );
      if (
        projected.x <= 0.002 || projected.x >= 0.998
        || projected.y <= 0.002 || projected.y >= 0.998
        || projected.z <= 0.0 || projected.z >= 1.0
      ) {
        return fallback;
      }

      float baseDepth = texture(uBaseDepth, projected.xy).r;
      float depthDelta = abs(baseDepth - projected.z);
      float screenMatch = 1.0 - smoothstep(0.0015, 0.012, depthDelta);
      vec3 screenColor = sampleRoughBase(
        projected.xy,
        roughness * roughness * 24.0
      );
      return mix(fallback, screenColor, screenMatch);
    }

    void tracePath(
      vec2 screenUv,
      float spectralSign,
      vec2 roughSample,
      out vec3 radiance,
      out bool touchedGlass,
      out float pathDispersion
    ) {
      vec3 rayOrigin = uCameraPosition;
      vec3 rayDirection = reconstructRayDirection(screenUv);
      vec3 throughput = vec3(1.0);
      vec3 reflectedRadiance = vec3(0.0);
      vec3 layerRadiance = vec3(0.0);
      float totalOpticalDistance = 0.0;
      float terminalReach = 2.0;
      float terminalRoughness = 0.0;
      bool stoppedAtOpaque = false;
      vec3 stoppedOpaquePosition = vec3(0.0);
      vec3 stoppedOpaqueNormal = vec3(0.0, 1.0, 0.0);
      vec3 stoppedOpaqueColor = vec3(1.0);
      float stoppedOpaqueRoughness = 0.5;
      touchedGlass = false;
      pathDispersion = 0.0;

      int mediumCount = 0;
      int mediumIds[MAX_MEDIA];
      float mediumIors[MAX_MEDIA];
      vec3 mediumColors[MAX_MEDIA];
      float mediumDistances[MAX_MEDIA];

      for (int traversal = 0; traversal < MAX_TRAVERSALS; traversal++) {
        uvec4 faceIndices;
        vec3 geometricNormal;
        vec3 barycoord;
        float side;
        float hitDistance;
        bool didHit = intersectRay(
          rayOrigin,
          rayDirection,
          faceIndices,
          geometricNormal,
          barycoord,
          side,
          hitDistance
        );
        if (!didHit) break;

        vec3 hitPosition = rayOrigin + rayDirection * hitDistance;

        if (mediumCount > 0) {
          int currentIndex = mediumCount - 1;
          float attenuationDistance = max(
            mediumDistances[currentIndex],
            0.0001
          );
          vec3 segmentAbsorption = pow(
            max(mediumColors[currentIndex], vec3(0.001)),
            vec3(hitDistance / attenuationDistance)
          );
          throughput *= segmentAbsorption;
          totalOpticalDistance += hitDistance;
        }

        SurfaceData surface = readSurface(barycoord, faceIndices.xyz);
        if (
          surface.kind < 0.5
          && !surfaceSideAllowed(surface.sideMode, side)
        ) {
          rayOrigin = hitPosition + rayDirection * RAY_EPSILON;
          continue;
        }

        if (surface.kind < 0.5) {
          stoppedAtOpaque = true;
          stoppedOpaquePosition = hitPosition;
          stoppedOpaqueNormal = normalize(surface.smoothNormal);
          stoppedOpaqueColor = surface.baseColor;
          stoppedOpaqueRoughness = surface.baseRoughness;
          terminalRoughness = max(terminalRoughness, surface.baseRoughness);
          break;
        }

        touchedGlass = true;
        pathDispersion = max(pathDispersion, surface.dispersion);
        terminalReach = surface.refractionReach;
        terminalRoughness = max(terminalRoughness, surface.roughness);

        vec3 normal = normalize(surface.smoothNormal);
        if (dot(rayDirection, normal) > 0.0) normal = -normal;
        normal = perturbNormal(
          normal,
          roughSample,
          hitPosition,
          traversal,
          surface.roughness
        );
        if (dot(rayDirection, normal) > 0.0) normal = -normal;

        bool entering = side > 0.0;
        int matchingMedium = findMediumIndex(
          surface.volumeId,
          mediumCount,
          mediumIds
        );
        float spectralIor = max(
          1.001,
          surface.ior + spectralSign * surface.dispersion * 1.85
        );
        float etaIncident = mediumCount > 0
          ? mediumIors[mediumCount - 1]
          : 1.0;
        float etaTransmitted = spectralIor;

        if (surface.mode == 0 && !entering) {
          if (matchingMedium >= 0) {
            etaIncident = mediumIors[matchingMedium];
            etaTransmitted = matchingMedium > 0
              ? mediumIors[matchingMedium - 1]
              : 1.0;
          } else {
            // Support cameras starting inside a volume even when no entry was
            // observed by the medium stack.
            etaIncident = spectralIor;
            etaTransmitted = 1.0;
          }
        }

        float cosine = clamp(-dot(rayDirection, normal), 0.0, 1.0);
        float fresnel = fresnelSchlick(
          cosine,
          etaIncident,
          etaTransmitted
        );
        vec3 reflectedDirection = normalize(reflect(rayDirection, normal));
        reflectedRadiance += throughput
          * fresnel
          * surface.reflectionStrength
          * environmentColor(reflectedDirection, surface.roughness);

        vec3 nextDirection = refract(
          rayDirection,
          normal,
          etaIncident / etaTransmitted
        );
        if (dot(nextDirection, nextDirection) < 1e-8) {
          rayOrigin = hitPosition + reflectedDirection * RAY_EPSILON;
          rayDirection = reflectedDirection;
          continue;
        }

        nextDirection = normalize(nextDirection);
        throughput *= 1.0 - fresnel;
        layerRadiance += throughput
          * surface.attenuationColor
          * surface.bodyTintStrength
          * (0.008 + surface.roughness * surface.roughness * 0.035);

        if (surface.mode == 1) {
          vec3 thinExit = hitPosition
            + nextDirection * max(surface.thinThickness, RAY_EPSILON);
          vec3 thinDirection = refract(
            nextDirection,
            -normal,
            etaTransmitted / etaIncident
          );
          if (dot(thinDirection, thinDirection) > 1e-8) {
            nextDirection = normalize(thinDirection);
          }
          rayOrigin = thinExit + nextDirection * RAY_EPSILON;
          rayDirection = nextDirection;
        } else {
          if (entering) {
            if (mediumCount < MAX_MEDIA && matchingMedium < 0) {
              mediumIds[mediumCount] = surface.volumeId;
              mediumIors[mediumCount] = spectralIor;
              mediumColors[mediumCount] = surface.attenuationColor;
              mediumDistances[mediumCount] = surface.attenuationDistance;
              mediumCount += 1;
            }
          } else if (matchingMedium >= 0) {
            // A well-formed nested volume exits from the top of the stack. If
            // intersecting geometry produces a different ordering, drop the
            // matching volume and every invalid medium above it deterministically.
            mediumCount = matchingMedium;
          } else if (mediumCount > 0) {
            mediumCount -= 1;
          }

          rayOrigin = hitPosition + nextDirection * RAY_EPSILON;
          rayDirection = nextDirection;
        }

        if (uLayered == 0) break;
      }

      if (!touchedGlass) {
        radiance = texture(uBaseColor, screenUv).rgb;
        return;
      }

      vec3 transmitted;
      if (stoppedAtOpaque) {
        transmitted = resolveOpaqueColor(
          stoppedOpaquePosition,
          stoppedOpaqueColor,
          stoppedOpaqueNormal,
          rayDirection,
          stoppedOpaqueRoughness
        );
      } else {
        vec3 terminalProjection = projectWorld(
          rayOrigin + rayDirection * terminalReach
        );
        vec2 terminalUv = clamp(
          terminalProjection.xy,
          vec2(0.003),
          vec2(0.997)
        );
        float blurRadius = terminalRoughness * terminalRoughness
          * (54.0 + totalOpticalDistance * 42.0);
        transmitted = sampleRoughBase(terminalUv, blurRadius);
      }

      radiance = reflectedRadiance + layerRadiance + transmitted * throughput;
    }

    vec3 traceRoughAverage(
      vec2 screenUv,
      float spectralSign,
      vec2 primarySample,
      out float dispersionAmount
    ) {
      vec3 sum = vec3(0.0);
      vec3 sampleRadiance;
      bool touchedGlass;
      float sampleDispersion;
      dispersionAmount = 0.0;

      tracePath(
        screenUv,
        spectralSign,
        primarySample,
        sampleRadiance,
        touchedGlass,
        sampleDispersion
      );
      sum += sampleRadiance;
      dispersionAmount = max(dispersionAmount, sampleDispersion);

      #if ROUGH_SAMPLES > 1
        tracePath(
          screenUv,
          spectralSign,
          vec2(-primarySample.y, primarySample.x) * 0.86,
          sampleRadiance,
          touchedGlass,
          sampleDispersion
        );
        sum += sampleRadiance;
        dispersionAmount = max(dispersionAmount, sampleDispersion);
      #endif

      #if ROUGH_SAMPLES > 2
        tracePath(
          screenUv,
          spectralSign,
          -primarySample * 0.72,
          sampleRadiance,
          touchedGlass,
          sampleDispersion
        );
        sum += sampleRadiance;
        dispersionAmount = max(dispersionAmount, sampleDispersion);
      #endif

      return sum / float(ROUGH_SAMPLES);
    }

    void main() {
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      vec3 baseColor = texture(uBaseColor, screenUv).rgb;

      if (texture(uCoverage, screenUv).r < 0.01) {
        outColor = vec4(baseColor, 1.0);
        return;
      }

      vec3 primaryDirection = reconstructRayDirection(screenUv);
      uvec4 firstIndices;
      vec3 firstNormal;
      vec3 firstBarycoord;
      float firstSide;
      float firstDistance;
      bool firstHit = intersectRay(
        uCameraPosition,
        primaryDirection,
        firstIndices,
        firstNormal,
        firstBarycoord,
        firstSide,
        firstDistance
      );
      if (!firstHit) {
        outColor = vec4(baseColor, 1.0);
        return;
      }

      SurfaceData firstSurface = readSurface(
        firstBarycoord,
        firstIndices.xyz
      );
      vec3 firstPosition = uCameraPosition
        + primaryDirection * firstDistance;
      if (opaqueBeforePosition(firstPosition)) {
        outColor = vec4(baseColor, 1.0);
        return;
      }

      #if USE_SPECTRAL == 1
        float redDispersion;
        float greenDispersion;
        float blueDispersion;
        vec3 redRadiance = traceRoughAverage(
          screenUv,
          -1.0,
          vec2(-0.72, 0.36),
          redDispersion
        );
        vec3 greenRadiance = traceRoughAverage(
          screenUv,
          0.0,
          vec2(0.18, -0.78),
          greenDispersion
        );
        vec3 blueRadiance = traceRoughAverage(
          screenUv,
          1.0,
          vec2(0.66, 0.42),
          blueDispersion
        );
        vec3 averaged = (redRadiance + greenRadiance + blueRadiance) / 3.0;
        vec3 spectralColor = vec3(
          redRadiance.r,
          greenRadiance.g,
          blueRadiance.b
        );
        outColor = vec4(
          mix(
            averaged,
            spectralColor,
            smoothstep(
              0.0005,
              0.012,
              max(redDispersion, max(greenDispersion, blueDispersion))
            )
          ),
          1.0
        );
      #else
        float pathDispersion;
        vec3 radiance = traceRoughAverage(
          screenUv,
          0.0,
          vec2(0.42, -0.31),
          pathDispersion
        );
        outColor = vec4(radiance, 1.0);
      #endif
    }
  `;
}
