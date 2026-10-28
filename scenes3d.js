// Interactive 3D, canvas and DOM scenes: Inside a robot, Day 2 and Day 3.
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

// ---------- Day 2 · TF2: explore the tree, any frame to any frame ----------
SCENES['tf-tree'] = async (panel) => {
  const s = base3d({ cam: [2.0, 1.6, 1.9], target: [.35, .4, -.1] });
  const r = await panda(); s.world.add(r);   // world → panda_link0 is identity
  const camMount = new THREE.Group(); camMount.position.set(1.0, .6, .9); camMount.rotation.set(0, .55, -2.6, 'ZYX');
  const body = box(.1, .16, .06, 0x39425e); camMount.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .04, 20), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  lens.rotation.z = Math.PI / 2; lens.position.x = .06; camMount.add(lens);
  const cup = new THREE.Group();
  const cupMesh = new THREE.Mesh(new THREE.CylinderGeometry(.035, .03, .1, 24), new THREE.MeshStandardMaterial({ color: C.orange }));
  cupMesh.rotation.x = Math.PI / 2; cupMesh.position.z = .05; cup.add(cupMesh);
  const table = box(.5, .9, .02, 0x2a3350); table.position.set(.55, 0, -.01);
  s.world.add(camMount, cup, table);
  const PARENT = { panda_link0: 'world', panda_link1: 'panda_link0', panda_link2: 'panda_link1', panda_link3: 'panda_link2', panda_link4: 'panda_link3', panda_link5: 'panda_link4',
                   panda_link6: 'panda_link5', panda_link7: 'panda_link6', panda_link8: 'panda_link7', panda_hand: 'panda_link8', camera_link: 'world', cup: 'camera_link' };
  const OBJ = { world: s.world, camera_link: camMount, cup, ...Object.fromEntries(Object.keys(PARENT).filter(n => n.startsWith('panda')).map(n => [n, r.links[n]])) };
  const NAMED = ['world', 'panda_link0', 'panda_hand', 'camera_link', 'cup'];
  for (const [n, o] of Object.entries(OBJ)) if (n !== 'world') o.add(frame(NAMED.includes(n) ? .1 : .05, NAMED.includes(n) ? n : '', n === 'cup' ? 'warn' : 'small'));
  s.world.add(frame(.18, 'world', 'big'));
  const chainLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.orange, depthTest: false, transparent: true }));
  chainLine.renderOrder = 4; chainLine.frustumCulled = false; s.world.add(chainLine);
  const u = ui(panel);
  const names = Object.keys(OBJ);
  const pick = (lbl, val) => {
    const l = document.createElement('label'); l.className = 'scene-slider';
    l.innerHTML = `<span>${lbl}</span><select>${names.map(n => `<option${n === val ? ' selected' : ''}>${n}</option>`).join('')}</select><output></output>`;
    const sel = l.querySelector('select'); sel.addEventListener('change', () => { auto = false; autoBtn.classList.remove('on'); sel.blur(); });
    panel.append(l); return sel;
  };
  let auto = true;
  const autoBtn = u.button('tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const tSel = pick('target', 'panda_hand'), sSel = pick('source', 'cup');
  const tree = u.readout(), out = u.readout();
  tree.classList.add('tree');
  const TOUR = [['panda_hand', 'cup'], ['world', 'panda_hand'], ['camera_link', 'cup'], ['panda_link0', 'camera_link'], ['cup', 'panda_hand']];
  const up = n => { const o = [n]; while (PARENT[o[o.length - 1]]) o.push(PARENT[o[o.length - 1]]); return o; };
  const depth = n => up(n).length - 1;
  const inv = new THREE.Matrix4(), rel = n => new THREE.Matrix4().multiplyMatrices(inv, OBJ[n].matrixWorld);
  const e = new THREE.Euler(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  return { ...s, update(t) {
    setArm(r, HOME.map((v, j) => v + (j === 0 ? .5 * Math.sin(t * .5) : j === 3 ? .35 * Math.sin(t * .7) : j === 1 ? .25 * Math.sin(t * .6) : 0)), .04);
    cup.position.set(.55 + .12 * Math.sin(t * .4), .25 * Math.sin(t * .3), 0);
    if (auto) { const k = Math.floor(t / 4) % TOUR.length; tSel.value = TOUR[k][0]; sSel.value = TOUR[k][1]; }
    s.scene.updateMatrixWorld(true); inv.copy(s.world.matrixWorld).invert();
    const target = tSel.value, source = sSel.value, a = up(target), b = up(source);
    const common = a.find(n => b.includes(n)), chain = [...a.slice(0, a.indexOf(common) + 1), ...b.slice(0, b.indexOf(common)).reverse()];
    chainLine.geometry.setFromPoints(chain.map(n => new THREE.Vector3().setFromMatrixPosition(rel(n))));
    const T = new THREE.Matrix4().multiplyMatrices(rel(target).invert(), rel(source));
    T.decompose(p, q, sc); e.setFromQuaternion(q, 'ZYX');
    tree.innerHTML = names.map(n => `${'&nbsp;&nbsp;'.repeat(depth(n))}${chain.includes(n) ? `<b>${n}</b>` : n}`).join('<br>');
    out.innerHTML = `<b>lookup_transform</b>('${target}', '${source}')<br>translation ${[p.x, p.y, p.z].map(v => v.toFixed(3)).join(', ')}<br>rotation rpy ${[e.x, e.y, e.z].map(v => v.toFixed(3)).join(', ')}<br>chain: ${chain.length - 1} transforms`;
  } };
};

// ---------- Day 1 · Launch: a robot model launch file running ----------
SCENES['launch-display'] = async (panel) => {
  const s = base3d({ cam: [1.5, 1.0, 1.5], target: [0, .45, 0] });
  const r = await panda(); s.world.add(r);
  const vis = {}; r.traverse(o => { if (o.isURDFVisual) (vis[o.parent.urdfName] ??= []).push(o); });
  const tfFrames = ['panda_link0', 'panda_link2', 'panda_link4', 'panda_link6', 'panda_hand'].map(n => { const f = frame(.1, n === 'panda_hand' || n === 'panda_link0' ? n : '', 'small'); r.links[n].add(f); return f; });
  const wait = label('waiting for /joint_states', 'warn'); wait.position.set(0, 0, .45); r.add(wait);
  const CODE = [
    ['# imports: launch, launch_ros', 'c'], ['def generate_launch_description():', ''], ["    model = LaunchConfiguration('model')", ''],
    ['    return LaunchDescription([', ''], ["        DeclareLaunchArgument('model', default_value='panda.urdf'),", 'arg'],
    ["        Node(package='robot_state_publisher', executable='robot_state_publisher',", 'rsp'], ["             parameters=[{'robot_description': ParameterValue(", 'rsp'],
    ["                 Command(['xacro ', model]), value_type=str)}]),", 'rsp'], ["        Node(package='joint_state_publisher_gui',", 'jsp'],
    ["             executable='joint_state_publisher_gui'),", 'jsp'], ["        Node(package='rviz2', executable='rviz2'),", 'rviz'], ['    ])', '']];
  const code = document.createElement('div'); code.className = 'scene-code';
  code.innerHTML = CODE.map(([l, k]) => `<span data-k="${k}">${l.replace(/</g, '&lt;')}</span>`).join('');
  panel.replaceChildren(code);
  const u = { readout: html => { const d = document.createElement('div'); d.className = 'scene-readout scene-log'; d.innerHTML = html; panel.append(d); return d; } };
  const log = u.readout(), out = u.readout();
  const LOG = [
    [0, '$ ros2 launch my_robot display.launch.py model:=panda.urdf'], [1.2, '[INFO] [launch]: All log files can be found below ~/.ros/log/…'],
    [1.4, '[INFO] [launch]: Default logging verbosity is set to INFO'], [2.8, '[INFO] [robot_state_publisher-1]: process started with pid [41210]'],
    [5.0, '[INFO] [joint_state_publisher_gui-2]: process started with pid [41211]'], [8.0, '[INFO] [rviz2-3]: process started with pid [41212]'],
    [18.0, '^C[WARNING] [launch]: user interrupted with ctrl-c (SIGINT)'], [18.4, '[INFO] [rviz2-3]: process has finished cleanly [pid 41212]'],
    [18.6, '[INFO] [joint_state_publisher_gui-2]: process has finished cleanly [pid 41211]'], [18.8, '[INFO] [robot_state_publisher-1]: process has finished cleanly [pid 41210]']];
  const hand = new THREE.Vector3(), CYCLE = 21;
  return { ...s, update(t) {
    const tc = t % CYCLE, rsp = tc >= 2.8 && tc < 19, jsp = tc >= 5 && tc < 19, rviz = tc >= 8 && tc < 19;
    const step = tc < 1.2 ? '' : tc < 2.8 ? 'arg' : tc < 5 ? 'rsp' : tc < 8 ? 'jsp' : tc < 18 ? 'rviz' : '';
    code.querySelectorAll('span').forEach(sp => sp.classList.toggle('on', sp.dataset.k === step));
    for (const [n, list] of Object.entries(vis)) list.forEach(v => (v.visible = n === 'panda_link0' ? rsp : jsp));   // moving links need joint states
    wait.visible = rsp && !jsp;
    tfFrames.forEach(f => (f.visible = rviz));
    const q = HOME.map(() => 0);
    if (tc > 6.5 && jsp) { const k = Math.floor((tc - 6.5) / 1.6) % 7; q[k] = .7 * Math.sin(((tc - 6.5) % 1.6) / 1.6 * Math.PI); }
    setArm(r, q, .04);
    log.innerHTML = LOG.filter(([at]) => tc >= at).map(([, l]) => l.replace(/</g, '&lt;')).join('<br>');
    r.updateMatrixWorld(true); r.links.panda_hand.getWorldPosition(hand); r.worldToLocal(hand);
    out.innerHTML = jsp ? `<b>ros2 node list</b> /robot_state_publisher /joint_state_publisher${rviz ? ' /rviz' : ''}<br><b>tf2_echo panda_link0 panda_hand</b> ${[hand.x, hand.y, hand.z].map(v => v.toFixed(3)).join(', ')}`
                        : rsp ? '<b>ros2 node list</b> /robot_state_publisher<br>/tf_static only: moving links have no transform yet' : '<b>ros2 node list</b> (empty)';
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
// Inside a robot. Canvas scenes return { canvas, update }; DOM scenes return { dom: true, update } and work on the
// markup already inside .scene-view, so print and no-JS still show the static content.
// ======================================================================
const mono = (px, w = 500) => `${w} ${px}px "IBM Plex Mono", monospace`;
const sans = (px, w = 600) => `${w} ${px}px Inter, sans-serif`;
const KIND = { sensor: CSS.cyan, brain: CSS.blue, actuator: CSS.orange };
// Canvas taps in CSS pixels, plus a pointer cursor over anything in `regions`.
function tappable(canvas, regions, fn) {
  const at = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const find = ([x, y]) => regions().find(g => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h);
  canvas.addEventListener('click', e => { const g = find(at(e)); if (g) fn(g); });
  canvas.addEventListener('pointermove', e => { canvas.style.cursor = find(at(e)) ? 'pointer' : ''; });
}
function arrowTo(ctx, x0, y0, x1, y1, color, w = 2, head = 7) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(a) * head * .8, y1 - Math.sin(a) * head * .8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - head * Math.cos(a - .45), y1 - head * Math.sin(a - .45)); ctx.lineTo(x1 - head * Math.cos(a + .45), y1 - head * Math.sin(a + .45)); ctx.fill();
}
function dot(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }

// Draws a robot in a 200 × 160 box (y down) and records where its sensors, brain and actuators are.
function painter(ctx, ox, oy, sc, emph, show) {
  const anchors = [], X = x => ox + x * sc, Y = y => oy + y * sc;
  const look = kind => (kind === 'body' || !show[kind] ? { fill: 'rgba(143,154,179,.18)', stroke: '#8f9ab3', glow: false } : { fill: KIND[kind], stroke: KIND[kind], glow: emph === kind });
  const paint = (kind, fill = true) => {
    const s = look(kind); ctx.lineWidth = 1.5; ctx.strokeStyle = s.stroke; ctx.fillStyle = s.fill;
    ctx.shadowColor = s.stroke; ctx.shadowBlur = s.glow ? 16 : 0; if (fill) ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  };
  return {
    anchors,
    rect(x, y, w, h, kind = 'body', r = 2) { ctx.beginPath(); ctx.roundRect(X(x), Y(y), w * sc, h * sc, r * sc); paint(kind); },
    circle(x, y, r, kind = 'body') { ctx.beginPath(); ctx.arc(X(x), Y(y), r * sc, 0, 7); paint(kind); },
    ellipse(x, y, rx, ry, kind = 'body') { ctx.beginPath(); ctx.ellipse(X(x), Y(y), Math.max(rx * sc, .5), Math.max(ry * sc, .5), 0, 0, 7); paint(kind); },
    line(pts, kind = 'body', w = 4) {
      const s = look(kind); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.strokeStyle = kind === 'body' ? '#5f6a86' : s.stroke; ctx.lineWidth = w * sc; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.shadowColor = s.stroke; ctx.shadowBlur = s.glow ? 16 : 0; ctx.stroke(); ctx.shadowBlur = 0;
    },
    part(kind, text, x, y) { if (!anchors.some(a => a.text === text)) anchors.push({ kind, text, x: X(x), y: Y(y) }); },
  };
}
const pol = (p, r, a) => [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)];
const ROBOT_TYPES = [
  { name: 'Robot arm', ros: '/joint_states · ros2_control · MoveIt 2',
    sensors: 'joint encoders, joint torque sensors, wrist camera', brain: 'control computer running a 1 kHz loop', actuators: 'one motor per joint, gripper',
    draw(g, t) {
      const a1 = -1.25 + .35 * Math.sin(t * .9), a2 = 1.2 + .35 * Math.sin(t * 1.3 + 1), a3 = .9 + .3 * Math.sin(t * 1.1 + 2);
      const s = [100, 126], e = pol(s, 58, a1), w = pol(e, 50, a1 + a2), a = a1 + a2 + a3, tip = pol(w, 18, a), f = 4 + 3 * Math.sin(t * 2);
      g.rect(78, 128, 44, 22, 'body', 4); g.line([[52, 144], [78, 144]], 'body', 2); g.rect(18, 126, 34, 24, 'brain', 3);
      g.line([s, e], 'body', 12); g.line([e, w], 'body', 10); g.line([w, tip], 'body', 7);
      for (const k of [1, -1]) { const b = pol(tip, f * k, a + Math.PI / 2); g.line([b, pol(b, 11, a)], 'actuator', 3); }
      g.circle(...s, 9, 'actuator'); g.circle(...e, 8, 'actuator'); g.circle(...w, 7, 'actuator');
      [s, e, w].forEach(p => g.circle(...pol(p, 6, -2.2), 2.6, 'sensor'));
      const cam = pol(w, 10, a1 + a2 - Math.PI / 2); g.rect(cam[0] - 4, cam[1] - 3, 8, 6, 'sensor', 1);
      g.part('sensor', 'joint encoders', ...pol(e, 6, -2.2)); g.part('sensor', 'wrist camera', ...cam); g.part('brain', 'control PC · 1 kHz', 35, 126);
      g.part('actuator', 'joint motors', ...e); g.part('actuator', 'gripper', ...tip);
    } },
  { name: 'Mobile robot', ros: '/scan · /odom · /imu · /cmd_vel',
    sensors: '360° lidar, wheel encoders, IMU', brain: 'Raspberry Pi (ROS 2) and an OpenCR motor board', actuators: 'two wheel motors',
    draw(g, t) {
      const dx = 10 * Math.sin(t * .7), sweep = t * 6;
      for (const x of [55, 145]) { g.circle(x + dx, 134, 16, 'actuator'); g.line([[x + dx, 134], pol([x + dx, 134], 13, dx / 16)], 'body', 2); g.circle(x + dx, 134, 4, 'sensor'); }
      for (const x of [64, 114]) g.rect(x + dx, 120, 22, 14, 'actuator', 2);
      [124, 102, 82, 62].forEach(y => g.rect(60 + dx, y, 80, 4, 'body', 1));
      [66, 134].forEach(x => g.line([[x + dx, 62], [x + dx, 124]], 'body', 2));
      g.rect(76 + dx, 108, 48, 13, 'body', 2);
      g.rect(68 + dx, 94, 64, 7, 'brain', 1); g.rect(124 + dx, 88, 7, 6, 'sensor', 1); g.rect(76 + dx, 74, 48, 7, 'brain', 1);
      g.rect(84 + dx, 44, 32, 18, 'sensor', 4);
      g.line([[100 + dx, 52], [100 + dx + 60 * Math.cos(sweep), 52 + 6 * Math.sin(sweep)]], 'sensor', 1);
      g.part('sensor', '360° lidar', 100 + dx, 50); g.part('sensor', 'IMU (on OpenCR)', 127 + dx, 91); g.part('sensor', 'wheel encoders', 55 + dx, 134);
      g.part('brain', 'Raspberry Pi · ROS 2', 100 + dx, 77); g.part('brain', 'OpenCR motor board', 100 + dx, 97); g.part('actuator', 'wheel motors', 145 + dx, 134);
    } },
  { name: 'Drone', ros: 'PX4 or ArduPilot autopilot, bridged to ROS 2',
    sensors: 'IMU, barometer, GPS, camera', brain: 'flight controller (fast loops) plus a companion computer', actuators: 'four propeller motors',
    draw(g, t) {
      const b = 4 * Math.sin(t * 2) - 10;
      g.ellipse(100, 148, 46 - b, 4, 'body');
      g.line([[40, 70 + b], [160, 70 + b]], 'body', 4); g.line([[82, 82 + b], [74, 100 + b]], 'body', 3); g.line([[118, 82 + b], [126, 100 + b]], 'body', 3);
      for (const x of [38, 162]) { g.rect(x - 8, 61 + b, 16, 9, 'actuator', 2); g.ellipse(x, 58 + b, 26 * Math.abs(Math.cos(t * 23 + x)), 2.5, 'actuator'); }
      g.rect(76, 64 + b, 48, 20, 'body', 7); g.rect(91, 55 + b, 18, 8, 'sensor', 2); g.rect(89, 68 + b, 18, 10, 'brain', 2); g.circle(113, 73 + b, 2.6, 'sensor');
      g.line([[100, 84 + b], [100, 90 + b]], 'body', 2); g.circle(100, 94 + b, 5, 'sensor');
      g.part('sensor', 'GPS', 100, 58 + b); g.part('sensor', 'IMU + barometer', 113, 73 + b); g.part('sensor', 'camera', 100, 94 + b);
      g.part('brain', 'flight controller', 98, 73 + b); g.part('actuator', '4 propeller motors', 162, 60 + b);
    } },
  { name: 'Humanoid', ros: 'ros2_control for dozens of joints · /joint_states · /imu',
    sensors: 'head cameras, IMU, joint encoders, foot force sensors', brain: 'onboard computer', actuators: 'dozens of joint motors',
    draw(g, t) {
      const ph = t * 2.2;
      for (const sd of [-1, 1]) {
        const ha = .35 * Math.sin(ph + (sd > 0 ? 0 : Math.PI)), kb = .6 * Math.max(0, Math.sin(ph + (sd > 0 ? 0 : Math.PI) + 1.2));
        const hip = [100 + sd * 8, 94], knee = [hip[0] + 28 * Math.sin(ha), hip[1] + 28 * Math.cos(ha)], ank = [knee[0] + 28 * Math.sin(ha - kb), knee[1] + 28 * Math.cos(ha - kb)];
        g.line([hip, knee, ank], 'body', 7); g.circle(...hip, 5, 'actuator'); g.circle(...knee, 4.5, 'actuator'); g.rect(ank[0] - 7, ank[1], 17, 5, 'sensor', 2);
        if (sd > 0) { g.part('sensor', 'foot force sensors', ank[0] + 2, ank[1] + 2); g.part('actuator', 'hip and knee motors', ...knee); }
        const sw = .45 * Math.sin(ph + (sd > 0 ? Math.PI : 0)), sh = [100 + sd * 19, 54], el = [sh[0] + 24 * Math.sin(sw), sh[1] + 24 * Math.cos(sw)], hd = [el[0] + 21 * Math.sin(sw + .5), el[1] + 21 * Math.cos(sw + .5)];
        g.line([sh, el, hd], 'body', 6); g.circle(...sh, 4.5, 'actuator'); g.circle(...el, 4, 'actuator');
        if (sd < 0) g.part('actuator', 'shoulder and elbow motors', ...el);
      }
      g.rect(83, 48, 34, 48, 'body', 7); g.circle(100, 32, 13, 'body'); g.circle(95, 31, 2.6, 'sensor'); g.circle(105, 31, 2.6, 'sensor');
      g.rect(91, 56, 18, 11, 'brain', 2); g.circle(100, 82, 3, 'sensor');
      g.part('sensor', 'head cameras', 100, 31); g.part('sensor', 'IMU', 100, 82); g.part('brain', 'onboard computer', 100, 61);
    } },
  { name: 'Warehouse AMR', ros: 'Nav2 · /scan from safety lidars · lift as an action',
    sensors: 'safety lidars, 3D camera, wheel encoders', brain: 'industrial PC running navigation', actuators: 'drive wheels, lift',
    draw(g, t) {
      const h = 9 * (.5 - .5 * Math.cos(t * 1.1)), dx = 6 * Math.sin(t * .5);
      g.rect(40, 54 - h, 120, 5, 'body', 1); g.rect(40, 90 - h, 120, 5, 'body', 1); g.line([[44, 54 - h], [44, 150 - h]], 'body', 3); g.line([[156, 54 - h], [156, 150 - h]], 'body', 3);
      g.rect(62, 64 - h, 26, 26, 'body', 2); g.rect(98, 70 - h, 34, 20, 'body', 2);
      g.rect(72 + dx, 100 - h, 56, 6, 'actuator', 2); g.line([[100 + dx, 106 - h], [100 + dx, 116]], 'actuator', 4);
      g.rect(54 + dx, 114, 92, 24, 'body', 6);
      g.circle(74 + dx, 141, 8, 'actuator'); g.circle(126 + dx, 141, 8, 'actuator'); g.circle(74 + dx, 141, 2.5, 'sensor');
      g.rect(140 + dx, 118, 8, 8, 'sensor', 2); g.rect(52 + dx, 118, 8, 8, 'sensor', 2); g.rect(141 + dx, 128, 7, 6, 'sensor', 1); g.rect(88 + dx, 121, 24, 10, 'brain', 2);
      g.part('sensor', 'safety lidars', 144 + dx, 122); g.part('sensor', '3D camera', 144 + dx, 131); g.part('sensor', 'wheel encoders', 74 + dx, 141);
      g.part('brain', 'industrial PC · Nav2', 100 + dx, 126); g.part('actuator', 'lift', 128 + dx, 103 - h); g.part('actuator', 'drive wheels', 126 + dx, 141);
    } },
  { name: 'Self-driving car', ros: 'Autoware is built on ROS 2',
    sensors: 'cameras, radar, roof lidar, GPS, wheel speed', brain: 'in-car computer', actuators: 'steering, drive motor or engine, brakes',
    draw(g, t) {
      for (let k = 0; k < 7; k++) { const x = ((k * 40 - t * 70) % 280 + 280) % 280 - 40; g.line([[x, 156], [x + 18, 156]], 'body', 2); }
      g.rect(18, 96, 164, 36, 'body', 10); g.rect(56, 72, 80, 28, 'body', 10);
      for (const x of [52, 150]) { g.circle(x, 134, 15, 'actuator'); g.line([[x, 134], pol([x, 134], 12, t * 6)], 'body', 2); }
      g.rect(87, 62, 22, 10, 'sensor', 3); g.rect(68, 68, 10, 4, 'sensor', 1); g.circle(130, 82, 3.5, 'sensor'); g.rect(178, 106, 6, 14, 'sensor', 2); g.rect(26, 104, 26, 14, 'brain', 2);
      g.part('sensor', 'roof lidar', 98, 66); g.part('sensor', 'GPS', 73, 70); g.part('sensor', 'cameras', 130, 82); g.part('sensor', 'radar', 181, 113);
      g.part('brain', 'in-car computer', 39, 111); g.part('actuator', 'steering', 150, 134); g.part('actuator', 'drive + brakes', 52, 134);
    } },
];

// ---------- Inside a robot: six robots, same three ingredients ----------
SCENES['robot-types'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let sel = 0, auto = true, regions = [];
  const show = { sensor: true, brain: true, actuator: true };
  const pickBtns = ROBOT_TYPES.map((r, i) => u.button(r.name, () => choose(i, true), i === 0));
  u.row(...pickBtns);
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(...['sensor', 'brain', 'actuator'].map(k => u.button(k === 'brain' ? 'brain' : k + 's', b => { show[k] = !show[k]; b.classList.toggle('on', show[k]); }, true)), autoBtn);
  const out = u.readout();
  u.text('Every robot <b>senses</b> the world, <b>thinks</b> about what to do, and <b>acts</b> on it. Click a robot below the drawing, or toggle a part type.');
  function choose(i, manual) {
    sel = i; pickBtns.forEach((b, k) => b.classList.toggle('on', k === i));
    if (manual) { auto = false; autoBtn.classList.remove('on'); }
    const r = ROBOT_TYPES[i];
    out.innerHTML = `<b>${r.name}</b><br><b>sense</b> ${r.sensors}<br><b>think</b> ${r.brain}<br><b>act</b> ${r.actuators}<br><b>ROS 2</b> ${r.ros}`;
  }
  choose(0);
  tappable(canvas, () => regions, g => choose(g.i, true));
  const PH = 6;
  return { canvas, update(t) {
    if (auto) { const i = Math.floor(t / PH) % ROBOT_TYPES.length; if (i !== sel) choose(i); }
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const th = Math.min(84, h * .19), mainH = h - th - 14, p = (t % PH) / PH;
    const emph = p < .35 ? 'sensor' : p < .5 ? 'brain' : p < .85 ? 'actuator' : null;
    const sc = Math.min(w * .44 / 200, (mainH - 56) / 160), ox = (w - 200 * sc) / 2, oy = 34 + (mainH - 56 - 160 * sc) / 2;
    const g = painter(ctx, ox, oy, sc, emph, show);
    ROBOT_TYPES[sel].draw(g, t);
    ctx.fillStyle = CSS.ink; ctx.font = sans(17, 700); ctx.textAlign = 'left'; ctx.fillText(ROBOT_TYPES[sel].name, 14, 24);
    // signals: sensors -> brain -> actuators
    const A = g.anchors.filter(a => show[a.kind]), brain = A.find(a => a.kind === 'brain');
    if (brain) {
      const go = (from, to, f, c) => { const e = smooth(clamp(f, 0, 1)); ctx.globalAlpha = .35; ctx.setLineDash([3, 4]); ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; dot(ctx, lerp(from.x, to.x, e), lerp(from.y, to.y, e), 4, c); };
      if (p < .35) A.filter(a => a.kind === 'sensor').forEach(a => go(a, brain, p / .3, CSS.cyan));
      else if (p >= .5 && p < .85) A.filter(a => a.kind === 'actuator').forEach(a => go(brain, a, (p - .5) / .3, CSS.orange));
      else if (p < .5) { ctx.strokeStyle = CSS.blue; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(brain.x, brain.y, 8 + 22 * ((p - .35) / .15), 0, 7); ctx.globalAlpha = 1 - (p - .35) / .15; ctx.stroke(); ctx.globalAlpha = 1; }
    }
    // callouts: sensors and brain on the left, actuators on the right
    if (w >= 520) {
      ctx.font = mono(12);
      for (const [side, list] of [[-1, A.filter(a => a.kind !== 'actuator')], [1, A.filter(a => a.kind === 'actuator')]]) {
        const ys = []; list.sort((a, b) => a.y - b.y).forEach(a => ys.push(Math.max(a.y, (ys[ys.length - 1] ?? -99) + 26)));
        const shift = Math.max(0, (ys[ys.length - 1] ?? 0) - (mainH - 8));
        list.forEach((a, k) => {
          const y = ys[k] - shift, x = side < 0 ? ox - 14 : ox + 200 * sc + 14;
          ctx.strokeStyle = KIND[a.kind]; ctx.globalAlpha = .55; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * -10, y); ctx.lineTo(a.x, a.y); ctx.stroke(); ctx.globalAlpha = 1;
          dot(ctx, a.x, a.y, 2.5, KIND[a.kind]);
          ctx.fillStyle = a.kind === emph ? KIND[a.kind] : CSS.ink; ctx.textAlign = side < 0 ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(a.text, x + side * 4, y);
        });
      }
      ctx.textBaseline = 'alphabetic';
    }
    // sense -> think -> act strip
    const words = [['SENSE', 'sensor'], ['THINK', 'brain'], ['ACT', 'actuator']];
    ctx.font = mono(12, 600); ctx.textAlign = 'center';
    words.forEach(([wd, k], i) => { const x = w / 2 + (i - 1) * 110; ctx.fillStyle = emph === k ? KIND[k] : CSS.muted; ctx.fillText(wd, x, mainH); if (i < 2) { ctx.fillStyle = CSS.muted; ctx.fillText('→', x + 55, mainH); } });
    // thumbnails
    const n = ROBOT_TYPES.length, gap = 8, bw = (w - 16 - gap * (n - 1)) / n, by = h - th - 4;
    regions = ROBOT_TYPES.map((r, i) => {
      const bx = 8 + i * (bw + gap);
      ctx.strokeStyle = i === sel ? CSS.cyan : CSS.line; ctx.lineWidth = i === sel ? 2 : 1; ctx.beginPath(); ctx.roundRect(bx, by, bw, th, 6); ctx.stroke();
      const s2 = Math.min((bw - 8) / 200, (th - 18) / 160);
      ROBOT_TYPES[i].draw(painter(ctx, bx + (bw - 200 * s2) / 2, by + 2, s2, null, show), t);
      ctx.fillStyle = i === sel ? CSS.cyan : CSS.muted; ctx.font = mono(bw < 90 ? 8 : 10); ctx.fillText(r.name, bx + bw / 2, by + th - 5);
      return { x: bx, y: by, w: bw, h: th, i };
    });
    ctx.textAlign = 'left';
  } };
};

