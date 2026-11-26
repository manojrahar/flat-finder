// Pure filter logic. A society is "match", "likely", "unknown" (not checked yet) or "no".

export const RANK = { match: 4, likely: 3, probable: 2, unknown: 1, no: 0 };

export const DEFAULT_CRITERIA = {
  kinds: ['apartment'],
  bhk: [],          // empty = any
  room: null,       // { a, b } in feet, orientation-free
  roomArea: null,   // sq ft: every bedroom at least this big (used instead of room when set)
  estimates: true,  // allow "probable" from unit-size estimates when plans are unread
  near: [],         // nearby keys, see NEAR
  q: '',            // name filter from search
  only: null,       // array of society ids (my list) or null
  locality: null,   // locality prefix filter, e.g. "Vaishali Nagar"
  pin: null,        // commute / workplace pin: { lat, lng, km, label }
  minSqft: 0,
  maxSqft: null,
  minPrice: null,   // rupees, buying
  minRent: null,    // rupees per month
  mode: 'buy',      // 'buy' or 'rent'
  maxPrice: null,   // rupees, buying
  maxRent: null,    // rupees per month, renting
  amenities: [],    // amenity keys, see AMENITY_KEYS
  ready: false,     // only ready to move
  reraOnly: false,  // only projects with a valid RERA registration number
  plansOnly: false, // only societies with checked floor plans (hand verified or OCR/AI read)
  verifiedOnly: false, // only hand-verified primary-source societies
};

// Amenity keys -> words that identify them in portal amenity names.
export const AMENITY_KEYS = {
  squash: ['squash'],
  pool: ['swimming pool', 'pool'],
  gym: ['gym'],
  club: ['club house', 'clubhouse'],
  tennis: ['tennis'],
  badminton: ['badminton'],
  jogging: ['jogging'],
  kids: ['kids play', "children's play", 'kids club'],
};

// Nearby filters: OSM place kind and the distance it must be within (metres).
export const NEAR = {
  park: { label: 'Park', kinds: ['park'], m: 500 },
  metro: { label: 'Metro or rail', kinds: ['metro', 'rail'], m: 1500 },
  school: { label: 'School', kinds: ['school'], m: 1000 },
  hospital: { label: 'Hospital', kinds: ['hospital'], m: 2000 },
  shopping: { label: 'Mall or supermarket', kinds: ['shopping'], m: 1500 },
};

export function isNear(s, key) {
  const n = NEAR[key];
  return n.kinds.some((k) => (s.nearby?.[k]?.m ?? Infinity) <= n.m);
}

export function hasAmenity(s, key) {
  if (key.startsWith('n:')) return s.amenities.some((a) => a.toLowerCase() === key.slice(2));
  const fact = s.amen_facts?.[key];
  if (fact) return fact.value === 'yes';
  const words = AMENITY_KEYS[key] || [key];
  return s.amenities.some((a) => words.some((w) => a.toLowerCase().includes(w)));
}

export function roomPasses([short, long], { a, b }) {
  const need = [Math.min(a, b), Math.max(a, b)];
  return short + 1e-6 >= need[0] && long + 1e-6 >= need[1];
}

export function unitSize(u) {
  return u.super_sqft || u.size_sqft || u.carpet_sqft || null;
}

// A unit read by Jev from its floor plan: exact narrowest side, plus confirmed "at least" / "below" steps.
function matchAiUnit(u, c) {
  const a = u.ai;
  let verdict = 'likely'; // Jev alone can overstate a room (about 1 in 10 in spot checks): never a full match
  if (c.minSqft > 0 && u.size_range) {
    if (u.size_range[1] < c.minSqft) return 'no';
    if (u.size_range[0] < c.minSqft) verdict = 'likely'; // which listed size this plan is, is not known
  }
  if (c.roomArea) {
    if (a.area_ub != null && a.area_ub <= c.roomArea) return 'no';
    return a.area_lb != null && a.area_lb >= c.roomArea ? verdict : 'unknown';
  }
  if (c.room) {
    const short = Math.min(c.room.a, c.room.b), long = Math.max(c.room.a, c.room.b);
    if (a.min_short != null && a.min_short < short - 1e-6) return 'no';
    if (a.long_ub != null && a.long_ub <= long) return 'no';
    return a.min_short != null && a.min_short >= short - 1e-6 && a.long_lb != null && a.long_lb >= long - 1e-6 ? verdict : 'unknown';
  }
  return verdict;
}

