import * as THREE from 'three';

// Multi-scale hierarchical motion architecture for the Personal Universe.
// Separates spatial trajectory laws from scene rendering so any entity (galaxy, stellar cluster,
// primary star, companion world, moon, or future chaotic 3-body system) can be driven by
// a pluggable MotionLaw without hardcoding uniform circular orbits.

export type MotionKind =
  | 'epicyclic-cluster'
  | 'barycentric-reflex'
  | 'kepler-precessing'
  | 'resonant-perturbed'
  | 'chaotic-attractor';

export interface MotionLaw {
  readonly kind: MotionKind;
  evaluate(time: number, dt: number, outPosition: THREE.Vector3, outVelocity?: THREE.Vector3): void;
  sampleOrbitCurve?(time: number, segments: number): THREE.Vector3[];
}

// Solve Kepler's Equation M = E - e * sin(E) using 4-step Newton-Raphson iteration.
// Produces authentic non-uniform orbital speed (faster at periapsis, slower at apoapsis).
function solveEccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  const m = ((meanAnomaly % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  let E = m + eccentricity * Math.sin(m);
  for (let i = 0; i < 4; i++) {
    const f = E - eccentricity * Math.sin(E) - m;
    const fPrime = 1 - eccentricity * Math.cos(E);
    E -= f / Math.max(0.1, fPrime);
  }
  return E;
}

export interface EpicyclicClusterOptions {
  anchor: THREE.Vector3;
  radialAmplitude: number;
  verticalAmplitude: number;
  epicycleFreq: number;
  verticalFreq: number;
  differentialDriftRate: number;
  phase: number;
}

// Meso-scale motion: stellar clusters embedded in a spiral arm execute Lindblad epicycles
// (coupled radial + azimuthal oscillation) plus vertical disk breathing and differential shear.
export function createEpicyclicClusterMotion(opts: EpicyclicClusterOptions): MotionLaw {
  const anchorRadius = Math.hypot(opts.anchor.x, opts.anchor.z);
  const baseAngle = Math.atan2(opts.anchor.z, opts.anchor.x);

  return {
    kind: 'epicyclic-cluster',
    evaluate(time: number, _dt: number, outPosition: THREE.Vector3, outVelocity?: THREE.Vector3) {
      const shearAngle = baseAngle + opts.differentialDriftRate * time;
      const epicyclePhase = opts.epicycleFreq * time + opts.phase;
      const verticalPhase = opts.verticalFreq * time + opts.phase * 1.618;

      // In galactic dynamics, azimuthal epicycle amplitude is ~2x radial amplitude (2 * Omega / kappa)
      const dr = opts.radialAmplitude * Math.cos(epicyclePhase);
      const dTheta = (opts.radialAmplitude * 1.85 * Math.sin(epicyclePhase)) / Math.max(16, anchorRadius);
      const dy = opts.verticalAmplitude * Math.sin(verticalPhase);

      const r = anchorRadius + dr;
      const theta = shearAngle + dTheta;

      outPosition.set(Math.cos(theta) * r, opts.anchor.y + dy, Math.sin(theta) * r);

      if (outVelocity) {
        const vr = -opts.radialAmplitude * opts.epicycleFreq * Math.sin(epicyclePhase);
        const vTheta =
          r *
          (opts.differentialDriftRate +
            (opts.radialAmplitude * 1.85 * opts.epicycleFreq * Math.cos(epicyclePhase)) /
              Math.max(16, anchorRadius));
        const vy = opts.verticalAmplitude * opts.verticalFreq * Math.cos(verticalPhase);
        outVelocity.set(
          Math.cos(theta) * vr - Math.sin(theta) * vTheta,
          vy,
          Math.sin(theta) * vr + Math.cos(theta) * vTheta,
        );
      }
    },
  };
}

export interface BarycentricReflexOptions {
  amplitude: number;
  primaryFreq: number;
  secondaryFreq: number;
  phase: number;
}

// Primary star motion: subtle reflex wobble around the stellar system barycenter
// induced by orbiting companion masses, preventing the central star from feeling pinned in space.
export function createBarycentricReflexMotion(opts: BarycentricReflexOptions): MotionLaw {
  return {
    kind: 'barycentric-reflex',
    evaluate(time: number, _dt: number, outPosition: THREE.Vector3) {
      const a1 = opts.primaryFreq * time + opts.phase;
      const a2 = opts.secondaryFreq * time - opts.phase * 1.3;
      const r1 = opts.amplitude;
      const r2 = opts.amplitude * 0.48;

      outPosition.set(
        Math.cos(a1) * r1 + Math.cos(a2) * r2,
        Math.sin(a1 * 0.85 + 0.7) * opts.amplitude * 0.35,
        Math.sin(a1) * r1 + Math.sin(a2) * r2,
      );
    },
  };
}

export interface KeplerPrecessingOptions {
  semiMajorAxis: number;
  eccentricity: number;
  inclination: number;
  ascendingNode: number;
  argOfPeriapsis: number;
  meanMotion: number;
  initialMeanAnomaly: number;
  apsidalPrecessionRate: number;
  nodalPrecessionRate: number;
}

function evaluateKeplerPoint(
  opts: KeplerPrecessingOptions,
  time: number,
  meanAnomalyOverride: number | undefined,
  out: THREE.Vector3,
) {
  const M =
    meanAnomalyOverride !== undefined
      ? meanAnomalyOverride
      : opts.initialMeanAnomaly + opts.meanMotion * time;
  const E = solveEccentricAnomaly(M, opts.eccentricity);

  // Orbital plane coordinates with focus at (0, 0)
  const a = opts.semiMajorAxis;
  const e = opts.eccentricity;
  const b = a * Math.sqrt(Math.max(0.05, 1 - e * e));
  const xOrb = a * (Math.cos(E) - e);
  const zOrb = b * Math.sin(E);

  // 3D Euler rotation: argument of periapsis omega(t), inclination i, longitude of ascending node Omega(t)
  const omega = opts.argOfPeriapsis + opts.apsidalPrecessionRate * time;
  const node = opts.ascendingNode + opts.nodalPrecessionRate * time;
  const inc = opts.inclination;

  const cosO = Math.cos(node);
  const sinO = Math.sin(node);
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const cosI = Math.cos(inc);
  const sinI = Math.sin(inc);

  // Rotate in orbital plane by omega
  const x1 = xOrb * cosW - zOrb * sinW;
  const z1 = xOrb * sinW + zOrb * cosW;

  // Tilt by inclination i around X axis
  const x2 = x1;
  const y2 = z1 * sinI;
  const z2 = z1 * cosI;

  // Rotate by ascending node Omega around Y axis
  out.set(x2 * cosO + z2 * sinO, y2, -x2 * sinO + z2 * cosO);
}

// Micro-scale companion motion: true eccentric Keplerian orbit with apsidal & nodal precession.
export function createKeplerPrecessingMotion(opts: KeplerPrecessingOptions): MotionLaw {
  const tempPrev = new THREE.Vector3();
  return {
    kind: 'kepler-precessing',
    evaluate(time: number, _dt: number, outPosition: THREE.Vector3, outVelocity?: THREE.Vector3) {
      evaluateKeplerPoint(opts, time, undefined, outPosition);
      if (outVelocity) {
        evaluateKeplerPoint(opts, time - 0.05, undefined, tempPrev);
        outVelocity.subVectors(outPosition, tempPrev).multiplyScalar(20.0);
      }
    },
    sampleOrbitCurve(time: number, segments: number): THREE.Vector3[] {
      const currentM = opts.initialMeanAnomaly + opts.meanMotion * time;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const frac = i / segments;
        const mSample = currentM - frac * Math.PI * 2;
        const pt = new THREE.Vector3();
        evaluateKeplerPoint(opts, time, mSample, pt);
        pts.push(pt);
      }
      return pts;
    },
  };
}

