// Interactive 3D and canvas scenes for Day 2 and Day 3.
// One WebGL renderer moves to whichever slide is active; each scene is built on first visit.
// Scenes work in ROS coordinates (x forward, y left, z up) inside `world`, which is rotated into three.js y-up.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import URDFLoader from './vendor/urdf-loader/URDFLoader.js';

const C = { cyan: 0x58e0d2, blue: 0x6aa8ff, orange: 0xffb15a, pink: 0xff729f, ink: 0xf7f8fb, muted: 0xa8b0c3, bg: 0x080d19, green: 0x7ddc7a };
const CSS = { cyan: '#58e0d2', blue: '#6aa8ff', orange: '#ffb15a', pink: '#ff729f', ink: '#f7f8fb', muted: '#a8b0c3', line: 'rgba(255,255,255,.13)', green: '#7ddc7a' };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isPaused = () => document.body.classList.contains('anim-paused') || reduceMotion.matches;

// ---------- robots ----------
const ARM = ['panda_joint1', 'panda_joint2', 'panda_joint3', 'panda_joint4', 'panda_joint5', 'panda_joint6', 'panda_joint7'];
const HOME = [0, -0.785, 0, -2.356, 0, 1.571, 0.785];

function loadURDF(url, packages) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    const loader = new URDFLoader(manager);
    loader.packages = packages;
    loader.parseCollision = true;
    let robot;
    manager.onLoad = () => resolve(robot);   // fires once every mesh has arrived
    manager.onError = u => reject(new Error('could not load ' + u));
    loader.load(url, r => { robot = r; }, undefined, reject);
  });
}
let pandaBase, tbBase;
const panda = async () => {
  pandaBase ??= loadURDF('assets/robots/panda/urdf/panda.urdf', { moveit_resources_panda_description: 'assets/robots/panda' })
    .then(r => { showColliders(r, false); return r; });
  return (await pandaBase).clone();
};
const turtlebot = async () => {
  tbBase ??= loadURDF('assets/robots/turtlebot3/urdf/turtlebot3_burger.urdf', { turtlebot3_description: 'assets/robots/turtlebot3' })
    .then(r => { showColliders(r, false); r.traverse(o => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xc9d1e3, roughness: .45, metalness: .25 }); }); return r; });
  return (await tbBase).clone();
};
function showColliders(robot, on) { robot.traverse(o => { if (o.isURDFCollider) o.visible = on; }); }
function ghost(robot, opacity = .22, color) {
  robot.traverse(o => {
    if (!o.isMesh) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
      const c = m.clone(); c.transparent = true; c.opacity = opacity; c.depthWrite = false; if (color) c.color = new THREE.Color(color); return c;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
  return robot;
}
function setArm(robot, q, finger) {
  ARM.forEach((n, i) => robot.joints[n].setJointValue(q[i]));
  if (finger !== undefined) { robot.joints.panda_finger_joint1.setJointValue(finger); robot.joints.panda_finger_joint2.setJointValue(finger); }
}
const armQ = robot => ARM.map(n => robot.joints[n].angle);
const LIMITS = r => ARM.map(n => [r.joints[n].limit.lower, r.joints[n].limit.upper]);

// ---------- small math ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, s) => a + (b - a) * s;
const smooth = x => x * x * (3 - 2 * x);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const rng = seed => () => ((seed = (seed + 0x6D2B79F5) | 0), (((seed ^= seed >>> 15) * (seed | 1)) >>> 0) / 4294967296);
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
// Solve A x = b for a small dense system (Gaussian elimination with partial pivoting).
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
const det3 = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
// 2D poses for mobile robots: [x, y, yaw]
const compose = (a, b) => [a[0] + Math.cos(a[2]) * b[0] - Math.sin(a[2]) * b[1], a[1] + Math.sin(a[2]) * b[0] + Math.cos(a[2]) * b[1], wrap(a[2] + b[2])];
const inverse = a => [-Math.cos(a[2]) * a[0] - Math.sin(a[2]) * a[1], Math.sin(a[2]) * a[0] - Math.cos(a[2]) * a[1], -a[2]];
const fmtPose = p => `x ${p[0].toFixed(2)}  y ${p[1].toFixed(2)}  yaw ${p[2].toFixed(2)}`;

// Numeric 6D damped-least-squares IK on an off-screen Panda clone. Poses are in the robot base frame.
async function makeIK() {
  const r = await panda();
  const hand = r.links.panda_hand, lim = LIMITS(r);
  const fk = q => { setArm(r, q); r.updateMatrixWorld(true); return hand.matrixWorld.clone(); };
  const axes = m => [0, 1, 2].map(i => new THREE.Vector3().setFromMatrixColumn(m, i));
  const pos = m => new THREE.Vector3().setFromMatrixPosition(m);
  function twist(from, to) {   // small pose difference from -> to as [dx dy dz rx ry rz]
    const d = pos(to).sub(pos(from)), af = axes(from), at = axes(to), w = new THREE.Vector3();
    for (let i = 0; i < 3; i++) w.add(new THREE.Vector3().crossVectors(af[i], at[i]).multiplyScalar(.5));
    return [d.x, d.y, d.z, w.x, w.y, w.z];
  }
  function jacobian(q, M) {
    const h = 1e-4, J = [[], [], [], [], [], []];
    for (let j = 0; j < 7; j++) { const qj = q.slice(); qj[j] += h; const t = twist(M, fk(qj)); for (let i = 0; i < 6; i++) J[i][j] = t[i] / h; }
    return J;
  }
  function solveIK(target, seed, { iters = 60, wOri = .6, lambda = .03 } = {}) {
    let q = seed.slice(), M = fk(q), e;
    for (let it = 0; it < iters; it++) {
      e = twist(M, target).map((v, i) => (i > 2 ? v * wOri : v));
      if (Math.hypot(...e) < 1e-4) break;
      const J = jacobian(q, M).map((row, i) => (i > 2 ? row.map(v => v * wOri) : row));
      const JJt = J.map(a => J.map(b => a.reduce((s, v, k) => s + v * b[k], 0) + 0));
      JJt.forEach((row, i) => (row[i] += lambda * lambda));
      const y = solve(JJt, e);
      q = q.map((qi, k) => clamp(qi + J.reduce((s, row, i) => s + row[k] * y[i], 0), lim[k][0], lim[k][1]));
      M = fk(q);
    }
    const err = pos(target).distanceTo(pos(M));
    const Jp = jacobian(q, M).slice(0, 3), JJ = Jp.map(a => Jp.map(b => a.reduce((s, v, k) => s + v * b[k], 0)));
    return { q, err, manip: Math.sqrt(Math.max(det3(JJ), 0)), M };
  }
  const homeM = fk(HOME);
  const down = p => { const m = homeM.clone(); m.setPosition(p[0], p[1], p[2]); return m; };   // hand pointing down, like home
  return { fk, solveIK, down, pos, lim };
}
let ikShared;
const ik = () => (ikShared ??= makeIK());

// ---------- scene helpers ----------
function base3d({ cam = [1.6, 1.1, 1.6], target = [0, .4, 0], grid = 3 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a2238, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  if (grid) { const g = new THREE.GridHelper(grid, grid * 10, C.cyan, 0x24304f); g.material.opacity = .3; g.material.transparent = true; scene.add(g); }
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);
  const camera = new THREE.PerspectiveCamera(40, 1, .01, 60);
  camera.position.set(...cam);
  return { scene, world, camera, target: new THREE.Vector3(...target) };
}
function label(text, cls = '') {
  const d = document.createElement('div'); d.className = 'frame-label ' + cls; d.textContent = text;
  return new CSS2DObject(d);
}
function frame(size, text, cls) {
  const g = new THREE.Group(); const a = new THREE.AxesHelper(size);
  a.material.depthTest = false; a.renderOrder = 3; g.add(a);
  if (text) { const l = label(text, cls); l.position.set(0, 0, size * .25); g.add(l); }
  return g;
}
function trail(color, n = 600) {
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 }));
  line.frustumCulled = false;
  let count = 0;
  line.push = (x, y, z) => {
    const a = geo.attributes.position.array;
    if (count >= n) { a.copyWithin(0, 3); count = n - 1; }
    a.set([x, y, z], count * 3); count++; geo.setDrawRange(0, count); geo.attributes.position.needsUpdate = true;
  };
  line.clear = () => { count = 0; geo.setDrawRange(0, 0); };
  return line;
}
function box(sx, sy, sz, color, opacity = 1) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: .7, transparent: opacity < 1, opacity }));
  return m;
}

