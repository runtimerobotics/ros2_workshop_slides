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
  const s = base3d({ cam: [1.9, 1.25, 1.9], target: [0, .52, 0] });   // the zero pose stands the arm straight up
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
    log.innerHTML = LOG.filter(([at]) => tc >= at).slice(-4).map(([, l]) => l.replace(/</g, '&lt;')).join('<br>');   // the newest lines, like a terminal
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
  // our arm and the lab's table: the same steps and log lines as pick_and_place.py (Lab 12)
  const s = base3d({ cam: [1.3, 1.0, -1.05], target: [.3, .3, 0], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  const plan = pickPlan('red', 0), total = planTime(plan), box_ = cell.boxes.red;
  const NAMES = ['home', 'pre-grasp (OMPL)', 'approach, straight down (Pilz LIN)', 'close gripper · attach', 'lift (LIN)', 'over the tray (OMPL)', 'lower (LIN)', 'open gripper · detach', 'retreat (LIN)', 'home'];
  const u = ui(panel), items = u.list(NAMES), out = u.readout();
  u.text('The planning scene must change with the gripper: attach after closing, detach after opening, or MoveIt plans as if the box were still on the table.');
  const reset = () => cell.reset();
  reset();
  return { ...s, reset, update(t) {
    const tc = t % (total + 1); if (tc < .05) reset();
    const p = planPose(plan, Math.min(tc, total));
    arm.set(p.q, p.grip); carry(arm, s.world, box_, p.held);
    glow(box_, C.orange, p.held ? .5 : 0);
    items.forEach((li, k) => li.classList.toggle('on', k === p.k));
    out.innerHTML = p.held ? '<b>planning scene</b><br>world objects: table<br>attached to link5: <b>red_box</b> (it may touch the fingers)' : '<b>planning scene</b><br>world objects: table, <b>red_box</b><br>attached: none';
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

// ---------- The workshop's own robot: demo_arm, its table, tray, boxes and overhead RealSense ----------
// Boxes with the sizes in ros2_workshop_code (demo_arm_description, demo_arm_gazebo/worlds/table.sdf), so the arm
// here is the arm the labs simulate. RRBot colours: orange and black links, a grey palm.
const DA = { orange: 0xe8892c, black: 0x262a35, grey: 0x8f9ab3, red: 0xe5484d, blue: 0x3f7fe0 };
const DA_L2 = .30, DA_L3 = .25, DA_SHOULDER = .28, DA_WRIST_TO_TOOL = .06 + .055, DA_OPEN = .02, DA_SHUT = .0;
function demoArm() {
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .55, metalness: .1 });
  const part = (sx, sy, sz, c, z0 = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(c)); m.position.z = z0 + sz / 2; return m; };
  const joint = (parent, z) => { const g = new THREE.Group(); g.position.z = z; parent.add(g); return g; };
  const root = new THREE.Group(), base = part(.14, .14, .2, DA.orange); root.add(base);
  const j1 = joint(root, .2), l1 = part(.08, .08, .08, DA.orange); j1.add(l1);      // joint1: base yaw (z)
  const j2 = joint(j1, .08), l2 = part(.05, .05, .30, DA.black); j2.add(l2);        // joint2: shoulder pitch (y)
  const j3 = joint(j2, .30), l3 = part(.04, .04, .25, DA.orange); j3.add(l3);       // joint3: elbow pitch (y)
  const j4 = joint(j3, .25), l4 = part(.035, .035, .06, DA.black); j4.add(l4);      // joint4: wrist pitch (y)
  const j5 = joint(j4, .06), palm = part(.04, .11, .02, DA.grey); j5.add(palm);     // joint5: wrist roll (z)
  const fingers = [1, -1].map(sg => { const f = part(.025, .012, .05, DA.black, .02); f.userData.sign = sg; j5.add(f); return f; });
  const tool = joint(j5, .055);
  const joints = [j1, j2, j3, j4, j5];
  return { root, joints, links: { base, l1, l2, l3, l4, palm, fingers, tool }, q: [0, 0, 0, 0, 0], grip: DA_OPEN,
    set(q, grip = this.grip) {
      this.q = q.slice(); this.grip = grip;
      j1.rotation.z = q[0]; j2.rotation.y = q[1]; j3.rotation.y = q[2]; j4.rotation.y = q[3]; j5.rotation.z = q[4];
      fingers.forEach(f => (f.position.y = f.userData.sign * (grip + .006)));
    } };
}
// Analytic IK for a tool pointing straight down: yaw from x, y; a planar two-link solve for the wrist; the
// wrist pitch makes the three pitch joints add up to pi; the roll keeps the fingers square to the world.
function demoArmIK([x, y, z], yaw = 0) {
  const q1 = Math.atan2(y, x), r = Math.hypot(x, y), wz = z + DA_WRIST_TO_TOOL - DA_SHOULDER;
  const q3 = Math.acos(clamp((r * r + wz * wz - DA_L2 * DA_L2 - DA_L3 * DA_L3) / (2 * DA_L2 * DA_L3), -1, 1));
  const q2 = Math.atan2(r, wz) - Math.atan2(DA_L3 * Math.sin(q3), DA_L2 + DA_L3 * Math.cos(q3));
  return [q1, q2, q3, Math.PI - q2 - q3, wrap(yaw - q1)];
}
const DA_HOME = demoArmIK([.25, 0, .42]);
const DA_BOXES = { red: [.36, .10], blue: [.48, -.04] }, DA_TRAY = [.28, -.20], DA_TABLE_TOP = .10, DA_BOX = .04;
// The cell from table.sdf and sensors.xacro. Returns the meshes the scenes animate.
function demoCell(world, { stand = true } = {}) {
  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .7, ...o });
  const top = box(.5, .6, .02, 0x3a4566); top.position.set(.4, 0, .09);
  const legs = box(.44, .54, .08, 0x232a40); legs.position.set(.4, 0, .04);
  const tray = new THREE.Group(); tray.position.set(DA_TRAY[0], DA_TRAY[1], DA_TABLE_TOP);
  const trayBase = box(.12, .12, .004, C.green, .55); trayBase.position.z = .002; tray.add(trayBase);
  for (const [x, y, sx, sy] of [[.058, 0, .004, .12], [-.058, 0, .004, .12], [0, .058, .12, .004], [0, -.058, .12, .004]]) { const w = box(sx, sy, .018, C.green, .8); w.position.set(x, y, .009); tray.add(w); }
  const boxes = Object.fromEntries(Object.entries(DA_BOXES).map(([k, [x, y]]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(DA_BOX, DA_BOX, DA_BOX), mat(DA[k], { emissive: 0x000000 }));
    b.userData.home = [x, y, DA_TABLE_TOP + DA_BOX / 2]; b.position.set(...b.userData.home); return [k, b];
  }));
  world.add(top, legs, tray, ...Object.values(boxes));
  const cell = { top, legs, tray, boxes };
  if (stand) {
    const post = box(.03, .03, 1.0, 0x5a6480); post.position.set(.4, -.55, .5);
    const bar = box(.03, .58, .03, 0x5a6480); bar.position.set(.4, -.275, 1.055);
    const cam = new THREE.Group(); cam.position.set(.4, 0, 1.0);
    const body = box(.025, .09, .025, 0xb8c0d0); cam.add(body);
    for (const y of [-.03, .03]) { const lens = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .004, 16), mat(0x111111)); lens.rotation.x = Math.PI / 2; lens.position.set(0, y, -.014); cam.add(lens); }
    world.add(post, bar, cam);
    Object.assign(cell, { post, bar, cam });
  }
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .04, 24), mat(0x1b1e26)); lidar.rotation.x = Math.PI / 2; lidar.position.set(.1, 0, .05);
  world.add(lidar); cell.lidar = lidar;
  cell.reset = () => Object.values(boxes).forEach(b => { if (b.parent !== world) world.attach(b); b.position.set(...b.userData.home); b.rotation.set(0, 0, 0); });
  return cell;
}
// One pick and place as timed joint-space segments. Each step: [name, q, grip, seconds, event].
function pickPlan(color, slot = 0) {
  const [x, y] = DA_BOXES[color], tz = DA_TABLE_TOP + DA_BOX / 2 + .005, pz = DA_TABLE_TOP + DA_BOX / 2 + .008;
  const px = DA_TRAY[0] + (slot ? -.025 : .025), py = DA_TRAY[1];
  const at = (a, b, z) => demoArmIK([a, b, z]);
  return [['home', DA_HOME, DA_OPEN, .9], ['above the box', at(x, y, tz + .12), DA_OPEN, 1.3], ['down to the box', at(x, y, tz), DA_OPEN, .9],
    ['close the gripper', at(x, y, tz), DA_SHUT + .0, .6, 'grab'], ['lift', at(x, y, tz + .14), DA_SHUT, .8], ['over the tray', at(px, py, pz + .14), DA_SHUT, 1.3],
    ['down to the tray', at(px, py, pz), DA_SHUT, .8], ['open the gripper', at(px, py, pz), DA_OPEN, .5, 'drop'], ['up', at(px, py, pz + .12), DA_OPEN, .7], ['home', DA_HOME, DA_OPEN, 1]];
}
const planTime = plan => plan.reduce((s, p) => s + p[3], 0);
// Pose at time x into a plan: interpolate from the previous step, and report which step is running.
function planPose(plan, x) {
  let k = 0; while (k < plan.length - 1 && x > plan[k][3]) x -= plan[k++][3];
  const prev = k ? plan[k - 1] : plan[plan.length - 1], f = smooth(clamp(x / plan[k][3], 0, 1));
  return { k, f, step: plan[k], q: prev[1].map((v, j) => lerp(v, plan[k][1][j], f)), grip: lerp(prev[2], plan[k][2], f),
    held: plan.slice(0, k + 1).some(s => s[4] === 'grab') && !(plan[k][4] === 'grab' && f < .7) && !(plan.slice(0, k + 1).some(s => s[4] === 'drop') && !(plan[k][4] === 'drop' && f < .5)) };
}
// Keep a box in the hand while held, then leave it where the hand let go.
function carry(arm, world, b, held) {
  if (held && b.parent !== arm.links.tool) { world.updateMatrixWorld(true); arm.links.tool.attach(b); b.position.set(0, 0, DA_BOX / 2 - .03); b.rotation.set(0, 0, 0); }
  if (!held && b.parent === arm.links.tool) { world.updateMatrixWorld(true); world.attach(b); b.position.z = DA_TABLE_TOP + DA_BOX / 2; b.rotation.set(0, 0, 0); }
}
function glow(obj, color, k) { obj.traverse(o => { if (o.isMesh && o.material.emissive) { o.material = o.userData.ownMat ??= o.material.clone(); o.material.emissive.set(color).multiplyScalar(k); } }); }
// A camera's view cone, drawn as lines from the lens to the corners of the patch it sees on the table.
function viewCone(color, from, half = [.3, .38], to = DA_TABLE_TOP) {
  const [cx, cy, cz] = from, c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => new THREE.Vector3(cx + a * half[0], cy + b * half[1], to + .002));
  const pts = []; c.forEach((p, i) => pts.push(new THREE.Vector3(cx, cy, cz - .015), p, p, c[(i + 1) % 4]));
  const g = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .55 }));
  g.frustumCulled = false; return g;
}
function ring(color, r = .045) {
  const m = new THREE.Mesh(new THREE.RingGeometry(r, r + .007, 4, 1, Math.PI / 4), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true }));
  return m;
}

// ---------- Workshop outcomes: where the three days lead ----------
SCENES['workshop-goal'] = async (panel) => {
  const s = base3d({ cam: [1.3, 1.0, -1.05], target: [.3, .3, 0], grid: 0 });   // three.js coordinates: y up, z = -ROS y
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: .04 })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  const pc = box(.12, .08, .06, C.blue, .9); pc.position.set(-.2, -.3, .03); s.world.add(pc);
  const pcl = label('computer', 'small'); pcl.position.set(-.2, -.3, .1); s.world.add(pcl);
  const cone = viewCone(C.cyan, [.4, 0, 1.0]); s.world.add(cone);
  const axes = arm.joints.map(j => { const a = new THREE.AxesHelper(.07); a.material.depthTest = false; a.renderOrder = 3; j.add(a); return a; });
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: C.orange, dashSize: .02, gapSize: .015 })); path.frustumCulled = false; s.world.add(path);
  const msgs = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(.014, 14, 10), new THREE.MeshBasicMaterial({ color: C.cyan })); s.world.add(m); return m; });
  const u = ui(panel);
  u.text('By Wednesday afternoon, this arm finds the boxes with its camera and places them in the tray: the same code you run in the labs.', 'scene-hint');
  const items = u.list([
    '<b>Day 1 · make programs talk</b><br>nodes, topics, services, actions: camera → detector → planner → arm',
    '<b>Day 2 · model and simulate</b><br>frames, URDF, Gazebo, simulated sensors',
    '<b>Day 3 · plan and pick</b><br>ros2_control and MoveIt 2 move the arm around obstacles']);
  const out = u.readout();
  u.text('Every concept ends with something you can see in a terminal, RViz, or Gazebo.');
  const plans = [pickPlan('red', 0), pickPlan('blue', 1)], T = plans.map(planTime), CYCLE = T[0] + T[1] + 1.5;
  const pts = [], tmp = new THREE.Vector3(), camAt = new THREE.Vector3(.4, 0, .98), pcAt = new THREE.Vector3(-.2, -.3, .06);
  return { ...s, sway: { amplitude: .3, period: 30 }, reset() { cell.reset(); }, update(t) {
    const tc = t % CYCLE, day = Math.floor(tc / (CYCLE / 3));
    if (tc < .05) cell.reset();
    const which = tc < T[0] ? 0 : tc < T[0] + T[1] ? 1 : -1;
    if (which >= 0) {
      const p = planPose(plans[which], which ? tc - T[0] : tc); arm.set(p.q, p.grip);
      carry(arm, s.world, cell.boxes[which ? 'blue' : 'red'], p.held);
    } else arm.set(DA_HOME, DA_OPEN);
    items.forEach((li, i) => li.classList.toggle('on', i === day));
    // Day 1: messages flow camera → computer → arm. Day 2: frames on every joint and the camera's view. Day 3: the planned path.
    msgs.forEach((m, i) => {
      m.visible = day === 0; if (!m.visible) return;
      const f = ((t * .7 + i / 3) % 1); arm.links.l4.getWorldPosition(tmp); s.world.worldToLocal(tmp);
      if (f < .5) m.position.lerpVectors(camAt, pcAt, smooth(f * 2)); else m.position.lerpVectors(pcAt, tmp, smooth(f * 2 - 1));
      m.material.color.set(f < .5 ? C.cyan : C.orange);
    });
    axes.forEach(a => (a.visible = day === 1)); cone.visible = day === 1;
    path.visible = day === 2 && which >= 0;
    if (path.visible && Math.floor(t * 4) !== path.userData.k) {
      path.userData.k = Math.floor(t * 4); pts.length = 0;
      const pl = plans[which], dur = T[which];
      for (let x = 0; x <= dur; x += .08) { const pp = planPose(pl, x); arm.set(pp.q, pp.grip); s.world.updateMatrixWorld(true); arm.links.tool.getWorldPosition(tmp); pts.push(s.world.worldToLocal(tmp.clone())); }
      const p = planPose(plans[which], which ? tc - T[0] : tc); arm.set(p.q, p.grip);
      path.geometry.setFromPoints(pts); path.computeLineDistances();
    }
    out.innerHTML = ['<b>Day 1</b> /camera → object_detector → /detections → pick_and_place', '<b>Day 2</b> every joint has a frame; the RealSense sees the table', '<b>Day 3</b> MoveIt plans the path; ros2_control drives the joints'][day];
  } };
};

