# Local development

This guide keeps environment-specific setup details out of the project overview. For the system
design, see the [architecture document](architecture.md).

## Prerequisites

- Node.js 22 or later
- An Artificial Analysis Data API key

Create an ignored local configuration file from the example:

```bash
cp apps/api/config.properties.example apps/api/config.properties
```

Set `aa.api.key` in that file, then start the local server:

```bash
cd apps/api
npm ci
npm start
```

Open <http://localhost:8787>. The local Node server provides `/api/*` and serves the static frontend
from `apps/web`, so both are available from the same origin.

## Restricted Windows PowerShell

On a managed Windows machine with a restricted PowerShell execution policy, the `npm` command can
resolve to `npm.ps1` and fail before Node runs. Use the batch shim instead:

```powershell
npm.cmd ci
npm.cmd start
```

This does not require changing PowerShell execution policy, administrator access, or a persistent
machine setting.

## Useful commands

| Application | Command | Purpose |
| --- | --- | --- |
| `apps/api` | `npm test` | Run local API and collector tests. |
| `apps/api` | `npm run dev` | Start the local server with file watching. |
| `apps/api` | `npm run snapshot` | Create local public snapshot objects from the cache or one upstream fetch. |
| `apps/web` | `npm test` | Run frontend data-source tests. |
| `apps/x-publisher` | `npm test` | Run notification delivery tests. |
| `apps/x-publisher` | `npm run sample` | Render a real cached-data notification as a dry run. |

Each application is self-contained. Run its command from the corresponding directory; there is no
root package manifest or install step.
