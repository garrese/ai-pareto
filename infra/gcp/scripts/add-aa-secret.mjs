import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectId = process.argv[2];
if (!projectId) {
  console.error('Usage: node scripts/add-aa-secret.mjs <google-cloud-project-id>');
  process.exit(2);
}
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  console.error('The Google Cloud project ID has an invalid format');
  process.exit(2);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const configPath = resolve(here, '..', '..', '..', 'apps', 'api', 'config.properties');
const properties = await readFile(configPath, 'utf8');
const apiKey = properties
  .split(/\r?\n/)
  .find((line) => line.trim().startsWith('aa.api.key='))
  ?.split('=', 2)[1]
  ?.trim();

if (!apiKey) {
  console.error(`No aa.api.key value found in ${configPath}`);
  process.exit(2);
}

const executable = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
const child = spawn(
  executable,
  [
    'secrets',
    'versions',
    'add',
    'artificial-analysis-api-key',
    '--data-file=-',
    `--project=${projectId}`,
  ],
  {
    shell: process.platform === 'win32',
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  },
);

child.stdin.end(apiKey);
child.on('error', (error) => {
  console.error(`Unable to start gcloud: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