// ---------- Inside a robot: the sense, think, act loop on our arm ----------
SCENES['loop-arm'] = async (panel) => {
  const s = base3d({ cam: [1.35, 1.1, -1.1], target: [.3, .32, 0], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  const pc = box(.12, .08, .06, C.blue, .9); pc.position.set(-.2, -.3, .03); s.world.add(pc);
  const pcl = label('computer', 'small'); pcl.position.set(-.2, -.3, .1); s.world.add(pcl);
  const cone = viewCone(C.cyan, [.4, 0, 1.0]); s.world.add(cone);
  const camL = label('RealSense camera', 'small'); camL.position.set(.4, 0, 1.08); s.world.add(camL);
  const seen = ring(C.cyan); s.world.add(seen); const seenL = label('', 'big'); s.world.add(seenL);
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: C.blue, dashSize: .02, gapSize: .014 })); path.frustumCulled = false; s.world.add(path);
  const stageL = label('', 'big'); stageL.position.set(.4, .42, .55); s.world.add(stageL);
  const u = ui(panel);
  const loopC = u.canvas(150);
  const steps = u.list([
    '<b>sense</b> the camera takes colour + depth images',
    '<b>think</b> find the box, plan a path',
    '<b>act</b> motors follow the path, gripper closes',
    '<b>the world changes</b> so look again']);
  let mode = 'auto', hold = -1;
  const autoBtn = u.button('play', () => { mode = 'auto'; hold = -1; autoBtn.classList.add('on'); stepBtn.classList.remove('on'); }, true);
  const stepBtn = u.button('one stage at a time', () => { mode = 'step'; stepBtn.classList.add('on'); autoBtn.classList.remove('on'); });
  // "next" releases the pause and nudges past the stage boundary
  const nextBtn = u.button('next stage →', () => { if (mode !== 'step') return; const k = Math.min(curStage + 1, STAGES.length); clock = STAGES.slice(0, k).reduce((x, st) => x + st[1], 0) + .001; hold = -2; });
  u.row(autoBtn, stepBtn, nextBtn);
  const out = u.readout();
  // Stages for each box: sense 2.2 s, think 1.8 s, act (the plan), world 1.2 s.
  const order = ['red', 'blue'], plans = order.map((c, i) => pickPlan(c, i));
  const STAGES = order.flatMap((c, i) => [['sense', 2.2, c], ['think', 1.8, c, i], ['act', planTime(plans[i]), c, i], ['world', 1.4, c]]);
  const TOTAL = STAGES.reduce((x, st) => x + st[1], 0);
  let clock = 0, curStage = 0;
  const tmp = new THREE.Vector3();
  const KIND_I = { sense: 0, think: 1, act: 2, world: 3 };
  function drawLoop(stage, f) {
    const { ctx, w, h } = fit2d(loopC); ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2 + 6, R = Math.min(w * .32, h * .4);
    const nodes = [['SENSE', CSS.cyan, -Math.PI / 2], ['THINK', CSS.blue, Math.PI / 6], ['ACT', CSS.orange, 5 * Math.PI / 6]];
    ctx.strokeStyle = CSS.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    // the dot travels sense → think → act, waits at act while the arm moves, then goes round to sense
    const da = { sense: -Math.PI / 2, think: Math.PI / 6, act: 5 * Math.PI / 6, world: 5 * Math.PI / 6 }[stage] + (stage === 'act' ? 0 : (2 * Math.PI / 3) * f);
    dot(ctx, cx + R * Math.cos(da), cy + R * Math.sin(da), 6, stage === 'world' ? CSS.ink : [CSS.cyan, CSS.blue, CSS.orange][KIND_I[stage]]);
    nodes.forEach(([n, c, a], i) => {
      const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a), on = KIND_I[stage] === i;
      ctx.fillStyle = on ? c : '#0d1426'; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 34, y - 13, 68, 26, 13); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? '#080d19' : c; ctx.font = mono(11, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, x, y);
    });
    ctx.fillStyle = stage === 'world' ? CSS.ink : CSS.muted; ctx.font = mono(10); ctx.fillText('the world changes', cx, cy + 4);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  }
  function setPath(i) {
    const pts = [], pl = plans[i], dur = planTime(pl), keep = arm.q.slice(), g = arm.grip;
    for (let x = 0; x <= dur; x += .06) { const pp = planPose(pl, x); arm.set(pp.q, pp.grip); s.world.updateMatrixWorld(true); arm.links.tool.getWorldPosition(tmp); pts.push(s.world.worldToLocal(tmp.clone())); }
    arm.set(keep, g); path.geometry.setFromPoints(pts); path.computeLineDistances();
  }
  function reset() { clock = 0; hold = -1; path.userData.i = -1; cell.reset(); arm.set(DA_HOME, DA_OPEN); }
  reset();
  return { ...s, reset, update(t, dt) {
    // in step mode the clock stops at the end of each stage until "next stage"
    if (clock >= TOTAL) { clock = 0; hold = -1; cell.reset(); path.userData.i = -1; }
    let i = 0, x = clock; while (i < STAGES.length - 1 && x > STAGES[i][1]) x -= STAGES[i++][1];
    curStage = i;
    if (mode === 'step' && hold !== i && STAGES[i][1] - x < dt + .02) hold = i;
    if (!(mode === 'step' && hold === i)) clock += dt;
    const [kind, dur, color, pi] = STAGES[i], f = clamp(x / dur, 0, 1), b = cell.boxes[color];
    // sense: the cone pulses and the box gets a detection square
    cone.visible = kind === 'sense'; cone.material.opacity = .25 + .35 * Math.abs(Math.sin(t * 5));
    seen.visible = seenL.visible = kind === 'sense' && f > .35 || kind === 'think';
    if (seen.visible) { b.getWorldPosition(tmp); s.world.worldToLocal(tmp); seen.position.set(tmp.x, tmp.y, DA_TABLE_TOP + .003); seenL.position.set(tmp.x, tmp.y, .2); seenL.element.textContent = `${color} box · x ${tmp.x.toFixed(2)} y ${tmp.y.toFixed(2)}`; }
    // think: the computer glows and the planned path draws in
    glow(pc, C.blue, kind === 'think' ? .5 + .4 * Math.sin(t * 9) : 0);
    path.visible = kind === 'think' || kind === 'act';
    if (kind === 'think' && path.userData.i !== pi) { setPath(pi); path.userData.i = pi; }
    if (kind === 'think') path.geometry.setDrawRange(0, Math.floor(f * path.geometry.attributes.position.count));
    else path.geometry.setDrawRange(0, Infinity);
    if (kind === 'sense') path.userData.i = -1;
    // act: run the plan, motors glow
    if (kind === 'act') { const p = planPose(plans[pi], x); arm.set(p.q, p.grip); carry(arm, s.world, b, p.held); }
    else arm.set(DA_HOME, DA_OPEN);
    [arm.links.l1, arm.links.l2, arm.links.l3, arm.links.l4].forEach(l => glow(l, C.orange, kind === 'act' ? .35 : 0));
    stageL.element.textContent = { sense: 'SENSE', think: 'THINK', act: 'ACT', world: 'the world changed: sense again' }[kind];
    stageL.element.style.color = { sense: CSS.cyan, think: CSS.blue, act: CSS.orange, world: CSS.ink }[kind];
    steps.forEach((li, k) => li.classList.toggle('on', k === KIND_I[kind]));
    drawLoop(kind, f);
    out.innerHTML = {
      sense: () => `<b>sense</b> /camera/camera/color/image_raw + depth · 30 Hz`,
      think: () => `<b>think</b> object_detector publishes /detections/${color}; MoveIt plans the motion`,
      act: () => `<b>act</b> /arm_controller/follow_joint_trajectory → five joint motors · ${plans[pi][planPose(plans[pi], x).k][0]}`,
      world: () => `<b>world</b> the ${color} box moved, so the next decision needs a new image`,
    }[kind]() + (mode === 'step' && hold === i ? '<br><b>paused</b> press next stage' : '');
  } };
};

// Narrow screens: lay the drawing out at a minimum width and scale it down, so labels never collide.
function fitMin(canvas, minW) {
  const { ctx, w, h } = fit2d(canvas), k = Math.min(1, w / minW);
  ctx.clearRect(0, 0, w, h); ctx.scale(k, k);
  return { ctx, w: w / k, h: h / k, k };
}

