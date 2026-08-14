import { createHash } from 'node:crypto';

/**
 * JSON representation with object keys sorted recursively. Arrays retain their
 * order, so callers must sort set-like arrays before hashing them.
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