// Panel UI. Buttons and sliders blur after use so arrow keys and Space keep driving the slides.
function ui(panel) {
  panel.replaceChildren();
  const add = el => (panel.append(el), el);
  return {
    row(...els) { const d = document.createElement('div'); d.className = 'scene-buttons'; d.append(...els); return add(d); },
    button(text, fn, on = false) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.classList.toggle('on', on);
      b.addEventListener('click', () => { fn(b); b.blur(); }); return b;
    },
    slider(name, min, max, step, value, fn, fmt = v => (+v).toFixed(2)) {
      const l = document.createElement('label'); l.className = 'scene-slider';
      l.innerHTML = `<span>${name}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output></output>`;
      const input = l.querySelector('input'), out = l.querySelector('output');
      out.textContent = fmt(value);
      input.addEventListener('input', () => { out.textContent = fmt(input.value); fn(+input.value); });
      input.addEventListener('change', () => input.blur());
      add(l);
      return { set(v) { input.value = v; out.textContent = fmt(v); }, input };
    },
    readout(html = '') { const d = document.createElement('div'); d.className = 'scene-readout'; d.innerHTML = html; return add(d); },
    text(html, cls = 'scene-hint') { const p = document.createElement('p'); p.className = cls; p.innerHTML = html; return add(p); },
    list(items) { const o = document.createElement('ol'); o.className = 'scene-steps'; o.innerHTML = items.map(i => `<li>${i}</li>`).join(''); add(o); return [...o.children]; },
    canvas(h) { const c = document.createElement('canvas'); c.className = 'scene-plot'; c.style.height = h + 'px'; return add(c); },
  };
}
function fit2d(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}
function plotLines(canvas, series, { yMin, yMax, cursor, title, xMax = 1 } = {}) {
  const { ctx, w, h } = fit2d(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = CSS.line; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, w - 1, h - 1);
  const Y = v => h - 4 - ((v - yMin) / (yMax - yMin)) * (h - 8), X = x => (x / xMax) * w;
  if (yMin < 0 && yMax > 0) { ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); }
  for (const s of series) {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.setLineDash(s.dash || []); ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(clamp(y, yMin, yMax))) : ctx.moveTo(X(x), Y(clamp(y, yMin, yMax)))));
    ctx.stroke(); ctx.setLineDash([]);
    for (const x of s.spikes || []) { ctx.strokeStyle = s.color; ctx.beginPath(); ctx.moveTo(X(x), 2); ctx.lineTo(X(x), h - 2); ctx.stroke(); }
  }
  if (cursor !== undefined) { ctx.strokeStyle = CSS.ink; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(X(cursor), 0); ctx.lineTo(X(cursor), h); ctx.stroke(); ctx.globalAlpha = 1; }
  if (title) { ctx.fillStyle = CSS.muted; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillText(title, 6, 13); }
}

// ======================================================================
// Scenes. Each returns { scene, world, camera, target, update(t, dt), reset() } or a 2D { canvas, update }.
// ======================================================================
const SCENES = {};

// ---------- Day 2 · TF2: map, odom, base_link with odometry drift ----------
SCENES['tf-drive'] = async (panel) => {
  const s = base3d({ cam: [1.7, 2.1, 2.4], target: [0, 0, 0], grid: 6 });
  const bot = await turtlebot(), ghostBot = ghost(await turtlebot(), .25, C.orange);
  s.world.add(bot, ghostBot);
  const mapF = frame(.5, 'map', 'big'), odomF = frame(.35, 'odom', 'warn');
  s.world.add(mapF, odomF);
  bot.links.base_link.add(frame(.22, 'base_link'));
  bot.links.base_scan.add(frame(.12, 'base_scan', 'small'));
  const truthTrail = trail(C.cyan), odomTrail = trail(C.orange);
  s.world.add(truthTrail, odomTrail);
  const u = ui(panel);
  let localize = true, showGhost = true;
  u.row(u.button('localization on', b => { localize = !localize; b.textContent = localize ? 'localization on' : 'localization off'; b.classList.toggle('on', localize); }, true),
        u.button('odometry ghost', b => { showGhost = !showGhost; b.classList.toggle('on', showGhost); ghostBot.visible = showGhost; odomTrail.visible = showGhost; }, true));
  const out = u.readout(), flash = u.text('', 'scene-flash');
  u.text('Wheel odometry drifts. Localization publishes <b>map → odom</b> so that <b>map → base_link</b> stays right; watch the odom frame jump.');
  let truth, odom, mapToOdom, lastFix, fixFlash;
  const reset = () => { truth = [1.2, 0, Math.PI / 2]; odom = [1.2, 0, Math.PI / 2]; mapToOdom = [0, 0, 0]; lastFix = 0; fixFlash = -9; truthTrail.clear(); odomTrail.clear(); };
  reset();
  const place = (obj, p) => { obj.position.set(p[0], p[1], 0); obj.rotation.set(0, 0, p[2]); };
  return { ...s, reset, update(t, dt) {
    const v = .3, w = .25;
    for (let k = 0; k < 4; k++) {   // integrate in small steps
      const h = dt / 4;
      truth = [truth[0] + v * Math.cos(truth[2]) * h, truth[1] + v * Math.sin(truth[2]) * h, wrap(truth[2] + w * h)];
      odom = [odom[0] + v * 1.04 * Math.cos(odom[2]) * h, odom[1] + v * 1.04 * Math.sin(odom[2]) * h, wrap(odom[2] + (w + .035) * h)];
    }
    if (!localize) mapToOdom = [0, 0, 0];
    else if (t - lastFix > 3) { mapToOdom = compose(truth, inverse(odom)); lastFix = t; fixFlash = t; }
    const shown = compose(mapToOdom, odom);
    place(bot, shown); place(ghostBot, odom); place(odomF, mapToOdom);
    if (dt > 0) { truthTrail.push(shown[0], shown[1], .01); odomTrail.push(odom[0], odom[1], .01); }
    out.innerHTML = `<b>map → odom</b>  ${fmtPose(mapToOdom)}<br><b>odom → base_link</b>  ${fmtPose(odom)}<br><b>map → base_link</b>  ${fmtPose(shown)}`;
    flash.textContent = t - fixFlash < .8 ? 'map → odom corrected' : '';
  } };
};

