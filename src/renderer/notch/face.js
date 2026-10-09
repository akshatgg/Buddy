// Buddy's face in the notch: the chosen character's head (the .glb's Head node, as on the phone), drawn small in the
// notch's left wing when Settings → Buddy → "In the notch" is Face. It moves as the floating buddy does, with the same
// timings (../buddy/moods.js): it blinks, turns to the pointer, shows the moods main sends (thinking, happy, sad,
// asleep, love, …), listens with its ears, and fidgets now and then when left alone. Only the head: no body, no arms,
// no drag. notch.js places the canvas and tells this file about the pointer on the shape (window.notchFace); until the
// face is drawn (or if it cannot be) the page shows the eyes instead (the body's face-ready class).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BLINK_LOOKAHEAD, EYE_SHAPES, fpsFor, countsAsActive, wakeDelay, createBlinker, createFidgeter, blinkWeight, lookAt,
  moodPose, restingMood, moodForMic, isRepeat,
} from '../buddy/moods.js';
import { BLEND, blendPose, smoothLevel } from '../buddy/blend.js';

const FRAME = 1.25; // the head fills 1 / FRAME of the canvas, so a nod or a hop stays inside it
const LIFT = 0.5; // a hop lifts the head by this much of what lifts the whole floating buddy
const FACE_NODES = ['Head', 'Face'];

const canvas = document.getElementById('face');
const now = () => performance.now() / 1000;

let renderer = null; // made the first time the face is wanted: no GPU work at all with the eyes
let scene = null;
let camera = null;
let rig = null;
let wanted = false; // the layout says Face
let paused = false;
let loading = null;
let mood = { name: 'idle', since: now() };
let shown = null; // the pose drawn last: a new mood eases in from it
let blend = null;
let cursor = { dx: 0, dy: 0 };
let held = null; // asleep: the head stays turned where the pointer was
let lastLook = { yaw: 0, pitch: 0 };
let lastLookChange = -Infinity;
let lastActive = now();
let hovering = false;
let panelOpen = false;
let micOn = false;
const voice = { reading: 0, level: 0, at: now() };
let timer = null;
let lastTick = -Infinity;
const blinker = createBlinker();
const fidgeter = createFidgeter();

/** The renderer, scene, lights and camera, once. */
function setUp() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping; // as the floating buddy: the model's own colours
  renderer.toneMappingExposure = 1;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  const environment = () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentRotation.x = -0.3;
    room.dispose();
    pmrem.dispose();
  };
  environment();
  canvas.addEventListener('webglcontextrestored', environment);
  scene.add(new THREE.HemisphereLight(0xfff3e6, 0xd9cbbd, 0.5));
  const key = new THREE.DirectionalLight(0xffeedd, 1.2);
  key.position.set(1.5, 2.5, 4);
  scene.add(key);
}

function resize() {
  // The size notch.js gave it (not its laid-out size: the canvas is hidden until the face is first drawn).
  const width = parseFloat(canvas.style.width) || 1;
  const height = parseFloat(canvas.style.height) || 1;
  // The canvas is tiny: draw it at 3× at least where the screen is 2×, or the face is a blur.
  renderer.setPixelRatio(Math.max(window.devicePixelRatio, 2) * 1.5);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  if (rig) frameHead();
}

/** Point the camera at the head at rest, filling 1 / FRAME of the canvas. */
function frameHead() {
  const size = rig.headBox.getSize(new THREE.Vector3());
  const centre = rig.headBox.getCenter(new THREE.Vector3());
  const fit = Math.max(size.y * FRAME, (size.x * FRAME) / camera.aspect);
  const distance = fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(centre.x, centre.y, centre.z + distance);
  camera.lookAt(centre);
  rig.height = size.y;
}

const isUnder = (object, ancestor) => {
  for (let o = object; o; o = o.parent) if (o === ancestor) return true;
  return false;
};

/** The glowing materials under `object`, each with the glow it came with. */
function glowing(object) {
  const found = [];
  object?.traverse((o) => {
    if (!o.isMesh) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (material.emissive && material.emissive.getHex() !== 0) found.push({ material, base: material.emissiveIntensity });
    }
  });
  return found;
}

/** The head and its face from the model; everything else is hidden. Null, after logging, if a node is missing. */
function buildRig(gltf) {
  const [head, faceNode] = FACE_NODES.map((name) => gltf.scene.getObjectByName(name));
  if (!head || !faceNode) {
    console.error('[buddy] the model has no head or face for the notch');
    return null;
  }
  gltf.scene.traverse((o) => {
    if (o.isMesh && !isUnder(o, head)) o.visible = false;
  });
  const faces = [];
  faceNode.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary) faces.push(o);
  });
  const ears = gltf.scene.getObjectByName('EarRims');
  gltf.scene.updateMatrixWorld(true);
  return {
    scene: gltf.scene, head, faces, glows: glowing(faceNode), ears: glowing(ears && isUnder(ears, head) ? ears : null),
    headBox: new THREE.Box3().setFromObject(head), height: 0,
    base: { rotation: head.rotation.clone(), y: head.position.y },
  };
}

function disposeModel(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
  });
}

function setMorph(name, value) {
  for (const mesh of rig.faces) {
    const i = mesh.morphTargetDictionary[name];
    if (i !== undefined) mesh.morphTargetInfluences[i] = value;
  }
}

function setGlow(list, k) {
  for (const { material, base } of list) material.emissiveIntensity = base * k;
}

/** Say whether the face shows, for the page's CSS and notch.js (which moves the status into the eye's place). */
function ready(on) {
  if (document.body.classList.contains('face-ready') === on) return;
  document.body.classList.toggle('face-ready', on);
  window.dispatchEvent(new Event('notch-face'));
}

