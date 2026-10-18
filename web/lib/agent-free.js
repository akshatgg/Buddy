'use strict';

/**
 * Free mode's limits for agent jobs (spec §9): a person's jobs of the day and the steps of each, in one record per
 * person per day ({ jobs: { jobId: steps }, count }), and the day's spend for every free job together ({ usd }). Pure
 * changes, run by the database in a transaction (firestore-db.js updateAgentDay, updateSpend).
 */

function jobStep(doc, { jobId, step, jobsLimit, maxSteps }) {
  const jobs = doc && typeof doc.jobs === 'object' && doc.jobs ? { ...doc.jobs } : {};
  const count = doc && Number.isInteger(doc.count) ? doc.count : 0;
  const done = Number.isInteger(jobs[jobId]) ? jobs[jobId] : 0;
  if (step === 1) {
    if (done > 0) return { next: undefined, result: { ok: false, reason: 'no_job' } };
    if (count >= jobsLimit) return { next: undefined, result: { ok: false, reason: 'jobs' } };
    return { next: { jobs: { ...jobs, [jobId]: 1 }, count: count + 1 }, result: { ok: true } };
  }
  if (done < 1) return { next: undefined, result: { ok: false, reason: 'no_job' } };
  if (done >= maxSteps) return { next: undefined, result: { ok: false, reason: 'steps' } };
  return { next: { jobs: { ...jobs, [jobId]: done + 1 }, count }, result: { ok: true } };
}

const spentOf = (doc) => (doc && typeof doc.usd === 'number' && Number.isFinite(doc.usd) ? doc.usd : 0);

function addSpend(doc, usd) {
  const total = spentOf(doc) + usd;
  return { next: { usd: total }, result: total };
}

module.exports = { jobStep, addSpend, spentOf };
