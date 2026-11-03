import * as THREE from 'three';
import { galaxies, overview, cameraOffsets, type GalaxyPlacement, type SystemPlacement, type ContentPlacement, type Vec3 } from './spatial';
import { regions, systems, contentById, type RegionId, type SystemId } from './semantic';

type View = { galaxy?: RegionId; system?: SystemId; content?: string };
type PointCloud = THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
type Target = { view: View; position: THREE.Vector3; radius: number; label: HTMLButtonElement; kind: 'galaxy' | 'system' | 'content' };
type LocalBody = { spec: ContentPlacement; mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>; halo: THREE.Sprite };
type LocalSystem = { spec: SystemPlacement; position: THREE.Vector3; marker: THREE.Sprite; local: THREE.Group; dust: PointCloud; bodies: LocalBody[]; orbits: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[] };
type Galaxy = { spec: GalaxyPlacement; position: THREE.Vector3; cloud: THREE.Group; grain: PointCloud; dust: PointCloud; core: THREE.Sprite; systems: LocalSystem[] };
const vector = (p: Vec3) => new THREE.Vector3(...p);
const clamp = THREE.MathUtils.clamp;
const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);
const levelOf = (v: View) => v.content ? 3 : v.system ? 2 : v.galaxy ? 1 : 0;
function random(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function mountUniverse(root: HTMLElement): () => void {
  const canvas = root.querySelector<HTMLCanvasElement>('#universe-canvas')!;
  const space = root.querySelector<HTMLElement>('#space')!;
  const labels = root.querySelector<HTMLElement>('#space-labels')!;
  labels.replaceChildren();
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
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let disposed = false;
  let frame = 0;
  let dirty = true;
  let lastRender = 0;
  let elapsed = 0;
  let view: View = {};
  let visualView: View = {};
  let depth = 0;
  let zoom = 1;
  let navigationFinished = 0;
  let hovered: Target | undefined;
  const pointer = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const projection = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const rayHit = new THREE.Vector3();
  const reduceOffset = new THREE.Vector3();
  const baseTarget = vector(overview.target);
  const basePosition = baseTarget.clone().add(vector(overview.offset));
  let flight: { start: number; duration: number; from: THREE.Vector3; to: THREE.Vector3; targetFrom: THREE.Vector3; targetTo: THREE.Vector3; depthFrom: number; depthTo: number; navigation: boolean } | undefined;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor('#080e12');
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#080e12', 0.00075);
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.08, 2400);
  camera.position.copy(basePosition);
  camera.lookAt(baseTarget);
  scene.add(new THREE.HemisphereLight('#e9e1c9', '#172a2b', 2.2));
  const light = new THREE.DirectionalLight('#f5dfb9', 3.2);
  light.position.set(-80, 90, 130);
  scene.add(light);

  // One tiny, procedural radial texture is shared by every particle and halo.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const context = glowCanvas.getContext('2d')!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, 'rgba(255,255,255,.75)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const glow = new THREE.CanvasTexture(glowCanvas);
  const sphereGeometry = new THREE.SphereGeometry(1, 32, 20);
  const targets: Target[] = [];

  function cloud(count: number, seed: number, radius: number, color: string, size: number, disk = true): PointCloud {
    const rand = random(seed);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new THREE.Color(color);
    const warm = new THREE.Color('#e8cba4');
    for (let i = 0; i < count; i++) {
      const r = (disk ? Math.pow(rand(), 0.7) : 0.35 + rand() * 0.65) * radius;
      const angle = disk ? (i % 3) * Math.PI * 2 / 3 + r / radius * 5.4 + (rand() - 0.5) * 0.65 : rand() * Math.PI * 2;
      const height = disk ? (rand() + rand() + rand() - 1.5) * radius * 0.12 : (rand() - 0.5) * radius * 1.7;
      positions.set([Math.cos(angle) * r, height, Math.sin(angle) * r], i * 3);
      const c = base.clone().lerp(warm, (1 - r / radius) * 0.55).multiplyScalar(0.45 + rand() * 0.55);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size, map: glow, transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    return new THREE.Points(geometry, material);
  }
  function halo(color: string, size: number) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color, map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.scale.setScalar(size);
    return sprite;
  }
  function addTarget(kind: Target['kind'], state: View, position: THREE.Vector3, radius: number, title: string, subtitle: string) {
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'space-label';
    label.dataset.kind = kind;
    const name = document.createElement('strong');
    name.textContent = title;
    const meta = document.createElement('small');
    meta.textContent = subtitle;
    label.append(name, meta);
    label.hidden = true;
    label.addEventListener('click', () => navigate(state));
    label.addEventListener('pointerenter', () => { hovered = target; });
    label.addEventListener('focus', () => { hovered = target; });
    const target: Target = { kind, view: state, position, radius, label };
    targets.push(target);
    labels.append(label);
  }

  const stars = cloud(1400, 12, 1150, '#d4d8c9', 3.2, false);
  scene.add(stars);
  const runtime: Galaxy[] = galaxies.map(spec => {
    const position = vector(spec.position);
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.set(...spec.tilt);
    const grain = cloud(spec.id === 'research' ? 3400 : 2400, spec.seed, spec.radius, spec.color, 2.2);
    const dust = cloud(450, spec.seed + 10, spec.radius * 0.95, spec.color, 14);
    dust.material.opacity = 0.12;
    const core = halo(spec.color, 28);
    core.material.opacity = 0.45;
    group.add(grain, dust, core);
    scene.add(group);
    addTarget('galaxy', { galaxy: spec.id }, position.clone(), spec.radius * 0.8, regions[spec.id].title, `${spec.systems.length} connected systems · enter`);
    const localSystems = spec.systems.map(system => {
      const center = position.clone().add(vector(system.position));
      const marker = halo(spec.color, 6);
      marker.position.copy(center);
      scene.add(marker);
      const local = new THREE.Group();
      local.position.copy(center);
      local.visible = false;
      const localDust = cloud(180, spec.seed + system.position[0], 11, spec.color, 0.1);
      local.add(localDust);
      const orbits: LocalSystem['orbits'] = [];
      const bodies = system.contents.map((body, index) => {
        const material = new THREE.MeshStandardMaterial({ color: index ? '#648077' : '#a4967c', roughness: 0.88, metalness: 0.05, transparent: true, emissive: '#15211b', emissiveIntensity: 0.12 });
        const mesh = new THREE.Mesh(sphereGeometry, material);
        mesh.scale.setScalar(body.radius);
        mesh.position.copy(vector(body.position));
        local.add(mesh);
        const bodyHalo = halo(spec.color, body.radius * 5);
        bodyHalo.position.copy(mesh.position);
        local.add(bodyHalo);
        if (index > 0) {
          const r = mesh.position.length();
          const points: THREE.Vector3[] = [];
          for (let n = 0; n <= 128; n++) { const angle = n / 128 * Math.PI * 2; points.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * body.position[1] * 0.5, Math.sin(angle) * r)); }
          const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: spec.color, transparent: true, opacity: 0.2, depthWrite: false }));
          local.add(orbit);
          orbits.push(orbit);
        }
        const content = contentById[body.contentId];
        addTarget('content', { galaxy: spec.id, system: system.id, content: body.contentId }, center.clone().add(mesh.position), body.radius * 1.6, content.title, content.status ? `${content.kind} · ${content.status}` : content.kind);
        return { spec: body, mesh, halo: bodyHalo };
      });
      scene.add(local);
      addTarget('system', { galaxy: spec.id, system: system.id }, center.clone(), 7, systems[system.id].title, `${system.contents.length} connected objects`);
      return { spec: system, position: center, marker, local, dust: localDust, bodies, orbits };
    });
    return { spec, position, cloud: group, grain, dust, core, systems: localSystems };
  });

  function destination(state: View) {
    const galaxy = runtime.find(item => item.spec.id === state.galaxy);
    const system = galaxy?.systems.find(item => item.spec.id === state.system);
    let target = vector(overview.target);
    let offset = vector(overview.offset);
    if (galaxy) { target = galaxy.position.clone(); offset = vector(cameraOffsets.galaxy); }
    if (system) { target = system.position.clone(); offset = vector(cameraOffsets.system); }
    if (system && state.content) {
      const body = system.bodies.find(item => item.spec.contentId === state.content)!;
      target.add(body.mesh.position);
      offset = vector(cameraOffsets.content);
    }
    return { target, position: target.clone().add(offset.multiplyScalar(zoom)) };
  }
  function fly(state: View, duration: number, navigation: boolean) {
    const end = destination(state);
    flight = { start: performance.now(), duration: reduced.matches ? 100 : duration, from: basePosition.clone(), to: end.position, targetFrom: baseTarget.clone(), targetTo: end.target, depthFrom: depth, depthTo: levelOf(state), navigation };
    dirty = true;
    schedule();
  }
  function updateCaption() {
    const level = levelOf(view);
    root.dataset.level = ['universe', 'galaxy', 'system', 'content'][level];
    root.dataset.target = view.content ?? view.system ?? view.galaxy ?? 'overview';
    const region = view.galaxy ? regions[view.galaxy] : undefined;
    const system = view.system ? systems[view.system] : undefined;
    const content = view.content ? contentById[view.content] : undefined;
    levelName.textContent = [`01 / Universe`, `02 / Galaxy`, `03 / Stellar system`, `04 / Content`][level];
    heading.textContent = content?.title ?? system?.title ?? region?.title ?? "Junyu's universe";
    description.textContent = content?.summary ?? (system ? `${region?.title} / ${system.title}. Move closer to an object to read its story.` : region?.description ?? 'Research and building, seen from a different distance.');
    contentDescription.textContent = content?.description ?? '';
    contentDescription.hidden = !content?.description;
    contentLink.hidden = !content;
    contentLink.href = content?.href ?? '/';
    back.hidden = level === 0;
    reset.hidden = level === 0;
    hint.textContent = level === 0 ? 'Move to look · scroll to approach · click to focus' : 'Scroll to change scale · click to focus · Esc to go back';
  }
  function navigate(next: View) {
    // A single focus path constrains the camera, not the underlying content graph.
    // Keep the departing local context alive until its distance-based fade finishes.
    if (levelOf(next) >= levelOf(view)) visualView = { ...next };
    view = { ...next };
    zoom = 1;
    hovered = undefined;
    updateCaption();
    fly(view, levelOf(view) <= 1 ? 1900 : 1500, true);
  }
  function goBack() {
    if (view.content) navigate({ galaxy: view.galaxy, system: view.system });
    else if (view.system) navigate({ galaxy: view.galaxy });
    else navigate({});
  }
  function activeTargets() {
    if (!view.galaxy) return targets.filter(item => item.kind === 'galaxy');
    if (!view.system) return targets.filter(item => item.kind === 'system' && item.view.galaxy === view.galaxy);
    if (!view.content) return targets.filter(item => item.kind === 'content' && item.view.system === view.system);
    return [];
  }
  function nearestTarget() {
    const candidates = activeTargets();
    if (hovered && candidates.includes(hovered)) return hovered;
    let best: Target | undefined;
    let distance = Infinity;
    for (const target of candidates) {
      projection.copy(target.position).project(camera);
      const d = Math.hypot(projection.x - pointer.x, projection.y - pointer.y);
      if (projection.z < 1 && d < distance) { best = target; distance = d; }
    }
    return best;
  }
  function pick() {
    raycaster.setFromCamera(pointer, camera);
    let closest = Infinity;
    let found: Target | undefined;
    for (const target of activeTargets()) {
      sphere.center.copy(target.position);
      sphere.radius = target.radius;
      const hit = raycaster.ray.intersectSphere(sphere, rayHit);
      if (hit) { const distance = hit.distanceTo(camera.position); if (distance < closest) { closest = distance; found = target; } }
    }
    return found;
  }
  function onPointer(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    hovered = pick();
    canvas.style.cursor = hovered ? 'pointer' : 'default';
    dirty = true;
    schedule();
  }
  function onLeave() { pointer.set(0, 0); hovered = undefined; dirty = true; schedule(); }
  function onClick(event: PointerEvent) { onPointer(event); const target = pick(); if (target) navigate(target.view); }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    if (flight?.navigation || performance.now() - navigationFinished < 450) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    zoom = clamp(zoom * Math.exp(-clamp(delta, -140, 140) * 0.0017), 0.65, 1.4);
    if (zoom < 0.77 && levelOf(view) < 3) { const target = nearestTarget(); if (target) navigate(target.view); }
    else if (zoom > 1.25 && levelOf(view) > 0) goBack();
    else fly(view, 180, false);
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape' && levelOf(view) > 0) { event.preventDefault(); goBack(); }
    if (event.target !== canvas) return;
    if (event.key === 'Enter' || event.key === '+' || event.key === '=') { const target = nearestTarget(); if (target) { event.preventDefault(); navigate(target.view); } }
    if (event.key === '-' || event.key === 'Backspace') { event.preventDefault(); goBack(); }
    if (event.key === 'Home') { event.preventDefault(); navigate({}); }
  }
  function onResize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight, false);
    dirty = true;
    schedule();
  }
  function onMotion() { if (reduced.matches) return; paused = !paused; onMotionLabel(); dirty = true; schedule(); }
  function onReduced() { paused = reduced.matches; onMotionLabel(); dirty = true; schedule(); }
  function onMotionLabel() { motion.disabled = reduced.matches; motion.textContent = reduced.matches ? 'Motion reduced' : paused ? 'Resume motion' : 'Pause motion'; }
  function onVisibility() { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; lastRender = 0; } else { dirty = true; schedule(); } }
  function onLost(event: Event) {
    event.preventDefault();
    cleanup();
    root.dataset.mode = 'reading';
    root.querySelector<HTMLElement>('#space')!.hidden = true;
    root.querySelector<HTMLElement>('#reading-view')!.hidden = false;
    root.querySelector<HTMLElement>('#reading-message')!.textContent = 'The spatial view paused because graphics became unavailable. Continue exploring the same content here.';
    back.hidden = reset.hidden = true;
  }
  const onOverview = () => navigate({});
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('click', onClick);
  space.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('webglcontextlost', onLost);
  back.addEventListener('click', goBack);
  reset.addEventListener('click', onOverview);
  motion.addEventListener('click', onMotion);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener('change', onReduced);

  let metricsStart = performance.now();
  let rendered = 0;
  let renderTime = 0;
  function schedule() { if (!disposed && !document.hidden && !frame) frame = requestAnimationFrame(tick); }
  function tick(now: number) {
    frame = 0;
    if (disposed || document.hidden) return;
    if (now - lastRender < 1000 / 30 - 0.5) { schedule(); return; }
    const dt = lastRender ? Math.min((now - lastRender) / 1000, 0.1) : 0;
    lastRender = now;
    const live = !paused && !reduced.matches;
    if (live) elapsed += dt;
    if (flight) {
      const t = clamp((now - flight.start) / flight.duration, 0, 1);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      basePosition.lerpVectors(flight.from, flight.to, ease);
      baseTarget.lerpVectors(flight.targetFrom, flight.targetTo, ease);
      depth = THREE.MathUtils.lerp(flight.depthFrom, flight.depthTo, ease);
      if (t === 1) { if (flight.navigation) navigationFinished = now; flight = undefined; visualView = { ...view }; }
    }
    const lookAmount = live ? 1 : 0;
    parallax.lerp(pointer.clone().multiplyScalar(lookAmount), 1 - Math.exp(-dt * 5));
    const distance = basePosition.distanceTo(baseTarget);
    reduceOffset.set(parallax.x * distance * 0.024, parallax.y * distance * 0.012, 0);
    camera.position.copy(basePosition).add(reduceOffset);
    camera.lookAt(baseTarget);
    camera.updateMatrixWorld();
    const intoGalaxy = smooth(0.1, 0.9, depth);
    const intoSystem = smooth(1.2, 1.9, depth);
    const intoContent = smooth(2.2, 2.9, depth);
    stars.material.opacity = 0.7 - intoGalaxy * 0.3;
    for (const galaxy of runtime) {
      const selected = galaxy.spec.id === visualView.galaxy;
      const cloudOpacity = selected ? 1 - intoGalaxy * 0.45 - intoSystem * 0.51 : 1 - intoGalaxy * 0.96;
      galaxy.grain.material.opacity = cloudOpacity;
      galaxy.dust.material.opacity = cloudOpacity * 0.12;
      galaxy.core.material.opacity = cloudOpacity * 0.4;
      galaxy.cloud.rotation.y = galaxy.spec.tilt[1] + elapsed * 0.009;
      for (const system of galaxy.systems) {
        const localSelected = selected && system.spec.id === visualView.system;
        system.marker.material.opacity = (selected ? 0.2 + intoGalaxy * 0.65 : 0.12) * (1 - intoSystem * 0.98);
        system.marker.scale.setScalar(6 + Math.sin(elapsed * 0.3) * 0.15);
        system.local.visible = localSelected && intoSystem > 0.005;
        if (!system.local.visible) continue;
        system.dust.material.opacity = intoSystem * (0.28 - intoContent * 0.2);
        system.dust.rotation.y = elapsed * 0.025;
        for (const orbit of system.orbits) orbit.material.opacity = intoSystem * (0.22 - intoContent * 0.16);
        for (const body of system.bodies) {
          const relevant = !visualView.content || visualView.content === body.spec.contentId;
          const opacity = intoSystem * (relevant ? 1 : 1 - intoContent * 0.88);
          body.mesh.material.opacity = opacity;
          body.mesh.rotation.y = elapsed * 0.025;
          body.halo.material.opacity = opacity * 0.2;
        }
      }
    }
    // Labels resolve with approach: regions -> systems -> individual information.
    // They are real buttons, so the spatial route is also keyboard-accessible.
    const occupied: { x: number; y: number }[] = [];
    for (const target of targets) {
      let alpha = 0;
      if (target.kind === 'galaxy') alpha = 1 - smooth(0.15, 0.75, depth);
      if (target.kind === 'system' && target.view.galaxy === visualView.galaxy) alpha = smooth(0.4, 0.9, depth) * (1 - smooth(1.2, 1.8, depth));
      if (target.kind === 'content' && target.view.system === visualView.system) alpha = smooth(1.4, 1.95, depth) * (1 - smooth(2.25, 2.8, depth));
      projection.copy(target.position).project(camera);
      const x = (projection.x * 0.5 + 0.5) * innerWidth;
      let y = (-projection.y * 0.5 + 0.5) * innerHeight;
      const visible = alpha > 0.02 && projection.z > -1 && projection.z < 1 && x > 65 && x < innerWidth - 65 && y > 90 && y < innerHeight - 135;
      target.label.hidden = !visible;
      if (!visible) continue;
      for (const other of occupied) if (Math.abs(x - other.x) < 165 && Math.abs(y - other.y) < 65) y += 65;
      occupied.push({ x, y });
      target.label.style.left = `${x.toFixed(1)}px`;
      target.label.style.top = `${y.toFixed(1)}px`;
      target.label.style.opacity = `${alpha.toFixed(3)}`;
      target.label.disabled = alpha < 0.6 || !!flight?.navigation;
    }
    const renderStart = performance.now();
    renderer.render(scene, camera);
    renderTime += performance.now() - renderStart;
    rendered++;
    if (import.meta.env.DEV && now - metricsStart > 1000) {
      metrics.textContent = JSON.stringify({ level: root.dataset.level, fps: +(rendered * 1000 / (now - metricsStart)).toFixed(1), cpuRenderMs: +(renderTime / rendered).toFixed(2), drawCalls: renderer.info.render.calls, points: renderer.info.render.points, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio(), cameraDistance: +distance.toFixed(2), transitioning: !!flight });
      metricsStart = now; rendered = 0; renderTime = 0;
    }
    root.dataset.transitioning = String(!!flight);
    dirty = false;
    if (live || flight || dirty || parallax.length() > 0.001 && !live) schedule();
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    canvas.removeEventListener('pointermove', onPointer);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('click', onClick);
    space.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('webglcontextlost', onLost);
    back.removeEventListener('click', goBack);
    reset.removeEventListener('click', onOverview);
    motion.removeEventListener('click', onMotion);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    reduced.removeEventListener('change', onReduced);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    scene.traverse(object => {
      if ('geometry' in object) geometries.add(object.geometry as THREE.BufferGeometry);
      if ('material' in object) { const m = object.material as THREE.Material | THREE.Material[]; (Array.isArray(m) ? m : [m]).forEach(material => materials.add(material)); }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    glow.dispose();
    renderer.dispose();
    labels.replaceChildren();
    metrics.textContent = '';
  }
  updateCaption();
  onMotionLabel();
  schedule();
  return cleanup;
}
