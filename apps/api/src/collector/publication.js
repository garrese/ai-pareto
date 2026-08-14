/**
 * Storage adapter contract:
 * - putImmutable(path, body) must never replace different existing content;
 * - putManifest(path, body) may replace the current manifest.
 *
 * Immutable objects may be written concurrently, but the manifest is not
 * attempted until every immutable write succeeds.
 */
function validate(artifacts, storage) {
  if (!Array.isArray(artifacts?.immutableObjects) || !artifacts?.manifestObject) {
    throw new Error('Invalid snapshot artifacts');
  }
  if (
    typeof storage?.putImmutable !== 'function' ||
    typeof storage?.putManifest !== 'function'
  ) {
    throw new Error('Storage must implement putImmutable and putManifest');
  }
}

export async function publishImmutableObjects(artifacts, storage) {
  validate(artifacts, storage);
  await Promise.all(
    artifacts.immutableObjects.map(({ path, body }) => storage.putImmutable(path, body)),
  );
}

export async function publishManifestObject(artifacts, storage) {
  validate(artifacts, storage);
  await storage.putManifest(artifacts.manifestObject.path, artifacts.manifestObject.body);
}

export async function publishSnapshot(artifacts, storage) {
  await publishImmutableObjects(artifacts, storage);
  await publishManifestObject(artifacts, storage);
}
