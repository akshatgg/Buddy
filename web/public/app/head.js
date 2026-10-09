// The buddy's head on the phone, drawn with three.js as the Mac draws the whole buddy (src/renderer/buddy/buddy.js),
// from the same .glb files (copied to /app/buddies/). Only the Head node and what hangs from it is drawn, as on
// Android: the phone shows no body. The moods, the blink, the fidgets of a bored buddy and the symbols over the head
// are the Mac's own modules (shared/). A finger stroking the head back and forth is petting (gestures.js). It draws
// only as often as moods.js says, and not at all while paused (the app is hidden), to save the battery.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BLINK_LOOKAHEAD, EYE_SHAPES, fpsFor, countsAsActive, wakeDelay, floatOffset, createBlinker, createFidgeter,
  blinkWeight, moodPose, restingMood, moodForMic, isRepeat,
} from './shared/moods.js';
import { BLEND, blendPose, smoothLevel } from './shared/blend.js';
import { fromWindow, headMark } from './shared/layout.js';
import { createPetDetector } from './shared/gestures.js';
import { createSymbols } from './shared/symbols.js';

// Room around the head, as a fraction of its size on each side, so a tilt or a squash is not cut off; and above it, as
// a fraction of its height, for the float and the happy bounce (Android's HeadRenderer.kt leaves the same).
const MARGIN = 0.12;
const LIFT_MARGIN = 0.12;
const MAX_PIXEL_RATIO = 2; // sharp on any iPhone, with less than half the pixels of 3×
// What the app shows until it ends it: the buddy at work, or listening. Petting does not cut these short.
const LASTING = new Set(['thinking', 'listening']);

const isUnder = (object, parent) => {
  for (let o = object; o; o = o.parent) if (o === parent) return true;
  return false;
};

/** The glowing materials under `object` (none without one), each with the glow it came with. */
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

/** Free the GPU memory of a model that is done with. (The buddy files have no skins or textures.) */
function disposeModel(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
  });
}

/** The parts of the model the head needs (the character contract's Head and Face), or null after saying what is missing. */
function buildRig(gltf) {
  const head = gltf.scene.getObjectByName('Head');
  const face = gltf.scene.getObjectByName('Face');
  if (!head || !face) {
    console.error('[buddy] the model has no Head or no Face');
    return null;
  }
  // Only the head and what hangs from it: the body and the arms are not drawn.
  gltf.scene.traverse((o) => {
    if (o.isMesh && !isUnder(o, head)) o.visible = false;
  });
  const faces = [];
  face.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary) faces.push(o);
  });
  return {
    scene: gltf.scene, head, faces,
    glows: glowing(face), ears: glowing(gltf.scene.getObjectByName('EarRims')),
    base: { y: head.position.y, rotation: head.rotation.clone(), scale: head.scale.clone() },
    box: null, // the head's bounding box at rest, once loaded: what the camera frames, and where the symbols go
    height: 1,
  };
}

/**
 * The head in `canvas`, its symbols in `symbolsRoot` (over the canvas). onTouch() hears every touch on the head.
 * Answers { load, mood, micOn, level, pause }.
 */
