import * as THREE from 'three';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#050509');
scene.add(new THREE.HemisphereLight('#fff3d2', '#08130d', 1.05));
const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
camera.position.set(0, 0, 30);
camera.lookAt(0, 0, 0);
const clock = new THREE.Clock();
const world = new THREE.Group();
scene.add(world);

const poseName = new URLSearchParams(location.search).get('pose');
const posePreview = ['blessing', 'heart'].includes(poseName);
const state = { spread: 1, spreadTarget: 1, textProgress: 0, fireworkProgress: 1, charmPhase: 'scattered', treeRevealFromHeart: false, photoFocus: false, selectedPhoto: 0, gesture: 'none', cameraOn: false, handX: .5, handY: .5, handSeen: false, dragging: false, pointerMoved: false };
let textAnchorX = 0;
let handLandmarker = null;
let stream = null;
let lastVideoTime = -1;
let lastGestureAction = 0;
let toastTimer = 0;
const memories = [];
const photoObjects = [];

const $ = (s) => document.querySelector(s);
const titleText = $('#titleText');
const messageText = $('#messageText');
const toast = $('#toast');
const video = $('#cameraVideo');
const overlay = $('#handOverlay');
const preview = $('#gesturePreview');

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2400);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  const viewH = aspect < 0.8 ? 17.5 : (h < 650 ? 15 : 16);
  const viewW = viewH * aspect;
  camera.left = -viewW / 2;
  camera.right = viewW / 2;
  camera.top = viewH / 2;
  camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  for (let i = 0; i < SNOW_COUNT; i++) {
    const j = i * 3;
    snowPositions[j] = camera.left + ((snowPhases[i] / (Math.PI * 2)) % 1) * (camera.right - camera.left);
    snowPositions[j + 1] = camera.bottom + ((i * .61803398875) % 1) * (camera.top - camera.bottom);
  }
  snowPositionAttr.needsUpdate = true;
  if (aspect < 0.8) {
    tree.position.set(0, -1.1, 0);
    tree.scale.setScalar(.9);
    textAnchorX = 0;
    textCloud.scale.setScalar(.55);
    groundRoot.scale.set(.58, .68, 1);
  } else {
    tree.position.set(Math.min(viewW * .22, 4.2), -.2, 0);
    tree.scale.setScalar(1);
    textAnchorX = -3.1;
    textCloud.scale.setScalar(.75);
    groundRoot.scale.set(1, 1, 1);
  }
  textCloud.position.x = textAnchorX;
  groundRoot.position.set(tree.position.x, tree.position.y - HEIGHT * .53 - .38, 1.35);
}