export interface ResonantPerturbedOptions extends KeplerPrecessingOptions {
  perturbationAmplitude: number;
  resonanceRatio: number;
  perturbationPhase: number;
}

// Multi-body resonant / three-body-inspired perturbed orbit:
// Superposes secular Laplace/Lagrange-like resonant harmonics on top of a precessing Keplerian ellipse,
// creating non-repeating rosette / braided trajectories suitable for complex multi-body systems.
export function createResonantPerturbedMotion(opts: ResonantPerturbedOptions): MotionLaw {
  const baseLaw = createKeplerPrecessingMotion(opts);
  const pVec = new THREE.Vector3();

  function addPerturbation(time: number, mAngle: number, target: THREE.Vector3) {
    const phi = mAngle * opts.resonanceRatio + time * opts.meanMotion * 0.37 + opts.perturbationPhase;
    const amp = opts.perturbationAmplitude;
    // Epicyclic three-body perturbation lobes in radial, vertical, and binormal directions
    pVec.set(
      amp * (Math.cos(phi) + 0.38 * Math.sin(phi * 1.618)),
      amp * 0.55 * Math.sin(phi * 1.27 + 0.9),
      amp * (Math.sin(phi) - 0.38 * Math.cos(phi * 1.618)),
    );
    target.add(pVec);
  }

  return {
    kind: 'resonant-perturbed',
    evaluate(time: number, dt: number, outPosition: THREE.Vector3, outVelocity?: THREE.Vector3) {
      baseLaw.evaluate(time, dt, outPosition, outVelocity);
      const currentM = opts.initialMeanAnomaly + opts.meanMotion * time;
      addPerturbation(time, currentM, outPosition);
    },
    sampleOrbitCurve(time: number, segments: number): THREE.Vector3[] {
      const currentM = opts.initialMeanAnomaly + opts.meanMotion * time;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segments; i++) {
        const frac = i / segments;
        const mSample = currentM - frac * Math.PI * 2;
        const tSample = time - (frac * Math.PI * 2) / Math.max(0.05, opts.meanMotion);
        const pt = new THREE.Vector3();
        evaluateKeplerPoint(opts, tSample, mSample, pt);
        addPerturbation(tSample, mSample, pt);
        pts.push(pt);
      }
      return pts;
    },
  };
}

