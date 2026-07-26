export const layeredGlassVertexShader = /* glsl */ `
  out vec3 vWorldPosition;
  out vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const layeredGlassFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSourceTexture;
  uniform sampler2D uBackPositionTexture;
  uniform sampler2D uBackNormalTexture;
  uniform vec2 uResolution;
  uniform float uIor;
  uniform float uRoughness;
  uniform float uAttenuationDistance;
  uniform vec3 uAttenuationColor;
  uniform float uRefractionReach;
  uniform float uReflectionStrength;
  uniform float uDispersion;
  uniform mat4 uProjectionMatrix;
  uniform mat4 uViewMatrix;
  uniform vec3 uCameraPosition;

  in vec3 vWorldPosition;
  in vec3 vWorldNormal;
  out vec4 outColor;

  vec2 projectToUv(vec3 worldPosition) {
    vec4 clipPosition = uProjectionMatrix * uViewMatrix * vec4(worldPosition, 1.0);
    vec2 ndc = clipPosition.xy / max(clipPosition.w, 1e-5);
    return ndc * 0.5 + 0.5;
  }

  float fresnelSchlick(float cosTheta, float etaI, float etaT) {
    float f0 = (etaI - etaT) / (etaI + etaT);
    f0 *= f0;
    return f0 + (1.0 - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
  }

  vec3 environmentColor(vec3 direction) {
    vec3 d = normalize(direction);
    float vertical = d.y * 0.5 + 0.5;
    vec3 environment = mix(vec3(0.018, 0.02, 0.03), vec3(0.16, 0.19, 0.28), vertical);
    float leftStrip = pow(max(dot(d, normalize(vec3(-0.92, 0.08, 0.38))), 0.0), 90.0);
    float rightStrip = pow(max(dot(d, normalize(vec3(0.88, 0.14, 0.46))), 0.0), 110.0);
    float topStrip = pow(max(dot(d, normalize(vec3(0.05, 0.93, 0.36))), 0.0), 75.0);
    float warmStrip = pow(max(dot(d, normalize(vec3(-0.12, -0.22, 0.97))), 0.0), 140.0);
    environment += vec3(0.92, 0.97, 1.0) * leftStrip * 0.95;
    environment += vec3(0.65, 0.82, 1.0) * rightStrip * 0.75;
    environment += vec3(1.0) * topStrip * 0.68;
    environment += vec3(1.0, 0.55, 0.32) * warmStrip * 0.28;
    return environment;
  }

  vec3 sampleRoughTransmission(vec2 uv, float radius) {
    vec2 texel = 1.0 / uResolution;
    vec2 spread = texel * radius;
    vec3 result = texture(uSourceTexture, uv).rgb * 0.20;
    result += texture(uSourceTexture, uv + vec2( 0.95,  0.10) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2(-0.82,  0.38) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2( 0.45, -0.88) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2(-0.24, -0.96) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2( 0.58,  0.74) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2(-0.92, -0.24) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2( 0.08,  0.98) * spread).rgb * 0.10;
    result += texture(uSourceTexture, uv + vec2(-0.56,  0.78) * spread).rgb * 0.10;
    return result;
  }

  void main() {
    vec2 screenUv = gl_FragCoord.xy / uResolution;
    vec3 entryPosition = vWorldPosition;
    vec3 entryNormal = normalize(vWorldNormal);
    vec3 incidentDirection = normalize(entryPosition - uCameraPosition);

    if (dot(incidentDirection, entryNormal) > 0.0) {
      entryNormal = -entryNormal;
    }

    vec3 insideDirection = refract(incidentDirection, entryNormal, 1.0 / uIor);
    if (dot(insideDirection, insideDirection) < 1e-6) {
      insideDirection = reflect(incidentDirection, entryNormal);
    }

    vec2 exitUv = clamp(projectToUv(entryPosition + insideDirection), vec2(0.002), vec2(0.998));
    vec4 backPositionSample = texture(uBackPositionTexture, exitUv);
    vec4 backNormalSample = texture(uBackNormalTexture, exitUv);

    // Iteratively intersect the refracted ray with tangent planes sampled from the true back-face buffers.
    for (int iteration = 0; iteration < LAYERED_GLASS_ITERATIONS; iteration++) {
      if (backPositionSample.a < 0.5 || backNormalSample.a < 0.5) {
        break;
      }

      vec3 sampledPosition = backPositionSample.xyz;
      vec3 sampledNormal = normalize(backNormalSample.xyz);
      float denominator = dot(sampledNormal, insideDirection);

      if (abs(denominator) < 1e-4) {
        break;
      }

      float distanceAlongRay = dot(sampledNormal, sampledPosition - entryPosition) / denominator;
      vec3 candidate = entryPosition + insideDirection * max(distanceAlongRay, 0.002);
      vec2 candidateUv = clamp(projectToUv(candidate), vec2(0.002), vec2(0.998));
      exitUv = mix(exitUv, candidateUv, 0.82);
      backPositionSample = texture(uBackPositionTexture, exitUv);
      backNormalSample = texture(uBackNormalTexture, exitUv);
    }

    bool validExit = backPositionSample.a > 0.5 && backNormalSample.a > 0.5;
    vec3 exitPosition = validExit ? backPositionSample.xyz : entryPosition + insideDirection * 0.85;
    vec3 exitNormal = validExit ? normalize(backNormalSample.xyz) : -entryNormal;

    vec3 outsideDirection = refract(insideDirection, -exitNormal, uIor);
    bool totalInternalReflection = dot(outsideDirection, outsideDirection) < 1e-6;
    if (totalInternalReflection) {
      outsideDirection = reflect(insideDirection, -exitNormal);
    }
    outsideDirection = normalize(outsideDirection);

    vec2 refractedUv = clamp(
      projectToUv(exitPosition + outsideDirection * uRefractionReach),
      vec2(0.003),
      vec2(0.997)
    );

    float opticalDistance = max(distance(entryPosition, exitPosition), 0.001);
    float blurRadius = uRoughness * uRoughness * (44.0 + opticalDistance * 30.0);
    vec2 dispersionDirection = normalize(refractedUv - screenUv + vec2(1e-5));
    vec2 dispersionOffset = dispersionDirection * uDispersion * (0.35 + opticalDistance * 0.24);

    vec3 transmitted;
    transmitted.r = sampleRoughTransmission(refractedUv + dispersionOffset, blurRadius).r;
    transmitted.g = sampleRoughTransmission(refractedUv, blurRadius).g;
    transmitted.b = sampleRoughTransmission(refractedUv - dispersionOffset, blurRadius).b;

    vec3 absorption = pow(
      max(uAttenuationColor, vec3(0.001)),
      vec3(opticalDistance / max(uAttenuationDistance, 0.001))
    );
    transmitted *= absorption;

    vec3 reflectedDirection = reflect(incidentDirection, entryNormal);
    vec3 reflected = environmentColor(reflectedDirection);
    reflected = mix(reflected, vec3(dot(reflected, vec3(0.333))), uRoughness * 0.42);

    float entryCosine = clamp(-dot(incidentDirection, entryNormal), 0.0, 1.0);
    float exitCosine = clamp(dot(outsideDirection, exitNormal), 0.0, 1.0);
    float entryFresnel = fresnelSchlick(entryCosine, 1.0, uIor);
    float exitFresnel = fresnelSchlick(exitCosine, uIor, 1.0);
    float transmissionWeight = (1.0 - entryFresnel) * (1.0 - exitFresnel);

    if (totalInternalReflection) {
      transmissionWeight *= 0.08;
      entryFresnel = 1.0;
    }

    vec3 color = transmitted * transmissionWeight;
    color += reflected * entryFresnel * uReflectionStrength;
    float rim = pow(1.0 - entryCosine, 7.0);
    color += vec3(0.34, 0.40, 0.52) * rim * 0.18;
    outColor = vec4(color, 1.0);
  }
`;