// Soft point sprites keep the particle field legible without heavy post-processing.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,248,1)');
  g.addColorStop(.12, 'rgba(255,244,211,.95)');
  g.addColorStop(.36, 'rgba(184,215,142,.38)');
  g.addColorStop(1, 'rgba(125,175,112,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTexture = makeGlowTexture();

// Atmospheric lights and distant stars form a restrained, fully rendered 3D backdrop.
function createDistantField() {
  const rng = mulberry32(19);
  const starPositions = [];
  const starColors = [];
  const starCount = 1900;
  const palette = [new THREE.Color('#e8f3dc'), new THREE.Color('#d2debd'), new THREE.Color('#c98b48'), new THREE.Color('#f5e6b8')];
  for (let i = 0; i < starCount; i++) {
    starPositions.push((rng() - .5) * 42, (rng() - .5) * 24, -8 - rng() * 15);
    const col = palette[Math.floor(rng() * palette.length)].clone().multiplyScalar(.42 + rng() * .48);
    starColors.push(col.r, col.g, col.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(starColors, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, map: glowTexture, vertexColors: true, transparent: true, opacity: .8, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending }));
  scene.add(pts);
  scene.userData.stars = pts;

  const hazeColors = ['#153b29', '#714037', '#254c31', '#93672e', '#273d2b'];
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.SpriteMaterial({ map: glowTexture, color: hazeColors[i % hazeColors.length], transparent: true, opacity: .10 + rng() * .14, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(mat);
    const scale = 1.1 + rng() * 3.2;
    sprite.scale.set(scale, scale, 1);
    sprite.position.set((rng() - .5) * 27, (rng() - .5) * 13, -5 - rng() * 7);
    scene.add(sprite);
  }
}
createDistantField();

const tree = new THREE.Group();
const treeDecorations = [];
world.add(tree);
const HEIGHT = 11.7;
const MAX_R = 3.7;
const PARTICLES = 33000;
const home = new Float32Array(PARTICLES * 3);
const scatter = new Float32Array(PARTICLES * 3);
const current = new Float32Array(PARTICLES * 3);
const colors = new Float32Array(PARTICLES * 3);
const phases = new Float32Array(PARTICLES);
const sizes = new Float32Array(PARTICLES);
const rand = mulberry32(20261225);
const treeColors = [new THREE.Color('#1c5636'), new THREE.Color('#347c4b'), new THREE.Color('#75a562'), new THREE.Color('#d3ae56'), new THREE.Color('#f0e2b5')];

const SNOW_COUNT = window.innerWidth < 760 ? 54 : 92;
const snowPositions = new Float32Array(SNOW_COUNT * 3);
const snowSpeeds = new Float32Array(SNOW_COUNT);
const snowPhases = new Float32Array(SNOW_COUNT);
const snowGeo = new THREE.BufferGeometry();
for (let i = 0; i < SNOW_COUNT; i++) {
  const j = i * 3;
  snowPositions[j] = camera.left + rand() * (camera.right - camera.left);
  snowPositions[j + 1] = camera.bottom + rand() * (camera.top - camera.bottom);
  snowPositions[j + 2] = 5 + rand() * 8;
  snowSpeeds[i] = .24 + rand() * .38;
  snowPhases[i] = rand() * Math.PI * 2;
}
const snowPositionAttr = new THREE.BufferAttribute(snowPositions, 3);
snowPositionAttr.setUsage(THREE.DynamicDrawUsage);
snowGeo.setAttribute('position', snowPositionAttr);
const snowCanvas = document.createElement('canvas');
snowCanvas.width = snowCanvas.height = 64;
const snowCtx = snowCanvas.getContext('2d');
snowCtx.strokeStyle = '#fff8eb'; snowCtx.lineWidth = 3.2; snowCtx.lineCap = 'round';
for (let arm = 0; arm < 6; arm++) {
  const a = arm * Math.PI / 3;
  const x = Math.cos(a), y = Math.sin(a);
  snowCtx.beginPath(); snowCtx.moveTo(32, 32); snowCtx.lineTo(32 + x * 25, 32 + y * 25); snowCtx.stroke();
  for (const end of [.55, .78]) {
    const bx = 32 + x * 25 * end, by = 32 + y * 25 * end;
    for (const dir of [-1, 1]) {
      snowCtx.beginPath(); snowCtx.moveTo(bx, by); snowCtx.lineTo(bx - x * 6 - y * 5 * dir, by - y * 6 + x * 5 * dir); snowCtx.stroke();
    }
  }
}
const snowTexture = new THREE.CanvasTexture(snowCanvas);
const snowMaterial = new THREE.PointsMaterial({ map: snowTexture, color: '#fff3dd', size: 7, transparent: true, opacity: .72, depthWrite: false, sizeAttenuation: false });
const snowField = new THREE.Points(snowGeo, snowMaterial);
snowField.renderOrder = 5;
scene.add(snowField);

function setParticle(i, x, y, z, color, size) {
  const j = i * 3;
  home[j] = x; home[j + 1] = y; home[j + 2] = z;
  current[j] = x; current[j + 1] = y; current[j + 2] = z;
  const spreadRadius = 3 + Math.pow(rand(), .58) * 8.8;
  const az = rand() * Math.PI * 2;
  const el = Math.acos(rand() * 2 - 1);
  scatter[j] = Math.cos(az) * Math.sin(el) * spreadRadius;
  scatter[j + 1] = Math.cos(el) * spreadRadius * .72;
  scatter[j + 2] = Math.sin(az) * Math.sin(el) * spreadRadius;
  colors[j] = color.r; colors[j + 1] = color.g; colors[j + 2] = color.b;
  phases[i] = rand() * Math.PI * 2;
  sizes[i] = size;
}

let particleIndex = 0;
for (let i = 0; i < 20500; i++) {
  const t = Math.pow(rand(), .93);
  const angle = rand() * Math.PI * 2;
  const radius = MAX_R * (1 - t) * Math.sqrt(rand());
  const branch = .15 * Math.sin(angle * 9 + t * 44) * t;
  const r = Math.max(.025, radius + branch);
  const c = treeColors[Math.floor(rand() * treeColors.length)].clone().multiplyScalar(.68 + rand() * .48);
  setParticle(particleIndex++, Math.cos(angle) * r, (t - .5) * HEIGHT, Math.sin(angle) * r, c, .7 + rand() * 1.3);
}
for (let tier = 0; tier < 22; tier++) {
  const t = .06 + tier / 23 * .88;
  const radius = MAX_R * (1 - t);
  const branchCount = Math.max(7, Math.floor(16 * (1 - .52 * t)));
  for (let b = 0; b < branchCount; b++) {
    const a = b * Math.PI * 2 / branchCount + tier * .43 + rand() * .19;
    const steps = 35;
    for (let k = 0; k < steps; k++) {
      const q = k / (steps - 1);
      const rr = radius * (.1 + .92 * q);
      const droop = .16 + .34 * q * q;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const y = (t - .5) * HEIGHT - droop + .045 * Math.sin(q * 8 + a) * radius;
      const c = treeColors[(k + b + tier) % treeColors.length].clone().multiplyScalar(.72 + rand() * .52);
      setParticle(particleIndex++, x, y, z, c, .9 + rand() * 1.3);
    }
  }
}
for (; particleIndex < PARTICLES; particleIndex++) {
  const angle = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * 2.25;
  const c = treeColors[Math.floor(rand() * treeColors.length)].clone().multiplyScalar(.42 + rand() * .42);
  setParticle(particleIndex, Math.cos(angle) * r, -HEIGHT * .49 + rand() * .16, Math.sin(angle) * r, c, .6 + rand());
}
const particleGeo = new THREE.BufferGeometry();
const positionAttr = new THREE.BufferAttribute(current, 3);
positionAttr.setUsage(THREE.DynamicDrawUsage);
particleGeo.setAttribute('position', positionAttr);
particleGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
const pointMaterial = new THREE.PointsMaterial({ size: 3.6, map: glowTexture, vertexColors: true, transparent: true, opacity: .91, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const treePoints = new THREE.Points(particleGeo, pointMaterial);
tree.add(treePoints);

const TEXT_COUNT = 10500;
const textStart = new Float32Array(TEXT_COUNT * 3);
const textShape = new Float32Array(TEXT_COUNT * 3);
const heartShape = new Float32Array(TEXT_COUNT * 3);
const textCurrent = new Float32Array(TEXT_COUNT * 3);
const textColors = new Float32Array(TEXT_COUNT * 3);
const heartBurstVelocity = new Float32Array(TEXT_COUNT * 3);
const greetingColors = new Float32Array(TEXT_COUNT * 3);
const heartColors = new Float32Array(TEXT_COUNT * 3);
const textCanvas = document.createElement('canvas');
textCanvas.width = 1024; textCanvas.height = 240;
const textCtx = textCanvas.getContext('2d');
textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
textCtx.fillStyle = '#fff';
textCtx.textAlign = 'center'; textCtx.textBaseline = 'middle';
textCtx.font = '400 92px "Playwrite US Trad", "Snell Roundhand", "Apple Chancery", "Segoe Script", "Brush Script MT", cursive';
textCtx.fillText('Merry Christmas', textCanvas.width / 2, textCanvas.height / 2 + 2);
const textImage = textCtx.getImageData(0, 0, textCanvas.width, textCanvas.height).data;
const textPixels = [];
for (let y = 0; y < textCanvas.height; y += 3) {
  for (let x = 0; x < textCanvas.width; x += 3) {
    if (textImage[(y * textCanvas.width + x) * 4 + 3] > 96) textPixels.push([x, y]);
  }
}
if (!textPixels.length) textPixels.push([512, 120]);
const heartCanvas = document.createElement('canvas');
heartCanvas.width = 1024; heartCanvas.height = 240;
const heartCtx = heartCanvas.getContext('2d');
heartCtx.beginPath();
heartCtx.moveTo(512, 213);
heartCtx.bezierCurveTo(470, 179, 322, 100, 352, 53);
heartCtx.bezierCurveTo(377, 13, 464, 24, 512, 83);
heartCtx.bezierCurveTo(560, 24, 647, 13, 672, 53);
heartCtx.bezierCurveTo(702, 100, 554, 179, 512, 213);
heartCtx.closePath();
heartCtx.fillStyle = '#fff'; heartCtx.fill();
const heartImage = heartCtx.getImageData(0, 0, heartCanvas.width, heartCanvas.height).data;
const heartPixels = [];
for (let y = 0; y < heartCanvas.height; y += 3) {
  for (let x = 0; x < heartCanvas.width; x += 3) {
    if (heartImage[(y * heartCanvas.width + x) * 4 + 3] > 96) heartPixels.push([x, y]);
  }
}
if (!heartPixels.length) heartPixels.push([512, 120]);
const textPalette = ['#fff3d3', '#e7c35b', '#c7464b', '#68a66d'].map(color => new THREE.Color(color));
const heartPalette = ['#fff0f0', '#f2a4b1', '#d14350'].map(color => new THREE.Color(color));
for (let i = 0; i < TEXT_COUNT; i++) {
  const j = i * 3;
  const pixel = textPixels[i % textPixels.length];
  const x = (pixel[0] / textCanvas.width - .5) * 6.2;
  const y = (.5 - pixel[1] / textCanvas.height) * 1.8;
  textShape[j] = x; textShape[j + 1] = y; textShape[j + 2] = 4.65 + rand() * .45;
  const heartPixel = heartPixels[Math.floor(rand() * heartPixels.length)];
  heartShape[j] = ((heartPixel[0] + (rand() - .5) * 4) / heartCanvas.width - .5) * 12;
  heartShape[j + 1] = (.5 - (heartPixel[1] + (rand() - .5) * 4) / heartCanvas.height) * 4.2;
  heartShape[j + 2] = 4.35 + rand() * .95;
  const burstAngle = rand() * Math.PI * 2;
  const burstSpeed = 1.2 + rand() * 2.4;
  heartBurstVelocity[j] = Math.cos(burstAngle) * burstSpeed;
  heartBurstVelocity[j + 1] = Math.sin(burstAngle) * burstSpeed;
  heartBurstVelocity[j + 2] = (rand() - .5) * 1.2;
  textStart[j] = (rand() - .5) * 10.5;
  textStart[j + 1] = (rand() - .5) * 5.7;
  textStart[j + 2] = 1.2 + rand() * 7.2;
  textCurrent[j] = textStart[j]; textCurrent[j + 1] = textStart[j + 1]; textCurrent[j + 2] = textStart[j + 2];
  const color = textPalette[i % textPalette.length];
  greetingColors[j] = color.r; greetingColors[j + 1] = color.g; greetingColors[j + 2] = color.b;
  textColors[j] = color.r; textColors[j + 1] = color.g; textColors[j + 2] = color.b;
  const heartColor = heartPalette[Math.floor(rand() * heartPalette.length)];
  heartColors[j] = heartColor.r; heartColors[j + 1] = heartColor.g; heartColors[j + 2] = heartColor.b;
}
const textGeometry = new THREE.BufferGeometry();
const textPositionAttr = new THREE.BufferAttribute(textCurrent, 3);
textPositionAttr.setUsage(THREE.DynamicDrawUsage);
textGeometry.setAttribute('position', textPositionAttr);
const textColorAttr = new THREE.BufferAttribute(textColors, 3);
textColorAttr.setUsage(THREE.DynamicDrawUsage);
textGeometry.setAttribute('color', textColorAttr);
const textMaterial = new THREE.PointsMaterial({ size: 4.1, map: glowTexture, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const textCloud = new THREE.Points(textGeometry, textMaterial);
textCloud.renderOrder = 4;
tree.add(textCloud);

const HEART_SPARK_COUNT = 720;
const heartSparkPositions = new Float32Array(HEART_SPARK_COUNT * 3);
const heartSparkAngles = new Float32Array(HEART_SPARK_COUNT);
const heartSparkRadiusX = new Float32Array(HEART_SPARK_COUNT);
const heartSparkRadiusY = new Float32Array(HEART_SPARK_COUNT);
const heartSparkSpeeds = new Float32Array(HEART_SPARK_COUNT);
const heartSparkPhases = new Float32Array(HEART_SPARK_COUNT);
const heartSparkColors = new Float32Array(HEART_SPARK_COUNT * 3);
const sparkPalette = ['#fff3dc', '#f3b2c2', '#df6486'].map(color => new THREE.Color(color));
for (let i = 0; i < HEART_SPARK_COUNT; i++) {
  const j = i * 3;
  heartSparkAngles[i] = rand() * Math.PI * 2;
  heartSparkRadiusX[i] = 2.45 + rand() * .95;
  heartSparkRadiusY[i] = 1.75 + rand() * .65;
  heartSparkSpeeds[i] = (rand() > .5 ? 1 : -1) * (.14 + rand() * .28);
  heartSparkPhases[i] = rand() * Math.PI * 2;
  const color = sparkPalette[Math.floor(rand() * sparkPalette.length)];
  heartSparkColors[j] = color.r; heartSparkColors[j + 1] = color.g; heartSparkColors[j + 2] = color.b;
}
const heartSparkGeometry = new THREE.BufferGeometry();
const heartSparkPositionAttr = new THREE.BufferAttribute(heartSparkPositions, 3);
heartSparkPositionAttr.setUsage(THREE.DynamicDrawUsage);
heartSparkGeometry.setAttribute('position', heartSparkPositionAttr);
heartSparkGeometry.setAttribute('color', new THREE.Float32BufferAttribute(heartSparkColors, 3));
const heartSparkMaterial = new THREE.PointsMaterial({ size: 3.1, map: glowTexture, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const heartSparkles = new THREE.Points(heartSparkGeometry, heartSparkMaterial);
heartSparkles.renderOrder = 5;
tree.add(heartSparkles);

const ribbonCount = 7600;
const ribbonBase = new Float32Array(ribbonCount * 3);
const ribbonCurrent = new Float32Array(ribbonCount * 3);
const ribbonColors = new Float32Array(ribbonCount * 3);
const ribbonPhase = new Float32Array(ribbonCount);
const ribbonRate = new Float32Array(ribbonCount);
const ribbonPalette = ['#f5e6b2', '#bd3e45', '#537d45', '#e0bc53'].map(c => new THREE.Color(c));
for (let i = 0; i < ribbonCount; i++) {
  const t = .035 + rand() * .93;
  const strand = i % 2;
  const angle = t * Math.PI * 2 * 5.1 + strand * Math.PI + (rand() - .5) * .13;
  const radius = MAX_R * (1 - t) * (.95 + (rand() - .5) * .1);
  const j = i * 3;
  ribbonBase[j] = Math.cos(angle) * radius;
  ribbonBase[j + 1] = (t - .5) * HEIGHT + .11 * Math.sin(angle * 1.6);
  ribbonBase[j + 2] = Math.sin(angle) * radius;
  ribbonCurrent[j] = ribbonBase[j]; ribbonCurrent[j + 1] = ribbonBase[j + 1]; ribbonCurrent[j + 2] = ribbonBase[j + 2];
  const color = ribbonPalette[Math.floor(rand() * ribbonPalette.length)].clone().multiplyScalar(.75 + rand() * .48);
  ribbonColors[j] = color.r; ribbonColors[j + 1] = color.g; ribbonColors[j + 2] = color.b;
  ribbonPhase[i] = rand() * Math.PI * 2;
  ribbonRate[i] = .055 + t * .085;
}
const ribbonGeo = new THREE.BufferGeometry();
const ribbonAttr = new THREE.BufferAttribute(ribbonCurrent, 3);
ribbonAttr.setUsage(THREE.DynamicDrawUsage);
ribbonGeo.setAttribute('position', ribbonAttr);
ribbonGeo.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3));
const ribbonMaterial = new THREE.PointsMaterial({ size: 5.2, map: glowTexture, vertexColors: true, transparent: true, opacity: .88, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const ribbonPoints = new THREE.Points(ribbonGeo, ribbonMaterial);
ribbonPoints.renderOrder = 2;
tree.add(ribbonPoints);

const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: '#5a8d48', transparent: true, opacity: .17, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending }));
aura.position.set(0, -.1, -4.25);
aura.scale.set(10.5, 13.5, 1);
aura.renderOrder = -1;
tree.add(aura);

const branchGeometry = new THREE.BufferGeometry();
const linePositions = [];
const lineColors = [];
for (let tier = 1; tier <= 14; tier++) {
  const t = tier / 15;
  const radius = MAX_R * (1 - t);
  const y = (t - .5) * HEIGHT - .23;
  for (let i = 0; i <= 100; i++) {
    const a = i / 100 * Math.PI * 2;
    const r = radius * (.18 + .82 * ((i % 12) / 12));
    linePositions.push(Math.cos(a) * r, y - .25 * ((i % 12) / 12), Math.sin(a) * r);
    lineColors.push(.055, .19 + .13 * Math.sin(a * 3), .075);
  }
}
branchGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
branchGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
const branchLines = new THREE.LineSegments(branchGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .28, blending: THREE.AdditiveBlending }));
tree.add(branchLines);

const ornamentMaterial = new THREE.MeshStandardMaterial({ color: '#e8be73', metalness: .82, roughness: .2, emissive: '#6e3c13', emissiveIntensity: .45 });
const ornamentGeometry = new THREE.SphereGeometry(.085, 14, 10);
for (let i = 0; i < 27; i++) {
  const t = .12 + rand() * .77;
  const a = rand() * Math.PI * 2;
  const r = MAX_R * (1 - t) * (.65 + rand() * .3);
  const bead = new THREE.Mesh(ornamentGeometry, ornamentMaterial);
  bead.position.set(Math.cos(a) * r, (t - .5) * HEIGHT - .05, Math.sin(a) * r);
  tree.add(bead); treeDecorations.push(bead);
}

const baubleGeometry = new THREE.SphereGeometry(.145, 18, 14);
const baubleColors = [
  new THREE.MeshStandardMaterial({ color: '#a53843', metalness: .48, roughness: .2, emissive: '#3b0d12', emissiveIntensity: .5 }),
  new THREE.MeshStandardMaterial({ color: '#467650', metalness: .42, roughness: .24, emissive: '#102718', emissiveIntensity: .48 }),
  new THREE.MeshStandardMaterial({ color: '#e5c991', metalness: .78, roughness: .18, emissive: '#68451b', emissiveIntensity: .38 }),
];
const baubleCapMaterial = new THREE.MeshStandardMaterial({ color: '#e8cc91', metalness: .84, roughness: .22, emissive: '#4b3516', emissiveIntensity: .3 });
const baubleCapGeometry = new THREE.CylinderGeometry(.045, .058, .085, 8);
for (let i = 0; i < 16; i++) {
  const t = .16 + (i % 7) / 8;
  const a = .22 + (i * 2.399) % 2.7;
  const r = MAX_R * (1 - t) * .9;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r + .1;
  const y = (t - .5) * HEIGHT - .06;
  const ball = new THREE.Mesh(baubleGeometry, baubleColors[i % baubleColors.length]);
  ball.position.set(x, y, z);
  tree.add(ball);
  const cap = new THREE.Mesh(baubleCapGeometry, baubleCapMaterial);
  cap.position.set(x, y + .17, z);
  tree.add(cap);
  treeDecorations.push(ball, cap);
}

function makePresent({ x, y, z, width, height, depth, color, ribbon }) {
  const gift = new THREE.Group();
  gift.position.set(x, y, z);
  const boxMat = new THREE.MeshStandardMaterial({ color, metalness: .16, roughness: .32, emissive: color, emissiveIntensity: .12 });
  const ribbonMat = new THREE.MeshStandardMaterial({ color: ribbon, metalness: .48, roughness: .24, emissive: ribbon, emissiveIntensity: .18 });
  gift.add(new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), boxMat));
  gift.add(new THREE.Mesh(new THREE.BoxGeometry(Math.max(.11, width * .15), height + .012, depth + .018), ribbonMat));
  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(width + .018, .09, depth + .024), ribbonMat);
  lidBand.position.y = height * .25;
  gift.add(lidBand);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(width + .045, .105, depth + .045), boxMat);
  lid.position.y = height * .5 + .02;
  gift.add(lid);
  const loopGeometry = new THREE.TorusGeometry(width * .105, .035, 7, 16);
  const leftLoop = new THREE.Mesh(loopGeometry, ribbonMat);
  leftLoop.scale.set(1.1, .72, .58); leftLoop.position.set(-width * .11, height * .5 + .2, .015);
  const rightLoop = leftLoop.clone(); rightLoop.position.x = width * .11; rightLoop.rotation.z = Math.PI;
  const knot = new THREE.Mesh(new THREE.SphereGeometry(.065, 10, 8), ribbonMat);
  knot.position.set(0, height * .5 + .2, .04);
  gift.add(leftLoop, rightLoop, knot);
  tree.add(gift); treeDecorations.push(gift);
  return gift;
}
const presents = [
  makePresent({ x: -1.98, y: -5.02, z: 4.12, width: 1.02, height: .82, depth: .84, color: '#a63845', ribbon: '#e7c98e' }),
  makePresent({ x: 2.0, y: -5.02, z: 4.18, width: .96, height: .82, depth: .82, color: '#36704f', ribbon: '#d8b670' }),
  makePresent({ x: .12, y: -5.32, z: 4.55, width: .7, height: .58, depth: .64, color: '#bd8750', ribbon: '#f0ddba' }),
];
treeDecorations.forEach(object => {
  object.userData.revealHeight = THREE.MathUtils.clamp((object.position.y + HEIGHT * .5) / HEIGHT, 0, 1);
  object.userData.revealY = object.position.y;
  object.userData.revealScale = object.scale.clone();
});

