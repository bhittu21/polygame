'use strict';
// ═══════════════════════════════════════════════════════════════
//  POLY ARENA  —  Client v2
//  Features: 2 weapons, scope, sprint, wall-block, interpolation,
//            leg animation, procedural audio, dragon event, rooms
// ═══════════════════════════════════════════════════════════════

/* ─── CONFIG ─────────────────────────────────────────────────── */
const MOVE_SPEED    = 9.5;
const SPRINT_MULT   = 2.0;
const PLAYER_HEIGHT = 1.7;
const BODY_Y        = 1.0;
const NORMAL_FOV    = 75;
const NET_RATE_MS   = 45;
const MAP_HALF      = 29;

const WEAPONS = [
  { id:'rifle',  name:'AUTO RIFLE',   damage:20, fireRate:110,  auto:true,  scopeFOV:52, spread:0.003  },
  { id:'sniper', name:'SNIPER RIFLE', damage:95, fireRate:1600, auto:false, scopeFOV:12, spread:0.0002 },
];

/* ─── GLOBALS ────────────────────────────────────────────────── */
let scene, camera, renderer;
let ambientLight, sunLight;
let socket, myId, myName, myRoom = 'global';
let myHealth = 100, alive = true, gameStarted = false;
let pointerLocked = false;

let weaponIdx     = 0;
const gunGroups   = [];      // [rifleGroup, sniperGroup]
const muzzleFlashes = [];

const otherPlayers = {};     // id → { group }

const keys  = {};
const mouse = { left:false, right:false, _wasLeft:false };
let yaw = 0, pitch = 0;
let sensitivity = 0.0022;

let scoped     = false;
let currentFOV = NORMAL_FOV;
let targetFOV  = NORMAL_FOV;

let lastTime = 0, lastShot = 0, lastMoveSent = 0;
let gunBobT = 0, footstepTimer = 0;
let muzzleTimer;

const wallMeshes = [];   // solid obstacle meshes for bullet-blocking
const colliders  = [];   // AABB for player movement collision

/* ─── DRAGON / ENVIRONMENT ───────────────────────────────────── */
let dragonGroup   = null;
let dragonActive  = false;
let dragonT       = 0;
let dragonElapsed = 0;
let nextDragonIn  = 65 + Math.random() * 55;

const ENV_NORMAL = { fogR:0x7a/255,fogG:0xb4/255,fogB:0xcc/255, ambR:1.0,ambG:.93,ambB:.87, sunR:1,sunG:1,sunB:1, sunInt:1.0, fogNear:28, fogFar:75 };
const ENV_DRAGON = { fogR:.26,fogG:.03,fogB:.02, ambR:.5,ambG:.12,ambB:.08, sunR:1,sunG:.45,sunB:.1, sunInt:.4, fogNear:13, fogFar:42 };
let envT = 0;   // 0=normal, 1=dragon

/* ─── AUDIO ──────────────────────────────────────────────────── */
let audioCtx = null;
function getAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}

function _noiseBurst(ctx, freq, dur, vol, q=0.45){
  try{
    const n=Math.floor(ctx.sampleRate*dur);
    const buf=ctx.createBuffer(1,n,ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(n*0.1));
    const src=ctx.createBufferSource(); src.buffer=buf;
    const bp=ctx.createBiquadFilter(); bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=q;
    const g=ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start();
  }catch(e){}
}
function _oscBurst(ctx, f0, f1, dur, vol, type='sine'){
  try{
    const t=ctx.currentTime;
    const osc=ctx.createOscillator(); const g=ctx.createGain();
    osc.type=type;
    osc.frequency.setValueAtTime(f0,t);
    osc.frequency.exponentialRampToValueAtTime(f1,t+dur);
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(); osc.stop(t+dur);
  }catch(e){}
}

function playRifleShot(){
  try{ const c=getAudio(); _noiseBurst(c,900,.08,.6,.4); _oscBurst(c,130,40,.09,.35); }catch(e){}
}
function playSniperShot(){
  try{
    const c=getAudio();
    _noiseBurst(c,380,.22,1.0,.28);
    _oscBurst(c,90,20,.35,.25,'sawtooth');
    setTimeout(()=>{ try{ _noiseBurst(c,280,.12,.18,.2); }catch(e){} },130);
  }catch(e){}
}
function playHitSound(){
  try{ const c=getAudio(); _oscBurst(c,900,440,.09,.28); }catch(e){}
}
function playWeaponSwitch(){
  try{
    const c=getAudio(); const t=c.currentTime;
    const osc=c.createOscillator(); const g=c.createGain();
    osc.type='square';
    osc.frequency.setValueAtTime(200,t); osc.frequency.setValueAtTime(320,t+.05);
    g.gain.setValueAtTime(.12,t); g.gain.exponentialRampToValueAtTime(.001,t+.12);
    osc.connect(g); g.connect(c.destination);
    osc.start(); osc.stop(t+.12);
  }catch(e){}
}
function playFootstep(){
  try{ const c=getAudio(); _noiseBurst(c,140,.04,.07,2.2); }catch(e){}
}
function playDragonRoar(){
  try{
    const c=getAudio();
    [0,.4,.9].forEach((delay,i)=>{
      const t=c.currentTime+delay;
      const osc=c.createOscillator(); const g=c.createGain();
      osc.type='sawtooth';
      osc.frequency.setValueAtTime(28+i*12,t);
      osc.frequency.exponentialRampToValueAtTime(55+i*18,t+.35);
      osc.frequency.exponentialRampToValueAtTime(22,t+1.2);
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(.22,t+.2);
      g.gain.exponentialRampToValueAtTime(.001,t+1.3);
      osc.connect(g); g.connect(c.destination);
      osc.start(t); osc.stop(t+1.4);
    });
  }catch(e){}
}