export function matchUnit(u, c) {
  if (c.maxSqft) {
    const size = unitSize(u) ?? u.size_range?.[0];
    if (size != null && size > c.maxSqft) return 'no';
  }
  if (u.ai) return matchAiUnit(u, c);
  if (c.minSqft > 0 && u.size_range && !unitSize(u)) {
    if (u.size_range[1] < c.minSqft) return 'no';
  } else if (c.minSqft > 0) {
    const size = unitSize(u);
    if (size == null) return 'unknown';
    if (size < c.minSqft) return 'no';
  }
  const area = c.roomArea;
  if (!c.room && !area) return 'match';
  if (!u.bedrooms?.length) {
    // plans unread: a cautious lower bound from unit size can say "probably fits", never "fits"
    if (c.estimates !== false && u.est_short != null) {
      const ok = area ? u.est_area >= area : u.est_short >= Math.min(c.room.a, c.room.b) && u.est_area >= c.room.a * c.room.b;
      if (ok) return 'probable';
    }
    return 'unknown';
  }
  const fails = area ? u.bedrooms.some(([a, b]) => a * b < area - 1e-6) : u.bedrooms.some((r) => !roomPasses(r, c.room));
  if (fails) return 'no';
  return u.rooms_complete ? 'match' : 'likely';
}

const norm = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function hasRera(s) {
  const id = String(s?.rera_id || '').trim();
  return Boolean(id && !/^(n\/?a|none|not\s+applicable|-+)$/i.test(id));
}

export function distKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function matchLocality(socLoc, filterLoc) {
  const a = norm(socLoc);
  const b = norm(filterLoc);
  return Boolean(a && b && (a === b || a.startsWith(`${b} `)));
}

export function matchSociety(s, c) {
  if (c.only && !c.only.includes(s.id)) return 'no';
  if (c.locality && !matchLocality(s.locality, c.locality)) return 'no';
  if (c.pin && distKm(s, c.pin) > c.pin.km) return 'no';
  if (c.reraOnly && !hasRera(s)) return 'no';
  if (c.verifiedOnly && !s.verified) return 'no';
  if (c.plansOnly && !s.verified && !s.ai_read) return 'no';
  if (c.q) {
    const hay = `${norm(s.name)} ${norm(s.developer)} ${norm(s.locality)}`;
    if (!norm(c.q).split(' ').every((w) => hay.includes(w))) return 'no';
  }
  if (c.kinds.length && !c.kinds.includes(s.kind)) return 'no';
  for (const key of c.near || []) if (!isNear(s, key)) return 'no';
  if (c.ready && !/ready/i.test(s.status || '')) return 'no';
  const budget = c.mode === 'rent' ? c.maxRent : c.maxPrice;
  const floor = c.mode === 'rent' ? c.minRent : c.minPrice;
  if (budget || floor) {
    const p = priceFor(s, c.mode, c.bhk);
    if (p && budget && p.value > budget) return 'no';
    if (p && floor && p.value < floor) return 'no';
  }
  for (const key of c.amenities) if (!hasAmenity(s, key)) return 'no';

  const unitFilters = c.bhk.length || c.minSqft > 0 || c.maxSqft || c.room || c.roomArea;
  if (!unitFilters) return 'match';
  const units = s.unit_types.filter((u) => !c.bhk.length || c.bhk.includes(u.bhk));
  if (!units.length) return s.unit_types.length ? 'no' : 'unknown';
  let best = 'no';
  for (const u of units) {
    const r = matchUnit(u, c);
    if (RANK[r] > RANK[best]) best = r;
    if (best === 'match') break;
  }
  return best;
}

export function feetLabel(ft) {
  let f = Math.floor(ft + 1e-6);
  let i = Math.round((ft - f) * 12);
  if (i === 12) { f += 1; i = 0; }
  return `${f}'${i}"`;
}

// Cheapest price for the chosen BHKs: listing median first, our estimate otherwise. null when unknown.
// Medians flagged as likely typos (p.flags) are skipped, so one mistyped listing cannot hide or promote a society.
export function priceFor(s, mode, bhk = []) {
  let best = null;
  for (const [b, p] of Object.entries(s.prices || {})) {
    if (bhk.length && !bhk.includes(+b)) continue;
    const real = p.flags?.[mode] ? null : p[mode]?.median;
    const est = p[`${mode}_est`]?.value;
    const v = real ?? est;
    if (v && (!best || v < best.value)) best = { value: v, estimated: real == null, bhk: +b, basis: real == null ? p[`${mode}_est`].basis : null, n: real == null ? null : p[mode]?.n };
  }
  if (!best && mode === 'buy' && s.price_min && !bhk.length) best = { value: s.price_min, estimated: false, bhk: null, basis: 'builder price range' };
  return best;
}

