import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const serialize = (body) => `${JSON.stringify(body, null, 2)}\n`;

export class LocalSnapshotStore {
  constructor(root) {
    this.root = resolve(root);
  }

  #resolveObjectPath(objectPath) {
    const target = resolve(this.root, objectPath);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Object path escapes the local snapshot root: ${objectPath}`);
    }
    return target;
  }

  async putImmutable(objectPath, body) {
    const target = this.#resolveObjectPath(objectPath);
    const payload = serialize(body);
    await mkdir(dirname(target), { recursive: true });

    try {
      await writeFile(target, payload, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFile(target, 'utf8');
      if (existing !== payload) {
        throw new Error(`Immutable object already exists with different content: ${objectPath}`);
      }
    }
  }

  async putManifest(objectPath, body) {
    const target = this.#resolveObjectPath(objectPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, serialize(body), 'utf8');
  }
}