// ---------- Inside a robot: sense, think, act, and what slow thinking costs ----------
SCENES['sense-think-act'] = async (panel) => {
  const s = base3d({ cam: [0.3, 2.6, 2.3], target: [0, 0, .1], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const solids = [];
  const wall = (x, y, sx, sy, color = 0x3a4566, hgt = .3) => { const b = box(sx, sy, hgt, color); b.position.set(x, y, hgt / 2); s.world.add(b); solids.push(b); };
  wall(0, 1.5, 5, .08); wall(0, -1.5, 5, .08); wall(2.5, 0, .08, 3); wall(-2.5, 0, .08, 3);
  wall(1.2, -1.0, .6, .4, 0x6aa8ff, .35); wall(-1.4, 1.0, .5, .3, 0x6aa8ff, .35);
  const person = new THREE.Group();
  const pBody = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .5, 28), new THREE.MeshStandardMaterial({ color: C.orange }));
  pBody.rotation.x = Math.PI / 2; pBody.position.z = .25; person.add(pBody);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.09, 20, 14), new THREE.MeshStandardMaterial({ color: C.orange })); head.position.z = .6; person.add(head);
  const pl = label('person', 'warn'); pl.position.z = .8; person.add(pl);
  s.world.add(person); solids.push(pBody);
  const GOAL = 1.85, START = -1.9;
  const goal = new THREE.Mesh(new THREE.RingGeometry(.1, .14, 32), new THREE.MeshBasicMaterial({ color: C.green, side: THREE.DoubleSide }));
  goal.position.set(GOAL, 0, .005); s.world.add(goal);
  const gl = label('goal', 'big'); gl.position.set(GOAL, 0, .15); s.world.add(gl);
  const bot = await turtlebot(); s.world.add(bot);
  const N = 180, RMAX = 3.5, STOP = .5, R_BOT = .105, R_PERSON = .15;
  const rays = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.pink, transparent: true, opacity: .18 }));
  rays.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)); rays.frustumCulled = false;
  const seen = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: C.pink, size: .05 }));
  seen.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); seen.frustumCulled = false;
  s.scene.add(rays, seen);
  const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: C.cyan, dashSize: .06, gapSize: .04 }));
  pathLine.frustumCulled = false; s.world.add(pathLine);
  const u = ui(panel);
  let L = .2, showRays = true;
  u.slider('thinking time', 0, 2, .05, L, v => (L = v), v => `${(+v).toFixed(2)} s`);
  u.row(u.button('rays', b => { showRays = !showRays; b.classList.toggle('on', showRays); rays.visible = showRays; }, true),
        u.button('new run', () => newRun()));
  const steps = u.list(['<b>sense</b> lidar scan · /scan at 5 Hz', '<b>think</b> obstacle ahead? stop or go', '<b>act</b> /cmd_vel to the wheel motors']);
  const out = u.readout(), flash = u.text('', 'scene-flash');
  u.text('The robot only ever acts on an <b>old</b> picture of the world: pink dots are the scan its current command came from. Drag the slider past about 1 s and it drives into the person.');
  const rc = new THREE.Raycaster(); rc.far = RMAX;
  const origin = new THREE.Vector3(), dir = new THREE.Vector3();
  let x, v, go, py, crossing, state, until, queue, nextScan, lastScan, acting, lastApply, runs = 0, safe = 0, crashes = 0, closest;
  function scan(t) {
    s.scene.updateMatrixWorld(true); bot.links.base_scan.getWorldPosition(origin);
    const pts = new Float32Array(N * 3), rp = rays.geometry.attributes.position.array; let front = Infinity;
    for (let i = 0; i < N; i++) {
      const ang = i * 2 * Math.PI / N; dir.set(Math.cos(ang), 0, -Math.sin(ang)); rc.set(origin, dir);
      const hit = rc.intersectObjects(solids, false)[0], r = hit ? hit.distance : RMAX;
      const deg = i * 360 / N; if ((deg <= 60 || deg >= 300) && r < front) front = r;
      pts.set(hit ? [origin.x + dir.x * r, origin.y, origin.z + dir.z * r] : [0, -99, 0], i * 3);
      rp.set([origin.x, origin.y, origin.z, origin.x + dir.x * r, origin.y, origin.z + dir.z * r], i * 6);
    }
    rays.geometry.attributes.position.needsUpdate = true;
    return { t, pts, front, go: front > STOP };
  }
  function newRun(t = 0) {
    x = START; v = 0; go = true; py = 1.15; crossing = false; state = 'drive'; until = 0; queue = []; nextScan = t; lastApply = -9; closest = 9;
    bot.position.set(x, 0, 0); bot.rotation.set(0, 0, 0); person.position.set(0, py, 0);
    lastScan = acting = scan(t);
  }
  newRun();
  return { ...s, reset() { newRun(0); }, update(t, dt) {
    if (dt > 0) {
      if (state === 'crash' || state === 'done') { if (t > until) newRun(t); }
      else {
        while (t >= nextScan) { lastScan = scan(nextScan); queue.push({ at: nextScan + L, sc: lastScan }); nextScan += .2; }
        while (queue.length && queue[0].at <= t) { acting = queue.shift().sc; go = acting.go; lastApply = t; }
        v += clamp((go ? .22 : 0) - v, -1.5 * dt, 1.5 * dt); x += v * dt;
        if (!crossing && x > -1.0) crossing = true;
        if (crossing) py = Math.max(py - .3 * dt, -1.2);
        const d = Math.hypot(x, py); closest = Math.min(closest, d - R_BOT - R_PERSON);
        if (d < R_BOT + R_PERSON) { state = 'crash'; until = t + 2.2; runs++; crashes++; v = 0; }
        else if (x >= GOAL) { state = 'done'; until = t + 1.2; runs++; safe++; v = 0; }
      }
    }
    bot.position.set(x, 0, 0); person.position.set(0, py, 0);
    bot.joints.wheel_left_joint.setJointValue(x / .033); bot.joints.wheel_right_joint.setJointValue(x / .033);
    seen.geometry.attributes.position.array.set(acting.pts); seen.geometry.attributes.position.needsUpdate = true;
    const pa = pathLine.geometry.attributes.position.array; pa.set([x, 0, .01, GOAL, 0, .01]); pathLine.geometry.attributes.position.needsUpdate = true; pathLine.computeLineDistances();
    pathLine.material.color.set(go ? C.cyan : C.orange);
    steps[0].classList.toggle('on', t - lastScan.t < .08); steps[1].classList.toggle('on', queue.length > 0 && state !== 'crash'); steps[2].classList.toggle('on', t - lastApply < .12);
    const age = Math.max(0, t - acting.t);
    const st = state === 'crash' ? 'COLLISION' : state === 'done' ? 'reached the goal' : go ? 'driving' : `stopped: obstacle ${acting.front.toFixed(2)} m ahead`;
    out.innerHTML = `<b>loop</b> scan every 0.2 s, decide in ${L.toFixed(2)} s<br><b>acting on</b> a scan ${age.toFixed(2)} s old<br><b>driven blind</b> about ${(.22 * age * 100).toFixed(0)} cm at 0.22 m/s<br><b>state</b> ${st}<br><b>runs</b> ${runs} · safe ${safe} · collisions ${crashes}`;
    flash.textContent = state === 'crash' ? 'collision: the robot decided too late' : state === 'done' ? `safe run · closest gap ${(Math.max(closest, 0) * 100).toFixed(0)} cm` : '';
    flash.classList.toggle('bad', state === 'crash');
  } };
};