const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: '#ffca75', transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending }));
halo.position.set(0, HEIGHT * .5 + .25, 0);
halo.scale.set(3.0, 3.0, 1);
tree.add(halo);
const starShape = new THREE.Shape();
for (let i = 0; i < 10; i++) {
  const r = i % 2 === 0 ? .42 : .19;
  const a = Math.PI / 2 + i * Math.PI / 5;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
}
starShape.closePath();
const star = new THREE.Mesh(new THREE.ShapeGeometry(starShape), new THREE.MeshBasicMaterial({ color: '#fff0bd', side: THREE.DoubleSide }));
star.position.set(0, HEIGHT * .5 + .28, .1);
tree.add(star);
const starLight = new THREE.PointLight('#ffc56d', 4, 7);
starLight.position.copy(star.position);
tree.add(starLight);

const floor = new THREE.Group();
floor.position.y = -HEIGHT * .53;
tree.add(floor);
for (let ring = 0; ring < 3; ring++) {
  const geo = new THREE.RingGeometry(1.25 + ring * .48, 1.28 + ring * .48, 96);
  const mat = new THREE.MeshBasicMaterial({ color: ring === 1 ? '#b63b43' : '#d9b54e', side: THREE.DoubleSide, transparent: true, opacity: ring === 1 ? .28 : .14, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -.22 + ring * .003;
  mesh.userData.baseOpacity = mat.opacity;
  floor.add(mesh);
}

const groundRoot = new THREE.Group();
scene.add(groundRoot);
const GROUND_COUNT = 2800;
const groundPositions = new Float32Array(GROUND_COUNT * 3);
const groundColors = new Float32Array(GROUND_COUNT * 3);
const groundPalette = ['#f8f3df', '#c6d6b6', '#d8b64e', '#9b343d'].map(color => new THREE.Color(color));
for (let i = 0; i < GROUND_COUNT; i++) {
  const j = i * 3;
  const radius = .75 + rand() * 6.25;
  const angle = rand() * Math.PI * 2 + radius * .72;
  groundPositions[j] = Math.cos(angle) * radius + (rand() - .5) * .16;
  groundPositions[j + 1] = Math.sin(angle) * radius * .22 + .11 * Math.sin(radius * 2.1) + (rand() - .5) * .12;
  groundPositions[j + 2] = (rand() - .5) * 1.2;
  const color = groundPalette[Math.floor(rand() * groundPalette.length)];
  const brightness = .35 + rand() * .85;
  groundColors[j] = color.r * brightness;
  groundColors[j + 1] = color.g * brightness;
  groundColors[j + 2] = color.b * brightness;
}
const groundGeometry = new THREE.BufferGeometry();
groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(groundPositions, 3));
groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3));
const groundMaterial = new THREE.PointsMaterial({ size: 2.1, map: glowTexture, vertexColors: true, transparent: true, opacity: .68, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const groundPoints = new THREE.Points(groundGeometry, groundMaterial);
groundPoints.renderOrder = 1;
groundRoot.add(groundPoints);
const FIREWORK_COUNT = 900;
const fireworkPositions = new Float32Array(FIREWORK_COUNT * 3);
const fireworkColors = new Float32Array(FIREWORK_COUNT * 3);
const fireworkVelocity = new Float32Array(FIREWORK_COUNT * 3);
const fireworkCenters = new Float32Array(FIREWORK_COUNT * 3);
const fireworkPalette = ['#fff2cf', '#e7c35b', '#c7464b', '#68a66d'].map(color => new THREE.Color(color));
for (let i = 0; i < FIREWORK_COUNT; i++) {
  const j = i * 3;
  const shell = i % 3;
  fireworkCenters[j] = [-3.1, 0, 3.1][shell];
  fireworkCenters[j + 1] = shell === 1 ? 4.45 : 2.25;
  fireworkCenters[j + 2] = 4.15;
  const angle = rand() * Math.PI * 2;
  const speed = .8 + rand() * 2.8;
  fireworkVelocity[j] = Math.cos(angle) * speed;
  fireworkVelocity[j + 1] = Math.sin(angle) * speed;
  fireworkVelocity[j + 2] = (rand() - .5) * 1.3;
  const color = fireworkPalette[(shell + (rand() > .72 ? 1 : 0)) % fireworkPalette.length];
  fireworkColors[j] = color.r; fireworkColors[j + 1] = color.g; fireworkColors[j + 2] = color.b;
}
const fireworkGeometry = new THREE.BufferGeometry();
const fireworkPositionAttr = new THREE.BufferAttribute(fireworkPositions, 3);
fireworkPositionAttr.setUsage(THREE.DynamicDrawUsage);
fireworkGeometry.setAttribute('position', fireworkPositionAttr);
fireworkGeometry.setAttribute('color', new THREE.Float32BufferAttribute(fireworkColors, 3));
const fireworkMaterial = new THREE.PointsMaterial({ size: 4.3, map: glowTexture, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false, blending: THREE.AdditiveBlending });
const fireworks = new THREE.Points(fireworkGeometry, fireworkMaterial);
fireworks.renderOrder = 5;
tree.add(fireworks);

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeCardTexture(image, label) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ead7b8';
  roundRect(ctx, 7, 7, 498, 626, 22);
  ctx.fill();
  ctx.strokeStyle = '#c49b5b'; ctx.lineWidth = 5;
  roundRect(ctx, 10, 10, 492, 620, 20); ctx.stroke();
  const x = 28, y = 28, w = 456, h = 520;
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale, sh = h / scale;
  const sx = (image.width - sw) / 2, sy = (image.height - sh) / 2;
  ctx.save(); roundRect(ctx, x, y, w, h, 12); ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
  const veil = ctx.createLinearGradient(0, 460, 0, 552);
  veil.addColorStop(0, 'rgba(36,22,15,0)'); veil.addColorStop(1, 'rgba(36,22,15,.3)');
  ctx.fillStyle = veil; ctx.fillRect(x, 450, w, 100);
  ctx.fillStyle = '#75522b'; ctx.font = '600 22px Georgia, serif'; ctx.textAlign = 'center';
  const caption = (label || 'OUR MEMORY').toUpperCase().slice(0, 23);
  ctx.fillText(caption, 256, 594);
  for (const px of [23, 489]) {
    ctx.beginPath(); ctx.arc(px, 320, 5, 0, Math.PI * 2); ctx.fillStyle = '#967044'; ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

function createPhotoObject(image, name, id, blob) {
  const tex = makeCardTexture(image, name.replace(/\.[^.]+$/, ''));
  const material = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: .98, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  const scale = window.innerWidth / window.innerHeight < .8 ? .68 : .76;
  sprite.scale.set(scale * .79, scale, 1);
  const t = .16 + (photoObjects.length % 9) / 10;
  const a = -1.15 + (photoObjects.length % 5) * .5;
  const r = MAX_R * (1 - t) * .88;
  sprite.position.set(Math.sin(a) * r, (t - .5) * HEIGHT, Math.cos(a) * r + .28);
  sprite.userData = { photoId: id, basePosition: sprite.position.clone(), baseScale: sprite.scale.clone(), selected: false, targetOpacity: .98, name };
  tree.add(sprite);
  photoObjects.push(sprite);
  memories.push({ id, name, blob });
  updatePhotoUI();
}
function updatePhotoUI() {
  const n = photoObjects.length;
  $('#photoCount').querySelector('.count-number').textContent = String(n).padStart(2, '0');
  $('#cyclePhoto').disabled = n === 0;
  $('#removePhoto').disabled = n === 0;
  $('#photoIndex').textContent = n ? `NO. ${String(state.selectedPhoto + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}` : 'NO. 00';
  $('#photoName').textContent = n ? photoObjects[state.selectedPhoto]?.userData.name.replace(/\.[^.]+$/, '') : '星光正为你亮起';
}
function focusPhoto(index = state.selectedPhoto) {
  if (!photoObjects.length) { showToast('先加入一张你们的照片吧'); return; }
  state.selectedPhoto = (index + photoObjects.length) % photoObjects.length;
  state.photoFocus = true;
  $('#experience').classList.add('photo-focus');
  state.spreadTarget = 0;
  photoObjects.forEach((p, i) => {
    p.userData.selected = i === state.selectedPhoto;
    p.userData.targetOpacity = i === state.selectedPhoto ? 1 : .08;
  });
  updatePhotoUI();
}
function dismissFocus() {
  state.photoFocus = false;
  $('#experience').classList.remove('photo-focus');
  photoObjects.forEach((p) => { p.userData.selected = false; p.userData.targetOpacity = .98; });
}
function nextPhoto(step = 1) {
  if (!photoObjects.length) { showToast('先加入一张你们的照片吧'); return; }
  focusPhoto(state.selectedPhoto + step);
  showToast(`正在看第 ${state.selectedPhoto + 1} 张回忆`);
}

const DB_NAME = 'our-little-universe';
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function savePhoto(blob, name, id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put({ id, name, blob, created: Date.now() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) { console.warn('Local photo storage unavailable:', e); }
}
const BUNDLED_PHOTOS = [
  '1287b3022cf40a986c49cdd84ab817b3.jpg',
  '232b05930ad85b4767c814eec620c7ef.jpg',
  '495348b62c454f26e37734384908369e.jpg',
  '6acb78fd10f2bf39c1dd0975214a8b3b.jpg',
  '751450bdbf36b0b13473b0627bdb1513.jpg',
  '82bb28df4ab025e01800211b9b9a82a6.jpg',
  '8859c55dc5bfbbb3e0f5460c59ff9c5f.jpg',
  '8ca382e7b440eb6d07197ff9ccfa0d36.jpg',
  '977dd47c3cbc428e38627f2bcdd91fae.jpg',
  '9cebd4c98977ea4457635e1ac17cdc3c.jpg',
  'a9af3e52b2bf802227a7ae731dceeef8.jpg',
  'af8e6713a557b8611c744f917f6c96ed.jpg',
  'c0ced1c2f71f6bbec8bb7bc9e00c50ae.jpg',
  'e5122df8a9f1ea85f6f12a2bd9d57b4f.jpg',
  'fce464cf56db0071e2a057ebd5589300.jpg',
];
async function loadBundledPhotos() {
  let loadedCount = 0;
  await Promise.all(BUNDLED_PHOTOS.map((file, index) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      loadedCount += 1;
      createPhotoObject(image, `闺蜜回忆 ${String(index + 1).padStart(2, '0')}.jpg`, `bundled-${index + 1}`, null);
      resolve();
    };
    image.onerror = () => {
      console.warn('Could not load bundled photo:', file);
      resolve();
    };
    image.src = new URL(`photos/${file}`, import.meta.url).href;
  })));
  if (!loadedCount) showToast('照片暂时没加载出来，请刷新页面重试');
}
async function restorePhotos() {
  try { await loadBundledPhotos(); }
  catch (e) { console.warn('Could not load bundled photos:', e); }
  if (!('indexedDB' in window) || photoObjects.length >= 20) { updatePhotoUI(); return; }
  try {
    const db = await openDB();
    const items = await new Promise((resolve, reject) => {
      const req = db.transaction('photos', 'readonly').objectStore('photos').getAll();
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    db.close();
    items.sort((a, b) => a.created - b.created);
    for (const item of items.slice(0, Math.max(0, 20 - photoObjects.length))) {
      const url = URL.createObjectURL(item.blob);
      await loadPhotoImage(url, item.name, item.id, item.blob);
    }
  } catch (e) { console.warn('Could not restore local photos:', e); }
}
function loadPhotoImage(src, name, id, blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { createPhotoObject(image, name, id, blob); resolve(); };
    image.onerror = reject;
    image.src = src;
  });
}
$('#photoInput').addEventListener('change', async (event) => {
  const files = [...event.target.files].filter(f => f.type.startsWith('image/')).slice(0, Math.max(0, 20 - photoObjects.length));
  if (!files.length) { showToast(photoObjects.length >= 20 ? '最多可以收藏 20 张照片' : '请选择图片文件'); return; }
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) { showToast(`${file.name} 超过 15 MB，已跳过`); continue; }
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    await loadPhotoImage(url, file.name, id, file);
    await savePhoto(file, file.name, id);
  }
  state.selectedPhoto = Math.max(0, photoObjects.length - files.length);
  updatePhotoUI();
  showToast(`收下了 ${files.length} 张回忆`);
  event.target.value = '';
});