export interface ChaoticAttractorOptions {
  scale: number;
  speed: number;
  initialPosition: THREE.Vector3;
  initialVelocity: THREE.Vector3;
}

// Stateful RK4 dynamical integrator for genuine non-periodic three-body / Henon-Heiles-inspired
// bounded chaotic trajectories. Can be attached to any future complex entity or satellite swarm.
export function createBoundedChaoticMotion(opts: ChaoticAttractorOptions): MotionLaw {
  const pos = opts.initialPosition.clone().divideScalar(Math.max(0.1, opts.scale));
  const vel = opts.initialVelocity.clone();
  const trailHistory: THREE.Vector3[] = [];

  function acceleration(p: THREE.Vector3, outAcc: THREE.Vector3) {
    // Softened binary/ternary gravitational wells + confining harmonic envelope
    const r2 = p.lengthSq() + 0.35;
    const invR3 = 1.0 / Math.pow(r2, 1.5);
    // Anisotropic 3-lobe Henon-Heiles / 3-body tidal perturbation
    const tidalX = -0.45 * (2 * p.x * p.z);
    const tidalY = -0.65 * p.y;
    const tidalZ = -0.45 * (p.x * p.x - p.z * p.z);
    outAcc.set(
      -p.x * invR3 * 1.4 - 0.18 * p.x + tidalX * 0.25,
      -p.y * invR3 * 1.6 - 0.32 * p.y + tidalY * 0.25,
      -p.z * invR3 * 1.4 - 0.18 * p.z + tidalZ * 0.25,
    );
  }

  const k1x = new THREE.Vector3();
  const k1v = new THREE.Vector3();
  const k2x = new THREE.Vector3();
  const k2v = new THREE.Vector3();
  const k3x = new THREE.Vector3();
  const k3v = new THREE.Vector3();
  const k4x = new THREE.Vector3();
  const k4v = new THREE.Vector3();
  const tmpP = new THREE.Vector3();

  function stepRK4(h: number) {
    k1x.copy(vel);
    acceleration(pos, k1v);

    tmpP.copy(pos).addScaledVector(k1x, h * 0.5);
    k2x.copy(vel).addScaledVector(k1v, h * 0.5);
    acceleration(tmpP, k2v);

    tmpP.copy(pos).addScaledVector(k2x, h * 0.5);
    k3x.copy(vel).addScaledVector(k2v, h * 0.5);
    acceleration(tmpP, k3v);

    tmpP.copy(pos).addScaledVector(k3x, h);
    k4x.copy(vel).addScaledVector(k3v, h);
    acceleration(tmpP, k4v);

    pos.addScaledVector(k1x, h / 6).addScaledVector(k2x, h / 3).addScaledVector(k3x, h / 3).addScaledVector(k4x, h / 6);
    vel.addScaledVector(k1v, h / 6).addScaledVector(k2v, h / 3).addScaledVector(k3v, h / 3).addScaledVector(k4v, h / 6);
  }

  return {
    kind: 'chaotic-attractor',
    evaluate(_time: number, dt: number, outPosition: THREE.Vector3, outVelocity?: THREE.Vector3) {
      const clampedDt = Math.min(0.05, Math.max(0.001, dt)) * opts.speed;
      stepRK4(clampedDt);
      outPosition.copy(pos).multiplyScalar(opts.scale);
      if (outVelocity) {
        outVelocity.copy(vel).multiplyScalar(opts.scale * opts.speed);
      }
      trailHistory.unshift(outPosition.clone());
      if (trailHistory.length > 96) trailHistory.pop();
    },
    sampleOrbitCurve(_time: number, _segments: number): THREE.Vector3[] {
      return trailHistory;
    },
  };
}