export function formatINR(r) {
  if (r == null) return '';
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1).replace(/\.0$/, '')} L`;
  return `₹${Math.round(r / 1000)}k`;
}

function medianOf(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function societyPsf(s) {
  const vals = Object.values(s.prices || {}).filter((p) => p.psf && !p.flags?.buy).map((p) => p.psf);
  return medianOf(vals) ?? s.psf_now ?? null;
}

export function smallestBedroom(s) {
  const rooms = (s.unit_types || []).flatMap((u) => u.bedrooms || []);
  if (!rooms.length) return null;
  return rooms.reduce((m, r) => (r[0] < m[0] || (r[0] === m[0] && r[1] < m[1]) ? r : m));
}

export function localityBreakdown(societies, bhk = []) {
  const groups = new Map();
  for (const s of societies) {
    const loc = (s.locality || '').trim();
    if (!loc || loc.toLowerCase() === 'other') continue;
    let g = groups.get(loc);
    if (!g) {
      g = { locality: loc, count: 0, lats: [], lngs: [], psfs: [], buys: [], rents: [], scores: [], plans: 0, rera: 0 };
      groups.set(loc, g);
    }
    g.count++;
    if (s.lat != null && s.lng != null) { g.lats.push(s.lat); g.lngs.push(s.lng); }
    const psf = societyPsf(s);
    if (psf) g.psfs.push(psf);
    const buy = priceFor(s, 'buy', bhk);
    if (buy?.value) g.buys.push(buy.value);
    const rent = priceFor(s, 'rent', bhk);
    if (rent?.value) g.rents.push(rent.value);
    if (s.score != null) g.scores.push(s.score);
    if (s.verified || s.ai_read) g.plans++;
    if (hasRera(s)) g.rera++;
  }
  return [...groups.values()].map((g) => ({
    locality: g.locality,
    societies: g.count,
    lat: medianOf(g.lats),
    lng: medianOf(g.lngs),
    medianPsf: medianOf(g.psfs) != null ? Math.round(medianOf(g.psfs)) : null,
    medianBuy: medianOf(g.buys),
    medianRent: medianOf(g.rents),
    medianScore: medianOf(g.scores) != null ? Number(medianOf(g.scores).toFixed(1)) : null,
    planChecked: g.plans,
    reraRegistered: g.rera,
  })).sort((a, b) => b.societies - a.societies);
}

export function compareRows(societies, { bhk = [], pin = null } = {}) {
  const fmtMoney = (p, suffix = '') => (p ? `${p.estimated ? '~' : ''}${formatINR(p.value)}${suffix}` : '—');
  const fmtNear = (n) => (n ? `${n.m >= 1000 ? `${(n.m / 1000).toFixed(1)} km` : `${Math.round(n.m)} m`}${n.name ? ` · ${n.name}` : ''}` : '—');
  const rows = [
    ['Locality', (s) => s.locality || '—'],
    ['Type / Status', (s) => [s.kind, s.status, s.possession].filter(Boolean).join(' · ') || '—'],
    ['Price / sq ft', (s) => { const v = societyPsf(s); return v ? `₹${Math.round(v).toLocaleString()}/sq ft` : '—'; }],
    ['Buy (from)', (s) => fmtMoney(priceFor(s, 'buy', bhk))],
    ['Rent (from)', (s) => fmtMoney(priceFor(s, 'rent', bhk), '/mo')],
    ['Smallest bedroom', (s) => { const r = smallestBedroom(s); return r ? `${feetLabel(r[0])} × ${feetLabel(r[1])}` : 'Not read yet'; }],
    ['Plan verification', (s) => (s.verified ? 'Verified by hand' : s.ai_read ? 'AI / OCR plan-read' : 'Unchecked')],
    ['RERA ID', (s) => (hasRera(s) ? s.rera_id : 'Not listed')],
    ['Flat Finder score', (s) => (s.score != null ? `${s.score}/10` : '—')],
    ['Resident rating', (s) => (s.rating ? `★ ${s.rating.toFixed(1)} (${s.rating_count || 0})` : '—')],
    ['Park', (s) => fmtNear(s.nearby?.park)],
    ['Metro / Rail', (s) => fmtNear(s.nearby?.metro || s.nearby?.rail)],
    ['Hospital', (s) => fmtNear(s.nearby?.hospital)],
    ['Amenities', (s) => `${(s.amenities || []).length} listed`],
  ];
  if (pin) rows.splice(1, 0, [`From ${pin.label || 'pin'}`, (s) => `${distKm(s, pin).toFixed(1)} km`]);
  return rows.map(([label, fn]) => ({ label, values: societies.map(fn) }));
}
