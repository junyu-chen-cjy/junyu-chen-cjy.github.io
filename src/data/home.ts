// Public facts and owner-confirmed updates; IDs are independent of display order.
export const person = {
  name: 'Junyu Chen',
  firstName: 'Junyu',
  lastName: 'Chen',
  university: 'Fudan University',
  introduction: 'An undergraduate in Artificial Intelligence at Fudan University.',
  affiliation: 'Undergraduate Student in Artificial Intelligence, School of Computing and Intelligence Innovation, Fudan University',
  biography: "I'm interested in research, advanced study, and building intelligent systems, while keeping an open mind about where that might lead.",
  researchIntroduction: "My broad interests connect learning, perception, and action. Within that foundation, I'm exploring several paths toward more general intelligent systems. My focus is still evolving as I learn how these directions fit together.",
  email: 'cyhy1069@gmail.com',
  github: 'https://github.com/junyu-chen-cjy',
  cvUrl: '/CV.pdf',
};

export const researchInterestGroups = [
  {
    id: 'broad-interests',
    title: 'Broad interests',
    interests: [
      { id: 'deep-learning', title: 'Deep Learning' },
      { id: 'reinforcement-learning', title: 'Reinforcement Learning' },
      { id: 'multimodal-learning', title: 'Multimodal Learning' },
      { id: 'embodied-intelligence', title: 'Embodied Intelligence' },
    ],
  },
  {
    id: 'currently-exploring',
    title: 'Currently exploring',
    interests: [
      { id: 'world-models', title: 'World Models' },
      { id: 'vision-language-models', title: 'Vision-Language Models (VLMs)' },
      { id: 'end-to-end-learning', title: 'End-to-End Learning & Intelligent Systems' },
      { id: 'agents-reasoning', title: 'Agents, Reasoning & Post-training' },
    ],
  },
];

export const projects = [
  {
    id: 'alphazero',
    title: 'AlphaZero Implementation',
    summary: 'An in-progress effort to reproduce AlphaZero using Monte-Carlo Tree Search.',
    description: "I'm still developing the implementation and exploring self-play for board games; the project is not yet complete.",
    url: 'https://github.com/junyu-chen-cjy/alphazero',
  },
  {
    id: 'mnist',
    title: 'MNIST Classification Experiment',
    summary: 'Handwritten digit recognition using convolutional neural networks.',
    description: 'Completed dataset pipeline, model training and result visualization for basic vision tasks.',
    url: 'https://github.com/junyu-chen-cjy/MNIST',
  },
];