// ---------- Inside a robot: an exploded TurtleBot3 Burger ----------
// Specs: ROBOTIS TurtleBot3 Burger specification (e-Manual) and turtlebot3_description.
const BURGER_PARTS = {
  lds: ['LDS lidar', 'sensor', 'A 360° laser distance sensor: LDS-01, or LDS-02 on newer kits. The LDS-01 measures 0.12–3.5 m, 360 samples per turn at 5 Hz; the LDS-02 reaches 8 m. Publishes <code>/scan</code> (sensor_msgs/msg/LaserScan).'],
  sbc: ['Raspberry Pi 4', 'brain', 'Single-board computer (a Raspberry Pi 3 B+ on older kits) running Ubuntu and ROS 2: <code>turtlebot3_node</code>, the lidar driver and <code>robot_state_publisher</code>. Joins the laptop over Wi-Fi.'],
  opencr: ['OpenCR 1.0', 'brain', 'Control board with a 32-bit ARM Cortex-M7 at 216 MHz and an on-board IMU (3-axis gyroscope and accelerometer). Runs firmware, not ROS: it drives the motor bus and talks to <code>turtlebot3_node</code> over USB.'],
  motors: ['DYNAMIXEL XL430-W250 × 2', 'actuator', 'Smart servos in wheel mode. Each has its own position sensor, so the motor reports how far its wheel turned: that becomes <code>/joint_states</code> and <code>/odom</code>.'],
  wheels: ['Wheels', 'actuator', 'Radius 33 mm, 160 mm apart (turtlebot3_description). Differential drive: top speed 0.22 m/s forward and 2.84 rad/s turning.'],
  battery: ['LiPo battery', 'body', 'Lithium polymer 11.1 V, 1800 mAh (19.98 Wh). Expected operating time about 2 h 30 min.'],
  caster: ['Ball caster', 'body', 'The passive third contact point. No motor and no sensor: not every part of a robot is smart.'],
  plates: ['Waffle plates', 'body', 'Modular layers that hold everything. Assembled size 138 × 178 × 192 mm (L × W × H), about 1 kg, maximum payload 15 kg.'],
};
SCENES['anatomy'] = async (panel) => {
  const s = base3d({ cam: [.44, .36, .52], target: [0, .15, 0], grid: 1 });
  const groups = {}, layers = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()], lbl = {};
  const model = new THREE.Group(); layers.forEach(l => model.add(l)); s.world.add(model);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .15, ...extra });
  function add(key, layer, mesh, x, y, z) {
    const gk = key === 'plates' ? key + layer : key;   // plates belong to every layer
    const g = (groups[gk] ??= new THREE.Group()); if (!g.parent) layers[layer].add(g);
    mesh.position.set(x, y, z); mesh.userData.part = key; g.add(mesh); return mesh;
  }
  const PLATE_Z = [.012, .062, .102, .142];
  PLATE_Z.forEach((z, i) => {
    add('plates', i, box(.138, .132, .003, 0x3d4560), 0, 0, z);
    if (i) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const h = z - PLATE_Z[i - 1], post = new THREE.Mesh(new THREE.CylinderGeometry(.003, .003, h, 8), mat(0x8f9ab3));
      post.rotation.x = Math.PI / 2; add('plates', i, post, sx * .058, sy * .055, z - h / 2);
    }
  });
  for (const sy of [1, -1]) {
    add('motors', 0, new THREE.Mesh(new THREE.BoxGeometry(.0465, .034, .0285), mat(0x262a35)), 0, sy * .045, .028);
    const wheel = new THREE.Group(); wheel.userData.part = 'wheels';
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(.033, .033, .018, 32), mat(0x1b1e26)); tire.userData.part = 'wheels';
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .02, 20), mat(0xc9d1e3)); hub.userData.part = 'wheels';
    wheel.add(tire, hub); add('wheels', 0, wheel, 0, sy * .08, .033);
  }
  add('battery', 0, new THREE.Mesh(new THREE.BoxGeometry(.085, .034, .025), mat(0xd9a03b)), -.01, 0, .027);
  add('caster', 0, new THREE.Mesh(new THREE.SphereGeometry(.01, 16, 12), mat(0xc9d1e3)), -.055, 0, .005);
  add('opencr', 1, new THREE.Mesh(new THREE.BoxGeometry(.105, .075, .003), mat(0x1f4f8f)), 0, 0, PLATE_Z[1] + .004);
  add('opencr', 1, box(.008, .008, .002, 0x111111), .03, -.02, PLATE_Z[1] + .0065);
  add('sbc', 2, new THREE.Mesh(new THREE.BoxGeometry(.085, .056, .002), mat(0x2e7d4f)), 0, 0, PLATE_Z[2] + .004);
  for (const [x, y] of [[-.035, .012], [-.035, -.012], [.02, 0]]) add('sbc', 2, box(.018, .014, .014, 0xb0b8c8), x, y, PLATE_Z[2] + .012);
  add('lds', 3, new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .02, 32).rotateX(Math.PI / 2), mat(0x262a35)), 0, 0, PLATE_Z[3] + .012);
  const head = add('lds', 3, new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .016, 32).rotateX(Math.PI / 2), mat(0x39425e)), 0, 0, PLATE_Z[3] + .03);
  const lens = box(.012, .02, .008, C.pink); lens.position.x = .026; lens.userData.part = 'lds'; head.add(lens);
  for (const k of Object.keys(BURGER_PARTS)) {
    const g = groups[k] ?? groups[k + '3'], l = label(BURGER_PARTS[k][0], 'small'); g.add(l); lbl[k] = l;
    const b = new THREE.Box3().setFromObject(g); b.getCenter(l.position); l.position.z = b.max.z + .012;
    if (k === 'wheels') l.position.y = .1; if (k === 'plates') l.position.set(.07, -.07, PLATE_Z[3] + .005);
  }
  const mats = new Map(); s.world.traverse(o => { if (o.isMesh) mats.set(o, o.material.emissive?.clone()); });
  const real = await turtlebot(); real.visible = false; s.world.add(real);
  const u = ui(panel);
  let sel = 'lds', explode = 1, auto = true, showReal = false;
  const partBtns = Object.keys(BURGER_PARTS).map(k => u.button(BURGER_PARTS[k][0].replace(' × 2', ''), () => select(k, true), k === sel));
  u.row(...partBtns);
  const ex = u.slider('explode', 0, 1, .01, explode, v => { explode = v; stopAuto(); });
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(autoBtn, u.button('URDF model', b => { showReal = !showReal; b.classList.toggle('on', showReal); real.visible = showReal; model.visible = !showReal; }));
  const out = u.readout();
  u.text('<b>TurtleBot3 Burger</b>: 0.22 m/s, 2.84 rad/s, differential drive. Click a part in 3D or a button. Colours: <b style="color:#58e0d2">sense</b>, <b style="color:#6aa8ff">think</b>, <b style="color:#ffb15a">act</b>.');
  function stopAuto() { auto = false; autoBtn.classList.remove('on'); }
  function select(k, manual) {
    sel = k; if (manual) stopAuto();
    partBtns.forEach((b, i) => b.classList.toggle('on', Object.keys(BURGER_PARTS)[i] === k));
    const [name, kind, text] = BURGER_PARTS[k];
    out.innerHTML = `<b>${name}</b> · ${{ sensor: 'sense', brain: 'think', actuator: 'act', body: 'structure and power' }[kind]}<br>${text}`;
    for (const [m, e] of mats) if (m.material.emissive) { m.material.emissive.copy(e); if (m.userData.part === k || m.parent?.userData.part === k) m.material.emissive.set(KIND[kind] ?? '#555c70').multiplyScalar(.45); }
  }
  // meshes share materials through box(); give each its own so highlighting stays per part
  for (const m of mats.keys()) m.material = m.material.clone();
  select(sel);
  const ORDER = Object.keys(BURGER_PARTS);
  return { ...s, pick(ray) {
    const hit = ray.intersectObjects(model.visible ? [model] : [], true).find(h => h.object.userData.part || h.object.parent?.userData.part);
    if (hit) select(hit.object.userData.part || hit.object.parent.userData.part, true);
  }, update(t) {
    if (auto) {
      explode = .5 - .5 * Math.cos(t * .5); ex.set(explode);
      const k = ORDER[Math.floor(t / 3.2) % ORDER.length]; if (k !== sel) select(k);
    }
    layers.forEach((l, i) => (l.position.z = explode * i * .04));
    groups.wheels.children.forEach((w, i) => { w.position.y = Math.sign(w.position.y) * (.08 + explode * .03); w.rotation.y = t * 3; });
    groups.motors.children.forEach(m => (m.position.y = Math.sign(m.position.y) * (.045 + explode * .012)));
    head.rotation.z = t * Math.PI * 2;
    for (const [k, l] of Object.entries(lbl)) l.visible = !showReal && (k === sel || explode > .55);
    real.joints?.wheel_left_joint?.setJointValue(t * 3); real.joints?.wheel_right_joint?.setJointValue(t * 3);
  } };
};