function beginGreeting() {
  state.charmPhase = 'formingGreeting';
  state.textProgress = 0;
  state.spreadTarget = 1;
  dismissFocus();
  $('#previewStatus').textContent = '星尘正在拼成祝福';
  setGestureText('粒子正在组成 Merry Christmas');
  showToast('星尘正在写下英文祝福');
}
function beginHeartCharm() {
  state.charmPhase = 'formingHeart';
  state.textProgress = 0;
  state.spreadTarget = 1;
  dismissFocus();
  $('#previewStatus').textContent = '祝福正在化作爱心';
  setGestureText('祝福碎成星尘，汇聚成大爱心');
  showToast('Merry Christmas 正在化作爱心');
}
function launchTreeReveal() {
  state.treeRevealFromHeart = ['heart', 'formingHeart'].includes(state.charmPhase);
  state.charmPhase = 'formingTree';
  state.textProgress = 0;
  state.spreadTarget = 0;
  state.fireworkProgress = 0;
  $('#previewStatus').textContent = '星火正在点亮圣诞树';
  $('#bloomTree').setAttribute('aria-pressed', 'false');
  $('#gatherTree').setAttribute('aria-pressed', 'true');
  setGestureText('粒子正从树底向上重组 · 烟花正在绽放');
  showToast('烟花绽放，星尘正从树底重组');
}
function scatterParticles(silent = false) {
  state.charmPhase = 'scattered';
  state.treeRevealFromHeart = false;
  state.textProgress = 0;
  state.spreadTarget = 1;
  state.fireworkProgress = 1;
  textMaterial.opacity = 0;
  pointMaterial.opacity = .91;
  dismissFocus();
  $('#bloomTree').setAttribute('aria-pressed', 'true');
  $('#gatherTree').setAttribute('aria-pressed', 'false');
  setGestureText('张掌 · 粒子雾已散开');
  if (!silent) showToast('粒子雾散开了');
}
function gatherParticles() {
  if (state.charmPhase === 'tree' || state.charmPhase === 'idle') return;
  launchTreeReveal();
}
function resetCharm() {
  state.charmPhase = 'idle';
  state.textProgress = 0;
  state.spreadTarget = 0;
  state.fireworkProgress = 1;
  textMaterial.opacity = 0;
  pointMaterial.opacity = .91;
  dismissFocus();
  applySpread(false);
  setGestureText(gestureLabel('none'));
}
function applySpread(on) {
  if (!on && ['formingGreeting', 'greeting', 'formingHeart', 'heart', 'formingTree', 'tree'].includes(state.charmPhase)) resetCharm();
  if (!on && state.charmPhase === 'scattered') state.charmPhase = 'idle';
  state.spreadTarget = on ? 1 : 0;
  if (on) dismissFocus();
  $('#bloomTree').setAttribute('aria-pressed', String(on));
  $('#gatherTree').setAttribute('aria-pressed', String(!on));
  $('#sceneCaption').style.opacity = on ? '.5' : '1';
  if (state.charmPhase === 'scattered' && !on) state.charmPhase = 'idle';
}
let playbackRun = 0;
let playbackPaused = false;
function setPlaybackButton(mode) {
  const button = $('#playbackToggle');
  const icon = $('#playbackIcon');
  const label = $('#playbackLabel');
  const playing = mode === 'playing';
  const paused = mode === 'paused';
  button.setAttribute('aria-pressed', String(playing || paused));
  button.setAttribute('aria-label', playing ? '暂停播放' : paused ? '继续播放' : '从头播放');
  icon.textContent = playing ? 'Ⅱ' : '▶';
  label.textContent = playing ? '暂停' : paused ? '继续' : '从头播放';
}
function cancelPlayback() {
  playbackRun += 1;
  playbackPaused = false;
  setPlaybackButton('stopped');
}
function waitPlayback(ms, run) {
  let remaining = ms;
  let last = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (run !== playbackRun) return resolve(false);
      if (!playbackPaused) remaining -= now - last;
      last = now;
      if (remaining <= 0) return resolve(true);
      window.setTimeout(tick, 50);
    };
    tick();
  });
}
async function waitForFormation(phase, run) {
  while (run === playbackRun && state.charmPhase === phase) {
    if (!await waitPlayback(80, run)) return false;
  }
  return run === playbackRun;
}
async function runStoryPlayback(run) {
  scatterParticles(true);
  showToast('演出即将开始');
  if (!await waitPlayback(1400, run)) return;
  beginGreeting();
  if (!await waitForFormation('formingGreeting', run) || !await waitPlayback(1800, run)) return;
  beginHeartCharm();
  if (!await waitForFormation('formingHeart', run) || !await waitPlayback(1600, run)) return;
  launchTreeReveal();
  if (!await waitForFormation('formingTree', run)) return;
  if (photoObjects.length) {
    showToast('圣诞树已点亮，回忆即将逐张展开');
    if (!await waitPlayback(1000, run)) return;
    setGestureText('回忆正在逐张亮相');
    for (let i = 0; i < photoObjects.length; i++) {
      if (run !== playbackRun) return;
      focusPhoto(i);
      if (!await waitPlayback(2500, run)) return;
    }
    dismissFocus();
    if (!await waitPlayback(1200, run)) return;
  }
  if (run === playbackRun) {
    setPlaybackButton('stopped');
    showToast(photoObjects.length ? `${photoObjects.length} 张回忆已依次亮相` : '圣诞树已点亮');
  }
}
$('#playbackToggle').addEventListener('click', () => {
  if (playbackPaused) {
    playbackPaused = false;
    setPlaybackButton('playing');
    return;
  }
  if ($('#playbackToggle').getAttribute('aria-pressed') === 'true') {
    playbackPaused = true;
    setPlaybackButton('paused');
    return;
  }
  cancelPlayback();
  const run = playbackRun;
  playbackPaused = false;
  setPlaybackButton('playing');
  runStoryPlayback(run);
});
function advanceScene() {
  cancelPlayback();
  if (state.charmPhase === 'idle') scatterParticles();
  else if (state.charmPhase === 'scattered') beginGreeting();
  else if (state.charmPhase === 'greeting') beginHeartCharm();
  else if (state.charmPhase === 'heart') launchTreeReveal();
  else if (state.charmPhase === 'tree') nextPhoto(1);
}
$('#bloomTree').addEventListener('click', () => { cancelPlayback(); applySpread(state.spreadTarget < .5); });
$('#gatherTree').addEventListener('click', () => { cancelPlayback(); applySpread(false); });
$('#cyclePhoto').addEventListener('click', () => { cancelPlayback(); nextPhoto(1); });
$('#removePhoto').addEventListener('click', async () => {
  if (!photoObjects.length) return;
  const index = state.selectedPhoto;
  const sprite = photoObjects[index];
  const id = sprite.userData.photoId;
  tree.remove(sprite);
  sprite.material.map?.dispose();
  sprite.material.dispose();
  photoObjects.splice(index, 1);
  memories.splice(index, 1);
  state.selectedPhoto = photoObjects.length ? index % photoObjects.length : 0;
  dismissFocus();
  updatePhotoUI();
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) { console.warn('Could not remove local photo:', e); }
  showToast('这张照片已从本机移除');
});

