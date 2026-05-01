'use strict';

// ═══════════════════════════════════════════════════════════════
//  POLY ARENA — Client Game Engine
//  Three.js r128 + Socket.io
// ═══════════════════════════════════════════════════════════════

// ── Globals ────────────────────────────────────────────────────
let scene, camera, renderer, socket;
let gunGroup, muzzleFlash;
let myId = null;
let myName = '';
let myHealth = 100;
let alive = true;
let gameStarted = false;
let pointerLocked = false;

// Other players: id -> { group, hittable[] }
const otherPlayers = {};

// Input state
const keys = {};
const mouse = { left: false };

// Camera orientation (Euler angles, applied manually for FPS)
let yaw = 0;
let pitch = 0;

// ── Constants ──────────────────────────────────────────────────
const MOVE_SPEED    = 9.5;   // units per second
const PLAYER_HEIGHT = 1.7;   // camera Y from ground
const MAP_HALF      = 29;    // arena half-extent (58 × 58 arena)
const FIRE_RATE     = 115;   // ms minimum between shots
const DAMAGE        = 20;    // hp per bullet
const BODY_Y        = 1.0;   // centre-Y of remote player models

// ── Timing ─────────────────────────────────────────────────────
let lastTime      = performance.now();
let lastShot      = 0;
let lastMoveSent  = 0;
let gunBobT       = 0;

// ── Collision boxes [{minX, maxX, minZ, maxZ}] ─────────────────
const colliders = [];

// ═══════════════════════════════════════════════════════════════
//  ENTRY — called by "PLAY" button
// ═══════════════════════════════════════════════════════════════
function startGame() {
  const inp = document.getElementById('name-input');
  myName = (inp.value.trim() || 'Player' + Math.floor(Math.random() * 9999)).substring(0, 16);
  document.getElementById('overlay').style.display = 'none';

  initRenderer();
  buildMap();
  buildGun();
  initSocket();
  initInput();

  gameStarted = true;
  requestAnimationFrame(gameLoop);
}

// ═══════════════════════════════════════════════════════════════
//  RENDERER + SCENE + CAMERA
// ═══════════════════════════════════════════════════════════════
function initRenderer() {
  const canvas = document.getElementById('game-canvas');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x7ab4cc);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x7ab4cc, 28, 75);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 160);
  camera.position.set(0, PLAYER_HEIGHT, 0);
  // Camera must be in scene for its children (gun) to render
  scene.add(camera);

  // ── Lighting ──
  scene.add(new THREE.AmbientLight(0xffeedd, 0.6));

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(50, 80, 40);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8899ff, 0.3);
  fill.position.set(-30, 15, -30);
  scene.add(fill);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ═══════════════════════════════════════════════════════════════
//  MATERIAL HELPERS
// ═══════════════════════════════════════════════════════════════
function lambertMat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function basicMat(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

// ═══════════════════════════════════════════════════════════════
//  MAP BUILDER
// ═══════════════════════════════════════════════════════════════
function addBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambertMat(color));
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

function addCollider(cx, cz, w, d, pad = 0.45) {
  colliders.push({
    minX: cx - w / 2 - pad,
    maxX: cx + w / 2 + pad,
    minZ: cz - d / 2 - pad,
    maxZ: cz + d / 2 + pad,
  });
}

