import type { RegionId, SystemId } from './semantic';

// Spatial mapping layer: translates semantic entities into a continuous multi-scale 3D cosmos.
// Moving a coordinate or changing galaxy morphology never alters content IDs, semantic relations, or canonical URLs.
export type Vec3 = [number, number, number];

export interface ContentPlacement {
  contentId: string;
  position: Vec3;
  radius: number;
  orbitInclination: number;
  orbitSpeed: number;
  color: string;
  atmosphereColor: string;
  hasRings?: boolean;
}

export interface SystemPlacement {
  id: SystemId;
  // Coordinates in the galaxy's local disk frame (before galaxy 3D tilt is applied),
  // ensuring every stellar system is physically embedded within the tilted spiral arms.
  position: Vec3;
  clusterRadius: number;
  accentColor: string;
  approachOffset: Vec3;
  connections: SystemId[];
  contents: ContentPlacement[];
}

export interface GalaxyPalette {
  core: string;
  inner: string;
  outer: string;
  nebula: string;
  dust: string;
  accent: string;
}

export interface GalaxyPlacement {
  id: RegionId;
  position: Vec3;
  radius: number;
  color: string;
  palette: GalaxyPalette;
  morphology: 'barred-spiral' | 'ring-spiral';
  arms: number;
  barRadius: number;
  armWind: number;
  thickness: number;
  tilt: Vec3;
  seed: number;
  approachOffset: Vec3;
  systems: SystemPlacement[];
}

export interface DeepFieldGalaxySpec {
  position: Vec3;
  radius: number;
  tilt: Vec3;
  colorCore: string;
  colorArm: string;
  seed: number;
}

const primaryBody = (
  contentId: string,
  color = '#f4dca8',
  atmosphereColor = '#a8d4c9',
  hasRings = true,
): ContentPlacement => ({
  contentId,
  position: [0, 0, 0],
  radius: 1.55,
  orbitInclination: 0,
  orbitSpeed: 0,
  color,
  atmosphereColor,
  hasRings,
});

const companionBody = (
  contentId: string,
  position: Vec3,
  color = '#8cb5ae',
  atmosphereColor = '#cfe6df',
  radius = 0.72,
  orbitInclination = 0.14,
  orbitSpeed = 0.12,
  hasRings = false,
): ContentPlacement => ({
  contentId,
  position,
  radius,
  orbitInclination,
  orbitSpeed,
  color,
  atmosphereColor,
  hasRings,
});