// ---------- Day 2 · TF2: roll, pitch, yaw and the quaternion ----------
SCENES['rotation'] = async (panel) => {
  const s = base3d({ cam: [2.2, 1.6, 2.4], target: [0, .3, 0], grid: 3 });
  const parent = frame(1, 'parent', 'muted'); parent.children[0].material.opacity = .35; parent.children[0].material.transparent = true;
  const child = new THREE.Group(); child.position.set(0, 0, .3);
  child.add(frame(.8, 'child'));
  const body = box(.36, .22, .16, C.blue, .85); child.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .08, 24), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  lens.rotation.z = Math.PI / 2; lens.position.x = .22; child.add(lens);
  s.world.add(parent, child);
  const u = ui(panel);
  let auto = true, rpy = [0, 0, 0];
  const deg = v => `${(+v).toFixed(0)}°`;
  const sl = ['roll', 'pitch', 'yaw'].map((n, i) => u.slider(n, -180, 180, 1, 0, v => { auto = false; autoBtn.classList.remove('on'); rpy[i] = v * Math.PI / 180; }, deg));
  sl[1].input.min = -90; sl[1].input.max = 90;
  const autoBtn = u.button('auto sweep', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const out = u.readout(), cmd = u.readout(), warn = u.text('', 'scene-flash');
  const q = new THREE.Quaternion(), m = new THREE.Matrix4();
  const keys = [[0, 0, 0], [0, 0, 90], [0, 45, 90], [60, 45, 90], [60, 45, 0], [0, 0, 0]];
  return { ...s, reset() { auto = true; autoBtn.classList.add('on'); }, update(t) {
    if (auto) {
      const u_ = (t / 2.2) % (keys.length - 1), i = Math.floor(u_), f = smooth(u_ - i);
      rpy = keys[i].map((v, k) => lerp(v, keys[i + 1][k], f) * Math.PI / 180);
      rpy.forEach((v, k) => sl[k].set(v * 180 / Math.PI));
    }
    child.rotation.set(rpy[0], rpy[1], rpy[2], 'ZYX');   // tf2 setRPY: R = Rz(yaw) Ry(pitch) Rx(roll)
    q.setFromEuler(child.rotation); m.makeRotationFromQuaternion(q);
    const e = m.elements, row = i => [e[i], e[i + 4], e[i + 8]].map(v => v.toFixed(2).padStart(5)).join(' ');
    out.innerHTML = `<b>quaternion</b>  x ${q.x.toFixed(3)}  y ${q.y.toFixed(3)}  z ${q.z.toFixed(3)}  w ${q.w.toFixed(3)}<br><b>rotation matrix</b><br>${row(0)}<br>${row(1)}<br>${row(2)}`;
    cmd.innerHTML = `ros2 run tf2_ros static_transform_publisher --roll ${rpy[0].toFixed(3)} --pitch ${rpy[1].toFixed(3)} --yaw ${rpy[2].toFixed(3)} --frame-id parent --child-frame-id child`;
    warn.textContent = Math.abs(Math.abs(rpy[1]) - Math.PI / 2) < .09 ? 'gimbal lock: at pitch ±90° roll and yaw turn about the same axis' : '';
  } };
};

// ---------- Day 2 · URDF: assemble the Panda, visual vs collision ----------
SCENES['build-robot'] = async (panel) => {
  const s = base3d({ cam: [1.5, 1.0, 1.5], target: [0, .45, 0] });
  const r = await panda(); s.world.add(r);
  const LINKS = ['panda_link0', 'panda_link1', 'panda_link2', 'panda_link3', 'panda_link4', 'panda_link5', 'panda_link6', 'panda_link7', 'panda_hand', 'panda_leftfinger', 'panda_rightfinger'];
  const parts = Object.fromEntries(LINKS.map(n => [n, { vis: [], col: [] }]));
  r.traverse(o => { if ((o.isURDFVisual || o.isURDFCollider) && parts[o.parent?.urdfName]) parts[o.parent.urdfName][o.isURDFVisual ? 'vis' : 'col'].push(o); });
  const colMat = new THREE.MeshStandardMaterial({ color: C.orange, transparent: true, opacity: .45, depthWrite: false });
  Object.values(parts).forEach(p => p.col.forEach(c => c.traverse(o => { if (o.isMesh) o.material = colMat; })));
  const arrows = ARM.map(n => {
    const j = r.joints[n], a = new THREE.ArrowHelper(j.axis.clone(), new THREE.Vector3(), .16, C.orange, .05, .03);
    const l = label(n.replace('panda_', ''), 'small'); l.position.copy(j.axis).multiplyScalar(.18); a.add(l); j.add(a); return a;
  });
  const frames = LINKS.slice(0, 9).map(n => { const f = new THREE.AxesHelper(.09); f.material.depthTest = false; r.links[n].add(f); return f; });
  const u = ui(panel);
  let mode = 'visual', showFrames = false;
  const modeBtns = ['visual', 'collision', 'both'].map(m => u.button(m, () => { mode = m; modeBtns.forEach(b => b.classList.toggle('on', b.textContent === m)); }, m === mode));
  u.row(...modeBtns, u.button('frames', b => { showFrames = !showFrames; b.classList.toggle('on', showFrames); }));
  const steps = u.list(ARM.map(n => { const j = r.joints[n]; return `<code>${n}</code> ${j.jointType} [${j.limit.lower.toFixed(2)}, ${j.limit.upper.toFixed(2)}]`; }));
  u.text('This MoveIt description has <b>no &lt;inertial&gt; tags</b>: fine for planning, but Gazebo needs mass and inertia to simulate it.');
  const per = .7, build = LINKS.length * per;
  return { ...s, update(t) {
    const cycle = build + ARM.length * 1.2 + 1.5, tc = t % cycle;
    LINKS.forEach((n, i) => {
      const on = tc >= i * per;
      parts[n].vis.forEach(v => (v.visible = on && mode !== 'collision'));
      parts[n].col.forEach(c => (c.visible = on && mode !== 'visual'));
    });
    const wig = Math.floor((tc - build) / 1.2);
    const q = HOME.slice();
    if (tc > build && wig < ARM.length) q[wig] += .6 * Math.sin(((tc - build) % 1.2) / 1.2 * Math.PI * 2);
    setArm(r, q, .04);
    const active = tc < build ? Math.min(ARM.length - 1, Math.floor(tc / per) - 1) : wig;
    arrows.forEach((a, i) => (a.visible = tc >= (i + 1) * per && (tc < build || i === wig)));
    steps.forEach((li, i) => li.classList.toggle('on', i === active));
    frames.forEach(f => (f.visible = showFrames));
  } };
};