// ---------- Inside a robot: sort sensors into inside (proprioceptive) and outside (exteroceptive) ----------
// Move a node with a short slide from where it was (FLIP), so placing a card reads as motion.
function flip(node, move) {
  const a = node.getBoundingClientRect(); move();
  if (reduceMotion.matches) return;
  const b = node.getBoundingClientRect();
  node.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.45,0,.2,1)' });
}
SCENES['sort-sensors'] = async (panel, view) => {
  const game = view.querySelector('.sort-game'), pool = game.querySelector('.sort-pool');
  const cards = [...game.querySelectorAll('.sort-card')], bins = [...game.querySelectorAll('.sort-bin')];
  const u = ui(panel);
  const score = u.readout(), flash = u.text('', 'scene-flash'), why = u.text('Drag each sensor into a box, or click a sensor and then a box.');
  let solving = false, nextSolve = 0, selected = null, tries = 0;
  u.row(u.button('show answers', () => { solving = true; nextSolve = 0; }), u.button('shuffle', () => reset()));
  u.text('<b>Inside</b> (proprioceptive): the robot measuring itself. <b>Outside</b> (exteroceptive): the robot measuring the world. Each one arrives in ROS 2 as a standard message type.');
  const placed = () => cards.filter(c => c.classList.contains('placed')).length;
  const tally = () => { score.innerHTML = `<b>sorted</b> ${placed()} / ${cards.length} · <b>attempts</b> ${tries}`; };
  function select(c) { selected = c; cards.forEach(k => k.classList.toggle('selected', k === c)); }
  function drop(card, bin) {
    if (!bin || card.classList.contains('placed')) return;
    tries++;
    const ok = card.dataset.bin === bin.dataset.bin;
    if (ok) {
      flip(card, () => bin.querySelector('.sort-drop').append(card));
      card.classList.add('placed'); card.disabled = true;
      flash.textContent = `${card.querySelector('strong').textContent} → ${card.querySelector('small').textContent}`; flash.classList.remove('bad');
    } else {
      card.classList.remove('wrong'); void card.offsetWidth; card.classList.add('wrong');
      flash.textContent = 'not quite: try the other box'; flash.classList.add('bad');
    }
    why.innerHTML = card.dataset.why;
    select(null); tally();
    if (placed() === cards.length) { flash.textContent = `all ${cards.length} sorted`; flash.classList.remove('bad'); }
  }
  // pointer drag; a press without movement selects instead
  let drag = null;
  cards.forEach(c => {
    c.addEventListener('pointerdown', e => {
      if (c.classList.contains('placed')) return;
      drag = { c, x: e.clientX, y: e.clientY, moved: false }; c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      if (drag?.c !== c) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true; c.classList.add('dragging'); c.style.transform = `translate(${dx}px, ${dy}px)`;
      c.style.pointerEvents = 'none'; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sort-bin'); c.style.pointerEvents = '';
      bins.forEach(b => b.classList.toggle('hover', b === over));
    });
    c.addEventListener('pointerup', e => {
      if (drag?.c !== c) return;
      const moved = drag.moved; drag = null;
      c.style.pointerEvents = 'none'; const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sort-bin'); c.style.pointerEvents = '';
      c.classList.remove('dragging'); bins.forEach(b => b.classList.remove('hover'));
      if (moved) { c.style.transform = ''; if (over) drop(c, over); }
      else select(selected === c ? null : c);
    });
    c.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); select(c); } });
  });
  bins.forEach(b => {
    b.addEventListener('click', e => { if (selected && !e.target.closest('.sort-card')) drop(selected, b); });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && selected) { e.preventDefault(); drop(selected, b); } });
  });
  function reset() {
    solving = false; tries = 0; select(null);
    cards.sort(() => Math.random() - .5).forEach(c => { c.classList.remove('placed', 'wrong'); c.disabled = false; pool.append(c); });
    flash.textContent = ''; why.textContent = 'Drag each sensor into a box, or click a sensor and then a box.'; tally();
  }
  reset();
  return { dom: true, reset, update(t) {
    if (!solving) return;
    if (t < nextSolve) return;
    const c = cards.find(k => !k.classList.contains('placed'));
    if (!c) { solving = false; return; }
    tries--; drop(c, bins.find(b => b.dataset.bin === c.dataset.bin)); nextSolve = t + .7;
  } };
};