function buildMap() {
  // ── Ground (subdivided for low-poly look) ──────────────────
  const gGeo = new THREE.PlaneGeometry(160, 160, 32, 32);
  const gPos = gGeo.attributes.position;
  for (let i = 0; i < gPos.count; i++) {
    const vx = gPos.getX(i);
    const vz = gPos.getY(i);                        // PlaneGeometry Y = Z before rotation
    const d  = Math.min(80 - Math.abs(vx), 80 - Math.abs(vz));
    if (d > 8) gPos.setZ(i, (Math.random() - 0.5) * 0.35);
  }
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, lambertMat(0x4a7a30));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ── Perimeter walls ────────────────────────────────────────
  const WC = 0x7a6858;   // wall colour
  const WH = 5.5;
  const WL = MAP_HALF * 2;
  addBox(WL + 2, WH, 1.2, WC, 0,         WH / 2,  MAP_HALF);  // S
  addBox(WL + 2, WH, 1.2, WC, 0,         WH / 2, -MAP_HALF);  // N
  addBox(1.2, WH, WL + 2, WC, -MAP_HALF, WH / 2,  0);          // W
  addBox(1.2, WH, WL + 2, WC,  MAP_HALF, WH / 2,  0);          // E

  // Perimeter colliders (inside surface only)
  addCollider(0,          MAP_HALF,  WL, 1.2, 0.7);
  addCollider(0,         -MAP_HALF,  WL, 1.2, 0.7);
  addCollider(-MAP_HALF,  0,         1.2, WL, 0.7);
  addCollider( MAP_HALF,  0,         1.2, WL, 0.7);

  // ── Interior obstacles ─────────────────────────────────────
  //  Format: [x, z, w, h, d, color]
  const obs = [
    // Central open-square structure
    [ 4.5,    0,   1,  3.5,  8,  0x8a7a9a],
    [-4.5,    0,   1,  3.5,  8,  0x8a7a9a],
    [   0,    4,   8,  3.5,  1,  0x8a7a9a],
    // (north side open for entry)

    // Corner towers
    [ 20,  20, 2.5,    5, 2.5, 0x5a7a8a],
    [-20,  20, 2.5,    5, 2.5, 0x5a7a8a],
    [ 20, -20, 2.5,    5, 2.5, 0x5a7a8a],
    [-20, -20, 2.5,    5, 2.5, 0x5a7a8a],

    // Mid cover walls (horizontal)
    [   0,  14, 9, 2.2,   1, 0x9a8870],
    [   0, -14, 9, 2.2,   1, 0x9a8870],
    // Mid cover walls (vertical)
    [ 14,    0, 1, 2.2,   9, 0x9a8870],
    [-14,    0, 1, 2.2,   9, 0x9a8870],

    // Crates at quad corners
    [  9,   9, 1.8, 1.8, 1.8, 0x9a6030],
    [ -9,   9, 1.8, 1.8, 1.8, 0x9a6030],
    [  9,  -9, 1.8, 1.8, 1.8, 0x9a6030],
    [ -9,  -9, 1.8, 1.8, 1.8, 0x9a6030],

    // Extra crates (stacked)
    [  9.4, 9, 1.4, 1.4, 1.4, 0xaa7040],  // on top of crate — visual only (y-placed)

    // Long flank cover
    [ 23,   0,   1, 2.2,   7, 0x7a6a5a],
    [-23,   0,   1, 2.2,   7, 0x7a6a5a],
    [   0,  23,  7, 2.2,   1, 0x7a6a5a],
    [   0, -23,  7, 2.2,   1, 0x7a6a5a],

    // Small barriers near spawn edges
    [ 11, -22, 2.5, 1.5, 1,   0x6a7a4a],
    [-11,  22, 2.5, 1.5, 1,   0x6a7a4a],
    [ 22,  11, 1,   1.5, 2.5, 0x6a7a4a],
    [-22, -11, 1,   1.5, 2.5, 0x6a7a4a],
  ];

  obs.forEach(([x, z, w, h, d, c]) => {
    addBox(w, h, d, c, x, h / 2, z);
    addCollider(x, z, w, d);
  });

  // Extra: stacked crate is elevated, treat it as same footprint as lower
  // (already collided via parent crate collider)

  // ── Decorative Trees (outside arena walls — no collision needed) ──
  const treeRing = [
    [38, 8], [38, -12], [38, 28], [38, -28],
    [-38, 8], [-38, -12], [-38, 28],
    [12, 38], [-10, 38], [26, 38],
    [10, -38], [-14, -38], [24, -38],
  ];
  treeRing.forEach(([x, z]) => placeTree(x, z));

  // ── Distant mountains (purely decorative) ─────────────────
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    const r  = 90 + Math.random() * 10;
    const mx = Math.cos(angle) * r;
    const mz = Math.sin(angle) * r;
    const mh = 18 + Math.random() * 18;
    const mw = 12 + Math.random() * 12;
    const mc = lerpColor(0x3a5028, 0x6a8050, Math.random());
    const geo  = new THREE.ConeGeometry(mw / 2, mh, 5 + Math.floor(Math.random() * 3));
    const mesh = new THREE.Mesh(geo, lambertMat(mc));
    mesh.position.set(mx, mh / 2 - 3, mz);
    mesh.rotation.y = Math.random() * Math.PI;
    scene.add(mesh);
  }

  // ── Sky sphere (simple) ───────────────────────────────────
  const skySphere = new THREE.Mesh(
    new THREE.SphereGeometry(150, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x7ab4cc, side: THREE.BackSide })
  );
  scene.add(skySphere);
}

