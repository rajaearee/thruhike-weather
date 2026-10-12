// Fetches a nine-day forecast for each Thru-Hike region from MET Norway and
// writes forecast.json. Run once a day by .github/workflows/forecast.yml.
// Weather data from MET Norway (api.met.no), licensed CC BY 4.0 / NLOD 2.0.
import fs from 'node:fs';

// One point per region: the same weather station the game's monthly averages
// come from, at that station's height, so the game's own adjustment for how
// high the hiker stands still starts from the right place.
const REGIONS = {
  san_bernardino:  { name: 'Big Bear Lake',    lat: 34.2439,  lon: -116.9114, alt: 2057, tz: 'America/Los_Angeles' },
  sierra_nevada:   { name: 'Yosemite Valley',  lat: 37.7456,  lon: -119.5936, alt: 1210, tz: 'America/Los_Angeles' },
  coastal:         { name: 'San Diego Coast',  lat: 32.8500,  lon: -117.2700, alt: 9,    tz: 'America/Los_Angeles' },
  mojave_desert:   { name: 'Twentynine Palms', lat: 34.1356,  lon: -116.0542, alt: 602,  tz: 'America/Los_Angeles' },
  blue_mountains:  { name: 'Katoomba',         lat: -33.7120, lon: 150.3119,  alt: 1017, tz: 'Australia/Sydney' },
  atlantic_forest: { name: 'Teresopolis',      lat: -22.4122, lon: -42.9664,  alt: 936,  tz: 'America/Sao_Paulo' },
  banff:           { name: 'Banff Townsite',   lat: 51.1784,  lon: -115.5708, alt: 1397, tz: 'America/Edmonton' },
  rocky_mountain:  { name: 'Estes Park',       lat: 40.3772,  lon: -105.5217, alt: 2293, tz: 'America/Denver' }
};
const UA = 'ThruHikeGame/1.0 github.com/rajaearee/thruhike-weather';
const toF = c => Math.round(c * 9 / 5 + 32);
const localDate = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// How likely a wet day is, from how much rain or snow the forecast expects.
// The game rolls against this, so a trace is nearly dry and a soaking is nearly certain.
const chanceFrom = mm => mm < 0.2 ? 0.03 : mm < 1 ? 0.25 : mm < 3 ? 0.5 : mm < 8 ? 0.75 : 0.9;

async function region(id, r) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${r.lat}&lon=${r.lon}&altitude=${r.alt}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  const series = (await res.json()).properties.timeseries;
  const days = new Map();
  for (const p of series) {
    const d = localDate(p.time, r.tz);
    const o = days.get(d) || { hi: -Infinity, lo: Infinity, mm: 0, n: 0 };
    const t = p.data.instant.details.air_temperature;
    if (typeof t === 'number') { o.hi = Math.max(o.hi, t); o.lo = Math.min(o.lo, t); o.n++; }
    // Hourly steps carry the next hour's fall; the later six-hourly steps carry the next six.
    const fall = p.data.next_1_hours || p.data.next_6_hours;
    const mm = fall && fall.details && fall.details.precipitation_amount;
    if (typeof mm === 'number') o.mm += mm;
    days.set(d, o);
  }
  // A day needs enough readings to have a real high and low; the first and last days are often partial.
  const out = [...days.entries()].filter(([, o]) => o.n >= 3).slice(0, 9).map(([date, o]) => ({
    date, highF: toF(o.hi), lowF: toF(o.lo), rainMm: Math.round(o.mm * 10) / 10, rainChance: chanceFrom(o.mm), readings: o.n
  }));
  // The day the job runs on is only part of a day by the time it is fetched -
  // an evening's readings give no true high. Yesterday's file saw that day
  // whole, so for any date keep whichever copy was built from more readings.
  const before = (previous.regions && previous.regions[id] && previous.regions[id].days) || [];
  const today = localDate(new Date().toISOString(), r.tz);
  const byDate = new Map(out.map(d => [d.date, d]));
  for (const old of before) {
    if (old.date < today) continue;
    const now = byDate.get(old.date);
    if (!now || (old.readings || 0) > (now.readings || 0)) byDate.set(old.date, old);
  }
  out.length = 0;
  out.push(...[...byDate.values()].sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 10));
  if (out.length < 3) throw new Error(`${id}: only ${out.length} days`);
  return { station: r.name, stationElevationFt: Math.round(r.alt * 3.28084), days: out };
}

let previous = {};
try { previous = JSON.parse(fs.readFileSync('forecast.json', 'utf8')); } catch (e) { previous = {}; }
const regions = {};
const failed = [];
for (const [id, r] of Object.entries(REGIONS)) {
  try { regions[id] = await region(id, r); } catch (e) { failed.push(String(e.message || e)); }
  await sleep(600);
}
// Keep yesterday's file rather than publish a broken one.
if (Object.keys(regions).length < 6) { console.error('Too many regions failed:', failed.join('; ')); process.exit(1); }
const file = { version: 1, updated: new Date().toISOString(), credit: 'Weather data from MET Norway', source: 'https://api.met.no/', regions };
fs.writeFileSync('forecast.json', JSON.stringify(file, null, 1) + '\n');
console.log('wrote forecast.json:', Object.entries(regions).map(([k, v]) => k + ' ' + v.days.length + 'd').join(', '), failed.length ? '| failed: ' + failed.join('; ') : '');