// ---------- Inside a robot · sense: how nine common sensors work ----------
// Each draws its working principle in (x, y, w, h) and gives the signal the robot receives, as a function of time.
function sensorBox(ctx, x, y, w, h, color = CSS.cyan, r = 4) { ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke(); }
function say(ctx, text, x, y, color = CSS.muted, size = 11, align = 'center') { ctx.fillStyle = color; ctx.font = mono(size); ctx.textAlign = align; ctx.fillText(text, x, y); ctx.textAlign = 'left'; }
const SENSORS = [
  { key: 'encoder', name: 'Encoder', where: 'inside', rate: '100–1000 Hz', msg: 'sensor_msgs/msg/JointState', arm: 'every joint: <code>/joint_states</code>',
    what: 'how far a joint or wheel has turned', how: 'A slotted disc turns between an LED and a light sensor. Each slot that passes is one pulse; counting pulses gives the angle.',
    unit: 'light sensor: pulses', signal: t => (Math.sin(12 * 1.6 * t) > 0 ? 1 : 0),
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .42, cy = y + h * .52, R = Math.min(w, h) * .36, a = 1.6 * t;
      ctx.fillStyle = '#1b2236'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill(); ctx.strokeStyle = CSS.muted; ctx.lineWidth = 1.5; ctx.stroke();
      for (let k = 0; k < 12; k++) { const b = a + k * Math.PI / 6; ctx.fillStyle = '#080d19'; ctx.beginPath(); ctx.arc(cx, cy, R * .95, b - .1, b + .1); ctx.arc(cx, cy, R * .78, b + .1, b - .1, true); ctx.fill(); }
      ctx.fillStyle = CSS.muted; ctx.beginPath(); ctx.arc(cx, cy, R * .12, 0, 7); ctx.fill();
      const lit = Math.sin(12 * a) > 0, gx = cx, gy = cy - R * .87;
      ctx.fillStyle = CSS.pink; ctx.fillRect(gx - 6, gy - R * .5, 12, 10); say(ctx, 'LED', gx + 22, gy - R * .5 + 9, CSS.pink, 10, 'left');
      ctx.fillStyle = lit ? CSS.cyan : '#26304a'; ctx.fillRect(gx - 6, gy + R * .3, 12, 10); say(ctx, 'light sensor', gx + 22, gy + R * .3 + 9, lit ? CSS.cyan : CSS.muted, 10, 'left');
      if (lit) { ctx.strokeStyle = CSS.pink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(gx, gy - R * .5 + 10); ctx.lineTo(gx, gy + R * .3); ctx.stroke(); }
      const count = Math.floor(12 * 1.6 * t / Math.PI);
      say(ctx, `pulses ${count} → angle ${(count * 15 % 360).toFixed(0)}°`, x + w * .82, cy, CSS.ink, 12);
      say(ctx, '12 slots: 15° per pulse', x + w * .82, cy + 18, CSS.muted, 10);
    } },
  { key: 'imu', name: 'IMU', where: 'inside', rate: '100–1000 Hz', msg: 'sensor_msgs/msg/Imu', arm: 'in the gripper palm: <code>/imu</code>',
    what: 'acceleration and rotation rate of the body it is on', how: 'Tiny MEMS structures on a chip: a spring-held mass shows acceleration (gravity too), a vibrating mass shows rotation rate.',
    unit: 'gyro z: rad/s', range: [-.6, .6], signal: t => .5 * Math.cos(t),
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .4, cy = y + h * .5, th = .5 * Math.sin(t), s = Math.min(w, h) * .26;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(th);
      ctx.fillStyle = '#1b2236'; ctx.strokeStyle = CSS.cyan; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(-s, -s * .6, 2 * s, 1.2 * s, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = CSS.cyan; ctx.fillRect(-s * .25, -s * .2, s * .5, s * .4); say(ctx, 'MEMS chip', 0, s * .45, CSS.muted, 10);
      arrowTo(ctx, 0, 0, s * 1.2, 0, CSS.pink, 2); say(ctx, 'x', s * 1.3, 4, CSS.pink, 11);
      ctx.restore();
      arrowTo(ctx, cx, cy, cx, cy + s * 1.4, CSS.muted, 2); say(ctx, 'gravity', cx + 8, cy + s * 1.4, CSS.muted, 10, 'left');
      ctx.strokeStyle = CSS.orange; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, s * 1.5, -Math.PI / 2 - .3, -Math.PI / 2 + .3); ctx.stroke();
      say(ctx, `accel x  ${(9.81 * Math.sin(th)).toFixed(2)} m/s²`, x + w * .82, cy - 10, CSS.pink, 12);
      say(ctx, `gyro z   ${(.5 * Math.cos(t)).toFixed(2)} rad/s`, x + w * .82, cy + 10, CSS.orange, 12);
    } },
  { key: 'lidar', name: 'Lidar', where: 'outside', rate: '5–40 Hz per turn', msg: 'sensor_msgs/msg/LaserScan', arm: 'front of the pedestal: <code>/scan</code>',
    what: 'distance to everything around it, in a plane', how: 'A laser pulse goes out and bounces back. Distance = speed of light × round-trip time ÷ 2. A spinning mirror sweeps the beam all the way round.',
    unit: 'range of the current beam: m', signal: t => lidarRange(t * 2.4) / 3,
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .5, cy = y + h * .52, S = Math.min(w, h) * .14, a = t * 2.4;
      ctx.strokeStyle = '#3a4566'; ctx.lineWidth = 2; ctx.strokeRect(cx - 3 * S, cy - 2 * S, 6 * S, 4 * S);
      ctx.fillStyle = '#3a4566'; ctx.fillRect(cx + 1.2 * S, cy - 1.1 * S, .9 * S, .9 * S); ctx.beginPath(); ctx.arc(cx - 1.4 * S, cy + .9 * S, .45 * S, 0, 7); ctx.fill();
      for (let k = 0; k < 120; k++) { const b = a - k * .05; const r = lidarRange(b); ctx.globalAlpha = 1 - k / 120; dot(ctx, cx + r * S * Math.cos(b), cy - r * S * Math.sin(b), 2, CSS.pink); }
      ctx.globalAlpha = 1; const r = lidarRange(a);
      ctx.strokeStyle = CSS.pink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * S * Math.cos(a), cy - r * S * Math.sin(a)); ctx.stroke();
      dot(ctx, cx, cy, 7, CSS.cyan); say(ctx, `beam ${((a * 180 / Math.PI) % 360).toFixed(0)}° · ${r.toFixed(2)} m`, cx, y + 14, CSS.ink, 12);
    } },
  { key: 'camera', name: 'Camera', where: 'outside', rate: '15–60 Hz', msg: 'sensor_msgs/msg/Image', arm: 'the RealSense colour stream: <code>/camera/camera/color/image_raw</code>',
    what: 'colour and brightness of the scene, as pixels', how: 'A lens focuses light onto a grid of light sensors. Each sensor becomes one pixel; red, green and blue filters give colour.',
    unit: 'brightness along one pixel row', signal: t => .55 + .4 * Math.sin(t * 2.1) * Math.cos(t * .7),
    draw(ctx, x, y, w, h, t) {
      const cy = y + h * .5, lx = x + w * .5, objX = x + w * .14, sx = x + w * .78, s = h * .2, bob = Math.sin(t) * s * .3;
      ctx.fillStyle = CSS.orange; ctx.beginPath(); ctx.moveTo(objX, cy + s + bob); ctx.lineTo(objX - s * .5, cy + s * 1.6 + bob); ctx.lineTo(objX + s * .5, cy + s * 1.6 + bob); ctx.fill();
      ctx.fillStyle = CSS.green; ctx.beginPath(); ctx.arc(objX, cy - s * .2 + bob, s * .55, 0, 7); ctx.fill(); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(objX - 3, cy + s * .3 + bob, 6, s * .7);
      ctx.strokeStyle = CSS.blue; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(lx, cy, 6, s * 1.2, 0, 0, 7); ctx.stroke(); say(ctx, 'lens', lx, cy + s * 1.5, CSS.blue, 10);
      for (const [oy, c] of [[-s * .2, CSS.green], [s * 1.3, CSS.orange]]) { ctx.strokeStyle = c; ctx.globalAlpha = .5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(objX, cy + oy + bob); ctx.lineTo(lx, cy); ctx.lineTo(sx, cy - (oy + bob) * .55); ctx.stroke(); ctx.globalAlpha = 1; }
      const gx = sx, n = 8, cs = s * 2.4 / n;
      for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) {
        const py = cy - s * 1.2 + i * cs, img = cy - (py - cy) / .55 - bob;   // inverted image
        const c = img > cy + s && img < cy + s * 1.7 ? CSS.orange : img > cy - s * .8 && img < cy + s * .4 ? CSS.green : '#1b2236';
        ctx.fillStyle = c; ctx.fillRect(gx + j * cs, py, cs - 1, cs - 1);
      }
      say(ctx, 'pixels (upside down)', gx + cs * 1.5, cy + s * 1.6, CSS.muted, 10);
    } },
  { key: 'depth', name: 'Depth camera', where: 'outside', rate: '30–90 Hz', msg: 'sensor_msgs/msg/Image (depth), sensor_msgs/msg/PointCloud2', arm: 'the overhead RealSense D435: <code>/camera/camera/depth/color/points</code>',
    what: 'the distance to every pixel: a 3D picture', how: 'The RealSense D435 projects an infrared dot pattern and sees it with two infrared cameras. A dot shifts less between the two views the farther away it is.',
    unit: 'depth along one row: m', signal: t => { const u = (t * .25) % 1; return u > .38 && u < .62 ? .55 : .9; },
    draw(ctx, x, y, w, h, t) {
      const top = y + 22, tbl = y + h * .86, bx0 = x + w * .42, bx1 = x + w * .58, bTop = y + h * .6, cx = x + w * .5;
      ctx.fillStyle = '#3a4566'; ctx.fillRect(x + w * .1, tbl, w * .8, 6); ctx.fillStyle = DA_CSS.red; ctx.fillRect(bx0, bTop, bx1 - bx0, tbl - bTop);
      ctx.fillStyle = '#b8c0d0'; ctx.fillRect(cx - 50, top - 8, 100, 14);
      [[-38, 'IR'], [0, 'dots'], [38, 'IR']].forEach(([dx, n]) => { dot(ctx, cx + dx, top + 6, 4, n === 'dots' ? CSS.pink : CSS.cyan); say(ctx, n, cx + dx, top - 12, n === 'dots' ? CSS.pink : CSS.cyan, 9); });
      const N = 15, sweep = (t * .25) % 1;
      for (let k = 0; k < N; k++) {
        const px = x + w * (.14 + .72 * k / (N - 1)), onBox = px > bx0 && px < bx1, py = onBox ? bTop : tbl;
        const near = k === Math.round(sweep * (N - 1));
        ctx.strokeStyle = CSS.pink; ctx.globalAlpha = near ? .9 : .18; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, top + 6); ctx.lineTo(px, py); ctx.stroke();
        ctx.globalAlpha = 1; dot(ctx, px, py, near ? 4 : 2.5, onBox ? CSS.orange : CSS.cyan);
        if (near) { for (const dx of [-38, 38]) { ctx.strokeStyle = CSS.cyan; ctx.globalAlpha = .7; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx + dx, top + 6); ctx.stroke(); } ctx.globalAlpha = 1; say(ctx, `${onBox ? '0.55' : '0.90'} m`, px + 8, py - 8, CSS.ink, 11, 'left'); }
      }
      say(ctx, 'near: big shift between the two IR views · far: small shift', cx, y + h - 2, CSS.muted, 10);
    } },
  { key: 'ft', name: 'Force-torque', where: 'inside', rate: '100–1000 Hz', msg: 'geometry_msgs/msg/WrenchStamped', arm: 'at the wrist roll joint: <code>/wrist_ft</code>',
    what: 'forces and twists pushing on the wrist: the weight it holds, a bump', how: 'Strain gauges glued to a metal flexure change resistance as it bends very slightly. Six readings give 3 forces and 3 torques.',
    unit: 'force z: N', range: [0, 1.6], signal: t => { const u = t % 6; return u < 2 ? 0 : u < 2.4 ? (u - 2) / .4 * 1.4 : u < 4.6 ? .9 + .05 * Math.sin(u * 20) * Math.exp(-(u - 2.4) * 3) : u < 5 ? (5 - u) / .4 * .9 : 0; },
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .4, u = t % 6, hold = u > 2 && u < 5, lift = u < 2 ? 0 : u < 2.4 ? (u - 2) / .4 : u < 4.6 ? 1 : u < 5 ? (5 - u) / .4 : 0;
      const wy = y + h * .2, bend = (hold ? 4 : 0) * lift;
      ctx.fillStyle = DA_CSS.black; ctx.fillRect(cx - 14, y + 4, 28, wy - y);
      ctx.fillStyle = '#c9d1e3'; ctx.beginPath(); ctx.moveTo(cx - 22, wy); ctx.quadraticCurveTo(cx, wy + 12 + bend, cx + 22, wy); ctx.lineTo(cx + 22, wy + 14); ctx.quadraticCurveTo(cx, wy + 26 + bend, cx - 22, wy + 14); ctx.fill();
      ctx.fillStyle = CSS.cyan; ctx.fillRect(cx - 8, wy + 4 + bend * .6, 16, 5); say(ctx, 'strain gauge', cx + 30, wy + 12, CSS.cyan, 10, 'left');
      ctx.fillStyle = DA_CSS.grey; ctx.fillRect(cx - 26, wy + 22, 52, 10);
      for (const s of [-1, 1]) { ctx.fillStyle = DA_CSS.black; ctx.fillRect(cx + s * (hold ? 13 : 20) - 4, wy + 32, 8, 26); }
      const by = hold ? wy + 38 : y + h * .82 - 22;
      ctx.fillStyle = DA_CSS.red; ctx.fillRect(cx - 10, by, 20, 22);
      ctx.fillStyle = '#3a4566'; ctx.fillRect(x + w * .1, y + h * .82, w * .6, 6);
      if (lift > .05) { arrowTo(ctx, cx + 46, wy + 30, cx + 46, wy + 30 + 40 * lift, CSS.orange, 2.5); say(ctx, 'weight', cx + 52, wy + 54, CSS.orange, 10, 'left'); }
      say(ctx, `force z ${this.signal(t).toFixed(2)} N`, x + w * .83, y + h * .45, CSS.ink, 12);
    } },
  { key: 'contact', name: 'Contact', where: 'outside', rate: 'on change, or 10–100 Hz', msg: 'a Bool, or ros_gz_interfaces/msg/Contacts in Gazebo', arm: 'both fingers: <code>/left_finger/contact</code>, <code>/right_finger/contact</code>',
    what: 'whether something is touching: yes or no, sometimes how hard', how: 'A switch closes, or a pressure-sensitive pad changes resistance, when the finger presses on something.',
    unit: 'touching: 0 or 1', signal: t => (Math.sin(t * 1.2) > .35 ? 1 : 0),
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .4, cy = y + h * .55, c = Math.sin(t * 1.2), touch = c > .35;
      const gap = 24 + (1 - clamp((c + 1) / 1.35, 0, 1)) * 36;   // half the distance between the finger pads
      ctx.fillStyle = DA_CSS.grey; ctx.fillRect(cx - 80, cy - 70, 160, 12);   // palm
      ctx.fillStyle = DA_CSS.red; ctx.fillRect(cx - 24, cy - 24, 48, 48);    // box
      for (const sg of [-1, 1]) {
        const inner = cx + sg * gap, outer = inner + sg * 16;
        ctx.fillStyle = DA_CSS.black; ctx.fillRect(Math.min(inner, outer), cy - 58, 16, 86);
        ctx.fillStyle = touch ? CSS.cyan : '#3a4566'; ctx.fillRect(inner - (sg > 0 ? 0 : 5), cy - 16, 5, 32);   // pressure pad on the inner face
        if (touch) { ctx.strokeStyle = CSS.cyan; ctx.globalAlpha = .35 + .25 * Math.sin(t * 9); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(inner, cy, 22, sg > 0 ? Math.PI / 2 : -Math.PI / 2, sg > 0 ? 3 * Math.PI / 2 : Math.PI / 2); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      say(ctx, 'pressure pads', cx, cy + 50, CSS.muted, 10);
      say(ctx, touch ? 'contact: true' : 'contact: false', x + w * .84, cy, touch ? CSS.cyan : CSS.muted, 13);
    } },
  { key: 'ultrasonic', name: 'Ultrasonic', where: 'outside', rate: '10–40 Hz', msg: 'sensor_msgs/msg/Range', arm: 'not on our arm; common on mobile robots and cars',
    what: 'distance to the nearest object in a cone', how: 'It clicks at about 40 kHz and listens for the echo. Distance = speed of sound (343 m/s) × round-trip time ÷ 2.',
    unit: 'echo: arrives after 2d / 343 s', signal: t => { const u = (t % 1.4) / 1.4; return Math.abs(u - .62) < .03 ? 1 : 0; },
    draw(ctx, x, y, w, h, t) {
      const sx = x + w * .12, cy = y + h * .5, wx = x + w * .78, u = (t % 1.4) / 1.4;
      ctx.fillStyle = '#3a4566'; ctx.fillRect(wx, y + 10, 14, h - 20); say(ctx, 'wall 1.0 m', wx + 7, y + h - 2, CSS.muted, 10);
      ctx.fillStyle = '#b8c0d0'; ctx.fillRect(sx - 18, cy - 22, 18, 44); for (const d of [-11, 11]) { ctx.fillStyle = '#1b2236'; ctx.beginPath(); ctx.arc(sx - 2, cy + d, 8, 0, 7); ctx.fill(); }
      const go = u < .5, r = (go ? u / .5 : (u - .5) / .5) * (wx - sx);
      ctx.strokeStyle = go ? CSS.cyan : CSS.orange; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { const rr = r - k * 10; if (rr <= 0) continue; ctx.globalAlpha = 1 - k * .3; ctx.beginPath(); if (go) ctx.arc(sx, cy, rr, -.35, .35); else ctx.arc(wx, cy, rr, Math.PI - .35, Math.PI + .35); ctx.stroke(); }
      ctx.globalAlpha = 1; say(ctx, go ? 'ping →' : '← echo', x + w * .45, y + 16, go ? CSS.cyan : CSS.orange, 12);
      say(ctx, 'round trip 5.8 ms → 1.00 m', x + w * .45, y + h - 2, CSS.ink, 11);
    } },
  { key: 'gps', name: 'GPS', where: 'outside', rate: '1–10 Hz', msg: 'sensor_msgs/msg/NavSatFix', arm: 'not on our arm; outdoor robots, drones and cars',
    what: 'latitude, longitude and height on Earth', how: 'Satellites send their time and position. The receiver measures how long each signal took; four or more give a position, to a few metres (centimetres with RTK).',
    unit: 'signals received', signal: t => (Math.floor(t * 2) % 4 + 1) / 4,
    draw(ctx, x, y, w, h, t) {
      const ex = x + w * .5, ey = y + h * 1.9, R = h * 1.55;
      ctx.strokeStyle = '#3a4566'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ex, ey, R, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      const rx = ex, ry = ey - R; dot(ctx, rx, ry, 6, CSS.cyan); say(ctx, 'receiver', rx, ry + 18, CSS.cyan, 10);
      const sats = [[.14, .22], [.36, .1], [.64, .1], [.86, .22]];
      sats.forEach(([sx, sy], i) => {
        const px = x + w * sx, py = y + h * sy; ctx.fillStyle = CSS.blue; ctx.fillRect(px - 8, py - 5, 16, 10); ctx.fillStyle = '#26304a'; ctx.fillRect(px - 20, py - 2, 10, 4); ctx.fillRect(px + 10, py - 2, 10, 4);
        const f = ((t * .8 + i * .25) % 1); ctx.strokeStyle = CSS.blue; ctx.globalAlpha = .6 * (1 - f); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, f * Math.hypot(rx - px, ry - py), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.setLineDash([3, 4]); ctx.strokeStyle = CSS.line; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(rx, ry); ctx.stroke(); ctx.setLineDash([]);
      });
      say(ctx, '4 satellites → x, y, z and the clock error', x + w * .5, y + h * .45, CSS.ink, 11);
    } },
];
const DA_CSS = { red: '#e5484d', black: '#262a35', grey: '#8f9ab3' };
function lidarRange(b) {   // a 6 × 4 room with a box and a post, seen from the middle
  const c = Math.cos(b), s = Math.sin(b); let r = Math.min(Math.abs(c) > 1e-6 ? 3 / Math.abs(c) : 99, Math.abs(s) > 1e-6 ? 2 / Math.abs(s) : 99);
  const hit = (x0, y0, x1, y1) => { const tx = [x0 / c, x1 / c].sort((a, b2) => a - b2), ty = [y0 / s, y1 / s].sort((a, b2) => a - b2), t0 = Math.max(tx[0], ty[0]), t1 = Math.min(tx[1], ty[1]); return t1 >= t0 && t0 > 0 ? t0 : 99; };
  r = Math.min(r, hit(1.2, .2, 2.1, 1.1));
  const px = -1.4, py = -.9, rr = .45, bb = px * c + py * s, d = bb * bb - (px * px + py * py - rr * rr); if (d > 0 && bb - Math.sqrt(d) > 0) r = Math.min(r, bb - Math.sqrt(d));
  return r;
}
SCENES['sensor-gallery'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let sel = 0, auto = true;
  const btns = SENSORS.map((g, i) => u.button(g.name, () => choose(i, true), i === 0));
  u.row(...btns);
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const out = u.readout();
  u.text('<b>Inside</b> sensors measure the robot itself; <b>outside</b> sensors measure the world. Every one reaches ROS 2 as a standard message.');
  function choose(i, manual) {
    sel = i; btns.forEach((b, k) => b.classList.toggle('on', k === i)); if (manual) { auto = false; autoBtn.classList.remove('on'); }
    const g = SENSORS[i];
    out.innerHTML = `<b>${g.name}</b> · ${g.where === 'inside' ? 'inside (proprioceptive)' : 'outside (exteroceptive)'}<br><b>measures</b> ${g.what}<br><b>how</b> ${g.how}<br><b>rate</b> ${g.rate}<br><b>ROS 2</b> ${g.msg}<br><b>on our arm</b> ${g.arm}`;
  }
  choose(0);
  const PH = 9;
  return { canvas, reset() { if (auto) choose(0); }, update(t) {
    if (auto) { const i = Math.floor(t / PH) % SENSORS.length; if (i !== sel) choose(i); }
    const { ctx, w, h } = fitMin(canvas, 620);
    const g = SENSORS[sel], plotH = Math.min(90, h * .2), top = 40, ih = h - top - plotH - 34;
    ctx.fillStyle = CSS.ink; ctx.font = sans(17, 700); ctx.fillText(g.name, 14, 26);
    ctx.fillStyle = g.where === 'inside' ? CSS.cyan : CSS.orange; ctx.font = mono(11); ctx.fillText(g.where === 'inside' ? 'inside · the robot measures itself' : 'outside · the robot measures the world', 14 + ctx.measureText(g.name).width * 1.45 + 16, 26);
    ctx.save(); g.draw(ctx, 10, top, w - 20, ih, t); ctx.restore();
    // what the robot receives: the last 4 s of the signal
    const py = h - plotH - 12;
    ctx.strokeStyle = CSS.line; ctx.strokeRect(10.5, py + .5, w - 21, plotH);
    say(ctx, `what the robot receives · ${g.unit}`, 16, py + 14, CSS.muted, 10, 'left');
    ctx.strokeStyle = CSS.cyan; ctx.lineWidth = 2; ctx.beginPath();
    const [lo, hi] = g.range || [0, 1.1];
    for (let k = 0; k <= 200; k++) { const tt = t - 4 + 4 * k / 200, v = clamp(g.signal(tt), lo, hi), X = 12 + (w - 24) * k / 200, Y = py + plotH - 6 - (v - lo) / (hi - lo) * (plotH - 24); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
    ctx.stroke();
  } };
};

// ---------- Inside a robot · sense: the sensors on our arm, live ----------
SCENES['arm-sensors'] = async (panel) => {
  const s = base3d({ cam: [1.3, 1.0, -1.05], target: [.3, .28, 0], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  const cone = viewCone(C.cyan, [.4, 0, 1.0]); s.world.add(cone);
  // point cloud: samples of the table and box tops, seen from the camera
  const cloud = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: .008, vertexColors: true })); cloud.frustumCulled = false; s.world.add(cloud);
  // lidar: a fan of rays in the plane of the puck
  const NR = 90, rays = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: C.pink, transparent: true, opacity: .35 }));
  rays.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NR * 6), 3)); rays.frustumCulled = false; s.scene.add(rays);   // rays are in scene (y-up) coordinates
  const imuAxes = new THREE.AxesHelper(.08); imuAxes.material.depthTest = false; imuAxes.renderOrder = 3; arm.joints[4].add(imuAxes);
  const ftArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), .1, C.orange, .03, .02); arm.joints[4].add(ftArrow);
  const rings = arm.joints.map((j, i) => { const r = new THREE.Mesh(new THREE.TorusGeometry(i ? .045 : .07, .004, 8, 40), new THREE.MeshBasicMaterial({ color: C.cyan })); if (i === 0) r.position.z = .0; else if (i === 4) r.position.z = 0; else r.rotation.x = Math.PI / 2; j.add(r); return r; });
  const SENS = [
    ['camera', 'RealSense D435 · colour + depth', '/camera/camera/color/image_raw, /camera/camera/depth/color/points', 'sensor_msgs/msg/Image, PointCloud2 · 30 Hz'],
    ['lidar', '2D lidar on the pedestal', '/scan', 'sensor_msgs/msg/LaserScan · 10 Hz'],
    ['encoders', 'joint encoders on all five joints', '/joint_states', 'sensor_msgs/msg/JointState · 100 Hz'],
    ['imu', 'IMU in the gripper palm', '/imu', 'sensor_msgs/msg/Imu · 100 Hz'],
    ['ft', 'force-torque sensor at the wrist', '/wrist_ft', 'geometry_msgs/msg/WrenchStamped · 100 Hz'],
    ['contact', 'contact sensors on both fingers', '/left_finger/contact, /right_finger/contact', 'ros_gz_interfaces/msg/Contacts · on touch'],
  ];
  const u = ui(panel);
  let sel = 'camera', auto = true;
  const SHORT = { camera: 'camera', lidar: 'lidar', encoders: 'encoders', imu: 'IMU', ft: 'force-torque', contact: 'contact' };
  const btns = SENS.map(([k]) => u.button(SHORT[k], () => choose(k, true), k === sel));
  u.row(...btns);
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const camC = u.canvas(110);
  const out = u.readout();
  u.text('These are the topics <b>ros2 topic list</b> shows when the Day 2 simulation runs (<code>demo_arm_gazebo</code>). The camera topics match the real RealSense driver.');
  function choose(k, manual) { sel = k; btns.forEach((b, i) => b.classList.toggle('on', SENS[i][0] === k)); if (manual) { auto = false; autoBtn.classList.remove('on'); } }
  const plans = [pickPlan('red', 0), pickPlan('blue', 1)], T = plans.map(planTime), CYCLE = T[0] + T[1] + 1;
  const tmp = new THREE.Vector3(), rc = new THREE.Raycaster(), origin = new THREE.Vector3(), dir = new THREE.Vector3();
  const solids = [cell.legs, cell.top, arm.links.base];
  let held = null;
  function drawCam() {   // the colour image from above: table, tray, boxes, with the detector's boxes
    const { ctx, w, h } = fit2d(camC); ctx.clearRect(0, 0, w, h);
    const sc = Math.min(w / .76, h / .6), ox = w / 2, oy = h / 2;   // camera at x .4 looks down: image x = -world y, image y = -world x
    const P = (x, y) => [ox - (y - 0) * sc, oy - (x - .4) * sc];
    ctx.fillStyle = '#3a4566'; const [a0, b0] = P(.65, .3), [a1, b1] = P(.15, -.3); ctx.fillRect(a0, b0, a1 - a0, b1 - b0);
    const [tx, ty] = P(DA_TRAY[0], DA_TRAY[1]); ctx.strokeStyle = CSS.green; ctx.lineWidth = 2; ctx.strokeRect(tx - .06 * sc, ty - .06 * sc, .12 * sc, .12 * sc);
    Object.entries(cell.boxes).forEach(([k, b]) => { b.getWorldPosition(tmp); s.world.worldToLocal(tmp); const [bx, by] = P(tmp.x, tmp.y), z = (DA_BOX / 2) * sc * (1 + (tmp.z - .12) * 2); ctx.fillStyle = DA_CSS[k]; ctx.fillRect(bx - z, by - z, 2 * z, 2 * z); if (b.parent === s.world) { ctx.strokeStyle = CSS.cyan; ctx.strokeRect(bx - z - 3, by - z - 3, 2 * z + 6, 2 * z + 6); say(ctx, k, bx, by - z - 6, CSS.cyan, 9); } });
    arm.links.palm.getWorldPosition(tmp); s.world.worldToLocal(tmp); const [hx, hy] = P(tmp.x, tmp.y); ctx.fillStyle = DA_CSS.grey; ctx.fillRect(hx - 5, hy - 12, 10, 24);
    say(ctx, 'colour image + detections', 6, 12, CSS.muted, 9, 'left');
  }
  return { ...s, reset() { cell.reset(); }, update(t) {
    if (auto) { const k = SENS[Math.floor(t / 6) % SENS.length][0]; if (k !== sel) choose(k); }
    const tc = t % CYCLE; if (tc < .05) cell.reset();
    const which = tc < T[0] ? 0 : tc < T[0] + T[1] ? 1 : -1; held = null;
    if (which >= 0) { const p = planPose(plans[which], which ? tc - T[0] : tc); arm.set(p.q, p.grip); const b = cell.boxes[which ? 'blue' : 'red']; carry(arm, s.world, b, p.held); if (p.held) held = b; }
    else arm.set(DA_HOME, DA_OPEN);
    s.scene.updateMatrixWorld(true);
    cone.visible = cloud.visible = sel === 'camera';
    if (cloud.visible && Math.floor(t * 6) !== cloud.userData.k) {
      cloud.userData.k = Math.floor(t * 6); const pos = [], col = [];
      for (let i = 0; i < 1400; i++) {
        const x = .12 + Math.random() * .56, y = -.34 + Math.random() * .68; let z = DA_TABLE_TOP + .001, c = [.35, .42, .6];
        if (x < .15 || x > .65 || Math.abs(y) > .3) { z = 0; c = [.2, .24, .35]; }
        for (const [k, b] of Object.entries(cell.boxes)) { b.getWorldPosition(tmp); s.world.worldToLocal(tmp); if (Math.abs(x - tmp.x) < DA_BOX / 2 && Math.abs(y - tmp.y) < DA_BOX / 2) { z = tmp.z + DA_BOX / 2; c = k === 'red' ? [.9, .3, .3] : [.25, .5, .9]; } }
        pos.push(x, y, z); col.push(...c);
      }
      cloud.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cloud.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    rays.visible = sel === 'lidar';
    if (rays.visible) {
      cell.lidar.getWorldPosition(origin); const rp = rays.geometry.attributes.position.array, spin = t * 3;
      for (let i = 0; i < NR; i++) { const a = spin + i * 2 * Math.PI / NR; dir.set(Math.cos(a), 0, -Math.sin(a)); rc.set(origin, dir); rc.far = 1.2; const hit = rc.intersectObjects(solids, false)[0], r = hit ? hit.distance : 1.2; rp.set([origin.x, origin.y, origin.z, origin.x + dir.x * r, origin.y, origin.z + dir.z * r], i * 6); }
      rays.geometry.attributes.position.needsUpdate = true;
    }
    rings.forEach(r => (r.visible = sel === 'encoders'));
    imuAxes.visible = sel === 'imu';
    const load = held ? .05 * 9.81 : 0;
    ftArrow.visible = sel === 'ft'; ftArrow.setLength(.04 + load * .12, .025, .018); ftArrow.setDirection(new THREE.Vector3(0, 0, 1));
    arm.links.fingers.forEach(f => glow(f, C.cyan, sel === 'contact' && held ? .9 : 0));
    camC.style.display = sel === 'camera' ? '' : 'none'; if (sel === 'camera') drawCam();
    const [, name, topic, type] = SENS.find(x => x[0] === sel), q = arm.q.map(v => v.toFixed(2)).join(', ');
    const live = { camera: 'red and blue boxes found in the colour image', lidar: 'distances to the table legs and the pedestal, 360°',
      encoders: `position [${q}] rad`, imu: `angular_velocity changes as the wrist turns`, ft: `force.z ${(load).toFixed(2)} N ${held ? '(holding a 50 g box)' : ''}`,
      contact: held ? 'both fingers touching the box' : 'no contact' }[sel];
    out.innerHTML = `<b>${name}</b><br><b>topic</b> ${topic}<br><b>type</b> ${type}<br><b>now</b> ${live}`;
  } };
};