export const galaxies: GalaxyPlacement[] = [
  {
    id: 'research',
    position: [-215, 24, -35],
    radius: 235,
    color: '#b8d8be',
    palette: {
      core: '#fff1d0',
      inner: '#e5c99b',
      outer: '#7daeb8',
      nebula: '#92c4bd',
      dust: '#04070b',
      accent: '#e8c496',
    },
    morphology: 'barred-spiral',
    arms: 2,
    barRadius: 46,
    armWind: 4.35,
    thickness: 0.13,
    tilt: [0.54, 0.18, -0.24],
    seed: 31,
    approachOffset: [18, 72, 165],
    systems: [
      {
        id: 'learning',
        position: [-58, 3, 44],
        clusterRadius: 28,
        accentColor: '#f0cfa1',
        approachOffset: [4, 7.5, 23],
        connections: ['agency', 'integrated', 'perception'],
        contents: [
          primaryBody('deep-learning', '#f5d8a6', '#9ecbc2', true),
          companionBody('reinforcement-learning', [7.8, 0.9, 3.6], '#8fb8af', '#d8ebe5', 0.78, 0.16, 0.14, true),
        ],
      },
      {
        id: 'perception',
        position: [-28, -4, -68],
        clusterRadius: 25,
        accentColor: '#9fd4cb',
        approachOffset: [-3, 7, 22],
        connections: ['world', 'learning'],
        contents: [
          primaryBody('multimodal-learning', '#dfece8', '#7fbab5', true),
          companionBody('vision-language-models', [7.4, -0.8, 3.2], '#a8c7d4', '#e0f0f5', 0.74, -0.14, 0.15),
        ],
      },
      {
        id: 'world',
        position: [64, 5, -52],
        clusterRadius: 27,
        accentColor: '#a8d5ba',
        approachOffset: [3, 7.5, 22],
        connections: ['perception', 'embodied'],
        contents: [
          primaryBody('world-models', '#e8d7b4', '#8cc4b2', true),
          companionBody('embodied-intelligence', [7.2, 1.1, -3.8], '#89b3a3', '#cbe3d8', 0.72, 0.18, 0.13),
        ],
      },
      {
        id: 'embodied',
        position: [98, -3, 38],
        clusterRadius: 24,
        accentColor: '#c2d9b4',
        approachOffset: [-4, 6.8, 21],
        connections: ['world', 'agency', 'integrated'],
        contents: [
          primaryBody('embodied-intelligence', '#dce3c8', '#9abfb0', true),
          companionBody('end-to-end-learning', [-7.5, 0.8, 3.5], '#96b3ab', '#d4e6e0', 0.7, -0.15, 0.14),
        ],
      },
      {
        id: 'agency',
        position: [14, 4, 86],
        clusterRadius: 26,
        accentColor: '#f2c894',
        approachOffset: [2, 7.2, 22],
        connections: ['learning', 'embodied'],
        contents: [
          primaryBody('agents-reasoning', '#f5cba0', '#e3a87b', true),
          companionBody('reinforcement-learning', [-7.6, -0.7, 3.4], '#b8a98c', '#eddac0', 0.75, 0.12, 0.16),
        ],
      },
      {
        id: 'integrated',
        position: [-104, -2, -26],
        clusterRadius: 24,
        accentColor: '#98c1c9',
        approachOffset: [4, 6.8, 21],
        connections: ['learning', 'embodied'],
        contents: [
          primaryBody('end-to-end-learning', '#cfe3df', '#7eaab5', true),
          companionBody('deep-learning', [7.1, -0.9, 3.7], '#9cb8be', '#dcebed', 0.72, -0.16, 0.13),
        ],
      },
    ],
  },
  {
    id: 'building',
    position: [235, -28, -115],
    radius: 185,
    color: '#e5ba8c',
    palette: {
      core: '#fff0d4',
      inner: '#e6a56c',
      outer: '#88aba8',
      nebula: '#d99568',
      dust: '#05070a',
      accent: '#f2c48d',
    },
    morphology: 'ring-spiral',
    arms: 2,
    barRadius: 32,
    armWind: 3.4,
    thickness: 0.11,
    tilt: [0.68, -0.36, 0.3],
    seed: 73,
    approachOffset: [-16, 64, 145],
    systems: [
      {
        id: 'alphazero',
        position: [-46, 2, 34],
        clusterRadius: 30,
        accentColor: '#f5be82',
        approachOffset: [3, 7.2, 23],
        connections: ['mnist'],
        contents: [
          primaryBody('alphazero', '#f7c98b', '#e0935a', true),
          companionBody('reinforcement-learning', [7.8, 1.0, 3.2], '#c99c72', '#f2d5b8', 0.76, 0.17, 0.15, true),
          companionBody('deep-learning', [-6.4, -0.9, -4.4], '#8aa8a4', '#cde0dd', 0.64, -0.2, 0.11),
        ],
      },
      {
        id: 'mnist',
        position: [52, -2, -32],
        clusterRadius: 25,
        accentColor: '#d9b58c',
        approachOffset: [-3, 6.8, 21],
        connections: ['alphazero'],
        contents: [
          primaryBody('mnist', '#ebd1a7', '#9bb8b3', true),
          companionBody('deep-learning', [-7.2, 0.8, 3.6], '#9ab3ad', '#d9e8e4', 0.72, 0.14, 0.14),
        ],
      },
    ],
  },
];

export const deepFieldGalaxies: DeepFieldGalaxySpec[] = [
  { position: [-920, 290, -1450], radius: 135, tilt: [0.9, 0.4, -0.5], colorCore: '#fae4be', colorArm: '#6c91a3', seed: 101 },
  { position: [840, 340, -1680], radius: 150, tilt: [0.45, -0.6, 0.2], colorCore: '#f2d2a7', colorArm: '#8ca69e', seed: 203 },
  { position: [25, -45, -1420], radius: 125, tilt: [0.62, 0.28, -0.35], colorCore: '#f6dec0', colorArm: '#7ba3b0', seed: 257 },
  { position: [-180, -360, -1820], radius: 115, tilt: [1.1, 0.2, 0.7], colorCore: '#ebd8bd', colorArm: '#758e9e', seed: 307 },
  { position: [1180, -240, -1320], radius: 95, tilt: [0.6, 0.5, -0.4], colorCore: '#f5cfa0', colorArm: '#7f9996', seed: 409 },
  { position: [-1150, -190, -1180], radius: 105, tilt: [0.75, -0.3, 0.4], colorCore: '#e8d9c5', colorArm: '#6d8a96', seed: 503 },
  { position: [-310, 110, 1380], radius: 140, tilt: [0.55, -0.4, 0.3], colorCore: '#f4dcb8', colorArm: '#7c9ea8', seed: 607 },
  { position: [380, -130, 1460], radius: 120, tilt: [0.82, 0.35, -0.45], colorCore: '#f0caa0', colorArm: '#88a49e', seed: 709 },
  { position: [-1480, 95, 180], radius: 130, tilt: [0.7, 0.25, -0.6], colorCore: '#f5e0c4', colorArm: '#7496a6', seed: 811 },
  { position: [1520, -85, 220], radius: 125, tilt: [0.58, -0.48, 0.25], colorCore: '#f2cda2', colorArm: '#82a09c', seed: 919 },
];

export const overview = {
  target: [0, -2, -65] as Vec3,
  offset: [0, 98, 610] as Vec3,
};

export const cameraOffsets = {
  galaxy: [0, 68, 160] as Vec3,
  system: [0, 7.2, 22] as Vec3,
  content: [0, 1.4, 5.8] as Vec3,
};
