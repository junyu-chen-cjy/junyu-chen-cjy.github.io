import * as THREE from 'three';

// Procedural GLSL shaders for continuous multi-scale cosmic rendering.
// Combines volumetric 3D galaxy continuum slices, crisp Airy-disk starfields,
// anisotropic nebula billows, and high-detail procedural celestial bodies.

const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.08 + vec3(1.3, -1.7, 0.8);
      a *= 0.5;
    }
    return v;
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.06 + vec3(1.3, -1.7, 0.8);
      a *= 0.5;
    }
    return v;
  }
`;

export function createCosmicSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform float uTime;
      ${NOISE_GLSL}

      void main() {
        vec3 d = normalize(vDir);
        float bandCoord = d.y * 0.86 - d.x * 0.34 + d.z * 0.18;
        float plane = exp(-pow(abs(bandCoord) * 2.4, 1.55));
        float n1 = fbm3(d * 3.2 + vec3(0.4, -0.2, 0.1));
        float n2 = noise(d * 9.0 - vec3(0.2, 0.5, -0.3));
        float veil = plane * smoothstep(0.24, 0.82, n1 * 0.72 + n2 * 0.28);
        float rift = smoothstep(0.42, 0.66, noise(d * 5.8 + vec3(1.2, 0.3, -0.7)));

        vec3 abyss = vec3(0.011, 0.018, 0.026);
        vec3 deepSlate = vec3(0.045, 0.074, 0.090);
        vec3 warmTrace = vec3(0.072, 0.059, 0.046);

        vec3 col = abyss;
        col += deepSlate * veil * (1.0 - rift * 0.68) * 0.85;
        col += warmTrace * pow(veil, 1.8) * (1.0 - rift * 0.5) * 0.45;
        col *= 0.80 + 0.20 * (1.0 - abs(d.y));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export interface GalaxyVolumeShaderOptions {
  morphology: 'barred-spiral' | 'ring-spiral';
  armWind: number;
  seed: number;
  coreColor: string;
  innerColor: string;
  outerColor: string;
  nebulaColor: string;
  accentColor: string;
  sliceY: number;
  knots: [number, number][];
}

export function createGalaxyVolumeMaterial(opts: GalaxyVolumeShaderOptions): THREE.ShaderMaterial {
  const knotVecs = Array.from({ length: 6 }, (_, i) => {
    const k = opts.knots[i];
    return k ? new THREE.Vector2(k[0], k[1]) : new THREE.Vector2(99, 99);
  });

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1.0 },
      uMorphology: { value: opts.morphology === 'ring-spiral' ? 1.0 : 0.0 },
      uArmWind: { value: opts.armWind },
      uSeed: { value: opts.seed },
      uSliceY: { value: opts.sliceY },
      uCoreColor: { value: new THREE.Color(opts.coreColor) },
      uInnerColor: { value: new THREE.Color(opts.innerColor) },
      uOuterColor: { value: new THREE.Color(opts.outerColor) },
      uNebulaColor: { value: new THREE.Color(opts.nebulaColor) },
      uAccentColor: { value: new THREE.Color(opts.accentColor) },
      uKnotCount: { value: Math.min(opts.knots.length, 6) },
      uKnots: { value: knotVecs },
    },
    vertexShader: /* glsl */ `
      varying vec2 vDiskUv;
      varying float vCamDist;
      varying float vViewAngle;

      uniform float uSliceY;
      uniform float uSeed;

      void main() {
        vDiskUv = uv * 2.0 - 1.0;
        float r = length(vDiskUv);
        float angle = atan(vDiskUv.y, vDiskUv.x);

        // 3D integral-sign galactic warp at the outer rim
        float warp = sin(angle + 0.5) * pow(clamp(r, 0.0, 1.0), 2.1) * 0.085;
        vec3 warpedPos = position + vec3(0.0, 0.0, warp * length(position));

        vec4 worldPos = modelMatrix * vec4(warpedPos, 1.0);
        vec4 mvPos = viewMatrix * worldPos;
        vCamDist = max(0.1, -mvPos.z);

        vec3 worldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
        vec3 viewDir = normalize(cameraPosition - worldPos.xyz);
        vViewAngle = abs(dot(worldNormal, viewDir));

        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vDiskUv;
      varying float vCamDist;
      varying float vViewAngle;

      uniform float uTime;
      uniform float uOpacity;
      uniform float uMorphology;
      uniform float uArmWind;
      uniform float uSeed;
      uniform float uSliceY;
      uniform vec3 uCoreColor;
      uniform vec3 uInnerColor;
      uniform vec3 uOuterColor;
      uniform vec3 uNebulaColor;
      uniform vec3 uAccentColor;
      uniform int uKnotCount;
      uniform vec2 uKnots[6];

      ${NOISE_GLSL}

      void main() {
        float r = length(vDiskUv);
        if (r > 1.0 || uOpacity < 0.003) discard;

        // Differential galactic rotation: inner bar/ring rotates faster than outer spiral arms
        float diffOmega = 0.016 + 0.032 / (0.28 + r * 1.35);
        float rot = -uTime * diffOmega * (uMorphology > 0.5 ? -0.92 : 1.0);
        float cr = cos(rot);
        float sr = sin(rot);
        vec2 p = mat2(cr, -sr, sr, cr) * vDiskUv;

        float theta = atan(p.y, p.x);
        float sliceWeight = exp(-uSliceY * uSliceY * 2.35);

        // Continuous turbulent advection inside spiral arms and dust lanes
        vec2 flowOffset = vec2(cos(uTime * 0.07 + r * 2.5), sin(uTime * 0.06 - r * 2.1)) * 0.18;
        vec3 nCoord = vec3(p * 4.0 + flowOffset, uSliceY * 1.4 + uSeed * 0.13 + uTime * 0.045);
        float turb = fbm3(nCoord);
        float fineTurb = fbm3(vec3(p * 11.0 - flowOffset * 1.6, uSliceY * 2.6 - uSeed * 0.07 - uTime * 0.08));

        // 1. Structured Galactic Bulge & Bar (high dynamic range without clipping to a flat white circle)
        vec2 barUv = vec2(p.x * 0.68, p.y * 1.72);
        float barR = length(barUv);
        float coreNucleus = exp(-r * 13.5) * 0.92;
        float innerBulge = exp(-r * 5.6) * 0.42 * (0.65 + 0.55 * fineTurb);
        float barBulge = exp(-barR * 4.2) * 0.48 * (0.68 + 0.48 * turb);
        // Carve subtle spiral dust filaments even inside the outer bulge
        float innerDust = smoothstep(0.32, 0.78, fineTurb) * smoothstep(0.04, 0.22, r);
        float coreTotal = (coreNucleus + (innerBulge + barBulge) * (1.0 - innerDust * 0.38)) * sliceWeight;

        float armDensity = 0.0;
        float dustLane = 0.0;

        if (uMorphology < 0.5) {
          // Grand-design Barred Spiral with 2 major arms + branching spurs + continuous dark dust lanes
          float logR = log(max(r, 0.055));
          float phase2 = 2.0 * theta - uArmWind * logR + (turb - 0.5) * 1.95 + uSliceY * 0.35;
          float phaseSpur = 4.0 * theta - (uArmWind * 1.28) * logR + (fineTurb - 0.5) * 2.25 + 1.1;

          float mainArms = pow(0.5 + 0.5 * cos(phase2), 2.4);
          float spurArms = pow(0.5 + 0.5 * cos(phaseSpur), 3.3) * smoothstep(0.20, 0.62, r);
          float radialEnv = smoothstep(0.05, 0.19, r) * (1.0 - smoothstep(0.56, 0.98, r));

          armDensity = (mainArms * 0.78 + spurArms * 0.40) * radialEnv * (0.50 + 0.82 * turb);

          // Continuous filamentary dark absorption lanes along the inner concave edge of the spiral arms
          float dustPhase = phase2 + 0.76 + (fineTurb - 0.5) * 1.5;
          dustLane = pow(0.5 + 0.5 * cos(dustPhase), 4.2) * smoothstep(0.06, 0.24, r) * (1.0 - smoothstep(0.55, 0.88, r));
          dustLane *= (0.5 + 0.9 * fineTurb);
        } else {
          // Ring-Spiral Morphology: Incandescent inner resonance ring + Cassini dust gap + outer tidal arms
          float ring = exp(-pow((r - 0.36) / 0.092, 2.0)) * (0.58 + 0.68 * turb);
          float innerSpokes = pow(0.5 + 0.5 * cos(2.0 * theta - 2.6 * r + turb * 2.1), 2.3) * smoothstep(0.06, 0.36, r);
          float logR = log(max(r, 0.14));
          float outerPhase = 2.0 * theta - uArmWind * logR + (turb - 0.5) * 1.8;
          float outerArms = pow(0.5 + 0.5 * cos(outerPhase), 2.7) * smoothstep(0.42, 0.58, r) * (1.0 - smoothstep(0.68, 0.98, r));

          armDensity = (ring * 0.88 + innerSpokes * 0.26 + outerArms * 0.64) * (0.55 + 0.72 * fineTurb);
          dustLane = exp(-pow((r - 0.47) / 0.058, 2.0)) * (0.65 + 0.65 * fineTurb);
        }

        // 2. Embedded H-II Stellar System Nursery Knots
        float knotGlow = 0.0;
        for (int i = 0; i < 6; i++) {
          if (i >= uKnotCount) break;
          vec2 dKnot = vDiskUv - uKnots[i];
          float d2 = dot(dKnot, dKnot);
          knotGlow += exp(-d2 * 56.0) * (0.52 + 0.68 * fineTurb);
        }

        float diskCloud = (armDensity + knotGlow * 0.62) * mix(0.42, 1.0, sliceWeight);
        float absorption = clamp(dustLane * 0.82 * sliceWeight, 0.0, 0.86);
        float totalDensity = (coreTotal + diskCloud * (1.0 - absorption)) * (1.0 - smoothstep(0.82, 1.0, r));

        vec3 regionColor = mix(uInnerColor, uOuterColor, smoothstep(0.16, 0.76, r));
        regionColor = mix(regionColor, uNebulaColor, clamp(turb * 0.88, 0.0, 1.0));
        regionColor = mix(regionColor, uAccentColor, clamp(knotGlow * 0.85 + pow(fineTurb, 2.2) * 0.38, 0.0, 1.0));
        vec3 finalColor = mix(regionColor, uCoreColor, clamp(coreTotal * 0.78, 0.0, 1.0));

        float nearFade = smoothstep(8.0, 48.0, vCamDist);
        float angleBoost = 0.62 + 0.38 * smoothstep(0.05, 0.45, vViewAngle);

        float alpha = clamp(totalDensity * 0.33 * uOpacity * nearFade * angleBoost, 0.0, 0.64);
        gl_FragColor = vec4(finalColor * alpha * 1.4, alpha);
      }
    `,
  });
}

export interface StarfieldShaderOptions {
  pixelRatio: number;
  scale?: number;
  opacity?: number;
  nearFadeEnd?: number;
  nearFadeStart?: number;
  maxPointSize?: number;
  differentialOmega?: number;
  epicycleAmp?: number;
  streamFlow?: number;
}

export function createStarfieldMaterial(opts: StarfieldShaderOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: opts.pixelRatio },
      uScale: { value: opts.scale ?? 1.0 },
      uOpacity: { value: opts.opacity ?? 1.0 },
      uNearFadeEnd: { value: opts.nearFadeEnd ?? 1.8 },
      uNearFadeStart: { value: opts.nearFadeStart ?? 12.0 },
      uMaxPointSize: { value: opts.maxPointSize ?? 13.0 },
      uDifferentialOmega: { value: opts.differentialOmega ?? 0.0 },
      uEpicycleAmp: { value: opts.epicycleAmp ?? 0.0 },
      uStreamFlow: { value: opts.streamFlow ?? 0.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute float aBright;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vBright;

      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uScale;
      uniform float uOpacity;
      uniform float uNearFadeEnd;
      uniform float uNearFadeStart;
      uniform float uMaxPointSize;
      uniform float uDifferentialOmega;
      uniform float uEpicycleAmp;
      uniform float uStreamFlow;

      void main() {
        vColor = color;
        vBright = aBright;

        vec3 pos = position;
        float rXZ = length(pos.xz);

        // GPU differential orbital shear + local Lindblad epicycles
        if (abs(uDifferentialOmega) > 0.0001 && rXZ > 0.05) {
          float localOmega = uDifferentialOmega / pow(1.0 + 0.024 * rXZ, 0.56);
          float epicycleFreq = 0.55 + aBright * 0.95;
          float epiPhase = uTime * epicycleFreq + aPhase * 6.283185;

          float dr = uEpicycleAmp * sin(epiPhase) * (0.35 + 0.0045 * rXZ);
          float dTheta = localOmega * uTime + (uEpicycleAmp * 1.45 * cos(epiPhase)) / max(3.5, rXZ);
          float dy = uEpicycleAmp * 0.42 * sin(epiPhase * 1.31 + aPhase * 4.1);

          float baseTheta = atan(pos.z, pos.x) + dTheta;
          float newR = max(0.05, rXZ + dr);
          pos.x = cos(baseTheta) * newR;
          pos.z = sin(baseTheta) * newR;
          pos.y += dy;
        } else if (uEpicycleAmp > 0.0001) {
          float driftPhase = uTime * (0.45 + aBright * 0.5) + aPhase * 6.283185;
          pos.x += sin(driftPhase) * uEpicycleAmp;
          pos.y += cos(driftPhase * 1.27) * uEpicycleAmp * 0.65;
          pos.z += sin(driftPhase * 0.83 + 1.4) * uEpicycleAmp;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = max(0.1, -mvPosition.z);

        float twinkle = 0.84 + 0.16 * sin(uTime * 1.85 + aPhase * 6.283185);
        if (uStreamFlow > 0.01) {
          float wave = 0.5 + 0.5 * sin(uTime * 2.4 - aPhase * 12.566);
          twinkle *= 0.65 + 0.65 * pow(wave, 2.0);
        }

        float rawSize = aSize * uScale * uPixelRatio * (270.0 / dist);
        gl_PointSize = clamp(rawSize, 1.25 * uPixelRatio, uMaxPointSize * uPixelRatio);

        float nearFade = smoothstep(uNearFadeEnd, uNearFadeStart, dist);
        float farFade = 1.0 - smoothstep(3600.0, 5600.0, dist);
        float subPixelBoost = clamp(rawSize / (1.2 * uPixelRatio), 0.34, 1.0);

        vAlpha = uOpacity * twinkle * nearFade * farFade * subPixelBoost;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vBright;

      void main() {
        vec2 uv = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(uv, uv);
        if (r2 > 1.0 || vAlpha < 0.003) discard;

        float r = sqrt(r2);
        float core = exp(-r2 * 28.0);
        float halo = exp(-r * 4.4) * 0.42;
        float edge = 1.0 - smoothstep(0.55, 1.0, r);

        float spike = 0.0;
        if (vBright > 0.52) {
          float sx = exp(-abs(uv.y) * 26.0) * exp(-abs(uv.x) * 3.0);
          float sy = exp(-abs(uv.x) * 26.0) * exp(-abs(uv.y) * 3.0);
          spike = (sx + sy) * (vBright - 0.52) * 0.95 * edge;
        }

        float intensity = (core + halo + spike) * edge;
        vec3 starColor = mix(vColor, vec3(1.0, 0.98, 0.94), clamp(core * 0.82 + spike * 0.45, 0.0, 1.0));
        gl_FragColor = vec4(starColor * intensity, clamp(intensity * vAlpha, 0.0, 1.0));
      }
    `,
  });
}