// ---------- Day 2 · Sensors: 360° lidar in a room ----------
SCENES['lidar'] = async (panel) => {
  const s = base3d({ cam: [0.2, 4.2, 3.6], target: [0, 0, 0], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const solids = [];
  const wall = (x, y, sx, sy) => { const b = box(sx, sy, .4, 0x3a4566); b.position.set(x, y, .2); s.world.add(b); solids.push(b); };
  wall(0, 2, 6, .1); wall(0, -2, 6, .1); wall(3, 0, .1, 4); wall(-3, 0, .1, 4);
  [[1.6, .9, .5, .5], [-1.5, -.8, .7, .4], [.2, -1.3, .4, .4]].forEach(([x, y, a, b]) => { const o = box(a, b, .35, 0x6aa8ff, .9); o.position.set(x, y, .175); s.world.add(o); solids.push(o); });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .5, 32), new THREE.MeshStandardMaterial({ color: 0xffb15a }));
  cyl.rotation.x = Math.PI / 2; cyl.position.set(-.6, 1.1, .25); s.world.add(cyl); solids.push(cyl);
  const bot = await turtlebot(); s.world.add(bot);
  const N = 360, RMIN = .12, RMAX = 3.5;   // LDS-01: 360 samples, 0.12-3.5 m
  const rays = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.pink, transparent: true, opacity: .25 }));
  rays.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)); rays.frustumCulled = false;
  const hits = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: C.pink, size: .045 }));
  hits.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); hits.frustumCulled = false;
  s.scene.add(rays, hits);
  const cam = new THREE.PerspectiveCamera(60, 4 / 3, .05, .7);
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
  cam.position.set(.03, 0, .12); bot.links.base_link.add(cam);
  const camHelper = new THREE.CameraHelper(cam); s.scene.add(camHelper); camHelper.visible = false;
  const gyro = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), .2, C.green, .05, .03);
  const accel = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), .2, C.cyan, .05, .03);
  bot.links.imu_link.add(gyro, accel); gyro.visible = accel.visible = false;
  const u = ui(panel);
  let noise = 0, showRays = true;
  u.row(u.button('rays', b => { showRays = !showRays; b.classList.toggle('on', showRays); rays.visible = showRays; }, true),
        u.button('camera', b => { camHelper.visible = !camHelper.visible; b.classList.toggle('on', camHelper.visible); }),
        u.button('imu', b => { gyro.visible = accel.visible = !gyro.visible; b.classList.toggle('on', gyro.visible); }));
  u.slider('noise σ', 0, .05, .005, 0, v => (noise = v), v => `${(+v * 100).toFixed(1)} cm`);
  const plot = u.canvas(170), out = u.readout();
  const rc = new THREE.Raycaster(); rc.near = RMIN; rc.far = RMAX;
  const origin = new THREE.Vector3(), dir = new THREE.Vector3(), rand = rng(7), ranges = new Float32Array(N);
  const path = a => [1.15 * Math.cos(a) + .1, .75 * Math.sin(2 * a)];
  return { ...s, update(t) {
    const a = t * .18, p = path(a), p2 = path(a + .01), yaw = Math.atan2(p2[1] - p[1], p2[0] - p[0]);
    bot.position.set(p[0], p[1], 0); bot.rotation.set(0, 0, yaw);
    bot.joints.wheel_left_joint.setJointValue(t * 6); bot.joints.wheel_right_joint.setJointValue(t * 6);
    s.scene.updateMatrixWorld(true);
    bot.links.base_scan.getWorldPosition(origin);
    const rp = rays.geometry.attributes.position.array, hp = hits.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const ang = yaw + i * Math.PI / 180;   // angle_min = 0, counter-clockwise, x forward
      dir.set(Math.cos(ang), 0, -Math.sin(ang));   // ROS xy plane -> three xz plane
      rc.set(origin, dir);
      const h = rc.intersectObjects(solids, false)[0];
      let r = h ? h.distance + noise * gauss(rand) : Infinity;
      if (r < RMIN || r > RMAX) r = Infinity;
      ranges[i] = r;
      const d = isFinite(r) ? r : RMAX;
      rp.set([origin.x, origin.y, origin.z, origin.x + dir.x * d, origin.y, origin.z + dir.z * d], i * 6);
      hp.set(isFinite(r) ? [origin.x + dir.x * r, origin.y, origin.z + dir.z * r] : [0, -99, 0], i * 3);
    }
    rays.geometry.attributes.position.needsUpdate = hits.geometry.attributes.position.needsUpdate = true;
    camHelper.update();
    gyro.setLength(.1 + Math.abs(Math.sin(a * 2)) * .2);
    // top-down scan in the robot frame, forward is up
    const { ctx, w: W, h: H } = fit2d(plot); ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, sc = Math.min(W, H) / 2 / RMAX;
    ctx.strokeStyle = CSS.line; [1, 2, 3].forEach(k => { ctx.beginPath(); ctx.arc(cx, cy, k * sc, 0, 7); ctx.stroke(); });
    ctx.fillStyle = CSS.pink;
    for (let i = 0; i < N; i++) if (isFinite(ranges[i])) { const an = i * Math.PI / 180; ctx.fillRect(cx - Math.sin(an) * ranges[i] * sc - 1, cy - Math.cos(an) * ranges[i] * sc - 1, 2.4, 2.4); }
    ctx.fillStyle = CSS.cyan; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx - 5, cy + 5); ctx.lineTo(cx + 5, cy + 5); ctx.fill();
    ctx.fillStyle = CSS.muted; ctx.font = '11px "IBM Plex Mono", monospace'; ctx.fillText('LaserScan in base_scan · 1 m rings', 6, 13);
    const f = i => (isFinite(ranges[i]) ? ranges[i].toFixed(2) : 'inf');
    out.innerHTML = `angle_increment 0.0175 · range 0.12–3.5 m<br><b>ranges[0]</b> front ${f(0)}  <b>[90]</b> left ${f(90)}<br><b>[180]</b> back ${f(180)}  <b>[270]</b> right ${f(270)}  · inf: ${ranges.filter(r => !isFinite(r)).length}`;
  } };
};

// ---------- Day 2 · Gazebo: sim time vs wall time ----------
SCENES['gazebo'] = async (panel) => {
  const s = base3d({ cam: [1.1, 1.05, 1.35], target: [0, 0, 0], grid: 4 });
  const bot = await turtlebot(); s.world.add(bot);
  const tr = trail(C.cyan, 400); s.world.add(tr);
  const u = ui(panel);
  let rtf = 1, running = true;
  const rtfBtns = [.25, .5, 1, 2].map(k => u.button(`RTF ${k}`, () => { rtf = k; rtfBtns.forEach(b => b.classList.toggle('on', b.textContent === `RTF ${k}`)); }, k === 1));
  u.row(...rtfBtns);
  const pauseBtn = u.button('pause sim', b => { running = !running; b.textContent = running ? 'pause sim' : 'play sim'; b.classList.toggle('on', !running); });
  u.row(pauseBtn);
  const loopEls = u.list(['world · read commands', 'physics step · 1 ms', 'sensors · sample', 'publish /clock and topics']);
  const out = u.readout(), logs = u.readout();
  u.text('<code>cmd_vel</code>: linear.x 0.2 · angular.z 0.4. Timers with <code>use_sim_time</code> follow <code>/clock</code>, so they slow down and stop with the simulation.');
  let sim, wall, wallLog, simLog, pose;
  const reset = () => { sim = 0; wall = 0; wallLog = []; simLog = []; pose = [0, -.5, 0]; tr.clear(); };
  reset();
  return { ...s, reset, update(t, dt) {
    const w0 = wall, s0 = sim; wall += dt;
    const ds = running ? dt * rtf : 0; sim += ds;
    if (Math.floor(wall) > Math.floor(w0)) wallLog.push(`wall ${Math.floor(wall)} s  tick`);
    if (Math.floor(sim) > Math.floor(s0)) simLog.push(`sim ${Math.floor(sim)} s  tick`);
    wallLog = wallLog.slice(-4); simLog = simLog.slice(-4);
    for (let k = 0; k < 4; k++) { const h = ds / 4; pose = [pose[0] + .2 * Math.cos(pose[2]) * h, pose[1] + .2 * Math.sin(pose[2]) * h, pose[2] + .4 * h]; }
    bot.position.set(pose[0], pose[1], 0); bot.rotation.set(0, 0, pose[2]);
    bot.joints.wheel_left_joint.setJointValue(sim * (.2 - .4 * .08) / .033); bot.joints.wheel_right_joint.setJointValue(sim * (.2 + .4 * .08) / .033);
    if (ds) tr.push(pose[0], pose[1], .01);
    const phase = running ? Math.floor(sim * 12) % 4 : -1;
    loopEls.forEach((li, i) => li.classList.toggle('on', i === phase));
    out.innerHTML = `<b>wall time</b> ${wall.toFixed(1)} s<br><b>/clock</b> ${sim.toFixed(3)} s · <b>physics steps</b> ${Math.round(sim / .001)}<br><b>real-time factor</b> ${running ? rtf.toFixed(2) : '0.00 (paused)'}`;
    logs.innerHTML = `<b>timer, wall clock</b><br>${wallLog.join('<br>') || '…'}<br><b>timer, use_sim_time</b><br>${simLog.join('<br>') || '…'}`;
  } };
};