/* ─── ENTRY ──────────────────────────────────────────────────── */
function startGame(){
  const nameEl = document.getElementById('name-inp');
  myName = (nameEl.value.trim() || 'Ghost'+Math.floor(Math.random()*9999)).substring(0,16);

  const isPrivate = document.getElementById('btn-priv').classList.contains('active');
  if(isPrivate){
    const rc = document.getElementById('room-inp').value.trim().toUpperCase();
    myRoom = rc || 'global';
  } else {
    myRoom = 'global';
  }

  document.getElementById('room-ind').textContent =
    myRoom==='global' ? '◈ GLOBAL' : '⊕ ROOM: '+myRoom;

  document.getElementById('overlay').style.display='none';
  document.getElementById('lock-msg').style.display='block';

  initRenderer();
  buildMap();
  buildGuns();
  initSocket();
  initInput();

  gameStarted = true;
  lastTime = performance.now();
  requestAnimationFrame(gameLoop);
}

/* ─── RENDERER ───────────────────────────────────────────────── */
function initRenderer(){
  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias:false });
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x7ab4cc);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x7ab4cc, 28, 75);

  camera = new THREE.PerspectiveCamera(NORMAL_FOV, innerWidth/innerHeight, 0.05, 160);
  camera.position.set(0, PLAYER_HEIGHT, 0);
  scene.add(camera);

  ambientLight = new THREE.AmbientLight(0xffeedd, .6);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  sunLight.position.set(50, 80, 40);
  scene.add(sunLight);

  const fill = new THREE.DirectionalLight(0x8899ff, .28);
  fill.position.set(-30,15,-30);
  scene.add(fill);

  addEventListener('resize', ()=>{
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

/* ─── HELPERS ────────────────────────────────────────────────── */
function mat(color){ return new THREE.MeshLambertMaterial({color,flatShading:true}); }
function box(w,h,d,c,x,y,z,solid=false){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat(c));
  m.position.set(x,y,z); scene.add(m);
  if(solid) wallMeshes.push(m);
  return m;
}
function mobj(geo,material,x,y,z){
  const m=new THREE.Mesh(geo,material); m.position.set(x,y,z); return m;
}
function clamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function lerpHex(a,b,t){
  const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255;
  const br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
  return (Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t);
}

/* ─── MAP ────────────────────────────────────────────────────── */
function addCollider(cx,cz,w,d,pad=0.45){
  colliders.push({ minX:cx-w/2-pad, maxX:cx+w/2+pad, minZ:cz-d/2-pad, maxZ:cz+d/2+pad });
}

function buildMap(){
  /* Ground */
  const gGeo=new THREE.PlaneGeometry(160,160,32,32);
  const gPos=gGeo.attributes.position;
  for(let i=0;i<gPos.count;i++){
    const vx=gPos.getX(i),vz=gPos.getY(i);
    if(Math.min(80-Math.abs(vx),80-Math.abs(vz))>10)
      gPos.setZ(i,(Math.random()-.5)*.35);
  }
  gGeo.computeVertexNormals();
  const gnd=new THREE.Mesh(gGeo,mat(0x4a7a30)); gnd.rotation.x=-Math.PI/2; scene.add(gnd);

  /* Perimeter walls — solid */
  const WH=5.5, WL=MAP_HALF*2;
  [
    [WL+2,WH,1.2,0x7a6858, 0,       WH/2, MAP_HALF],
    [WL+2,WH,1.2,0x7a6858, 0,       WH/2,-MAP_HALF],
    [1.2,WH,WL+2,0x7a6858,-MAP_HALF,WH/2, 0       ],
    [1.2,WH,WL+2,0x7a6858, MAP_HALF,WH/2, 0       ],
  ].forEach(([w,h,d,c,x,y,z])=>box(w,h,d,c,x,y,z,true));
  addCollider(0,MAP_HALF,WL,1.2,.7);
  addCollider(0,-MAP_HALF,WL,1.2,.7);
  addCollider(-MAP_HALF,0,1.2,WL,.7);
  addCollider(MAP_HALF,0,1.2,WL,.7);

  /* Interior obstacles  [cx, cz, w, h, d, color] — all solid */
  const obs=[
    [ 4.5,  0,   1, 3.5, 8,   0x8a7a9a],
    [-4.5,  0,   1, 3.5, 8,   0x8a7a9a],
    [ 0,    4,   8, 3.5, 1,   0x8a7a9a],
    [ 20,  20,   2.5,5,2.5,   0x5a7a8a],
    [-20,  20,   2.5,5,2.5,   0x5a7a8a],
    [ 20, -20,   2.5,5,2.5,   0x5a7a8a],
    [-20, -20,   2.5,5,2.5,   0x5a7a8a],
    [ 0,   14,   9,2.2,1,     0x9a8870],
    [ 0,  -14,   9,2.2,1,     0x9a8870],
    [ 14,   0,   1,2.2,9,     0x9a8870],
    [-14,   0,   1,2.2,9,     0x9a8870],
    [ 9,    9,   1.8,1.8,1.8, 0x9a6030],
    [-9,    9,   1.8,1.8,1.8, 0x9a6030],
    [ 9,   -9,   1.8,1.8,1.8, 0x9a6030],
    [-9,   -9,   1.8,1.8,1.8, 0x9a6030],
    [ 23,   0,   1,2.2,7,     0x7a6a5a],
    [-23,   0,   1,2.2,7,     0x7a6a5a],
    [ 0,   23,   7,2.2,1,     0x7a6a5a],
    [ 0,  -23,   7,2.2,1,     0x7a6a5a],
    [ 11, -22,   2.5,1.5,1,   0x6a7a4a],
    [-11,  22,   2.5,1.5,1,   0x6a7a4a],
    [ 22,  11,   1,1.5,2.5,   0x6a7a4a],
    [-22, -11,   1,1.5,2.5,   0x6a7a4a],
  ];
  obs.forEach(([cx,cz,w,h,d,c])=>{
    box(w,h,d,c,cx,h/2,cz,true);
    addCollider(cx,cz,w,d);
  });

  /* Trees — decorative, not solid */
  [[38,8],[38,-12],[38,28],[38,-28],[-38,8],[-38,-18],[-38,28],
   [12,38],[-10,38],[26,38],[10,-38],[-14,-38],[24,-38]].forEach(([x,z])=>placeTree(x,z));

  /* Mountains */
  for(let i=0;i<10;i++){
    const a=(i/10)*Math.PI*2+.3, r=90+Math.random()*12;
    const mh=18+Math.random()*18, mw=12+Math.random()*12;
    const m=new THREE.Mesh(new THREE.ConeGeometry(mw/2,mh,5+Math.floor(Math.random()*3)),
      mat(lerpHex(0x3a5028,0x6a8050,Math.random())));
    m.position.set(Math.cos(a)*r, mh/2-3, Math.sin(a)*r);
    m.rotation.y=Math.random()*Math.PI;
    scene.add(m);
  }

  /* Sky dome */
  const sky=new THREE.Mesh(new THREE.SphereGeometry(150,8,6),
    new THREE.MeshBasicMaterial({color:0x7ab4cc,side:THREE.BackSide}));
  scene.add(sky);
}

function placeTree(x,z){
  const h=1.2+Math.random()*.8;
  const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.08,.18,h,5),mat(0x6a4022));
  trunk.position.set(x,h/2,z);
  const lh=1.8+Math.random()*1.2, lw=.9+Math.random()*.6;
  const leaves=new THREE.Mesh(new THREE.ConeGeometry(lw,lh,6),mat(lerpHex(0x2a5f20,0x3a7a2a,Math.random())));
  leaves.position.set(x,h+lh/2,z);
  scene.add(trunk,leaves);
}