// ---------- Inside a robot: actuators need feedback (open vs closed loop) ----------
SCENES['feedback'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let closed = true, kp = 3, ki = 6, kd = 0;
  const modeBtns = [['open loop', false], ['closed loop · PID', true]].map(([n, v]) => u.button(n, () => { closed = v; modeBtns.forEach(b => b.classList.toggle('on', b.textContent === n)); integ = 0; sl.forEach(x => (x.input.disabled = !closed)); }, v === closed));
  u.row(...modeBtns);
  const sl = [u.slider('Kp', 0, 15, .1, kp, v => (kp = v), v => (+v).toFixed(1)), u.slider('Ki', 0, 20, .1, ki, v => (ki = v), v => (+v).toFixed(1)), u.slider('Kd', 0, .3, .005, kd, v => (kd = v), v => (+v).toFixed(3))];
  const out = u.readout(), flash = u.text('', 'scene-flash');
  u.text('The motor gets a <b>command</b>; the encoder <b>measures</b> what really happened. Open loop trusts the command. Closed loop compares and corrects, so the ramp (pink) barely matters. Push Kp high and the 50 ms sensor delay makes it ring.');
  const TAU = .25, DELAY = .05, H = .001, CYCLE = 12, WIN = 10;
  const target = tc => (tc < .5 ? 0 : tc < 6 ? .6 : .35), loadOn = tc => tc >= 3 && tc < 9;
  let w, integ, buf, hist, theta, simT, prevMeas;
  const reset = () => { w = 0; integ = 0; buf = new Array(Math.round(DELAY / H)).fill(0); hist = []; theta = 0; simT = 0; prevMeas = 0; };
  reset();
  let u_ = 0;
  return { canvas, reset, update(t, dt) {
    for (let k = 0, n = Math.round(dt / H); k < n; k++) {
      simT += H; const tc = simT % CYCLE, r = target(tc);
      const meas = buf.shift(); buf.push(w);
      if (closed) {
        const e = r - meas, dm = (meas - prevMeas) / H; prevMeas = meas;
        const raw = kp * e + ki * integ - kd * dm;
        u_ = clamp(raw, -1.5, 1.5); if (u_ === raw || Math.sign(e) !== Math.sign(raw)) integ += e * H;
      } else u_ = r;
      w += ((u_ - w) / TAU - (loadOn(tc) ? 1 : 0)) * H;
      theta += w * H * 14;
      if (k % 20 === 0) hist.push([simT, r, w, loadOn(tc)]);
    }
    hist = hist.filter(p => simT - p[0] < WIN);
    const { ctx, w: W, h: Hh } = fit2d(canvas); ctx.clearRect(0, 0, W, Hh);
    const dh = Hh * .42, tc = simT % CYCLE, r = target(tc), meas = buf[0];
    // block diagram
    const y = dh * .42, fs = W < 520 ? 9 : 11;
    const bx = [W * .02, W * .25, W * .52], bw = W * .19, bh = 40;
    const blk = (x, title, sub, c) => { ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.beginPath(); ctx.roundRect(x, y - bh / 2, bw, bh, 6); ctx.fill(); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillStyle = CSS.ink; ctx.font = sans(fs + 2); ctx.fillText(title, x + bw / 2, y - 3); ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.fillText(sub, x + bw / 2, y + 12); };
    blk(bx[0], 'target speed', `${(r * 100).toFixed(0)} %`, CSS.cyan);
    blk(bx[1], closed ? 'controller' : 'open loop', closed ? 'PID: u = f(error)' : 'u = target', CSS.blue);
    blk(bx[2], 'motor', `u = ${(u_ * 100).toFixed(0)} %`, CSS.orange);
    const wx = W * .88, wy = y, wr = Math.min(dh * .3, 46, W * .075);
    ctx.strokeStyle = '#8f9ab3'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(wx, wy, wr, 0, 7); ctx.stroke();
    ctx.lineWidth = 2; for (let k = 0; k < 4; k++) { const a = theta + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + wr * Math.cos(a), wy + wr * Math.sin(a)); ctx.stroke(); }
    dot(ctx, wx, wy, 5, CSS.cyan);
    if (loadOn(tc)) { ctx.fillStyle = 'rgba(255,114,159,.85)'; ctx.font = mono(fs, 600); ctx.textAlign = 'center'; ctx.fillText('ramp: extra load', wx, wy - wr - 10); }
    ctx.fillStyle = CSS.ink; ctx.font = mono(fs); ctx.textAlign = 'center'; ctx.fillText(`speed ${(w * 100).toFixed(0)} %`, wx, wy + wr + 16);
    arrowTo(ctx, bx[0] + bw, y, bx[1] - 2, y, CSS.cyan); arrowTo(ctx, bx[1] + bw, y, bx[2] - 2, y, CSS.blue); arrowTo(ctx, bx[2] + bw, y, wx - wr - 6, y, CSS.orange);
    const fy = y + bh / 2 + dh * .3;
    ctx.setLineDash(closed ? [] : [4, 5]); ctx.strokeStyle = closed ? CSS.cyan : 'rgba(168,176,195,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wx, wy + wr + 22); ctx.lineTo(wx, fy); ctx.lineTo(bx[1] + bw / 2, fy); ctx.stroke(); ctx.setLineDash([]);
    if (closed) arrowTo(ctx, bx[1] + bw / 2, fy, bx[1] + bw / 2, y + bh / 2 + 2, CSS.cyan);
    ctx.fillStyle = closed ? CSS.cyan : CSS.muted; ctx.font = mono(fs); ctx.textAlign = 'center';
    ctx.fillText(closed ? `encoder feedback · measured ${(meas * 100).toFixed(0)} % (50 ms old)` : 'encoder ignored: no feedback', (wx + bx[1] + bw / 2) / 2, fy - 7);
    const pk = (p, a, b) => dot(ctx, lerp(a[0], b[0], p), lerp(a[1], b[1], p), 4, CSS.ink);
    const ph = (simT * .8) % 1;
    pk(ph, [bx[0] + bw, y], [bx[1], y]); pk(ph, [bx[1] + bw, y], [bx[2], y]);
    if (closed) { const L1 = fy - (wy + wr + 22), L2 = wx - (bx[1] + bw / 2), L3 = fy - (y + bh / 2), q = ph * (L1 + L2 + L3); const p = q < L1 ? [wx, wy + wr + 22 + q] : q < L1 + L2 ? [wx - (q - L1), fy] : [bx[1] + bw / 2, fy - (q - L1 - L2)]; dot(ctx, p[0], p[1], 4, CSS.cyan); }
    // plot
    const py = dh + 8, ph2 = Hh - py - 4, X = tt => (tt - (simT - WIN)) / WIN * W, Y = v => py + ph2 - (v + .1) / 1.3 * ph2;
    ctx.strokeStyle = CSS.line; ctx.lineWidth = 1; ctx.strokeRect(.5, py + .5, W - 1, ph2 - 1);
    ctx.fillStyle = 'rgba(255,114,159,.1)';
    hist.forEach((p, i) => { if (p[3] && hist[i + 1]) ctx.fillRect(X(p[0]), py, X(hist[i + 1][0]) - X(p[0]) + .5, ph2); });
    const line = (k, c, dash) => { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.setLineDash(dash || []); ctx.beginPath(); hist.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[k])) : ctx.moveTo(X(p[0]), Y(p[k])))); ctx.stroke(); ctx.setLineDash([]); };
    line(1, CSS.cyan, [6, 4]); line(2, CSS.orange);
    ctx.textAlign = 'left'; ctx.fillStyle = CSS.muted; ctx.font = mono(11); ctx.fillText('wheel speed, % of max · target (dashed) vs measured · last 10 s', 8, py + 15);
    // readout
    const recent = hist.filter(p => simT - p[0] < 2), err = r - w;
    const rms = Math.sqrt(hist.reduce((a, p) => a + (p[1] - p[2]) ** 2, 0) / Math.max(hist.length, 1));
    let flips = 0; for (let i = 1; i < recent.length; i++) if (Math.sign(recent[i][1] - recent[i][2]) !== Math.sign(recent[i - 1][1] - recent[i - 1][2])) flips++;
    out.innerHTML = `<b>mode</b> ${closed ? `closed loop · Kp ${kp.toFixed(1)} Ki ${ki.toFixed(1)} Kd ${kd.toFixed(3)}` : 'open loop'}<br><b>target</b> ${(r * 100).toFixed(0)} % · <b>speed</b> ${(w * 100).toFixed(0)} % · <b>error</b> ${(err * 100).toFixed(0)} %<br><b>RMS error</b> over 10 s: ${(rms * 100).toFixed(1)} %`;
    const bad = flips > 8 || (!closed && loadOn(tc) && Math.abs(err) > .1);
    flash.textContent = flips > 8 ? 'oscillating: gain too high for the sensor delay' : !closed && loadOn(tc) ? 'open loop: the load slows the wheel and nothing corrects it' : closed && loadOn(tc) && Math.abs(err) < .03 ? 'feedback cancels the load' : '';
    flash.classList.toggle('bad', bad);
  } };
};