// ---------- Day 3: joint space, task space, reachable workspace ----------
SCENES['workspace'] = async (panel) => {
  const s = base3d({ cam: [1.7, 1.2, 1.7], target: [0, .45, 0] });
  const r = await panda(); s.world.add(r);
  const handF = frame(.12, 'panda_hand', 'small'); r.links.panda_hand.add(handF);
  const K = await ik();
  const MAX = 5000, cloud = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: .012, vertexColors: true, transparent: true, opacity: .8 }));
  cloud.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  cloud.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
  cloud.geometry.setDrawRange(0, 0); cloud.frustumCulled = false; s.world.add(cloud);
  const u = ui(panel);
  let playing = true, sampling = false, n = 0;
  const playBtn = u.button('stop', b => { playing = !playing; b.textContent = playing ? 'stop' : 'play'; b.classList.toggle('on', playing); }, true);
  u.row(playBtn, u.button('sample workspace', () => { sampling = true; n = 0; cloud.geometry.setDrawRange(0, 0); }), u.button('clear', () => { sampling = false; n = 0; cloud.geometry.setDrawRange(0, 0); }));
  const sliders = ARM.map((name, i) => u.slider(name.replace('panda_', ''), K.lim[i][0], K.lim[i][1], .01, HOME[i], v => { playing = false; playBtn.textContent = 'play'; playBtn.classList.remove('on'); q[i] = v; }));
  const out = u.readout(), info = u.text('Joint space: 7 numbers. Task space: where the hand is. Sampling random joint values shows every point the hand can reach.');
  const rand = rng(3), col = new THREE.Color();
  let q = HOME.slice();
  const KEYS = [HOME, [.9, -.3, .4, -2.0, .2, 1.8, .785], [-.9, .3, -.3, -1.4, -.2, 1.6, .785], [0, .6, 0, -1.2, 0, 1.9, .785], HOME];
  return { ...s, update(t) {
    if (playing) { const k = (t / 2.2) % (KEYS.length - 1), i = Math.floor(k), f = smooth(k - i); q = KEYS[i].map((v, j) => lerp(v, KEYS[i + 1][j], f)); q.forEach((v, j) => sliders[j].set(v)); }
    setArm(r, q, .04);
    if (sampling && n < MAX) {
      const P = cloud.geometry.attributes.position.array, Cc = cloud.geometry.attributes.color.array;
      for (let k = 0; k < 60 && n < MAX; k++, n++) {
        const qs = K.lim.map(([a, b]) => a + (b - a) * rand());
        const p = K.pos(K.fk(qs)); P.set([p.x, p.y, p.z], n * 3);
        col.setHSL(.55 - clamp(p.z, -.2, 1.2) * .35, .8, .6); Cc.set([col.r, col.g, col.b], n * 3);
      }
      cloud.geometry.setDrawRange(0, n); cloud.geometry.attributes.position.needsUpdate = cloud.geometry.attributes.color.needsUpdate = true;
      if (n >= MAX) sampling = false;
    }
    const p = K.pos(K.fk(q));
    out.innerHTML = `<b>joint space</b> [${q.map(v => v.toFixed(2)).join(', ')}]<br><b>task space</b> hand at x ${p.x.toFixed(3)}  y ${p.y.toFixed(3)}  z ${p.z.toFixed(3)} m${n ? `<br><b>workspace samples</b> ${n}` : ''}`;
  } };
};