/* ─── GUN MODELS ─────────────────────────────────────────────── */
function buildGuns(){ buildRifle(); buildSniper(); }

function buildRifle(){
  const g=new THREE.Group();
  const dark=mat(0x222222), metal=mat(0x383838), wood=mat(0x5a3318);

  g.add(
    mobj(new THREE.BoxGeometry(.05,.05,.44),  dark,  0, .025, -.22),  // barrel
    mobj(new THREE.BoxGeometry(.09,.095,.20), metal, 0,-.005,  .04),  // receiver
    mobj(new THREE.BoxGeometry(.06,.17,.07),  wood,  0,-.13,   .07),  // grip
    mobj(new THREE.BoxGeometry(.065,.065,.14),wood,  0,-.015,  .19),  // stock
    mobj(new THREE.BoxGeometry(.05,.11,.055), dark,  0,-.09,   .06),  // mag
  );
  // muzzle flash plane
  const mf=new THREE.Mesh(new THREE.PlaneGeometry(.18,.18),
    new THREE.MeshBasicMaterial({color:0xffbb00,transparent:true,opacity:0,depthTest:false}));
  mf.position.set(0,.025,-.46); mf.rotation.y=Math.PI/2;
  g.add(mf); muzzleFlashes.push(mf);

  g.position.set(.21,-.20,-.35);
  camera.add(g);
  gunGroups.push(g);
}