function placeTree(x, z) {
  const h = 1.2 + Math.random() * 0.8;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.18, h, 5),
    lambertMat(0x6a4022)
  );
  trunk.position.set(x, h / 2, z);

  const lh = 1.8 + Math.random() * 1.2;
  const lw = 0.9 + Math.random() * 0.6;
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(lw, lh, 6 + Math.floor(Math.random() * 2)),
    lambertMat(lerpColor(0x2a5f20, 0x3a7a2a, Math.random()))
  );
  leaves.position.set(x, h + lh / 2, z);

  scene.add(trunk, leaves);
}

function lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// ═══════════════════════════════════════════════════════════════
//  GUN MODEL (camera-space child)
// ═══════════════════════════════════════════════════════════════
function buildGun() {
  gunGroup = new THREE.Group();

  const dark   = lambertMat(0x222222);
  const metal  = lambertMat(0x383838);
  const wood   = lambertMat(0x5a3318);

  // Barrel
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.44), dark);
  barrel.position.set(0, 0.025, -0.22);

  // Receiver body
  const recv = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.095, 0.20), metal);
  recv.position.set(0, -0.005, 0.04);

  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, 0.07), wood);
  grip.position.set(0, -0.13, 0.07);
  grip.rotation.x = 0.18;

  // Stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.14), wood);
  stock.position.set(0, -0.015, 0.19);

  // Magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.055), dark);
  mag.position.set(0, -0.09, 0.06);

  // Front sight
  const fsight = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.04, 0.015), dark);
  fsight.position.set(0, 0.055, -0.35);

  // Rear sight
  const rsight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.012), dark);
  rsight.position.set(0, 0.055, -0.08);

  gunGroup.add(barrel, recv, grip, stock, mag, fsight, rsight);

  // Muzzle flash (stays invisible unless firing)
  muzzleFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffbb00, transparent: true, opacity: 0, depthTest: false })
  );
  muzzleFlash.position.set(0, 0.025, -0.46);
  muzzleFlash.rotation.y = Math.PI / 2;
  gunGroup.add(muzzleFlash);

  // Position in camera space (bottom-right)
  gunGroup.position.set(0.21, -0.20, -0.35);
  camera.add(gunGroup);
}