export function createHead({ canvas, symbolsRoot, onTouch = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  // Khronos PBR Neutral keeps the model's colours, as on the Mac.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  // The Mac's soft studio room for the glossy plastic and glass to reflect, made again after a lost GPU context.
  function buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment?.dispose(); // the lighting from before the lost context
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentRotation.x = -0.3;
    room.dispose();
    pmrem.dispose();
  }
  buildEnvironment();
  canvas.addEventListener('webglcontextrestored', buildEnvironment);
  scene.add(new THREE.HemisphereLight(0xfff3e6, 0xd9cbbd, 0.5));
  const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
  keyLight.position.set(1.5, 2.5, 4);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const blinker = createBlinker();
  const fidgeter = createFidgeter();
  const pet = createPetDetector();
  const symbols = createSymbols(symbolsRoot);
  const now = () => performance.now() / 1000;

  let rig = null;
  let mood = { name: 'idle', since: now() };
  let shown = null; // the pose drawn last: a new mood eases in from it (blend.js)
  let blend = null; // { from, since } while a new mood eases in
  let lastActive = now();
  let press = false; // a finger is on the head
  let micOn = false;
  const voice = { reading: 0, level: 0, at: now() };
  let timer = null; // the one pending frame; null while paused
  let lastTick = -Infinity;
  let paused = false;
  let size = { width: 1, height: 1 };

  window.__buddyMood = mood.name; // for the browser check, as on the Mac
  window.__buddyFrames = 0;

  /** The camera frames the head at rest with room to move; the symbols go over its top. */
  function frame() {
    if (!rig) return;
    camera.aspect = size.width / size.height;
    const dims = rig.box.getSize(new THREE.Vector3());
    const centre = rig.box.getCenter(new THREE.Vector3());
    centre.y += (dims.y * LIFT_MARGIN) / 2;
    const fit = Math.max(dims.y * (1 + LIFT_MARGIN + 2 * MARGIN), (dims.x * (1 + 2 * MARGIN)) / camera.aspect);
    const distance = fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + dims.z / 2;
    camera.position.set(centre.x, centre.y, centre.z + distance);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    symbols.place(headMark(rig.box, camera, size.width, size.height));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    renderer.setSize(size.width, size.height, false);
    frame();
    wake(); // a new size clears the canvas: draw it again now
  }

  function setMorph(name, value) {
    for (const mesh of rig.faces) {
      const i = mesh.morphTargetDictionary[name];
      if (i !== undefined) mesh.morphTargetInfluences[i] = value;
    }
  }

  function setGlow(parts, k) {
    for (const { material, base } of parts) material.emissiveIntensity = base * k;
  }

  /** The mood's symbols (none while paused: the "z" letters would come back for nobody). */
  function startSymbols(name, since = 0) {
    const { effect } = moodPose(name, 0);
    if (effect && !paused) symbols.play(effect, { since });
    else symbols.stop();
  }

  /** Load a buddy: `url` of its .glb, `accent` its glow for the symbols. The old one stays until the new one is there. */
  async function load({ url, accent }) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the buddy did not load: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
    const next = buildRig(gltf);
    if (!next) return;
    if (rig) {
      scene.remove(rig.scene);
      disposeModel(rig.scene);
    }
    scene.add(next.scene);
    next.scene.updateMatrixWorld(true);
    next.box = new THREE.Box3().setFromObject(next.head);
    next.height = next.box.max.y - next.box.min.y;
    rig = next;
    if (typeof accent === 'string') symbolsRoot.style.setProperty('--glow', accent);
    frame();
    mood = { ...mood, since: now() };
    startSymbols(mood.name);
    wake();
  }

  const asShown = (name) => (name === 'idle' ? restingMood(micOn) : name);

  function setMood(name, t) {
    const next = asShown(name);
    blend = shown ? { from: shown, since: t } : null;
    if (next !== mood.name) voice.reading = 0;
    mood = { name: next, since: t };
    window.__buddyMood = next;
    fidgeter.reset(t);
    startSymbols(next);
  }

  /** A mood from the app or a touch: start it and draw it at once. The same lasting mood again is not started over. */
  function changeMood(name) {
    if (isRepeat(mood.name, asShown(name))) return;
    setMood(name, now());
    wake();
  }

  /** A mood that is over goes back to rest; a buddy at rest that nobody touches fidgets now and then (bored). */
  function settle(t) {
    if (moodPose(mood.name, t - mood.since).done) setMood('idle', t);
    if (press) {
      fidgeter.reset(t);
    } else if (mood.name === 'idle') {
      const fidget = fidgeter.take(t);
      if (fidget) setMood(fidget, t);
    }
  }

  function poseNow(t) {
    const pose = moodPose(mood.name, t - mood.since, { level: voice.level });
    return { ...pose, blink: blinkWeight(pose, blinker.value(t)) };
  }

  function render(t) {
    voice.level = smoothLevel(voice.level, voice.reading, t - voice.at);
    voice.at = t;
    const pose = blend ? blendPose(blend.from, poseNow(t), t - blend.since) : poseNow(t);
    if (blend && t - blend.since >= BLEND) blend = null;
    shown = pose;
    const { head, base } = rig;
    head.position.y = base.y + (floatOffset(t) * pose.float + pose.lift) * rig.height;
    head.scale.set(base.scale.x * pose.scaleX, base.scale.y * pose.scaleY, base.scale.z * pose.scaleX);
    head.rotation.set(base.rotation.x + pose.headPitch, base.rotation.y + pose.headYaw, base.rotation.z + pose.headTilt);
    setMorph('blink', pose.blink);
    setMorph('mouthO', pose.mouthO);
    setMorph('eyeLUp', pose.eyeL);
    setMorph('eyeRUp', pose.eyeR);
    for (const shape of EYE_SHAPES) setMorph(shape, pose[shape]);
    setGlow(rig.glows, pose.glow);
    setGlow(rig.ears, pose.ears);
    renderer.render(scene, camera);
    window.__buddyFrames += 1;
  }

  /** One timer: the next frame comes when moods.js says one is due, so a resting head costs little. */
  function tick() {
    const t = now();
    lastTick = t;
    if (rig) settle(t);
    const state = { mood: mood.name, since: t - mood.since, pressing: press };
    if (countsAsActive(state)) lastActive = t;
    const fps = fpsFor({
      ...state,
      easing: blend !== null && t - blend.since < BLEND,
      sinceLookChange: Infinity, // the phone's head does not follow a pointer
      blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD),
      sinceActive: t - lastActive,
    });
    timer = setTimeout(tick, 1000 / fps);
    if (rig) render(t);
  }

  function wake() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = setTimeout(tick, wakeDelay(now() - lastTick) * 1000);
  }

  /** Whether the point (clientX, clientY) is on the head. */
  function onHead(clientX, clientY) {
    if (!rig) return false;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(fromWindow(clientX - rect.left, clientY - rect.top, rect.width, rect.height), camera);
    return raycaster.intersectObject(rig.head, true).length > 0;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!onHead(e.clientX, e.clientY)) return;
    press = true;
    pet.reset();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // followed on the canvas all the same
    }
    onTouch();
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    // Petting: a finger stroked back and forth over the head (gestures.js). A stroke that goes on while the buddy
    // already loves it is not a new one, and it does not cut short what the app is showing.
    if (press && pet.feed(e.clientX, e.timeStamp) && mood.name !== 'love' && !LASTING.has(mood.name)) changeMood('love');
  });
  const endPress = () => {
    press = false;
    pet.reset();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endPress);
  new ResizeObserver(resize).observe(canvas);

  tick();

  return {
    load,
    mood: changeMood,

    /** The microphone came on or went off: a buddy at rest listens while it is on (moods.js). */
    micOn(on) {
      micOn = Boolean(on);
      const next = moodForMic(mood.name, micOn);
      if (next) changeMood(next);
    },

    /** How loud the person is while the buddy listens (0 to 1, shared/feelings.js buddyLevel). */
    level(value) {
      if (mood.name === 'listening') voice.reading = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    },

    /** Stop drawing while the app is hidden; on again, the mood showing gets its symbols back, as old as it is. */
    pause(on) {
      if (Boolean(on) === paused) return;
      paused = Boolean(on);
      if (paused) {
        clearTimeout(timer);
        timer = null;
        symbols.stop();
      } else {
        fidgeter.reset(now());
        if (timer === null) tick();
        startSymbols(mood.name, Math.max(0, now() - mood.since));
      }
    },
  };
}
