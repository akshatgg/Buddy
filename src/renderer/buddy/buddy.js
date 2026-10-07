// The buddy page: loads the character (a .glb that follows the contract in the
// design spec, section 3) and animates it. All the timing lives in moods.js;
// this file applies poses to the model and reports pointer events to main.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BLINK_LOOKAHEAD, fpsFor, isActive, wakeDelay, floatOffset, createBlinker, blinkWeight, lookAt, moodPose,
} from './moods.js';
import { fitCamera } from './layout.js';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
// Khronos PBR Neutral keeps the colours the model was made with (the cream stays cream, the
// screen stays dark) and only rolls off highlights and glow. art/build_buddies.py renders the
// previews with the same curve.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
// Glossy plastic and glass need something to reflect: a soft studio room, prefiltered once
// per GPU context (a few milliseconds on the GPU: at start, and again when a lost context is
// restored, see below) and only sampled after that. Tipped back a little, so the room's front
// light shows as a reflection across the top of the face screen rather than between the eyes.
function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentRotation.x = -0.3;
  room.dispose();
  pmrem.dispose();
}
buildEnvironment();
// After a lost GPU context (often after sleep) three.js restores its state, but not this texture's
// contents: the old texture went with the context, so there is nothing to dispose.
canvas.addEventListener('webglcontextrestored', buildEnvironment);
// Soft, warm light on top of the room's.
scene.add(new THREE.HemisphereLight(0xfff3e6, 0xd9cbbd, 0.5));
const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
keyLight.position.set(1.5, 2.5, 4);
scene.add(keyLight);

const raycaster = new THREE.Raycaster();
const blinker = createBlinker();
const now = () => performance.now() / 1000;

const LOOK_EPSILON = 0.01; // radians (a few pixels of pointer): a smaller turn of the head is not worth waking for

let rig = null;
let mood = { name: 'idle', since: now() };
let cursor = { dx: 0, dy: 0 };
let lastLook = { yaw: 0, pitch: 0 }; // the head's turn when it last changed by more than LOOK_EPSILON
let lastLookChange = -Infinity; // when that was, in now() seconds
let lastActive = now(); // the last time isActive() was true, in now() seconds
let hovering = false;
let press = null; // { x, y, moved } while the pointer is down on the buddy
let timer = null; // the one pending frame; null while the loop is paused
let lastTick = -Infinity; // when the last frame was drawn, in now() seconds

/**
 * The window is the buddy's own box with room above it for the symbols (layout.js): the camera frames the character
 * in the box as before, and the room above shows the view carried on upward.
 */
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  fitCamera(camera, window.innerWidth, window.innerHeight);
}

/** Point the camera at the model, leaving room to float and bounce. Returns its height. */
function frameCamera(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const fit = Math.max(size.y * 1.3, (size.x * 1.3) / camera.aspect);
  const distance = fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(centre.x, centre.y, centre.z + distance);
  camera.lookAt(centre);
  return size.y;
}

function setMorph(name, value) {
  for (const mesh of rig.faces) {
    const i = mesh.morphTargetDictionary[name];
    if (i !== undefined) mesh.morphTargetInfluences[i] = value;
  }
}

const CONTRACT_NODES = ['Root', 'Head', 'ArmL', 'ArmR', 'Face'];

/** Pick out what the character contract promises. Returns null, after logging, if a node is missing. */
function buildRig(gltf) {
  const nodes = Object.fromEntries(CONTRACT_NODES.map((name) => [name, gltf.scene.getObjectByName(name)]));
  const missing = CONTRACT_NODES.filter((name) => !nodes[name]);
  if (missing.length) {
    console.error(`[buddy] the model has no ${missing.join(', ')}`);
    return null;
  }
  const { Root: root, Head: head, ArmL: armL, ArmR: armR, Face: face } = nodes;
  const faces = [];
  face.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary) faces.push(o);
  });
  return {
    scene: gltf.scene, root, head, armL, armR, faces,
    height: 0, // set once the model is framed
    base: { rootY: root.position.y, head: head.rotation.clone(), armL: armL.rotation.z, armR: armR.rotation.z },
  };
}

/** Free the GPU memory of a model we are done with. (The buddy files have no skins or textures.) */
function disposeModel(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
  });
}

/** Load the current character. The old one stays on screen until the new one is complete. */
async function load() {
  window.__buddyReady = false;
  try {
    const { bytes } = await window.buddy.model();
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
    const next = buildRig(gltf);
    if (!next) return; // keep the old model
    if (rig) {
      scene.remove(rig.scene);
      disposeModel(rig.scene);
    }
    scene.add(next.scene);
    resize();
    next.height = frameCamera(next.scene);
    rig = next;
    mood = { ...mood, since: now() }; // a mood sent while loading starts now
  } finally {
    window.__buddyReady = rig !== null; // true once a model is on screen: the new one, or the old one if this failed
  }
}