// ---------- Inside a robot · think: the computers in a robot, fastest and smallest first ----------
const BRAINS = [
  ['Microcontroller', 'STM32, ESP32, Arduino, motor driver chips', 'firmware, no operating system (or a small RTOS)', '1–20 kHz', 'exact timing: motor current, PWM, reading encoders', 'chip', 2400],
  ['Single-board computer', 'Raspberry Pi, NVIDIA Jetson', 'Linux + ROS 2', '10–100 Hz', 'sensor drivers, ros2_control, light perception', 'board', 300],
  ['PC with a GPU', 'laptop, workstation, industrial PC', 'Linux + ROS 2', '1–30 Hz', 'MoveIt planning, vision models, RViz, Gazebo', 'pc', 60],
  ['Cloud', 'servers in a data centre', 'anything', 'seconds to hours', 'fleet dashboards, shared maps, training models, logs', 'cloud', 6],
];
const BRAIN_LINKS = ['UART, USB, CAN, EtherCAT', 'Ethernet, Wi-Fi, ROS 2', 'internet'];
const BRAIN_MAPS = {
  'our arm': ['a real arm: motor drivers per joint (in the labs, Gazebo plays this part)', 'not needed in simulation', 'your laptop: Gazebo, ros2_control, MoveIt 2, object_detector, RViz', 'not used'],
  'TurtleBot3': ['OpenCR: wheel motors, encoders, IMU', 'Raspberry Pi: turtlebot3_node, lidar driver', 'laptop: Nav2, SLAM, RViz, teleop', 'not used'],
  'self-driving car': ['ECUs: brakes, steering, engine', 'sensor front-ends', 'in-car computer: Autoware on ROS 2', 'HD maps, training data'],
};
function brainIcon(ctx, kind, x, y, s, color, t) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.5;
  if (kind === 'chip') { ctx.strokeRect(x - s * .5, y - s * .5, s, s); for (let k = -2; k <= 2; k++) for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + k * s * .18, y + sg * s * .5); ctx.lineTo(x + k * s * .18, y + sg * s * .68); ctx.moveTo(x + sg * s * .5, y + k * s * .18); ctx.lineTo(x + sg * s * .68, y + k * s * .18); ctx.stroke(); } }
  if (kind === 'board') { ctx.strokeRect(x - s * .75, y - s * .45, s * 1.5, s * .9); ctx.strokeRect(x - s * .25, y - s * .2, s * .4, s * .4); for (let k = 0; k < 3; k++) ctx.strokeRect(x + s * .3, y - s * .35 + k * s * .25, s * .3, s * .18); }
  if (kind === 'pc') { ctx.strokeRect(x - s * .75, y - s * .55, s * 1.5, s * .9); ctx.beginPath(); ctx.moveTo(x, y + s * .35); ctx.lineTo(x, y + s * .55); ctx.moveTo(x - s * .35, y + s * .6); ctx.lineTo(x + s * .35, y + s * .6); ctx.stroke(); }
  if (kind === 'cloud') { ctx.beginPath(); ctx.arc(x - s * .35, y + s * .05, s * .3, Math.PI * .5, Math.PI * 1.5); ctx.arc(x, y - s * .15, s * .4, Math.PI, 0); ctx.arc(x + s * .4, y + s * .05, s * .3, Math.PI * 1.5, Math.PI * .5); ctx.closePath(); ctx.stroke(); }
  void t;
}
SCENES['brains'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let sel = 0, robot = 'our arm', auto = true, regions = [];
  const robotBtns = Object.keys(BRAIN_MAPS).map(k => u.button(k, () => { robot = k; robotBtns.forEach(b => b.classList.toggle('on', b.textContent === k)); }, k === robot));
  u.row(...robotBtns);
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const out = u.readout();
  u.text('Small and fast near the motors, big and slow far from them. A robot usually has <b>several</b> computers; ROS 2 connects the ones that run Linux.');
  const choose = (i, manual) => { sel = i; if (manual) { auto = false; autoBtn.classList.remove('on'); } };
  tappable(canvas, () => regions, g => choose(g.i, true));
  return { canvas, update(t) {
    if (auto) sel = Math.floor(t / 4) % BRAINS.length;
    const { ctx, w, h, k: zoom } = fitMin(canvas, 680);
    const n = BRAINS.length, gap = 14, cw = (w - 28 - gap * (n - 1)) / n, top = 40, ch = h * .5;
    say(ctx, '← closer to the motors · faster loops', 14, 24, CSS.orange, 11, 'left'); say(ctx, 'more computing power · slower loops →', w - 14, 24, CSS.blue, 11, 'right');
    regions = BRAINS.map(([name, ex, os, rate, good, kind, hz], i) => {
      const x = 14 + i * (cw + gap), on = i === sel, c = on ? CSS.blue : CSS.muted;
      ctx.fillStyle = on ? 'rgba(106,168,255,.08)' : 'rgba(255,255,255,.02)'; ctx.fillRect(x, top, cw, ch); sensorBox(ctx, x, top, cw, ch, on ? CSS.blue : CSS.line, 6);
      brainIcon(ctx, kind, x + cw / 2, top + ch * .3, Math.min(cw * .32, 46), c, t);
      ctx.fillStyle = on ? CSS.ink : CSS.muted; ctx.font = sans(cw < 150 ? 11 : 13, 700); ctx.textAlign = 'center'; ctx.fillText(name, x + cw / 2, top + ch * .62);
      say(ctx, rate, x + cw / 2, top + ch * .62 + 18, CSS.orange, cw < 150 ? 9 : 11);
      // a heartbeat: one tick per loop, slowed so 20 kHz and 6 Hz both show
      const ty = top + ch * .88, rate2 = Math.log10(hz) * 2.2;
      ctx.strokeStyle = CSS.line; ctx.beginPath(); ctx.moveTo(x + 8, ty); ctx.lineTo(x + cw - 8, ty); ctx.stroke();
      const ticks = [36, 18, 9, 3][i];
      for (let k = 0; k < ticks; k++) { const ph = ((t * rate2 / 40 + k / ticks) % 1), px = x + 8 + (cw - 16) * ph; ctx.strokeStyle = on ? CSS.blue : '#3a4566'; ctx.beginPath(); ctx.moveTo(px, ty - 7); ctx.lineTo(px, ty + 7); ctx.stroke(); }
      if (i < n - 1) {   // the link to the next computer, with a packet going each way
        const lx = x + cw, ly = top + ch * .3, f = (t * .8 + i * .3) % 1;
        ctx.strokeStyle = CSS.line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + gap, ly); ctx.stroke(); ctx.setLineDash([]);
        dot(ctx, lx + gap * f, ly - 3, 2.5, CSS.cyan); dot(ctx, lx + gap * (1 - f), ly + 3, 2.5, CSS.orange);
      }
      return { x: x * zoom, y: top * zoom, w: cw * zoom, h: ch * zoom, i };   // in CSS pixels for tappable
    });
    ctx.textAlign = 'left';
    // what runs where on the chosen robot
    const my = top + ch + 18;
    say(ctx, `on ${robot === 'our arm' ? 'our arm (the labs)' : 'a ' + robot}:`, 14, my, CSS.ink, 12, 'left');
    BRAIN_MAPS[robot].forEach((txt, i) => {
      const x = 14 + i * (cw + gap), y0 = my + 12, none = /not (used|needed)/.test(txt);
      ctx.fillStyle = none ? 'rgba(255,255,255,.02)' : 'rgba(88,224,210,.07)'; ctx.fillRect(x, y0, cw, h - y0 - 10); sensorBox(ctx, x, y0, cw, h - y0 - 10, none ? CSS.line : 'rgba(88,224,210,.5)', 6);
      ctx.fillStyle = none ? CSS.muted : CSS.ink; ctx.font = mono(cw < 150 ? 9 : 11); wrapText(ctx, txt, x + 8, y0 + 18, cw - 16, cw < 150 ? 12 : 15);
    });
    const [name, ex, os, rate, good] = BRAINS[sel];
    out.innerHTML = `<b>${name}</b><br><b>examples</b> ${ex}<br><b>runs</b> ${os}<br><b>loop</b> ${rate}<br><b>good at</b> ${good}${sel < BRAINS.length - 1 ? `<br><b>talks to the next one over</b> ${BRAIN_LINKS[sel]}` : ''}`;
  } };
};
function wrapText(ctx, text, x, y, maxW, lh) {
  let line = ''; for (const word of text.split(' ')) { const test = line ? line + ' ' + word : word; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = word; y += lh; } else line = test; }
  if (line) ctx.fillText(line, x, y);
}