// ---------- Inside a robot: the autonomy stack, for a mobile robot and an arm ----------
const STAGES = [['perception', CSS.cyan], ['localization', CSS.blue], ['planning', CSS.orange], ['control', CSS.pink]];
const STACK = {
  nav: { name: 'mobile robot · Nav2', stages: [
    ['What is around me?', 'Nav2 costmaps (<code>nav2_costmap_2d</code>): obstacle and inflation layers built from <code>/scan</code>', '/scan'],
    ['Where am I?', '<code>nav2_amcl</code> on a known map, or <code>slam_toolbox</code> while mapping; both publish the map → odom transform', '/map · /amcl_pose · tf'],
    ['How do I get there?', '<code>planner_server</code> (NavFn or Smac) finds a path to the goal; the behavior tree replans about once a second', '/plan'],
    ['Which wheel speeds now?', '<code>controller_server</code> (DWB, Regulated Pure Pursuit or MPPI) at 20 Hz, then ros2_control <code>diff_drive_controller</code>', '/cmd_vel'],
  ] },
  arm: { name: 'arm · MoveIt 2', stages: [
    ['What is around me?', 'A depth camera fills the MoveIt planning scene (occupancy map updater), so obstacles are known', '/camera/points'],
    ['Where is everything?', 'tf2 and <code>robot_state_publisher</code>: the object pose in the arm base frame', '/tf · /joint_states'],
    ['How do I move?', '<code>move_group</code> with OMPL or Pilz plans a collision-free joint trajectory, then adds timing', 'action: /move_action'],
    ['Which joint commands now?', 'ros2_control <code>joint_trajectory_controller</code> follows the trajectory at the hardware rate', 'action: follow_joint_trajectory'],
  ] },
};
SCENES['autonomy'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let mode = 'nav', stage = 0, auto = true, regions = [];
  const modeBtns = Object.entries(STACK).map(([k, m]) => u.button(m.name, () => { mode = k; modeBtns.forEach(b => b.classList.toggle('on', b.textContent === m.name)); info(); }, k === mode));
  u.row(...modeBtns);
  const stageBtns = STAGES.map(([n], i) => u.button(n, () => pick(i, true), i === 0));
  const autoBtn = u.button('auto', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(...stageBtns, autoBtn);
  const out = u.readout();
  u.text('Four questions, asked again and again. ROS 2 packages answer each one; the arrows between the boxes are topics, transforms and actions.');
  function info() { const [q, pkg, topic] = STACK[mode].stages[stage]; out.innerHTML = `<b>${STAGES[stage][0]}</b> · ${q}<br>${pkg}<br><b>data</b> ${topic}`; }
  function pick(i, manual) { stage = i; stageBtns.forEach((b, k) => b.classList.toggle('on', k === i)); if (manual) { auto = false; autoBtn.classList.remove('on'); } info(); }
  info();
  tappable(canvas, () => regions, g => pick(g.i, true));
  // mobile world, metres
  const RECTS = [[0, 0, 10, .1], [0, 5.9, 10, .1], [0, 0, .1, 6], [9.9, 0, .1, 6], [3, 0, .3, 3.6], [6.5, 2.4, .3, 3.6], [4.6, 4.2, 1, .8], [8, 1, 1, 1]];
  const PATH = [[1, 1], [1.2, 4.5], [3.3, 4.6], [4.4, 3.3], [6.6, 1.5], [7.5, 2.8], [9, 3.6]];
  const seg = PATH.slice(1).map((p, i) => Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1])), LEN = seg.reduce((a, b) => a + b, 0);
  const along = d => { for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const f = d / seg[i], a = PATH[i], b = PATH[i + 1]; return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), Math.atan2(b[1] - a[1], b[0] - a[0]), i]; } d -= seg[i]; } const n = PATH.length - 1; return [...PATH[n], Math.atan2(PATH[n][1] - PATH[n - 1][1], PATH[n][0] - PATH[n - 1][0]), n - 1]; };
  const castRay = (ox, oy, dx, dy) => { let best = 3.5; for (const [x, y, w, h] of RECTS) { let t0 = -1e9, t1 = 1e9; for (const [o, d, lo, hi] of [[ox, dx, x, x + w], [oy, dy, y, y + h]]) { if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 1e9; break; } } else { const a = (lo - o) / d, b = (hi - o) / d; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); } } if (t0 <= t1 && t0 > 0 && t0 < best) best = t0; } return best; };
  const rand = rng(21), PARTS = Array.from({ length: 50 }, () => [gauss(rand), gauss(rand), gauss(rand)]);
  // arm world: 2-link planar arm on a table
  const L1 = 1.3, L2 = 1.2, BASE = [1.2, .4], WAY = [[1.9, 1.3], [2.4, 1.55], [3.2, 1.0], [3.2, .5], [3.2, 1.0], [2.4, 1.55], [1.9, 1.3]];
  const awSeg = WAY.slice(1).map((p, i) => Math.hypot(p[0] - WAY[i][0], p[1] - WAY[i][1])), AWL = awSeg.reduce((a, b) => a + b, 0);
  const awAt = d => { for (let i = 0; i < awSeg.length; i++) { if (d <= awSeg[i]) { const f = smooth(d / awSeg[i]); return [lerp(WAY[i][0], WAY[i + 1][0], f), lerp(WAY[i][1], WAY[i + 1][1], f)]; } d -= awSeg[i]; } return WAY[WAY.length - 1]; };
  const ik2 = ([x, y]) => { const dx = x - BASE[0], dy = y - BASE[1], c = clamp((dx * dx + dy * dy - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1), q2 = -Math.acos(c); return [Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * Math.cos(q2)), q2]; };
  let prevQ = null;
  return { canvas, update(t, dt) {
    if (auto) { const i = Math.floor(t / 3.5) % 4; if (i !== stage) pick(i); }
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const bandH = Math.min(96, h * .26), wh = h - bandH - 10, alpha = i => (i === stage ? 1 : .2);
    const fs = w < 520 ? 9 : 11;
    if (mode === 'nav') {
      const sc = Math.min((w - 16) / 10, (wh - 8) / 6), ox = (w - 10 * sc) / 2, oy = 4 + (wh - 8 - 6 * sc) / 2, P = (x, y) => [ox + x * sc, oy + (6 - y) * sc];
      const d = (t * .55) % (2 * LEN), [rx, ry, yaw, si] = along(d < LEN ? d : 2 * LEN - d), heading = d < LEN ? yaw : yaw + Math.PI;
      // perception: inflated costmap + scan
      ctx.globalAlpha = alpha(0) * .6; ctx.fillStyle = 'rgba(88,224,210,.18)';
      RECTS.forEach(([x, y, rw, rh]) => { const [a, b] = P(x - .3, y + rh + .3); ctx.beginPath(); ctx.roundRect(a, b, (rw + .6) * sc, (rh + .6) * sc, .3 * sc); ctx.fill(); });
      ctx.globalAlpha = 1; ctx.fillStyle = '#3a4566'; RECTS.forEach(([x, y, rw, rh]) => { const [a, b] = P(x, y + rh); ctx.fillRect(a, b, rw * sc, rh * sc); });
      ctx.globalAlpha = alpha(0);
      for (let k = 0; k < 90; k++) { const a = k * Math.PI / 45, r = castRay(rx, ry, Math.cos(a), Math.sin(a)); if (r < 3.5) { const [px, py] = P(rx + r * Math.cos(a), ry + r * Math.sin(a)); dot(ctx, px, py, 2, CSS.cyan); } }
      // localization: particles that converge
      ctx.globalAlpha = alpha(1); const spread = .08 + .6 * (1 - ((t % 4) / 4));
      PARTS.forEach(([a, b, c]) => { const [px, py] = P(rx + a * spread, ry + b * spread), hh = heading + c * spread * .5; ctx.strokeStyle = CSS.blue; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 7 * Math.cos(hh), py - 7 * Math.sin(hh)); ctx.stroke(); dot(ctx, px, py, 1.6, CSS.blue); });
      // planning: global path to the goal
      ctx.globalAlpha = alpha(2); const goal = d < LEN ? PATH[PATH.length - 1] : PATH[0];
      const rest = d < LEN ? [[rx, ry], ...PATH.slice(si + 1)] : [[rx, ry], ...PATH.slice(0, si + 1).reverse()];
      ctx.strokeStyle = CSS.orange; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); rest.forEach((p, i) => (i ? ctx.lineTo(...P(...p)) : ctx.moveTo(...P(...p)))); ctx.stroke(); ctx.setLineDash([]);
      const [gx, gy] = P(...goal); ctx.fillStyle = CSS.orange; ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 18); ctx.lineTo(gx + 12, gy - 13); ctx.lineTo(gx, gy - 8); ctx.fill();
      // control: candidate arcs, the chosen one bright
      ctx.globalAlpha = alpha(3);
      for (let k = -3; k <= 3; k++) {
        const curv = k * .5; ctx.strokeStyle = k === 0 ? CSS.pink : 'rgba(255,114,159,.35)'; ctx.lineWidth = k === 0 ? 3 : 1.2; ctx.beginPath();
        for (let s2 = 0; s2 <= 1.0; s2 += .1) { const th = heading + curv * s2, x = rx + (Math.abs(curv) < 1e-6 ? s2 * Math.cos(heading) : (Math.sin(th) - Math.sin(heading)) / curv), y = ry + (Math.abs(curv) < 1e-6 ? s2 * Math.sin(heading) : (Math.cos(heading) - Math.cos(th)) / curv); s2 ? ctx.lineTo(...P(x, y)) : ctx.moveTo(...P(x, y)); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const [bx, by] = P(rx, ry); ctx.fillStyle = '#c9d1e3'; ctx.beginPath(); ctx.arc(bx, by, .2 * sc, 0, 7); ctx.fill();
      ctx.strokeStyle = '#080d19'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + .2 * sc * Math.cos(heading), by - .2 * sc * Math.sin(heading)); ctx.stroke();
    } else {
      const sc = Math.min((w - 16) / 4.4, (wh - 8) / 2.9), ox = (w - 4.4 * sc) / 2 - .2 * sc, gy = wh - 10, P = (x, y) => [ox + x * sc, gy - y * sc];
      const d = (t * .5) % AWL, tip = awAt(d), q = ik2(tip), elbow = [BASE[0] + L1 * Math.cos(q[0]), BASE[1] + L1 * Math.sin(q[0])];
      const qd = prevQ && dt > 0 ? [(q[0] - prevQ[0]) / dt, (q[1] - prevQ[1]) / dt] : [0, 0]; if (dt > 0) prevQ = q;
      ctx.fillStyle = '#2a3350'; ctx.fillRect(...P(.2, 0), 4 * sc, 8);
      ctx.fillStyle = '#3a4566'; ctx.fillRect(...P(2.15, .85), .45 * sc, .85 * sc);
      ctx.fillStyle = CSS.green; ctx.fillRect(...P(3.08, .3), .24 * sc, .3 * sc);
      const cam = [2.75, 2.65];
      // perception: camera frustum and points
      ctx.globalAlpha = alpha(0); ctx.strokeStyle = 'rgba(88,224,210,.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(...P(...cam)); ctx.lineTo(...P(1.9, 0)); ctx.moveTo(...P(...cam)); ctx.lineTo(...P(4.1, 0)); ctx.stroke();
      for (let x = 2.15; x <= 2.6; x += .07) dot(ctx, ...P(x, .85), 2, CSS.cyan);
      for (let x = 3.08; x <= 3.32; x += .06) dot(ctx, ...P(x, .3), 2, CSS.cyan);
      for (let x = 3.4; x <= 4.0; x += .1) dot(ctx, ...P(x, 0), 2, CSS.cyan);
      ctx.fillStyle = '#c9d1e3'; ctx.fillRect(P(...cam)[0] - 9, P(...cam)[1] - 6, 18, 12); ctx.globalAlpha = 1;
      // localization: frames and the tf link camera -> cup
      ctx.globalAlpha = alpha(1);
      const axes = (x, y, n) => { const [px, py] = P(x, y); arrowTo(ctx, px, py, px + 22, py, CSS.pink, 2, 5); arrowTo(ctx, px, py, px, py - 22, CSS.green, 2, 5); ctx.fillStyle = CSS.blue; ctx.font = mono(fs); ctx.textAlign = 'left'; ctx.fillText(n, px + 4, py + 13); };
      axes(BASE[0] - .45, 0, 'base'); axes(cam[0] + .15, cam[1] - .1, 'camera'); axes(3.2, .3, 'cup');
      ctx.strokeStyle = CSS.blue; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(...P(BASE[0] - .45, 0)); ctx.lineTo(...P(3.2, .3)); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      // planning: the tool path over the obstacle
      ctx.globalAlpha = alpha(2); ctx.strokeStyle = CSS.orange; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath();
      for (let k = 0; k <= 60; k++) { const p = awAt(k / 60 * AWL / 2); k ? ctx.lineTo(...P(...p)) : ctx.moveTo(...P(...p)); } ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      // the arm
      ctx.strokeStyle = '#8f9ab3'; ctx.lineCap = 'round'; ctx.lineWidth = .14 * sc; ctx.beginPath(); ctx.moveTo(...P(BASE[0], 0)); ctx.lineTo(...P(...BASE)); ctx.stroke();
      ctx.strokeStyle = '#c9d1e3'; ctx.lineWidth = .1 * sc; ctx.beginPath(); ctx.moveTo(...P(...BASE)); ctx.lineTo(...P(...elbow)); ctx.lineTo(...P(...tip)); ctx.stroke(); ctx.lineCap = 'butt';
      // control: joint velocity arcs
      ctx.globalAlpha = alpha(3);
      [[BASE, q[0], qd[0]], [elbow, q[0] + q[1], qd[1]]].forEach(([c, a, v]) => { const [px, py] = P(...c), r = 18, sweep = clamp(v * .6, -1.5, 1.5); ctx.strokeStyle = CSS.pink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, r, -a, -a - sweep, sweep > 0); ctx.stroke(); });
      ctx.globalAlpha = 1; [BASE, elbow].forEach(c => dot(ctx, ...P(...c), 6, CSS.orange));
    }
    // pipeline band
    const by = h - bandH, gap = w < 520 ? 14 : 26, bw = (w - 16 - gap * 3) / 4, bh = bandH - 30;
    regions = STAGES.map(([n, c], i) => {
      const x = 8 + i * (bw + gap);
      ctx.fillStyle = i === stage ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)';
      ctx.strokeStyle = c; ctx.lineWidth = i === stage ? 2.5 : 1; ctx.beginPath(); ctx.roundRect(x, by, bw, bh, 6); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = i === stage ? c : CSS.ink; ctx.font = sans(w < 520 ? 10 : 13); ctx.fillText(n, x + bw / 2, by + bh / 2 - 4);
      ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.fillText(STACK[mode].stages[i][2].split(' · ')[0].replace('action: ', ''), x + bw / 2, by + bh / 2 + 12);
      if (i < 3) { arrowTo(ctx, x + bw + 2, by + bh / 2, x + bw + gap - 2, by + bh / 2, CSS.muted, 1.5, 6); dot(ctx, x + bw + gap * ((t * 1.5 + i * .3) % 1), by + bh / 2, 3, c); }
      return { x, y: by, w: bw, h: bh, i };
    });
    ctx.strokeStyle = 'rgba(168,176,195,.4)'; ctx.lineWidth = 1.2; ctx.setLineDash([4, 5]); ctx.beginPath();
    ctx.moveTo(w - 8 - bw / 2, by + bh); ctx.lineTo(w - 8 - bw / 2, by + bh + 12); ctx.lineTo(8 + bw / 2, by + bh + 12); ctx.lineTo(8 + bw / 2, by + bh + 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.textAlign = 'center'; ctx.fillText('the robot moves, the world changes: repeat', w / 2, by + bh + 24);
    ctx.textAlign = 'left';
  } };
};