function buildSniper(){
  const g=new THREE.Group();
  const dark=mat(0x1a2810), metal=mat(0x2a3820), scope=mat(0x111111);

  g.add(
    mobj(new THREE.BoxGeometry(.04,.04,.75),   dark,  0, .025,-.375),  // long barrel
    mobj(new THREE.BoxGeometry(.08,.085,.24),  metal, 0,-.005,  .08),  // receiver
    mobj(new THREE.BoxGeometry(.055,.18,.07),  dark,  0,-.14,   .06),  // grip
    mobj(new THREE.BoxGeometry(.06,.06,.22),   dark,  0,-.015,  .25),  // stock
    mobj(new THREE.BoxGeometry(.04,.10,.05),   metal, 0,-.09,   .07),  // mag
    mobj(new THREE.BoxGeometry(.045,.045,.22), scope, 0, .075, -.08),  // scope body
    mobj(new THREE.BoxGeometry(.065,.052,.025),scope, 0, .075,  .02),  // scope ring front
    mobj(new THREE.BoxGeometry(.065,.052,.025),scope, 0, .075, -.18),  // scope ring rear
    mobj(new THREE.BoxGeometry(.012,.11,.012), dark,-.04,-.06,-.50),   // bipod L
    mobj(new THREE.BoxGeometry(.012,.11,.012), dark, .04,-.06,-.50),   // bipod R
  );
  const mf=new THREE.Mesh(new THREE.PlaneGeometry(.14,.14),
    new THREE.MeshBasicMaterial({color:0xffffaa,transparent:true,opacity:0,depthTest:false}));
  mf.position.set(0,.025,-.78); mf.rotation.y=Math.PI/2;
  g.add(mf); muzzleFlashes.push(mf);

  g.position.set(.21,-.20,-.35);
  g.visible=false;
  camera.add(g);
  gunGroups.push(g);
}

/* ─── REMOTE PLAYER ──────────────────────────────────────────── */
function makeRemotePlayer(colorHex, name){
  const group=new THREE.Group();
  const c=new THREE.Color(colorHex);
  const cDark=new THREE.Color(colorHex).multiplyScalar(.55);
  const bm=new THREE.MeshLambertMaterial({color:c,     flatShading:true});
  const dm=new THREE.MeshLambertMaterial({color:cDark, flatShading:true});

  const head =mobj(new THREE.BoxGeometry(.44,.44,.44), bm, 0,  .72, 0);
  const torso=mobj(new THREE.BoxGeometry(.54,.62,.32), bm, 0,  .10, 0);
  const armL =mobj(new THREE.BoxGeometry(.16,.54,.18), bm,-.38, .10, 0);
  const armR =mobj(new THREE.BoxGeometry(.16,.54,.18), bm, .38, .10, 0);
  const legL =mobj(new THREE.BoxGeometry(.19,.50,.19), dm,-.15,-.50, 0);
  const legR =mobj(new THREE.BoxGeometry(.19,.50,.19), dm, .15,-.50, 0);
  group.add(head,torso,armL,armR,legL,legR);

  /* Name label sprite */
  const spr=makeLabel(name, colorHex);
  spr.position.y=1.45; group.add(spr);

  /* Store refs for animation */
  group.userData.hittable=[head,torso,armL,armR,legL,legR];
  group.userData.legL=legL; group.userData.legR=legR;
  group.userData.armL=armL; group.userData.armR=armR;
  group.userData.bobT=0;
  group.userData.targetPos=new THREE.Vector3();
  group.userData.targetRot=0;
  group.userData.prevX=0; group.userData.prevZ=0;
  return group;
}

function makeLabel(name, colorHex){
  const cvs=document.createElement('canvas');
  cvs.width=256; cvs.height=52;
  const ctx=cvs.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(2,2,252,48);
  ctx.fillStyle=colorHex;
  ctx.font='bold 24px monospace';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(name.substring(0,14),128,26);
  const tex=new THREE.CanvasTexture(cvs);
  const spr=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));
  spr.scale.set(2,.42,1);
  return spr;
}

/* ─── SOCKET ─────────────────────────────────────────────────── */
function initSocket(){
  socket=io();

  socket.on('connect',()=>{
    socket.emit('join',{ name:myName, room:myRoom });
  });

  socket.on('init',(data)=>{
    myId=data.id;
    Object.values(data.players).forEach(p=>{
      if(p.id===myId){
        camera.position.set(p.x,PLAYER_HEIGHT,p.z);
        myHealth=p.health; updateHPUI();
      } else {
        addRemote(p);
      }
    });
    uiCount(Object.keys(data.players).length);
  });

  socket.on('playerJoined',p=>{ if(p.id!==myId) addRemote(p); });

  socket.on('playerMoved',d=>{
    const op=otherPlayers[d.id]; if(!op) return;
    const ud=op.group.userData;
    ud.targetPos.set(d.x, BODY_Y, d.z);
    ud.targetRot=d.rotY;
  });

  socket.on('playerLeft',id=>{
    const op=otherPlayers[id];
    if(op){ scene.remove(op.group); delete otherPlayers[id]; }
  });

  socket.on('playerDied',d=>{
    if(d.id===myId){
      alive=false; myHealth=0; updateHPUI();
      document.getElementById('death-screen').style.display='block';
    }
    const op=otherPlayers[d.id];
    if(op) op.group.visible=false;
    addKillFeed(d.killerName, d.victimName);
  });

  socket.on('respawn',d=>{
    alive=true; myHealth=100;
    camera.position.set(d.x,PLAYER_HEIGHT,d.z);
    yaw=Math.random()*Math.PI*2; pitch=0;
    updateHPUI();
    document.getElementById('death-screen').style.display='none';
  });

  socket.on('playerRespawned',d=>{
    const op=otherPlayers[d.id]; if(!op) return;
    const ud=op.group.userData;
    ud.targetPos.set(d.x,BODY_Y,d.z);
    op.group.position.set(d.x,BODY_Y,d.z);
    op.group.visible=true;
  });

  socket.on('hit',()=>{ showHitFlash(); playHitSound(); });

  socket.on('updateScores',scores=>{
    const me=scores.find(s=>s.id===myId);
    if(me){ myHealth=me.health; updateHPUI(); }
    renderScoreboard(scores);
    uiCount(scores.length);
  });
}

