#!/bin/sh
# Runs the device tests (app/src/androidTest/.../device) on the running emulator, including the parts that need the host:
# the fake incoming call (adb emu gsm), and the permissions the app must not hold (revoking kills the app, so not in a test).
# Build first: ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -x checkCloudProperties
set -e
cd "$(dirname "$0")"
A="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
P=com.akshatgg.buddy
RUN="$A shell am instrument -w -e class"
R=com.akshatgg.buddy.test/androidx.test.runner.AndroidJUnitRunner
F=com.akshatgg.buddy.device.DeviceFeaturesTest
$A install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null
$A install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
./emulator-seed.sh >/dev/null

echo "== phase 1: everything that needs no host"
$RUN "$F#contactsWithNumbersAreRead,$F#findPicksOnePersonAndRefusesTwoWithTheSameName,$F#theDialerCanCallOnAPhoneWithTelephony,$F#actionCallStartsARealCallToTheEmulatorsOwnNumberAndItEnds,$F#nobodyIsCallingWhenThePhoneIsQuiet,$F#theLauncherListsAppsAndOpeningSettingsReallyOpensIt,$F#anAppThatDoesNotExistIsSaid,$F#notificationAccessIsOnAndAPostedNotificationIsHeard,$F#withNotificationAccessOffTheReaderSaysHowToTurnItOn,$F#keyguardLockSeesLockedAndUnlocked,$F#chatCallShowsACardWithCallAndNotNowAndPressingCallRingsTheEmulator,$F#chatOpenOpensTheAppAndSaysSo,$F#chatWhoIsCallingAnswersNobodyWhenQuiet,$F#chatMissedCallsAnswersALine,$F#chatNotifsAnswersWithAPostedNotification" $R | grep -E "^OK|^FAIL|Error in|Tests run|^[0-9]+\)" || true

echo "== phase 2: a fake incoming call from 5551234, missed"
$RUN "$F#aRingingCallIsNamedThenBecomesAMissedCall" $R > /tmp/ring.out 2>&1 &
sleep 12
$A emu gsm call 5551234 >/dev/null
sleep 8
$A emu gsm cancel 5551234 >/dev/null
wait
grep -E "^OK|^FAIL|Error in|Tests run" /tmp/ring.out || cat /tmp/ring.out

echo "== phase 3: permissions taken away"
$A shell pm revoke $P android.permission.CALL_PHONE
$A shell pm revoke $P android.permission.READ_CALL_LOG
$RUN "$F#revokedCallPhoneIsRefusedAndNoCallStarts,$F#revokedCallLogGivesTheSettingsFixNotACrash" $R | grep -E "^OK|^FAIL|Error in|Tests run" || true
$A shell pm grant $P android.permission.CALL_PHONE
$A shell pm grant $P android.permission.READ_CALL_LOG

echo "== phase 4: voice (TTS, model download + Vosk)"
$RUN "com.akshatgg.buddy.device.DeviceVoiceTest" $R | grep -E "^OK|^FAIL|Error in|Tests run" || true