// ---------- Day 3: inverse kinematics on the Panda ----------
SCENES['ik'] = async (panel) => {
  const s = base3d({ cam: [1.6, 1.1, 1.8], target: [.2, .4, 0] });
  const r = await panda(); s.world.add(r);
  const K = await ik();
  const tgt = new THREE.Group(); tgt.add(new THREE.Mesh(new THREE.SphereGeometry(.025, 24, 16), new THREE.MeshStandardMaterial({ color: C.orange, emissive: 0x442200 })), frame(.08, 'target', 'warn'));
  s.world.add(tgt);
  const u = ui(panel);
  let auto = true, q = HOME.slice(), target = [.45, 0, .35];
  const autoBtn = u.button('auto target', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(autoBtn, u.button('other solution', () => {
    const sol = K.solveIK(K.down(target), [q[0] + (q[0] > 0 ? -1.4 : 1.4), q[1], -q[2] + (q[2] > 0 ? -1.2 : 1.2), q[3], q[4], q[5], q[6]], { iters: 200 });
    if (sol.err < .005) q = sol.q;
  }));
  const sl = ['x', 'y', 'z'].map((n, i) => u.slider(n, i === 2 ? 0 : -1, 1, .005, target[i], v => { auto = false; autoBtn.classList.remove('on'); target[i] = v; }, v => `${(+v).toFixed(3)} m`));
  const out = u.readout(), stat = u.text('', 'scene-flash');
  u.text('IK searches for joint values that put the hand at the target. A 7-joint arm often has many answers; outside the reach it has none.');
  const KEYS = [[.45, 0, .35], [.45, .3, .25], [.3, .35, .55], [.55, -.25, .2], [.9, 0, .45], [.45, -.3, .5], [.45, 0, .35]];
  return { ...s, update(t) {
    if (auto) { const k = (t / 2.4) % (KEYS.length - 1), i = Math.floor(k), f = smooth(k - i); target = KEYS[i].map((v, j) => lerp(v, KEYS[i + 1][j], f)); target.forEach((v, j) => sl[j].set(v)); }
    tgt.position.set(...target);
    const sol = K.solveIK(K.down(target), q, { iters: 12 });
    q = sol.q; setArm(r, q, .04);
    const p = K.pos(sol.M);
    out.innerHTML = `<b>target</b> ${target.map(v => v.toFixed(3)).join(', ')}<br><b>hand</b> ${[p.x, p.y, p.z].map(v => v.toFixed(3)).join(', ')}<br><b>error</b> ${(sol.err * 1000).toFixed(1)} mm · <b>manipulability</b> ${sol.manip.toFixed(3)}<br><b>joints</b> [${q.map(v => v.toFixed(2)).join(', ')}]`;
    stat.textContent = sol.err > .01 ? 'no IK solution: target outside the reachable workspace' : sol.manip < .02 ? 'near a singularity: small hand motions need large joint motions' : '';
    stat.classList.toggle('bad', sol.err > .01);
  } };
};

// ---------- Day 3: RRT-Connect in configuration space (2-link arm, canvas) ----------
SCENES['cspace'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const L1 = 1, L2 = .8, G = 120;
  const u = ui(panel);
  let seed = 5;
  u.row(u.button('replan', () => plan()), u.button('new obstacles', () => { seed++; setup(); plan(); }));
  const out = u.readout();
  u.text('Left: the arm and obstacles in the workspace. Right: every joint pair (q1, q2); pink means a collision. The planner searches the right-hand picture.');
  let obs, img, start, goal, trees, path, phase, anim;
  const segCircle = (ax, ay, bx, by, c) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, k = clamp(((c[0] - ax) * dx + (c[1] - ay) * dy) / l, 0, 1); return Math.hypot(ax + k * dx - c[0], ay + k * dy - c[1]) < c[2]; };
  const joints = ([a, b]) => { const x1 = L1 * Math.cos(a), y1 = L1 * Math.sin(a); return [x1, y1, x1 + L2 * Math.cos(a + b), y1 + L2 * Math.sin(a + b)]; };
  const hit = q => { const [x1, y1, x2, y2] = joints(q); return obs.some(c => segCircle(0, 0, x1, y1, c) || segCircle(x1, y1, x2, y2, c)); };
  const free = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .03); for (let i = 0; i <= n; i++) if (hit([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)])) return false; return true; };
  function setup() {
    const r = rng(seed); obs = [];
    while (obs.length < 4) { const ang = r() * 6.28, d = .9 + r() * .8, c = [d * Math.cos(ang), d * Math.sin(ang), .2 + r() * .16]; if (Math.hypot(c[0], c[1]) > c[2] + .25) obs.push(c); }
    img = new ImageData(G, G);
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const q = [-Math.PI + (i + .5) * 2 * Math.PI / G, -Math.PI + (j + .5) * 2 * Math.PI / G], k = ((G - 1 - j) * G + i) * 4;
      if (hit(q)) img.data.set([255, 114, 159, 150], k); else img.data.set([20, 28, 48, 255], k);
    }
    const pick = () => { for (;;) { const q = [-Math.PI + r() * 2 * Math.PI, -Math.PI + r() * 2 * Math.PI]; if (!hit(q)) return q; } };
    start = pick(); do goal = pick(); while (Math.hypot(goal[0] - start[0], goal[1] - start[1]) < 2.5 || free(start, goal));   // never a straight shot
  }
  function plan() { trees = [[{ q: start, p: -1 }], [{ q: goal, p: -1 }]]; path = null; phase = 'search'; anim = 0; }
  const rand = rng(11), STEP = .18;
  const nearest = (T, q) => T.reduce((b, n, i) => { const d = Math.hypot(n.q[0] - q[0], n.q[1] - q[1]); return d < b[1] ? [i, d] : b; }, [0, 1e9])[0];
  const steer = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return d < STEP ? b : [a[0] + (b[0] - a[0]) * STEP / d, a[1] + (b[1] - a[1]) * STEP / d]; };
  function extend(T, q) { const i = nearest(T, q), n = steer(T[i].q, q); if (!free(T[i].q, n)) return -1; T.push({ q: n, p: i }); return T.length - 1; }
  function step() {
    const q = [-Math.PI + rand() * 2 * Math.PI, -Math.PI + rand() * 2 * Math.PI];
    const [A, B] = trees; const ia = extend(A, q); if (ia < 0) { trees.reverse(); return; }
    let ib = -1, last;   // connect: grow B toward the new node until blocked or joined
    for (let k = 0; k < 60; k++) { last = extend(B, A[ia].q); if (last < 0) break; ib = last; const n = B[ib].q; if (Math.hypot(n[0] - A[ia].q[0], n[1] - A[ia].q[1]) < 1e-6) break; }
    if (ib >= 0 && Math.hypot(B[ib].q[0] - A[ia].q[0], B[ib].q[1] - A[ia].q[1]) < 1e-6) {
      const back = (T, i) => { const o = []; for (; i >= 0; i = T[i].p) o.push(T[i].q); return o; };
      let pth = [...back(A, ia).reverse(), ...back(B, ib)];
      if (Math.hypot(pth[0][0] - start[0], pth[0][1] - start[1]) > 1e-6) pth.reverse();
      path = pth; phase = 'smooth'; anim = 0;
    } else trees.reverse();
  }
  function shortcut() { for (let k = 0; k < 6; k++) { const i = Math.floor(rand() * path.length), j = Math.floor(rand() * path.length); if (Math.abs(i - j) > 1 && free(path[Math.min(i, j)], path[Math.max(i, j)])) path.splice(Math.min(i, j) + 1, Math.abs(i - j) - 1); } }
  const along = (pth, s) => { const segs = pth.slice(1).map((q, i) => Math.hypot(q[0] - pth[i][0], q[1] - pth[i][1])), L = segs.reduce((a, b) => a + b, 0); let d = s * L; for (let i = 0; i < segs.length; i++) { if (d <= segs[i]) return [lerp(pth[i][0], pth[i + 1][0], d / segs[i]), lerp(pth[i][1], pth[i + 1][1], d / segs[i])]; d -= segs[i]; } return pth[pth.length - 1]; };
  setup(); plan();
  const off = document.createElement('canvas'); off.width = off.height = G;
  return { canvas, reset: plan, update(t, dt) {
    if (phase === 'search') { anim += dt; if (anim > .06) { anim = 0; step(); } }
    else if (phase === 'smooth') { anim += dt; shortcut(); if (anim > 1.2) { phase = 'move'; anim = 0; } }
    else if (phase === 'move') { anim += dt / 4; if (anim > 1.4) plan(); }
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const half = w / 2, S = Math.min(half, h) - 24;
    // workspace
    const wx = half / 2, wy = h / 2, ws = S / 2 / (L1 + L2 + .1);
    ctx.save(); ctx.translate(wx, wy); ctx.scale(ws, -ws);
    ctx.fillStyle = 'rgba(255,114,159,.85)'; obs.forEach(c => { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, 7); ctx.fill(); });
    const drawArm = (q, color, width) => { const [x1, y1, x2, y2] = joints(q); ctx.strokeStyle = color; ctx.lineWidth = width / ws; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    drawArm(start, 'rgba(88,224,210,.45)', 6); drawArm(goal, 'rgba(255,177,90,.45)', 6);
    const cur = phase === 'move' && path ? along(path, Math.min(anim, 1)) : start;
    drawArm(cur, CSS.ink, 8);
    ctx.restore();
    // configuration space
    const cx0 = half + (half - S) / 2, cy0 = (h - S) / 2;
    const off2 = off.getContext('2d'); off2.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(off, cx0, cy0, S, S);
    const P = q => [cx0 + (q[0] + Math.PI) / (2 * Math.PI) * S, cy0 + S - (q[1] + Math.PI) / (2 * Math.PI) * S];
    trees.forEach((T, ti) => { ctx.strokeStyle = ti ? 'rgba(255,177,90,.7)' : 'rgba(88,224,210,.7)'; ctx.lineWidth = 1; T.forEach(n => { if (n.p < 0) return; const a = P(n.q), b = P(T[n.p].q); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }); });
    if (path) { ctx.strokeStyle = CSS.ink; ctx.lineWidth = 3; ctx.beginPath(); path.forEach((q, i) => (i ? ctx.lineTo(...P(q)) : ctx.moveTo(...P(q)))); ctx.stroke(); }
    [[start, CSS.cyan], [goal, CSS.orange], [cur, CSS.ink]].forEach(([q, c]) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(...P(q), 5, 0, 7); ctx.fill(); });
    ctx.fillStyle = CSS.muted; ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillText('workspace', 10, 18); ctx.fillText('configuration space (q1 →, q2 ↑)', cx0, cy0 - 8);
    const nodes = trees[0].length + trees[1].length;
    out.innerHTML = `<b>planner</b> RRT-Connect · <b>nodes</b> ${nodes}<br><b>phase</b> ${{ search: 'growing two trees', smooth: 'shortcutting the path', move: 'executing' }[phase]}${path ? ` · <b>waypoints</b> ${path.length}` : ''}`;
  } };
};