// ---------- Inside a robot · act: how seven actuators move ----------
function gear(ctx, x, y, r, teeth, a, color) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let k = 0; k <= teeth * 2; k++) { const b = a + k * Math.PI / teeth, rr = k % 2 ? r : r * .86; ctx.lineTo(x + rr * Math.cos(b), y + rr * Math.sin(b)); }
  ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r * .7 * Math.cos(a), y + r * .7 * Math.sin(a)); ctx.stroke();
}
const SERVO_TARGETS = [0, 60, -40, 90, -80];
const servoTarget = t => SERVO_TARGETS[Math.floor(t / 1.6) % SERVO_TARGETS.length] * Math.PI / 180;
function servoAngle(t) { const k = Math.floor(t / 1.6), u = t - k * 1.6, a = servoTarget(t - 1.6 < 0 ? 0 : t - 1.6), b = servoTarget(t); const e = 1 - Math.exp(-u * 6) * (Math.cos(u * 9) + .7 * Math.sin(u * 9)); return a + (b - a) * e; }
const ACTUATORS = [
  { name: 'DC motor + gearbox', cmd: 'a voltage, usually as PWM', ros: 'velocity or effort', where: 'wheels, small arms, toys',
    how: 'Current through coils in a magnetic field makes the shaft spin, thousands of rpm with little force. A gearbox trades speed for force: 50:1 gives 1/50 of the speed and about 50 times the torque.',
    unit: 'motor (dashed) and output shaft speed', plot: t => [.9, .9 / 5],
    draw(ctx, x, y, w, h, t) {
      const cy = y + h * .5, mx = x + w * .22, a = t * 10;
      ctx.fillStyle = '#26304a'; ctx.fillRect(mx - 70, cy - 32, 90, 64); ctx.strokeStyle = CSS.orange; ctx.strokeRect(mx - 70, cy - 32, 90, 64);
      say(ctx, 'motor', mx - 25, cy + 50, CSS.orange, 11); say(ctx, '3000 rpm', mx - 25, cy - 42, CSS.muted, 10);
      ctx.strokeStyle = '#8f9ab3'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(mx + 20, cy); ctx.lineTo(mx + 46, cy); ctx.stroke();
      gear(ctx, mx + 60, cy, 16, 8, a, CSS.orange); gear(ctx, mx + 60 + 16 + 46, cy, 52, 26, -a / 3.25 + .12, CSS.orange);
      say(ctx, 'gearbox', mx + 120, cy + 74, CSS.orange, 11);
      ctx.strokeStyle = '#8f9ab3'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(mx + 122, cy); ctx.lineTo(x + w * .82, cy); ctx.stroke();
      const wx = x + w * .86; ctx.strokeStyle = CSS.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(wx, cy, 34, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, cy); ctx.lineTo(wx + 34 * Math.cos(-a / 50), cy + 34 * Math.sin(-a / 50)); ctx.stroke();
      say(ctx, 'wheel · 60 rpm', wx, cy + 52, CSS.ink, 11); say(ctx, '50:1 → 1/50 speed, ~50× torque', x + w * .55, y + 14, CSS.ink, 12);
    } },
  { name: 'Servo', cmd: 'a target angle (a pulse width, or a serial packet for smart servos)', ros: 'position', where: 'hobby robots, small arms; TurtleBot3 uses DYNAMIXEL smart servos',
    how: 'A motor, gearbox, position sensor and a small controller in one box. You send an angle; the controller drives the motor until the sensor says it is there.',
    unit: 'target (dashed) and actual angle', range: [-1.7, 1.7], plot: t => [servoTarget(t), servoAngle(t)],
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .42, cy = y + h * .55, tg = servoTarget(t), a = servoAngle(t);
      ctx.fillStyle = '#1b2236'; ctx.fillRect(cx - 110, cy - 40, 220, 80); ctx.strokeStyle = CSS.orange; ctx.lineWidth = 1.5; ctx.strokeRect(cx - 110, cy - 40, 220, 80);
      for (const [lbl, dx, c] of [['motor', -80, CSS.orange], ['gears', -30, CSS.orange], ['sensor', 22, CSS.cyan], ['control', 76, CSS.blue]]) say(ctx, lbl, cx + dx, cy + 30, c, 10);
      const hx = cx + 30, hy = cy - 40;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = CSS.muted; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 70 * Math.sin(tg), hy - 70 * Math.cos(tg)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = CSS.orange; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 62 * Math.sin(a), hy - 62 * Math.cos(a)); ctx.stroke(); ctx.lineCap = 'butt';
      dot(ctx, hx, hy, 6, CSS.ink);
      say(ctx, `target ${(tg * 180 / Math.PI).toFixed(0)}° · now ${(a * 180 / Math.PI).toFixed(0)}°`, x + w * .82, cy - 10, CSS.ink, 12);
      say(ctx, 'sensor → controller → motor', x + w * .82, cy + 10, CSS.cyan, 10);
    } },
  { name: 'Stepper motor', cmd: 'step and direction pulses', ros: 'position, usually without feedback', where: '3D printers, CNC machines, small gantries',
    how: 'Coils are switched on one after another and the rotor snaps to each one: a fixed step, often 1.8° (200 per turn). Count the steps to know the angle, as long as it never skips one.',
    unit: 'angle: moves in steps', range: [0, 1], plot: t => [(Math.floor(t * 4) % 24) / 24, (Math.floor(t * 4) % 24) / 24],
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .4, cy = y + h * .52, R = Math.min(w, h) * .3, step = Math.floor(t * 4), a = step * Math.PI / 12, on = step % 4;
      for (let k = 0; k < 4; k++) { const b = k * Math.PI / 2, lit = k === on; ctx.fillStyle = lit ? CSS.orange : '#26304a'; ctx.save(); ctx.translate(cx + R * 1.2 * Math.cos(b), cy + R * 1.2 * Math.sin(b)); ctx.rotate(b); ctx.fillRect(-12, -18, 24, 36); ctx.restore(); say(ctx, 'ABCD'[k], cx + R * 1.62 * Math.cos(b), cy + R * 1.62 * Math.sin(b) + 4, lit ? CSS.orange : CSS.muted, 11); }
      ctx.fillStyle = '#3a4566'; ctx.beginPath(); ctx.arc(cx, cy, R * .8, 0, 7); ctx.fill();
      for (let k = 0; k < 12; k++) { const b = a + k * Math.PI / 6; ctx.fillStyle = '#8f9ab3'; ctx.beginPath(); ctx.arc(cx + R * .8 * Math.cos(b), cy + R * .8 * Math.sin(b), 5, 0, 7); ctx.fill(); }
      ctx.strokeStyle = CSS.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * .7 * Math.cos(a), cy + R * .7 * Math.sin(a)); ctx.stroke();
      say(ctx, `step ${step % 24} · ${((step % 24) * 15).toFixed(0)}°`, x + w * .82, cy, CSS.ink, 12); say(ctx, '(15° steps here; real ones are 1.8°)', x + w * .82, cy + 18, CSS.muted, 10);
    } },
  { name: 'Brushless joint motor', cmd: 'a position, velocity or torque, sent to a motor driver over CAN or EtherCAT', ros: 'position, velocity or effort', where: 'robot arm joints (Franka Panda, UR), drones, legged robots',
    how: 'No brushes: a driver switches three coil phases in turn so the field leads the magnets. Strong for its size; inside an arm joint it sits with a compact high-ratio gear and an encoder.',
    unit: 'phase currents A, B, C', range: [-1.1, 1.1], plot: t => [Math.sin(t * 3), Math.sin(t * 3 - 2.09), Math.sin(t * 3 + 2.09)],
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .4, cy = y + h * .52, R = Math.min(w, h) * .3, a = t * 3;
      const ph = [Math.sin(a), Math.sin(a - 2.09), Math.sin(a + 2.09)], cols = [CSS.orange, CSS.cyan, CSS.pink];
      for (let k = 0; k < 6; k++) { const b = k * Math.PI / 3, p = ph[k % 3] * (k < 3 ? 1 : -1); ctx.fillStyle = cols[k % 3]; ctx.globalAlpha = .2 + .8 * Math.max(0, p); ctx.save(); ctx.translate(cx + R * 1.15 * Math.cos(b), cy + R * 1.15 * Math.sin(b)); ctx.rotate(b); ctx.fillRect(-10, -14, 20, 28); ctx.restore(); }
      ctx.globalAlpha = 1;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a - Math.PI / 2);
      ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(0, 0, R * .75, -Math.PI / 2, Math.PI / 2); ctx.fill(); ctx.fillStyle = '#2f6fd0'; ctx.beginPath(); ctx.arc(0, 0, R * .75, Math.PI / 2, 3 * Math.PI / 2); ctx.fill();
      say(ctx, 'N', R * .4, 4, CSS.ink, 12); say(ctx, 'S', -R * .4, 4, CSS.ink, 12); ctx.restore();
      say(ctx, 'the driver rotates the field;', x + w * .82, cy - 8, CSS.ink, 11); say(ctx, 'the magnets follow it', x + w * .82, cy + 10, CSS.ink, 11);
    } },
  { name: 'Linear actuator', cmd: 'a position or a speed', ros: 'position or velocity (a prismatic joint)', where: 'lifts, presses, adjustable tables, some grippers',
    how: 'A motor turns a lead screw; a nut on the screw cannot turn, so it slides, pushing a rod in and out. Turning becomes straight-line motion.',
    unit: 'rod position', range: [0, 1], plot: t => { const v = .5 - .5 * Math.cos(t * .9); return [v, v]; },
    draw(ctx, x, y, w, h, t) {
      const cy = y + h * .5, x0 = x + w * .12, ext = (.5 - .5 * Math.cos(t * .9)) * w * .26, spin = t * .9;
      ctx.fillStyle = '#26304a'; ctx.fillRect(x0, cy - 26, 60, 52); ctx.strokeStyle = CSS.orange; ctx.strokeRect(x0, cy - 26, 60, 52); say(ctx, 'motor', x0 + 30, cy + 44, CSS.orange, 10);
      ctx.fillStyle = '#1b2236'; ctx.fillRect(x0 + 60, cy - 18, w * .36, 36); ctx.strokeStyle = CSS.muted; ctx.strokeRect(x0 + 60, cy - 18, w * .36, 36);
      for (let k = 0; k < 40; k++) { const px = x0 + 66 + ((k * 9 + spin * 30) % (w * .34)); ctx.strokeStyle = '#8f9ab3'; ctx.beginPath(); ctx.moveTo(px, cy - 8); ctx.lineTo(px + 5, cy + 8); ctx.stroke(); }
      const nx = x0 + 60 + 20 + ext; ctx.fillStyle = CSS.orange; ctx.fillRect(nx, cy - 14, 18, 28);
      ctx.fillStyle = '#c9d1e3'; ctx.fillRect(nx + 18, cy - 7, w * .3, 14); ctx.fillStyle = CSS.ink; ctx.fillRect(nx + 18 + w * .3, cy - 16, 8, 32);
      say(ctx, `rod out ${(ext / (w * .26) * 100).toFixed(0)} mm`, x + w * .5, y + 16, CSS.ink, 12); say(ctx, 'screw turns → nut slides', x + w * .5, y + h - 4, CSS.muted, 10);
    } },
  { name: 'Two-jaw gripper', cmd: 'a finger opening (or a force)', ros: 'position of the finger joints', where: 'our arm: left_finger_joint and right_finger_joint, 0–0.04 m each',
    how: 'One motor drives both fingers in opposite directions so they meet in the middle. Our gripper is two prismatic joints driven by gripper_controller.',
    unit: 'commanded (dashed) and real finger opening: m', range: [0, .045], plot: t => { const o = .02 + .02 * Math.cos(t * 1.1); return [o, Math.max(o, .02)]; },   // command, and the fingers stopped by the box
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .42, cy = y + h * .58, o = .02 + .02 * Math.cos(t * 1.1), gap = Math.max(o, .02) * 1400 + 6;
      ctx.fillStyle = DA_CSS.grey; ctx.fillRect(cx - 90, cy - 70, 180, 14);
      ctx.fillStyle = DA_CSS.red; ctx.fillRect(cx - 28, cy - 28, 56, 56);
      for (const sg of [-1, 1]) { ctx.fillStyle = DA_CSS.black; ctx.fillRect(cx + sg * gap - (sg < 0 ? 16 : 0), cy - 56, 16, 80); arrowTo(ctx, cx + sg * (gap + 30), cy - 80, cx + sg * (gap + 30) + sg * (Math.sin(t * 1.1) > 0 ? -1 : 1) * 16, cy - 80, CSS.orange, 2); }
      say(ctx, `opening ${(Math.max(o, .02) * 1000).toFixed(0)} mm per finger`, x + w * .82, cy - 10, CSS.ink, 12);
      say(ctx, o < .02 ? 'stopped by the 40 mm box' : '', x + w * .82, cy + 10, CSS.cyan, 10);
    } },
  { name: 'Suction cup', cmd: 'on or off: a digital output to a valve or pump', ros: 'a GPIO or a service, not a joint', where: 'warehouse picking, packaging, flat or smooth parts',
    how: 'A pump or a venturi pulls air out of a soft cup pressed on the part. The air outside pushes harder than the air inside, so the part sticks until the valve lets air back in.',
    unit: 'vacuum: on or off', range: [0, 1.1], plot: t => { const u = t % 5; const v = u > 1.4 && u < 3.8 ? 1 : 0; return [v, v]; },
    draw(ctx, x, y, w, h, t) {
      const cx = x + w * .42, u = t % 5, z = u < 1.4 ? u / 1.4 : u < 2.6 ? 1 - (u - 1.4) / 1.2 * .6 : u < 3.8 ? .4 + (u - 2.6) / 1.2 * .6 : 1 - (u - 3.8) / 1.2, vac = u > 1.4 && u < 3.8;
      const tbl = y + h * .85, cupY = y + 30 + z * (h * .5), carried = vac && u > 1.6;
      ctx.fillStyle = '#3a4566'; ctx.fillRect(x + w * .15, tbl, w * .55, 6);
      const by = carried ? cupY + 26 : tbl - 44; ctx.fillStyle = CSS.blue; ctx.fillRect(cx - 40, by, 80, 44);
      ctx.fillStyle = '#8f9ab3'; ctx.fillRect(cx - 5, y + 4, 10, cupY - y);
      ctx.fillStyle = vac ? CSS.orange : '#5a6480'; ctx.beginPath(); ctx.moveTo(cx - 6, cupY); ctx.lineTo(cx + 6, cupY); ctx.lineTo(cx + 26, cupY + 26); ctx.lineTo(cx - 26, cupY + 26); ctx.fill();
      if (vac) for (let k = 0; k < 3; k++) { const f = ((t * 1.5 + k / 3) % 1); dot(ctx, cx, cupY + 20 - f * (cupY - y - 4) * .5, 2.5, CSS.cyan); }
      say(ctx, vac ? 'vacuum on: air pulled out' : 'valve open: no grip', x + w * .82, y + h * .5, vac ? CSS.orange : CSS.muted, 12);
    } },
];
SCENES['actuator-gallery'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let sel = 0, auto = true;
  const btns = ACTUATORS.map((g, i) => u.button(g.name, () => choose(i, true), i === 0));
  u.row(...btns);
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const out = u.readout();
  u.text('Each one turns a <b>command</b> into motion. ros2_control talks to all of them through the same <b>command interfaces</b>: position, velocity or effort.');
  function choose(i, manual) {
    sel = i; btns.forEach((b, k) => b.classList.toggle('on', k === i)); if (manual) { auto = false; autoBtn.classList.remove('on'); }
    const g = ACTUATORS[i];
    out.innerHTML = `<b>${g.name}</b><br><b>how</b> ${g.how}<br><b>you send</b> ${g.cmd}<br><b>ros2_control</b> ${g.ros}<br><b>used in</b> ${g.where}`;
  }
  choose(0);
  return { canvas, reset() { if (auto) choose(0); }, update(t) {
    if (auto) { const i = Math.floor(t / 9) % ACTUATORS.length; if (i !== sel) choose(i); }
    const { ctx, w, h } = fitMin(canvas, 620);
    const g = ACTUATORS[sel], plotH = Math.min(84, h * .19), top = 40, ih = h - top - plotH - 34;
    ctx.fillStyle = CSS.ink; ctx.font = sans(17, 700); ctx.fillText(g.name, 14, 26);
    ctx.save(); g.draw(ctx, 10, top, w - 20, ih, t); ctx.restore();
    const py = h - plotH - 12, [lo, hi] = g.range || [0, 1];
    ctx.strokeStyle = CSS.line; ctx.lineWidth = 1; ctx.strokeRect(10.5, py + .5, w - 21, plotH);
    say(ctx, g.unit, 16, py + 14, CSS.muted, 10, 'left');
    const n = g.plot(t).length, cols = n === 3 ? [CSS.orange, CSS.cyan, CSS.pink] : [CSS.muted, CSS.orange];
    for (let s2 = 0; s2 < n; s2++) {
      ctx.strokeStyle = cols[s2]; ctx.lineWidth = 2; ctx.setLineDash(n === 2 && s2 === 0 ? [5, 4] : []); ctx.beginPath();
      for (let k = 0; k <= 200; k++) { const tt = t - 4 + 4 * k / 200, v = clamp(g.plot(tt)[s2], lo, hi), X = 12 + (w - 24) * k / 200, Y = py + plotH - 6 - (v - lo) / (hi - lo) * (plotH - 24); k ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
  } };
};

// ---------- Inside a robot · act: from a command to a moving joint, and back ----------
SCENES['drive-chain'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let ratio = 100;
  u.slider('gear ratio', 10, 160, 1, ratio, v => (ratio = v), v => `${(+v).toFixed(0)}:1`);
  const out = u.readout();
  const steps = u.list([
    '<b>controller</b> ros2_control compares target and encoder, 100–1000 times a second',
    '<b>motor driver</b> turns the command into current for the coils',
    '<b>motor</b> spins fast with little torque',
    '<b>gearbox</b> slows it down, multiplies the torque',
    '<b>joint</b> the link moves',
    '<b>encoder</b> measures the joint and reports back']);
  u.text('One joint of our arm, end to end. Drag the gear ratio: a bigger ratio means more torque at the joint, but the motor must spin faster for the same joint speed.');
  const MOTOR_TORQUE = .3, MOTOR_MAX = 6000, EFF = .8;   // N·m and rpm of a small motor; gearbox efficiency
  return { canvas, update(t) {
    const { ctx, w, h } = fitMin(canvas, 660);
    const BL = ['controller', 'motor driver', 'motor', 'gearbox', 'joint'], cols = [CSS.blue, CSS.blue, CSS.orange, CSS.orange, CSS.orange];
    const n = BL.length, gap = 18, bw = (w - 28 - gap * (n - 1)) / n, by = 34, bh = 54;
    const target = .9 * Math.sin(t * .6), jointVel = .9 * .6 * Math.cos(t * .6), motorRpm = Math.abs(jointVel) * ratio * 60 / (2 * Math.PI);
    const phase = (t * 1.2) % 1, active = Math.min(n - 1, Math.floor(phase * (n + 1)));
    BL.forEach((name, i) => {
      const x = 14 + i * (bw + gap), on = i === active;
      ctx.fillStyle = on ? 'rgba(255,177,90,.08)' : 'rgba(255,255,255,.02)'; ctx.fillRect(x, by, bw, bh); sensorBox(ctx, x, by, bw, bh, on ? cols[i] : CSS.line, 6);
      ctx.fillStyle = on ? CSS.ink : CSS.muted; ctx.font = sans(bw < 110 ? 10 : 12, 700); ctx.textAlign = 'center'; ctx.fillText(name, x + bw / 2, by + 22);
      const sub = [`target ${target.toFixed(2)} rad`, 'current', `${motorRpm.toFixed(0)} rpm`, `${ratio.toFixed(0)}:1`, `${(target).toFixed(2)} rad`][i];
      say(ctx, sub, x + bw / 2, by + 40, cols[i], bw < 110 ? 9 : 10);
      if (i < n - 1) { arrowTo(ctx, x + bw + 2, by + bh / 2, x + bw + gap - 2, by + bh / 2, CSS.orange, 1.5, 6); if (i === Math.floor(phase * (n + 1)) - 0) dot(ctx, x + bw + gap * ((phase * (n + 1)) % 1), by + bh / 2, 3.5, CSS.orange); }
    });
    // feedback from the joint's encoder back to the controller
    const fy = by + bh + 22, x0 = 14 + bw / 2, x1 = 14 + (n - 1) * (bw + gap) + bw / 2;
    ctx.strokeStyle = CSS.cyan; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x1, by + bh); ctx.lineTo(x1, fy); ctx.lineTo(x0, fy); ctx.stroke(); arrowTo(ctx, x0, fy, x0, by + bh + 2, CSS.cyan, 1.5, 6);
    const fb = (t * .9) % 1; dot(ctx, x1 + (x0 - x1) * fb, fy, 3.5, CSS.cyan); say(ctx, 'encoder: the measured angle goes back', (x0 + x1) / 2, fy + 16, CSS.cyan, 10);
    // the hardware: motor rotor (fast), gear pair, and the arm link (slow)
    const hy = fy + 40, hh = h - hy - 10, cy = hy + hh * .55, mx = w * .22, gx = w * .48, jx = w * .76;
    const motorA = t * motorRpm / 60 * .25;   // slowed down to watch
    const mr = Math.min(w * .08, hh * .3), gr = Math.min(w * .07, hh * .28);
    ctx.fillStyle = '#26304a'; ctx.beginPath(); ctx.arc(mx, cy, mr, 0, 7); ctx.fill();
    ctx.strokeStyle = CSS.orange; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(mx, cy); ctx.lineTo(mx + mr * .85 * Math.cos(motorA), cy + mr * .85 * Math.sin(motorA)); ctx.stroke();
    gear(ctx, gx - gr * .9, cy, gr * .32, 6, motorA, CSS.orange); gear(ctx, gx + gr * .3, cy, gr, 18, -motorA / 3 + .2, CSS.orange);
    say(ctx, 'fast, weak', mx, cy + mr + 16, CSS.muted, 10); say(ctx, 'slow, strong', jx, cy + mr + 16, CSS.muted, 10);
    const L = Math.min(hh * .6, (w - jx - 16) / Math.sin(.9)), jy = cy + 20;
    ctx.fillStyle = DA_CSS.black; ctx.fillRect(jx - 14, jy, 28, 16); ctx.strokeStyle = '#e8892c'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(jx + L * Math.sin(target), jy - L * Math.cos(target)); ctx.stroke(); ctx.lineCap = 'butt'; dot(ctx, jx, jy, 6, CSS.ink);
    ctx.textAlign = 'left';
    const jointTorque = MOTOR_TORQUE * ratio * EFF, maxJointSpeed = MOTOR_MAX / ratio * 2 * Math.PI / 60;
    out.innerHTML = `<b>joint torque</b> up to ${jointTorque.toFixed(0)} N·m (0.3 N·m motor × ${ratio.toFixed(0)} × 80%)<br><b>top joint speed</b> ${maxJointSpeed.toFixed(2)} rad/s (motor 6000 rpm ÷ ${ratio.toFixed(0)})<br><b>motor now</b> ${motorRpm.toFixed(0)} rpm for ${Math.abs(jointVel).toFixed(2)} rad/s at the joint`;
    steps.forEach((li, k) => li.classList.toggle('on', k === (active < n ? active : 5) || (k === 5 && fb < .5 && active === n - 1)));
  } };
};

// ---------- Inside a robot · together: an exploded demo_arm, every part tagged sense, think or act ----------
const ARM_PARTS = {
  camera: ['RealSense D435', 'sensor', 'Colour and depth camera on a stand 1 m above the table, looking straight down. Publishes <code>/camera/camera/color/image_raw</code> and a point cloud.'],
  lidar: ['2D lidar', 'sensor', 'On the front of the pedestal: a 360° scan at table-leg height, <code>/scan</code>.'],
  encoders: ['Joint encoders × 5', 'sensor', 'One in every joint, measuring its angle: <code>/joint_states</code>. Without them the controller would be blind.'],
  imu: ['IMU', 'sensor', 'In the gripper palm: acceleration and rotation rate of the hand, <code>/imu</code>.'],
  ft: ['Force-torque sensor', 'sensor', 'Between the wrist and the palm: feels the weight of a held box, or a bump, <code>/wrist_ft</code>.'],
  contact: ['Finger contact pads', 'sensor', 'On both fingers: do they touch something? <code>/left_finger/contact</code>, <code>/right_finger/contact</code>.'],
  computer: ['Computer', 'brain', 'Your laptop in the labs: Gazebo, ros2_control, MoveIt 2, the box detector and RViz, all talking over ROS 2.'],
  drivers: ['Motor drivers', 'brain', 'Turn joint commands into motor current. In Gazebo, the gz_ros2_control plugin plays this part.'],
  motors: ['Joint motors × 5', 'actuator', 'Base yaw, shoulder, elbow, wrist pitch, wrist roll: five revolute joints, commanded by <code>arm_controller</code>.'],
  gripper: ['Two-jaw gripper', 'actuator', 'Two prismatic fingers, 0–40 mm each, commanded by <code>gripper_controller</code>.'],
  links: ['Links', 'body', 'The rigid parts between joints: 0.30 m upper arm, 0.25 m forearm; about 0.7 m reach. Orange and black, like RRBot.'],
  base: ['Pedestal', 'body', 'Holds the arm to the floor: 0.14 × 0.14 × 0.20 m.'],
};
SCENES['anatomy-arm'] = async (panel) => {
  const s = base3d({ cam: [.55, 1.2, -1.5], target: [.24, .56, 0], grid: 0 });   // from the arm's left side
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  Object.values(cell.boxes).forEach(b => (b.visible = false)); cell.tray.visible = false;
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: .5, metalness: .1 });
  const tag = (o, k) => { o.traverse(m => { if (m.isMesh) { m.userData.part = k; m.material = m.material.clone(); } }); return o; };
  tag(arm.links.base, 'base'); ['l1', 'l2', 'l3', 'l4', 'palm'].forEach(k => tag(arm.links[k], 'links')); arm.links.fingers.forEach(f => tag(f, 'gripper'));
  tag(cell.cam, 'camera'); tag(cell.lidar, 'lidar'); [cell.post, cell.bar, cell.top, cell.legs].forEach(o => o.traverse(m => m.isMesh && (m.userData.part = null)));
  // parts the plain arm does not draw: motors and encoders at each joint, wrist sensor, IMU, pads, drivers, computer
  arm.joints.forEach((j, i) => {
    const yaw = i === 0 || i === 4, m = new THREE.Mesh(new THREE.CylinderGeometry(i ? .028 : .05, i ? .028 : .05, yaw ? .02 : .07, 24), mat(C.orange));
    if (!yaw) m.rotation.z = 0; else m.rotation.x = Math.PI / 2;   // cylinder axis: y for pitch joints, z for yaw and roll
    if (yaw) m.position.z = i ? -.012 : -.012; j.add(tag(m, 'motors'));
    const r = new THREE.Mesh(new THREE.TorusGeometry(i ? .034 : .056, .005, 8, 32), mat(C.cyan)); if (!yaw) r.rotation.x = Math.PI / 2; r.position.y = yaw ? 0 : .04; if (yaw) r.position.z = -.012; j.add(tag(r, 'encoders'));
  });
  const ft = new THREE.Mesh(new THREE.CylinderGeometry(.026, .026, .012, 24), mat(C.cyan)); ft.rotation.x = Math.PI / 2; ft.position.z = -.004; arm.joints[4].add(tag(ft, 'ft'));
  const imu = box(.016, .016, .006, C.cyan); imu.position.set(0, .035, .024); arm.joints[4].add(tag(imu, 'imu'));
  arm.links.fingers.forEach(f => { const pad = box(.02, .003, .03, C.cyan); pad.position.set(0, -f.userData.sign * .0075, .055 - .025); f.add(tag(pad, 'contact')); });
  const drivers = box(.05, .1, .07, C.blue); drivers.position.set(-.1, 0, .1); s.world.add(tag(drivers, 'drivers'));
  const pc = new THREE.Group(); const screen = box(.16, .01, .11, C.blue); screen.position.set(0, 0, .09); const kb = box(.16, .1, .008, 0x5a6480); kb.position.set(0, -.05, .004); pc.add(screen, kb); pc.position.set(-.25, .3, 0); pc.rotation.z = -.6; s.world.add(tag(pc, 'computer'));
  const KEYS = Object.keys(ARM_PARTS), lbl = {};
  const anchors = { camera: cell.cam, lidar: cell.lidar, encoders: arm.joints[2], imu: arm.joints[4], ft: arm.joints[4], contact: arm.links.fingers[0], computer: pc, drivers, motors: arm.joints[1], gripper: arm.links.tool, links: arm.links.l2, base: arm.links.base };
  const OFF = { camera: [0, 0, .06], computer: [0, 0, .2], imu: [0, .09, .03], ft: [0, -.09, 0], contact: [0, 0, .09] };
  for (const k of KEYS) { const l = label(ARM_PARTS[k][0], 'small'); anchors[k].add(l); l.position.set(...(OFF[k] || [0, 0, .05])); lbl[k] = l; }
  const meshes = []; s.world.traverse(o => { if (o.isMesh && o.userData.part) meshes.push(o); });
  const base0 = arm.joints.map(j => j.position.z), cam0 = cell.cam.position.z, lid0 = cell.lidar.position.x;
  const u = ui(panel);
  let sel = 'camera', explode = 0, auto = true;
  const btns = KEYS.map(k => u.button(ARM_PARTS[k][0].replace(' × 5', ''), () => select(k, true), k === sel));
  u.row(...btns);
  const ex = u.slider('explode', 0, 1, .01, 0, v => { explode = v; stopAuto(); });
  const autoBtn = u.button('auto tour', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  const out = u.readout();
  u.text('Our arm, <b>demo_arm</b>, part by part. Colours: <b style="color:#58e0d2">sense</b>, <b style="color:#6aa8ff">think</b>, <b style="color:#ffb15a">act</b>. Click a part in 3D or a button.');
  function stopAuto() { auto = false; autoBtn.classList.remove('on'); }
  function select(k, manual) {
    sel = k; if (manual) stopAuto(); btns.forEach((b, i) => b.classList.toggle('on', KEYS[i] === k));
    const [name, kind, text] = ARM_PARTS[k];
    out.innerHTML = `<b>${name}</b> · ${{ sensor: 'sense', brain: 'think', actuator: 'act', body: 'structure' }[kind]}<br>${text}`;
    for (const m of meshes) { const on = m.userData.part === k; m.material.emissive?.set(on ? (KIND[ARM_PARTS[k][1]] ?? '#556') : '#000').multiplyScalar(on ? .55 : 1); }
  }
  select(sel);
  const POSE = demoArmIK([.42, .05, .3]);
  return { ...s, sway: { amplitude: .35, period: 28 }, pick(ray) {
    const hit = ray.intersectObjects(meshes, false)[0]; if (hit) select(hit.object.userData.part, true);
  }, update(t) {
    if (auto) { explode = .5 - .5 * Math.cos(t * .45); ex.set(explode); const k = KEYS[Math.floor(t / 3.4) % KEYS.length]; if (k !== sel) select(k); }
    arm.joints.forEach((j, i) => (j.position.z = base0[i] + explode * (i ? .07 : .09)));
    cell.cam.position.z = cam0 + explode * .12; cell.lidar.position.x = lid0 + explode * .14; drivers.position.x = -.1 - explode * .12; pc.position.x = -.25 - explode * .1;
    arm.set([POSE[0] + .25 * Math.sin(t * .4), POSE[1], POSE[2], POSE[3], POSE[4]], .012 + .008 * Math.sin(t * .8));
    for (const [k, l] of Object.entries(lbl)) l.visible = k === sel || explode > .9;
  } };
};

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

