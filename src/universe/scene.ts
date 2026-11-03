import * as THREE from 'three';
import {
  galaxies,
  deepFieldGalaxies,
  overview,
  type GalaxyPlacement,
  type SystemPlacement,
  type ContentPlacement,
  type Vec3,
} from './spatial';
import { regions, systems, contentById, type RegionId, type SystemId } from './semantic';
import {
  createCosmicSkyMaterial,
  createGalaxyVolumeMaterial,
  createStarfieldMaterial,
  createNebulaMaterial,
  createCelestialBodyMaterial,
  createAccretionRingMaterial,
} from './shaders';
import {
  createEpicyclicClusterMotion,
  createBarycentricReflexMotion,
  createKeplerPrecessingMotion,
  createResonantPerturbedMotion,
  type MotionLaw,
} from './motion';

type View = { galaxy?: RegionId; system?: SystemId; content?: string };
type TargetKind = 'galaxy' | 'system' | 'content';

interface SpatialTarget {
  kind: TargetKind;
  view: View;
  title: string;
  position: THREE.Vector3;
  labelOffset: THREE.Vector3;
  radius: number;
  label: HTMLButtonElement;
  distanceEl: HTMLElement;
  galaxyId: RegionId;
  systemId?: SystemId;
  contentId?: string;
}

interface RuntimeSatellite {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  orbitLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  motionLaw: MotionLaw;
  localPos: THREE.Vector3;
}

interface RuntimeBody {
  spec: ContentPlacement;
  isPrimary: boolean;
  pivot: THREE.Group;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  material: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  ringMesh?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  ringMaterial?: THREE.ShaderMaterial;
  orbitLine?: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  orbitGeom?: THREE.BufferGeometry;
  motionLaw: MotionLaw;
  localOrbitPos: THREE.Vector3;
  worldPosition: THREE.Vector3;
  satellites: RuntimeSatellite[];
  target: SpatialTarget;
}

interface RuntimeSystem {
  spec: SystemPlacement;
  galaxyId: RegionId;
  localDiskAnchor: THREE.Vector3;
  localDiskPos: THREE.Vector3;
  position: THREE.Vector3;
  motionLaw: MotionLaw;
  beacon: THREE.Sprite;
  clusterPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  clusterMaterial: THREE.ShaderMaterial;
  nurseryNebula: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  nurseryMaterial: THREE.ShaderMaterial;
  localGroup: THREE.Group;
  accretionPoints: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  accretionMaterial: THREE.ShaderMaterial;
  bodies: RuntimeBody[];
  target: SpatialTarget;
}

interface RuntimeGalaxy {
  spec: GalaxyPlacement;
  position: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
  currentQuaternion: THREE.Quaternion;
  diskNormal: THREE.Vector3;
  spinRate: number;
  group: THREE.Group;
  volumeMaterials: THREE.ShaderMaterial[];
  starMaterial: THREE.ShaderMaterial;
  nebulaMaterial: THREE.ShaderMaterial;
  dustMaterial: THREE.ShaderMaterial;
  streamMaterial: THREE.ShaderMaterial;
  coreGroup: THREE.Group;
  coreSprites: THREE.Sprite[];
  systems: RuntimeSystem[];
  target: SpatialTarget;
}

interface RayProbeResult {
  kind: 'body' | 'system' | 'galaxy-core' | 'galaxy-disk' | 'void';
  point: THREE.Vector3;
  center: THREE.Vector3;
  distance: number;
  closeness: number;
  standoff: number;
  target?: SpatialTarget;
  galaxyId?: RegionId;
  systemId?: SystemId;
  contentId?: string;
}

