/**
 * How many requests a full walk of the paginated model list is assumed to cost
 * when nothing better is known. Only a fallback: callers pass the page count
 * their last successful refresh actually needed, because the figure grows with
 * the dataset — 616 models at 200 per page is four requests today, and it
 * becomes five at 801.
 */
export const DEFAULT_PAGES_NEEDED = 4;

/**
 * Decides whether a full refresh can finish inside what is left of the upstream
 * window, from the last rate-limit headers we saw. Starting one that cannot
 * finish is the worst outcome available: it spends every remaining request and
 * still produces no snapshot.
 *
 * Pure, and deliberately generous about missing information — the guard exists
 * to stop a refresh that is known to be doomed, not to block one that merely
 * cannot be proven safe.
 */
export function refreshBudget({ rateLimit, pagesNeeded = DEFAULT_PAGES_NEEDED, now = new Date() }) {
  const allowed = (detail) => ({ allowed: true, ...detail });

  // Nothing observed yet: a first run has to be allowed to find out.
  if (!rateLimit) return allowed({ reason: 'no rate-limit reading yet' });

  // The endpoint did not send the headers, so `remaining` is a label rather
  // than a measurement. There is nothing to decide against.
  if (typeof rateLimit.remaining !== 'number') {
    return allowed({ reason: 'upstream did not report a remaining count' });
  }

  // The reading belongs to a window that has since rolled over, so the count is
  // stale in the one direction that is safe to ignore.
  const resetsAt = Date.parse(rateLimit.resetsAt ?? '');
  if (Number.isFinite(resetsAt) && resetsAt <= now.getTime()) {
    return allowed({ reason: 'the observed window has since reset' });
  }

  if (rateLimit.remaining >= pagesNeeded) {
    return allowed({ remaining: rateLimit.remaining, pagesNeeded });
  }

  return {
    allowed: false,
    reason:
      `a full refresh needs ${pagesNeeded} requests and only ${rateLimit.remaining} ` +
      `of ${rateLimit.limit ?? 'unknown'} are left in the current window`,
    remaining: rateLimit.remaining,
    pagesNeeded,
    resetsAt: rateLimit.resetsAt ?? null,
  };
}
