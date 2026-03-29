#!/usr/bin/env node

'use strict';

/**
 * Fetches items from a GitHub Project V2 and generates/updates mesures.json.
 *
 * Required env vars:
 *   GITHUB_TOKEN      PAT with "read:project" scope (classic project tokens
 *                     must also include "repo" for private repos)
 *
 * Optional env vars:
 *   ORG               GitHub organisation login  (default: leblancmesnil)
 *   PROJECT_NUMBER    Project number from the URL (default: 2)
 *   OUTPUT_FILE       Output path                 (default: src/assets/data/mesures.json)
 *   DRY_RUN           "true" to preview without writing (default: false)
 *
 * Field mapping (project field name → mesure property):
 *   Status / Statut                → statut
 *   Priority / Priorité            → priorite
 *   Chapitre / Chapter             → chapitreId
 *   ID / Mesure ID / Numéro        → mesureId (id)
 *   Definition of Done / DoD       → definitionOfDone
 *
 * Falls back to parsing the issue title ("Mesure N — titre") and body
 * ("FieldName: value" lines written by upload-mesures-to-github.js) when
 * project fields are absent.
 */

const fs = require('fs/promises');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG || 'leblancmesnil';
const PROJECT_NUMBER = parseInt(process.env.PROJECT_NUMBER || process.env.PROJECT_ID || '2', 10);
const OUTPUT_FILE =
  process.env.OUTPUT_FILE ||
  path.join(process.cwd(), 'src', 'assets', 'data', 'mesures.json');
