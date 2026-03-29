#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  argv.forEach(a => {
    if (!a.startsWith('--')) return;
    const [k, v] = a.slice(2).split('=');
    args[k] = v === undefined ? true : v;
  });
  return args;
}

const args = parseArgs(process.argv.slice(2));
const fileArg = args.file || 'src/assets/data/mesures.json';
const dryRun = !!args['dry-run'];
const ownerArg = args.owner || process.env.GITHUB_OWNER;
const repoArg = args.repo || process.env.GITHUB_REPO;
const token = process.env.GITHUB_TOKEN;
const limit = args.limit ? parseInt(args.limit, 10) : undefined;

async function getFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  try {
    // Try node-fetch v2
    // If you see an error here, run: npm install node-fetch@2
    // or run the script with Node 18+
    return require('node-fetch');
  } catch (e) {
    console.error('No global fetch available and node-fetch not installed.');
    console.error('Use Node 18+ or run: npm install node-fetch@2');
    process.exit(1);
  }
}

function readJson(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }
  const txt = fs.readFileSync(resolved, 'utf8');
  try {
    return JSON.parse(txt);
  } catch (e) {
    console.error('Invalid JSON in', resolved, e.message);
    process.exit(1);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async function main() {
  const fetch = await getFetch();
  const json = readJson(fileArg);
  const mesures = json.mesures || json.measures || json.measure || [];
  const chapitres = json.chapitres || [];

  if (!mesures.length) {
    console.error('No mesures found in the provided file.');
    process.exit(1);
  }

  if (!dryRun && (!token || !ownerArg || !repoArg)) {
    console.error('Missing configuration. For non-dry run please set:');
    console.error('- environment variable GITHUB_TOKEN (personal access token)');
    console.error('- provide --owner=OWNER and --repo=REPO (or set GITHUB_OWNER and GITHUB_REPO env vars)');
    process.exit(1);
  }

  const toProcess = typeof limit === 'number' ? mesures.slice(0, limit) : mesures;

  console.log(`Processing ${toProcess.length} mesures from ${fileArg}` + (dryRun ? ' (dry-run)' : ''));

  async function searchExists(measureId) {
    const q = encodeURIComponent(`repo:${ownerArg}/${repoArg} in:body "Mesure ID: ${measureId}"`);
    const url = `https://api.github.com/search/issues?q=${q}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json'
      }
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub search failed: ${res.status} ${txt}`);
    }
    const data = await res.json();
    return (data.total_count || 0) > 0;
  }

  async function createIssue(title, body, labels = ['mesure']) {
    const url = `https://api.github.com/repos/${ownerArg}/${repoArg}/issues`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, body, labels })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GitHub create issue failed: ${res.status} ${txt}`);
    }
    return res.json();
  }

  for (const m of toProcess) {
    const chapitre = chapitres.find(c => c.id === m.chapitreId);
    const chapitreLabel = chapitre ? chapitre.titre : `Chapitre ${m.chapitreId}`;
    const title = `Mesure ${m.id} — ${m.titre}`;
    const body = `Mesure ID: ${m.id}\nChapitre: ${chapitreLabel}\nPriorité: ${m.priorite || '—'}\nStatut: ${m.statut || '—'}\nDefinitionOfDone: ${m.definitionOfDone || '—'}\n\n---\n\nDétails (JSON):\n\n\
\\`\\\`\\\`json\n${JSON.stringify(m, null, 2)}\n\\`\\\`\\`\n`;

    if (dryRun) {
      console.log('[dry-run] Issue title:', title);
      console.log('[dry-run] Issue body preview:\n', body.split('\n').slice(0, 10).join('\n'));
      continue;
    }

    try {
      const exists = await searchExists(m.id);
      if (exists) {
        console.log(`Skipping mesure ${m.id} — already present in the repository.`);
        continue;
      }

      const issue = await createIssue(title, body, ['mesure']);
      console.log(`Created issue #${issue.number}: ${issue.html_url}`);

      // polite wait to avoid hitting abuse limits
      await sleep(800);
    } catch (err) {
      console.error(`Error processing mesure ${m.id}:`, err.message || err);
      // continue with next measure
      await sleep(1000);
    }
  }

  console.log('Done.');
})();