export interface NebulaShaderOptions {
  pixelRatio: number;
  isDarkDust?: boolean;
  opacity?: number;
  nearFadeEnd?: number;
  nearFadeStart?: number;
  maxPointSize?: number;
  differentialOmega?: number;
  driftAmp?: number;
}

export function createNebulaMaterial(opts: NebulaShaderOptions): THREE.ShaderMaterial {
  const isDark = !!opts.isDarkDust;
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: isDark ? THREE.NormalBlending : THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: opts.pixelRatio },
      uOpacity: { value: opts.opacity ?? 1.0 },
      uNearFadeEnd: { value: opts.nearFadeEnd ?? 14.0 },
      uNearFadeStart: { value: opts.nearFadeStart ?? 64.0 },
      uMaxPointSize: { value: opts.maxPointSize ?? 64.0 },
      uIsDark: { value: isDark ? 1.0 : 0.0 },
      uDifferentialOmega: { value: opts.differentialOmega ?? 0.0 },
      uDriftAmp: { value: opts.driftAmp ?? 0.0 },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aRotation;
      attribute float aSeed;
      attribute float aOpacity;

      varying vec3 vColor;
      varying float vAlpha;
      varying float vRotation;
      varying float vSeed;

      uniform float uTime;
      uniform float uPixelRatio;
      uniform float uOpacity;
      uniform float uNearFadeEnd;
      uniform float uNearFadeStart;
      uniform float uMaxPointSize;
      uniform float uDifferentialOmega;
      uniform float uDriftAmp;

      void main() {
        vColor = color;
        vRotation = aRotation + uTime * (0.045 * sin(aSeed * 3.17));
        vSeed = aSeed;

        vec3 pos = position;
        float rXZ = length(pos.xz);
        if (abs(uDifferentialOmega) > 0.0001 && rXZ > 0.1) {
          float localOmega = uDifferentialOmega / pow(1.0 + 0.022 * rXZ, 0.55);
          float dTheta = localOmega * uTime;
          float baseTheta = atan(pos.z, pos.x) + dTheta;
          float dr = uDriftAmp * sin(uTime * 0.42 + aSeed * 1.9);
          pos.x = cos(baseTheta) * (rXZ + dr);
          pos.z = sin(baseTheta) * (rXZ + dr);
          pos.y += uDriftAmp * 0.35 * cos(uTime * 0.51 + aSeed * 2.7);
        } else if (uDriftAmp > 0.0001) {
          pos.x += sin(uTime * 0.55 + aSeed) * uDriftAmp;
          pos.y += cos(uTime * 0.48 + aSeed * 1.4) * uDriftAmp * 0.5;
          pos.z += sin(uTime * 0.62 + aSeed * 2.1) * uDriftAmp;
        }

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = max(0.5, -mvPosition.z);

        float pulse = 0.90 + 0.10 * sin(uTime * 0.75 + aSeed * 2.3);
        float rawSize = aSize * pulse * uPixelRatio * (480.0 / dist);
        gl_PointSize = clamp(rawSize, 8.0 * uPixelRatio, uMaxPointSize * uPixelRatio);

        float nearFade = smoothstep(uNearFadeEnd, uNearFadeStart, dist);
        float farFade = 1.0 - smoothstep(2600.0, 4400.0, dist);

        vAlpha = aOpacity * uOpacity * nearFade * farFade;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      varying float vRotation;
      varying float vSeed;

      uniform float uTime;
      uniform float uIsDark;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(centered, centered);
        if (r2 > 1.0 || vAlpha < 0.002) discard;

        float c = cos(vRotation);
        float s = sin(vRotation);
        vec2 uv = mat2(c, -s, s, c) * centered;

        vec2 warped = uv * vec2(1.0, 1.28);
        float flow = uTime * 0.16;
        float w1 = sin(warped.x * 3.4 + vSeed * 6.1 + flow) * cos(warped.y * 2.9 - vSeed * 4.3 - flow * 0.8);
        float w2 = sin((warped.x + warped.y) * 5.2 - vSeed * 9.7 + flow * 1.3) * 0.5;
        float w3 = cos(warped.x * 7.5 - warped.y * 6.8 + vSeed * 13.3 - flow * 1.1) * 0.25;
        float fbmVal = 0.58 + 0.28 * (w1 + w2 + w3);

        float radial = 1.0 - smoothstep(0.05, 0.98, sqrt(r2));
        float density = pow(radial, 1.75) * clamp(fbmVal, 0.2, 1.3);

        if (uIsDark > 0.5) {
          gl_FragColor = vec4(vColor, clamp(density * vAlpha, 0.0, 0.45));
        } else {
          vec3 col = mix(vColor, vec3(1.0, 0.95, 0.86), pow(radial, 2.6) * 0.32);
          gl_FragColor = vec4(col * density * vAlpha * 1.3, clamp(density * vAlpha, 0.0, 1.0));
        }
      }
    `,
  });
}

export interface CelestialBodyShaderOptions {
  baseColor: string;
  atmosphereColor: string;
  isPrimary: boolean;
  seed: number;
}

export function createCelestialBodyMaterial(opts: CelestialBodyShaderOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uBaseColor: { value: new THREE.Color(opts.baseColor) },
      uAtmosphereColor: { value: new THREE.Color(opts.atmosphereColor) },
      uIsPrimary: { value: opts.isPrimary ? 1.0 : 0.0 },
      uSeed: { value: opts.seed },
      uOpacity: { value: 1.0 },
      uSystemCenter: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;

      void main() {
        vLocalPos = normalize(position);
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * worldPosition;
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorldNormal;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vViewDir;

      uniform float uTime;
      uniform vec3 uBaseColor;
      uniform vec3 uAtmosphereColor;
      uniform float uIsPrimary;
      uniform float uSeed;
      uniform float uOpacity;
      uniform vec3 uSystemCenter;

      ${NOISE_GLSL}

      void main() {
        if (uOpacity < 0.005) discard;
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewDir);
        float ndotv = max(0.0, dot(N, V));
        float fresnel = pow(1.0 - ndotv, 2.5);

        // Multi-scale domain-warped coordinates for crisp close-up surface detail
        vec3 q = vLocalPos * 3.4 + vec3(uSeed * 1.7, uTime * 0.11, -uTime * 0.08);
        float warp1 = fbm(q);
        vec3 warpedCoord = q + vec3(warp1 * 1.15, -warp1 * 0.85, warp1 * 0.65);
        float n = fbm(warpedCoord);
        float micro = fbm(vLocalPos * 14.5 + vec3(warp1 * 2.2, -uTime * 0.21, uSeed));
        float bands = sin(vLocalPos.y * 10.5 + n * 4.8 + uSeed + uTime * 0.18);

        if (uIsPrimary > 0.5) {
          // High-resolution stellar/core convection cells, filaments, and limb darkening/corona
          float cells = smoothstep(0.24, 0.80, n * 0.52 + micro * 0.48);
          float filaments = pow(clamp(1.0 - abs(n - micro) * 2.4, 0.0, 1.0), 3.0);

          vec3 hotCore = vec3(1.0, 0.96, 0.86);
          vec3 midTone = uBaseColor * 0.94;
          vec3 deepUmbra = uBaseColor * vec3(0.54, 0.39, 0.27);

          vec3 surface = mix(deepUmbra, midTone, cells);
          surface = mix(surface, hotCore, filaments * 0.52 + pow(cells, 2.8) * 0.38);
          // Subtle limb darkening followed by coronal rim glow
          surface *= 0.72 + 0.34 * pow(ndotv, 0.65);
          surface += mix(uBaseColor, uAtmosphereColor, 0.55) * fresnel * 0.92;

          gl_FragColor = vec4(surface, uOpacity);
        } else {
          vec3 toStar = normalize(uSystemCenter - vWorldPos);
          float ndotl = dot(normalize(vWorldNormal), toStar);
          float day = smoothstep(-0.28, 0.65, ndotl);
          float twilight = exp(-pow((ndotl + 0.05) * 3.8, 2.0));

          float surfacePattern = smoothstep(-0.75, 0.75, bands * 0.52 + (n - 0.5) * 0.85 + (micro - 0.5) * 0.45);
          vec3 albedo = mix(uBaseColor * 0.52, uBaseColor * 1.22, surfacePattern);
          vec3 nightSide = uBaseColor * 0.14 + uAtmosphereColor * 0.18 * smoothstep(0.52, 0.76, micro);
          vec3 lit = mix(nightSide, albedo, day);
          lit += uAtmosphereColor * twilight * 0.36;
          lit += mix(uAtmosphereColor, vec3(1.0, 0.95, 0.88), 0.32) * fresnel * (0.48 + 0.52 * day);

          gl_FragColor = vec4(lit, uOpacity);
        }
      }
    `,
  });
}

