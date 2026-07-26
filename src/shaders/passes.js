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


export const coverageCompositeFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uBaseTexture;
  uniform sampler2D uRayTexture;
  uniform sampler2D uCoverageTexture;
  in vec2 vUv;
  out vec4 outColor;

  void main() {
    vec3 baseColor = texture(uBaseTexture, vUv).rgb;
    vec3 rayColor = texture(uRayTexture, vUv).rgb;
    float coverage = texture(uCoverageTexture, vUv).r;
    float blend = smoothstep(0.015, 0.45, coverage);
    outColor = vec4(mix(baseColor, rayColor, blend), 1.0);
  }
`;
