import { projects, researchInterestGroups } from '../data/home';

// An adapter over the existing public source, not a second copy of its prose.
export interface ContentRecord {
  id: string;
  title: string;
  kind: 'Interest' | 'Project';
  summary: string;
  description?: string;
  status?: string;
  href: string;
}
export const contents: ContentRecord[] = [
  ...researchInterestGroups.flatMap(group => group.interests.map(interest => ({
    ...interest,
    kind: 'Interest' as const,
    summary: group.id === 'broad-interests'
      ? 'A broad research interest — an area I am learning about and exploring.'
      : 'A direction I am currently exploring. My interests are still evolving.',
    href: '/#research',
  }))),
  ...projects.map(project => ({
    ...project, kind: 'Project' as const, href: `/#${project.id}`,
    status: project.id === 'alphazero' ? 'in progress' : undefined,
  })),
];
export const contentById = Object.fromEntries(contents.map(item => [item.id, item]));

// Editorial relationships, independent of coordinates and visual parentage.
// Related interests do not imply completed research or project capabilities.
export const systems = {
  learning: { title: 'Learning', members: ['deep-learning', 'reinforcement-learning'] },
  perception: { title: 'Multimodal understanding', members: ['multimodal-learning', 'vision-language-models'] },
  world: { title: 'World models', members: ['world-models', 'embodied-intelligence'] },
  embodied: { title: 'Embodied intelligence', members: ['embodied-intelligence', 'end-to-end-learning'] },
  agency: { title: 'Agents & reasoning', members: ['agents-reasoning', 'reinforcement-learning'] },
  integrated: { title: 'End-to-end systems', members: ['end-to-end-learning', 'deep-learning'] },
  alphazero: { title: 'AlphaZero', members: ['alphazero', 'reinforcement-learning', 'deep-learning'] },
  mnist: { title: 'MNIST', members: ['mnist', 'deep-learning'] },
} satisfies Record<string, { title: string; members: string[] }>;
export type SystemId = keyof typeof systems;
export const regions = {
  research: { title: 'Research', description: 'Connected directions in learning, perception and action.', systems: ['learning', 'perception', 'world', 'embodied', 'agency', 'integrated'] as SystemId[] },
  building: { title: 'Building', description: 'Experiments and implementations, at their actual stage of development.', systems: ['alphazero', 'mnist'] as SystemId[] },
};
export type RegionId = keyof typeof regions;