// ---------- Inside a robot: loops at different speeds ----------
const RATES = [
  [1000, 'motor control', CSS.pink, 'ros2_control update loop. The Franka Panda arm needs new commands every 1 ms.'],
  [100, 'IMU', CSS.orange, 'Inertial measurement unit: rotation rate and acceleration, typically 100–400 Hz (sensor_msgs/msg/Imu).'],
  [30, 'camera', CSS.green, 'A colour camera at 30 frames per second (sensor_msgs/msg/Image).'],
  [20, 'path follower', CSS.blue, 'Nav2 controller_server: controller_frequency defaults to 20 Hz, producing /cmd_vel.'],
  [5, 'lidar scan', CSS.cyan, 'The TurtleBot3 LDS-01 spins at 5 Hz: one full 360° /scan every 0.2 s.'],
  [1, 'global replanning', '#c9d1e3', 'Nav2’s default behavior tree recomputes the global path once per second.'],
];
SCENES['loop-rates'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let logW = Math.log10(2), auto = true, sel = 0, regions = [], simT = 0;
  const zoom = u.slider('window', -2, 1, .01, logW, v => { logW = v; auto = false; autoBtn.classList.remove('on'); }, v => { const W = 10 ** v; return W < 1 ? `${(W * 1000).toFixed(0)} ms` : `${W.toFixed(1)} s`; });
  const autoBtn = u.button('auto zoom', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(autoBtn);
  const out = u.readout(), detail = u.readout();
  u.text('Each tick is one run of a loop. Zoom out and the fast loops blur into solid bars: in one global replan the motor loop runs <b>1000 times</b>. Click a lane for an example.');
  tappable(canvas, () => regions, g => { sel = g.i; });
  return { canvas, update(t, dt) {
    if (auto) { logW = -.5 + 1.5 * Math.cos(2 * Math.PI * t / 24 + 1.008); zoom.set(logW); }
    const W = 10 ** logW, speed = Math.min(1, W / 2); simT += dt * speed;
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const lw = w < 520 ? 92 : 150, tx = lw + 8, tw = w - tx - 10, top = 26, lh = (h - top - 34) / RATES.length;
    const X = tt => tx + tw - (simT - tt) / W * tw;
    ctx.font = mono(11); ctx.fillStyle = CSS.muted; ctx.textAlign = 'left';
    ctx.fillText(speed < 1 ? `slow motion ×${(1 / speed).toFixed(0)}` : 'real time', tx, 16);
    ctx.textAlign = 'right'; ctx.fillText('now', tx + tw, 16);
    regions = RATES.map(([f, name, c], i) => {
      const y = top + i * lh, mid = y + lh / 2;
      ctx.fillStyle = i === sel ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.02)'; ctx.fillRect(0, y + 2, w, lh - 4);
      ctx.textAlign = 'right'; ctx.fillStyle = i === sel ? c : CSS.ink; ctx.font = sans(w < 520 ? 10 : 13); ctx.fillText(name, lw, mid - 2);
      ctx.fillStyle = CSS.muted; ctx.font = mono(w < 520 ? 9 : 11); ctx.fillText(f >= 1000 ? '1 kHz' : `${f} Hz`, lw, mid + 13);
      const spacing = tw / (W * f), k0 = Math.ceil((simT - W) * f), k1 = Math.floor(simT * f);
      if (spacing < 3) {
        ctx.fillStyle = c; ctx.globalAlpha = .55; ctx.fillRect(tx, mid - lh * .28, tw, lh * .56); ctx.globalAlpha = 1;
        ctx.fillStyle = '#080d19'; ctx.font = mono(11, 600); ctx.textAlign = 'center'; ctx.fillText(`${k1 - k0 + 1} runs`, tx + tw / 2, mid + 4);
      } else {
        ctx.strokeStyle = c; ctx.lineWidth = spacing > 12 ? 2 : 1;
        for (let k = k0; k <= k1; k++) { const x = X(k / f), fresh = simT - k / f < Math.min(.12 * speed, 1 / f); ctx.globalAlpha = fresh ? 1 : .75; ctx.beginPath(); ctx.moveTo(x, mid - lh * (fresh ? .36 : .26)); ctx.lineTo(x, mid + lh * (fresh ? .36 : .26)); ctx.stroke(); }
        ctx.globalAlpha = 1;
        if (spacing > 40) for (let k = k0; k <= k1; k++) dot(ctx, X(k / f), mid - lh * .3, 2.5, c);
        if (k1 < k0) { ctx.fillStyle = CSS.muted; ctx.font = mono(10); ctx.textAlign = 'center'; ctx.fillText(`no run in this window · next within ${f >= 1 && 1 / f >= 1 ? (1 / f).toFixed(0) + ' s' : (1000 / f).toFixed(0) + ' ms'}`, tx + tw / 2, mid + 4); }
      }
      return { x: 0, y, w, h: lh, i };
    });
    // time axis with 1-2-5 steps
    const raw = W / 5, p10 = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(m => m * p10).find(s2 => s2 >= raw);
    ctx.strokeStyle = CSS.line; ctx.fillStyle = CSS.muted; ctx.font = mono(10); ctx.textAlign = 'center'; const ay = h - 22;
    ctx.beginPath(); ctx.moveTo(tx, ay); ctx.lineTo(tx + tw, ay); ctx.stroke();
    for (let k = 0; k * step <= W + 1e-9; k++) { const x = tx + tw - k * step / W * tw; ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, ay + 5); ctx.stroke(); const v = k * step; ctx.fillText(k ? `−${v < 1 ? +(v * 1000).toFixed(0) + ' ms' : +v.toFixed(1) + ' s'}` : '0', x, ay + 16); }
    ctx.textAlign = 'left';
    out.innerHTML = `<b>window</b> ${W < 1 ? (W * 1000).toFixed(0) + ' ms' : W.toFixed(1) + ' s'}<br>` + RATES.map(([f, n]) => `${n}: ${Math.round(W * f)}`).join(' · ');
    detail.innerHTML = `<b>${RATES[sel][1]}</b> · ${RATES[sel][0] >= 1000 ? '1 kHz' : RATES[sel][0] + ' Hz'}, every ${(1000 / RATES[sel][0]).toFixed(0)} ms<br>${RATES[sel][3]}`;
  } };
};

