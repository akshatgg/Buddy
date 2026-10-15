'use strict';

/**
 * Buddy's ears: the small Indian-English Vosk model (Apache 2.0, from alphacephei.com), not in the installers. Each app
 * downloads it from Buddy's own GitHub release the first time it needs it, and keeps it only when its SHA-256 is this
 * one. Android takes the zip, the Mac the .tar.gz (vosk-browser reads that). tools/pack-voice-model.js makes both.
 */
const BASE = 'https://github.com/akshatgg/Buddy/releases/download/voice-model-1';
const VOICE_MODEL = {
  name: 'vosk-model-small-en-in-0.4',
  tag: 'voice-model-1',
  zip: { url: `${BASE}/vosk-model-small-en-in-0.4.zip`, sha256: '20663dcac4d5cb783a579c54d98339344a688e4ec6e1b4a4b059fd1235454cc7', bytes: 37573330 },
  tgz: { url: `${BASE}/vosk-model-small-en-in-0.4.tar.gz`, sha256: '3d3fc1bcc93f458fd87e683a2f8c42f82aaba5a7fd7733ae65e7ea5395597016', bytes: 37562490 },
};
module.exports = { VOICE_MODEL };