function addRemote(p){
  if(otherPlayers[p.id]) return;
  const group=makeRemotePlayer(p.color, p.name);
  group.position.set(p.x, BODY_Y, p.z);
  group.userData.targetPos.set(p.x, BODY_Y, p.z);
  group.userData.prevX=p.x; group.userData.prevZ=p.z;
  scene.add(group);
  otherPlayers[p.id]={ group };
}

/* ─── INPUT ──────────────────────────────────────────────────── */
function initInput(){
  addEventListener('keydown',e=>{
    keys[e.code]=true;
    if(e.code==='Tab'){ e.preventDefault(); showSB(true); }
    if(e.code==='Escape') document.exitPointerLock();
    if(e.code==='Digit1') setWeapon(0);
    if(e.code==='Digit2') setWeapon(1);
  });
  addEventListener('keyup',e=>{
    keys[e.code]=false;
    if(e.code==='Tab') showSB(false);
  });

  addEventListener('mousemove',e=>{
    if(!pointerLocked) return;
    yaw  -= e.movementX * sensitivity;
    pitch = clamp(pitch - e.movementY*sensitivity, -1.15, 1.15);
  });
  addEventListener('mousedown',e=>{
    if(e.button===0) mouse.left =true;
    if(e.button===2) mouse.right=true;
  });
  addEventListener('mouseup',e=>{
    if(e.button===0) mouse.left =false;
    if(e.button===2) mouse.right=false;
  });
  addEventListener('contextmenu',e=>e.preventDefault());

  addEventListener('wheel',e=>{
    if(!gameStarted) return;
    setWeapon((weaponIdx+(e.deltaY>0?1:-1)+WEAPONS.length)%WEAPONS.length);
  });

  const cnv=document.getElementById('game-canvas');
  cnv.addEventListener('click',()=>cnv.requestPointerLock());
  document.addEventListener('pointerlockchange',()=>{
    pointerLocked=document.pointerLockElement===cnv;
    document.getElementById('lock-msg').style.display=pointerLocked?'none':'block';
  });
}

function setWeapon(idx){
  weaponIdx=idx;
  gunGroups.forEach((g,i)=>{ g.visible=i===idx; });
  document.getElementById('weap-name').textContent=WEAPONS[idx].name;
  document.querySelectorAll('.wslot').forEach((el,i)=>el.classList.toggle('active',i===idx));
  playWeaponSwitch();
}

/* ─── GAME LOOP ──────────────────────────────────────────────── */
function gameLoop(now){
  requestAnimationFrame(gameLoop);
  const dt=Math.min((now-lastTime)/1000, .05);
  lastTime=now;
  if(gameStarted) update(dt, now);
  renderer.render(scene, camera);
}

/* ─── UPDATE ─────────────────────────────────────────────────── */
const _dir  = new THREE.Vector3();
const _euler= new THREE.Euler(0,0,0,'YXZ');

