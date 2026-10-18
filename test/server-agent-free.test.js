'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { jobStep, addSpend, spentOf } = require('../web/lib/agent-free');

test('step 1 starts a job, counted against the jobs of the day', () => {
  const a = jobStep(null, { jobId: 'job-1', step: 1, jobsLimit: 2, maxSteps: 30 });
  assert.deepStrictEqual(a, { next: { jobs: { 'job-1': 1 }, count: 1 }, result: { ok: true } });
  const b = jobStep(a.next, { jobId: 'job-2', step: 1, jobsLimit: 2, maxSteps: 30 });
  assert.deepStrictEqual(b.result, { ok: true });
  const c = jobStep(b.next, { jobId: 'job-3', step: 1, jobsLimit: 2, maxSteps: 30 });
  assert.deepStrictEqual(c, { next: undefined, result: { ok: false, reason: 'jobs' } });
});

test('later steps need a started job and stop at the step limit', () => {
  const started = jobStep(null, { jobId: 'job-1', step: 1, jobsLimit: 5, maxSteps: 2 }).next;
  const two = jobStep(started, { jobId: 'job-1', step: 2, jobsLimit: 5, maxSteps: 2 });
  assert.deepStrictEqual(two, { next: { jobs: { 'job-1': 2 }, count: 1 }, result: { ok: true } });
  assert.deepStrictEqual(jobStep(two.next, { jobId: 'job-1', step: 3, jobsLimit: 5, maxSteps: 2 }).result, { ok: false, reason: 'steps' });
  assert.deepStrictEqual(jobStep(started, { jobId: 'nope', step: 2, jobsLimit: 5, maxSteps: 2 }).result, { ok: false, reason: 'no_job' });
  assert.deepStrictEqual(jobStep(started, { jobId: 'job-1', step: 1, jobsLimit: 5, maxSteps: 2 }).result, { ok: false, reason: 'no_job' }, 'a job is started once');
});

test('spend adds up per day', () => {
  const a = addSpend(null, 0.25);
  assert.deepStrictEqual(a, { next: { usd: 0.25 }, result: 0.25 });
  assert.deepStrictEqual(addSpend(a.next, 0.5).result, 0.75);
  assert.strictEqual(spentOf(null), 0);
  assert.strictEqual(spentOf({ usd: 1.5 }), 1.5);
  assert.strictEqual(spentOf({ usd: 'x' }), 0);
});
