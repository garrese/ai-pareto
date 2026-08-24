/**
 * Short labels for the chart.
 *
 * Upstream names carry their configuration in a parenthesis, and some of them
 * are unreadable on a plot: "Claude Fable 5 (Adaptive Reasoning, Max Effort,
 * Opus 4.8 Fallback)" is 66 characters, about 390px of label on a plot that is
 * 1150px wide. The parenthesis is dropped and, where a family has more than one
 * variant, replaced by a letter — so the reader still sees that there are
 * several of them, and reads the configuration off the card instead.
 *
 * Letters rather than salvaged words ("max", "NR") on purpose: families mix
 * short suffixes with long ones — `GPT-5.6 Terra` has `(low)` next to
 * `(Non-reasoning)` — and lettering only the ones that need it makes the
 * shorthand mean two different things within one family.
 *
 * `name` is never replaced. This adds `shortName` alongside it, plus the bare
 * `shortLetter` for the places that only have room for the letter, and the
 * card, the table and the pickers go on showing the real thing.
 */

/** Everything up to the first parenthesis: the family a variant belongs to. */
function familyOf(name) {
  const open = name.indexOf(' (');
  return open === -1 ? name : name.slice(0, open);
}

/**
 * Ascending intelligence, so consecutive letters read as "more capable" — which
 * is the whole reason a reader tolerates them. Models with no measured index
 * sort last rather than first: they would otherwise take `(a)`–`(d)` in a
 * family like Claude Sonnet 5 and leave the two measured variants at the end of
 * the alphabet, where the ordering says nothing at all.
 */
function byIntelligence(left, right) {
  const a = Number.isFinite(left.intelligence) ? left.intelligence : Infinity;
  const b = Number.isFinite(right.intelligence) ? right.intelligence : Infinity;
  // Both unmeasured compares equal, so the name is what settles it. Some tiebreak
  // has to be deterministic or a reload can move a model's letter.
  if (a !== b) return a - b;
  return left.name.localeCompare(right.name);
}

/**
 * `a`…`z`, then `aa`, `ab`, … No family comes close to 26 variants today — the
 * largest is six — but a silent wrap back to `a` would be two models with the
 * same label, which is the one thing this must never produce.
 */
function letterFor(index) {
  let label = '';
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    label = String.fromCharCode(97 + (n % 26)) + label;
  }
  return label;
}

/**
 * Copies of `models` with a `shortName`, and a `shortLetter` where one was
 * assigned, added to each. Computed over the whole dataset, once, rather than
 * over what is drawn: a letter that changed as you filtered would be worse than
 * no letter.
 *
 * @param {any[]} models
 * @returns {any[]}
 */
export function withShortNames(models) {
  const families = new Map();
  for (const model of models) {
    const family = familyOf(model.name);
    const members = families.get(family);
    if (members) members.push(model);
    else families.set(family, [model]);
  }

  const shortNames = new Map();
  const letters = new Map();
  for (const [family, members] of families) {
    // Alone in its family, the parenthesis distinguishes it from nothing, so it
    // just goes. A model with no parenthesis at all comes through unchanged.
    if (members.length === 1) {
      shortNames.set(members[0].id, family);
      continue;
    }
    [...members].sort(byIntelligence).forEach((model, index) => {
      const letter = letterFor(index);
      letters.set(model.id, letter);
      shortNames.set(model.id, `${family} (${letter})`);
    });
  }

  // The letter is kept apart from the label it was built into: the table shows
  // it on its own, in a column the family name would never fit in.
  return models.map((model) => ({
    ...model,
    shortName: shortNames.get(model.id) ?? model.name,
    shortLetter: letters.get(model.id) ?? null,
  }));
}

/** True when a model's chart label is not the whole story. */
export const isShortened = (model) => Boolean(model.shortName) && model.shortName !== model.name;

/** What the chart draws. Falls back to the real name if nothing was computed. */
export const chartLabel = (model) => model.shortName ?? model.name;