const dialog = $('#messageDialog');
const recipientInput = $('#recipientInput');
const noteInput = $('#noteInput');
const defaultRecipient = '我最爱的闺蜜';
const defaultNote = '愿我最爱的闺蜜，做自己想做的事情，永远不会被这现世所束缚，永远开心快乐——爱你的闺蜜';
function loadDedication() {
  const saved = JSON.parse(localStorage.getItem('our-little-universe-note') || 'null');
  if (!saved) return;
  if (saved.recipient === '最喜欢的你' && saved.note === '把这一年的星光，都留给你。') {
    saved.recipient = defaultRecipient;
    saved.note = defaultNote;
    localStorage.setItem('our-little-universe-note', JSON.stringify(saved));
  }
  recipientInput.value = saved.recipient;
  noteInput.value = saved.note;
  titleText.textContent = `祝${saved.recipient}`;
  messageText.textContent = saved.note;
}
function openMessageEditor() {
  recipientInput.value = titleText.textContent.replace(/^祝/, '');
  noteInput.value = messageText.textContent;
  dialog.showModal();
}
$('#editMessage').addEventListener('click', openMessageEditor);
$('#messageButton').addEventListener('click', openMessageEditor);
$('#cancelMessage').addEventListener('click', () => dialog.close());
$('#messageForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const recipient = recipientInput.value.trim() || defaultRecipient;
  const note = noteInput.value.trim() || defaultNote;
  titleText.textContent = `祝${recipient}`;
  messageText.textContent = note;
  localStorage.setItem('our-little-universe-note', JSON.stringify({ recipient, note }));
  dialog.close();
  showToast('这份心意，记下了');
});
loadDedication();

