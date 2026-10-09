// Settings → Admin without the page: the Mac's Admin window's form logic and words (src/renderer/admin/admin.js), for
// the same routes (/api/admin/settings, /models, /users). admin.js draws it.

export const NO_KEYS = "No AI key is set on the server yet, so free mode can't be turned on.";
export const VOICE_ON = 'Voice is on.';
export const VOICE_OFF = 'Voice needs GROQ_API_KEY in Vercel.';
export const LOADING_MODELS = 'Loading the models…';
export const USUAL_MODELS = 'The usual models for this provider.';
export const SAVING = 'Saving…';
export const SAVED = 'Saved ✓ Every Buddy app uses it the next time it is opened.';
export const CLAWD_SAVED = 'Saved ✓ Every Buddy app uses it the next time it checks.';

/** The daily box and "own key" belong to a daily limit only. */
export const dailyShown = (limitMode) => limitMode === 'daily';

/** The voice line: on when the server has a Groq key; without one, where the key goes. */
export function voiceLine(voiceOn) {
  return voiceOn === true ? { text: VOICE_ON, kind: 'muted' } : { text: VOICE_OFF, kind: 'note' };
}

/** What the Free AI form starts as, from the server's view { config, providers }. */
export function formView({ config, providers }) {
  const withKey = providers.filter((p) => p.hasKey);
  return {
    noKeys: withKey.length === 0,
    // Free mode can't be switched on with no key on the server (it can still be switched off).
    enabledLocked: withKey.length === 0 && !config.enabled,
    // Only providers with a key on the server can be picked, plus the saved one, so that the list shows what is saved.
    providers: providers.filter((p) => p.hasKey || p.id === config.provider).map((p) => ({
      value: p.id,
      label: p.hasKey ? p.label : `${p.label} (no key on the server)`,
      selected: p.id === config.provider,
    })),
  };
}

/** `models` with `chosen` selected, kept in the list even when the server no longer lists it. */
export function modelOptions(models, chosen) {
  const list = models.includes(chosen) ? models : [chosen, ...models];
  return list.map((m) => ({ value: m, label: m, selected: m === chosen }));
}

/** The note under Model once the list came: GET /api/admin/models's { live, warning }. */
export function modelsNote({ live, warning }) {
  return live || warning ? '' : USUAL_MODELS;
}

/**
 * The switches as the form has them, for PUT /api/admin/settings. The daily box and "own key" are only read for a
 * daily limit (they are hidden for Unlimited), so what is left in them then cannot stop Unlimited from saving.
 */
export function readForm({ enabled, limitMode, daily, own, provider, model }) {
  const mode = limitMode || 'daily';
  const form = { enabled, limitMode: mode, provider, model };
  if (mode === 'daily') {
    form.dailyRequests = Number(daily);
    form.allowOwnKey = own;
  }
  return form;
}

/** "Last active": the time in the phone's own way of writing it, or "never". */
export function lastActiveText(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

export const usersText = (count) => (count === 1 ? '1 user' : `${count} users`);
