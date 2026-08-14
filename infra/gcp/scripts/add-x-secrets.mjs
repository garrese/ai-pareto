import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node scripts/add-x-secrets.mjs <google-cloud-project-id>');
  process.exit(2);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const configPath = resolve(here, '..', '..', '..', 'apps', 'x-publisher', 'config.properties');
const properties = Object.fromEntries(
  (await readFile(configPath, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }),
);
const secrets = new Map([
  ['x-api-key', properties['x.api.key']],
  ['x-api-secret', properties['x.api.secret']],
  ['x-access-token', properties['x.access.token']],
  ['x-access-token-secret', properties['x.access.token.secret']],
]);

if ([...secrets.values()].some((value) => !value)) {
  console.error(`One or more X credential values are missing in ${configPath}`);
  process.exit(2);
}

const executable = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
for (const [secretId, value] of secrets) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      executable,
      ['secrets', 'versions', 'add', secretId, '--data-file=-', `--project=${projectId}`],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    child.stdin.end(value);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`gcloud failed while updating ${secretId}`));
    });
  });
}
