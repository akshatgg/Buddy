// The buddy page: loads the character (a .glb that follows the contract in the
// design spec, section 3) and animates it. All the timing lives in moods.js;
// this file applies poses to the model, shows the symbols over it, finds
// petting and shaking in the pointer's moves, and reports pointer events to main.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BLINK_LOOKAHEAD, FPS, FIDGETS, fpsFor, isActive, wakeDelay, floatOffset, createBlinker, createFidgeter, blinkWeight,
  lookAt, moodPose,
} from './moods.js';
import { BLEND, blendPose, smoothLevel } from './blend.js';
import { fitCamera, fromWindow, headMark } from './layout.js';
import { createPetDetector, createShakeDetector } from './gestures.js';
import { createSymbols } from './symbols.js';

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
const fidgeter = createFidgeter();
const pet = createPetDetector();
const shake = createShakeDetector();
const symbolsRoot = document.getElementById('symbols');
const symbols = createSymbols(symbolsRoot);
const now = () => performance.now() / 1000;

const LOOK_EPSILON = 0.01; // radians (a few pixels of pointer): a smaller turn of the head is not worth waking for
// The eye shapes of the buddy's feelings: morph targets on the Face after the first five, all optional (a model
// without one shows the plain open eyes instead).
const EYE_SHAPES = ['heart', 'swirl', 'sad', 'half', 'sleep'];
// What the app shows until it ends it: the buddy at work, or listening. Petting does not cut these short.
const LASTING = new Set(['thinking', 'listening']);

let rig = null;
let mood = { name: 'idle', since: now() };
let shown = null; // the pose drawn last: a new mood eases in from it (blend.js)
let blend = null; // { from, since } while a new mood eases in: the pose drawn when it started, and when that was
let cursor = { dx: 0, dy: 0 };
let held = null; // the pointer as it was when the buddy fell asleep: a sleeping head does not follow it
let lastLook = { yaw: 0, pitch: 0 }; // the head's turn when it last changed by more than LOOK_EPSILON
let lastLookChange = -Infinity; // when that was, in now() seconds
let lastActive = now(); // the last time isActive() was true for something other than a fidget, in now() seconds
let hovering = false;
let press = null; // { x, y, moved, shaken } while the pointer is down on the buddy
const voice = { reading: 0, level: 0, at: now() }; // the voice level last read, the level drawn and when (listening)
let timer = null; // the one pending frame; null while the loop is paused
let lastTick = -Infinity; // when the last frame was drawn, in now() seconds

window.__buddyMood = mood.name; // for the end-to-end test, with __buddyPose and __buddyFrames
window.__buddyFrames = 0;

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

/** Set glowing materials to `k` times the glow they came with. */
function setGlow(parts, k) {
  for (const { material, base } of parts) material.emissiveIntensity = base * k;
}

const CONTRACT_NODES = ['Root', 'Head', 'ArmL', 'ArmR', 'Face'];

/** The glowing materials under `object` (none if there is no object), each with the glow it came with. */
function glowing(object) {
  const parts = [];
  object?.traverse((o) => {
    if (!o.isMesh) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (material.emissive && material.emissive.getHex() !== 0) parts.push({ material, base: material.emissiveIntensity });
    }
  });
  return parts;
}

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
    // The eyes' glow and the ear rims' (EarRims is optional: a model without it has no ear glow).
    glows: glowing(face), ears: glowing(gltf.scene.getObjectByName('EarRims')),
    height: 0, // set once the model is framed
    headBox: null, // the head's bounding box at rest, set once the model is framed: where the symbols go
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

/** Put the symbols over the head. Only on load and resize: each call restyles the symbols that are playing. */
function placeSymbols() {
  if (!rig) return;
  camera.updateMatrixWorld();
  symbols.place(headMark(rig.headBox, camera, window.innerWidth, window.innerHeight));
}

/** Show the symbols of a mood that is starting (again, if it is the same one), or none. */
function startSymbols(name) {
  const { effect } = moodPose(name, 0);
  if (effect) symbols.play(effect);
  else symbols.stop();
}