function update(dt, now){
  /* Camera orientation */
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  /* ── Scope ── */
  const wantScope = mouse.right && alive;
  targetFOV    = wantScope ? WEAPONS[weaponIdx].scopeFOV : NORMAL_FOV;
  sensitivity  = wantScope ? .0009 : .0022;
  currentFOV  += (targetFOV-currentFOV) * Math.min(dt*13,1);
  camera.fov   = currentFOV;
  camera.updateProjectionMatrix();

  // Scope overlay only for sniper
  const showScope = wantScope && weaponIdx===1;
  document.getElementById('crosshair').style.display     = showScope?'none':'block';
  document.getElementById('scope-ov').style.display      = showScope?'block':'none';
  if(gunGroups[weaponIdx]) gunGroups[weaponIdx].visible = !showScope;

  /* ── Dragon + environment ── */
  updateDragon(dt);

  /* ── Update remote players every frame ── */
  updateRemotes(dt);

  if(!alive||!pointerLocked||!myId) return;

  /* ── Movement ── */
  _dir.set(0,0,0);
  if(keys['KeyW']||keys['ArrowUp'])    _dir.z-=1;
  if(keys['KeyS']||keys['ArrowDown'])  _dir.z+=1;
  if(keys['KeyA']||keys['ArrowLeft'])  _dir.x-=1;
  if(keys['KeyD']||keys['ArrowRight']) _dir.x+=1;

  const sprinting = (keys['ShiftLeft']||keys['ShiftRight']) && _dir.lengthSq()>0;
  const speed     = MOVE_SPEED*(sprinting?SPRINT_MULT:1);
  const moving    = _dir.lengthSq()>0;

  document.getElementById('sprint-ind').style.display = sprinting?'block':'none';

  if(moving){
    _dir.normalize();
    _euler.set(0,yaw,0);
    _dir.applyEuler(_euler);

    const nx=camera.position.x+_dir.x*speed*dt;
    const nz=camera.position.z+_dir.z*speed*dt;
    const r=resolveCol(camera.position.x, camera.position.z, nx, nz);
    camera.position.x=r.x; camera.position.z=r.z;
    camera.position.y=PLAYER_HEIGHT;

    // Gun bob
    gunBobT+=dt*(sprinting?14:9.5);
    const gun=gunGroups[weaponIdx];
    if(gun&&gun.visible){
      gun.position.y=-.20+Math.sin(gunBobT)*.014;
      gun.rotation.z=Math.sin(gunBobT*.5)*.022;
    }

    // Footsteps
    footstepTimer-=dt;
    if(footstepTimer<=0){
      playFootstep();
      footstepTimer=sprinting?.22:.38;
    }
  }

  /* ── Shoot ── */
  const w=WEAPONS[weaponIdx];
  if(mouse.left && (w.auto||!mouse._wasLeft) && now-lastShot>w.fireRate){
    lastShot=now;
    doShoot();
  }
  mouse._wasLeft=mouse.left;

  /* ── Broadcast position ── */
  if(now-lastMoveSent>NET_RATE_MS){
    lastMoveSent=now;
    socket.emit('move',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, rotY:yaw });
  }
}

/* ─── REMOTE PLAYER INTERPOLATION + ANIMATION ───────────────── */
function updateRemotes(dt){
  const lf=1-Math.exp(-12*dt);   // lerp factor

  for(const { group } of Object.values(otherPlayers)){
    const ud=group.userData;

    /* Smooth position */
    group.position.x+=(ud.targetPos.x-group.position.x)*lf;
    group.position.z+=(ud.targetPos.z-group.position.z)*lf;

    /* Smooth rotation — shortest path */
    let dRot=ud.targetRot-group.rotation.y;
    while(dRot> Math.PI) dRot-=Math.PI*2;
    while(dRot<-Math.PI) dRot+=Math.PI*2;
    group.rotation.y+=dRot*lf;

    /* Movement detection */
    const dx=group.position.x-ud.prevX;
    const dz=group.position.z-ud.prevZ;
    ud.prevX=group.position.x; ud.prevZ=group.position.z;
    const isMoving=Math.sqrt(dx*dx+dz*dz)>0.005;

    if(isMoving){
      ud.bobT=(ud.bobT||0)+dt*9;
      const s=Math.sin(ud.bobT);
      if(ud.legL) ud.legL.rotation.x= s*.75;
      if(ud.legR) ud.legR.rotation.x=-s*.75;
      if(ud.armL) ud.armL.rotation.x=-s*.45;
      if(ud.armR) ud.armR.rotation.x= s*.45;
      group.position.y=BODY_Y+Math.abs(s)*.055;
    } else {
      /* Decay back to rest */
      const decay=1-Math.exp(-8*dt);
      if(ud.legL) ud.legL.rotation.x*=(1-decay);
      if(ud.legR) ud.legR.rotation.x*=(1-decay);
      if(ud.armL) ud.armL.rotation.x*=(1-decay);
      if(ud.armR) ud.armR.rotation.x*=(1-decay);
      group.position.y+=( BODY_Y-group.position.y)*decay;
    }
  }
}

/* ─── COLLISION ──────────────────────────────────────────────── */
function resolveCol(ox,oz,nx,nz){
  let rx=nx,rz=nz;
  for(const c of colliders){
    if(rx>c.minX&&rx<c.maxX&&rz>c.minZ&&rz<c.maxZ){
      const wasX=ox>c.minX&&ox<c.maxX;
      const wasZ=oz>c.minZ&&oz<c.maxZ;
      if(!wasX)      rx=ox;
      else if(!wasZ) rz=oz;
      else          { rx=ox; rz=oz; }
    }
  }
  return {x:rx,z:rz};
}

/* ─── SHOOT (wall-blocking fix) ──────────────────────────────── */
const _ray  = new THREE.Raycaster();
const _aim0 = new THREE.Vector2(0,0);