const DRY_RUN = process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1';

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable is required.');
  console.error('Provide a GitHub PAT with the "read:project" scope.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

async function graphql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'generate-mesures-from-project/2.0',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (data.errors?.length) {
    throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join('; ')}`);
  }
  return data.data;
}

/** Fetches one page of project items (100 max) with all field values. */
const ITEMS_QUERY = `
  query($org: String!, $number: Int!, $cursor: String) {
    organization(login: $org) {
      projectV2(number: $number) {
        title
        items(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
            nodes {
            id
            type
            fieldValues(first: 30) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field { ... on ProjectV2FieldCommon { name } }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field { ... on ProjectV2FieldCommon { name } }
                }
              }
            }
            content {
              __typename
              ... on Issue {
                number
                title
                body
                labels(first: 20) { nodes { name } }
              }
              ... on DraftIssue {
                title
                body
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Field name / value normalisation
// ---------------------------------------------------------------------------

/** Strip accents and lowercase for loose matching. */
function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Maps a project field name to one of our semantic keys. */
function fieldAlias(name) {
  const n = norm(name);
  switch (n) {
    case 'status': case 'statut': case 'etat': return 'statut';
    case 'priority': case 'priorite': case 'prio': return 'priorite';
    case 'chapitre': case 'chapitreid': case 'chapter': return 'chapitreId';
    case 'id': case 'mesure id': case 'mesureid': case 'numero': return 'mesureId';
    case 'definition of done': case 'definitionofdone': case 'dod': return 'definitionOfDone';
    default: return null;
  }
}

function mapStatut(value) {
  const v = norm(value);
  if (/a[\s\-]*demarrer|todo|to do|backlog|not started|new/.test(v)) return 'a-demarrer';
  if (/en[\s\-]*cours|in[\s\-]*progress|doing|started|wip/.test(v)) return 'en-cours';
  if (/livr|done|termin|complet|realise|closed/.test(v)) return 'livre';
  console.warn(`  [WARN] Unknown status "${value}" — defaulting to "a-demarrer"`);
  return 'a-demarrer';
}

function mapPriorite(value) {
  const v = norm(value);
  // P0 → A, P1 → B, P2/P3/… → C
  if (/^p0$/.test(v)) return 'A';
  if (/^p1$/.test(v)) return 'B';
  if (/^p\d+$/.test(v)) return 'C';
  // Explicit letter values
  if (/^a$|impact im|immediat/.test(v)) return 'A';
  if (/^b$|structurant/.test(v)) return 'B';
  if (/^c$|long terme/.test(v)) return 'C';
  const m = v.match(/\b([abc])\b/);
  if (m) return m[1].toUpperCase();
  console.warn(`  [WARN] Unknown priority "${value}" — defaulting to "C"`);
  return 'C';
}

/**
 * Parses a named field from an issue body written by upload-mesures-to-github.js.
 * Format: "FieldName: value" (one per line, "—" means empty).
 */
function bodyField(body, ...names) {
  for (const name of names) {
    const m = (body || '').match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
    if (m && m[1].trim() !== '—') return m[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Item extraction
// ---------------------------------------------------------------------------

function extractMesure(item, tagMap) {
  if (!item.content || item.type === 'REDACTED') return null;

  const title = item.content.title || '';
  const body = item.content.body || '';
  const labels = (item.content.labels?.nodes || []).map(l => l.name);

  // Build a map of semantic-key → project-field-value
  const fields = {};
  for (const fv of item.fieldValues?.nodes || []) {
    if (!fv.field?.name) continue;
    const alias = fieldAlias(fv.field.name);
    if (!alias) continue;
    const value = fv.text ?? fv.number ?? fv.name ?? fv.date ?? null;
    if (value !== null && value !== undefined) fields[alias] = value;
  }

  // --- id ---
  let id;
  if (fields.mesureId !== undefined) {
    id = parseInt(String(fields.mesureId), 10);
  } else {
    // "Mesure 42 — titre" pattern (written by the upload script)
    const m = title.match(/^[Mm]esure\s+(\d+)\s*[—\-–]/);
    if (m) id = parseInt(m[1], 10);
    else {
      const bodyId = bodyField(body, 'Mesure ID');
      if (bodyId) id = parseInt(bodyId, 10);
    }
  }

  // --- titre ---
  let titre = title.replace(/^[Mm]esure\s+\d+\s*[—\-–]\s*/, '').trim() || title;

  // --- chapitreId ---
  let chapitreId = 0;
  if (fields.chapitreId !== undefined) {
    chapitreId = parseInt(String(fields.chapitreId), 10) || 0;
  } else {
    const bodyChap = bodyField(body, 'Chapitre');
    if (bodyChap) {
      const chapNum = parseInt(bodyChap, 10);
      if (!isNaN(chapNum)) chapitreId = chapNum;
    }
    if (!chapitreId) {
      // Match by chapter tag (e.g. "gouvernance", "santé") from chapitre.tag field
      for (const label of labels) {
        const chapId = tagMap?.get(norm(label));
        if (chapId) { chapitreId = chapId; break; }
      }
    }
    if (!chapitreId) {
      // Fallback: numeric pattern e.g. "chapitre-3" or "ch3"
      for (const label of labels) {
        const m = label.match(/chapitr?e[-\s]?(\d+)/i) || label.match(/^ch(\d+)$/i);
        if (m) { chapitreId = parseInt(m[1], 10); break; }
      }
    }
  }

  // --- statut ---
  const statut =
    fields.statut !== undefined
      ? mapStatut(String(fields.statut))
      : mapStatut(bodyField(body, 'Statut') || 'a-demarrer');

  // --- priorite ---
  let priorite = 'C';
  if (fields.priorite !== undefined) {
    priorite = mapPriorite(String(fields.priorite));
  } else {
    const bodyPrio = bodyField(body, 'Priorit[ée]', 'Priorite');
    if (bodyPrio) {
      priorite = mapPriorite(bodyPrio);
    } else {
      for (const label of labels) {
        const m = label.match(/^prio(?:rit[ée])?[-\s]?([ABC])$/i);
        if (m) { priorite = m[1].toUpperCase(); break; }
      }
    }
  }

  // --- definitionOfDone ---
  // Priority: dedicated project field > named body line > full issue description
  let definitionOfDone = '';
  if (fields.definitionOfDone !== undefined) {
    definitionOfDone = String(fields.definitionOfDone);
  } else {
    const bodyDoD = bodyField(body, 'DefinitionOfDone', 'Definition of Done');
    definitionOfDone = bodyDoD || body.trim();
  }

  return {
    id: isNaN(id) ? undefined : id,
    chapitreId,
    titre,
    priorite,
    statut,
    definitionOfDone,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nFetching project #${PROJECT_NUMBER} from org "${ORG}"…`);

  // Paginate all project items
  const allItems = [];
  let cursor = null;
  let projectTitle = '';
  do {
    const data = await graphql(ITEMS_QUERY, { org: ORG, number: PROJECT_NUMBER, cursor });
    const project = data?.organization?.projectV2;
    if (!project) {
      throw new Error(
        `Project #${PROJECT_NUMBER} not found in organisation "${ORG}". ` +
        'Ensure GITHUB_TOKEN has the "read:project" scope and the project exists.'
      );
    }
    projectTitle = projectTitle || project.title;
    allItems.push(...(project.items.nodes || []));
    cursor = project.items.pageInfo.hasNextPage ? project.items.pageInfo.endCursor : null;
  } while (cursor);

  console.log(`Project: "${projectTitle}" — ${allItems.length} items fetched.`);

  // Load existing mesures.json to preserve meta, chapitres and unmapped data
  let meta = {
    titre: 'Plateforme de Suivi des Engagements - Le Blanc Mesnil',
    sousTitre: '213 mesures pour une ville digne, sûre et ambitieuse',
    datePublication: new Date().toISOString().split('T')[0],
    version: '1.0.0',
  };
  let chapitres = [];
  const existingById = new Map();
  const existingByTitle = new Map();

  try {
    const raw = await fs.readFile(OUTPUT_FILE, 'utf8');
    const existing = JSON.parse(raw);
    meta = { ...meta, ...existing.meta };
    chapitres = existing.chapitres || [];
    for (const m of existing.mesures || []) {
      if (m.id) existingById.set(m.id, m);
      existingByTitle.set(norm(m.titre), m);
    }
    console.log(`Loaded ${existingById.size} existing mesures from ${OUTPUT_FILE}`);
  } catch {
    console.log('No existing mesures.json found — will create a new one.');
  }

  // Build tag → chapitreId lookup from the loaded chapitres
  const tagMap = new Map(
    chapitres
      .filter(c => c.tag)
      .map(c => [norm(c.tag), c.id])
  );
  if (tagMap.size) {
    console.log(`Tag map built: ${[...tagMap.keys()].join(', ')}`);
  }

  // Merge project items onto existing mesures
  let maxId = existingById.size ? Math.max(...existingById.keys()) : 0;
  const seen = new Set();
  const mesures = [];
  const skipped = [];
  const mappingInfo = [];
  const duplicateMappings = [];

  for (const item of allItems) {
    const extracted = extractMesure(item, tagMap);
    if (!extracted) {
      skipped.push({ itemId: item.id, type: item.type, contentType: item.content?.__typename || null, title: item.content?.title || null, note: item.note || null });
      continue;
    }

    // Match by id first, then by (normalised) title
    let existing = extracted.id ? existingById.get(extracted.id) : undefined;
    if (!existing) existing = existingByTitle.get(norm(extracted.titre));

    if (existing) {
      // existing match (by id or title)
      mappingInfo.push({ itemId: item.id, title: extracted.titre, matchedId: existing.id, matchType: extracted.id ? 'id' : 'title' });
      existing.titre = extracted.titre;
      if (extracted.chapitreId) existing.chapitreId = extracted.chapitreId;
      existing.statut = extracted.statut;
      existing.priorite = extracted.priorite;
      if (extracted.definitionOfDone) existing.definitionOfDone = extracted.definitionOfDone;
      if (!seen.has(existing.id)) { seen.add(existing.id); mesures.push(existing); }
      else { duplicateMappings.push({ itemId: item.id, title: extracted.titre, matchedId: existing.id }); }
    } else {
      // new measure
      if (!extracted.id) {
        maxId++;
        extracted.id = maxId;
      } else {
        maxId = Math.max(maxId, extracted.id);
      }
      mappingInfo.push({ itemId: item.id, title: extracted.titre, matchedId: extracted.id, matchType: 'new' });
      if (!seen.has(extracted.id)) { seen.add(extracted.id); mesures.push(extracted); }
      else { duplicateMappings.push({ itemId: item.id, title: extracted.titre, matchedId: extracted.id }); }
    }
  }

  mesures.sort((a, b) => (a.id || 0) - (b.id || 0));

  const output = { meta, chapitres, mesures };
  const json = JSON.stringify(output, null, 2) + '\n';

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: first 60 lines of generated mesures.json ---');
    console.log(json.split('\n').slice(0, 60).join('\n'));
    console.log(`…\n--- ${mesures.length} mesures total ---`);
    if (skipped.length) {
      console.log('\nSkipped items (not converted to mesures):');
      for (const s of skipped) {
        console.log(' -', JSON.stringify(s));
      }
    }
    if (duplicateMappings.length) {
      console.log('\nDuplicate mappings (multiple project items mapped to same mesure id):');
      for (const d of duplicateMappings) console.log(' -', JSON.stringify(d));
    }
    if (mappingInfo.length) {
      console.log('\nMapping summary sample (first 10):');
      for (const m of mappingInfo.slice(0,10)) console.log(' -', JSON.stringify(m));
    }
  } else {
    await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    await fs.writeFile(OUTPUT_FILE, json, 'utf8');
    console.log(`\nWrote ${mesures.length} mesures → ${OUTPUT_FILE}`);
  }

  // Summary
  const counts = mesures.reduce(
    (acc, m) => { acc[m.statut] = (acc[m.statut] || 0) + 1; return acc; },
    {}
  );
  console.log('\nSummary:');
  console.log(`  Total:       ${mesures.length}`);
  console.log(`  À démarrer:  ${counts['a-demarrer'] || 0}`);
  console.log(`  En cours:    ${counts['en-cours'] || 0}`);
  console.log(`  Livré:       ${counts['livre'] || 0}`);
}

main().catch(err => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
