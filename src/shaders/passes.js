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
  uniform sampler2D uCoverageTexture;
  in vec2 vUv;
  out vec4 outColor;

  void main() {
    vec3 baseColor = texture(uBaseTexture, vUv).rgb;
    vec4 transmissionSample = texture(uRayTexture, vUv);
    float roughness = clamp(
      (transmissionSample.a - 0.01) / 0.99,
      0.0,
      1.0
    );
    float blurAmount = smoothstep(0.35, 1.0, roughness);
    vec3 blurredTransmission = texture(uBlurTexture, vUv).rgb;
    vec3 transmissionColor = mix(
      transmissionSample.rgb,
      blurredTransmission,
      blurAmount
    );
    vec3 frontSurfaceColor = texture(uFrontTexture, vUv).rgb;
    vec3 rayColor = transmissionColor + frontSurfaceColor;
    float coverage = texture(uCoverageTexture, vUv).r;
    float blend = smoothstep(0.015, 0.45, coverage);
    outColor = vec4(mix(baseColor, rayColor, blend), 1.0);
  }
`;