// ═══════════════════════════════════════════════════════════════
//  REMOTE PLAYER MESH
// ═══════════════════════════════════════════════════════════════
function makeRemotePlayer(colorHex, name) {
  const group = new THREE.Group();

  const c      = new THREE.Color(colorHex);
  const cDark  = new THREE.Color(colorHex).multiplyScalar(0.65);
  const bMat   = new THREE.MeshLambertMaterial({ color: c,     flatShading: true });
  const dMat   = new THREE.MeshLambertMaterial({ color: cDark, flatShading: true });

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), bMat);
  head.position.y = 0.72;

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.32), bMat);
  torso.position.y = 0.1;

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.18), bMat);
  armL.position.set(-0.38, 0.1, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.18), bMat);
  armR.position.set( 0.38, 0.1, 0);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.50, 0.19), dMat);
  legL.position.set(-0.15, -0.5, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.50, 0.19), dMat);
  legR.position.set( 0.15, -0.5, 0);

  group.add(head, torso, armL, armR, legL, legR);

  // Name label sprite
  const label = makeNameSprite(name, colorHex);
  label.position.y = 1.4;
  group.add(label);

  // Store hittable meshes for raycasting
  group.userData.hittable = [head, torso, armL, armR, legL, legR];

  return group;
}

function makeNameSprite(name, colorHex) {
  const cvs = document.createElement('canvas');
  cvs.width = 256; cvs.height = 52;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(2, 2, 252, 48);

  ctx.fillStyle = colorHex;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.substring(0, 14), 128, 26);

  const tex    = new THREE.CanvasTexture(cvs);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.0, 0.42, 1);
  return sprite;
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET.IO — Multiplayer
// ═══════════════════════════════════════════════════════════════
function initSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join', { name: myName });
  });

  // Full initial state
  socket.on('init', (data) => {
    myId = data.id;
    Object.values(data.players).forEach(p => {
      if (p.id === myId) {
        camera.position.set(p.x, PLAYER_HEIGHT, p.z);
        myHealth = p.health;
        updateHealthUI();
      } else {
        addRemote(p);
      }
    });
    uiPlayerCount(Object.keys(data.players).length);
  });

  // Someone joined
  socket.on('playerJoined', (p) => {
    if (p.id !== myId) addRemote(p);
  });

  // Someone moved
  socket.on('playerMoved', (d) => {
    const op = otherPlayers[d.id];
    if (!op) return;
    op.group.position.set(d.x, BODY_Y, d.z);
    op.group.rotation.y = d.rotY;
  });

  // Someone disconnected
  socket.on('playerLeft', (id) => {
    const op = otherPlayers[id];
    if (op) { scene.remove(op.group); delete otherPlayers[id]; }
  });

  // A player died
  socket.on('playerDied', (d) => {
    if (d.id === myId) {
      alive    = false;
      myHealth = 0;
      updateHealthUI();
      document.getElementById('death-screen').style.display = 'block';
    }
    const op = otherPlayers[d.id];
    if (op) op.group.visible = false;
    addKillEntry(d.killerName, d.victimName);
  });

  // I respawned
  socket.on('respawn', (d) => {
    alive    = true;
    myHealth = 100;
    camera.position.set(d.x, PLAYER_HEIGHT, d.z);
    yaw   = Math.random() * Math.PI * 2;
    pitch = 0;
    updateHealthUI();
    document.getElementById('death-screen').style.display = 'none';
  });

  // Another player respawned
  socket.on('playerRespawned', (d) => {
    const op = otherPlayers[d.id];
    if (op) {
      op.group.position.set(d.x, BODY_Y, d.z);
      op.group.visible = true;
    }
  });

  // I was hit
  socket.on('hit', () => {
    showHitFlash();
  });

  // Score update (everyone)
  socket.on('updateScores', (scores) => {
    const me = scores.find(s => s.id === myId);
    if (me) {
      myHealth = me.health;
      updateHealthUI();
    }
    renderScoreboard(scores);
    uiPlayerCount(scores.length);
  });
}

function addRemote(p) {
  if (otherPlayers[p.id]) return;
  const group = makeRemotePlayer(p.color, p.name);
  group.position.set(p.x, BODY_Y, p.z);
  scene.add(group);
  otherPlayers[p.id] = { group };
}