function doShoot(){
  const w=WEAPONS[weaponIdx];
  if(weaponIdx===0) playRifleShot(); else playSniperShot();

  /* Recoil */
  const gun=gunGroups[weaponIdx];
  if(gun&&gun.visible){
    gun.position.z=-.26;
    setTimeout(()=>{ if(gun) gun.position.z=-.35; },65);
    gun.rotation.x=-.06;
    setTimeout(()=>{ if(gun) gun.rotation.x=0; },90);
  }

  /* Muzzle flash */
  const mf=muzzleFlashes[weaponIdx];
  if(mf&&gun&&gun.visible){
    mf.material.opacity=1;
    clearTimeout(muzzleTimer);
    muzzleTimer=setTimeout(()=>{ if(mf) mf.material.opacity=0; },55);
  }

  /* Build aim vector with spread */
  const sp=w.spread;
  const aim=new THREE.Vector2(
    _aim0.x+(Math.random()-.5)*sp*2,
    _aim0.y+(Math.random()-.5)*sp*2,
  );
  _ray.setFromCamera(aim, camera);
  _ray.far=120;

  /* Map mesh → player id */
  const meshToId=new Map();
  for(const [id,{group}] of Object.entries(otherPlayers)){
    if(!group.visible) continue;
    for(const m of (group.userData.hittable||[])) meshToId.set(m,id);
  }
  if(meshToId.size===0) return;

  /* Check player hits */
  const pHits=_ray.intersectObjects([...meshToId.keys()]);
  if(pHits.length===0) return;

  const pDist=pHits[0].distance;

  /* ── WALL BLOCK: if any solid wall is closer than the player, cancel ── */
  const wHits=_ray.intersectObjects(wallMeshes);
  const wDist=wHits.length>0 ? wHits[0].distance : Infinity;
  if(wDist<pDist) return;   // wall in the way — shot blocked

  /* Register hit */
  const targetId=meshToId.get(pHits[0].object);
  if(targetId){
    socket.emit('shoot',{ targetId, damage:w.damage });
    flashHitMarker();
  }
}

/* ─── DRAGON EVENT ───────────────────────────────────────────── */
function buildDragon(){
  const g=new THREE.Group();
  const bm=mat(0x1a4422), dm=mat(0x0d2f14), wm=mat(0x0f3518);

  // Body
  g.add(mobj(new THREE.BoxGeometry(2.2,1.0,6.5), bm, 0,0,0));
  // Neck
  const neck=mobj(new THREE.BoxGeometry(.9,.8,1.8), bm, 0,.3,-3.5);
  neck.rotation.x=-.28; g.add(neck);
  // Head
  g.add(mobj(new THREE.BoxGeometry(1.1,.9,1.8), bm, 0,.5,-4.8));
  // Snout
  g.add(mobj(new THREE.BoxGeometry(.7,.45,.9), dm, 0,.1,-5.6));
  // Horns
  [-0.35,0.35].forEach(x=>{
    const h=new THREE.Mesh(new THREE.ConeGeometry(.1,.7,4),dm);
    h.position.set(x,1.1,-4.7); h.rotation.z=x>.0?.3:-.3; g.add(h);
  });
  // Glowing eyes
  [-0.28,0.28].forEach(x=>{
    const e=new THREE.Mesh(new THREE.BoxGeometry(.12,.1,.06),
      new THREE.MeshBasicMaterial({color:0xff4400}));
    e.position.set(x,.6,-5.5); g.add(e);
  });
  // Tail
  for(let i=0;i<5;i++){
    const s=1-i*.17;
    g.add(mobj(new THREE.BoxGeometry(s*1.2,s*.8,1.1), i<2?bm:dm, 0,-i*.09, 3.2+i*1.1));
  }

  // Wings — pivot groups
  function wing(side){
    const piv=new THREE.Group();
    piv.position.set(side*1.1,.2,.5);
    // Upper arm panel
    const ua=new THREE.Mesh(new THREE.BoxGeometry(3.8,.11,1.8),wm);
    ua.position.set(side*2.2,.4,0); ua.rotation.z=side*.28; piv.add(ua);
    // Lower membrane
    const lm=new THREE.Mesh(new THREE.BoxGeometry(3.0,.09,3.2),wm);
    lm.position.set(side*5.0,-.1,.8); lm.rotation.z=side*.12; piv.add(lm);
    g.add(piv);
    return piv;
  }
  g.userData.wingL=wing(-1);
  g.userData.wingR=wing(1);
  return g;
}

function updateDragon(dt){
  /* countdown to next event */
  if(!dragonActive){
    nextDragonIn-=dt;
    if(nextDragonIn<=0) spawnDragon();
    return;
  }

  dragonElapsed+=dt;
  dragonT      +=dt*.38;

  /* Circular orbit */
  const R=40;
  dragonGroup.position.set(
    Math.cos(dragonT)*R,
    20+Math.sin(dragonT*1.8)*3.5,
    Math.sin(dragonT)*R,
  );
  dragonGroup.rotation.y=dragonT+Math.PI/2;
  dragonGroup.rotation.z=-Math.sin(dragonT)*.18;   // banking

  /* Wing flap */
  const ft=dragonT*5;
  dragonGroup.userData.wingL.rotation.z= Math.sin(ft)*.55;
  dragonGroup.userData.wingR.rotation.z=-Math.sin(ft)*.55;

  /* Environment fade in (0→3 s) and out (17→20 s) */
  if(dragonElapsed<3)       envT=dragonElapsed/3;
  else if(dragonElapsed>17) envT=Math.max(0,1-(dragonElapsed-17)/3);
  else                      envT=1;
  applyEnv(envT);

  if(dragonElapsed>=20) despawnDragon();
}