/** Load the current character. The old one stays on screen until the new one is complete. */
async function load() {
  window.__buddyReady = false;
  try {
    const { bytes, accent } = await window.buddy.model();
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
    next.headBox = new THREE.Box3().setFromObject(next.head); // at rest: the model has not been posed yet
    rig = next;
    if (typeof accent === 'string') symbolsRoot.style.setProperty('--glow', accent); // the symbols glow as the buddy does
    placeSymbols();
    mood = { ...mood, since: now() }; // a mood sent while loading starts now
    startSymbols(mood.name); // and its symbols with it
  } finally {
    window.__buddyReady = rig !== null; // true once a model is on screen: the new one, or the old one if this failed
  }
}

/**
 * Start a mood at `t` (now() seconds). It eases in from the pose drawn last, whatever was showing, so nothing jumps;
 * its symbols start with it; and the wait for the next fidget starts again.
 */
function setMood(name, t) {
  blend = shown ? { from: shown, since: t } : null;
  if (name === 'asleep') held ??= cursor;
  else held = null;
  if (name !== mood.name) voice.reading = 0; // a new listening starts from silence
  mood = { name, since: t };
  window.__buddyMood = name;
  fidgeter.reset(t);
  startSymbols(name);
}

/** A mood from outside the frame loop (main, the pointer): start it and draw it at once. */
function changeMood(name) {
  setMood(name, now());
  wake();
}

/**
 * Mood changes that come with time: a mood that is over goes back to idle, and an idle buddy that nobody is using
 * fidgets now and then (moods.js). While the pointer is on the buddy or presses it, no fidget comes due.
 */
function settle(t) {
  if (moodPose(mood.name, t - mood.since).done) setMood('idle', t);
  if (hovering || press) {
    fidgeter.reset(t);
  } else if (mood.name === 'idle') {
    const fidget = fidgeter.take(t);
    if (fidget) setMood(fidget, t);
  }
}

/**
 * The pose to draw at `t` for the current mood, as numbers that can ease: the eyes' blink weight, and the head's turn
 * toward the pointer as far as the pose follows it.
 */
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
  // The voice level comes about 10 times a second; draw it eased, or the ear rims would glow in steps.
  voice.level = smoothLevel(voice.level, voice.reading, t - voice.at);
  voice.at = t;
  const pose = blend ? blendPose(blend.from, poseNow(t), t - blend.since) : poseNow(t);
  if (blend && t - blend.since >= BLEND) blend = null;
  shown = pose;

  const { base } = rig;
  rig.root.position.y = base.rootY + (floatOffset(t) * pose.float + pose.lift) * rig.height;
  rig.root.scale.set(pose.scaleX, pose.scaleY, pose.scaleX);
  rig.head.rotation.set(
    base.head.x + pose.followPitch + pose.headPitch,
    base.head.y + pose.followYaw + pose.headYaw,
    base.head.z + pose.headTilt,
  );
  rig.armL.rotation.z = base.armL + pose.armL;
  rig.armR.rotation.z = base.armR - pose.armR;
  setMorph('blink', pose.blink);
  setMorph('smile', pose.smile);
  setMorph('mouthO', pose.mouthO);
  setMorph('eyeLUp', pose.eyeL);
  setMorph('eyeRUp', pose.eyeR);
  for (const shape of EYE_SHAPES) setMorph(shape, pose[shape]);
  setGlow(rig.glows, pose.glow);
  setGlow(rig.ears, pose.ears);
  renderer.render(scene, camera);
  window.__buddyPose = pose;
  window.__buddyFrames += 1;
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
  if (rig) settle(t);
  const state = { mood: mood.name, since: t - mood.since, pressing: press !== null, sinceLookChange: t - lastLookChange };
  // A fidget is drawn at the full rate while it plays, but does not count as something happening: one every 15 to
  // 25 s would otherwise keep an idle buddy at the settling rate for good, instead of resting.
  if (isActive(state) && !FIDGETS.includes(mood.name)) lastActive = t;
  // A mood easing in is drawn at the full rate (only for BLEND seconds), so that it does not ease in steps.
  const easing = blend !== null && t - blend.since < BLEND;
  const fps = easing ? FPS : fpsFor({ ...state, blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD), sinceActive: t - lastActive });
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
 * Never called from tick(), which sets the next timer itself.
 */
function wake() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = setTimeout(tick, wakeDelay(now() - lastTick) * 1000);
}

