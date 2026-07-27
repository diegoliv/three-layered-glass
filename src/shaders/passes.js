export const passVertexShader = /* glsl */ `
  out vec3 vWorldPosition;
  out vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const backPositionFragmentShader = /* glsl */ `
  precision highp float;

  in vec3 vWorldPosition;
  out vec4 outColor;

  void main() {
    outColor = vec4(vWorldPosition, 1.0);
  }
`;

export const backNormalFragmentShader = /* glsl */ `
  precision highp float;

  in vec3 vWorldNormal;
  out vec4 outColor;

  void main() {
    outColor = vec4(normalize(vWorldNormal), 1.0);
  }
`;

export const fullscreenVertexShader = /* glsl */ `
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const glassSurfaceVertexShader = /* glsl */ `
  out vec3 vWorldPosition;
  out vec3 vWorldNormal;
  out vec4 vClipPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
    vClipPosition = gl_Position;
  }
`;

export const glassSurfaceFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uCameraPosition;
  uniform sampler2D uBaseDepth;
  uniform float uIor;
  uniform float uRoughness;
  uniform float uReflectionStrength;

  in vec3 vWorldPosition;
  in vec3 vWorldNormal;
  in vec4 vClipPosition;
  out vec4 outColor;

  float fresnelSchlick(float cosine, float etaIncident, float etaTransmitted) {
    float f0 = (etaIncident - etaTransmitted)
      / (etaIncident + etaTransmitted);
    f0 *= f0;
    return f0 + (1.0 - f0) * pow(
      1.0 - clamp(cosine, 0.0, 1.0),
      5.0
    );
  }

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

  void main() {
    vec2 screenUv = vClipPosition.xy / vClipPosition.w * 0.5 + 0.5;
    float opaqueDepth = texture(uBaseDepth, screenUv).r;
    if (opaqueDepth + 0.0001 < gl_FragCoord.z) discard;

    vec3 incidentDirection = normalize(vWorldPosition - uCameraPosition);
    vec3 normal = normalize(vWorldNormal);
    if (dot(incidentDirection, normal) > 0.0) normal = -normal;

    float cosine = clamp(-dot(incidentDirection, normal), 0.0, 1.0);
    float fresnel = fresnelSchlick(cosine, 1.0, max(uIor, 1.001));
    vec3 reflectedDirection = normalize(reflect(incidentDirection, normal));
    vec3 reflected = environmentColor(reflectedDirection, uRoughness);
    outColor = vec4(
      reflected * fresnel * uReflectionStrength,
      1.0
    );
  }
`;

export const copyFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uTexture;
  in vec2 vUv;
  out vec4 outColor;

  void main() {
    outColor = texture(uTexture, vUv);
  }
`;


export const roughTransmissionBlurFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSourceTexture;
  uniform float uOffset;
  in vec2 vUv;
  out vec4 outColor;

  void accumulateBlurSample(
    inout vec3 color,
    inout float totalWeight,
    inout float supportAlpha,
    vec2 uv,
    float sampleWeight
  ) {
    vec4 sampleColor = texture(uSourceTexture, uv);
    float validGlass = step(0.005, sampleColor.a);
    float weight = sampleWeight * validGlass;
    color += sampleColor.rgb * weight;
    totalWeight += weight;
    supportAlpha = max(supportAlpha, sampleColor.a);
  }

  void main() {
    vec2 texel = 1.0 / vec2(textureSize(uSourceTexture, 0));
    vec2 diagonal = texel * uOffset;
    vec2 axial = diagonal * 2.0;
    vec3 filtered = vec3(0.0);
    float totalWeight = 0.0;
    float supportAlpha = 0.0;

    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv,
      4.0
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv + vec2(diagonal.x, diagonal.y),
      1.0
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv + vec2(-diagonal.x, diagonal.y),
      1.0
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv + vec2(diagonal.x, -diagonal.y),
      1.0
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv - diagonal,
      1.0
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv + vec2(axial.x, 0.0),
      0.5
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv - vec2(axial.x, 0.0),
      0.5
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv + vec2(0.0, axial.y),
      0.5
    );
    accumulateBlurSample(
      filtered,
      totalWeight,
      supportAlpha,
      vUv - vec2(0.0, axial.y),
      0.5
    );

    if (totalWeight <= 0.001) {
      outColor = vec4(0.0);
      return;
    }

    outColor = vec4(filtered / totalWeight, supportAlpha);
  }
`;

export const coverageCompositeFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uBaseTexture;
  uniform sampler2D uRayTexture;
  uniform sampler2D uBlurTexture;
  uniform sampler2D uFrontTexture;
  uniform int uHasRoughBlur;
  in vec2 vUv;
  out vec4 outColor;

  vec4 sampleEdgeAwareTransmission(float coverage) {
    vec4 bilinearSample = texture(uRayTexture, vUv);
    float edgeAmount = clamp(fwidth(coverage) * 2.0, 0.0, 1.0);
    if (edgeAmount <= 0.001 || coverage <= 0.001) {
      return bilinearSample;
    }

    ivec2 extent = textureSize(uRayTexture, 0);
    vec2 samplePosition = vUv * vec2(extent);
    ivec2 baseCoordinate = ivec2(floor(samplePosition - vec2(0.5)));
    vec4 nearestValidSample = bilinearSample;
    float nearestDistance = 1e10;

    for (int y = 0; y <= 1; y++) {
      for (int x = 0; x <= 1; x++) {
        ivec2 coordinate = clamp(
          baseCoordinate + ivec2(x, y),
          ivec2(0),
          extent - ivec2(1)
        );
        vec4 candidate = texelFetch(uRayTexture, coordinate, 0);
        vec2 candidateCenter = vec2(coordinate) + vec2(0.5);
        vec2 sampleOffset = candidateCenter - samplePosition;
        float candidateDistance = dot(sampleOffset, sampleOffset);
        if (candidate.a >= 0.005 && candidateDistance < nearestDistance) {
          nearestValidSample = candidate;
          nearestDistance = candidateDistance;
        }
      }
    }

    return mix(bilinearSample, nearestValidSample, edgeAmount);
  }

  void main() {
    vec3 baseColor = texture(uBaseTexture, vUv).rgb;
    vec4 surfaceSample = texture(uFrontTexture, vUv);
    float surfaceCoverage = surfaceSample.a;
    vec4 transmissionSample = sampleEdgeAwareTransmission(surfaceCoverage);
    float rayValidity = smoothstep(0.003, 0.01, transmissionSample.a);
    float roughness = clamp(
      (transmissionSample.a - 0.01) / 0.99,
      0.0,
      1.0
    );
    float blurAmount = smoothstep(0.35, 1.0, roughness);
    vec3 transmissionColor = transmissionSample.rgb;
    if (uHasRoughBlur == 1 && blurAmount > 0.001) {
      vec3 blurredTransmission = texture(uBlurTexture, vUv).rgb;
      transmissionColor = mix(
        transmissionColor,
        blurredTransmission,
        blurAmount
      );
    }
    transmissionColor = mix(baseColor, transmissionColor, rayValidity);
    vec3 rayColor = transmissionColor + surfaceSample.rgb;
    float coverage = surfaceCoverage;
    float blend = smoothstep(0.08, 0.92, coverage);
    outColor = vec4(mix(baseColor, rayColor, blend), 1.0);
  }
`;
