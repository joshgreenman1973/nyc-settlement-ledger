#!/usr/bin/env node
// Pulls all settled claims (claim_action=SETTLED, disposition_amount>0) from
// NYC Open Data and writes a compact JSON file for the static site.
// Source: Comptroller's Claims Report (dataset ex6k-ym48).
//
// Usage: node fetch.mjs
//   Writes:
//     data/settlements.json  — full array of settled claims, normalized
//     data/summary.json      — pre-computed aggregates for fast initial render
//     data/meta.json         — run metadata (fetched_at, row count, coverage)

import { writeFileSync } from 'fs';
import { join } from 'path';

const DIR = import.meta.dirname;
const DATA = join(DIR, 'data');
const DATASET = 'ex6k-ym48';
const SOURCE = 'https://data.cityofnewyork.us/resource/' + DATASET + '.json';
const PAGE = 50000;

// Canonicalize agency names. The Comptroller's file spells the same agency
// many ways ("Department of Transportation", "Dept OF Transportation",
// "DOT - Bureau OF Traffic"; "Health & Hospital S Corporation", "Health AND
// Hospitals Corp.(hhc)"). Normalize first, then match on keywords. Order
// matters: the first match wins.
const AGENCY_CANON = [
  [/\bboard of correction/, 'Board of Correction'],
  [/\bpolice\b/, 'Police Department'],
  [/\bcorrection/, 'Department of Correction'],
  [/transportation|^dot\b|^dot /, 'Department of Transportation'],
  [/sanitation/, 'Department of Sanitation'],
  [/\beducation\b/, 'Department of Education'],
  [/hospital|\bhhc\b/, 'Health + Hospitals'],
  [/\bfire\b/, 'Fire Department'],
  [/\bparks\b/, 'Parks Department'],
  [/environmental protection/, 'Department of Environmental Protection'],
  [/homeless/, 'Department of Homeless Services'],
  [/housing authority/, 'Housing Authority (NYCHA)'],
  [/housing.*preservation/, 'Housing Preservation and Development'],
  [/\bbuildings\b/, 'Department of Buildings'],
  [/children/, "Administration for Children's Services"],
  [/human resources|social services/, 'Human Resources Administration'],
  [/design and construction/, 'Department of Design and Construction'],
  [/citywide admin/, 'Citywide Administrative Services'],
  [/taxi/, 'Taxi and Limousine Commission'],
  [/juvenile justice/, 'Department of Juvenile Justice'],
  [/info.*technology/, 'Information Technology and Telecommunications'],
  [/\bfinance\b/, 'Department of Finance'],
  [/probation/, 'Department of Probation'],
  [/investigation/, 'Department of Investigation'],
  [/chief med/, 'Office of Chief Medical Examiner'],
  [/mental health|mental hygiene|department of health/, 'Department of Health and Mental Hygiene'],
  [/emergency management/, 'Emergency Management'],
  [/dist(rict)?\.? ?att(orne)?y/, 'District attorneys'],
  [/library/, 'Public libraries'],
  [/^(other|misc\.?|unknown|null)$/, 'Other or not listed'],
];
function normAgency(s) {
  return s.toLowerCase()
    .replace(/\bdept\b\.?/g, 'department')
    .replace(/&/g, ' and ')
    .replace(/\brecration\b/g, 'recreation')
    .replace(/\s+/g, ' ').trim();
}
function canonAgency(raw) {
  const s = (raw || 'Unknown').trim();
  const n = normAgency(s);
  for (const [re, canon] of AGENCY_CANON) if (re.test(n)) return canon;
  return n.replace(/\b[a-z]/g, (c, i) => i === 0 ? c.toUpperCase() : c);
}