// Pointer dragging rotates the tree; clicking a photo opens its keepsake view.
const raycaster = new THREE.Raycaster();
raycaster.params.Sprite = { threshold: .32 };
let pointerStart = null;
let rotationTarget = 0;
canvas.addEventListener('pointerdown', (e) => {
  pointerStart = { x: e.clientX, y: e.clientY, rotation: rotationTarget };
  state.pointerMoved = false;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointerStart) return;
  const dx = e.clientX - pointerStart.x;
  if (Math.abs(dx) > 5) state.pointerMoved = true;
  if (state.pointerMoved) rotationTarget = pointerStart.rotation + dx * .006;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pointerStart) return;
  if (!state.pointerMoved) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(photoObjects, false)[0];
    if (hit) focusPhoto(photoObjects.indexOf(hit.object));
    else advanceScene();
  }
  pointerStart = null;
});
canvas.addEventListener('wheel', (e) => {
  if (e.deltaY > 0) applySpread(true); else applySpread(false);
}, { passive: true });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !dialog.open) { e.preventDefault(); applySpread(state.spreadTarget < .5); }
  if (e.code === 'ArrowRight' && !dialog.open) nextPhoto(1);
  if (e.code === 'ArrowLeft' && !dialog.open) nextPhoto(-1);
  if (e.code === 'Escape' && state.photoFocus) dismissFocus();
});

function setGestureText(text) { $('#gestureReadout').textContent = text; }
function gestureLabel(g) {
  return ({
    fist: '握拳 · 聚合成树',
    open: '张掌 · 释放粒子雾',
    pinch: state.charmPhase === 'tree' ? '捏合 · 下一张照片' : '捏合 · 下一步',
    point: '只识别动作 · 不推进演出',
    none: '捏合下一步/下一张 · 握拳聚合 · 张掌散开',
  })[g] || '等待手势';
}
function classifyHand(lm) {
  const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y) < .055;
  if (pinch) return 'pinch';
  const up = [8, 12, 16, 20].map((tip, i) => lm[tip].y < lm[[6, 10, 14, 18][i]].y - .015);
  const count = up.filter(Boolean).length;
  if (count >= 4) return 'open';
  if (count <= 1) return 'fist';
  return 'point';
}
function actOnGesture(g) {
  const now = performance.now();
  if (g === state.gesture) return;
  state.gesture = g;
  setGestureText(gestureLabel(g));
  $('#previewStatus').textContent = `识别到${g === 'open' ? '张掌' : g === 'fist' ? '握拳' : g === 'pinch' ? '捏合' : '手势'}`;
  if (now - lastGestureAction < 480) return;
  if (g === 'fist') { cancelPlayback(); gatherParticles(); }
  if (g === 'open') { cancelPlayback(); scatterParticles(); }
  if (g === 'pinch') advanceScene();
  lastGestureAction = now;
}
function drawHand(lm) {
  const rect = video.getBoundingClientRect();
  overlay.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  overlay.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!lm) return;
  const sx = overlay.width, sy = overlay.height;
  ctx.fillStyle = 'rgba(255, 221, 163, .9)';
  for (const i of [0, 4, 8, 12, 16, 20]) {
    ctx.beginPath(); ctx.arc(lm[i].x * sx, lm[i].y * sy, 3 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(247, 202, 131, .42)'; ctx.lineWidth = 1.2 * devicePixelRatio;
  for (const [a,b] of [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20]]) {
    ctx.beginPath(); ctx.moveTo(lm[a].x * sx, lm[a].y * sy); ctx.lineTo(lm[b].x * sx, lm[b].y * sy); ctx.stroke();
  }
}
function gestureLoop() {
  if (state.cameraOn && handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = handLandmarker.detectForVideo(video, performance.now());
      const hand = result.landmarks?.[0];
      drawHand(hand);
      if (hand) {
        state.handSeen = true;
        const g = classifyHand(hand);
        state.handX = hand[9].x;
        state.handY = hand[9].y;
        actOnGesture(g);
      } else {
        state.handSeen = false;
        state.gesture = 'none';
        $('#previewStatus').textContent = '等待手势';
        setGestureText(gestureLabel('none'));
        drawHand(null);
      }
    } catch (e) { console.warn('Hand tracking frame failed:', e); }
  }
  requestAnimationFrame(gestureLoop);
}
requestAnimationFrame(gestureLoop);