function spawnDragon(){
  dragonActive=true; dragonElapsed=0;
  dragonT=Math.random()*Math.PI*2;
  dragonGroup=buildDragon();
  scene.add(dragonGroup);
  playDragonRoar();
  showDragonMsg('⚠  DRAGON  INCOMING  ⚠','#ff6600');
}

function despawnDragon(){
  dragonActive=false;
  scene.remove(dragonGroup); dragonGroup=null;
  nextDragonIn=60+Math.random()*60;
  envT=0; applyEnv(0);
  showDragonMsg('DRAGON HAS FLED','#555555');
}

function applyEnv(t){
  const fr=ENV_NORMAL.fogR+(ENV_DRAGON.fogR-ENV_NORMAL.fogR)*t;
  const fg=ENV_NORMAL.fogG+(ENV_DRAGON.fogG-ENV_NORMAL.fogG)*t;
  const fb=ENV_NORMAL.fogB+(ENV_DRAGON.fogB-ENV_NORMAL.fogB)*t;
  const fc=new THREE.Color(fr,fg,fb);
  scene.fog.color.copy(fc);
  renderer.setClearColor(fc);
  scene.fog.near=ENV_NORMAL.fogNear+(ENV_DRAGON.fogNear-ENV_NORMAL.fogNear)*t;
  scene.fog.far =ENV_NORMAL.fogFar +(ENV_DRAGON.fogFar -ENV_NORMAL.fogFar )*t;
  ambientLight.color.setRGB(
    ENV_NORMAL.ambR+(ENV_DRAGON.ambR-ENV_NORMAL.ambR)*t,
    ENV_NORMAL.ambG+(ENV_DRAGON.ambG-ENV_NORMAL.ambG)*t,
    ENV_NORMAL.ambB+(ENV_DRAGON.ambB-ENV_NORMAL.ambB)*t,
  );
  sunLight.color.setRGB(
    ENV_NORMAL.sunR+(ENV_DRAGON.sunR-ENV_NORMAL.sunR)*t,
    ENV_NORMAL.sunG+(ENV_DRAGON.sunG-ENV_NORMAL.sunG)*t,
    ENV_NORMAL.sunB+(ENV_DRAGON.sunB-ENV_NORMAL.sunB)*t,
  );
  sunLight.intensity=ENV_NORMAL.sunInt+(ENV_DRAGON.sunInt-ENV_NORMAL.sunInt)*t;
}

function showDragonMsg(msg, color){
  const el=document.getElementById('dragon-banner');
  const msg2=document.getElementById('dragon-msg');
  msg2.textContent=msg; msg2.style.color=color||'#ff6600';
  el.style.display='block';
  setTimeout(()=>el.style.display='none', 4000);
}

/* ─── UI ─────────────────────────────────────────────────────── */
function updateHPUI(){
  const hp=clamp(myHealth,0,100);
  const bar=document.getElementById('hp-bar');
  bar.style.width=hp+'%';
  bar.style.background=hp>60?'#00ff41':hp>30?'#ddaa22':'#ff2200';
  document.getElementById('hp-text').textContent=hp;
}

let hitFlashT;
function showHitFlash(){
  const el=document.getElementById('hit-flash');
  el.style.display='block';
  clearTimeout(hitFlashT);
  hitFlashT=setTimeout(()=>el.style.display='none',115);
}

let hitMarkT;
function flashHitMarker(){
  const ch=document.getElementById('crosshair');
  ch.classList.add('hit');
  ch.style.transform='translate(-50%,-50%) scale(1.7)';
  clearTimeout(hitMarkT);
  hitMarkT=setTimeout(()=>{
    ch.classList.remove('hit');
    ch.style.transform='translate(-50%,-50%) scale(1)';
  },165);
}

function addKillFeed(killer,victim){
  const kf=document.getElementById('killfeed');
  const d=document.createElement('div');
  d.className='ke';
  d.innerHTML=`<span style="color:#ff6622;font-weight:bold">${esc(killer)}</span>`
             +` ✕ <span style="color:#44ddff">${esc(victim)}</span>`;
  kf.prepend(d);
  while(kf.children.length>6) kf.removeChild(kf.lastChild);
  setTimeout(()=>d.remove(), 3700);
}

function showSB(v){
  document.getElementById('scoreboard').style.display=v?'block':'none';
}

function renderScoreboard(scores){
  const tb=document.getElementById('score-rows');
  tb.innerHTML='';
  [...scores].sort((a,b)=>b.kills-a.kills).forEach(p=>{
    const isMe=p.id===myId;
    const tr=document.createElement('tr');
    if(isMe) tr.style.background='rgba(0,255,65,.05)';
    tr.innerHTML=
      `<td><span style="color:${p.color}">${esc(p.name)}</span>`
      +(isMe?' <span style="color:#003311;font-size:10px">(you)</span>':'')+`</td>`
      +`<td style="color:#44ff88">${p.kills}</td>`
      +`<td style="color:#ff4444">${p.deaths}</td>`
      +`<td>${p.alive?`<span style="color:#00ff41">${p.health}</span>`:`<span style="color:#444">☠</span>`}</td>`;
    tb.appendChild(tr);
  });
}

function uiCount(n){
  document.getElementById('player-count').textContent=`◉ ${n} online`;
}
