// Only this route imports this entry; the heavy module is additionally conditional.
const root = document.querySelector<HTMLElement>('#universe');
if (root) {
  const compact = matchMedia('(max-width: 700px), (pointer: coarse)');
  const reading = root.querySelector<HTMLElement>('#reading-view')!;
  const space = root.querySelector<HTMLElement>('#space')!;
  const message = root.querySelector<HTMLElement>('#reading-message')!;
  let dispose: (() => void) | undefined;
  let generation = 0;
  let stopped = false;
  const showReading = (text: string) => {
    root.dataset.mode = 'reading';
    reading.hidden = false;
    space.hidden = true;
    message.textContent = text;
    root.querySelector<HTMLButtonElement>('#back')!.hidden = true;
    root.querySelector<HTMLButtonElement>('#overview')!.hidden = true;
  };
  async function start() {
    const ticket = ++generation;
    dispose?.();
    dispose = undefined;
    if (compact.matches) {
      showReading('A reading view of the same universe. Explore the connections below; the spatial experience is available on desktop.');
      return;
    }
    showReading('Opening the spatial view. You can also follow the connections below.');
    try {
      const { mountUniverse } = await import('./scene');
      if (ticket !== generation || stopped) return;
      space.hidden = false;
      dispose = mountUniverse(root!);
      root!.dataset.mode = 'space';
      reading.hidden = true;
    } catch (error) {
      console.warn('Spatial view unavailable; keeping the reading view.', error);
      showReading('The spatial view could not start on this device. All the same interests and projects remain accessible below.');
    }
  }
  const onChange = () => { void start(); };
  const onPageHide = () => { stopped = true; generation++; dispose?.(); dispose = undefined; };
  const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) { stopped = false; void start(); } };
  compact.addEventListener('change', onChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  void start();
  if (import.meta.hot) import.meta.hot.dispose(() => {
    onPageHide();
    compact.removeEventListener('change', onChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  });
}