/** Load the chosen character's head. The old one stays until the new one is complete. */
async function load() {
  const { bytes } = await window.notch.model();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
  const next = buildRig(gltf);
  if (!next) return;
  if (rig) {
    scene.remove(rig.scene);
    disposeModel(rig.scene);
  }
  scene.add(next.scene);
  rig = next;
  resize();
  mood = { ...mood, since: now() };
  render(now());
  ready(wanted);
}

function loadOnce() {
  loading ??= load().catch((err) => {
    console.error('[buddy] the notch face failed to load:', err?.message ?? err);
  }).finally(() => {
    loading = null;
  });
  return loading;
}

const asShown = (name) => (name === 'idle' ? restingMood(micOn) : name);

function setMood(name, t) {
  const next = asShown(name);
  blend = shown ? { from: shown, since: t } : null;
  if (next === 'asleep') held ??= cursor;
  else held = null;
  if (next !== mood.name) voice.reading = 0;
  mood = { name: next, since: t };
  fidgeter.reset(t);
}

function changeMood(name) {
  if (isRepeat(mood.name, asShown(name))) return;
  setMood(name, now());
  wake();
}

/** A mood that is over goes back to rest; left alone and idle, the face fidgets now and then. */
function settle(t) {
  if (moodPose(mood.name, t - mood.since).done) setMood('idle', t);
  if (hovering || panelOpen) {
    fidgeter.reset(t);
  } else if (mood.name === 'idle') {
    const fidget = fidgeter.take(t);
    if (fidget) setMood(fidget, t);
  }
}

function poseNow(t) {
  const pose = moodPose(mood.name, t - mood.since, { level: voice.level });
  const toward = lookAt((held ?? cursor).dx, (held ?? cursor).dy);
  return {
    ...pose,
    blink: blinkWeight(pose, blinker.value(t)),
    followPitch: toward.pitch * pose.look,
    followYaw: toward.yaw * pose.look,
  };
}

function render(t) {
  voice.level = smoothLevel(voice.level, voice.reading, t - voice.at);
  voice.at = t;
  const pose = blend ? blendPose(blend.from, poseNow(t), t - blend.since) : poseNow(t);
  if (blend && t - blend.since >= BLEND) blend = null;
  shown = pose;
  const { base } = rig;
  rig.head.position.y = base.y + pose.lift * LIFT * rig.height;
  rig.head.rotation.set(
    base.rotation.x + pose.followPitch + pose.headPitch,
    base.rotation.y + pose.followYaw + pose.headYaw,
    base.rotation.z + pose.headTilt,
  );
  setMorph('blink', pose.blink);
  setMorph('mouthO', pose.mouthO);
  setMorph('eyeLUp', pose.eyeL);
  setMorph('eyeRUp', pose.eyeR);
  for (const shape of EYE_SHAPES) setMorph(shape, pose[shape]);
  setGlow(rig.glows, pose.glow);
  setGlow(rig.ears, pose.ears);
  renderer.render(scene, camera);
  window.__notchFaceFrames = (window.__notchFaceFrames ?? 0) + 1; // for the end-to-end check
}

function tick() {
  const t = now();
  lastTick = t;
  if (rig) settle(t);
  const state = { mood: mood.name, since: t - mood.since, pressing: false };
  if (countsAsActive(state)) lastActive = t;
  const fps = fpsFor({
    ...state,
    easing: blend !== null && t - blend.since < BLEND,
    sinceLookChange: t - lastLookChange,
    blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD),
    sinceActive: t - lastActive,
  });
  timer = setTimeout(tick, 1000 / fps);
  if (rig) render(t);
}

const running = () => wanted && !paused;

function startLoop() {
  if (timer === null && running()) tick();
}

function stopLoop() {
  clearTimeout(timer);
  timer = null;
}

function wake() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = setTimeout(tick, wakeDelay(now() - lastTick) * 1000);
}

window.notch.onLayout((layout) => {
  wanted = layout.look !== 'eyes';
  if (!wanted) {
    stopLoop();
    ready(false);
    return;
  }
  if (!renderer) setUp();
  resize(); // notch.js has sized the canvas for this notch
  if (rig) ready(true);
  else loadOnce();
  startLoop();
});
window.notch.onMood((name) => changeMood(name));
window.notch.onCursor((point) => {
  cursor = point;
  if (mood.name === 'asleep') return; // a sleeping head stays turned where it was
  const look = lookAt(point.dx, point.dy);
  if (Math.abs(look.yaw - lastLook.yaw) > 0.01 || Math.abs(look.pitch - lastLook.pitch) > 0.01) {
    lastLook = look;
    lastLookChange = now();
    wake();
  }
});
window.notch.onVoiceLevel((level) => {
  if (mood.name === 'listening') voice.reading = typeof level === 'number' ? Math.min(1, Math.max(0, level)) || 0 : 0;
});
window.notch.onPanelOpen((open) => {
  panelOpen = Boolean(open);
});
window.notch.onMicOn((on) => {
  micOn = Boolean(on);
  const next = moodForMic(mood.name, micOn);
  if (next) changeMood(next);
});
window.notch.onPause((value) => {
  paused = Boolean(value);
  if (paused) {
    stopLoop();
  } else {
    fidgeter.reset(now());
    startLoop();
  }
});
window.notch.onReload(() => {
  if (renderer) loadOnce();
});

// What notch.js tells the face: the pointer on the shape (no fidgets meanwhile), and resting there a while (love).
window.notchFace = {
  hover(on) {
    hovering = Boolean(on);
  },
  love() {
    if (mood.name === 'idle' || mood.name === 'listening') changeMood('love');
  },
};
