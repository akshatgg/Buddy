'use strict';

/**
 * "Always on": once the buddy is turned on it comes back after every restart,
 * until the user turns it off inside Buddy. Two things must agree: buddyOn in
 * the settings, and the login item that opens Buddy when the Mac starts.
 */

function createPower({ store, loginItems, onChange }) {
  return {
    isOn: () => store.get('buddyOn') === true,
    setOn(on) {
      store.set({ buddyOn: on });
      loginItems.set(on);
      onChange(on);
    },
    /** At launch: if the buddy is on, make sure the login item is still there. */
    syncAtLaunch() {
      if (store.get('buddyOn') && !loginItems.get()) loginItems.set(true);
    },
  };
}

function electronLoginItems(app) {
  return {
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (on) => app.setLoginItemSettings({ openAtLogin: on }),
  };
}

module.exports = { createPower, electronLoginItems };