function render(t) {
  const pose = moodPose(mood.name, t - mood.since);
  if (pose.done) mood = { name: 'idle', since: t };
  const look = lookAt(cursor.dx, cursor.dy);
  const { base } = rig;
  rig.root.position.y = base.rootY + (floatOffset(t) + pose.lift) * rig.height;
  rig.root.scale.set(pose.scaleX, pose.scaleY, pose.scaleX);
  rig.head.rotation.set(base.head.x + look.pitch, base.head.y + look.yaw, base.head.z + pose.headTilt);
  rig.armL.rotation.z = base.armL + pose.armL;
  rig.armR.rotation.z = base.armR - pose.armR;
  setMorph('blink', blinkWeight(pose, blinker.value(t)));
  setMorph('smile', pose.smile);
  setMorph('mouthO', pose.mouthO);
  setMorph('eyeLUp', pose.eyeL);
  setMorph('eyeRUp', pose.eyeR);
  renderer.render(scene, camera);
}

/**
 * The frame loop: one timer, so the page wakes only when a frame is due (not at
 * the display's refresh rate), and slows down while little is happening (see
 * fpsFor in moods.js). The next frame is scheduled before drawing this one, so
 * drawing time does not stretch the interval.
 */
function tick() {
  const t = now();
  lastTick = t;
  const state = { mood: mood.name, pressing: press !== null, sinceLookChange: t - lastLookChange };
  if (isActive(state)) lastActive = t;
  const fps = fpsFor({ ...state, blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD), sinceActive: t - lastActive });
  timer = setTimeout(tick, 1000 / fps);
  if (rig) render(t);
}

function startLoop() {
  if (timer === null) tick();
}

function stopLoop() {
  clearTimeout(timer);
  timer = null;
}

/**
 * Something has just happened (a mood, a press, a head turn): do not wait out a
 * slow frame that is already scheduled. Replace it with one at the soonest the
 * full rate allows, so there is still a single timer. Does nothing while paused.
 */
function wake() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = setTimeout(tick, wakeDelay(now() - lastTick) * 1000);
}

function overBuddy(clientX, clientY) {
  if (!rig) return false;
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(rig.scene, true).length > 0;
}

function setHover(over) {
  if (over === hovering) return;
  hovering = over;
  window.buddy.hover(over);
  canvas.style.cursor = over ? 'grab' : 'default';
}

window.addEventListener('mousemove', (e) => {
  if (!press) setHover(overBuddy(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => {
  if (!press) setHover(false);
});

canvas.addEventListener('pointerdown', (e) => {
  if (!hovering || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY, moved: false };
  window.buddy.dragStart({ x: e.screenX, y: e.screenY });
  wake();
});

canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) < 4) return;
  if (!press.moved) mood = { name: 'wobble', since: now() };
  press.moved = true;
  window.buddy.dragMove({ x: e.screenX, y: e.screenY });
});

canvas.addEventListener('pointerup', (e) => {
  if (!press) return;
  const { moved } = press;
  press = null; // first: releasing the capture fires lostpointercapture, which must find no press to end
  canvas.releasePointerCapture(e.pointerId);
  if (moved) {
    window.buddy.dragEnd();
    mood = { name: 'idle', since: now() };
  } else {
    window.buddy.click();
  }
});

/** The pointer was taken away mid-press (cancelled, or the capture was lost): end any drag, and never click. */
function abortPress() {
  if (!press) return;
  const { moved } = press;
  press = null;
  if (moved) window.buddy.dragEnd();
  if (mood.name === 'wobble') mood = { name: 'idle', since: now() };
}
canvas.addEventListener('pointercancel', abortPress);
canvas.addEventListener('lostpointercapture', abortPress);

window.buddy.onMood((name) => {
  mood = { name, since: now() };
  wake();
});
window.buddy.onCursor((point) => {
  cursor = point;
  // The pointer moving is not what counts; the head turning is. lookAt() saturates (yaw and
  // pitch each at their own distance), so a pointer that is far away turns the head no further
  // and the buddy can rest. A real turn is drawn at once (wake) and keeps it at the settling
  // rate until 10 s after the last one (see fpsFor).
  const look = lookAt(point.dx, point.dy);
  if (Math.abs(look.yaw - lastLook.yaw) > LOOK_EPSILON || Math.abs(look.pitch - lastLook.pitch) > LOOK_EPSILON) {
    lastLook = look;
    lastLookChange = now();
    wake();
  }
});
window.buddy.onPause((paused) => {
  if (paused) stopLoop();
  else startLoop();
});
window.buddy.onReload(() => {
  load().catch((err) => console.error('[buddy] model failed to load', err));
});
window.addEventListener('resize', resize);

load().catch((err) => console.error('[buddy] model failed to load', err));
startLoop(); // frames before the model arrives draw nothing; main sends buddy:pause if it should not run