// ---------- Inside a robot: many programs on many computers ----------
SCENES['computers'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let flow = 'all', wifi = true, dropAt = null;
  const FLOWS = {
    cmd: ['/cmd_vel', CSS.cyan, ['teleop', 'tb3', 'fw', 'motors'], ['/cmd_vel over Wi-Fi (DDS)', 'velocity goal over USB serial', 'motor commands on the DYNAMIXEL bus']],
    scan: ['/scan', CSS.pink, ['lds', 'lidar', 'rviz'], ['raw lidar packets over USB', '/scan over Wi-Fi (DDS)']],
    odom: ['/odom + /imu', CSS.orange, ['motors', 'fw', 'tb3', 'rviz'], ['encoder positions on the bus', 'wheel and IMU data over USB', '/odom, /imu, /joint_states over Wi-Fi']],
  };
  const btns = [['all', 'all'], ...Object.entries(FLOWS).map(([k, f]) => [k, f[0]])].map(([k, n]) => u.button(n, () => { flow = k; btns.forEach(b => b.classList.toggle('on', b.textContent === n)); info(); }, k === flow));
  u.row(...btns);
  u.row(u.button('drop Wi-Fi', b => { wifi = !wifi; b.classList.toggle('on', !wifi); b.textContent = wifi ? 'drop Wi-Fi' : 'Wi-Fi down'; dropAt = null; info(); }));
  const out = u.readout(), flash = u.text('', 'scene-flash');
  u.text('Three computers, three kinds of link, one robot. Between the Pi and the laptop, <b>ROS 2</b> does discovery, typed messages and QoS. The OpenCR runs plain firmware; <code>turtlebot3_node</code> translates (micro-ROS can put ROS 2 on microcontrollers too).');
  function info() {
    const f = FLOWS[flow];
    out.innerHTML = flow === 'all' ? '<b>who is listening?</b> <b>what format?</b> <b>which computer?</b><br>Pick a data flow to follow it hop by hop.' : `<b>${f[0]}</b><br>${f[3].map((s2, i) => `${i + 1}. ${s2}`).join('<br>')}`;
    flash.textContent = wifi ? '' : 'Wi-Fi down: RViz shows stale data and no new /cmd_vel reaches the robot. What should the robot do?';
    flash.classList.toggle('bad', !wifi);
  }
  info();
  return { canvas, update(t) {
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const fs = w < 520 ? 8.5 : 11;
    const M = { laptop: [.02, .06, .27, .52, 'Laptop', 'Ubuntu + ROS 2'], pi: [.365, .06, .27, .52, 'Raspberry Pi 4', 'on the robot · ROS 2'], opencr: [.71, .06, .27, .4, 'OpenCR 1.0', 'microcontroller · firmware'] };
    const HW = { lds: [.4, .78, .2, .14, 'LDS lidar'], motors: [.73, .62, .23, .14, '2 × DYNAMIXEL'] };
    const R = ([x, y, ww, hh]) => [x * w, y * h, ww * w, hh * h];
    const PILL = { teleop: ['laptop', 0, 'teleop_keyboard'], rviz: ['laptop', 1, 'rviz2'], tb3: ['pi', 0, 'turtlebot3_node'], lidar: ['pi', 1, 'lidar driver'], rsp: ['pi', 2, 'robot_state_publisher'], fw: ['opencr', 0, 'firmware + IMU'] };
    const pos = {};
    for (const [k, [m, i]] of Object.entries(PILL)) { const [x, y, ww] = R(M[m]); pos[k] = [x + ww / 2, y + 48 + i * (fs * 3.2) + fs * 1.15]; }
    for (const [k, b] of Object.entries(HW)) { const [x, y, ww, hh] = R(b); pos[k] = [x + ww / 2, y + hh / 2]; }
    if (flow !== 'all') { const [, c, hops] = FLOWS[flow]; ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.setLineDash([3, 5]); ctx.beginPath(); hops.forEach((n, i) => (i ? ctx.lineTo(...pos[n]) : ctx.moveTo(...pos[n]))); ctx.stroke(); ctx.setLineDash([]); }
    for (const [k, m] of Object.entries(M)) {
      const [x, y, ww, hh] = R(m); ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.strokeStyle = k === 'opencr' ? CSS.orange : CSS.blue; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(x, y, ww, hh, 8); ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillStyle = CSS.ink; ctx.font = sans(fs + 2, 700); ctx.fillText(m[4], x + ww / 2, y + 18); ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.fillText(m[5], x + ww / 2, y + 32);
    }
    for (const [k, [m, i, name]] of Object.entries(PILL)) {
      const [x, y, ww] = R(M[m]), py = y + 48 + i * (fs * 3.2), px = x + 8, pw = ww - 16, ph = fs * 2.3;
      const hot = flow !== 'all' && FLOWS[flow][2].includes(k);
      ctx.fillStyle = hot ? '#1a2440' : '#11182c'; ctx.strokeStyle = hot ? FLOWS[flow][1] : m === 'opencr' ? 'rgba(255,177,90,.6)' : 'rgba(88,224,210,.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = CSS.ink; ctx.font = mono(fs); ctx.fillText(name, px + pw / 2, py + ph / 2 + fs * .35);
    }
    for (const [k, b] of Object.entries(HW)) { const [x, y, ww, hh] = R(b), hot = flow !== 'all' && FLOWS[flow][2].includes(k); ctx.fillStyle = '#11182c'; ctx.strokeStyle = hot ? FLOWS[flow][1] : '#8f9ab3'; ctx.beginPath(); ctx.roundRect(x, y, ww, hh, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = CSS.ink; ctx.font = sans(fs + 1); ctx.fillText(b[4], x + ww / 2, y + hh / 2 + 4); }
    // links between machines
    const link = (a, b, text, dashed, bad) => {
      ctx.strokeStyle = bad ? CSS.pink : 'rgba(168,176,195,.6)'; ctx.lineWidth = 2; ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = bad ? CSS.pink : CSS.muted; ctx.font = mono(fs - 1); ctx.fillText(text, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 8);
      if (bad) { const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; ctx.strokeStyle = CSS.pink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(mx - 7, my - 7 + 8); ctx.lineTo(mx + 7, my + 7 + 8); ctx.moveTo(mx + 7, my - 7 + 8); ctx.lineTo(mx - 7, my + 7 + 8); ctx.stroke(); }
    };
    const wy = h * .32;
    link([w * .29, wy], [w * .365, wy], 'Wi-Fi', true, !wifi);
    link([w * .635, h * .3], [w * .71, h * .3], 'USB', false);
    link([w * .5, h * .58], [w * .5, h * .78], 'USB', false);
    link([w * .845, h * .46], [w * .845, h * .62], 'TTL bus', false);
    // packets along each flow
    for (const [k, [, c, hops]] of Object.entries(FLOWS)) {
      const on = flow === 'all' || flow === k; ctx.globalAlpha = on ? 1 : .12;
      const pts = hops.map(n => pos[n]), segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])), L = segs.reduce((a, b) => a + b, 0);
      for (let n = 0; n < 2; n++) {
        let d = ((t * .32 + n * .5 + { cmd: 0, scan: .17, odom: .33 }[k]) % 1) * L, i = 0;
        while (i < segs.length - 1 && d > segs[i]) d -= segs[i++];
        const a = pts[i], b = pts[i + 1], f = d / segs[i], x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f);
        const crossesWifi = (a[0] < w * .3) !== (b[0] < w * .3);
        if (!wifi && crossesWifi && f > .5) { if (f < .7) { ctx.strokeStyle = CSS.pink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6 + (f - .5) * 60, 0, 7); ctx.stroke(); } continue; }
        if (!wifi && hops.slice(0, i + 1).some((hp, j) => j < i && (pos[hops[j]][0] < w * .3) !== (pos[hops[j + 1]][0] < w * .3))) continue;
        dot(ctx, x, y, 5, c);
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = CSS.muted; ctx.font = mono(fs); ctx.textAlign = 'left';
    ctx.fillText('ROS 2 graph: laptop + Pi', 8, h - 8); ctx.textAlign = 'right'; ctx.fillText('below ROS: firmware and buses', w - 8, h - 8); ctx.textAlign = 'left';
    if (!wifi) { const [x, y, ww] = R(M.laptop); ctx.fillStyle = CSS.pink; ctx.font = mono(fs, 600); ctx.textAlign = 'center'; dropAt ??= t; ctx.fillText(`no new data for ${(t - dropAt).toFixed(0)} s`, x + ww / 2, y + 48 + 3 * fs * 3.2); ctx.textAlign = 'left'; }
  } };
};

// ---------- Inside a robot: quick check ----------
SCENES['quiz'] = async (panel, view) => {
  const qs = [...view.querySelectorAll('.quiz-q')];
  const u = ui(panel), score = u.readout(), flash = u.text('', 'scene-flash');
  u.row(u.button('try again', () => reset()));
  u.text('Answer in pairs first, then click. Each answer explains itself.');
  const tally = () => { const done = qs.filter(q => q.classList.contains('done')), right = done.filter(q => q.dataset.first === 'right').length; score.innerHTML = `<b>answered</b> ${done.length} / ${qs.length} · <b>right first time</b> ${right}`; if (done.length === qs.length) { flash.textContent = right === qs.length ? 'all right first time' : 'all answered: read the explanations again'; flash.classList.toggle('bad', right < qs.length); } };
  qs.forEach(q => q.querySelectorAll('.quiz-options button').forEach(b => b.addEventListener('click', () => {
    if (q.classList.contains('done')) return;
    const ok = 'correct' in b.dataset;
    q.dataset.first ??= ok ? 'right' : 'wrong';
    b.classList.remove('wrong'); void b.offsetWidth; b.classList.add(ok ? 'right' : 'wrong'); b.blur();
    if (ok) q.classList.add('done');
    tally();
  })));
  function reset() { qs.forEach(q => { q.classList.remove('done'); delete q.dataset.first; q.querySelectorAll('button').forEach(b => b.classList.remove('right', 'wrong')); }); flash.textContent = ''; tally(); }
  reset();
  return { dom: true, update() {} };
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
  return SCENES[el.dataset.scene](panel, el.querySelector('.scene-view')).catch(err => { panel.textContent = 'Could not load this scene: ' + err.message; throw err; });
}
function snapshot() {
  if (!cur?.inst || cur.inst.dom) return;
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
  else if (!inst.dom) {
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
  const dt = clamp((now - last) / 1000, 0, .05); last = Math.max(last, now);   // rAF time can precede the mount time
  const step = isPaused() ? 0 : dt; clock += step;
  const { inst, view } = cur, w = view.clientWidth, h = view.clientHeight;
  inst.update(clock, step);
  if (!inst.canvas && !inst.dom) {
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); labels.setSize(w, h); inst.camera.aspect = w / h; inst.camera.updateProjectionMatrix();
    }
    cur.controls.update();
    renderer.render(inst.scene, inst.camera); labels.render(inst.scene, inst.camera);
  }
  raf = requestAnimationFrame(tick);
}
// A click without a drag picks in 3D scenes that offer pick(raycaster).
const picker = new THREE.Raycaster(), ndc = new THREE.Vector2();
let pressed = null;
renderer.domElement.addEventListener('pointerdown', e => { pressed = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!pressed || !cur?.inst?.pick || Math.hypot(e.clientX - pressed[0], e.clientY - pressed[1]) > 5) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  picker.setFromCamera(ndc, cur.inst.camera); cur.inst.pick(picker);
});
document.addEventListener('deck:slide', e => mount(e.detail));
document.addEventListener('deck:restart', () => { clock = 0; cur?.inst?.reset?.(); });
window.addEventListener('beforeprint', snapshot);
mount(document.querySelector('.slide.active'));
// Fetch and parse the robot models in the background so the first 3D slide opens instantly.
setTimeout(() => { panda().catch(() => {}); turtlebot().catch(() => {}); }, 3000);
