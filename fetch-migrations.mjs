// LIVE MIGRATIONS - the weekly job (owner, 2026-11-25: "tend to the rest";
// idea 3 of the 2026-11-23 review: "Sandhill cranes are moving through the
// Mojave this week"). Run once a day by migrations.yml, beside the weather job,
// and published as migrations.json for the game to download
// (js/engine/liveMigrations.js).
//
// For each region it asks iNaturalist how often each of the region's walkable
// animals (roster.json, made by `npm run migration:roster` in the game) was
// reported inside the region's trail areas in the last 14 days, and over the
// last year. An animal is picked when its share of all reports there in the
// last 14 days is far above its share over the year - so a busy weekend of
// observers lifts every animal alike and picks none. Up to two a region.
//
// Only research-grade observations count: a record other naturalists have
// agreed on. Counts only; no photo, place or person leaves iNaturalist.
// Sightings from iNaturalist (inaturalist.org).
import fs from 'node:fs';

// The trail areas: small boxes around the region's real trails, so a region
// is never answered from a city next door. A region may need several.
// [south, west, north, east]
const AREAS = {
  san_bernardino: [[33.95, -117.20, 34.35, -116.60]],
  coastal: [
    [32.85, -117.35, 33.30, -117.15],   // Torrey Pines, Guajome
    [33.53, -117.88, 33.62, -117.78],   // Crystal Cove
    [34.00, -118.85, 34.10, -118.70],   // Escondido Falls
    [35.20, -120.95, 35.35, -120.80],   // Montana de Oro
    [36.00, -122.00, 36.60, -121.50],   // Point Lobos, Big Sur
    [36.95, -122.20, 37.15, -122.00]    // Fall Creek
  ],
  mojave_desert: [
    [33.70, -116.45, 34.15, -115.65],   // Joshua Tree
    [34.50, -115.90, 35.15, -115.30]    // Mojave National Preserve, Amboy
  ],
  sierra_nevada: [
    [37.60, -119.75, 37.95, -119.25],   // Yosemite
    [37.25, -119.10, 37.70, -118.60],   // Mammoth Lakes, Convict Lake, Pine Creek
    [36.55, -118.80, 36.65, -118.65]    // Sequoia
  ],
  blue_mountains: [[-33.80, 150.25, -33.55, 150.65]],
  atlantic_forest: [
    [-23.10, -43.60, -22.90, -43.15],   // Tijuca and Rio's hills
    [-22.55, -43.10, -22.40, -42.95]    // Serra dos Orgaos
  ],
  banff: [
    [50.95, -116.60, 51.75, -115.40],   // Banff, Lake Louise, the Bow valley
    [52.10, -117.25, 52.25, -117.00]    // Parker Ridge
  ],
  rocky_mountain: [[40.15, -105.85, 40.45, -105.50]],
  sky_islands: [
    [32.30, -110.85, 32.50, -110.55],   // the Santa Catalinas
    [31.75, -109.45, 32.10, -109.15]    // the Chiricahuas
  ]
};

const API = 'https://api.inaturalist.org/v1';
const UA = 'ThruHikeGame/1.0 github.com/rajaearee/thruhike-weather';
const WINDOW_DAYS = 14;
const MIN_REPORTS = 4;    // fewer than this in 14 days is too few to call a surge
const MIN_TIMES = 2.5;    // the 14-day share must be at least this many times the year's
const PER_REGION = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function get(url) {
  for (let tries = 0; tries < 3; tries++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) { await sleep(1100); return res.json(); }
    await sleep(5000 * (tries + 1));
  }
  throw new Error('HTTP failure: ' + url);
}