// ---------- ROS 2 overview: the ROS equation, built as a stack ----------
const TERMS = [
  ['Plumbing', CSS.cyan, 'nodes, topics, services, actions, discovery, QoS', 'Programs find each other and exchange typed messages, on one computer or across a network.', 'your own sockets, message formats and discovery'],
  ['Tools', CSS.blue, 'ros2 CLI, RViz2, rqt, ros2 bag, launch, Gazebo', 'See inside a running system: list nodes, echo topics, visualize sensors, record and replay.', 'print statements and custom viewers'],
  ['Capabilities', CSS.orange, 'Nav2, MoveIt 2, ros2_control, TF2, perception', 'Ready-made navigation, motion planning, control and coordinate frames.', 'years of writing planners and controllers'],
  ['Community', CSS.pink, 'docs, Q&A, Discourse, package index, ROSCon', 'Thousands of packages, answers to common errors, and people who have hit your bug before.', 'working alone'],
];
SCENES['ros-equation'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let auto = true, focus = -1, regions = [];
  const btns = TERMS.map(([n], i) => u.button(n, () => pick(i, true)));
  const autoBtn = u.button('build', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(...btns, autoBtn);
  const out = u.readout();
  u.text('ROS 2 is <b>not an operating system</b>. It is open-source middleware, libraries and tools that run on top of Linux, Windows, macOS and RTOS targets.');
  function pick(i, manual) {
    focus = i; btns.forEach((b, k) => b.classList.toggle('on', k === i));
    if (manual) { auto = false; autoBtn.classList.remove('on'); }
    if (i < 0) { out.innerHTML = '<b>ROS 2</b> = Plumbing + Tools + Capabilities + Community<br>Reuse the first four so you can spend your time on what makes your robot different.'; return; }
    const [n, , list, what, instead] = TERMS[i];
    out.innerHTML = `<b>${n}</b> · ${list}<br>${what}<br><b>without it</b> ${instead}`;
  }
  pick(-1);
  tappable(canvas, () => regions, g => pick(g.i, true));
  const CYC = 16;
  return { canvas, update(t) {
    const tc = t % CYC, shown = auto ? Math.min(4, Math.floor((tc - 1.2) / 2.4) + 1) : 4;
    if (auto) { const f = tc < 1.2 ? -1 : Math.min(3, Math.floor((tc - 1.2) / 2.4)); if (tc > 11.6) { if (focus !== -1) pick(-1); } else if (f !== focus) pick(f); }
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const fs = w < 520 ? 9 : 11, narrow = w < 520;
    // equation line
    ctx.font = sans(17, 700); ctx.textAlign = 'left';
    const eqW = ctx.measureText('ROS 2 = Plumbing + Tools + Capabilities + Community').width; ctx.font = sans(Math.min(17, 17 * (w - 24) / eqW), 700);
    const parts = [['ROS 2', CSS.ink], [' = ', CSS.muted], ...TERMS.flatMap(([n, c], i) => [[n, i < shown ? (focus === i ? c : CSS.ink) : 'rgba(168,176,195,.25)'], ...(i < 3 ? [[' + ', CSS.muted]] : [])])];
    let x = 12; parts.forEach(([s2, c]) => { ctx.fillStyle = c; ctx.fillText(s2, x, 26); x += ctx.measureText(s2).width; });
    // stack: OS at the bottom, ROS 2 layers above, community around everything
    const L = w * .1, R = w * .9, top = 52, osH = 34, gap = 8, lh = (h - top - osH - 40 - gap * 4) / 3;
    const osY = h - 26 - osH;
    ctx.strokeStyle = '#8f9ab3'; ctx.fillStyle = 'rgba(143,154,179,.12)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(L, osY, R - L, osH, 6); ctx.fill(); ctx.stroke();
    ['Linux', 'Windows', 'macOS', 'RTOS'].forEach((n, i) => { ctx.fillStyle = CSS.ink; ctx.font = mono(fs + 1); ctx.textAlign = 'center'; ctx.fillText(n, L + (R - L) * (i + .5) / 4, osY + osH / 2 + 4); });
    ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.fillText('operating system: not ROS', (L + R) / 2, osY + osH + 14);
    regions = [];
    const layer = (i, y, hh) => {
      const [n, c] = TERMS[i], k = auto ? clamp((tc - 1.2 - i * 2.4) / .6, 0, 1) : 1;
      if (k <= 0) return null;
      const off = (1 - smooth(k)) * -40;
      ctx.globalAlpha = smooth(k) * (focus < 0 || focus === i ? 1 : .35);
      ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.strokeStyle = c; ctx.lineWidth = focus === i ? 2.5 : 1.5;
      ctx.beginPath(); ctx.roundRect(L, y + off, R - L, hh, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c; ctx.font = sans(narrow ? 11 : 14, 700); ctx.textAlign = 'left'; ctx.fillText(n, L + 10, y + off + 20);
      ctx.fillStyle = CSS.muted; ctx.font = mono(fs - 1); ctx.fillText(TERMS[i][2], L + 10, y + off + hh - 8);
      return off;
    };
    // plumbing: nodes with packets and a service round trip
    const pY = osY - gap - lh, o0 = layer(0, pY, lh);
    if (o0 !== null) {
      const y = pY + o0 + lh * .5, xs = [.42, .58, .74, .9].map(f => L + (R - L) * f - 20);
      ctx.save(); ctx.globalAlpha *= 1;
      ctx.strokeStyle = 'rgba(88,224,210,.4)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(xs[0], y); ctx.lineTo(xs[3], y); ctx.stroke();
      xs.forEach(px => { ctx.fillStyle = '#11182c'; ctx.strokeStyle = CSS.cyan; ctx.beginPath(); ctx.arc(px, y, 9, 0, 7); ctx.fill(); ctx.stroke(); });
      for (let k = 0; k < 3; k++) { const f = (t * .9 + k / 3) % 1; dot(ctx, lerp(xs[0], xs[2], f), y, 3.5, CSS.cyan); }
      const sv = (t * .6) % 1; dot(ctx, xs[3] - (sv < .5 ? sv * 2 : 2 - sv * 2) * (xs[3] - xs[2]), y - 12, 3, sv < .5 ? CSS.blue : CSS.orange);
      ctx.restore();
    }
    // tools: a typing terminal and a spinning scan
    const tY = pY - gap - lh, o1 = shown > 1 || !auto ? layer(1, tY, lh) : null;
    if (o1 !== null && o1 !== undefined) {
      const y = tY + o1, cmd = '$ ros2 topic echo /scan', n = Math.floor((t * 8) % (cmd.length + 12));
      const bx = L + (R - L) * .34;
      ctx.fillStyle = '#080d19'; ctx.strokeStyle = 'rgba(106,168,255,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(bx, y + 8, (R - L) * .36, lh - 16, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#dce8ff'; ctx.font = mono(fs); ctx.textAlign = 'left'; ctx.fillText(cmd.slice(0, n) + (Math.floor(t * 2) % 2 ? '▌' : ''), bx + 8, y + 8 + (lh - 16) / 2 + 4);
      const cx = L + (R - L) * .85, cy = y + lh / 2, r = Math.min(lh * .38, 34);
      ctx.strokeStyle = CSS.line; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
      for (let k = 0; k < 40; k++) { const a = k / 40 * 7 + t * .8, rr = r * (.55 + .35 * Math.abs(Math.sin(k * 1.7))); dot(ctx, cx + rr * Math.cos(a), cy + rr * Math.sin(a), 1.6, CSS.pink); }
      ctx.strokeStyle = CSS.blue; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + r * Math.cos(t * 3), cy + r * Math.sin(t * 3)); ctx.stroke();
    }
    // capabilities: a path being drawn and an arm swinging
    const cY = tY - gap - lh, o2 = auto && shown < 3 ? null : layer(2, cY, lh);
    if (o2 !== null && o2 !== undefined) {
      const y = cY + o2, x0 = L + (R - L) * .36, x1 = L + (R - L) * .66, f = (t * .35) % 1;
      ctx.strokeStyle = CSS.orange; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.beginPath();
      for (let k = 0; k <= 40 * f; k++) { const s2 = k / 40, px = lerp(x0, x1, s2), py = y + lh / 2 + Math.sin(s2 * 6) * lh * .22; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); ctx.setLineDash([]);
      dot(ctx, lerp(x0, x1, f), y + lh / 2 + Math.sin(f * 6) * lh * .22, 5, '#c9d1e3');
      const base = [L + (R - L) * .84, y + lh - 10], a1 = -1.9 + .5 * Math.sin(t * 1.2), a2 = .9 + .5 * Math.sin(t * 1.7), e = pol(base, lh * .38, a1), tip = pol(e, lh * .32, a1 + a2);
      ctx.strokeStyle = '#c9d1e3'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(...base); ctx.lineTo(...e); ctx.lineTo(...tip); ctx.stroke(); ctx.lineCap = 'butt';
      [base, e].forEach(p => dot(ctx, ...p, 4, CSS.orange));
    }
    // community: people around the stack, linked to each other
    const o3 = auto && shown < 4 ? null : 0;
    if (o3 !== null) {
      const k = auto ? smooth(clamp((tc - 1.2 - 3 * 2.4) / .8, 0, 1)) : 1;
      ctx.globalAlpha = k * (focus < 0 || focus === 3 ? 1 : .35);
      const ppl = Array.from({ length: 14 }, (_, i) => { const side = i % 2 ? R + (w - R) / 2 : L / 2, yy = top + 10 + (i >> 1) * ((osY - top) / 7); return [side + 6 * Math.sin(t + i), yy]; });
      ctx.strokeStyle = 'rgba(255,114,159,.35)'; ctx.lineWidth = 1;
      ppl.forEach((p, i) => { const q = ppl[i + 2]; if (q) { ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); } ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(i % 2 ? R : L, p[1]); ctx.stroke(); });
      ppl.forEach(p => dot(ctx, ...p, 4, CSS.pink));
      for (let k = 0; k < 2; k++) { const i = (Math.floor(t * .7) * 5 + k * 7) % 14, p = ppl[i], f = (t * .7) % 1; dot(ctx, lerp(p[0], i % 2 ? R : L, f), p[1], 2.5, CSS.ink); }
      ctx.fillStyle = CSS.pink; ctx.font = mono(fs, 600); ctx.textAlign = 'center'; if (!narrow) ctx.fillText('Community', L / 2, top + 2);
      ctx.globalAlpha = 1;
      regions.push({ x: 0, y: top, w: L, h: osY - top, i: 3 }, { x: R, y: top, w: w - R, h: osY - top, i: 3 });
    }
    ctx.globalAlpha = 1;
    regions.push({ x: L, y: pY, w: R - L, h: lh, i: 0 }, { x: L, y: tY, w: R - L, h: lh, i: 1 }, { x: L, y: cY, w: R - L, h: lh, i: 2 });
    ctx.textAlign = 'left';
  } };
};