// ---------- Day 3: time parameterization ----------
SCENES['trajectory'] = async (panel) => {
  const s = base3d({ cam: [1.6, 1.1, 1.7], target: [0, .45, 0] });
  const r = await panda(); s.world.add(r);
  const W = [HOME, [.8, -.2, .2, -2.0, .1, 1.9, .785], [.8, .3, .2, -1.6, .1, 2.1, .785], [-.4, .1, -.3, -1.9, -.1, 1.8, .785], HOME];
  const VMAX = .8, AMAX = 1.2;
  const profiles = {
    'path only': { s: x => [x, 1, 0], k: 1 },
    trapezoidal: { s: x => { const a = 1 / (.25 * .75); if (x < .25) return [a * x * x / 2, a * x, a]; if (x < .75) return [a * .25 * .25 / 2 + a * .25 * (x - .25), a * .25, 0]; const y = 1 - x; return [1 - a * y * y / 2, a * y, -a]; }, k: 1.33 },
    smooth: { s: x => [10 * x ** 3 - 15 * x ** 4 + 6 * x ** 5, 30 * x ** 2 - 60 * x ** 3 + 30 * x ** 4, 60 * x - 180 * x ** 2 + 120 * x ** 3], k: 1.875 },
  };
  const u = ui(panel);
  let mode = 'smooth';
  const btns = Object.keys(profiles).map(m => u.button(m, () => { mode = m; btns.forEach(b => b.classList.toggle('on', b.textContent === m)); }, m === mode));
  u.row(...btns);
  const pq = u.canvas(78), pv = u.canvas(78), pa = u.canvas(78), out = u.readout();
  u.text('Same waypoints, three timings. A path says <i>where</i>; time parameterization adds <i>when</i>, within velocity and acceleration limits.');
  const SHOW = [0, 1, 3], COLS = [CSS.cyan, CSS.orange, CSS.pink];
  function build() {
    const p = profiles[mode], segs = W.slice(1).map((q, i) => { const d = Math.max(...q.map((v, j) => Math.abs(v - W[i][j]))); return Math.max(d / VMAX * p.k, Math.sqrt(d * 6 / AMAX) * (mode === 'path only' ? .6 : 1), .6); });
    const T = segs.reduce((a, b) => a + b, 0);
    const at = t => { let i = 0, t0 = 0; while (i < segs.length - 1 && t > t0 + segs[i]) t0 += segs[i++]; const x = clamp((t - t0) / segs[i], 0, 1), [sv, sd, sdd] = p.s(x); return W[i].map((v, j) => { const D = W[i + 1][j] - v; return [v + D * sv, D * sd / segs[i], D * sdd / segs[i] ** 2]; }); };
    const N = 240, samples = Array.from({ length: N + 1 }, (_, k) => [k / N * T, at(k / N * T)]);
    const knots = []; let acc = 0; segs.forEach(d => { knots.push(acc / T); acc += d; }); knots.push(1);
    return { T, at, samples, knots };
  }
  let traj = build(), last = mode;
  return { ...s, update(t) {
    if (mode !== last) { traj = build(); last = mode; }
    const tt = t % (traj.T + 1), q = traj.at(Math.min(tt, traj.T));
    setArm(r, q.map(v => v[0]), .04);
    const ser = d => SHOW.map((j, c) => ({ color: COLS[c], points: traj.samples.map(([x, v]) => [x / traj.T, v[j][d]]), spikes: d === 2 && mode === 'path only' ? traj.knots : [] }));
    const cur = Math.min(tt, traj.T) / traj.T;
    plotLines(pq, ser(0), { yMin: -2.6, yMax: 1.2, cursor: cur, title: 'position (rad) · joints 1, 2, 4' });
    plotLines(pv, ser(1), { yMin: -1.6, yMax: 1.6, cursor: cur, title: 'velocity (rad/s)' });
    plotLines(pa, ser(2), { yMin: -4, yMax: 4, cursor: cur, title: mode === 'path only' ? 'acceleration: infinite at every waypoint' : 'acceleration (rad/s²)' });
    const peak = d => Math.max(...traj.samples.flatMap(([, v]) => v.map(x => Math.abs(x[d]))));
    out.innerHTML = `<b>duration</b> ${traj.T.toFixed(1)} s · <b>peak velocity</b> ${peak(1).toFixed(2)} rad/s<br><b>peak acceleration</b> ${mode === 'path only' ? '∞ (velocity jumps)' : peak(2).toFixed(2) + ' rad/s²'}`;
  } };
};

// ---------- Day 3: joint-space vs Cartesian motion ----------
SCENES['cartesian'] = async (panel) => {
  const s = base3d({ cam: [2.7, 1.9, .9], target: [.3, .35, 0], grid: 3 });
  const [left, right] = [await panda(), await panda()];
  left.position.y = .45; right.position.y = -.45; s.world.add(left, right);
  const ll = label('joint-space plan'); ll.position.set(0, 0, 1.05); left.add(ll);
  const rl = label('Cartesian path', 'warn'); rl.position.set(0, 0, 1.05); right.add(rl);
  const K = await ik();
  const A = [.45, .35, .3], B = [.45, -.35, .3];
  const qA = K.solveIK(K.down(A), HOME, { iters: 200 }).q, qB = K.solveIK(K.down(B), qA, { iters: 200 }).q;
  const N = 80, cart = [qA]; let ok = 0;
  for (let i = 1; i <= N; i++) { const sol = K.solveIK(K.down(A.map((v, j) => lerp(v, B[j], i / N))), cart[i - 1], { iters: 40 }); cart.push(sol.q); if (sol.err < .002) ok++; }
  const tl = trail(C.cyan, 400), tr = trail(C.orange, 400); left.add(tl); right.add(tr);
  [left, right].forEach(rb => rb.links.panda_hand.add(frame(.08)));
  const u = ui(panel), out = u.readout();
  u.text('Both arms move the hand between the same two poses. Interpolating joints gives a curved tool path; following a line in task space needs IK at every step.');
  const pathLen = (fn) => { let L = 0, prev; for (let i = 0; i <= 60; i++) { const p = K.pos(K.fk(fn(i / 60))); if (prev) L += p.distanceTo(prev); prev = p; } return L; };
  const lj = pathLen(x => qA.map((v, j) => lerp(v, qB[j], x))), lc = pathLen(x => cart[Math.round(x * N)]);
  const straight = Math.hypot(...A.map((v, j) => v - B[j]));
  const tip = new THREE.Vector3();
  return { ...s, reset() { tl.clear(); tr.clear(); }, update(t) {
    const cyc = t % 10, x = cyc < 4 ? smooth(cyc / 4) : cyc < 5 ? 1 : cyc < 9 ? 1 - smooth((cyc - 5) / 4) : 0;
    if (cyc < .02) { tl.clear(); tr.clear(); }
    setArm(left, qA.map((v, j) => lerp(v, qB[j], x)), .04);
    const k = x * N, i = Math.min(Math.floor(k), N - 1), f = k - i;
    setArm(right, cart[i].map((v, j) => lerp(v, cart[i + 1][j], f)), .04);
    for (const [rb, tlx] of [[left, tl], [right, tr]]) { rb.updateMatrixWorld(true); rb.links.panda_hand.getWorldPosition(tip); rb.worldToLocal(tip); if (cyc < 4.05) tlx.push(tip.x, tip.y, tip.z); }
    out.innerHTML = `<b>straight-line distance</b> ${straight.toFixed(3)} m<br><b>joint-space tool path</b> ${lj.toFixed(3)} m<br><b>Cartesian tool path</b> ${lc.toFixed(3)} m · <b>fraction</b> ${(ok / N).toFixed(2)}`;
  } };
};

