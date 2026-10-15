#!/bin/sh
# Seeds a fresh emulator for the device tests in app/src/androidTest/.../device: permissions, notification access, contacts.
# Usage: emulator-seed.sh   (adb must see one emulator, the debug APK installed)
set -e
ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
P=com.akshatgg.buddy
for perm in READ_CONTACTS CALL_PHONE READ_PHONE_STATE READ_CALL_LOG RECORD_AUDIO POST_NOTIFICATIONS; do
  $ADB shell pm grant $P android.permission.$perm
done
$ADB shell cmd notification allow_listener $P/$P.notify.BuddyNotifications
# a contact: name, number, phone type (2 = mobile)
contact() {
  $ADB shell content insert --uri content://com.android.contacts/raw_contacts --bind account_type:n: --bind account_name:n:
  id=$($ADB shell content query --uri content://com.android.contacts/raw_contacts --projection _id | sed -n 's/.*_id=\([0-9]*\).*/\1/p' | sort -n | tail -1)
  $ADB shell content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$id --bind mimetype:s:vnd.android.cursor.item/name --bind data1:s:"'$1'"
  $ADB shell content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:$id --bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:"$2" --bind data2:i:2
}
if ! $ADB shell content query --uri content://com.android.contacts/data --projection data1 | grep -q "Prince Sharma"; then
  contact "Prince Sharma" 5550100
  contact "Ringer Test" 5551234
  contact "Twin Dup" 5550201
  contact "Twin Dup" 5550202
fi