// ---------- ROS 2 overview: why ROS 2, four cases side by side ----------
const WHY = [
  ['No single point of failure', 'ROS 1: every node registers with one roscore master. Stop it and running links keep going, but no new node can connect. ROS 2: nodes discover each other directly; one node stopping affects only that node.'],
  ['Real products', 'Managed (lifecycle) nodes start in a known order, SROS2 encrypts and authenticates traffic, and LTS releases get five years of support: Jazzy until May 2029.'],
  ['Real networks', 'QoS per topic. Reliable resends a lost message (commands, maps). Best effort drops it and moves on, so sensor data stays fresh on lossy Wi-Fi.'],
  ['More platforms', 'The same graph spans Linux, Windows and macOS computers, and microcontrollers through micro-ROS.'],
];
SCENES['why-ros2'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let auto = true, sel = 0, t0 = 0;
  const btns = WHY.map(([n], i) => u.button(n, () => pick(i, true), i === 0));
  const autoBtn = u.button('auto', b => { auto = !auto; b.classList.toggle('on', auto); }, true);
  u.row(...btns, autoBtn);
  const out = u.readout();
  u.text('<b>ROS 1 reached end of life in May 2025.</b> New projects should start on ROS 2. Click a reason, or let auto cycle through all four.');
  let now = 0;
  function pick(i, manual) { sel = i; t0 = now; btns.forEach((b, k) => b.classList.toggle('on', k === i)); if (manual) { auto = false; autoBtn.classList.remove('on'); } out.innerHTML = `<b>${String(i + 1).padStart(2, '0')} · ${WHY[i][0]}</b><br>${WHY[i][1]}`; }
  pick(0);
  const CYC = 9;
  const node = (ctx, x, y, name, c, dead, fs) => { ctx.globalAlpha = dead ? .3 : 1; ctx.fillStyle = '#11182c'; ctx.strokeStyle = dead ? CSS.pink : c; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, fs * 4.6, fs * 1.6, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = CSS.ink; ctx.font = mono(fs); ctx.textAlign = 'center'; ctx.fillText(name, x, y + fs * .35); ctx.globalAlpha = 1; if (dead) { ctx.strokeStyle = CSS.pink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 9, y - 9); ctx.lineTo(x + 9, y + 9); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x - 9, y + 9); ctx.stroke(); } };
  const line = (ctx, a, b, c, dash, wdt = 1.5) => { ctx.strokeStyle = c; ctx.lineWidth = wdt; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); ctx.setLineDash([]); };
  const moving = (ctx, a, b, f, c, r = 4) => dot(ctx, lerp(a[0], b[0], f), lerp(a[1], b[1], f), r, c);
  return { canvas, update(t) {
    now = t;
    if (auto && t - t0 > CYC) pick((sel + 1) % 4);
    const lt = t - t0, ph = (lt % CYC) / CYC;
    const { ctx, w, h } = fit2d(canvas); ctx.clearRect(0, 0, w, h);
    const fs = w < 520 ? 8.5 : 11, half = w / 2;
    if (sel !== 3) {
      ctx.strokeStyle = CSS.line; ctx.beginPath(); ctx.moveTo(half, 34); ctx.lineTo(half, h - 10); ctx.stroke();
      ctx.font = sans(fs + 4, 700); ctx.textAlign = 'center'; ctx.fillStyle = CSS.orange; ctx.fillText(sel === 2 ? 'Reliable' : 'ROS 1', half / 2, 24); ctx.fillStyle = CSS.cyan; ctx.fillText(sel === 2 ? 'Best effort' : 'ROS 2', half * 1.5, 24);
    }
    const msg = (text, x, y, c = CSS.muted) => { ctx.fillStyle = c; ctx.font = mono(fs); ctx.textAlign = 'center'; ctx.fillText(text, x, y); };
    if (sel === 0) {
      const dead = ph > .35, late = ph > .55;
      // ROS 1: star around the master
      const m = [half / 2, h * .45], ns = [[half * .2, h * .2], [half * .8, h * .2], [half * .2, h * .72], [half * .8, h * .72]], names = ['/camera', '/detector', '/planner', '/motors'];
      ns.forEach(p => line(ctx, p, m, dead ? 'rgba(255,114,159,.3)' : 'rgba(255,177,90,.45)', [3, 4]));
      line(ctx, ns[0], ns[1], 'rgba(255,255,255,.25)'); moving(ctx, ns[0], ns[1], (lt * .8) % 1, CSS.orange);
      if (!dead) ns.forEach((p, i) => moving(ctx, p, m, ((lt * .5 + i * .25) % 1), 'rgba(255,177,90,.8)', 2.5));
      node(ctx, ...m, 'roscore', CSS.orange, dead, fs);
      ns.forEach((p, i) => node(ctx, ...p, names[i], CSS.orange, false, fs));
      if (late) { const nn = [half / 2, h * .86]; node(ctx, ...nn, '/logger', CSS.orange, false, fs); msg('waiting for master…', nn[0], nn[1] - fs * 2.6, CSS.pink); }
      msg(dead ? 'master down: old link works,' : 'every node registers', half / 2, h - 22, dead ? CSS.pink : CSS.muted); msg(dead ? 'no new links can form' : 'with the master', half / 2, h - 7, dead ? CSS.pink : CSS.muted);
      // ROS 2: mesh, discovery
      const ms = [[half * 1.2, h * .2], [half * 1.8, h * .2], [half * 1.2, h * .72], [half * 1.8, h * .72]];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (!(dead && (i === 3 || j === 3))) line(ctx, ms[i], ms[j], 'rgba(88,224,210,.25)', [3, 4]);
      moving(ctx, ms[0], ms[1], (lt * .8) % 1, CSS.cyan); moving(ctx, ms[1], ms[2], (lt * .8 + .5) % 1, CSS.cyan);
      ms.forEach((p, i) => node(ctx, ...p, names[i], CSS.cyan, dead && i === 3, fs));
      if (late) { const nn = [half * 1.5, h * .86]; const k = clamp((ph - .55) / .1, 0, 1); ctx.strokeStyle = CSS.cyan; ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(...nn, 10 + k * 90, 0, 7); ctx.stroke(); ctx.globalAlpha = 1; if (ph > .65) { line(ctx, nn, ms[1], 'rgba(88,224,210,.5)'); moving(ctx, ms[1], nn, (lt * .8) % 1, CSS.cyan); } node(ctx, ...nn, '/logger', CSS.cyan, false, fs); }
      msg(dead ? 'one node stops, the rest carry on,' : 'no master: nodes find', half * 1.5, h - 22, dead ? CSS.cyan : CSS.muted); msg(dead ? 'and /logger joins by discovery' : 'each other directly', half * 1.5, h - 7, dead ? CSS.cyan : CSS.muted);
    } else if (sel === 1) {
      // ROS 1 side: a node that starts in any order and plain-text traffic
      const a = [half * .25, h * .32], b = [half * .75, h * .32];
      node(ctx, ...a, '/driver', CSS.orange, false, fs); node(ctx, ...b, '/planner', CSS.orange, false, fs);
      line(ctx, a, b, 'rgba(255,177,90,.4)'); const f = (lt * .6) % 1; ctx.fillStyle = CSS.orange; ctx.font = mono(fs); ctx.textAlign = 'center'; ctx.fillText('{x: 1.2}', lerp(a[0] + 30, b[0] - 30, f), a[1] - 16);
      msg('plain traffic, anyone on the network can read it', half / 2, h * .32 + 34);
      msg('nodes start in whatever order they start', half / 2, h * .62);
      msg('ROS 1 ended: May 2025', half / 2, h * .82, CSS.pink);
      // ROS 2 side: lifecycle states, encrypted traffic, LTS bar
      const ST = ['unconfigured', 'inactive', 'active'], k = Math.min(2, Math.floor(ph * 3.3)), sx = i => half + half * (.18 + i * .32);
      ST.forEach((s2, i) => { ctx.fillStyle = i === k ? 'rgba(88,224,210,.18)' : '#11182c'; ctx.strokeStyle = i <= k ? CSS.cyan : CSS.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(sx(i) - half * .14, h * .18, half * .28, 30, 15); ctx.fill(); ctx.stroke(); msg(s2, sx(i), h * .18 + 19, i === k ? CSS.cyan : CSS.ink); if (i < 2) arrowTo(ctx, sx(i) + half * .14, h * .18 + 15, sx(i + 1) - half * .14, h * .18 + 15, i < k ? CSS.cyan : CSS.muted, 1.5, 5); });
      msg(['starts unconfigured: nothing runs yet', 'configured: parameters loaded, not publishing', 'activated: publishing, in a known order'][k], half * 1.5, h * .18 + 50, CSS.cyan);
      const a2 = [half * 1.25, h * .5], b2 = [half * 1.75, h * .5]; line(ctx, a2, b2, 'rgba(88,224,210,.4)');
      const g = (lt * .6) % 1; ctx.fillStyle = CSS.cyan; ctx.font = mono(fs); ctx.textAlign = 'center'; ctx.fillText('🔒 9f2c…', lerp(a2[0], b2[0], g), a2[1] - 10);
      msg('SROS2: encrypted and authenticated', half * 1.5, a2[1] + 22);
      const by = h * .76, x0 = half * 1.1, x1 = half * 1.9, yr = [2024, 2029], fx = yv => lerp(x0, x1, (yv - yr[0]) / (yr[1] - yr[0]));
      ctx.fillStyle = 'rgba(88,224,210,.25)'; ctx.fillRect(x0, by, (x1 - x0) * Math.min(1, ph * 1.4), 12); ctx.strokeStyle = CSS.cyan; ctx.strokeRect(x0, by, x1 - x0, 12);
      [2024, 2026, 2029].forEach(yv => msg(String(yv), fx(yv), by + 28)); ctx.strokeStyle = CSS.orange; ctx.beginPath(); ctx.moveTo(fx(2026.8), by - 4); ctx.lineTo(fx(2026.8), by + 16); ctx.stroke();
      msg('Jazzy LTS: May 2024 – May 2029 · today', half * 1.5, by - 10, CSS.cyan);
    } else if (sel === 2) {
      // a lossy link: every third message is lost
      for (const [side, reliable] of [[0, true], [1, false]]) {
        const x0 = half * side + half * .15, x1 = half * side + half * .85, y = h * .42, c = reliable ? CSS.orange : CSS.cyan;
        node(ctx, x0, y - 60, 'pub', c, false, fs); node(ctx, x1, y - 60, 'sub', c, false, fs);
        ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.setLineDash([]);
        msg('lossy Wi-Fi', (x0 + x1) / 2, y + 18);
        const rate = 1.4, recv = [];
        for (let k = Math.floor(lt * rate) - 6; k <= Math.floor(lt * rate); k++) {
          if (k < 0) continue;
          const lost = k % 3 === 1, age = lt - k / rate, dur = 1.6;
          if (lost) {
            const f = age / dur;
            if (f < .5) moving(ctx, [x0, y], [x1, y], f, c, 6); else if (f < .62) { ctx.strokeStyle = CSS.pink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(lerp(x0, x1, .5), y, 6 + (f - .5) * 120, 0, 7); ctx.stroke(); }
            if (reliable) { const f2 = (age - dur * .7) / dur; if (f2 > 0 && f2 < 1) { moving(ctx, [x0, y], [x1, y], f2, c, 6); ctx.fillStyle = c; ctx.font = mono(fs); ctx.fillText('resend', lerp(x0, x1, f2), y - 12); } if (f2 >= 1) recv.push([k, age - dur * 1.7]); }
          } else { const f = age / dur; if (f < 1) moving(ctx, [x0, y], [x1, y], f, c, 6); else recv.push([k, age - dur]); }
        }
        const lastOk = recv.sort((a, b) => b[0] - a[0])[0];
        msg(lastOk ? `last received: #${lastOk[0]}` : 'waiting…', x1, y - 84, c);
        msg(reliable ? 'every message arrives, some late' : 'lost ones are skipped: always fresh', (x0 + x1) / 2, h * .7, c);
        msg(reliable ? 'use for commands, maps, goals' : 'use for camera, lidar, IMU', (x0 + x1) / 2, h * .7 + 18);
      }
    } else {
      // one graph across platforms
      const P = [['Linux', 'Ubuntu 24.04', [w * .2, h * .25]], ['Windows', 'Windows 10', [w * .8, h * .25]], ['macOS', 'from source', [w * .2, h * .72]], ['micro-ROS', 'microcontroller', [w * .8, h * .72]]];
      const c0 = [w / 2, h * .48];
      ctx.strokeStyle = 'rgba(88,224,210,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(...c0, w * .14, h * .1, 0, 0, 7); ctx.stroke();
      msg('one ROS 2 graph', c0[0], c0[1] + 4, CSS.cyan);
      P.forEach(([n, sub, p], i) => {
        line(ctx, p, c0, 'rgba(88,224,210,.3)', [3, 4]);
        moving(ctx, p, c0, (lt * .5 + i * .25) % 1, [CSS.cyan, CSS.blue, CSS.orange, CSS.pink][i]); moving(ctx, c0, p, (lt * .5 + i * .25 + .5) % 1, [CSS.cyan, CSS.blue, CSS.orange, CSS.pink][i], 3);
        ctx.fillStyle = '#11182c'; ctx.strokeStyle = [CSS.cyan, CSS.blue, CSS.orange, CSS.pink][i]; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(p[0] - w * .12, p[1] - 24, w * .24, 48, 8); ctx.fill(); ctx.stroke();
        ctx.fillStyle = CSS.ink; ctx.font = sans(fs + 3, 700); ctx.textAlign = 'center'; ctx.fillText(n, p[0], p[1] - 2); msg(sub, p[0], p[1] + 14);
      });
      msg('Jazzy Tier 1: Ubuntu 24.04 and Windows 10 · macOS builds from source', w / 2, h - 8);
    }
    ctx.textAlign = 'left';
  } };
};