// ---------- Day 3: pick and place with planning-scene attach / detach ----------
SCENES['pick'] = async (panel) => {
  const s = base3d({ cam: [1.7, 1.2, 1.4], target: [.3, .3, 0] });
  const r = await panda(); s.world.add(r);
  const K = await ik();
  const table = box(.5, 1.0, .04, 0x2a3350); table.position.set(.5, 0, .02); s.world.add(table);
  const pad = box(.09, .09, .004, C.green, .6); pad.position.set(.45, -.3, .042); s.world.add(pad);
  const objMat = new THREE.MeshStandardMaterial({ color: C.green }), obj = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .05), objMat);
  const PICK = [.5, .25, .065], PLACE = [.45, -.3, .065], TCP = .105;   // hand frame to fingertip centre
  const above = (p, dz) => K.down([p[0], p[1], p[2] + TCP + dz]);
  const solveSeq = (poses) => { let q = HOME; return poses.map(P => (q = K.solveIK(P, q, { iters: 200 }).q)); };
  const [qPre, qGrasp, qLift, qPlacePre, qPlace, qRetreat] = solveSeq([above(PICK, .12), above(PICK, 0), above(PICK, .15), above(PLACE, .15), above(PLACE, 0), above(PLACE, .12)]);
  const OPEN = .04, CLOSED = .025;
  const STEPS = [['home', HOME, OPEN, 1.2], ['pre-grasp', qPre, OPEN, 1.6], ['approach (Cartesian)', qGrasp, OPEN, 1.2], ['close gripper · attach', qGrasp, CLOSED, .8],
                 ['lift', qLift, CLOSED, 1.2], ['move to place', qPlacePre, CLOSED, 1.8], ['lower', qPlace, CLOSED, 1.2], ['open gripper · detach', qPlace, OPEN, .8], ['retreat', qRetreat, OPEN, 1.2], ['home', HOME, OPEN, 1.6]];
  const total = STEPS.reduce((a, s_) => a + s_[3], 0);
  const u = ui(panel), items = u.list(STEPS.map(x => x[0])), out = u.readout();
  u.text('The planning scene must change with the gripper: attach after closing, detach after opening, or MoveIt plans as if the box were still on the table.');
  let attached = false;
  const reset = () => { if (obj.parent !== s.world) s.world.attach(obj); obj.position.set(...PICK); obj.rotation.set(0, 0, 0); attached = false; objMat.color.set(C.green); };
  reset();
  return { ...s, reset, update(t) {
    let tc = t % (total + 1), i = 0; while (i < STEPS.length - 1 && tc > STEPS[i][3]) tc -= STEPS[i++][3];
    const f = smooth(clamp(tc / STEPS[i][3], 0, 1)), prev = i ? STEPS[i - 1] : STEPS[STEPS.length - 1];
    setArm(r, prev[1].map((v, j) => lerp(v, STEPS[i][1][j], f)), lerp(prev[2], STEPS[i][2], f));
    s.scene.updateMatrixWorld(true);
    const shouldAttach = i >= 3 && i <= 6 && !(i === 3 && f < .9);
    if (i === 0 && tc < .05) reset();   // each cycle starts with the box back on the table
    if (shouldAttach && !attached) { r.links.panda_hand.attach(obj); attached = true; objMat.color.set(C.orange); }
    if (!shouldAttach && attached) { s.world.attach(obj); attached = false; objMat.color.set(C.green); }
    items.forEach((li, k) => li.classList.toggle('on', k === i));
    out.innerHTML = attached ? '<b>planning scene</b><br>world objects: table<br>attached to panda_hand: <b>box</b>' : '<b>planning scene</b><br>world objects: table, <b>box</b><br>attached: none';
  } };
};

// ---------- Day 3: ros2_control tracking a trajectory ----------
SCENES['control'] = async (panel) => {
  const s = base3d({ cam: [1.6, 1.1, 1.7], target: [0, .45, 0] });
  const act = await panda(), cmd = ghost(await panda(), .22, C.cyan);
  s.world.add(act, cmd);
  const u = ui(panel);
  let kp = 60, zeta = .7;
  u.slider('Kp', 5, 400, 1, kp, v => (kp = v), v => (+v).toFixed(0));
  u.slider('damping ζ', .1, 1.5, .05, zeta, v => (zeta = v));
  const loop = u.list(['read · state interfaces', 'update · controller computes', 'write · command interfaces']);
  const plot = u.canvas(120), out = u.readout();
  u.text('The ghost is the commanded trajectory; the solid arm is what the hardware does. Low gain lags, high gain with little damping overshoots.');
  let q, qd, hist;
  const ref = t => HOME.map((v, j) => v + (j === 0 ? .7 * Math.sin(.9 * t) : j === 1 ? .35 * Math.sin(1.3 * t) : j === 3 ? .45 * Math.sin(1.1 * t + 1) : 0));
  const reset = () => { q = HOME.slice(); qd = Array(7).fill(0); hist = []; };
  reset();
  return { ...s, reset, update(t, dt) {
    const H = 1 / 500, n = Math.round(dt / H), kd = 2 * zeta * Math.sqrt(kp);
    for (let k = 0; k < n; k++) { const qr = ref(t - dt + k * H); for (let j = 0; j < 7; j++) { const a = kp * (qr[j] - q[j]) - kd * qd[j]; qd[j] += a * H; q[j] += qd[j] * H; } }
    const qr = ref(t); setArm(cmd, qr, .04); setArm(act, q, .04);
    if (dt) hist.push([t, qr[1], q[1]]); hist = hist.filter(h => t - h[0] < 6);
    plotLines(plot, [{ color: CSS.cyan, points: hist.map(h => [h[0] - t + 6, h[1]]), dash: [5, 4] }, { color: CSS.orange, points: hist.map(h => [h[0] - t + 6, h[2]]) }], { yMin: -1.3, yMax: -.25, xMax: 6, title: 'joint 2 · command (dashed) vs state' });
    loop.forEach((li, k) => li.classList.toggle('on', k === Math.floor(t * 6) % 3));
    const rms = Math.sqrt(hist.reduce((a, h) => a + (h[1] - h[2]) ** 2, 0) / Math.max(hist.length, 1));
    out.innerHTML = `<b>update rate</b> 500 Hz (loop shown slowed)<br><b>tracking error</b> RMS ${(rms * 180 / Math.PI).toFixed(2)}° on joint 2`;
  } };
};

// ======================================================================
// Engine: one renderer, mounted on the active slide's .scene3d.
// ======================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const labels = new CSS2DRenderer(); labels.domElement.className = 'label-layer';
const built = new Map();
let cur = null, clock = 0, last = 0, raf = 0;

function build(el) {
  const panel = el.querySelector('.scene-panel');
  return SCENES[el.dataset.scene](panel).catch(err => { panel.textContent = 'Could not load this scene: ' + err.message; throw err; });
}
function snapshot() {
  if (!cur?.inst) return;
  const img = cur.el.querySelector('.scene-snap');
  if (!img) return;
  img.src = (cur.inst.canvas || renderer.domElement).toDataURL('image/png');
}
function unmount() {
  if (!cur) return;
  snapshot();
  cancelAnimationFrame(raf);
  cur.controls?.dispose();
  cur.view.querySelectorAll(':scope > canvas, :scope > .label-layer').forEach(n => n.remove());
  cur = null;
}
async function mount(slide) {
  unmount();
  const el = slide?.querySelector('.scene3d');
  if (!el) return;
  const view = el.querySelector('.scene-view'), me = { el, view };
  cur = me;
  view.classList.add('loading');
  if (!built.has(el)) built.set(el, build(el));
  let inst;
  try { inst = await built.get(el); } catch { view.classList.remove('loading'); return; }
  if (cur !== me) return;
  view.classList.remove('loading');
  me.inst = inst;
  if (inst.canvas) view.prepend(inst.canvas);
  else {
    labels.domElement.replaceChildren();   // drop labels left by the previous scene
    view.prepend(renderer.domElement, labels.domElement);
    me.controls = new OrbitControls(inst.camera, renderer.domElement);
    me.controls.target.copy(inst.target); me.controls.enableDamping = true;
  }
  clock = 0; inst.reset?.();
  last = performance.now(); tick(last);   // draw immediately so the previous scene never shows
}
function tick(now) {
  if (!cur?.inst) return;
  const dt = Math.min((now - last) / 1000, .05); last = now;
  const step = isPaused() ? 0 : dt; clock += step;
  const { inst, view } = cur, w = view.clientWidth, h = view.clientHeight;
  inst.update(clock, step);
  if (!inst.canvas) {
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); labels.setSize(w, h); inst.camera.aspect = w / h; inst.camera.updateProjectionMatrix();
    }
    cur.controls.update();
    renderer.render(inst.scene, inst.camera); labels.render(inst.scene, inst.camera);
  }
  raf = requestAnimationFrame(tick);
}
document.addEventListener('deck:slide', e => mount(e.detail));
document.addEventListener('deck:restart', () => { clock = 0; cur?.inst?.reset?.(); });
window.addEventListener('beforeprint', snapshot);
mount(document.querySelector('.slide.active'));