export function createAccretionRingMaterial(color: string, accentColor: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uAccent: { value: new THREE.Color(accentColor) },
      uOpacity: { value: 0.75 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uAccent;
      uniform float uOpacity;

      void main() {
        float r = length(vUv);
        if (r < 0.32 || r > 1.0 || uOpacity < 0.004) discard;

        float normR = (r - 0.32) / 0.68;
        float angle = atan(vUv.y, vUv.x);

        float ring1 = sin(normR * 28.0 - uTime * 0.35) * 0.5 + 0.5;
        float ring2 = sin(normR * 64.0 + 1.4 + uTime * 0.5) * 0.5 + 0.5;
        float gap = smoothstep(0.06, 0.16, abs(normR - 0.52)) * smoothstep(0.04, 0.11, abs(normR - 0.76));
        // Differential Keplerian shear across ring bands
        float keplerOmega = 0.75 + 1.35 / (0.35 + normR);
        float azimuthal = 0.80 + 0.20 * sin(angle * 3.0 - uTime * keplerOmega + normR * 9.0);

        float envelope = smoothstep(0.0, 0.18, normR) * (1.0 - smoothstep(0.72, 1.0, normR));
        float density = envelope * gap * (0.35 + 0.45 * ring1 + 0.2 * ring2) * azimuthal;

        vec3 col = mix(uAccent, uColor, normR);
        gl_FragColor = vec4(col * density, clamp(density * uOpacity, 0.0, 0.85));
      }
    `,
  });
}