// Roll fine-grained claim types into broader categories. The raw file has
// three spellings of most types (an all-caps "(PI)" form, an all-caps plain
// form and a mixed-case form from later years).
const TYPE_CANON = [
  [/police action|peace officer/i, 'Police action'],
  [/correction facility/i, 'Jail (correction facility)'],
  [/motor vehicle|automobile/i, 'Motor vehicle crash'],
  [/sidewalk/i, 'Sidewalk'],
  [/roadway|pothole/i, 'Roadway'],
  [/civil rights/i, 'Civil rights'],
  [/medical malpractice|med.?mal/i, 'Medical malpractice'],
  [/uniformed serv/i, 'Uniformed service employee'],
  [/traf.*light|traffic control/i, 'Traffic signal or sign'],
  [/water ?main/i, 'Water main'],
  [/sewer/i, 'Sewer overflow'],
  [/buildings? and property/i, 'Buildings and property'],
  [/non covered agency/i, 'Non-covered agency'],
  [/damage by city personnel/i, 'Damage by city personnel'],
  [/parks/i, 'Parks and recreation'],
  [/^recreation/i, 'Recreation'],
  [/health facility/i, 'Health facility'],
  [/^school/i, 'School'],
];
function canonType(raw) {
  const s = (raw || 'Other').trim();
  for (const [re, canon] of TYPE_CANON) if (re.test(s)) return canon;
  const t = s.replace(/\s*\(PI\)\s*$/i, '').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const BORO = { 'BROOKLYN (KINGS)': 'Brooklyn', 'BRONX': 'Bronx', 'MANHATTAN (NEW YORK)': 'Manhattan',
  'QUEENS': 'Queens', 'STATEN ISLAND (RICHMOND)': 'Staten Island' };
function canonBorough(raw) {
  const s = (raw || '').trim().toUpperCase();
  if (!s || s === 'NULL' || s === 'UNKNOWN') return null;
  return BORO[s] || 'Outside the city';
}

async function fetchPage(offset) {
  const url = `${SOURCE}?$where=claim_action='SETTLED' AND disposition_amount > 0&$limit=${PAGE}&$offset=${offset}&$order=disposition_date DESC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Socrata: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAll() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchPage(offset);
    all.push(...page);
    console.log(`  fetched ${all.length.toLocaleString()} records…`);
    if (page.length < PAGE) break;
  }
  return all;
}

function extract(r) {
  const amount = parseFloat(r.disposition_amount) || 0;
  const rawAgency = r.agency || 'Unknown';
  const rawType = r.claim_type || 'Other';
  return {
    id: r.claim,
    fy: parseInt(r.fiscal_year_fy_, 10) || null,
    borough: canonBorough(r.borough),
    occurred: (r.occurrence_date || '').slice(0, 10) || null,
    filed: (r.filed_date || '').slice(0, 10) || null,
    disposed: (r.disposition_date || '').slice(0, 10) || null,
    amount,
    agency: canonAgency(rawAgency),
    agency_raw: rawAgency,
    type: canonType(rawType),
    type_raw: rawType,
  };
}

// Socrata returns rows in no guaranteed order, so anything keyed by insertion
// order churns between runs. Sorting keys keeps diffs limited to real changes.
const sortKeys = o => Object.fromEntries(Object.entries(o).sort((a, b) => a[0] < b[0] ? -1 : 1));

function summarize(rows) {
  const fys = [...new Set(rows.map(r => r.fy).filter(Boolean))].sort();
  const agencies = {};
  const types = {};
  const boroughs = {};
  const byFyAgency = {}; // fy -> agency -> {count, total}
  let totalAmount = 0;
  let maxAmount = 0;
  for (const r of rows) {
    totalAmount += r.amount;
    if (r.amount > maxAmount) maxAmount = r.amount;
    (agencies[r.agency] ||= { count: 0, total: 0 }).count++;
    agencies[r.agency].total += r.amount;
    (types[r.type] ||= { count: 0, total: 0 }).count++;
    types[r.type].total += r.amount;
    if (r.borough) {
      (boroughs[r.borough] ||= { count: 0, total: 0 }).count++;
      boroughs[r.borough].total += r.amount;
    }
    if (r.fy) {
      ((byFyAgency[r.fy] ||= {})[r.agency] ||= { count: 0, total: 0 }).count++;
      byFyAgency[r.fy][r.agency].total += r.amount;
    }
  }
  // Name breaks ties so equal-total entries don't swap places between runs.
  const sortObj = o => Object.fromEntries(
    Object.entries(o).sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))
  );
  return {
    totals: { rows: rows.length, claims: new Set(rows.map(r => r.id)).size, amount: totalAmount, max_amount: maxAmount },
    fiscal_years: fys,
    agencies: sortObj(agencies),
    types: sortObj(types),
    boroughs: sortObj(boroughs),
    by_fy_agency: sortKeys(Object.fromEntries(
      Object.entries(byFyAgency).map(([fy, a]) => [fy, sortObj(a)])
    )),
    top_100: [...rows]
      .sort((a, b) => b.amount - a.amount || (String(a.id) < String(b.id) ? -1 : 1))
      .slice(0, 100),
  };
}

async function main() {
  console.log('Fetching settled claims from NYC Open Data…');
  const raw = await fetchAll();
  console.log(`Normalizing ${raw.length.toLocaleString()} records…`);
  const rows = raw.map(extract);

  writeFileSync(join(DATA, 'settlements.json'), JSON.stringify(rows));
  const summary = summarize(rows);
  writeFileSync(join(DATA, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(DATA, 'meta.json'), JSON.stringify({
    sources: [
      { id: DATASET, url: `https://data.cityofnewyork.us/d/${DATASET}`, description: 'Comptroller — actual settled claims' },
    ],
    fetched_at: new Date().toISOString(),
    row_count: rows.length,
    actual_fy_range: [
      Math.min(...rows.map(r => r.fy).filter(Boolean)),
      Math.max(...rows.map(r => r.fy).filter(Boolean)),
    ],
    total_settled_usd: rows.reduce((s, r) => s + r.amount, 0),
  }, null, 2));

  console.log(`done — wrote ${rows.length.toLocaleString()} settlements.`);
  console.log(`Total disposition amount: $${rows.reduce((s, r) => s + r.amount, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
}

main().catch(err => { console.error(err); process.exit(1); });
