upload-mesures-to-github.js

This script reads the mesures JSON file and creates one GitHub Issue per measure (one work item per measure).

Requirements
- Node 18+ (recommended) OR install `node-fetch@2` in the repo: `npm install --save-dev node-fetch@2`
- A GitHub personal access token with `repo` scope (or `public_repo` for public repositories).

Environment
- `GITHUB_TOKEN` — your personal access token
- Optional: `GITHUB_OWNER` and `GITHUB_REPO` environment variables. You can also pass `--owner` and `--repo` on the command line.

Usage

Dry-run (no network calls):

```
node scripts/upload-mesures-to-github.js --file=src/assets/data/mesures.json --dry-run --limit=5
```

Real run:

```
export GITHUB_TOKEN=ghp_xxx
node scripts/upload-mesures-to-github.js --file=src/assets/data/mesures.json --owner=my-org --repo=my-repo
```

Flags
- `--file=PATH` — path to the JSON file (default `src/assets/data/mesures.json`)
- `--owner=OWNER` — GitHub owner/org (can be set via `GITHUB_OWNER` env var)
- `--repo=REPO` — GitHub repository name (can be set via `GITHUB_REPO` env var)
- `--dry-run` — only prints what would be created
- `--limit=N` — only process the first N mesures (useful for testing)

Behavior
- The script creates issues with title `Mesure <id> — <titre>` and a body containing `Mesure ID: <id>` (used to detect duplicates).
- If an issue that contains `Mesure ID: <id>` in its body already exists, the script skips creating a duplicate.

Notes
- To add created issues into a GitHub Project board (project v2) or link them to a project column, additional GraphQL API calls are required; this script currently creates GitHub Issues only. If you want project assignment as well, tell me and I will extend the script.