async function startCamera() {
  const button = $('#cameraToggle');
  button.disabled = true;
  $('#cameraLabel').textContent = '请求摄像头…';
  try {
    let cameraTimedOut = false;
    const cameraRequest = navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }).then(nextStream => {
      if (cameraTimedOut) {
        nextStream.getTracks().forEach(track => track.stop());
        throw new DOMException('Camera request timed out', 'TimeoutError');
      }
      return nextStream;
    });
    let timeoutId;
    try {
      stream = await Promise.race([cameraRequest, new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => { cameraTimedOut = true; reject(new DOMException('Camera request timed out', 'TimeoutError')); }, 15000);
      })]);
    } finally { window.clearTimeout(timeoutId); }
    video.srcObject = stream;
    await video.play();
    video.classList.add('ready');
    $('#cameraPlaceholder').hidden = true;
    preview.hidden = false;
    $('#previewStatus').textContent = '加载手势识别';
    $('#cameraLabel').textContent = '加载识别…';

    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm');
    const modelAssetPath = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    handLandmarker = await vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1 });

    state.cameraOn = true;
    scatterParticles(true);
    button.setAttribute('aria-pressed', 'true');
    $('#cameraLabel').textContent = '关闭手势';
    $('#previewStatus').textContent = '等待手势';
    showToast('手势已开启 · 摄像头画面只在本机处理');
  } catch (e) {
    console.error(e);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.pause(); video.srcObject = null; video.classList.remove('ready');
    if (handLandmarker) { handLandmarker.close(); handLandmarker = null; }
    $('#cameraPlaceholder').hidden = false;
    preview.hidden = true;
    const message = e?.name === 'NotAllowedError' ? '摄像头权限未开启，请在浏览器地址栏允许使用摄像头' : e?.name === 'TimeoutError' ? '摄像头启动超时，请检查浏览器权限或关闭占用摄像头的程序后重试' : '手势模块暂时不可用，仍可用鼠标和触屏操作';
    showToast(message);
    $('#cameraToggle').setAttribute('aria-pressed', 'false');
    $('#cameraLabel').textContent = '开启手势';
  } finally { button.disabled = false; }
}
function stopCamera() {
  state.cameraOn = false;
  if (state.charmPhase !== 'idle') {
    state.charmPhase = 'idle';
    state.textProgress = 0;
    state.fireworkProgress = 1;
    textMaterial.opacity = 0;
    pointMaterial.opacity = .91;
    applySpread(false);
  }
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.pause(); video.srcObject = null; video.classList.remove('ready');
  if (handLandmarker) { handLandmarker.close(); handLandmarker = null; }
  const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, overlay.width, overlay.height);
  $('#cameraPlaceholder').hidden = false;
  preview.hidden = true;
  $('#cameraToggle').setAttribute('aria-pressed', 'false');
  $('#cameraLabel').textContent = '开启手势';
  state.gesture = 'none';
  $('#previewStatus').textContent = '已暂停';
}
$('#cameraToggle').addEventListener('click', () => state.cameraOn ? stopCamera() : startCamera());
window.addEventListener('pagehide', stopCamera);

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), .05);
  const time = clock.elapsedTime;
  state.spread += (state.spreadTarget - state.spread) * .055;
  const pulse = .86 + .14 * Math.sin(time * 2.1);
  halo.material.opacity = .52 + .22 * pulse;
  halo.scale.setScalar(2.5 + .3 * pulse);
  star.rotation.z = Math.sin(time * .45) * .06;
  star.scale.setScalar(.94 + .08 * pulse);
  starLight.intensity = 4.6 + 1.5 * pulse;
  tree.rotation.y += (rotationTarget + Math.sin(time * .28) * .16 - tree.rotation.y) * .045;
  floor.rotation.y = Math.sin(time * .18) * .14;
  groundRoot.rotation.z = Math.sin(time * .09) * .018;
  groundMaterial.opacity = (.6 + .08 * Math.sin(time * .7)) * (1 - state.spread * .92);
  ribbonMaterial.opacity = .77 + .13 * Math.sin(time * 1.7);
  aura.material.opacity = .13 + .06 * pulse;
  const mix = state.spread;
  if (!playbackPaused && ['formingGreeting', 'formingHeart', 'formingTree'].includes(state.charmPhase)) {
    const duration = state.charmPhase === 'formingGreeting' ? 2.6 : state.charmPhase === 'formingHeart' ? 3 : 7.5;
    state.textProgress = Math.min(1, state.textProgress + delta / duration);
    if (state.textProgress >= 1) {
      if (state.charmPhase === 'formingHeart') {
        state.charmPhase = 'heart';
        $('#previewStatus').textContent = '星尘爱心已成形';
        setGestureText('单击或张掌，让爱心破碎重组成圣诞树');
      } else if (state.charmPhase === 'formingGreeting') {
        state.charmPhase = 'greeting';
        $('#previewStatus').textContent = '英文祝福已写成';
        setGestureText('单击或捏合，让祝福化作大爱心');
      } else {
        state.charmPhase = 'tree';
        $('#previewStatus').textContent = '圣诞树已点亮';
        setGestureText('捏合下一张照片 · 握拳聚合 · 张掌散开');
      }
    }
  }
  const morphEase = state.textProgress * state.textProgress * (3 - 2 * state.textProgress);
  if (state.charmPhase === 'formingGreeting') pointMaterial.opacity = .91 * (1 - morphEase);
  else if (['greeting', 'formingHeart', 'heart'].includes(state.charmPhase)) pointMaterial.opacity = .3;
  else if (state.charmPhase === 'formingTree' && state.treeRevealFromHeart) pointMaterial.opacity = .91 * THREE.MathUtils.smoothstep(state.textProgress, .18, .3);
  else pointMaterial.opacity = .91;
  const formationProgress = THREE.MathUtils.clamp(1 - state.spread, 0, 1);
  const treeDissolveDelay = state.treeRevealFromHeart ? .18 : 0;
  const treeFormationProgress = state.charmPhase === 'formingTree'
    ? THREE.MathUtils.clamp((state.textProgress - treeDissolveDelay) / (1 - treeDissolveDelay), 0, 1)
    : formationProgress;
  const dissolveProgress = THREE.MathUtils.smoothstep(state.textProgress, 0, .18);
  const showCharm = ['formingGreeting', 'greeting', 'formingHeart', 'heart', 'formingTree'].includes(state.charmPhase);
  const treeParticlesVisible = ['scattered', 'formingGreeting', 'formingTree', 'idle', 'tree'].includes(state.charmPhase);
  const treeReveal = state.charmPhase === 'formingTree'
    ? THREE.MathUtils.smoothstep(treeFormationProgress, .03, .98)
    : state.charmPhase === 'idle' || state.charmPhase === 'tree' ? 1 : 0;
  const treeVisible = treeReveal > .72;
  const photosVisible = state.charmPhase === 'idle' || state.charmPhase === 'tree';
  $('#sceneCaption').style.opacity = photosVisible ? (state.spread > .05 ? '.5' : '1') : '0';
  $('#photoCount').style.opacity = photosVisible ? '1' : '0';
  treePoints.visible = treeParticlesVisible;
  ribbonPoints.visible = treeReveal > .01;
  ribbonMaterial.opacity = (.77 + .13 * Math.sin(time * 1.7)) * treeReveal;
  branchLines.visible = treeVisible;
  treeDecorations.forEach(object => {
    if (state.charmPhase === 'formingTree') {
      const p = THREE.MathUtils.clamp((treeFormationProgress - object.userData.revealHeight) / .16, 0, 1);
      const reveal = p * p * (3 - 2 * p);
      object.visible = reveal > .001;
      object.position.y = object.userData.revealY - .28 * (1 - reveal);
      object.scale.copy(object.userData.revealScale).multiplyScalar(reveal);
    } else {
      object.visible = treeVisible;
      object.position.y = object.userData.revealY;
      object.scale.copy(object.userData.revealScale);
    }
  });
  halo.visible = treeReveal > .2;
  const starReveal = state.charmPhase === 'formingTree' ? THREE.MathUtils.smoothstep(treeFormationProgress, .94, 1) : treeVisible ? 1 : 0;
  star.visible = starReveal > .01;
  star.scale.setScalar((.94 + .08 * pulse) * starReveal);
  starLight.visible = starReveal > .01;
  starLight.intensity = (4.6 + 1.5 * pulse) * starReveal;
  floor.visible = treeReveal > .55;
  groundMaterial.opacity = (.6 + .08 * Math.sin(time * .7)) * (1 - state.spread * .92) * treeReveal;
  aura.material.opacity = (.13 + .06 * pulse) * treeReveal;
  if (showCharm) {
    const heartMix = state.charmPhase === 'heart' || (state.charmPhase === 'formingTree' && state.treeRevealFromHeart) ? 1 : state.charmPhase === 'formingHeart' ? morphEase : 0;
    const baseScale = window.innerWidth < 760 ? .95 : 1.45;
    const heartScale = window.innerWidth < 760 ? 2.1 : 2;
    const handOffset = state.handSeen ? THREE.MathUtils.clamp((.5 - state.handX) * .72, -.42, .42) : 0;
    textCloud.position.x = THREE.MathUtils.lerp(textAnchorX, -tree.position.x, heartMix) + handOffset;
    textCloud.position.y = state.handSeen ? THREE.MathUtils.clamp((.5 - state.handY) * .42, -.24, .24) : 0;
    textCloud.scale.setScalar(THREE.MathUtils.lerp(baseScale, heartScale, heartMix));
    textMaterial.size = 2.8 + .9 * heartMix + .25 * Math.sin(time * 2.4) * heartMix;
    if (state.charmPhase === 'formingGreeting') textMaterial.opacity = .96 * morphEase;
    else if (state.charmPhase === 'formingTree') textMaterial.opacity = state.treeRevealFromHeart ? .96 * (1 - dissolveProgress) : 0;
    else textMaterial.opacity = .82 + .18 * heartMix;
    for (let i = 0; i < TEXT_COUNT * 3; i++) {
      const shimmer = .82 + .18 * Math.sin(time * 2.6 + Math.floor(i / 3) * .021) * heartMix;
      textColors[i] = (greetingColors[i] * (1 - heartMix) + heartColors[i] * heartMix) * shimmer;
    }
    textColorAttr.needsUpdate = true;
    const frozenShape = ['heart', 'greeting', 'tree'].includes(state.charmPhase) || (state.charmPhase === 'formingTree' && !state.treeRevealFromHeart);
    if (!frozenShape) {
      for (let i = 0; i < TEXT_COUNT; i++) {
        const j = i * 3;
        if (state.charmPhase === 'formingGreeting') {
          textCurrent[j] = textStart[j] + (textShape[j] - textStart[j]) * morphEase;
          textCurrent[j + 1] = textStart[j + 1] + (textShape[j + 1] - textStart[j + 1]) * morphEase;
          textCurrent[j + 2] = textStart[j + 2] + (textShape[j + 2] - textStart[j + 2]) * morphEase;
        } else if (state.charmPhase === 'formingHeart') {
          textCurrent[j] = textShape[j] + (heartShape[j] - textShape[j]) * morphEase;
          textCurrent[j + 1] = textShape[j + 1] + (heartShape[j + 1] - textShape[j + 1]) * morphEase;
          textCurrent[j + 2] = textShape[j + 2] + (heartShape[j + 2] - textShape[j + 2]) * morphEase;
        } else if (state.charmPhase === 'formingTree') {
          const burst = THREE.MathUtils.smoothstep(state.textProgress, 0, .18);
          const expansion = 1 + burst * 1.25;
          textCurrent[j] = heartShape[j] * expansion + heartBurstVelocity[j] * burst;
          textCurrent[j + 1] = heartShape[j + 1] * expansion + heartBurstVelocity[j + 1] * burst;
          textCurrent[j + 2] = heartShape[j + 2] + heartBurstVelocity[j + 2] * burst;
        }
      }
      textPositionAttr.needsUpdate = true;
    }
  } else textMaterial.opacity = 0;
  const heartSparkMix = ['formingHeart', 'heart'].includes(state.charmPhase) ? (state.charmPhase === 'heart' ? 1 : morphEase) : state.charmPhase === 'formingTree' && state.treeRevealFromHeart ? 1 - dissolveProgress : 0;
  heartSparkles.visible = heartSparkMix > .01;
  heartSparkles.position.set(textCloud.position.x, textCloud.position.y, 0);
  heartSparkles.scale.setScalar(textCloud.scale.x);
  heartSparkMaterial.opacity = heartSparkMix * (.56 + .16 * Math.sin(time * 2.1));
  for (let i = 0; i < HEART_SPARK_COUNT; i++) {
    const j = i * 3;
    const angle = heartSparkAngles[i] + time * heartSparkSpeeds[i];
    heartSparkPositions[j] = Math.cos(angle) * heartSparkRadiusX[i];
    heartSparkPositions[j + 1] = Math.sin(angle) * heartSparkRadiusY[i] + .16 * Math.sin(angle * 2 + time + heartSparkPhases[i]);
    heartSparkPositions[j + 2] = 5.1 + .48 * Math.sin(angle + heartSparkPhases[i]);
  }
  heartSparkPositionAttr.needsUpdate = true;
  if (state.fireworkProgress < 1) {
    state.fireworkProgress = Math.min(1, state.fireworkProgress + .008);
    const p = state.fireworkProgress;
    for (let i = 0; i < FIREWORK_COUNT; i++) {
      const j = i * 3;
      const fromHeart = state.charmPhase === 'formingTree' && state.treeRevealFromHeart && i < FIREWORK_COUNT * .72;
      const originX = fromHeart ? textCloud.position.x : fireworkCenters[j];
      const originY = fromHeart ? textCloud.position.y : fireworkCenters[j + 1];
      const originZ = fromHeart ? 5.2 : fireworkCenters[j + 2];
      fireworkPositions[j] = originX + fireworkVelocity[j] * p * 1.25;
      fireworkPositions[j + 1] = originY + fireworkVelocity[j + 1] * p * 1.25 - p * p * 1.5;
      fireworkPositions[j + 2] = originZ + fireworkVelocity[j + 2] * p;
    }
    fireworkPositionAttr.needsUpdate = true;
    fireworkMaterial.opacity = Math.sin(Math.PI * p) * .96;
  } else fireworkMaterial.opacity = 0;
  for (let i = 0; i < PARTICLES; i++) {
    const j = i * 3;
    let pointMix = mix;
    if (state.charmPhase === 'formingTree') {
      const height = THREE.MathUtils.clamp((home[j + 1] + HEIGHT * .5) / HEIGHT, 0, 1);
      const local = THREE.MathUtils.clamp((treeFormationProgress - height * .72) / .28, 0, 1);
      pointMix = 1 - local * local * (3 - 2 * local);
    }
    const shimmer = 1 + .04 * Math.sin(time * 1.5 + phases[i]);
    current[j] = (home[j] * (1 - pointMix) + scatter[j] * pointMix) * shimmer;
    current[j + 1] = home[j + 1] * (1 - pointMix) + scatter[j + 1] * pointMix;
    current[j + 2] = home[j + 2] * (1 - pointMix) + scatter[j + 2] * pointMix;
  }
  positionAttr.needsUpdate = true;
  for (let i = 0; i < ribbonCount; i++) {
    const j = i * 3;
    const a = ribbonRate[i] * time;
    const ca = Math.cos(a), sa = Math.sin(a);
    const shimmer = 1 + .025 * Math.sin(time * 2.2 + ribbonPhase[i]);
    ribbonCurrent[j] = (ribbonBase[j] * ca - ribbonBase[j + 2] * sa) * shimmer;
    ribbonCurrent[j + 1] = ribbonBase[j + 1] + .055 * Math.sin(time * 1.6 + ribbonPhase[i]);
    ribbonCurrent[j + 2] = (ribbonBase[j] * sa + ribbonBase[j + 2] * ca) * shimmer;
  }
  ribbonAttr.needsUpdate = true;
  for (let i = 0; i < SNOW_COUNT; i++) {
    const j = i * 3;
    snowPositions[j + 1] -= snowSpeeds[i] * .016 * (state.charmPhase === 'formingTree' ? 1.8 : 1);
    snowPositions[j] += Math.sin(time * .42 + snowPhases[i]) * .002;
    if (snowPositions[j + 1] < camera.bottom - .4) {
      snowPositions[j + 1] = camera.top + .4;
      snowPositions[j] = camera.left + rand() * (camera.right - camera.left);
    }
  }
  snowPositionAttr.needsUpdate = true;
  snowMaterial.opacity = .62 + .12 * Math.sin(time * .8) + (state.charmPhase === 'formingTree' ? .18 : 0);
  for (let i = 0; i < presents.length; i++) {
    presents[i].rotation.y = Math.sin(time * .32 + i * 1.7) * .045;
  }
  for (let i = 0; i < photoObjects.length; i++) {
    const p = photoObjects[i];
    p.visible = photosVisible;
    const focus = state.photoFocus && i === state.selectedPhoto;
    p.renderOrder = focus ? 20 : 0;
    const portrait = window.innerWidth / window.innerHeight < .8;
    const targetPos = focus
      ? new THREE.Vector3(portrait ? 3.6 : -4.1, portrait ? .35 : .2, 5.2)
      : p.userData.basePosition;
    p.position.lerp(targetPos, focus ? .08 : .09);
    const targetScale = focus
      ? new THREE.Vector3(portrait ? 3 : 3.3, portrait ? 3.75 : 4.12, 1)
      : p.userData.baseScale;
    p.scale.lerp(targetScale, .1);
    p.material.rotation = focus ? 0 : Math.sin(time * .7 + i) * .025;
  }
  const stars = scene.userData.stars;
  stars.rotation.y = time * .002;
  renderer.render(scene, camera);
}
window.addEventListener('resize', resize);
resize();
restorePhotos();
if (posePreview) {
  state.spread = poseName === 'heart' ? 1 : 0;
  state.spreadTarget = state.spread;
  state.textProgress = 1;
  state.charmPhase = poseName === 'heart' ? 'heart' : 'greeting';
  textCurrent.set(poseName === 'heart' ? heartShape : textShape);
  if (poseName === 'heart') textColors.set(heartColors);
  textPositionAttr.needsUpdate = true;
  textColorAttr.needsUpdate = true;
} else {
  applySpread(true);
  $('#previewStatus').textContent = '粒子雾已就绪';
  setGestureText('粒子雾已散开 · 单击组成英文祝福');
}
animate();