// ---- iNaturalist taxon ids for the roster, kept in taxa.json between runs
const roster = JSON.parse(fs.readFileSync('roster.json', 'utf8'));
let taxa = {};
try { taxa = JSON.parse(fs.readFileSync('taxa.json', 'utf8')); } catch (e) { taxa = {}; }
const names = [...new Set(Object.values(roster).flat().map(s => s.sci))];
const missing = names.filter(n => !(n in taxa));
const LOOKUPS = Number(process.env.TAXON_LOOKUPS || 60);   // the rest wait for tomorrow's run
for (const n of missing.slice(0, LOOKUPS)) {
  try {
    const j = await get(`${API}/taxa?q=${encodeURIComponent(n)}&rank=species,subspecies&per_page=10`);
    const hit = (j.results || []).find(t => t.name === n) || (j.results || []).find(t => t.matched_term === n);
    // A name iNaturalist files under another (a newer split, a synonym) still
    // matches through matched_term; one it does not know at all is kept as
    // null so it is not asked again every day.
    taxa[n] = hit ? hit.id : null;
  } catch (e) { /* asked again next run */ }
}
fs.writeFileSync('taxa.json', JSON.stringify(taxa, null, 1) + '\n');

// ---- one region
const boxQ = ([s, w, n, e]) => `swlat=${s}&swlng=${w}&nelat=${n}&nelng=${e}`;
const BASE = 'quality_grade=research&iconic_taxa=Aves,Mammalia,Reptilia,Amphibia,Insecta,Arachnida,Mollusca,Actinopterygii';

async function region(id) {
  const list = (roster[id] || []).filter(s => taxa[s.sci]);
  if (!list.length) return [];
  const ids = [...new Set(list.map(s => taxa[s.sci]))];
  const wk = new Map(), yr = new Map();
  let totWk = 0, totYr = 0;
  for (const box of AREAS[id]) {
    totWk += (await get(`${API}/observations?${boxQ(box)}&${BASE}&d1=${day(WINDOW_DAYS)}&per_page=0`)).total_results || 0;
    totYr += (await get(`${API}/observations?${boxQ(box)}&${BASE}&d1=${day(365)}&per_page=0`)).total_results || 0;
    // The taxon list in pieces, so no address grows too long.
    for (let i = 0; i < ids.length; i += 80) {
      const part = ids.slice(i, i + 80).join(',');
      for (const [d, into] of [[WINDOW_DAYS, wk], [365, yr]]) {
        const j = await get(`${API}/observations/species_counts?${boxQ(box)}&quality_grade=research&taxon_id=${part}&d1=${day(d)}&per_page=500`);
        for (const r of j.results || []) into.set(r.taxon.id, (into.get(r.taxon.id) || 0) + r.count);
      }
    }
  }
  if (!totWk || !totYr) return [];
  const picks = [];
  for (const s of list) {
    const t = taxa[s.sci];
    const w = wk.get(t) || 0, y = yr.get(t) || 0;
    if (w < MIN_REPORTS || !y) continue;
    const times = (w / totWk) / (y / totYr);
    if (times >= MIN_TIMES) picks.push({ species: s.id, reports: w, times: Math.round(times * 10) / 10 });
  }
  // One animal can sit in a region twice (a morph, a second entry): keep its best.
  const seen = new Set();
  return picks.sort((a, b) => b.times - a.times)
    .filter(p => !seen.has(p.species) && seen.add(p.species))
    .slice(0, PER_REGION);
}

let previous = {};
try { previous = JSON.parse(fs.readFileSync('migrations.json', 'utf8')); } catch (e) { previous = {}; }
const regions = {};
const failed = [];
for (const id of Object.keys(AREAS)) {
  try { regions[id] = await region(id); } catch (e) {
    failed.push(id + ': ' + (e.message || e));
    // Keep yesterday's picks for a region that could not be asked today.
    if (previous.regions && previous.regions[id]) regions[id] = previous.regions[id];
  }
}
if (failed.length > 4) { console.error('Too many regions failed:', failed.join('; ')); process.exit(1); }
const file = {
  version: 1, updated: new Date().toISOString(), windowDays: WINDOW_DAYS,
  credit: 'Sightings from iNaturalist', source: 'https://www.inaturalist.org/', regions
};
fs.writeFileSync('migrations.json', JSON.stringify(file, null, 1) + '\n');
console.log('wrote migrations.json:', Object.entries(regions).map(([k, v]) => k + ' ' + v.map(p => p.species + ' x' + p.times).join('/')).join(', '),
  failed.length ? '| failed: ' + failed.join('; ') : '', '| taxa still to look up:', names.filter(n => !(n in taxa)).length);
