'use strict';

module.exports = async function powerCheck(ctx, { assert }) {
  assert.deepStrictEqual(ctx.loginCalls, [true], 'the login item is restored at launch because the buddy is on');
  ctx.power.setOn(false);
  assert.strictEqual(ctx.buddy.isVisible(), false, 'turning off hides the buddy');
  assert.strictEqual(ctx.store.get('buddyOn'), false);
  ctx.power.setOn(true);
  assert.strictEqual(ctx.buddy.isVisible(), true, 'turning on shows it again');
  assert.deepStrictEqual(ctx.loginCalls, [true, false, true]);
};