const vec3 = (p: Vec3) => new THREE.Vector3(...p);
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampVec3(current: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number) {
  const factor = 1 - Math.exp(-lambda * dt);
  current.lerp(target, factor);
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

// Converts a 3D unit look direction into (yaw, pitch) for Three.js 'YXZ' camera rotation order.
function lookAnglesFromDirection(dir: THREE.Vector3): { yaw: number; pitch: number } {
  const pitch = Math.asin(clamp(dir.y, -0.995, 0.995));
  const yaw = Math.atan2(-dir.x, -dir.z);
  return { yaw, pitch };
}

function directionFromAngles(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cosP = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
}

export function mountUniverse(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('#universe-canvas')!;
  const space = root.querySelector<HTMLElement>('#space')!;
  const labels = root.querySelector<HTMLElement>('#space-labels')!;
  labels.replaceChildren();

  const recenter = root.querySelector<HTMLButtonElement>('#recenter');
  const back = root.querySelector<HTMLButtonElement>('#back')!;
  const reset = root.querySelector<HTMLButtonElement>('#overview')!;
  const motion = root.querySelector<HTMLButtonElement>('#motion')!;
  const heading = root.querySelector<HTMLElement>('#target-name')!;
  const levelName = root.querySelector<HTMLElement>('#level-name')!;
  const description = root.querySelector<HTMLElement>('#target-description')!;
  const contentDescription = root.querySelector<HTMLElement>('#content-description')!;
  const contentLink = root.querySelector<HTMLAnchorElement>('#content-link')!;
  const hint = root.querySelector<HTMLElement>('#interaction-hint')!;
  const metrics = root.querySelector<HTMLOutputElement>('#universe-metrics')!;
  const scaleFill = root.querySelector<HTMLElement>('#scale-progress-fill');
  const scaleReadout = root.querySelector<HTMLElement>('#scale-readout');
  const scaleButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-scale-depth]'));

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let disposed = false;
  let frame = 0;
  let lastRender = 0;
  let elapsed = 0;

  // Derived semantic state (computed from camera 3D state, never locking the camera)
  let activeGalaxyId: RegionId = 'research';
  let activeSystemId: SystemId = 'learning';
  let activeContentId: string = 'deep-learning';
  let semanticLevel: 0 | 1 | 2 | 3 = 0;
  let effectiveDepth = 0;

  let hovered: SpatialTarget | undefined;
  let isDragging = false;
  let orbitBoundOnDrag = false;
  let dragMoved = false;
  let dragStartX = 0;
  let dragStartY = 0;
  const dragStartPointer = new THREE.Vector2(0, 0);

  const overviewTarget = vec3(overview.target);
  const overviewPos = overviewTarget.clone().add(vec3(overview.offset));
  const initialLookDir = overviewTarget.clone().sub(overviewPos).normalize();
  const initialAngles = lookAnglesFromDirection(initialLookDir);
  const initialDist = overviewPos.distanceTo(overviewTarget);

  // Focus-Centric 3D Orbital Camera + Active Target Tracking + Cursor-Anchored Ray Zoom State:
  // activeFocusTarget's live world position (updated every frame from galaxy spin + cluster drift +
  // planetary orbits, without local axial spin) acts as the moving origin of the camera reference frame.
  let activeFocusTarget: SpatialTarget | null = null;
  let lockedFocusTarget: SpatialTarget | null = null;

  const pivotLocalOffset = new THREE.Vector3(0, 0, 0);
  const targetPivotLocalOffset = new THREE.Vector3(0, 0, 0);

  let armRadius = initialDist;
  let targetArmRadius = initialDist;
  let armYaw = initialAngles.yaw;
  let targetArmYaw = initialAngles.yaw;
  let armPitch = initialAngles.pitch;
  let targetArmPitch = initialAngles.pitch;

  let gazeYaw = 0;
  let targetGazeYaw = 0;
  let gazePitch = 0;
  let targetGazePitch = 0;

  const livePivotPos = overviewTarget.clone();
  const targetPivotPos = overviewTarget.clone();
  const camBasePos = overviewPos.clone();
  const targetCamBasePos = overviewPos.clone();
  let camYaw = initialAngles.yaw;
  let camPitch = initialAngles.pitch;

  // Multi-layer damped pointer state for living universe parallax
  const pointer = new THREE.Vector2(0, 0);
  const smoothPointer = new THREE.Vector2(0, 0);
  const deepPointer = new THREE.Vector2(0, 0);
  const parallaxPosOffset = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const pointerTiltQuat = new THREE.Quaternion();
  const pointerTiltEuler = new THREE.Euler();

  const raycaster = new THREE.Raycaster();
  const projection = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const rayHit = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const tempVecA = new THREE.Vector3();
  const tempVecB = new THREE.Vector3();
  const tempVecC = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();

  let lastRaySummary = { kind: 'void', distance: 0, point: [0, 0, 0] as [number, number, number] };

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#030508');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.35, 5800);
  camera.rotation.order = 'YXZ';
  camera.position.copy(camBasePos);
  camera.rotation.set(camPitch, camYaw, 0, 'YXZ');
  camera.updateMatrixWorld();

  // Soft radial glow texture for core/corona sprites
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const ctx = glowCanvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, 'rgba(255, 252, 244, 1)');
  grad.addColorStop(0.12, 'rgba(255, 244, 222, 0.82)');
  grad.addColorStop(0.32, 'rgba(235, 218, 192, 0.28)');
  grad.addColorStop(0.65, 'rgba(180, 195, 190, 0.06)');
  grad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);

  const sphereGeometry = new THREE.SphereGeometry(1, 40, 28);
  const satelliteSphereGeometry = new THREE.SphereGeometry(1, 16, 12);
  const ringPlaneGeometry = new THREE.PlaneGeometry(1, 1);
  const diskSliceGeometry = new THREE.PlaneGeometry(1, 1, 28, 28);
  const allTargets: SpatialTarget[] = [];
  const animatedShaderMaterials: THREE.ShaderMaterial[] = [];

  function makeSprite(color: string, scale: number, opacity = 0.65): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      color,
      map: glowTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(scale);
    return s;
  }

  function registerTarget(
    kind: TargetKind,
    view: View,
    position: THREE.Vector3,
    labelOffset: THREE.Vector3,
    radius: number,
    indexCode: string,
    title: string,
    subtitle: string,
    galaxyId: RegionId,
    systemId?: SystemId,
    contentId?: string,
  ): SpatialTarget {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'space-label';
    label.dataset.kind = kind;

    const headerRow = document.createElement('span');
    headerRow.className = 'label-telemetry';
    const codeEl = document.createElement('span');
    codeEl.className = 'label-code';
    codeEl.textContent = indexCode;
    const distEl = document.createElement('span');
    distEl.className = 'label-distance';
    headerRow.append(codeEl, distEl);

    const name = document.createElement('strong');
    name.textContent = title;
    const meta = document.createElement('small');
    meta.textContent = subtitle;

    label.append(headerRow, name, meta);
    label.hidden = true;

    const target: SpatialTarget = {
      kind,
      view,
      title,
      position,
      labelOffset,
      radius,
      label,
      distanceEl: distEl,
      galaxyId,
      systemId,
      contentId,
    };

    label.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dragMoved) return;
      approachTarget3D(target);
    });
    label.addEventListener('pointerenter', () => {
      hovered = target;
    });
    label.addEventListener('pointerleave', () => {
      if (hovered === target) hovered = undefined;
    });
    label.addEventListener('focus', () => {
      hovered = target;
    });

    allTargets.push(target);
    labels.append(label);
    return target;
  }

  // 1. Cosmic Sky Dome (Deep Space Atmosphere & Negative Space)
  const skyMaterial = createCosmicSkyMaterial();
  animatedShaderMaterials.push(skyMaterial);
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(5200, 32, 20), skyMaterial);
  skyDome.renderOrder = -10;
  scene.add(skyDome);

  // 2. Multi-Shell Deep-Field Cosmic Starfield
  function buildDeepFieldStarfield(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = 4200;
    const rand = mulberry32(19);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const brights = new Float32Array(count);

    const palette = [
      new THREE.Color('#e8e4d8'),
      new THREE.Color('#f2d8b3'),
      new THREE.Color('#bfd6de'),
      new THREE.Color('#c8d4cb'),
      new THREE.Color('#dfb995'),
    ];

    for (let i = 0; i < count; i++) {
      const shell = i < 900 ? 0 : i < 2400 ? 1 : 2;
      const rMin = shell === 0 ? 780 : shell === 1 ? 1500 : 2600;
      const rMax = shell === 0 ? 1500 : shell === 1 ? 2600 : 4200;
      const r = rMin + Math.pow(rand(), 0.85) * (rMax - rMin);

      const theta = rand() * Math.PI * 2;
      const inBand = rand() < 0.45;
      const u = inBand ? (rand() - 0.5) * 0.55 : rand() * 2 - 1;
      const phi = Math.acos(clamp(u, -1, 1));

      const x = r * Math.sin(phi) * Math.cos(theta);
      let y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);
      if (inBand) {
        const tiltAngle = 0.34;
        y = y * Math.cos(tiltAngle) - x * Math.sin(tiltAngle) * 0.35;
      }

      positions.set([x, y, z], i * 3);

      const baseCol = palette[Math.floor(rand() * palette.length)].clone();
      const lum = 0.35 + Math.pow(rand(), 1.8) * 0.65;
      baseCol.multiplyScalar(lum);
      colors.set([baseCol.r, baseCol.g, baseCol.b], i * 3);

      const mag = Math.pow(rand(), 3.4);
      sizes[i] = 1.4 + mag * 7.5;
      phases[i] = rand();
      brights[i] = mag > 0.65 ? 0.55 + (mag - 0.65) * 1.25 : mag * 0.6;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geom.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));

    const mat = createStarfieldMaterial({
      pixelRatio: dpr,
      scale: 1.0,
      opacity: 0.82,
      nearFadeEnd: 40,
      nearFadeStart: 160,
      maxPointSize: 11,
      differentialOmega: 0.0035,
      epicycleAmp: 2.5,
    });
    animatedShaderMaterials.push(mat);
    return new THREE.Points(geom, mat);
  }
  const deepStars = buildDeepFieldStarfield();
  scene.add(deepStars);

  // 3. Distant Deep-Field Background Galaxies (Macro Scale Context)
  function buildDeepFieldGalaxies(): THREE.Group {
    const container = new THREE.Group();
    for (const spec of deepFieldGalaxies) {
      const rand = mulberry32(spec.seed);
      const g = new THREE.Group();
      g.position.set(...spec.position);
      g.rotation.set(...spec.tilt);

      const starCount = 650;
      const pos = new Float32Array(starCount * 3);
      const col = new Float32Array(starCount * 3);
      const sz = new Float32Array(starCount);
      const ph = new Float32Array(starCount);
      const br = new Float32Array(starCount);
      const cCore = new THREE.Color(spec.colorCore);
      const cArm = new THREE.Color(spec.colorArm);

      for (let i = 0; i < starCount; i++) {
        const u = Math.pow(rand(), 1.45);
        const r = u * spec.radius;
        const arm = i % 2;
        const angle = arm * Math.PI + u * 4.2 + (rand() - 0.5) * (0.45 + u * 0.7);
        const h = (rand() + rand() - 1) * spec.radius * 0.08 * (1 - u * 0.5);
        pos.set([Math.cos(angle) * r, h, Math.sin(angle) * r], i * 3);

        const c = cCore.clone().lerp(cArm, Math.pow(u, 0.7)).multiplyScalar(0.35 + rand() * 0.55);
        col.set([c.r, c.g, c.b], i * 3);
        sz[i] = 2.0 + (1 - u) * 3.8 * rand();
        ph[i] = rand();
        br[i] = (1 - u) * 0.5;
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geom.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
      geom.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      geom.setAttribute('aBright', new THREE.BufferAttribute(br, 1));

      const mat = createStarfieldMaterial({
        pixelRatio: dpr,
        scale: 1.0,
        opacity: 0.55,
        nearFadeEnd: 120,
        nearFadeStart: 400,
        maxPointSize: 7,
        differentialOmega: 0.045,
        epicycleAmp: 1.5,
      });
      animatedShaderMaterials.push(mat);
      g.add(new THREE.Points(geom, mat));

      const coreGlow = makeSprite(spec.colorCore, spec.radius * 0.85, 0.28);
      const haloGlow = makeSprite(spec.colorArm, spec.radius * 1.9, 0.12);
      g.add(coreGlow, haloGlow);
      container.add(g);
    }
    return container;
  }
  const backgroundGalaxies = buildDeepFieldGalaxies();
  scene.add(backgroundGalaxies);

  // 4. Intergalactic Filament Bridge between the two primary Galaxies
  function buildIntergalacticBridge(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
    const count = 820;
    const rand = mulberry32(404);
    const pA = vec3(galaxies[0].position);
    const pB = vec3(galaxies[1].position);
    const mid = pA.clone().lerp(pB, 0.5).add(new THREE.Vector3(0, 18, -55));
    const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    const ph = new Float32Array(count);
    const br = new Float32Array(count);

    const cA = new THREE.Color(galaxies[0].palette.outer);
    const cB = new THREE.Color(galaxies[1].palette.outer);

    for (let i = 0; i < count; i++) {
      const t = rand();
      const pt = curve.getPoint(t);
      const spread = (28 + Math.sin(t * Math.PI) * 58) * Math.pow(rand(), 0.65);
      const ang = rand() * Math.PI * 2;
      pos.set(
        [pt.x + Math.cos(ang) * spread, pt.y + Math.sin(ang) * spread * 0.55, pt.z + (rand() - 0.5) * spread],
        i * 3,
      );

      const c = cA.clone().lerp(cB, t).multiplyScalar(0.32 + rand() * 0.45);
      col.set([c.r, c.g, c.b], i * 3);
      sz[i] = 1.0 + rand() * 2.2;
      ph[i] = t;
      br[i] = 0.25;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
    geom.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    geom.setAttribute('aBright', new THREE.BufferAttribute(br, 1));

    const mat = createStarfieldMaterial({
      pixelRatio: dpr,
      scale: 0.9,
      opacity: 0.45,
      nearFadeEnd: 15,
      nearFadeStart: 60,
      maxPointSize: 6.5,
      epicycleAmp: 2.2,
      streamFlow: 1.0,
    });
    animatedShaderMaterials.push(mat);
    return new THREE.Points(geom, mat);
  }
  const intergalacticBridge = buildIntergalacticBridge();
  scene.add(intergalacticBridge);

  // Helper: create local orbiting satellites / moons around a primary star or companion planet
  function buildLocalSatellites(
    parentGroup: THREE.Group,
    parentRadius: number,
    isPrimaryParent: boolean,
    accentColor: string,
    seed: number,
  ): RuntimeSatellite[] {
    const satRand = mulberry32(seed);
    const count = isPrimaryParent ? 2 : 1;
    const satellites: RuntimeSatellite[] = [];

    for (let sIdx = 0; sIdx < count; sIdx++) {
      const satRadius = isPrimaryParent
        ? parentRadius * (0.085 + sIdx * 0.025)
        : parentRadius * 0.13;
      const semiMajor = isPrimaryParent
        ? parentRadius * (2.85 + sIdx * 0.95)
        : parentRadius * 2.45;
      const eccentricity = 0.08 + satRand() * 0.14;
      const inclination = (satRand() - 0.5) * 0.55 + (sIdx === 1 ? 0.34 : -0.20);
      const meanMotion = (isPrimaryParent ? 0.68 + sIdx * 0.32 : 1.15) * (satRand() > 0.3 ? 1 : -1);

      const motionLaw = createKeplerPrecessingMotion({
        semiMajorAxis: semiMajor,
        eccentricity,
        inclination,
        ascendingNode: satRand() * Math.PI * 2,
        argOfPeriapsis: satRand() * Math.PI * 2,
        meanMotion,
        initialMeanAnomaly: satRand() * Math.PI * 2,
        apsidalPrecessionRate: 0.08 * (sIdx % 2 === 0 ? 1 : -1),
        nodalPrecessionRate: -0.05,
      });

      const satColor = new THREE.Color(accentColor).lerp(new THREE.Color('#e6dfd3'), 0.35);
      const satMat = createCelestialBodyMaterial({
        baseColor: `#${satColor.getHexString()}`,
        atmosphereColor: accentColor,
        isPrimary: false,
        seed: seed + sIdx * 19,
      });
      animatedShaderMaterials.push(satMat);

      const mesh = new THREE.Mesh(satelliteSphereGeometry, satMat);
      mesh.scale.setScalar(satRadius);
      parentGroup.add(mesh);

      const halo = makeSprite(accentColor, satRadius * 3.8, 0);
      parentGroup.add(halo);

      const segments = 64;
      const initPts = motionLaw.sampleOrbitCurve!(0, segments);
      const oGeom = new THREE.BufferGeometry().setFromPoints(initPts);
      const oCols = new Float32Array((segments + 1) * 3);
      for (let n = 0; n <= segments; n++) {
        const wake = Math.pow(1 - n / segments, 2.6);
        const c = satColor.clone().multiplyScalar(0.18 + 0.82 * wake);
        oCols.set([c.r, c.g, c.b], n * 3);
      }
      oGeom.setAttribute('color', new THREE.BufferAttribute(oCols, 3));
      const oMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const orbitLine = new THREE.Line(oGeom, oMat);
      parentGroup.add(orbitLine);

      satellites.push({
        mesh,
        material: satMat,
        halo,
        orbitLine,
        motionLaw,
        localPos: new THREE.Vector3(),
      });
    }

    return satellites;
  }

  // 5. Build Volumetric Galaxies (`Research` = Barred Spiral, `Building` = Resonance Ring-Spiral)
  function buildGalaxy(spec: GalaxyPlacement, galaxyIndex: number): RuntimeGalaxy {
    const rand = mulberry32(spec.seed);
    const galaxyPos = vec3(spec.position);
    const galaxyEuler = new THREE.Euler(spec.tilt[0], spec.tilt[1], spec.tilt[2], 'XYZ');
    const baseQuat = new THREE.Quaternion().setFromEuler(galaxyEuler);
    const currentQuat = baseQuat.clone();
    const diskNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(baseQuat).normalize();
    const spinRate = spec.id === 'research' ? 0.0045 : -0.0055;

    const group = new THREE.Group();
    group.position.copy(galaxyPos);
    group.quaternion.copy(baseQuat);
    scene.add(group);

    const cCore = new THREE.Color(spec.palette.core);
    const cInner = new THREE.Color(spec.palette.inner);
    const cOuter = new THREE.Color(spec.palette.outer);
    const cNebula = new THREE.Color(spec.palette.nebula);
    const cAccent = new THREE.Color(spec.palette.accent);

    const R = spec.radius;
    const isRing = spec.morphology === 'ring-spiral';

    // Layer 0: 4-Slice 3D Volumetric Galaxy Continuum & Dust-Lane Shader Stack
    const normalizedKnots: [number, number][] = spec.systems.map((s) => [
      s.position[0] / (R * 1.06),
      s.position[2] / (R * 1.06),
    ]);
    const sliceOffsets = [-0.65, -0.18, 0.18, 0.65];
    const volumeMaterials: THREE.ShaderMaterial[] = [];

    for (const sliceNorm of sliceOffsets) {
      const volMat = createGalaxyVolumeMaterial({
        morphology: spec.morphology,
        armWind: spec.armWind,
        seed: spec.seed,
        coreColor: spec.palette.core,
        innerColor: spec.palette.inner,
        outerColor: spec.palette.outer,
        nebulaColor: spec.palette.nebula,
        accentColor: spec.palette.accent,
        sliceY: sliceNorm,
        knots: normalizedKnots,
      });
      animatedShaderMaterials.push(volMat);
      volumeMaterials.push(volMat);

      const sliceMesh = new THREE.Mesh(diskSliceGeometry, volMat);
      sliceMesh.rotation.x = -Math.PI / 2;
      sliceMesh.position.y = sliceNorm * R * spec.thickness * 0.95;
      sliceMesh.scale.setScalar(R * 2.12);
      sliceMesh.renderOrder = 0;
      group.add(sliceMesh);
    }

    function sampleGalaxyPoint(mode: 'star' | 'nebula' | 'dust', index: number) {
      const p = rand();
      let x = 0;
      let y = 0;
      let z = 0;
      let radialNorm = 0;
      let armProximity = 0.5;

      if (mode === 'star' && p < 0.24) {
        const u = Math.pow(rand(), 1.85);
        const r = u * spec.barRadius * 1.35;
        const barAngle = (rand() < 0.5 ? 0 : Math.PI) + (rand() - 0.5) * 0.75;
        const ellipX = Math.cos(barAngle) * r * 1.25;
        const ellipZ = Math.sin(barAngle) * r * 0.58;
        const ellipY = (rand() + rand() + rand() - 1.5) * R * spec.thickness * (0.95 - u * 0.45);
        x = ellipX;
        y = ellipY;
        z = ellipZ;
        radialNorm = clamp(r / R, 0, 1);
        armProximity = 0.9;
      } else if (isRing && p < (mode === 'dust' ? 0.68 : 0.62)) {
        const ringCenter = mode === 'dust' ? 0.48 : 0.37;
        const ringWidth = mode === 'dust' ? 0.075 : 0.095;
        const u = clamp(ringCenter + (rand() + rand() - 1) * ringWidth, 0.14, 0.95);
        const r = u * R;
        const angle = rand() * Math.PI * 2;
        const warp = Math.sin(angle * 2.0 + 0.4) * Math.pow(u, 1.8) * R * 0.045;
        const h = (rand() + rand() - 1) * R * spec.thickness * 0.48 + warp;
        x = Math.cos(angle) * r;
        y = h;
        z = Math.sin(angle) * r;
        radialNorm = u;
        armProximity = 0.85;
      } else if (mode === 'star' && p > 0.9) {
        const u = 0.25 + Math.pow(rand(), 0.75) * 0.95;
        const r = u * R * 1.12;
        const theta = rand() * Math.PI * 2;
        const v = (rand() + rand() - 1) * R * 0.34;
        x = Math.cos(theta) * r;
        y = v;
        z = Math.sin(theta) * r;
        radialNorm = clamp(u, 0, 1);
        armProximity = 0.2;
      } else {
        const totalArms = spec.arms;
        const isSpur = rand() < 0.28;
        const armIndex = index % totalArms;
        const u = isSpur ? 0.32 + Math.pow(rand(), 0.85) * 0.68 : 0.09 + Math.pow(rand(), 0.82) * 0.91;
        const r = u * R;

        const baseArmAngle =
          (armIndex * Math.PI * 2) / totalArms +
          Math.log(Math.max(u, 0.06)) * (spec.armWind * 0.5) +
          (isSpur ? 0.52 * (u - 0.25) : 0);

        const ridgeOffset =
          mode === 'dust'
            ? -0.14 - rand() * 0.14
            : mode === 'nebula'
              ? (rand() - 0.46) * (0.24 + u * 0.22)
              : (rand() + rand() + rand() - 1.5) * (0.22 + u * 0.34);

        const angle = baseArmAngle + ridgeOffset;
        const warp = Math.sin(angle + 0.5) * Math.pow(u, 2.1) * R * 0.085;
        const scaleHeight = R * spec.thickness * (0.32 + 0.68 * Math.pow(u, 1.35)) * (mode === 'dust' ? 0.42 : 0.72);
        const h = (rand() + rand() + rand() - 1.5) * scaleHeight + warp;

        x = Math.cos(angle) * r;
        y = h;
        z = Math.sin(angle) * r;
        radialNorm = u;
        armProximity = clamp(1 - Math.abs(ridgeOffset) * 2.2, 0.15, 1);
      }

      return { x, y, z, radialNorm, armProximity };
    }

    // Layer A: Multi-Population Galactic Stars with GPU Differential Rotation & Epicycles
    const baseStarCount = spec.id === 'research' ? 11500 : 8800;
    const knotStarsPerSystem = 380;
    const totalStars = baseStarCount + spec.systems.length * knotStarsPerSystem;

    const starPos = new Float32Array(totalStars * 3);
    const starCol = new Float32Array(totalStars * 3);
    const starSize = new Float32Array(totalStars);
    const starPhase = new Float32Array(totalStars);
    const starBright = new Float32Array(totalStars);

    for (let i = 0; i < baseStarCount; i++) {
      const pt = sampleGalaxyPoint('star', i);
      starPos.set([pt.x, pt.y, pt.z], i * 3);

      const tempMix = clamp(pt.radialNorm * 1.15 + (rand() - 0.5) * 0.22, 0, 1);
      const c =
        tempMix < 0.38
          ? cCore.clone().lerp(cInner, tempMix / 0.38)
          : cInner.clone().lerp(cOuter, (tempMix - 0.38) / 0.62);
      if (rand() < 0.18 * pt.armProximity) c.lerp(cAccent, 0.55);
      const lum = (0.42 + Math.pow(rand(), 1.5) * 0.58) * (1.14 - pt.radialNorm * 0.4);
      c.multiplyScalar(lum);
      starCol.set([c.r, c.g, c.b], i * 3);

      const mag = Math.pow(rand(), 3.6);
      starSize[i] = 1.25 + mag * 4.8 + (1 - pt.radialNorm) * 1.1;
      starPhase[i] = rand();
      starBright[i] = mag > 0.72 ? 0.55 + (mag - 0.72) * 1.5 : mag * 0.5;
    }

    spec.systems.forEach((sys, sIdx) => {
      const sysColor = new THREE.Color(sys.accentColor);
      const offsetBase = baseStarCount + sIdx * knotStarsPerSystem;
      for (let j = 0; j < knotStarsPerSystem; j++) {
        const idx = offsetBase + j;
        const r = Math.pow(rand(), 1.7) * sys.clusterRadius * 1.2;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(rand() * 2 - 1);
        const sx = sys.position[0] + r * Math.sin(phi) * Math.cos(theta);
        const sy = sys.position[1] + r * Math.cos(phi) * 0.58;
        const sz = sys.position[2] + r * Math.sin(phi) * Math.sin(theta);
        starPos.set([sx, sy, sz], idx * 3);

        const c = sysColor.clone().lerp(cCore, (1 - r / (sys.clusterRadius * 1.2)) * 0.68);
        c.multiplyScalar(0.58 + rand() * 0.52);
        starCol.set([c.r, c.g, c.b], idx * 3);

        const mag = Math.pow(rand(), 2.9);
        starSize[idx] = 1.35 + mag * 4.6;
        starPhase[idx] = rand();
        starBright[idx] = mag > 0.64 ? 0.6 + (mag - 0.64) * 1.1 : 0.35;
      }
    });

    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeom.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    starGeom.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeom.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));
    starGeom.setAttribute('aBright', new THREE.BufferAttribute(starBright, 1));

    const diffSign = spec.id === 'research' ? -1 : 1;
    const starMaterial = createStarfieldMaterial({
      pixelRatio: dpr,
      scale: 1.0,
      opacity: 0.96,
      nearFadeEnd: 2.2,
      nearFadeStart: 14.0,
      maxPointSize: 12.5,
      differentialOmega: diffSign * 0.082,
      epicycleAmp: 3.4,
    });
    animatedShaderMaterials.push(starMaterial);
    const starPoints = new THREE.Points(starGeom, starMaterial);
    starPoints.renderOrder = 2;
    group.add(starPoints);

    // Layer B: Subtle Outer Halo & Inter-Arm Filamentary Mist
    const dustCount = spec.id === 'research' ? 220 : 180;
    const dustPos = new Float32Array(dustCount * 3);
    const dustCol = new Float32Array(dustCount * 3);
    const dustSize = new Float32Array(dustCount);
    const dustRot = new Float32Array(dustCount);
    const dustSeed = new Float32Array(dustCount);
    const dustOp = new Float32Array(dustCount);

    for (let i = 0; i < dustCount; i++) {
      const pt = sampleGalaxyPoint('dust', i);
      dustPos.set([pt.x, pt.y, pt.z], i * 3);
      const mistCol = cOuter.clone().lerp(cNebula, 0.5).multiplyScalar(0.55);
      dustCol.set([mistCol.r, mistCol.g, mistCol.b], i * 3);
      dustSize[i] = (24 + rand() * 36) * (0.7 + pt.radialNorm * 0.5);
      dustRot[i] = rand() * Math.PI * 2;
      dustSeed[i] = rand() * 20;
      dustOp[i] = (0.045 + rand() * 0.045) * (1 - pt.radialNorm * 0.35);
    }

    const dustGeom = new THREE.BufferGeometry();
    dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeom.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
    dustGeom.setAttribute('aSize', new THREE.BufferAttribute(dustSize, 1));
    dustGeom.setAttribute('aRotation', new THREE.BufferAttribute(dustRot, 1));
    dustGeom.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
    dustGeom.setAttribute('aOpacity', new THREE.BufferAttribute(dustOp, 1));

    const dustMaterial = createNebulaMaterial({
      pixelRatio: dpr,
      isDarkDust: false,
      opacity: 0.75,
      nearFadeEnd: 24,
      nearFadeStart: 95,
      maxPointSize: 64,
      differentialOmega: diffSign * 0.055,
      driftAmp: 2.2,
    });
    animatedShaderMaterials.push(dustMaterial);
    const dustPoints = new THREE.Points(dustGeom, dustMaterial);
    dustPoints.renderOrder = 1;
    group.add(dustPoints);

    // Layer C: Volumetric Emission Nebulae & Spiral Arm Continuum
    const baseNebulaCount = spec.id === 'research' ? 460 : 360;
    const knotNebulaPerSys = 30;
    const nebulaCount = baseNebulaCount + spec.systems.length * knotNebulaPerSys;

    const nebPos = new Float32Array(nebulaCount * 3);
    const nebCol = new Float32Array(nebulaCount * 3);
    const nebSize = new Float32Array(nebulaCount);
    const nebRot = new Float32Array(nebulaCount);
    const nebSeed = new Float32Array(nebulaCount);
    const nebOp = new Float32Array(nebulaCount);

    for (let i = 0; i < baseNebulaCount; i++) {
      const isCoreCloud = i < 55;
      if (isCoreCloud) {
        const u = Math.pow(rand(), 1.7);
        const r = u * spec.barRadius * 1.15;
        const ang = rand() * Math.PI * 2;
        nebPos.set(
          [Math.cos(ang) * r * 1.15, (rand() - 0.5) * R * spec.thickness * 0.7, Math.sin(ang) * r * 0.68],
          i * 3,
        );
        const c = cCore.clone().lerp(cInner, u * 0.75);
        nebCol.set([c.r, c.g, c.b], i * 3);
        nebSize[i] = 28 + (1 - u) * 42;
        nebOp[i] = 0.14 + (1 - u) * 0.12;
      } else {
        const pt = sampleGalaxyPoint('nebula', i);
        nebPos.set([pt.x, pt.y, pt.z], i * 3);
        const c =
          pt.radialNorm < 0.42
            ? cInner.clone().lerp(cNebula, pt.radialNorm / 0.42)
            : cNebula.clone().lerp(cOuter, (pt.radialNorm - 0.42) / 0.58);
        if (rand() < 0.25) c.lerp(cAccent, 0.45);
        nebCol.set([c.r, c.g, c.b], i * 3);
        nebSize[i] = 26 + rand() * 44;
        nebOp[i] = (0.085 + rand() * 0.085) * (1.05 - pt.radialNorm * 0.45);
      }
      nebRot[i] = rand() * Math.PI * 2;
      nebSeed[i] = rand() * 30;
    }

    spec.systems.forEach((sys, sIdx) => {
      const sysCol = new THREE.Color(sys.accentColor).lerp(cNebula, 0.35);
      const base = baseNebulaCount + sIdx * knotNebulaPerSys;
      for (let j = 0; j < knotNebulaPerSys; j++) {
        const idx = base + j;
        const r = Math.pow(rand(), 1.3) * sys.clusterRadius * 0.92;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(rand() * 2 - 1);
        nebPos.set(
          [
            sys.position[0] + r * Math.sin(phi) * Math.cos(theta),
            sys.position[1] + r * Math.cos(phi) * 0.55,
            sys.position[2] + r * Math.sin(phi) * Math.sin(theta),
          ],
          idx * 3,
        );
        const c = sysCol.clone().lerp(cCore, (1 - r / sys.clusterRadius) * 0.45);
        nebCol.set([c.r, c.g, c.b], idx * 3);
        nebSize[idx] = 18 + rand() * 26;
        nebRot[idx] = rand() * Math.PI * 2;
        nebSeed[idx] = rand() * 30;
        nebOp[idx] = 0.11 + rand() * 0.08;
      }
    });

    const nebGeom = new THREE.BufferGeometry();
    nebGeom.setAttribute('position', new THREE.BufferAttribute(nebPos, 3));
    nebGeom.setAttribute('color', new THREE.BufferAttribute(nebCol, 3));
    nebGeom.setAttribute('aSize', new THREE.BufferAttribute(nebSize, 1));
    nebGeom.setAttribute('aRotation', new THREE.BufferAttribute(nebRot, 1));
    nebGeom.setAttribute('aSeed', new THREE.BufferAttribute(nebSeed, 1));
    nebGeom.setAttribute('aOpacity', new THREE.BufferAttribute(nebOp, 1));

    const nebulaMaterial = createNebulaMaterial({
      pixelRatio: dpr,
      isDarkDust: false,
      opacity: 0.96,
      nearFadeEnd: 18,
      nearFadeStart: 75,
      maxPointSize: 64,
      differentialOmega: diffSign * 0.068,
      driftAmp: 2.8,
    });
    animatedShaderMaterials.push(nebulaMaterial);
    const nebulaPoints = new THREE.Points(nebGeom, nebulaMaterial);
    nebulaPoints.renderOrder = 3;
    group.add(nebulaPoints);

    // Layer D: Curved Inter-System Stellar Streams inside the Galaxy
    const sysMap = new Map(spec.systems.map((s) => [s.id, s]));
    const streamPairs: [SystemPlacement, SystemPlacement][] = [];
    const seenPairs = new Set<string>();
    for (const s of spec.systems) {
      for (const connId of s.connections) {
        const other = sysMap.get(connId);
        if (!other) continue;
        const key = [s.id, other.id].sort().join('--');
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          streamPairs.push([s, other]);
        }
      }
    }

    const starsPerStream = 220;
    const streamTotal = streamPairs.length * starsPerStream;
    const stPos = new Float32Array(streamTotal * 3);
    const stCol = new Float32Array(streamTotal * 3);
    const stSize = new Float32Array(streamTotal);
    const stPhase = new Float32Array(streamTotal);
    const stBright = new Float32Array(streamTotal);

    streamPairs.forEach(([sA, sB], pairIdx) => {
      const pA = vec3(sA.position);
      const pB = vec3(sB.position);
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      mid.multiplyScalar(0.82);
      mid.y += (rand() - 0.5) * 14;
      const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);
      const colA = new THREE.Color(sA.accentColor);
      const colB = new THREE.Color(sB.accentColor);

      for (let k = 0; k < starsPerStream; k++) {
        const idx = pairIdx * starsPerStream + k;
        const t = rand();
        const pt = curve.getPoint(t);
        const tube = (1.8 + Math.sin(t * Math.PI) * 5.5) * Math.pow(rand(), 0.7);
        const ang = rand() * Math.PI * 2;
        stPos.set(
          [pt.x + Math.cos(ang) * tube, pt.y + Math.sin(ang) * tube * 0.5, pt.z + (rand() - 0.5) * tube],
          idx * 3,
        );
        const c = colA.clone().lerp(colB, t).multiplyScalar(0.45 + rand() * 0.45);
        stCol.set([c.r, c.g, c.b], idx * 3);
        stSize[idx] = 1.1 + rand() * 2.0;
        stPhase[idx] = t;
        stBright[idx] = 0.25;
      }
    });

    const streamGeom = new THREE.BufferGeometry();
    streamGeom.setAttribute('position', new THREE.BufferAttribute(stPos, 3));
    streamGeom.setAttribute('color', new THREE.BufferAttribute(stCol, 3));
    streamGeom.setAttribute('aSize', new THREE.BufferAttribute(stSize, 1));
    streamGeom.setAttribute('aPhase', new THREE.BufferAttribute(stPhase, 1));
    streamGeom.setAttribute('aBright', new THREE.BufferAttribute(stBright, 1));

    const streamMaterial = createStarfieldMaterial({
      pixelRatio: dpr,
      scale: 0.9,
      opacity: 0.75,
      nearFadeEnd: 2.0,
      nearFadeStart: 10.0,
      maxPointSize: 9,
      differentialOmega: diffSign * 0.052,
      epicycleAmp: 1.8,
      streamFlow: 1.0,
    });
    animatedShaderMaterials.push(streamMaterial);
    group.add(new THREE.Points(streamGeom, streamMaterial));

    // Layer E: Multi-Shell Volumetric Galactic Nucleus
    const coreGroup = new THREE.Group();
    const coreInner = makeSprite(spec.palette.core, 24, 0.52);
    const coreMid = makeSprite(spec.palette.inner, 74, 0.34);
    const coreWide = makeSprite(spec.palette.nebula, 165, 0.18);
    coreGroup.add(coreInner, coreMid, coreWide);
    group.add(coreGroup);

    const galaxyLabelOffset = new THREE.Vector3(
      spec.id === 'research' ? -18 : 18,
      spec.radius * 0.32,
      spec.radius * 0.1,
    );
    const galaxyTarget = registerTarget(
      'galaxy',
      { galaxy: spec.id },
      galaxyPos.clone(),
      galaxyLabelOffset,
      spec.radius * 0.72,
      `0${galaxyIndex + 1} // GALAXY`,
      regions[spec.id].title,
      `${spec.systems.length} stellar regions · ${spec.morphology === 'barred-spiral' ? 'barred spiral' : 'resonance ring'}`,
      spec.id,
    );

    // Layer F: Embedded Stellar Systems with Meso-Scale Epicyclic Drift & Internal Orbital Hierarchy
    const runtimeSystems: RuntimeSystem[] = spec.systems.map((sysSpec, sysIndex) => {
      const localSysAnchor = vec3(sysSpec.position);
      const localSysPos = localSysAnchor.clone();
      const worldSysPos = localSysPos.clone().applyQuaternion(baseQuat).add(galaxyPos);

      const sysMotionLaw = createEpicyclicClusterMotion({
        anchor: localSysAnchor,
        radialAmplitude: 2.2 + (sysIndex % 3) * 0.65,
        verticalAmplitude: 1.2 + (sysIndex % 2) * 0.45,
        epicycleFreq: 0.24 + sysIndex * 0.038,
        verticalFreq: 0.33 + sysIndex * 0.042,
        differentialDriftRate: (diffSign * 0.0042) / (1 + Math.hypot(localSysAnchor.x, localSysAnchor.z) * 0.012),
        phase: sysIndex * 1.41 + galaxyIndex * 2.3,
      });

      const beacon = makeSprite(sysSpec.accentColor, 16, 0.72);
      beacon.position.copy(worldSysPos);
      scene.add(beacon);

      const localGroup = new THREE.Group();
      localGroup.position.copy(worldSysPos);
      scene.add(localGroup);

      const sysRand = mulberry32(spec.seed * 100 + sysIndex * 37);

      const cCount = 260;
      const cPos = new Float32Array(cCount * 3);
      const cCol = new Float32Array(cCount * 3);
      const cSize = new Float32Array(cCount);
      const cPhase = new Float32Array(cCount);
      const cBright = new Float32Array(cCount);
      const sysAccent = new THREE.Color(sysSpec.accentColor);

      for (let i = 0; i < cCount; i++) {
        const r = 2.8 + Math.pow(sysRand(), 1.5) * (sysSpec.clusterRadius * 0.9);
        const th = sysRand() * Math.PI * 2;
        const ph = Math.acos(sysRand() * 2 - 1);
        cPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.58, r * Math.sin(ph) * Math.sin(th)], i * 3);
        const col = sysAccent.clone().lerp(cCore, (1 - r / sysSpec.clusterRadius) * 0.5).multiplyScalar(0.5 + sysRand() * 0.5);
        cCol.set([col.r, col.g, col.b], i * 3);
        cSize[i] = 0.85 + Math.pow(sysRand(), 2.2) * 2.2;
        cPhase[i] = sysRand();
        cBright[i] = sysRand() * 0.5;
      }

      const cGeom = new THREE.BufferGeometry();
      cGeom.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
      cGeom.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
      cGeom.setAttribute('aSize', new THREE.BufferAttribute(cSize, 1));
      cGeom.setAttribute('aPhase', new THREE.BufferAttribute(cPhase, 1));
      cGeom.setAttribute('aBright', new THREE.BufferAttribute(cBright, 1));

      const clusterMaterial = createStarfieldMaterial({
        pixelRatio: dpr,
        scale: 0.68,
        opacity: 0.85,
        nearFadeEnd: 1.2,
        nearFadeStart: 5.5,
        maxPointSize: 9.5,
        differentialOmega: 0.36 * (sysIndex % 2 === 0 ? 1 : -1),
        epicycleAmp: 0.95,
      });
      animatedShaderMaterials.push(clusterMaterial);
      const clusterPoints = new THREE.Points(cGeom, clusterMaterial);
      localGroup.add(clusterPoints);

      const nCount = 24;
      const nPos = new Float32Array(nCount * 3);
      const nCol = new Float32Array(nCount * 3);
      const nSize = new Float32Array(nCount);
      const nRot = new Float32Array(nCount);
      const nSeed = new Float32Array(nCount);
      const nOp = new Float32Array(nCount);

      for (let i = 0; i < nCount; i++) {
        const r = 3.0 + Math.pow(sysRand(), 1.2) * (sysSpec.clusterRadius * 0.65);
        const th = sysRand() * Math.PI * 2;
        const ph = Math.acos(sysRand() * 2 - 1);
        nPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.45, r * Math.sin(ph) * Math.sin(th)], i * 3);
        const col = sysAccent.clone().lerp(cNebula, 0.45);
        nCol.set([col.r, col.g, col.b], i * 3);
        nSize[i] = 10.0 + sysRand() * 16.0;
        nRot[i] = sysRand() * Math.PI * 2;
        nSeed[i] = sysRand() * 25;
        nOp[i] = 0.1 + sysRand() * 0.08;
      }

      const nGeom = new THREE.BufferGeometry();
      nGeom.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
      nGeom.setAttribute('color', new THREE.BufferAttribute(nCol, 3));
      nGeom.setAttribute('aSize', new THREE.BufferAttribute(nSize, 1));
      nGeom.setAttribute('aRotation', new THREE.BufferAttribute(nRot, 1));
      nGeom.setAttribute('aSeed', new THREE.BufferAttribute(nSeed, 1));
      nGeom.setAttribute('aOpacity', new THREE.BufferAttribute(nOp, 1));

      const nurseryMaterial = createNebulaMaterial({
        pixelRatio: dpr,
        isDarkDust: false,
        opacity: 0.88,
        nearFadeEnd: 4.5,
        nearFadeStart: 22.0,
        maxPointSize: 64,
        differentialOmega: 0.24 * (sysIndex % 2 === 0 ? 1 : -1),
        driftAmp: 1.15,
      });
      animatedShaderMaterials.push(nurseryMaterial);
      const nurseryNebula = new THREE.Points(nGeom, nurseryMaterial);
      localGroup.add(nurseryNebula);

      // Orbiting Accretion / Protoplanetary Particle Disk around the system center
      const accCount = 580;
      const accPos = new Float32Array(accCount * 3);
      const accCol = new Float32Array(accCount * 3);
      const accSize = new Float32Array(accCount);
      const accPhase = new Float32Array(accCount);
      const accBright = new Float32Array(accCount);

      for (let i = 0; i < accCount; i++) {
        const isInnerDisk = i < 380;
        const r = isInnerDisk ? 2.1 + Math.pow(sysRand(), 1.3) * 3.8 : 5.8 + sysRand() * 7.5;
        const ang = sysRand() * Math.PI * 2;
        const h = (sysRand() - 0.5) * (isInnerDisk ? 0.18 : 0.65);
        accPos.set([Math.cos(ang) * r, h, Math.sin(ang) * r], i * 3);
        const col = isInnerDisk
          ? cCore.clone().lerp(sysAccent, (r - 2.1) / 3.8)
          : sysAccent.clone().lerp(cOuter, (r - 5.8) / 7.5).multiplyScalar(0.75);
        accCol.set([col.r, col.g, col.b], i * 3);
        accSize[i] = isInnerDisk ? 0.42 + sysRand() * 0.65 : 0.5 + sysRand() * 0.85;
        accPhase[i] = sysRand();
        accBright[i] = isInnerDisk ? 0.45 : 0.25;
      }

      const accGeom = new THREE.BufferGeometry();
      accGeom.setAttribute('position', new THREE.BufferAttribute(accPos, 3));
      accGeom.setAttribute('color', new THREE.BufferAttribute(accCol, 3));
      accGeom.setAttribute('aSize', new THREE.BufferAttribute(accSize, 1));
      accGeom.setAttribute('aPhase', new THREE.BufferAttribute(accPhase, 1));
      accGeom.setAttribute('aBright', new THREE.BufferAttribute(accBright, 1));

      const accretionMaterial = createStarfieldMaterial({
        pixelRatio: dpr,
        scale: 0.4,
        opacity: 0,
        nearFadeEnd: 0.5,
        nearFadeStart: 2.5,
        maxPointSize: 8.5,
        differentialOmega: 1.25,
        epicycleAmp: 0.32,
      });
      animatedShaderMaterials.push(accretionMaterial);
      const accretionPoints = new THREE.Points(accGeom, accretionMaterial);
      accretionPoints.rotation.set(0.18, 0, -0.12);
      localGroup.add(accretionPoints);

      // Celestial Bodies (Primary Star/Core + Orbiting Companion Content Worlds + Local Moons)
      const isMultiBodyResonant = sysSpec.contents.length >= 3 || sysIndex % 2 === 1;
      const runtimeBodies: RuntimeBody[] = sysSpec.contents.map((bodySpec, bIndex) => {
        const isPrimary = bIndex === 0;
        const pivot = new THREE.Group();
        localGroup.add(pivot);

        const basePosVec = vec3(bodySpec.position);
        const baseOrbitRadius = Math.max(5.8, basePosVec.length());
        const initAngle = Math.atan2(basePosVec.z, basePosVec.x);

        let bodyMotionLaw: MotionLaw;
        if (isPrimary) {
          bodyMotionLaw = createBarycentricReflexMotion({
            amplitude: 0.22,
            primaryFreq: 0.36 + sysIndex * 0.05,
            secondaryFreq: 0.64 + sysIndex * 0.04,
            phase: sysIndex * 1.1,
          });
        } else if (isMultiBodyResonant) {
          bodyMotionLaw = createResonantPerturbedMotion({
            semiMajorAxis: baseOrbitRadius,
            eccentricity: 0.16 + (bIndex % 2) * 0.06,
            inclination: bodySpec.orbitInclination * 1.35,
            ascendingNode: sysIndex * 0.8 + bIndex * 1.2,
            argOfPeriapsis: initAngle,
            meanMotion: (bodySpec.orbitSpeed * 2.35) * (bIndex % 2 === 1 ? 1 : -0.88),
            initialMeanAnomaly: initAngle,
            apsidalPrecessionRate: 0.032 * (bIndex % 2 === 1 ? 1 : -1),
            nodalPrecessionRate: -0.018,
            perturbationAmplitude: 0.58 + bIndex * 0.18,
            resonanceRatio: bIndex === 1 ? 1.618 : 2.25,
            perturbationPhase: sysIndex * 0.9 + bIndex * 1.7,
          });
        } else {
          bodyMotionLaw = createKeplerPrecessingMotion({
            semiMajorAxis: baseOrbitRadius,
            eccentricity: 0.14 + sysIndex * 0.015,
            inclination: bodySpec.orbitInclination * 1.25,
            ascendingNode: sysIndex * 0.65,
            argOfPeriapsis: initAngle,
            meanMotion: bodySpec.orbitSpeed * 2.25,
            initialMeanAnomaly: initAngle,
            apsidalPrecessionRate: 0.026,
            nodalPrecessionRate: -0.015,
          });
        }

        const localOrbitPos = new THREE.Vector3();
        bodyMotionLaw.evaluate(0, 0, localOrbitPos);

        const bodyMaterial = createCelestialBodyMaterial({
          baseColor: bodySpec.color,
          atmosphereColor: bodySpec.atmosphereColor,
          isPrimary,
          seed: spec.seed + sysIndex * 11 + bIndex * 7,
        });
        bodyMaterial.uniforms.uSystemCenter.value.copy(worldSysPos);
        animatedShaderMaterials.push(bodyMaterial);

        const mesh = new THREE.Mesh(sphereGeometry, bodyMaterial);
        mesh.scale.setScalar(bodySpec.radius);
        pivot.position.copy(localOrbitPos);
        pivot.add(mesh);

        const bodyHalo = makeSprite(
          isPrimary ? bodySpec.color : bodySpec.atmosphereColor,
          bodySpec.radius * (isPrimary ? 5.6 : 4.2),
          0,
        );
        pivot.add(bodyHalo);

        let ringMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
        let ringMaterial: THREE.ShaderMaterial | undefined;
        if (bodySpec.hasRings) {
          ringMaterial = createAccretionRingMaterial(bodySpec.atmosphereColor, bodySpec.color);
          animatedShaderMaterials.push(ringMaterial);
          ringMesh = new THREE.Mesh(ringPlaneGeometry, ringMaterial);
          const ringScale = bodySpec.radius * (isPrimary ? 5.2 : 3.8);
          ringMesh.scale.setScalar(ringScale);
          ringMesh.rotation.x = Math.PI * 0.44;
          ringMesh.rotation.y = 0.22;
          pivot.add(ringMesh);
        }

        let orbitLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | undefined;
        let orbitGeom: THREE.BufferGeometry | undefined;
        if (!isPrimary && bodyMotionLaw.sampleOrbitCurve) {
          const segments = 128;
          const oPts = bodyMotionLaw.sampleOrbitCurve(0, segments);
          const oCols = new Float32Array((segments + 1) * 3);
          const wakeCol = new THREE.Color(bodySpec.atmosphereColor);
          const dimCol = new THREE.Color(sysSpec.accentColor).multiplyScalar(0.26);

          for (let n = 0; n <= segments; n++) {
            const frac = n / segments;
            const wake = Math.pow(1 - frac, 3.0);
            const c = dimCol.clone().lerp(wakeCol, wake);
            oCols.set([c.r, c.g, c.b], n * 3);
          }
          orbitGeom = new THREE.BufferGeometry().setFromPoints(oPts);
          orbitGeom.setAttribute('color', new THREE.BufferAttribute(oCols, 3));
          const oMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          });
          orbitLine = new THREE.Line(orbitGeom, oMat);
          localGroup.add(orbitLine);
        }

        const satellites = buildLocalSatellites(
          pivot,
          bodySpec.radius,
          isPrimary,
          bodySpec.atmosphereColor,
          spec.seed * 31 + sysIndex * 17 + bIndex * 13,
        );

        const worldPos = worldSysPos.clone().add(localOrbitPos);
        const content = contentById[bodySpec.contentId];
        const bodyLabelOffset = isPrimary
          ? new THREE.Vector3(-bodySpec.radius * 1.2, bodySpec.radius * 1.75 + 0.75, 0)
          : new THREE.Vector3(
              bodySpec.radius * (bIndex % 2 === 1 ? 1.15 : -1.15),
              bodySpec.radius * 1.55 + (bIndex === 2 ? -1.4 : 0.65),
              0,
            );
        const bodyTarget = registerTarget(
          'content',
          { galaxy: spec.id, system: sysSpec.id, content: bodySpec.contentId },
          worldPos,
          bodyLabelOffset,
          bodySpec.radius * 2.1,
          `0${bIndex + 1} // ${content.kind.toUpperCase()}`,
          content.title,
          content.status ? `${content.kind} · ${content.status}` : content.kind,
          spec.id,
          sysSpec.id,
          bodySpec.contentId,
        );

        return {
          spec: bodySpec,
          isPrimary,
          pivot,
          mesh,
          material: bodyMaterial,
          halo: bodyHalo,
          ringMesh,
          ringMaterial,
          orbitLine,
          orbitGeom,
          motionLaw: bodyMotionLaw,
          localOrbitPos,
          worldPosition: worldPos,
          satellites,
          target: bodyTarget,
        };
      });

      const sysTarget = registerTarget(
        'system',
        { galaxy: spec.id, system: sysSpec.id },
        worldSysPos.clone(),
        new THREE.Vector3(0, 5.2, 0),
        12.5,
        `SYS 0${sysIndex + 1}`,
        systems[sysSpec.id].title,
        `${sysSpec.contents.length} celestial bodies`,
        spec.id,
        sysSpec.id,
      );

      return {
        spec: sysSpec,
        galaxyId: spec.id,
        localDiskAnchor: localSysAnchor,
        localDiskPos: localSysPos,
        position: worldSysPos,
        motionLaw: sysMotionLaw,
        beacon,
        clusterPoints,
        clusterMaterial,
        nurseryNebula,
        nurseryMaterial,
        localGroup,
        accretionPoints,
        accretionMaterial,
        bodies: runtimeBodies,
        target: sysTarget,
      };
    });

    return {
      spec,
      position: galaxyPos,
      baseQuaternion: baseQuat,
      currentQuaternion: currentQuat,
      diskNormal,
      spinRate,
      group,
      volumeMaterials,
      starMaterial,
      nebulaMaterial,
      dustMaterial,
      streamMaterial,
      coreGroup,
      coreSprites: [coreInner, coreMid, coreWide],
      systems: runtimeSystems,
      target: galaxyTarget,
    };
  }

  const runtimeGalaxies: RuntimeGalaxy[] = galaxies.map((g, idx) => buildGalaxy(g, idx));

  function getActiveChain() {
    const galaxy = runtimeGalaxies.find((g) => g.spec.id === activeGalaxyId) ?? runtimeGalaxies[0];
    const system = galaxy.systems.find((s) => s.spec.id === activeSystemId) ?? galaxy.systems[0];
    const body = system.bodies.find((b) => b.spec.contentId === activeContentId) ?? system.bodies[0];
    return { galaxy, system, body };
  }

  // Evaluate what spatial structure (if any) lies along a 3D world-space ray from the camera through the cursor.
  function probeSpatialRay(origin: THREE.Vector3, rayDir: THREE.Vector3): RayProbeResult {
    // 1. Check Celestial Content Bodies
    let bestBody: { body: RuntimeBody; sys: RuntimeSystem; s: number; closeness: number } | undefined;
    for (const g of runtimeGalaxies) {
      for (const sys of g.systems) {
        const sysCamDist = sys.position.distanceTo(origin);
        if (sysCamDist > 260) continue;
        for (const body of sys.bodies) {
          tempVecA.subVectors(body.worldPosition, origin);
          const s = tempVecA.dot(rayDir);
          if (s <= 0.4 || s > 240) continue;
          const bSq = Math.max(0, tempVecA.lengthSq() - s * s);
          const b = Math.sqrt(bSq);
          const captureR = Math.max(body.spec.radius * 3.1, s * 0.058);
          if (b < captureR) {
            const closeness = 1 - b / captureR;
            if (!bestBody || s < bestBody.s) {
              bestBody = { body, sys, s, closeness };
            }
          }
        }
      }
    }
    if (bestBody) {
      const { body, sys, s, closeness } = bestBody;
      return {
        kind: 'body',
        point: origin.clone().addScaledVector(rayDir, s),
        center: body.worldPosition.clone(),
        distance: s,
        closeness,
        standoff: Math.max(3.6, body.spec.radius * 3.1),
        target: body.target,
        galaxyId: sys.galaxyId,
        systemId: sys.spec.id,
        contentId: body.spec.contentId,
      };
    }

    // 2. If ray is aimed directly at a Galaxy Core from medium/far range, prioritize the Galactic Nucleus
    for (const g of runtimeGalaxies) {
      tempVecA.subVectors(g.position, origin);
      const sCenter = tempVecA.dot(rayDir);
      if (sCenter > 40) {
        const bSq = Math.max(0, tempVecA.lengthSq() - sCenter * sCenter);
        const b = Math.sqrt(bSq);
        const coreCapture = g.spec.barRadius * 0.62;
        if (b < coreCapture) {
          return {
            kind: 'galaxy-core',
            point: g.position.clone(),
            center: g.position.clone(),
            distance: sCenter,
            closeness: 1 - b / coreCapture,
            standoff: 36,
            target: g.target,
            galaxyId: g.spec.id,
          };
        }
      }
    }

    // 3. Check Stellar Systems (when camera is outside immediate system interior)
    let bestSys: { sys: RuntimeSystem; s: number; closeness: number } | undefined;
    for (const g of runtimeGalaxies) {
      for (const sys of g.systems) {
        tempVecA.subVectors(sys.position, origin);
        const s = tempVecA.dot(rayDir);
        if (s <= 24 || s > 720) continue;
        const bSq = Math.max(0, tempVecA.lengthSq() - s * s);
        const b = Math.sqrt(bSq);
        const captureR = Math.min(28, Math.max(sys.spec.clusterRadius * 0.92, s * 0.042));
        if (b < captureR) {
          const closeness = 1 - b / captureR;
          if (!bestSys || closeness > bestSys.closeness) {
            bestSys = { sys, s, closeness };
          }
        }
      }
    }
    if (bestSys) {
      const { sys, s, closeness } = bestSys;
      return {
        kind: 'system',
        point: origin.clone().addScaledVector(rayDir, s),
        center: sys.position.clone(),
        distance: s,
        closeness,
        standoff: 24,
        target: sys.target,
        galaxyId: sys.galaxyId,
        systemId: sys.spec.id,
      };
    }

    // 4. Check 3D Galaxy Disk & Rim Intersection
    let bestGalHit: RayProbeResult | undefined;
    for (const g of runtimeGalaxies) {
      tempVecA.subVectors(g.position, origin);
      const sCenter = tempVecA.dot(rayDir);
      if (sCenter <= 2.0) continue;

      const denom = rayDir.dot(g.diskNormal);
      let hitPoint: THREE.Vector3 | undefined;
      let hitDist = sCenter;
      let diskR = Infinity;

      if (Math.abs(denom) > 0.045) {
        const sPlane = tempVecA.dot(g.diskNormal) / denom;
        if (sPlane > 4.0 && sPlane < 1800) {
          const pt = origin.clone().addScaledVector(rayDir, sPlane);
          const rOnPlane = pt.distanceTo(g.position);
          if (rOnPlane <= g.spec.radius * 1.08) {
            hitPoint = pt;
            hitDist = sPlane;
            diskR = rOnPlane;
          }
        }
      }

      if (!hitPoint) {
        const bSq = Math.max(0, tempVecA.lengthSq() - sCenter * sCenter);
        const b = Math.sqrt(bSq);
        if (b <= g.spec.radius * 1.04) {
          hitPoint = origin.clone().addScaledVector(rayDir, sCenter);
          hitDist = sCenter;
          diskR = b;
        }
      }

      if (hitPoint && (!bestGalHit || hitDist < bestGalHit.distance)) {
        const isCore = diskR < g.spec.barRadius * 0.72;
        bestGalHit = {
          kind: isCore ? 'galaxy-core' : 'galaxy-disk',
          point: hitPoint,
          center: isCore ? g.position.clone() : hitPoint.clone(),
          distance: hitDist,
          closeness: 1 - clamp(diskR / (g.spec.radius * 1.08), 0, 1),
          standoff: isCore ? 38 : 24,
          target: g.target,
          galaxyId: g.spec.id,
        };
      }
    }
    if (bestGalHit) return bestGalHit;

    // 4. Open Void (Cursor points at empty intergalactic or interstellar space)
    let nearestDist = Infinity;
    for (const g of runtimeGalaxies) {
      const d = g.position.distanceTo(origin);
      if (d < nearestDist) nearestDist = d;
      for (const s of g.systems) {
        const ds = s.position.distanceTo(origin);
        if (ds < nearestDist) nearestDist = ds;
      }
    }
    const voidCruiseScale = clamp(nearestDist * 0.85, 32, 460);
    return {
      kind: 'void',
      point: origin.clone().addScaledVector(rayDir, voidCruiseScale),
      center: origin.clone().addScaledVector(rayDir, voidCruiseScale),
      distance: voidCruiseScale,
      closeness: 0,
      standoff: 0,
    };
  }

  // Derive semantic level (Universe / Galaxy / System / Content) purely from the camera's 3D state.
  // Never moves or constrains the camera.
  function deriveSemanticStateFromCamera() {
    camera.getWorldDirection(camForward);

    let bestGal = runtimeGalaxies[0];
    let bestGalScore = Infinity;
    let bestGalDist = Infinity;
    let bestGalAlign = -1;

    for (const g of runtimeGalaxies) {
      tempVecA.subVectors(g.position, camera.position);
      const d = tempVecA.length();
      const align = d > 0.01 ? tempVecA.dot(camForward) / d : 1;
      const deepInside = d < g.spec.radius * 0.58;
      // Strongly favor whichever galaxy the camera is facing when outside its inner disk
      const viewWeight = align > 0.25 ? 1.0 + align * 1.2 : align < -0.1 ? 0.22 : 0.65;
      const score = deepInside ? d * 0.35 : d / viewWeight;
      if (score < bestGalScore) {
        bestGalScore = score;
        bestGal = g;
        bestGalDist = d;
        bestGalAlign = align;
      }
    }

    let bestSys = bestGal.systems[0];
    let bestSysScore = Infinity;
    let bestSysDist = Infinity;
    let bestSysAlign = -1;

    for (const g of runtimeGalaxies) {
      for (const s of g.systems) {
        tempVecA.subVectors(s.position, camera.position);
        const d = tempVecA.length();
        const align = d > 0.01 ? tempVecA.dot(camForward) / d : 1;
        const insideCluster = d < s.spec.clusterRadius * 1.35;
        const viewWeight = align > 0.2 ? 1.0 + align * 1.4 : align < -0.15 ? 0.18 : 0.6;
        const score = insideCluster ? d * 0.32 : d / viewWeight;
        if (score < bestSysScore) {
          bestSysScore = score;
          bestSys = s;
          bestSysDist = d;
          bestSysAlign = align;
        }
      }
    }

    let bestBody = bestSys.bodies[0];
    let bestBodyScore = Infinity;
    let bestBodyDist = Infinity;
    let bestBodyAlign = -1;

    for (const b of bestSys.bodies) {
      tempVecA.subVectors(b.worldPosition, camera.position);
      const d = tempVecA.length();
      const align = d > 0.01 ? tempVecA.dot(camForward) / d : 1;
      const score = d / (0.45 + 0.55 * Math.max(-0.25, align));
      if (score < bestBodyScore) {
        bestBodyScore = score;
        bestBody = b;
        bestBodyDist = d;
        bestBodyAlign = align;
      }
    }

    const galProx = 1 - smooth(bestGal.spec.radius * 0.72, 540, bestGalDist);
    const sysProx = 1 - smooth(34, 185, bestSysDist);
    const bodyProx = 1 - smooth(bestBody.spec.radius * 3.8, 34, bestBodyDist);
    effectiveDepth = clamp(galProx * 1.05 + sysProx * 1.05 + bodyProx * 0.9, 0, 3.0);

    const physicallyInsideGal = bestGalDist < bestGal.spec.radius * 0.65;
    const facingGal = bestGalDist < bestGal.spec.radius * 1.85 && bestGalAlign > 0.18;

    if (bestBodyDist < Math.max(15.5, bestBody.spec.radius * 7.2) && (bestBodyAlign > 0.02 || bestBodyDist < 8.5)) {
      semanticLevel = 3;
      activeGalaxyId = bestSys.galaxyId;
      activeSystemId = bestSys.spec.id;
      activeContentId = bestBody.spec.contentId;
    } else if (bestSysDist < 105 && (bestSysAlign > 0.12 || bestSysDist < 42)) {
      semanticLevel = 2;
      activeGalaxyId = bestSys.galaxyId;
      activeSystemId = bestSys.spec.id;
      activeContentId = bestBody.spec.contentId;
    } else if (physicallyInsideGal || facingGal) {
      semanticLevel = 1;
      activeGalaxyId = bestGal.spec.id;
      if (bestSys.galaxyId === bestGal.spec.id) {
        activeSystemId = bestSys.spec.id;
        activeContentId = bestBody.spec.contentId;
      } else {
        activeSystemId = bestGal.systems[0].spec.id;
        activeContentId = bestGal.systems[0].bodies[0].spec.contentId;
      }
    } else {
      semanticLevel = 0;
      activeGalaxyId = bestGal.spec.id;
    }
  }

  function getFocusAnchorWorldPos(target: SpatialTarget | null, out: THREE.Vector3): THREE.Vector3 {
    if (!target) return out.copy(overviewTarget);
    return out.copy(target.position);
  }

  function updateBaseCameraPose() {
    getFocusAnchorWorldPos(activeFocusTarget, tempVecA);
    livePivotPos.copy(tempVecA).add(pivotLocalOffset);
    targetPivotPos.copy(tempVecA).add(targetPivotLocalOffset);

    directionFromAngles(armYaw, armPitch, tempVecB);
    camBasePos.copy(livePivotPos).addScaledVector(tempVecB, -armRadius);

    directionFromAngles(targetArmYaw, targetArmPitch, tempVecC);
    targetCamBasePos.copy(targetPivotPos).addScaledVector(tempVecC, -targetArmRadius);

    camYaw = armYaw + gazeYaw;
    camPitch = clamp(armPitch + gazePitch, -1.42, 1.42);
  }

  // Seamlessly switch the active tracking focus target without causing any position or angle jump
  function switchFocusTargetSeamless(newTarget: SpatialTarget | null) {
    if (activeFocusTarget === newTarget) return;
    getFocusAnchorWorldPos(activeFocusTarget, tempVecA);
    getFocusAnchorWorldPos(newTarget, tempVecB);
    tempVecC.subVectors(tempVecA, tempVecB);
    pivotLocalOffset.add(tempVecC);
    targetPivotLocalOffset.add(tempVecC);
    activeFocusTarget = newTarget;
    updateBaseCameraPose();
  }

  // Re-aligns arm angles with the current look direction while keeping camBasePos and camera look angles invariant
  function normalizeLookAndArmSeamless() {
    updateBaseCameraPose();
    const curLookYaw = armYaw + gazeYaw;
    const curLookPitch = clamp(armPitch + gazePitch, -1.42, 1.42);
    const tgtLookYaw = targetArmYaw + targetGazeYaw;
    const tgtLookPitch = clamp(targetArmPitch + targetGazePitch, -1.42, 1.42);

    getFocusAnchorWorldPos(activeFocusTarget, tempVecA);

    directionFromAngles(curLookYaw, curLookPitch, tempVecB);
    livePivotPos.copy(camBasePos).addScaledVector(tempVecB, armRadius);
    pivotLocalOffset.subVectors(livePivotPos, tempVecA);

    directionFromAngles(tgtLookYaw, tgtLookPitch, tempVecC);
    targetPivotPos.copy(targetCamBasePos).addScaledVector(tempVecC, targetArmRadius);
    targetPivotLocalOffset.subVectors(targetPivotPos, tempVecA);

    armYaw = curLookYaw;
    armPitch = curLookPitch;
    gazeYaw = 0;
    gazePitch = 0;

    targetArmYaw = tgtLookYaw;
    targetArmPitch = tgtLookPitch;
    targetGazeYaw = 0;
    targetGazePitch = 0;
    updateBaseCameraPose();
  }

  // Re-binds the orbital pivot around a new target & local offset while preserving current camera pose (0 jump)
  function bindOrbitPivotSeamless(newTarget: SpatialTarget | null, desiredLocalOffset: THREE.Vector3) {
    updateBaseCameraPose();
    const savedCamPos = camBasePos.clone();
    const curLookYaw = armYaw + gazeYaw;
    const curLookPitch = clamp(armPitch + gazePitch, -1.42, 1.42);

    activeFocusTarget = newTarget;
    pivotLocalOffset.copy(desiredLocalOffset);
    targetPivotLocalOffset.copy(desiredLocalOffset);

    getFocusAnchorWorldPos(activeFocusTarget, tempVecA);
    livePivotPos.copy(tempVecA).add(pivotLocalOffset);
    targetPivotPos.copy(livePivotPos);

    tempVecB.subVectors(livePivotPos, savedCamPos);
    const dist = Math.max(2.2, tempVecB.length());
    if (tempVecB.lengthSq() < 0.0001) {
      directionFromAngles(curLookYaw, curLookPitch, tempVecB);
    } else {
      tempVecB.normalize();
    }
    const newArmAngles = lookAnglesFromDirection(tempVecB);

    armRadius = dist;
    targetArmRadius = dist;

    // Keep armYaw continuous with curLookYaw
    armYaw = curLookYaw + shortestAngleDelta(curLookYaw, newArmAngles.yaw);
    targetArmYaw = armYaw;
    armPitch = clamp(newArmAngles.pitch, -1.36, 1.36);
    targetArmPitch = armPitch;

    gazeYaw = shortestAngleDelta(armYaw, curLookYaw);
    targetGazeYaw = gazeYaw;
    gazePitch = curLookPitch - armPitch;
    targetGazePitch = gazePitch;

    updateBaseCameraPose();
  }

  // Smart focus selection when user initiates a 360° orbital drag
  function selectAndBindOrbitPivot(startPointer: THREE.Vector2) {
    updateBaseCameraPose();

    // 1. If we are actively tracking a locked target and it is within reasonable range and roughly in front, orbit around it
    if (lockedFocusTarget) {
      const d = lockedFocusTarget.position.distanceTo(camBasePos);
      const maxRange =
        lockedFocusTarget.kind === 'content' ? 48 : lockedFocusTarget.kind === 'system' ? 165 : 460;
      directionFromAngles(camYaw, camPitch, camForward);
      tempVecA.subVectors(lockedFocusTarget.position, camBasePos).normalize();
      if (d < maxRange && tempVecA.dot(camForward) > 0.15) {
        bindOrbitPivotSeamless(lockedFocusTarget, new THREE.Vector3(0, 0, 0));
        return;
      }
    }

    // 2. Check if the drag started directly on or near a spatial structure along the cursor ray
    raycaster.setFromCamera(startPointer, camera);
    const probe = probeSpatialRay(camBasePos, raycaster.ray.direction);
    if (probe.kind === 'body' && probe.target && probe.distance < 55) {
      lockedFocusTarget = probe.target;
      bindOrbitPivotSeamless(probe.target, new THREE.Vector3(0, 0, 0));
      return;
    }
    if (probe.kind === 'system' && probe.target && probe.distance < 190) {
      bindOrbitPivotSeamless(probe.target, new THREE.Vector3(0, 0, 0));
      return;
    }
    if (probe.kind === 'galaxy-core' && probe.target && probe.distance < 520) {
      bindOrbitPivotSeamless(probe.target, new THREE.Vector3(0, 0, 0));
      return;
    }

    // 3. Otherwise choose the active semantic target based on camera proximity & view alignment
    deriveSemanticStateFromCamera();
    const { galaxy, system, body } = getActiveChain();
    directionFromAngles(camYaw, camPitch, camForward);

    const bodyDist = body.worldPosition.distanceTo(camBasePos);
    tempVecA.subVectors(body.worldPosition, camBasePos).normalize();
    if (semanticLevel === 3 || (bodyDist < 28 && tempVecA.dot(camForward) > 0.25)) {
      bindOrbitPivotSeamless(body.target, new THREE.Vector3(0, 0, 0));
      return;
    }

    const sysDist = system.position.distanceTo(camBasePos);
    tempVecA.subVectors(system.position, camBasePos).normalize();
    if (semanticLevel === 2 || (sysDist < 135 && tempVecA.dot(camForward) > 0.22)) {
      bindOrbitPivotSeamless(system.target, new THREE.Vector3(0, 0, 0));
      return;
    }

    const galDist = galaxy.position.distanceTo(camBasePos);
    tempVecA.subVectors(galaxy.position, camBasePos).normalize();
    const galAlign = tempVecA.dot(camForward);
    if (galDist < galaxy.spec.radius * 0.72) {
      // Inside a galaxy's spiral arms: if looking at the core, orbit the core; otherwise orbit a local spiral-arm point ahead
      if (galAlign > 0.55) {
        bindOrbitPivotSeamless(galaxy.target, new THREE.Vector3(0, 0, 0));
      } else {
        const localAheadDist = clamp(galDist * 0.55, 28, 72);
        tempVecB.copy(camBasePos).addScaledVector(camForward, localAheadDist).sub(galaxy.position);
        bindOrbitPivotSeamless(galaxy.target, tempVecB);
      }
      return;
    }

    if (galDist < 480 && galAlign > 0.18) {
      bindOrbitPivotSeamless(galaxy.target, new THREE.Vector3(0, 0, 0));
      return;
    }

    // 4. Universe Overview / Deep Field: orbit Universe barycenter if facing it, or a point ahead in space
    tempVecA.subVectors(overviewTarget, camBasePos);
    const ovDist = tempVecA.length();
    if (ovDist > 0.1 && tempVecA.dot(camForward) / ovDist > 0.32 && ovDist < 720) {
      bindOrbitPivotSeamless(null, new THREE.Vector3(0, 0, 0));
    } else {
      const aheadDist = clamp(ovDist * 0.5, 90, 240);
      tempVecB.copy(camBasePos).addScaledVector(camForward, aheadDist).sub(overviewTarget);
      bindOrbitPivotSeamless(null, tempVecB);
    }
  }

  function updateHUD() {
    deriveSemanticStateFromCamera();
    const levelSlug = ['universe', 'galaxy', 'system', 'content'][semanticLevel];
    const { galaxy, system, body } = getActiveChain();

    root.dataset.level = levelSlug;
    root.dataset.depth = effectiveDepth.toFixed(2);
    root.dataset.target =
      semanticLevel === 3
        ? body.spec.contentId
        : semanticLevel === 2
          ? system.spec.id
          : semanticLevel === 1
            ? galaxy.spec.id
            : 'overview';
    root.dataset.tracking = activeFocusTarget
      ? activeFocusTarget.contentId ?? activeFocusTarget.systemId ?? activeFocusTarget.galaxyId
      : 'universe';

    const regionInfo = regions[galaxy.spec.id];
    const systemInfo = systems[system.spec.id];
    const contentInfo = contentById[body.spec.contentId];

    if (semanticLevel === 0) {
      levelName.textContent = '01 / UNIVERSE · LIVING DEEP FIELD';
      heading.textContent = "Junyu's universe";
      description.textContent =
        'Move mouse to feel spatial depth, drag to orbit 360° around the cosmos, or aim anywhere and scroll to dive in.';
      contentDescription.textContent = '';
      contentDescription.hidden = true;
      contentLink.hidden = true;
    } else if (semanticLevel === 1) {
      const galDist = galaxy.position.distanceTo(camBasePos);
      const inInterior = galDist < galaxy.spec.radius * 1.05;
      levelName.textContent = inInterior
        ? `02 / GALAXY INTERIOR · ${regionInfo.title.toUpperCase()}`
        : `02 / GALAXY ORBIT · ${regionInfo.title.toUpperCase()}`;
      heading.textContent = regionInfo.title;
      description.textContent = `${regionInfo.description} Drag to orbit 360° around ${regionInfo.title} (front, edge-on, or behind), or point at any spiral arm and scroll to enter.`;
      contentDescription.textContent = '';
      contentDescription.hidden = true;
      contentLink.hidden = true;
    } else if (semanticLevel === 2) {
      levelName.textContent = `03 / STELLAR SYSTEM · ${regionInfo.title.toUpperCase()}`;
      heading.textContent = systemInfo.title;
      description.textContent = `Co-moving with the ${systemInfo.title} cluster inside ${regionInfo.title}. Drag to orbit 360° around the system, or click ${contentInfo.title} to lock focus.`;
      contentDescription.textContent = '';
      contentDescription.hidden = true;
      contentLink.hidden = true;
    } else {
      const isTrackingBody = activeFocusTarget?.kind === 'content';
      levelName.textContent = isTrackingBody
        ? `04 / TRACKING ORBIT · ${systemInfo.title.toUpperCase()}`
        : `04 / CELESTIAL OBJECT · ${systemInfo.title.toUpperCase()}`;
      heading.textContent = contentInfo.title;
      description.textContent = contentInfo.summary;
      contentDescription.textContent = contentInfo.description ?? '';
      contentDescription.hidden = !contentInfo.description;
      contentLink.hidden = false;
      contentLink.href = contentInfo.href;
    }

    const distFromOverview = camBasePos.distanceTo(overviewPos);
    const atOverview = effectiveDepth < 0.18 && distFromOverview < 36 && !lockedFocusTarget;
    back.hidden = atOverview;
    reset.dataset.atOverview = String(atOverview);

    // Guided Freedom: check if camera is drifted into deep void or looking away from nearby structures
    directionFromAngles(camYaw, camPitch, camForward);
    let maxAlign = -1;
    let minStructDist = Infinity;
    let nearestGal = runtimeGalaxies[0];
    for (const g of runtimeGalaxies) {
      tempVecA.subVectors(g.position, camBasePos);
      const d = tempVecA.length();
      if (d < minStructDist) {
        minStructDist = d;
        nearestGal = g;
      }
      if (d > 0.01) {
        maxAlign = Math.max(maxAlign, tempVecA.dot(camForward) / d);
      }
    }

    const distFromCosmosCenter = camBasePos.distanceTo(overviewTarget);
    const isOffAxisOrVoid =
      !atOverview &&
      (distFromCosmosCenter > 720 ||
        (maxAlign < 0.08 && minStructDist > 95) ||
        targetPivotLocalOffset.length() > 95);

    if (recenter) {
      recenter.hidden = !isOffAxisOrVoid && !lockedFocusTarget;
      if (lockedFocusTarget) {
        recenter.textContent = `⌖ Tracking ${lockedFocusTarget.title} · Recenter`;
      } else if (semanticLevel >= 2) {
        recenter.textContent = `⌖ Center on ${systemInfo.title}`;
      } else {
        recenter.textContent = `⌖ Center on ${regions[nearestGal.spec.id].title}`;
      }
    }

    hint.textContent =
      'Move mouse for spatial parallax · drag to orbit 360° · scroll to zoom toward cursor · click to track';

    if (scaleFill) {
      scaleFill.style.transform = `scaleX(${clamp(effectiveDepth / 3.0, 0.02, 1).toFixed(3)})`;
    }
    if (scaleReadout) {
      const activePos =
        semanticLevel === 3
          ? body.worldPosition
          : semanticLevel === 2
            ? system.position
            : semanticLevel === 1
              ? galaxy.position
              : overviewTarget;
      const distVal = camBasePos.distanceTo(activePos);
      const focusLabel = activeFocusTarget ? activeFocusTarget.title.toUpperCase() : 'UNIVERSE';
      scaleReadout.textContent = `FOCUS ${focusLabel} · DEPTH ${effectiveDepth.toFixed(2)} · RANGE ${distVal.toFixed(1)}`;
    }
    scaleButtons.forEach((btn, idx) => {
      btn.dataset.active = String(idx === semanticLevel);
    });
  }

  // Smoothly approaches AND locks focus onto a target in 3D from the camera's CURRENT orbital direction
  // so the camera continuously tracks its orbital/galactic motion and orbits around it 360°.
  function approachTarget3D(target: SpatialTarget) {
    updateBaseCameraPose();
    lockedFocusTarget = target;
    bindOrbitPivotSeamless(target, new THREE.Vector3(0, 0, 0));

    let standoff = 185;
    if (target.kind === 'galaxy') {
      standoff = 195;
      if (Math.abs(targetArmPitch) < 0.18) {
        targetArmPitch = -0.25;
      }
    } else if (target.kind === 'system') {
      standoff = 28;
      if (Math.abs(targetArmPitch) < 0.15) {
        targetArmPitch = -0.22;
      }
    } else if (target.kind === 'content') {
      standoff = Math.max(5.2, target.radius * 2.35);
      if (Math.abs(targetArmPitch) < 0.12) {
        targetArmPitch = -0.18;
      }
    }

    targetPivotLocalOffset.set(0, 0, 0);
    targetArmRadius = standoff;
    targetGazeYaw = 0;
    targetGazePitch = 0;
    schedule();
  }

  function recenterToNearestFocus() {
    if (lockedFocusTarget) {
      approachTarget3D(lockedFocusTarget);
      return;
    }
    const { galaxy, system, body } = getActiveChain();
    if (semanticLevel === 3) {
      approachTarget3D(body.target);
    } else if (semanticLevel === 2) {
      approachTarget3D(system.target);
    } else if (semanticLevel === 1) {
      approachTarget3D(galaxy.target);
    } else {
      // Find nearest galaxy or return to overview
      let bestG = runtimeGalaxies[0];
      let bestD = Infinity;
      for (const g of runtimeGalaxies) {
        const d = g.position.distanceTo(camBasePos);
        if (d < bestD) {
          bestD = d;
          bestG = g;
        }
      }
      if (bestD < 360) {
        approachTarget3D(bestG.target);
      } else {
        goOverview();
      }
    }
  }

  function goBack() {
    const { galaxy, system } = getActiveChain();
    if (semanticLevel === 3) {
      approachTarget3D(system.target);
    } else if (semanticLevel === 2) {
      approachTarget3D(galaxy.target);
    } else {
      goOverview();
    }
  }

  function goOverview() {
    updateBaseCameraPose();
    lockedFocusTarget = null;
    bindOrbitPivotSeamless(null, new THREE.Vector3(0, 0, 0));
    targetPivotLocalOffset.set(0, 0, 0);
    targetArmRadius = initialDist;
    targetArmYaw += shortestAngleDelta(targetArmYaw, initialAngles.yaw);
    targetArmPitch = initialAngles.pitch;
    targetGazeYaw = 0;
    targetGazePitch = 0;
    schedule();
  }

  function pick3DTarget(): SpatialTarget | undefined {
    raycaster.setFromCamera(pointer, camera);
    let closest = Infinity;
    let found: SpatialTarget | undefined;

    for (const target of allTargets) {
      const worldDist = target.position.distanceTo(camera.position);
      if (target.kind === 'galaxy' && worldDist < 140) continue;
      if (target.kind === 'system' && (worldDist < 18 || worldDist > 420)) continue;
      if (target.kind === 'content' && worldDist > 110) continue;

      sphere.center.copy(target.position);
      sphere.radius = target.radius;
      const hit = raycaster.ray.intersectSphere(sphere, rayHit);
      if (hit) {
        const d = hit.distanceTo(camera.position);
        if (d < closest) {
          closest = d;
          found = target;
        }
      }
    }
    return found;
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 2) return;
    const targetEl = event.target as HTMLElement | null;
    if (targetEl?.closest('.space-footer, .space-caption')) return;
    const rect = canvas.getBoundingClientRect();
    dragStartPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    pointer.copy(dragStartPointer);
    isDragging = true;
    orbitBoundOnDrag = false;
    dragMoved = false;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
  }

  function onPointerMove(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );

    if (isDragging) {
      const dx = event.clientX - dragStartX;
      const dy = event.clientY - dragStartY;
      if (Math.hypot(dx, dy) > 3) dragMoved = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;

      // Lazily bind the 3D orbital pivot on the first drag motion so simple clicks don't re-bind
      if (!orbitBoundOnDrag) {
        selectAndBindOrbitPivot(dragStartPointer);
        orbitBoundOnDrag = true;
      }

      // True Focus-Centric 3D Orbital Camera (Trackball-like 360° orbit around active focus):
      // Dragging rotates the camera's 3D orbital arm around the active target (Universe, Galaxy,
      // Stellar System, or Celestial Body), enabling front, edge-on side, top, and 180° back views.
      const orbitYawSensitivity = 0.0052;
      const orbitPitchSensitivity = 0.0044;

      targetArmYaw -= dx * orbitYawSensitivity;
      targetArmPitch = clamp(targetArmPitch - dy * orbitPitchSensitivity, -1.36, 1.36);

      // Smoothly decay any off-axis gaze offset toward 0 as the user orbits so the focus settles naturally in frame
      const recenterFactor = Math.exp(-Math.hypot(dx, dy) * 0.018);
      targetGazeYaw *= recenterFactor;
      targetGazePitch *= recenterFactor;

      canvas.style.cursor = 'grabbing';
      schedule();
      return;
    }

    const hit = pick3DTarget();
    hovered = hit;
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    schedule();
  }

  function onPointerUp(event: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    orbitBoundOnDrag = false;
    if (!dragMoved && event.button === 0) {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const hit = pick3DTarget();
      if (hit) approachTarget3D(hit);
    }
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
  }

  function onPointerLeave() {
    isDragging = false;
    orbitBoundOnDrag = false;
    hovered = undefined;
    canvas.style.cursor = 'grab';
    schedule();
  }

  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  // True Cursor-Anchored 3D Spatial Zoom (`dolly-to-cursor`) + Guided Freedom + Active Focus Handoff
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    if (event.clientX !== 0 || event.clientY !== 0) {
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    }

    const rawDelta =
      event.deltaY * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? innerHeight * 0.5 : 1);
    const wheelImpulse = clamp(rawDelta, -180, 180) * 0.0022;
    if (Math.abs(wheelImpulse) < 0.0001) return;

    // Normalize arm & gaze angles before advancing along the ray so linear ray translation never curves
    normalizeLookAndArmSeamless();

    // 1. Build world-space ray from the ACTUAL rendered camera (including pointer parallax)
    // so the cursor-to-world ray matches the exact pixel under the mouse on screen!
    raycaster.setFromCamera(pointer, camera);
    const rayDir = raycaster.ray.direction.clone().normalize();

    // 2. Probe spatial structure along the cursor ray
    const probe = probeSpatialRay(camera.position, rayDir);
    lastRaySummary = {
      kind: probe.kind,
      distance: +probe.distance.toFixed(2),
      point: [+probe.point.x.toFixed(1), +probe.point.y.toFixed(1), +probe.point.z.toFixed(1)],
    };

    // 3. Seamlessly adopt the aimed structure as the co-moving reference frame when zooming in
    const zoomingIn = wheelImpulse > 0;
    if (zoomingIn && probe.target) {
      switchFocusTargetSeamless(probe.target);
      if (probe.kind === 'body' && probe.distance < 38) {
        lockedFocusTarget = probe.target;
      } else if (probe.kind === 'system' && probe.distance < 95) {
        lockedFocusTarget = probe.target;
      }
    } else if (!zoomingIn && targetCamBasePos.distanceTo(overviewTarget) > 360) {
      lockedFocusTarget = null;
    }

    const moveDir = rayDir.clone();
    let stepScale = 85;
    let deltaLookYaw = 0;
    let deltaLookPitch = 0;

    if (zoomingIn) {
      if (probe.kind === 'body') {
        tempVecA.subVectors(probe.center, targetCamBasePos).normalize();
        const attractWeight = 0.25 * probe.closeness;
        moveDir.lerp(tempVecA, attractWeight).normalize();

        const remDist = Math.max(0.5, probe.distance - probe.standoff);
        stepScale = clamp(remDist * 0.62, 1.2, 65);

        tempVecB
          .copy(targetCamBasePos)
          .addScaledVector(moveDir, wheelImpulse * stepScale);
        tempVecC.subVectors(probe.center, tempVecB).normalize();
        const desiredLook = lookAnglesFromDirection(tempVecC);
        const orientAssist = clamp(wheelImpulse * 0.16 * probe.closeness, 0, 0.055);
        deltaLookYaw = shortestAngleDelta(targetArmYaw, desiredLook.yaw) * orientAssist;
        deltaLookPitch = (desiredLook.pitch - targetArmPitch) * orientAssist;
      } else if (probe.kind === 'system') {
        tempVecA.subVectors(probe.center, targetCamBasePos).normalize();
        const fadeNear = smooth(24, 92, probe.distance);
        const attractWeight = 0.18 * probe.closeness * fadeNear;
        moveDir.lerp(tempVecA, attractWeight).normalize();

        stepScale = clamp(probe.distance * 0.44, 6.0, 130);

        tempVecB
          .copy(targetCamBasePos)
          .addScaledVector(moveDir, wheelImpulse * stepScale);
        tempVecC.subVectors(probe.center, tempVecB).normalize();
        const desiredLook = lookAnglesFromDirection(tempVecC);
        const orientAssist = clamp(wheelImpulse * 0.12 * probe.closeness * fadeNear, 0, 0.04);
        deltaLookYaw = shortestAngleDelta(targetArmYaw, desiredLook.yaw) * orientAssist;
        deltaLookPitch = (desiredLook.pitch - targetArmPitch) * orientAssist;
      } else if (probe.kind === 'galaxy-core') {
        tempVecA.subVectors(probe.center, targetCamBasePos).normalize();
        const fadeNear = smooth(42, 185, probe.distance);
        const attractWeight = 0.22 * probe.closeness * fadeNear;
        moveDir.lerp(tempVecA, attractWeight).normalize();

        stepScale = clamp(probe.distance * 0.44, 26.0, 155);

        tempVecB
          .copy(targetCamBasePos)
          .addScaledVector(moveDir, wheelImpulse * stepScale);
        tempVecC.subVectors(probe.center, tempVecB).normalize();
        const desiredLook = lookAnglesFromDirection(tempVecC);
        const orientAssist = clamp(wheelImpulse * 0.14 * probe.closeness * fadeNear, 0, 0.045);
        deltaLookYaw = shortestAngleDelta(targetArmYaw, desiredLook.yaw) * orientAssist;
        deltaLookPitch = (desiredLook.pitch - targetArmPitch) * orientAssist;
      } else if (probe.kind === 'galaxy-disk') {
        // Aimed at galaxy edge / spiral arm: advance straight along cursor ray into that exact 3D spiral arm region
        stepScale = clamp(probe.distance * 0.45, 24.0, 150);
      } else {
        // Guided Freedom in Open Void: allow advancing into empty space along the cursor ray,
        // but apply progressive soft resistance as the camera moves far from all cosmic structures
        // so the user never gets hopelessly lost in infinite emptiness.
        const distFromCosmos = targetCamBasePos.distanceTo(overviewTarget);
        const voidBrake = 1.0 - 0.72 * smooth(360, 880, distFromCosmos);
        stepScale = clamp(probe.distance * 0.38, 16.0, 145) * voidBrake;
      }
    } else {
      // Scrolling backward: pull back smoothly along the cursor ray
      const distFromCosmos = targetCamBasePos.distanceTo(overviewTarget);
      const voidBrake = 1.0 - 0.72 * smooth(420, 920, distFromCosmos);
      stepScale = clamp(probe.distance * 0.44, 9.0, 160) * voidBrake;

      // Gentle orientation attraction back toward the active structure or Universe center when pulling far out
      if (distFromCosmos > 380) {
        tempVecA.subVectors(overviewTarget, targetCamBasePos).normalize();
        const ovLook = lookAnglesFromDirection(tempVecA);
        const pullAssist = clamp(Math.abs(wheelImpulse) * 0.08 * smooth(380, 760, distFromCosmos), 0, 0.035);
        deltaLookYaw = shortestAngleDelta(targetArmYaw, ovLook.yaw) * pullAssist;
        deltaLookPitch = (ovLook.pitch - targetArmPitch) * pullAssist;
      }
    }

    // Compute desired new base camera position along moveDir
    const newTargetCamPos = targetCamBasePos.clone().addScaledVector(moveDir, wheelImpulse * stepScale);

    // Minimum clearance standoff around celestial bodies so camera never clips inside a star/planet mesh
    for (const g of runtimeGalaxies) {
      for (const s of g.systems) {
        for (const b of s.bodies) {
          const minClearance = b.spec.radius * 1.65;
          tempVecA.subVectors(newTargetCamPos, b.worldPosition);
          const d = tempVecA.length();
          if (d < minClearance && d > 0.001) {
            newTargetCamPos.copy(b.worldPosition).addScaledVector(tempVecA.normalize(), minClearance);
          }
        }
      }
    }

    // Soft outer boundary envelope (Guided Freedom: prevent flying miles away into empty black void)
    const maxCosmosRadius = 960;
    if (newTargetCamPos.length() > maxCosmosRadius) {
      newTargetCamPos.setLength(maxCosmosRadius);
    }

    targetArmYaw += deltaLookYaw;
    targetArmPitch = clamp(targetArmPitch + deltaLookPitch, -1.36, 1.36);
    targetGazeYaw = 0;
    targetGazePitch = 0;

    // Update targetPivotLocalOffset so that `focusBase + targetPivotLocalOffset - targetArmRadius * dir = newTargetCamPos`
    getFocusAnchorWorldPos(activeFocusTarget, tempVecA);
    directionFromAngles(targetArmYaw, targetArmPitch, tempVecB);
    targetPivotPos.copy(newTargetCamPos).addScaledVector(tempVecB, targetArmRadius);
    targetPivotLocalOffset.subVectors(targetPivotPos, tempVecA);

    schedule();
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      goBack();
      return;
    }
    if (event.target !== canvas) return;
    normalizeLookAndArmSeamless();
    directionFromAngles(targetArmYaw, targetArmPitch, tempVecA);
    if (event.key === 'ArrowUp' || event.key === 'w' || event.key === '+' || event.key === '=') {
      event.preventDefault();
      targetPivotLocalOffset.addScaledVector(tempVecA, 36);
      schedule();
    } else if (event.key === 'ArrowDown' || event.key === 's' || event.key === '-' || event.key === 'Backspace') {
      event.preventDefault();
      targetPivotLocalOffset.addScaledVector(tempVecA, -36);
      schedule();
    } else if (event.key === 'ArrowLeft' || event.key === 'a') {
      event.preventDefault();
      selectAndBindOrbitPivot( new THREE.Vector2(0, 0) );
      targetArmYaw += 0.16;
      schedule();
    } else if (event.key === 'ArrowRight' || event.key === 'd') {
      event.preventDefault();
      selectAndBindOrbitPivot( new THREE.Vector2(0, 0) );
      targetArmYaw -= 0.16;
      schedule();
    } else if (event.key === 'Home') {
      event.preventDefault();
      goOverview();
    }
  }

  function onResize() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(nextDpr);
    renderer.setSize(innerWidth, innerHeight, false);
    for (const mat of animatedShaderMaterials) {
      if (mat.uniforms.uPixelRatio) mat.uniforms.uPixelRatio.value = nextDpr;
    }
    schedule();
  }

  function onMotionLabel() {
    motion.disabled = reduced.matches;
    motion.textContent = reduced.matches ? 'Motion reduced' : paused ? 'Resume motion' : 'Pause motion';
  }

  function onMotion() {
    if (reduced.matches) return;
    paused = !paused;
    onMotionLabel();
    schedule();
  }

  function onReduced() {
    paused = reduced.matches;
    onMotionLabel();
    schedule();
  }

  function onVisibility() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastRender = 0;
    } else {
      schedule();
    }
  }

  function onLost(event: Event) {
    event.preventDefault();
    cleanup();
    root.dataset.mode = 'reading';
    root.querySelector<HTMLElement>('#space')!.hidden = true;
    root.querySelector<HTMLElement>('#reading-view')!.hidden = false;
    root.querySelector<HTMLElement>('#reading-message')!.textContent =
      'The spatial view paused because graphics became unavailable. Continue exploring the same content here.';
    back.hidden = reset.hidden = true;
  }

  const onScaleClick = (event: Event) => {
    const btn = event.currentTarget as HTMLButtonElement;
    const d = Number.parseFloat(btn.dataset.scaleDepth ?? '0');
    const { galaxy, system, body } = getActiveChain();
    if (d < 0.5) {
      goOverview();
    } else if (d < 1.5) {
      approachTarget3D(galaxy.target);
    } else if (d < 2.5) {
      approachTarget3D(system.target);
    } else {
      approachTarget3D(body.target);
    }
  };

  space.addEventListener('pointerdown', onPointerDown);
  space.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  space.addEventListener('pointerleave', onPointerLeave);
  space.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onLost);
  back.addEventListener('click', goBack);
  reset.addEventListener('click', goOverview);
  if (recenter) recenter.addEventListener('click', recenterToNearestFocus);
  motion.addEventListener('click', onMotion);
  scaleButtons.forEach((btn) => btn.addEventListener('click', onScaleClick));
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onReduced);

  let metricsStart = performance.now();
  let rendered = 0;
  let renderTime = 0;

  function schedule() {
    if (!disposed && !document.hidden && !frame) {
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now: number) {
    frame = 0;
    if (disposed || document.hidden) return;
    if (now - lastRender < 1000 / 60 - 0.5) {
      schedule();
      return;
    }

    const dt = lastRender ? Math.min((now - lastRender) / 1000, 0.08) : 1 / 60;
    lastRender = now;
    const live = !paused && !reduced.matches;
    if (live) elapsed += dt;

    // 0. Damped Multi-Layer Pointer Response (Living Universe Parallax with inertia)
    const ptrLambda = reduced.matches ? 16 : 4.2;
    const deepPtrLambda = reduced.matches ? 16 : 2.1;
    smoothPointer.x = damp(smoothPointer.x, pointer.x, ptrLambda, dt);
    smoothPointer.y = damp(smoothPointer.y, pointer.y, ptrLambda, dt);
    deepPointer.x = damp(deepPointer.x, pointer.x, deepPtrLambda, dt);
    deepPointer.y = damp(deepPointer.y, pointer.y, deepPtrLambda, dt);

    // 1. Multi-Scale Continuous Cosmic Motion System + Multi-Layer Spatial Parallax
    // Background Layer Parallax: deep starfields and distant galaxies respond with subtle counter-parallax
    deepStars.rotation.y = elapsed * 0.0018 - deepPointer.x * 0.018;
    deepStars.rotation.x = deepPointer.y * 0.014;
    backgroundGalaxies.rotation.y = -deepPointer.x * 0.028;
    backgroundGalaxies.rotation.x = deepPointer.y * 0.022;
    backgroundGalaxies.position.set(-deepPointer.x * 9.5, -deepPointer.y * 6.5, 0);

    backgroundGalaxies.children.forEach((bg, idx) => {
      bg.rotation.y += (idx % 2 === 0 ? 0.008 : -0.009) * (live ? dt : 0);
    });

    // Midground intergalactic bridge subtle response
    intergalacticBridge.position.set(-smoothPointer.x * 3.2, -smoothPointer.y * 2.2, 0);
    intergalacticBridge.rotation.y = smoothPointer.x * 0.012;
    intergalacticBridge.rotation.x = -smoothPointer.y * 0.009;

    for (const galaxy of runtimeGalaxies) {
      // Scale B: Macro galaxy overall rotation + gentle 3D axial precession + subtle pointer tilt response
      const spinAngle = elapsed * galaxy.spinRate;
      tempQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spinAngle);
      pointerTiltEuler.set(
        -smoothPointer.y * 0.032,
        smoothPointer.x * 0.028,
        -smoothPointer.x * 0.016,
        'XYZ',
      );
      pointerTiltQuat.setFromEuler(pointerTiltEuler);
      galaxy.currentQuaternion
        .copy(galaxy.baseQuaternion)
        .multiply(pointerTiltQuat)
        .multiply(tempQuat);
      galaxy.group.quaternion.copy(galaxy.currentQuaternion);
      galaxy.diskNormal.set(0, 1, 0).applyQuaternion(galaxy.currentQuaternion).normalize();

      // Core coronal pulsation
      const corePulse = 1.0 + Math.sin(elapsed * 0.95 + galaxy.spec.seed) * 0.045;
      galaxy.coreGroup.scale.setScalar(corePulse);

      const R = galaxy.spec.radius;

      // Scale C: Meso-scale stellar cluster epicyclic drift inside the rotating galaxy frame
      galaxy.systems.forEach((system, sIdx) => {
        system.motionLaw.evaluate(elapsed, dt, system.localDiskPos);
        system.position
          .copy(system.localDiskPos)
          .applyQuaternion(galaxy.currentQuaternion)
          .add(galaxy.position);

        system.localGroup.position.copy(system.position);
        system.beacon.position.copy(system.position);
        system.target.position.copy(system.position);

        // Foreground cluster & nursery nebula differential parallax response
        system.clusterPoints.rotation.y = smoothPointer.x * 0.045;
        system.clusterPoints.rotation.x = -smoothPointer.y * 0.038;
        system.nurseryNebula.position.set(smoothPointer.x * 0.85, smoothPointer.y * 0.65, 0);

        // Sync volume shader H-II nursery knot uniform with live epicyclic cluster position
        for (const volMat of galaxy.volumeMaterials) {
          const knots = volMat.uniforms.uKnots.value as THREE.Vector2[];
          if (knots[sIdx]) {
            knots[sIdx].set(system.localDiskPos.x / (R * 1.06), system.localDiskPos.z / (R * 1.06));
          }
        }

        // Scale D: Micro-scale stellar system orbital mechanics (barycentric reflex + precessing/resonant companions)
        const primaryBody = system.bodies[0];
        for (let bIdx = 0; bIdx < system.bodies.length; bIdx++) {
          const body = system.bodies[bIdx];
          body.motionLaw.evaluate(elapsed, dt, body.localOrbitPos);
          body.pivot.position.copy(body.localOrbitPos);
          body.worldPosition.copy(system.position).add(body.localOrbitPos);
          body.target.position.copy(body.worldPosition);

          // Axial rotation & ring precession (local spin — NOT inherited by camera tracking!)
          body.mesh.rotation.y = elapsed * (body.isPrimary ? 0.16 : 0.28);
          if (body.ringMesh) {
            body.ringMesh.rotation.z = elapsed * (body.isPrimary ? 0.08 : -0.14);
          }

          // Update central star illumination origin for companion shaders
          body.material.uniforms.uSystemCenter.value.copy(primaryBody.worldPosition);

          // Update dynamic precessing orbital trail geometry periodically when visible
          if (!body.isPrimary && body.orbitGeom && body.orbitLine?.visible && body.motionLaw.sampleOrbitCurve) {
            const curvePts = body.motionLaw.sampleOrbitCurve(elapsed, 128);
            const posAttr = body.orbitGeom.getAttribute('position') as THREE.BufferAttribute;
            for (let k = 0; k < curvePts.length; k++) {
              posAttr.setXYZ(k, curvePts[k].x, curvePts[k].y, curvePts[k].z);
            }
            posAttr.needsUpdate = true;
          }

          // Scale E: Sub-satellite / local moon brisk orbits
          for (const sat of body.satellites) {
            sat.motionLaw.evaluate(elapsed, dt, sat.localPos);
            sat.mesh.position.copy(sat.localPos);
            sat.halo.position.copy(sat.localPos);
            sat.material.uniforms.uSystemCenter.value.copy(primaryBody.worldPosition);
          }
        }
      });
    }

    // 2. Automatic Proximity Focus Handoff (when not locked to a specific clicked target)
    // Ensures that when flying into a galaxy, stellar system, or planet via scroll wheel,
    // the camera automatically co-moves with that system/planet's orbital translation!
    if (!isDragging && !lockedFocusTarget) {
      const { galaxy, system, body } = getActiveChain();
      const bodyDist = body.worldPosition.distanceTo(camBasePos);
      const sysDist = system.position.distanceTo(camBasePos);
      const galDist = galaxy.position.distanceTo(camBasePos);

      if (bodyDist < Math.max(14, body.spec.radius * 6.0)) {
        switchFocusTargetSeamless(body.target);
      } else if (sysDist < 88) {
        switchFocusTargetSeamless(system.target);
      } else if (galDist < galaxy.spec.radius * 1.35) {
        switchFocusTargetSeamless(galaxy.target);
      } else {
        switchFocusTargetSeamless(null);
      }
    }

    // 3. Focus-Centric 3D Orbital Camera Damping + Pointer-Driven Spatial Parallax
    const posLambda = reduced.matches ? 22 : 7.5;
    const rotLambda = reduced.matches ? 22 : 8.8;
    dampVec3(pivotLocalOffset, targetPivotLocalOffset, posLambda, dt);
    armRadius = damp(armRadius, targetArmRadius, posLambda, dt);
    armYaw = damp(armYaw, targetArmYaw, rotLambda, dt);
    armPitch = damp(armPitch, targetArmPitch, rotLambda, dt);
    gazeYaw = damp(gazeYaw, targetGazeYaw, rotLambda, dt);
    gazePitch = damp(gazePitch, targetGazePitch, rotLambda, dt);

    // Compute camBasePos relative to activeFocusTarget's live world position (tracks moving planets/systems!)
    updateBaseCameraPose();

    // Compute camera basis vectors for pointer-driven spatial parallax translation & orientation response
    directionFromAngles(camYaw, camPitch, camForward);
    camRight.set(Math.cos(camYaw), 0, -Math.sin(camYaw)).normalize();
    camUp.crossVectors(camRight, camForward).normalize();

    // Scale parallax amplitude proportionally to active focus distance so it feels expansive at Universe/Galaxy scale
    // and delicately precise at Stellar System / Planet scale.
    const parallaxScale = clamp(armRadius * 0.055, 0.35, 19.5);
    const dragParallaxAtten = isDragging ? 0.25 : 1.0;
    const px = smoothPointer.x * parallaxScale * dragParallaxAtten;
    const py = smoothPointer.y * parallaxScale * 0.72 * dragParallaxAtten;

    parallaxPosOffset
      .copy(camRight)
      .multiplyScalar(px)
      .addScaledVector(camUp, py);

    // Subtle orientation counter-tilt & roll so the living universe tilts with depth as the mouse moves
    const parallaxYaw = -smoothPointer.x * 0.036 * dragParallaxAtten;
    const parallaxPitch = smoothPointer.y * 0.028 * dragParallaxAtten;
    const parallaxRoll = -smoothPointer.x * 0.018 * dragParallaxAtten;

    camera.position.copy(camBasePos).add(parallaxPosOffset);
    camera.rotation.set(
      clamp(camPitch + parallaxPitch, -1.46, 1.46),
      camYaw + parallaxYaw,
      parallaxRoll,
      'YXZ',
    );
    camera.updateMatrixWorld();

    skyDome.position.copy(camera.position);

    for (const mat of animatedShaderMaterials) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = elapsed;
    }

    // 4. Pure Distance-Driven LOD & Opacity Modulation
    for (const galaxy of runtimeGalaxies) {
      const galDist = galaxy.position.distanceTo(camera.position);
      const volumeInsideAtten = 1.0 - (1.0 - smooth(14, 75, galDist)) * 0.42;

      for (const volMat of galaxy.volumeMaterials) {
        volMat.uniforms.uOpacity.value = volumeInsideAtten;
      }

      galaxy.starMaterial.uniforms.uOpacity.value = 0.96;
      galaxy.nebulaMaterial.uniforms.uOpacity.value = 0.94;
      galaxy.dustMaterial.uniforms.uOpacity.value = 0.88;
      galaxy.streamMaterial.uniforms.uOpacity.value = 0.45 + (1.0 - smooth(120, 460, galDist)) * 0.48;

      const coreNearAtten = 0.28 + 0.72 * smooth(12, 90, galDist);
      galaxy.coreSprites[0].material.opacity = 0.52 * coreNearAtten;
      galaxy.coreSprites[1].material.opacity = 0.34 * coreNearAtten;
      galaxy.coreSprites[2].material.opacity = 0.18 * coreNearAtten;

      for (const system of galaxy.systems) {
        const sysDist = system.position.distanceTo(camera.position);
        const sysResolve = 1.0 - smooth(42, 220, sysDist);
        const beaconFade = smooth(18, 72, sysDist);

        system.beacon.material.opacity = (0.42 + (1 - beaconFade) * 0.28) * beaconFade;
        const pulse = 1.0 + Math.sin(elapsed * 1.3 + sysDist * 0.05) * 0.05;
        system.beacon.scale.setScalar((14.0 + (1 - smooth(60, 380, sysDist)) * 5.5) * pulse);

        system.clusterMaterial.uniforms.uOpacity.value = 0.48 + sysResolve * 0.48;
        system.nurseryMaterial.uniforms.uOpacity.value = 0.55 + (1 - sysResolve) * 0.42;

        const showInterior = sysResolve > 0.004;
        system.accretionPoints.visible = showInterior;
        if (showInterior) {
          system.accretionMaterial.uniforms.uOpacity.value = sysResolve * 0.84;
        }

        for (let bIdx = 0; bIdx < system.bodies.length; bIdx++) {
          const body = system.bodies[bIdx];
          body.pivot.visible = showInterior;
          if (!showInterior) {
            if (body.orbitLine) body.orbitLine.visible = false;
            continue;
          }

          const isPrimary = bIdx === 0;
          const bodyAlpha = isPrimary ? clamp(sysResolve * 1.25, 0, 1) : Math.pow(sysResolve, 1.12);
          body.material.uniforms.uOpacity.value = bodyAlpha;
          body.halo.material.opacity = bodyAlpha * (isPrimary ? 0.52 : 0.36);

          if (body.ringMaterial && body.ringMesh) {
            body.ringMesh.visible = bodyAlpha > 0.01;
            body.ringMaterial.uniforms.uOpacity.value = bodyAlpha * (isPrimary ? 0.78 : 0.64);
          }
          if (body.orbitLine) {
            body.orbitLine.visible = bodyAlpha > 0.01;
            const bodyDist = body.worldPosition.distanceTo(camera.position);
            body.orbitLine.material.opacity = bodyAlpha * smooth(4.5, 14.0, bodyDist) * 0.72;
          }

          const satAlpha = clamp((sysResolve - 0.18) * 1.35, 0, 1);
          for (const sat of body.satellites) {
            sat.mesh.visible = satAlpha > 0.01;
            sat.halo.visible = satAlpha > 0.01;
            sat.orbitLine.visible = satAlpha > 0.01;
            if (satAlpha > 0.01) {
              sat.material.uniforms.uOpacity.value = satAlpha * 0.94;
              sat.halo.material.opacity = satAlpha * 0.36;
              sat.orbitLine.material.opacity = satAlpha * 0.38;
            }
          }
        }
      }
    }

    // 5. Update Derived Semantic HUD & Distance-Driven Spatial Telemetry Labels
    updateHUD();

    const candidateLabels: {
      target: SpatialTarget;
      x: number;
      y: number;
      alpha: number;
      worldDist: number;
      isActiveFocus: boolean;
    }[] = [];

    for (const target of allTargets) {
      let alpha = 0;
      const worldDist = target.position.distanceTo(camera.position);

      if (target.kind === 'galaxy') {
        alpha = smooth(155, 255, worldDist) * (1.0 - smooth(1200, 2500, worldDist));
      } else if (target.kind === 'system') {
        const emerge = 1.0 - smooth(245, 430, worldDist);
        const recedeClose = smooth(28, 62, worldDist);
        const isCurrentSys = target.systemId === activeSystemId;
        const weight = isCurrentSys || hovered === target ? 1.0 : 0.76;
        alpha = emerge * recedeClose * weight;
      } else if (target.kind === 'content') {
        const parentGal = runtimeGalaxies.find((g) => g.spec.id === target.galaxyId);
        const parentSys = parentGal?.systems.find((s) => s.spec.id === target.systemId);
        const sysDist = parentSys ? parentSys.position.distanceTo(camera.position) : worldDist;
        const emerge = 1.0 - smooth(54, 96, sysDist);
        const recedeVeryClose = smooth(target.radius * 1.65, target.radius * 2.9, worldDist);
        const isFocusedBody = target.contentId === activeContentId || hovered === target;
        alpha = emerge * recedeVeryClose * (isFocusedBody ? 1.0 : 0.85);
      }

      if (alpha < 0.04) {
        target.label.hidden = true;
        continue;
      }

      tempVecA.copy(target.position).add(target.labelOffset);
      projection.copy(tempVecA).project(camera);

      const x = (projection.x * 0.5 + 0.5) * innerWidth;
      const y = (-projection.y * 0.5 + 0.5) * innerHeight;

      const inBounds =
        projection.z > -1.0 &&
        projection.z < 1.0 &&
        x > 58 &&
        x < innerWidth - 58 &&
        y > 78 &&
        y < innerHeight - 115;

      if (!inBounds) {
        target.label.hidden = true;
        continue;
      }

      const isActiveFocus =
        activeFocusTarget === target ||
        (target.kind === 'galaxy' && target.galaxyId === activeGalaxyId && semanticLevel <= 1) ||
        (target.kind === 'system' && target.systemId === activeSystemId && semanticLevel === 2) ||
        (target.kind === 'content' && target.contentId === activeContentId && semanticLevel === 3);

      candidateLabels.push({ target, x, y, alpha, worldDist, isActiveFocus });
    }

    candidateLabels.sort((a, b) => (b.isActiveFocus ? 1 : 0) - (a.isActiveFocus ? 1 : 0) || b.alpha - a.alpha);

    const occupied: { x: number; y: number }[] = [];
    for (const item of candidateLabels) {
      let { x, y } = item;
      for (let pass = 0; pass < 4; pass++) {
        for (const other of occupied) {
          if (Math.abs(x - other.x) < 208 && Math.abs(y - other.y) < 62) {
            y = y >= other.y ? other.y + 64 : other.y - 64;
          }
        }
      }
      y = clamp(y, 82, innerHeight - 118);
      occupied.push({ x, y });

      const { target, alpha, worldDist, isActiveFocus } = item;
      target.label.hidden = false;
      target.label.dataset.focused = String(isActiveFocus);
      target.distanceEl.textContent = `${worldDist.toFixed(0)} u`;
      target.label.style.left = `${x.toFixed(1)}px`;
      target.label.style.top = `${y.toFixed(1)}px`;
      target.label.style.opacity = `${alpha.toFixed(3)}`;
      target.label.disabled = alpha < 0.2;
    }

    const renderStart = performance.now();
    renderer.render(scene, camera);
    renderTime += performance.now() - renderStart;
    rendered++;

    const isMoving =
      pivotLocalOffset.distanceTo(targetPivotLocalOffset) > 0.05 ||
      Math.abs(armRadius - targetArmRadius) > 0.05 ||
      Math.abs(armYaw - targetArmYaw) > 0.0008 ||
      Math.abs(armPitch - targetArmPitch) > 0.0008 ||
      Math.hypot(pointer.x - smoothPointer.x, pointer.y - smoothPointer.y) > 0.002;

    root.dataset.transitioning = String(isMoving);

    if (now - metricsStart > 500) {
      camera.getWorldDirection(camForward);
      const learningSys = runtimeGalaxies[0].systems[0];
      const learningPrimary = learningSys.bodies[0];
      const learningComp = learningSys.bodies[1];
      const learningMoon = learningPrimary.satellites[0];

      metrics.textContent = JSON.stringify({
        level: root.dataset.level,
        depth: +effectiveDepth.toFixed(3),
        fps: +((rendered * 1000) / (now - metricsStart)).toFixed(1),
        cpuRenderMs: +(renderTime / rendered).toFixed(2),
        drawCalls: renderer.info.render.calls,
        points: renderer.info.render.points,
        triangles: renderer.info.render.triangles,
        focusTarget: activeFocusTarget
          ? activeFocusTarget.contentId ?? activeFocusTarget.systemId ?? activeFocusTarget.galaxyId
          : 'universe',
        lockedTarget: lockedFocusTarget
          ? lockedFocusTarget.contentId ?? lockedFocusTarget.systemId ?? lockedFocusTarget.galaxyId
          : null,
        orbitPivot: [+livePivotPos.x.toFixed(2), +livePivotPos.y.toFixed(2), +livePivotPos.z.toFixed(2)],
        armRadius: +armRadius.toFixed(2),
        armYawDeg: +THREE.MathUtils.radToDeg(armYaw).toFixed(1),
        armPitchDeg: +THREE.MathUtils.radToDeg(armPitch).toFixed(1),
        cameraPos: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        camBasePos: [+camBasePos.x.toFixed(2), +camBasePos.y.toFixed(2), +camBasePos.z.toFixed(2)],
        parallaxOffset: [
          +parallaxPosOffset.x.toFixed(2),
          +parallaxPosOffset.y.toFixed(2),
          +parallaxPosOffset.z.toFixed(2),
        ],
        smoothPointer: [+smoothPointer.x.toFixed(3), +smoothPointer.y.toFixed(3)],
        cameraDir: [+camForward.x.toFixed(3), +camForward.y.toFixed(3), +camForward.z.toFixed(3)],
        yawDeg: +THREE.MathUtils.radToDeg(camYaw).toFixed(1),
        pitchDeg: +THREE.MathUtils.radToDeg(camPitch).toFixed(1),
        lastRayHit: lastRaySummary,
        motionSample: {
          elapsed: +elapsed.toFixed(2),
          learningClusterPos: [
            +learningSys.position.x.toFixed(2),
            +learningSys.position.y.toFixed(2),
            +learningSys.position.z.toFixed(2),
          ],
          learningCompanionLocal: [
            +learningComp.localOrbitPos.x.toFixed(2),
            +learningComp.localOrbitPos.y.toFixed(2),
            +learningComp.localOrbitPos.z.toFixed(2),
          ],
          learningCompanionWorld: [
            +learningComp.worldPosition.x.toFixed(2),
            +learningComp.worldPosition.y.toFixed(2),
            +learningComp.worldPosition.z.toFixed(2),
          ],
          learningMoonLocal: [
            +learningMoon.localPos.x.toFixed(2),
            +learningMoon.localPos.y.toFixed(2),
            +learningMoon.localPos.z.toFixed(2),
          ],
        },
      });
      metricsStart = now;
      rendered = 0;
      renderTime = 0;
    }

    if (live || isMoving) {
      schedule();
    }
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    space.removeEventListener('pointerdown', onPointerDown);
    space.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    space.removeEventListener('pointerleave', onPointerLeave);
    space.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('webglcontextlost', onLost);
    back.removeEventListener('click', goBack);
    reset.removeEventListener('click', goOverview);
    if (recenter) recenter.removeEventListener('click', recenterToNearestFocus);
    motion.removeEventListener('click', onMotion);
    scaleButtons.forEach((btn) => btn.removeEventListener('click', onScaleClick));
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.removeEventListener('change', onReduced);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if ('geometry' in object && object.geometry) {
        geometries.add(object.geometry as THREE.BufferGeometry);
      }
      if ('material' in object && object.material) {
        const m = object.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((mat) => materials.add(mat));
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    glowTexture.dispose();
    renderer.dispose();
    labels.replaceChildren();
    metrics.textContent = '';
  }

  updateHUD();
  onMotionLabel();
  canvas.style.cursor = 'grab';
  schedule();
  return cleanup;
}