/** What part of the buddy is under the pointer at (x, y) in the window: 'head', another part ('body'), or null. */
function partUnder(clientX, clientY) {
  if (!rig) return null;
  raycaster.setFromCamera(fromWindow(clientX, clientY, window.innerWidth, window.innerHeight), camera);
  const [nearest] = raycaster.intersectObject(rig.scene, true);
  if (!nearest) return null;
  for (let o = nearest.object; o; o = o.parent) if (o === rig.head) return 'head';
  return 'body';
}

function setHover(over) {
  if (over === hovering) return;
  hovering = over;
  window.buddy.hover(over);
  canvas.style.cursor = over ? 'grab' : 'default';
}

window.addEventListener('mousemove', (e) => {
  if (press) return;
  const part = partUnder(e.clientX, e.clientY);
  setHover(part !== null);
  // Petting: the pointer rubbed left and right over the head, not pressed (gestures.js). A rub that goes on while the
  // buddy already loves it is not a new one; and it does not cut short what the app is showing.
  if (part !== 'head') pet.reset();
  else if (pet.feed(e.screenX, e.timeStamp) && mood.name !== 'love' && !LASTING.has(mood.name)) changeMood('love');
});
document.addEventListener('mouseleave', () => {
  if (press) return;
  setHover(false);
  pet.reset();
});

canvas.addEventListener('pointerdown', (e) => {
  if (!hovering || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  press = { x: e.screenX, y: e.screenY, moved: false, shaken: false };
  pet.reset(); // a press is not a rub
  shake.reset();
  window.buddy.dragStart({ x: e.screenX, y: e.screenY });
  wake();
});

canvas.addEventListener('pointermove', (e) => {
  if (!press) return;
  // Shaking: dragged back and forth fast (gestures.js). It wobbles while held, as in any drag, and is dizzy when let go.
  if (shake.feed(e.screenX, e.screenY, e.timeStamp)) press.shaken = true;
  if (!press.moved && Math.hypot(e.screenX - press.x, e.screenY - press.y) < 4) return;
  if (!press.moved) changeMood('wobble');
  press.moved = true;
  window.buddy.dragMove({ x: e.screenX, y: e.screenY });
});

canvas.addEventListener('pointerup', (e) => {
  if (!press) return;
  const { moved, shaken } = press;
  press = null; // first: releasing the capture fires lostpointercapture, which must find no press to end
  canvas.releasePointerCapture(e.pointerId);
  if (moved) {
    window.buddy.dragEnd();
    changeMood(shaken ? 'dizzy' : 'idle');
  } else {
    window.buddy.click();
  }
});

/** The pointer was taken away mid-press (cancelled, or the capture was lost): end any drag, and never click. */
function abortPress() {
  if (!press) return;
  const { moved, shaken } = press;
  press = null;
  if (moved) window.buddy.dragEnd();
  if (mood.name === 'wobble') changeMood(shaken ? 'dizzy' : 'idle');
}
canvas.addEventListener('pointercancel', abortPress);
canvas.addEventListener('lostpointercapture', abortPress);

window.buddy.onMood((name) => changeMood(name));
window.buddy.onCursor((point) => {
  cursor = point;
  // A sleeping head does not follow the pointer: it stays turned to where the pointer was when the buddy fell asleep,
  // and only settles from there, so the pointer moving draws nothing while it sleeps.
  if (mood.name === 'asleep') return;
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
// How loud the person is while the buddy listens (about 10 times a second). It shows only while listening, which
// already draws at the full rate.
window.buddy.onVoiceLevel((level) => {
  if (mood.name === 'listening') voice.reading = typeof level === 'number' ? Math.min(1, Math.max(0, level)) || 0 : 0;
});
window.buddy.onPause((paused) => {
  if (paused) stopLoop();
  else startLoop();
});
window.buddy.onReload(() => {
  load().catch((err) => console.error('[buddy] model failed to load', err));
});
window.addEventListener('resize', () => {
  resize();
  placeSymbols();
  wake(); // a new size clears the canvas: draw it again now, not at the next slow frame
});

// A new page starts with the pointer off the buddy. Say so: a page before it that crashed while the pointer was on the
// buddy never did, and main would go on holding the sleep countdown for it.
window.buddy.hover(false);
load().catch((err) => console.error('[buddy] model failed to load', err));
startLoop(); // frames before the model arrives draw nothing; main sends buddy:pause if it should not run