// ---------- Day 2 and Day 3 · the overhead RealSense: one synthetic image, computed from the cell ----------
// The simulated D435 (gazebo.xacro): 640 × 480, 1.204 rad horizontal field of view, so fx = fy = 320 / tan(0.602) ≈ 465,
// mounted at (0.40, 0, 1.0) looking straight down. Optical frame: image right = world -y, image down = world -x.
const CAM = { fx: 320 / Math.tan(1.204 / 2), cx: 320, cy: 240, W: 640, H: 480, x: .4, z: 1.0, step: 4 };
const camToWorld = (xo, yo, zo) => [CAM.x - yo, -xo, CAM.z - zo];
const pixToCam = (u, v, zo) => [(u - CAM.cx) * zo / CAM.fx, (v - CAM.cy) * zo / CAM.fx, zo];
// What the camera sees, as flat tops at a height (highest first). The arm is parked at home: its forearm lies over x 0..0.25.
const CAM_WORLD = [
  { name: 'arm (orange forearm)', x: [0, .25], y: [-.02, .02], top: .44, rgb: [232, 137, 44] },
  { name: 'arm (black upper arm)', x: [-.025, .025], y: [-.025, .025], top: .58, rgb: [38, 42, 53] },
  { name: 'red box', x: [.34, .38], y: [.08, .12], top: .14, rgb: [229, 72, 77] },
  { name: 'blue box', x: [.46, .50], y: [-.06, -.02], top: .14, rgb: [63, 127, 224] },
  { name: 'tray', x: [.22, .34], y: [-.26, -.14], top: .104, rgb: [100, 190, 105] },
  { name: 'table', x: [.15, .65], y: [-.3, .3], top: .10, rgb: [70, 82, 118] },
];
let camImg;
function cameraImage() {   // low resolution (160 × 120): colour, depth and what each pixel belongs to
  if (camImg) return camImg;
  const w = CAM.W / CAM.step, h = CAM.H / CAM.step, rgb = new Uint8ClampedArray(w * h * 3), depth = new Float32Array(w * h), who = new Int8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const u = (i + .5) * CAM.step, v = (j + .5) * CAM.step, k = j * w + i;
    let hit = -1;
    for (let o = 0; o < CAM_WORLD.length && hit < 0; o++) { const ob = CAM_WORLD[o], [x, y] = camToWorld(...pixToCam(u, v, CAM.z - ob.top)); if (x >= ob.x[0] && x <= ob.x[1] && y >= ob.y[0] && y <= ob.y[1]) hit = o; }
    const top = hit >= 0 ? CAM_WORLD[hit].top : 0, c = hit >= 0 ? CAM_WORLD[hit].rgb : [22, 27, 42];
    const shade = .92 + .08 * Math.sin(i * 1.7 + j * 2.3);   // a little texture
    rgb.set(c.map(x => x * shade), k * 3); depth[k] = CAM.z - top; who[k] = hit;
  }
  return (camImg = { w, h, rgb, depth, who });
}
function hsvCV(r, g, b) {   // OpenCV's HSV: H 0-180, S and V 0-255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hh = 0;
  if (d) hh = mx === r ? 60 * (((g - b) / d) % 6) : mx === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (hh < 0) hh += 360;
  return [hh / 2, mx ? d / mx * 255 : 0, mx];
}
function redMask(hMax) {   // params.yaml: red is H 0..10 or 170..180, S ≥ 120, V ≥ 70; hMax replaces the 10
  const im = cameraImage(), m = new Uint8Array(im.w * im.h);
  for (let k = 0; k < m.length; k++) { const [H, S, V] = hsvCV(im.rgb[k * 3], im.rgb[k * 3 + 1], im.rgb[k * 3 + 2]); m[k] = (H <= hMax || H >= 170) && S >= 120 && V >= 70 ? 1 : 0; }
  return m;
}
function largestBlob(m, w, h) {   // 4-connected components; the biggest one, with its centre and box
  const seen = new Uint8Array(m.length); let best = null;
  for (let k0 = 0; k0 < m.length; k0++) {
    if (!m[k0] || seen[k0]) continue;
    const stack = [k0], pix = []; seen[k0] = 1;
    while (stack.length) { const k = stack.pop(), i = k % w, j = (k - i) / w; pix.push(k);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj, kk = jj * w + ii; if (ii >= 0 && ii < w && jj >= 0 && jj < h && m[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); } } }
    if (!best || pix.length > best.pix.length) best = { pix };
  }
  if (!best) return null;
  let su = 0, sv = 0, u0 = 1e9, v0 = 1e9, u1 = -1, v1 = -1;
  for (const k of best.pix) { const i = k % w, j = (k - i) / w; su += i; sv += j; u0 = Math.min(u0, i); v0 = Math.min(v0, j); u1 = Math.max(u1, i); v1 = Math.max(v1, j); }
  const n = best.pix.length, S = CAM.step;
  return { area: n * S * S, u: (su / n + .5) * S, v: (sv / n + .5) * S, box: [u0 * S, v0 * S, (u1 + 1) * S, (v1 + 1) * S], k: best.pix[Math.floor(n / 2)] };
}
function drawCamImage(ctx, x, y, w, h, mode, { mask, blob, hMax } = {}) {
  const im = cameraImage(), off = drawCamImage.off ??= document.createElement('canvas'); off.width = im.w; off.height = im.h;
  const oc = off.getContext('2d'), data = oc.createImageData(im.w, im.h);
  for (let k = 0; k < im.w * im.h; k++) {
    let c;
    if (mode === 'mask') c = mask[k] ? [255, 255, 255] : [10, 12, 20];
    // depth: colour over the table's depth band (0.8–1.0 m) so the boxes stand out; near is yellow, far is dark blue
    else if (mode === 'depth') { const d = clamp((im.depth[k] - .8) / (1.0 - .8), 0, 1); c = [255 * (1 - d) + 20 * d, 200 * (1 - d) * (1 - d) + 40 * d, 60 + 140 * d]; }   // near: yellow, far: dark blue
    else c = [im.rgb[k * 3], im.rgb[k * 3 + 1], im.rgb[k * 3 + 2]];
    data.data.set([...c, 255], k * 4);
  }
  oc.putImageData(data, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(off, x, y, w, h);
  ctx.strokeStyle = CSS.line; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
  const sx = w / CAM.W, sy = h / CAM.H;
  if (blob) {
    const [u0, v0, u1, v1] = blob.box; ctx.strokeStyle = CSS.cyan; ctx.lineWidth = 2; ctx.strokeRect(x + u0 * sx, y + v0 * sy, (u1 - u0) * sx, (v1 - v0) * sy);
    const px = x + blob.u * sx, py = y + blob.v * sy; ctx.strokeStyle = CSS.ink; ctx.beginPath(); ctx.moveTo(px - 9, py); ctx.lineTo(px + 9, py); ctx.moveTo(px, py - 9); ctx.lineTo(px, py + 9); ctx.stroke();
  }
  void hMax;
}

// ---------- Day 2 · Sensors: what a depth camera publishes ----------
SCENES['camera-data'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  let showFrame = true;
  u.row(u.button('optical frame', b => { showFrame = !showFrame; b.classList.toggle('on', showFrame); }, true));
  const out = u.readout();
  u.text('Colour and depth are <b>aligned</b>: the same pixel (u, v) in both images is the same point on the table. That is what makes pixels → 3D possible on Day 3.');
  const fx = CAM.fx.toFixed(1);
  out.innerHTML = `<b>/camera/camera/color/image_raw</b> sensor_msgs/msg/Image · 640 × 480 · 30 Hz<br><b>/camera/camera/aligned_depth_to_color/image_raw</b> Image, metres per pixel<br><b>/camera/camera/color/camera_info</b> CameraInfo: k = [${fx}, 0, 320, 0, ${fx}, 240, 0, 0, 1]<br><b>/camera/camera/depth/color/points</b> sensor_msgs/msg/PointCloud2`;
  const im = cameraImage();
  return { canvas, update(t) {
    const { ctx, w, h } = fitMin(canvas, 640);
    const gap = 12, pw = (w - 3 * gap) / 2, ph = pw * .75, top = 30;
    say(ctx, 'colour image', 12, top - 8, CSS.ink, 12, 'left'); drawCamImage(ctx, gap, top, pw, ph, 'colour');
    say(ctx, 'depth image (near = warm)', 2 * gap + pw, top - 8, CSS.ink, 12, 'left'); drawCamImage(ctx, 2 * gap + pw, top, pw, ph, 'depth');
    if (showFrame) {   // optical frame: x right, y down, z into the image
      const ox = gap + 24, oy = top + 24; arrowTo(ctx, ox, oy, ox + 46, oy, CSS.pink, 2); arrowTo(ctx, ox, oy, ox, oy + 46, CSS.green, 2);
      ctx.strokeStyle = CSS.blue; ctx.beginPath(); ctx.arc(ox, oy, 5, 0, 7); ctx.stroke(); dot(ctx, ox, oy, 1.6, CSS.blue);
      say(ctx, 'x', ox + 52, oy + 4, CSS.pink, 11); say(ctx, 'y', ox + 4, oy + 60, CSS.green, 11, 'left'); say(ctx, 'z (into the image)', ox + 10, oy - 9, CSS.blue, 10, 'left');
    }
    // the point cloud, seen from the side: every pixel back-projected, world x along, height up
    const cy = top + ph + 34, ch = h - cy - 14;
    say(ctx, 'point cloud, seen from the side (x forward →, height ↑)', 12, cy - 8, CSS.ink, 12, 'left');
    ctx.strokeStyle = CSS.line; ctx.strokeRect(gap + .5, cy + .5, w - 2 * gap - 1, ch);
    const X = x => gap + 10 + (x + .1) / .85 * (w - 2 * gap - 20), Y = z => cy + ch - 8 - z / .65 * (ch - 16);
    const sweep = Math.min(1, (t * .6) % 2.4);   // fill in row by row, then hold
    for (let k = 0; k < im.w * im.h; k += 3) {
      const i = k % im.w, j = (k - i) / im.w, [x, , z] = camToWorld(...pixToCam((i + .5) * CAM.step, (j + .5) * CAM.step, im.depth[k]));
      if (j / im.h > sweep + .02) continue;
      ctx.fillStyle = `rgb(${im.rgb[k * 3]},${im.rgb[k * 3 + 1]},${im.rgb[k * 3 + 2]})`; ctx.fillRect(X(x), Y(z), 2, 2);
    }
    dot(ctx, X(CAM.x), Y(.62), 5, CSS.cyan); say(ctx, 'camera ↓ (1.0 m)', X(CAM.x) + 10, Y(.62) + 4, CSS.cyan, 10, 'left');
  } };
};

// ---------- Day 3 · Perception: from pixels to a pose, as object_detector.py does it ----------
SCENES['pixels-to-pose'] = async (panel) => {
  const canvas = document.createElement('canvas');
  const u = ui(panel);
  const STEPS = ['colour image', 'HSV mask', 'largest blob', 'depth at the centre', 'back-project', 'into the world frame'];
  let stage = 0, auto = true, hMax = 10;
  const btns = STEPS.map((n, i) => u.button(`${i + 1} ${n}`, () => { stage = i; auto = false; autoBtn.classList.remove('on'); }, i === 0));
  u.row(...btns);
  const autoBtn = u.button('auto', b => { auto = !auto; b.classList.toggle('on', auto); }, true); u.row(autoBtn);
  u.slider('red: H up to', 2, 30, 1, hMax, v => (hMax = v), v => `${(+v).toFixed(0)}`);
  const out = u.readout();
  u.text('Drag the hue limit past 15: the orange arm joins the mask, the biggest blob is now the arm, and the "red box" lands in the wrong place. That is why <code>params.yaml</code> keeps red tight.');
  const im = cameraImage();
  return { canvas, update(t) {
    if (auto) stage = Math.floor(t / 3.2) % STEPS.length;
    btns.forEach((b, i) => b.classList.toggle('on', i === stage));
    const mask = redMask(hMax), blob = largestBlob(mask, im.w, im.h);
    const { ctx, w, h } = fitMin(canvas, 600);
    const iw = Math.min(w - 24, (h - 120) / .75), ih = iw * .75, ix = (w - iw) / 2, iy = 34;
    say(ctx, `${stage + 1} · ${STEPS[stage]}`, 12, 22, CSS.ink, 13, 'left');
    drawCamImage(ctx, ix, iy, iw, ih, stage === 1 || stage === 2 ? 'mask' : stage === 3 ? 'depth' : 'colour', { mask, blob: stage >= 2 ? blob : null });
    const fy = iy + ih + 22; ctx.font = mono(12); ctx.fillStyle = CSS.ink;
    if (!blob) { out.innerHTML = '<b>no red pixels</b> in the mask'; return; }
    const z = im.depth[blob.k], [xo, yo] = pixToCam(blob.u, blob.v, z), [wx, wy, wz] = camToWorld(xo, yo, z), wrong = im.who[blob.k] !== 2;
    const lines = [
      'cv2.cvtColor(image, cv2.COLOR_BGR2HSV): hue, saturation, value per pixel',
      `cv2.inRange: H 0–${hMax} or 170–180, S ≥ 120, V ≥ 70 → white pixels`,
      `largest contour: ${blob.area} px, centre (u, v) = (${blob.u.toFixed(0)}, ${blob.v.toFixed(0)})`,
      `median depth around (u, v): z = ${z.toFixed(3)} m`,
      `x = (u − cx)·z / fx = ${xo.toFixed(3)} m   y = (v − cy)·z / fy = ${yo.toFixed(3)} m`,
      `tf2 → world: (${wx.toFixed(2)}, ${wy.toFixed(2)}, ${(wz - .02).toFixed(2)}) after half a box down`];
    say(ctx, lines[stage], w / 2, fy, wrong && stage >= 2 ? CSS.pink : CSS.ink, 12);
    out.innerHTML = `<b>/detections/red</b> ${wrong ? '<span style="color:#ff729f">wrong blob: the orange arm</span>' : `(${wx.toFixed(2)}, ${wy.toFixed(2)}, ${(wz - .02).toFixed(2)})`}<br><b>truth</b> (0.36, 0.10, 0.12) in worlds/table.sdf<br><b>intrinsics</b> fx = fy = ${CAM.fx.toFixed(1)}, cx = 320, cy = 240`;
  } };
};

// ---------- Day 3 · Perception: the camera builds an occupancy map, MoveIt plans around it ----------
SCENES['octomap'] = async (panel) => {
  const s = base3d({ cam: [1.3, 1.0, -1.05], target: [.32, .26, 0], grid: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshStandardMaterial({ color: 0x141b2e })); s.world.add(floor);
  const arm = demoArm(), cell = demoCell(s.world); s.world.add(arm.root);
  const OB = { x: .42, y: -.1, w: .06, hgt: .22 };   // a bottle the planner was never told about
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(OB.w / 2, OB.w / 2, OB.hgt, 24), new THREE.MeshStandardMaterial({ color: 0xc9d1e3, roughness: .3 }));
  bottle.rotation.x = Math.PI / 2; bottle.position.set(OB.x, OB.y, DA_TABLE_TOP + OB.hgt / 2); s.world.add(bottle);
  const bl = label('unknown obstacle', 'warn'); bl.position.set(OB.x, OB.y, DA_TABLE_TOP + OB.hgt + .05); s.world.add(bl);
  // voxels at 2 cm (MoveIt uses 1 cm here), from the camera's view: tops of the table, boxes and the obstacle
  const V = .02, cells = [];
  for (let x = .16; x < .65; x += V) for (let y = -.29; y < .3; y += V) {
    let top = DA_TABLE_TOP;
    if (Math.hypot(x - OB.x, y - OB.y) < OB.w / 2 + .005) { for (let z = DA_TABLE_TOP + V / 2; z < DA_TABLE_TOP + OB.hgt; z += V) cells.push([x, y, z, 1]); continue; }
    for (const [bx, by] of Object.values(DA_BOXES)) if (Math.abs(x - bx) < .025 && Math.abs(y - by) < .025) top = DA_TABLE_TOP + DA_BOX;
    cells.push([x, y, top - V / 2, top > DA_TABLE_TOP ? 2 : 0]);
  }
  const vox = new THREE.InstancedMesh(new THREE.BoxGeometry(V * .92, V * .92, V * .92), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: .8 }), cells.length);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  cells.forEach(([x, y, z, k], i) => { m4.makeTranslation(x, y, z); vox.setMatrixAt(i, m4); vox.setColorAt(i, col.set(k === 1 ? C.orange : k === 2 ? C.cyan : 0x9aa8d0)); });
  s.world.add(vox);
  const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: C.blue, dashSize: .02, gapSize: .014 })); path.frustumCulled = false; s.world.add(path);
  const u = ui(panel);
  let vision = true;
  const vb = u.button('3D vision on', b => { vision = !vision; b.textContent = vision ? '3D vision on' : '3D vision off'; b.classList.toggle('on', vision); }, true); u.row(vb);
  const out = u.readout(), flash = u.text('', 'scene-flash');
  u.text('<code>realsense_octomap.yaml</code>: the point cloud on <code>/camera/camera/depth/color/points</code> fills an OctoMap in the planning scene, 1 cm voxels, at most 2 updates a second. Points on the robot itself are filtered out first.');
  // move the hand from above the red box to above the tray: straight across without vision, over the obstacle with it
  const A = [.36, .1, .26], Bp = [.28, -.2, .26];
  const pts = (over) => { const out = []; for (let k = 0; k <= 40; k++) { const f = k / 40, x = lerp(A[0], Bp[0], f), y = lerp(A[1], Bp[1], f), lift = over ? .2 * Math.sin(Math.PI * f) : 0; out.push([x, y, A[2] + lift]); } return out; };
  const tmp = new THREE.Vector3();
  return { ...s, update(t) {
    vox.visible = vision;
    const P = pts(vision), f = (t % 6) / 4, k = Math.min(40, Math.floor(clamp(f, 0, 1) * 40)), q = demoArmIK(P[k]);
    arm.set(q, DA_OPEN);
    path.geometry.setFromPoints(P.map(p => tmp.set(...p).clone())); path.computeLineDistances(); path.material.color.set(vision ? C.blue : C.pink);
    s.scene.updateMatrixWorld(true); arm.links.tool.getWorldPosition(tmp); s.world.worldToLocal(tmp);
    const hit = !vision && Math.hypot(tmp.x - OB.x, tmp.y - OB.y) < OB.w / 2 + .03;
    glow(bottle, C.pink, hit ? .8 : 0);
    flash.textContent = vision ? 'the plan goes over the obstacle the camera saw' : hit ? 'collision: MoveIt did not know the obstacle was there' : 'without 3D vision, the planning scene has only the table';
    flash.classList.toggle('bad', !vision);
    out.innerHTML = `<b>planning scene</b> table${vision ? ' + OctoMap (' + cells.length + ' voxels shown)' : ' only'}<br><b>path</b> ${vision ? 'lifted 20 cm over the obstacle' : 'straight through it'}`;
  } };
};

// ---------- Cover: a TurtleBot3 brings a cube, the Panda hands it on, and back ----------
SCENES['hero'] = async () => {
  const s = base3d({ cam: [2.2, 1.45, 1.75], target: [.3, .2, -.42], grid: 0 });
  s.scene.background = null;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.9, 64), new THREE.MeshBasicMaterial({ color: C.cyan, transparent: true, opacity: .05 }));
  s.world.add(floor);
  const grid = new THREE.PolarGridHelper(1.9, 12, 6, 64, C.cyan, 0x24304f); grid.material.transparent = true; grid.material.opacity = .25; grid.rotation.x = Math.PI / 2; s.world.add(grid);
  const r = await panda(), bot = await turtlebot(), K = await ik();
  const pedestal = box(.22, .22, .02, 0x2a3350); pedestal.position.z = -.01; s.world.add(r, pedestal);
  const table = box(.3, .3, .2, 0x2a3350); table.position.set(.45, -.32, .1); s.world.add(table);
  const pad = box(.08, .08, .003, C.green, .7); pad.position.set(.45, -.32, .201); s.world.add(pad);
  s.world.add(bot);
  const cubeMat = new THREE.MeshStandardMaterial({ color: C.orange, emissive: 0x3a2200 }), cube = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .05), cubeMat);
  // the robot's loop: a circle that touches the dock beside the arm
  const DOCK = [.55, .3], RAD = .45, CEN = [DOCK[0], DOCK[1] + RAD];
  const onLoop = u => { const a = -Math.PI / 2 + u * 2 * Math.PI; return [CEN[0] + RAD * Math.cos(a), CEN[1] + RAD * Math.sin(a), a + Math.PI / 2]; };
  const TOP = .215, TCP = .105;   // cube centre on top of the lidar; hand frame to fingertip centre
  const ON_BOT = [DOCK[0], DOCK[1], TOP], ON_TABLE = [.45, -.32, .226];
  const above = (p, dz) => K.down([p[0], p[1], p[2] + TCP + dz]);
  const seq = (from, to) => { let q = HOME; const poses = [above(from, .12), above(from, 0), above(from, .14), above(to, .14), above(to, 0), above(to, .12)]; return poses.map(P => (q = K.solveIK(P, q, { iters: 200 }).q)); };
  const OPEN = .04, SHUT = .025;
  const arm = (from, to) => { const [a, g, l, b, p, rt] = seq(from, to); return [[HOME, OPEN, .8], [a, OPEN, 1.2], [g, OPEN, .9], [g, SHUT, .5, 'grab'], [l, SHUT, .8], [b, SHUT, 1.4], [p, SHUT, .9], [p, OPEN, .5, 'drop'], [rt, OPEN, .8], [HOME, OPEN, 1.1]]; };
  const PICK = arm(ON_BOT, ON_TABLE), GIVE = arm(ON_TABLE, ON_BOT), armT = a => a.reduce((x, k) => x + k[2], 0);
  const DRIVE = 8;   // one loop at about 0.35 m/s, a little quicker than a real Burger
  const PHASES = [['drive', DRIVE], ['arm', armT(PICK), PICK], ['drive', DRIVE], ['arm', armT(GIVE), GIVE]];
  const CYCLE = PHASES.reduce((x, p) => x + p[1], 0);
  // lidar pings and the message between the two robots
  const ping = new THREE.Mesh(new THREE.RingGeometry(.1, .112, 48), new THREE.MeshBasicMaterial({ color: C.pink, transparent: true, side: THREE.DoubleSide }));
  s.world.add(ping);
  const msg = new THREE.Mesh(new THREE.SphereGeometry(.018, 16, 12), new THREE.MeshBasicMaterial({ color: C.cyan }));
  const link = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: C.cyan, dashSize: .03, gapSize: .025, transparent: true, opacity: .6 }));
  link.frustumCulled = false; s.world.add(msg, link);
  const place = (obj, p) => { if (obj.parent !== s.world) s.world.attach(obj); obj.position.set(...p); obj.rotation.set(0, 0, 0); };
  let holder = '';
  const hold = who => {
    if (holder === who) return; holder = who;
    s.scene.updateMatrixWorld(true);
    if (who === 'hand') r.links.panda_hand.attach(cube);
    else if (who === 'bot') { place(cube, ON_BOT); bot.attach(cube); }
    else place(cube, ON_TABLE);
  };
  const hand = new THREE.Vector3(), botTop = new THREE.Vector3();
  // sway the view gently instead of spinning: both robots stay in frame
  return { ...s, sway: { amplitude: .42, period: 26 }, reset() { holder = ''; }, update(t) {
    let tc = t % CYCLE, i = 0; while (tc > PHASES[i][1]) tc -= PHASES[i++][1];
    const [kind, dur, steps] = PHASES[i];
    // the robot
    const u = kind === 'drive' ? smooth(tc / dur) : 0, pose = onLoop(u);
    bot.position.set(pose[0], pose[1], 0); bot.rotation.set(0, 0, pose[2]);
    const roll = (Math.floor(t / CYCLE) * 2 + (i >= 2 ? 1 : 0) + u) * 2 * Math.PI * RAD / .033;
    bot.joints.wheel_left_joint.setJointValue(roll); bot.joints.wheel_right_joint.setJointValue(roll);
    // who holds the cube: on the robot while it drives in phase 0, on the table while it drives in phase 2
    if (kind === 'drive') hold(i === 0 ? 'bot' : 'table');
    // the arm
    let q = HOME, f = 0, grip = OPEN;
    if (kind === 'arm') {
      let k = 0, x = tc; while (k < steps.length - 1 && x > steps[k][2]) x -= steps[k++][2];
      const prev = k ? steps[k - 1] : steps[steps.length - 1]; f = smooth(clamp(x / steps[k][2], 0, 1));
      q = prev[0].map((v, j) => lerp(v, steps[k][0][j], f)); grip = lerp(prev[1], steps[k][1], f);
      const grabbed = steps.slice(0, k + 1).some(st => st[3] === 'grab') && !(steps[k][3] === 'grab' && f < .8);
      const dropped = steps.slice(0, k + 1).some(st => st[3] === 'drop') && !(steps[k][3] === 'drop' && f < .5);
      setArm(r, q, grip);
      hold(dropped ? (steps === PICK ? 'table' : 'bot') : grabbed ? 'hand' : (steps === PICK ? 'bot' : 'table'));
    } else setArm(r, HOME, OPEN);
    // lidar ping every 0.2 s while driving
    const pp = (t % .2) / .2; ping.visible = kind === 'drive'; ping.position.set(pose[0], pose[1], .19); ping.scale.setScalar(1 + pp * 2); ping.material.opacity = .7 * (1 - pp);
    // a message from robot to arm on arrival, and back when the arm is done
    s.scene.updateMatrixWorld(true); bot.links.base_scan.getWorldPosition(botTop); s.world.worldToLocal(botTop);
    hand.set(0, 0, .35);
    const arriving = kind === 'arm' && tc < .8, leaving = kind === 'arm' && tc > dur - .9;
    link.visible = msg.visible = arriving || leaving;
    if (link.visible) {
      const a = arriving ? botTop : hand, b = arriving ? hand : botTop, m = arriving ? tc / .8 : (tc - (dur - .9)) / .9;
      msg.position.lerpVectors(a, b, smooth(clamp(m, 0, 1))); msg.position.z += Math.sin(Math.PI * clamp(m, 0, 1)) * .12;
      link.geometry.setFromPoints([a, b]); link.computeLineDistances();
    }
    cubeMat.emissive.setHex(holder === 'hand' ? 0x664000 : 0x3a2200);
  } };
};

// ======================================================================
// Engine: one renderer, mounted on the active slide's .scene3d.
// ======================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);   // scenes without a background (the cover) show the slide behind them
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
    if (inst.autoRotate || inst.sway) Object.assign(me.controls, { autoRotate: true, autoRotateSpeed: inst.autoRotate ?? 0, enableZoom: false, enablePan: false });
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
    if (inst.autoRotate || inst.sway) cur.controls.autoRotate = !isPaused();
    if (inst.sway) {   // OrbitControls turns 2π/60 · speed rad/s: a cosine speed gives a ±amplitude sine sway
      const { amplitude, period } = inst.sway;
      cur.controls.autoRotateSpeed = amplitude * 60 / period * Math.cos(2 * Math.PI * clock / period);
    }
    cur.controls.update();
    renderer.render(inst.scene, inst.camera);
    // CSS2DRenderer checks only a label's own flag, so hide labels that sit inside hidden groups too.
    const hidden = [];
    inst.scene.traverse(o => { if (o.isCSS2DObject && o.visible) for (let p = o.parent; p; p = p.parent) if (!p.visible) { o.visible = false; hidden.push(o); break; } });
    labels.render(inst.scene, inst.camera);
    hidden.forEach(o => (o.visible = true));
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
