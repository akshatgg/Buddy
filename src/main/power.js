'use strict';

/**
 * "Always on": once the buddy is turned on it comes back after every restart,
 * until the user turns it off inside Buddy. Two things must agree: buddyOn in
 * the settings, and the login item that opens Buddy when the Mac (or the PC) starts.
 */

function createPower({ store, loginItems, onChange }) {
  const isOn = () => store.get('buddyOn') === true;

  /**
   * Add or remove the login item. When the system refuses, that is logged and nothing else happens:
   * the setting is what the person chose, and the buddy works without the login item.
   */
  function setLoginItem(on) {
    try {
      loginItems.set(on);
    } catch (err) {
      console.warn(`[buddy] could not ${on ? 'add' : 'remove'} the login item:`, err?.message ?? err);
    }
  }

  return {
    isOn,
    setOn(on) {
      store.set({ buddyOn: on });
      setLoginItem(on);
      onChange(on);
    },
    /** At launch, make the login item agree with the setting: on and missing, add it; off and still there, remove it. */
    syncAtLaunch() {
      let present;
      try {
        present = Boolean(loginItems.get());
      } catch (err) {
        console.warn('[buddy] could not read the login item:', err?.message ?? err);
        return;
      }
      if (present !== isOn()) setLoginItem(isOn());
    },
  };
}

function electronLoginItems(app) {
  return {
    get: () => app.getLoginItemSettings().openAtLogin,
    set: (on) => app.setLoginItemSettings({ openAtLogin: on }),
  };
}

// A development run has none. On macOS, setLoginItemSettings registers the running app bundle, which
// there is node_modules/electron/dist/Electron.app: at the next login that opens Electron's own window
// and no Buddy. Only the installed Buddy.app can be a login item.
const NO_LOGIN_ITEM = Object.freeze({ get: () => false, set: () => {} });

/** The login items an app uses: its own when installed, none in a development run. */
function loginItemsFor(app) {
  if (app.isPackaged) return electronLoginItems(app);
  console.info('[buddy] the login item is only used by the installed app, so this development run adds none');
  return NO_LOGIN_ITEM;
}

module.exports = { createPower, electronLoginItems, loginItemsFor };