// ═══════════════════════════════════════════════════════════════
//  INPUT
// ═══════════════════════════════════════════════════════════════
function initInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Tab') { e.preventDefault(); showScoreboard(true); }
    if (e.code === 'Escape') document.exitPointerLock();
  });
  document.addEventListener('keyup', e => {
    keys[e.code] = false;
    if (e.code === 'Tab') showScoreboard(false);
  });

  document.addEventListener('mousemove', e => {
    if (!pointerLocked) return;
    const s = 0.0022;
    yaw  -= e.movementX * s;
    pitch = clamp(pitch - e.movementY * s, -1.15, 1.15);
  });

  document.addEventListener('mousedown', e => { if (e.button === 0) mouse.left = true; });
  document.addEventListener('mouseup',   e => { if (e.button === 0) mouse.left = false; });

  document.getElementById('game-canvas').addEventListener('click', () => {
    document.getElementById('game-canvas').requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === document.getElementById('game-canvas');
    document.getElementById('lock-msg').style.display = pointerLocked ? 'none' : 'block';
  });
}

// ═══════════════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════════════
function gameLoop(now) {
  requestAnimationFrame(gameLoop);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  if (gameStarted) update(dt, now);
  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════
//  UPDATE
// ═══════════════════════════════════════════════════════════════
const _moveDir = new THREE.Vector3();
const _euler   = new THREE.Euler(0, 0, 0, 'YXZ');

function update(dt, now) {
  // Apply orientation to camera
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  if (!alive || !pointerLocked || !myId) return;

  // ── Movement ──────────────────────────────────────────────
  _moveDir.set(0, 0, 0);
  if (keys['KeyW'] || keys['ArrowUp'])    _moveDir.z -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  _moveDir.z += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  _moveDir.x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) _moveDir.x += 1;

  const moving = _moveDir.lengthSq() > 0;

  if (moving) {
    _moveDir.normalize();
    _euler.set(0, yaw, 0);
    _moveDir.applyEuler(_euler);

    const nx = camera.position.x + _moveDir.x * MOVE_SPEED * dt;
    const nz = camera.position.z + _moveDir.z * MOVE_SPEED * dt;

    const r = resolveCollision(camera.position.x, camera.position.z, nx, nz);
    camera.position.x = r.x;
    camera.position.z = r.z;
    camera.position.y = PLAYER_HEIGHT;

    // Gun bob
    gunBobT += dt * 9.5;
    gunGroup.position.y = -0.20 + Math.sin(gunBobT) * 0.013;
    gunGroup.rotation.z = Math.sin(gunBobT * 0.5) * 0.022;
  }

  // ── Shoot ─────────────────────────────────────────────────
  if (mouse.left && now - lastShot > FIRE_RATE) {
    lastShot = now;
    doShoot();
  }

  // ── Broadcast position ────────────────────────────────────
  if (now - lastMoveSent > 45) {
    lastMoveSent = now;
    socket.emit('move', {
      x:    camera.position.x,
      y:    camera.position.y,
      z:    camera.position.z,
      rotY: yaw,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  COLLISION RESOLUTION (axis-separated sliding)
// ═══════════════════════════════════════════════════════════════
function resolveCollision(ox, oz, nx, nz) {
  let rx = nx, rz = nz;
  for (const c of colliders) {
    const inX = rx > c.minX && rx < c.maxX;
    const inZ = rz > c.minZ && rz < c.maxZ;
    if (inX && inZ) {
      const wasX = ox > c.minX && ox < c.maxX;
      const wasZ = oz > c.minZ && oz < c.maxZ;
      if      (!wasX) rx = ox;
      else if (!wasZ) rz = oz;
      else            { rx = ox; rz = oz; }
    }
  }
  return { x: rx, z: rz };
}

// ═══════════════════════════════════════════════════════════════
//  SHOOTING — client-side raycast, server confirms damage
// ═══════════════════════════════════════════════════════════════
const _raycaster = new THREE.Raycaster();
const _origin    = new THREE.Vector2(0, 0);

let muzzleTimer = null;

function doShoot() {
  // Recoil kick
  gunGroup.position.z = -0.26;
  setTimeout(() => { if (gunGroup) gunGroup.position.z = -0.35; }, 60);

  // Muzzle flash
  muzzleFlash.material.opacity = 0.95;
  clearTimeout(muzzleTimer);
  muzzleTimer = setTimeout(() => { muzzleFlash.material.opacity = 0; }, 55);

  _raycaster.setFromCamera(_origin, camera);
  _raycaster.far = 120;

  // Build map: mesh → playerId
  const meshToId = new Map();
  for (const [id, { group }] of Object.entries(otherPlayers)) {
    if (!group.visible) continue;
    for (const m of (group.userData.hittable || [])) {
      meshToId.set(m, id);
    }
  }

  if (meshToId.size === 0) return;

  const hits = _raycaster.intersectObjects([...meshToId.keys()]);
  if (hits.length > 0) {
    const targetId = meshToId.get(hits[0].object);
    if (targetId) {
      socket.emit('shoot', { targetId, damage: DAMAGE });
      flashHitMarker();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════
function updateHealthUI() {
  const hp  = clamp(myHealth, 0, 100);
  const bar = document.getElementById('health-bar');
  bar.style.width = hp + '%';
  bar.style.background = hp > 60 ? '#22dd44' : hp > 30 ? '#ddaa22' : '#dd2222';
  document.getElementById('health-text').textContent = hp;
}

let hitFlashTimer;
function showHitFlash() {
  const el = document.getElementById('hit-flash');
  el.style.display = 'block';
  clearTimeout(hitFlashTimer);
  hitFlashTimer = setTimeout(() => el.style.display = 'none', 120);
}

let hitMarkerTimer;
function flashHitMarker() {
  const ch = document.getElementById('crosshair');
  ch.classList.add('hit');
  ch.style.transform = 'translate(-50%, -50%) scale(1.5)';
  clearTimeout(hitMarkerTimer);
  hitMarkerTimer = setTimeout(() => {
    ch.classList.remove('hit');
    ch.style.transform = 'translate(-50%, -50%) scale(1)';
  }, 160);
}

function addKillEntry(killerName, victimName) {
  const kf  = document.getElementById('killfeed');
  const div = document.createElement('div');
  div.className = 'kill-entry';
  div.innerHTML = `<span style="color:#ff8844;font-weight:bold">${esc(killerName)}</span>`
                + ` ✕ `
                + `<span style="color:#88aaff">${esc(victimName)}</span>`;
  kf.prepend(div);
  // Cap feed at 6 entries
  while (kf.children.length > 6) kf.removeChild(kf.lastChild);
  setTimeout(() => div.remove(), 3600);
}

function showScoreboard(visible) {
  document.getElementById('scoreboard').style.display = visible ? 'block' : 'none';
}

function renderScoreboard(scores) {
  const tbody = document.getElementById('score-rows');
  tbody.innerHTML = '';
  [...scores]
    .sort((a, b) => b.kills - a.kills)
    .forEach(p => {
      const isMe = p.id === myId;
      const tr   = document.createElement('tr');
      if (isMe) tr.style.background = 'rgba(255,255,255,0.06)';
      tr.innerHTML =
        `<td><span style="color:${p.color};font-weight:bold">${esc(p.name)}</span>`
        + (isMe ? ' <span style="color:#555;font-size:11px">(you)</span>' : '') + `</td>`
        + `<td style="color:#88ff88">${p.kills}</td>`
        + `<td style="color:#ff8888">${p.deaths}</td>`
        + `<td>${p.alive
             ? `<span style="color:#88ff88">${p.health}</span>`
             : `<span style="color:#555">☠</span>`}</td>`;
      tbody.appendChild(tr);
    });
}

function uiPlayerCount(n) {
  document.getElementById('player-count').textContent = `👥 ${n} online`;
}

// ── Utilities ──────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
