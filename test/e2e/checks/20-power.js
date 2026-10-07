'use strict';

const { defaultShortcut } = require('../../../src/main/platform');

module.exports = async function powerCheck(ctx, { assert, delay }) {
  const registered = ctx.globalShortcut.registered; // what the app has registered with the (fake) system
  assert.deepStrictEqual(ctx.loginCalls, [true], 'the login item is restored at launch because the buddy is on');
  assert.deepStrictEqual([...registered.keys()], [defaultShortcut], 'the buddy is on, so its shortcut is registered');
  const press = registered.get(defaultShortcut);

  ctx.power.setOn(false);
  assert.strictEqual(ctx.buddy.isVisible(), false, 'turning off hides the buddy');
  assert.strictEqual(ctx.store.get('buddyOn'), false);
  assert.deepStrictEqual([...registered.keys()], [], 'turning off releases the shortcut: no accelerator is registered');

  // A press that was already on its way when the shortcut was released must do nothing either.
  const toggle = ctx.actions.toggle;
  let toggled = 0;
  ctx.actions.toggle = (...args) => {
    toggled += 1;
    return toggle.apply(ctx.actions, args);
  };
  try {
    press();
    await delay(300);
  } finally {
    ctx.actions.toggle = toggle;
  }
  assert.strictEqual(toggled, 0, 'a press while the buddy is off does not even try to open the panel');
  assert.strictEqual(ctx.panel.isVisible(), false, 'and the panel stays closed');

  ctx.power.setOn(true);
  assert.strictEqual(ctx.buddy.isVisible(), true, 'turning on shows it again');
  assert.deepStrictEqual([...registered.keys()], [defaultShortcut], 'and registers the same shortcut again');
  assert.strictEqual(typeof registered.get(defaultShortcut), 'function');
  assert.deepStrictEqual(ctx.loginCalls, [true, false, true]);
};
