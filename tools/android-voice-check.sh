#!/bin/bash
# "Only my voice" on a device or emulator (no microphone): makes a few spoken phrases with macOS `say`, puts them and the
# voice-check model into the app's files folder, and runs the instrumented SherpaEmbedderTest on the real engine.
#   release/speaker-model/campplus-zh-en-advanced.onnx   the model (from the speaker-model-1 release), or SPEAKER_MODEL=<path>
# Needs one device or emulator in `adb devices`. Prints the engine's time for one phrase ("embed ms").
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
MODEL="${SPEAKER_MODEL:-$ROOT/release/speaker-model/campplus-zh-en-advanced.onnx}"
[ -f "$MODEL" ] || { echo "missing $MODEL (the speaker-model-1 release asset)"; exit 1; }
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
APP=com.akshatgg.buddy
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# five takes and a test of one voice, and a test of another
i=0
for rate in 150 165 180 195 210; do
  i=$((i + 1))
  say -v Rishi -r "$rate" -o "$WORK/a-e$i.wav" --data-format=LEI16@16000 "Hey Buddy, what time is it"
done
say -v Rishi -r 175 -o "$WORK/a-t1.wav" --data-format=LEI16@16000 "Hey Buddy, what is the weather"
say -v Samantha -o "$WORK/b-t1.wav" --data-format=LEI16@16000 "Hey Buddy, what is the weather"

cd android
./gradlew -q -Djava.net.preferIPv4Stack=true :app:installDebug :app:installDebugAndroidTest -x checkCloudProperties
"$ADB" shell "run-as $APP mkdir -p files/voice-check-test"
for f in "$WORK"/*.wav "$MODEL"; do
  b=$(basename "$f")
  "$ADB" push "$f" "/data/local/tmp/$b" >/dev/null
  "$ADB" shell "run-as $APP cp /data/local/tmp/$b files/voice-check-test/$b"
  "$ADB" shell rm "/data/local/tmp/$b"
done
"$ADB" logcat -c
./gradlew -q -Djava.net.preferIPv4Stack=true :app:connectedDebugAndroidTest -x checkCloudProperties \
  -Pandroid.testInstrumentationRunnerArguments.class=com.akshatgg.buddy.voice.SherpaEmbedderTest
"$ADB" logcat -d -s BuddyVoiceCheck
