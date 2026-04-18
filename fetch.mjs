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

// Canonicalize agency names — Comptroller uses mixed case + abbreviations.
// These buckets roll duplicates into a single name for rollups.
const AGENCY_CANON = [
  [/^police department$/i, 'NYPD — New York City Police Department'],
  [/^department of correction$/i, 'DOC — Department of Correction'],
  [/^department of transportation$/i, 'DOT — Department of Transportation'],
  [/^department of sanitation$/i, 'DSNY — Department of Sanitation'],
  [/^department of education$/i, 'DOE — Department of Education'],
  [/^(nyc )?health \+? ?hospitals$/i, 'H+H — NYC Health + Hospitals'],
  [/^fire department$/i, 'FDNY — Fire Department'],
  [/^department of parks( ?& ?recra?eation)?$/i, 'Parks — Department of Parks & Recreation'],
  [/^department of homeless services$/i, 'DHS — Department of Homeless Services'],
  [/^housing authority$/i, 'NYCHA — New York City Housing Authority'],
  [/^department of environmental protection$/i, 'DEP — Department of Environmental Protection'],
  [/^department of buildings$/i, 'DOB — Department of Buildings'],
  [/^administration for children.?s services$/i, 'ACS — Administration for Children\'s Services'],
  [/^human resources administration$/i, 'HRA — Human Resources Administration'],
  [/^housing preservation.*development$/i, 'HPD — Housing Preservation & Development'],
];
function canonAgency(raw) {
  const s = (raw || 'Unknown').trim();
  for (const [re, canon] of AGENCY_CANON) if (re.test(s)) return canon;
  // Title-case fallback for unfamiliar agencies
  return s.split(/\s+/).map(w => w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Roll fine-grained claim types into broader categories for charts/filters.
const TYPE_CANON = [
  [/police action|peace officer/i, 'Police action'],
  [/correction.*facility|correction facility/i, 'Correction (jail/prison)'],
  [/motor vehicle|automobile accident/i, 'Motor vehicle'],
  [/sidewalk/i, 'Sidewalk'],
  [/roadway|pothole/i, 'Roadway / pothole'],
  [/civil rights/i, 'Civil rights'],
  [/medical malpractice|med.?mal/i, 'Medical malpractice'],
  [/property damage/i, 'Property damage'],
  [/false arrest|false imprisonment|wrongful/i, 'False arrest / wrongful imprisonment'],
  [/trip|slip|fall/i, 'Trip / slip / fall'],
  [/employment|discrimination|labor/i, 'Employment / labor'],
  [/water main|flood/i, 'Water / flooding'],
  [/tree/i, 'Tree damage'],
];
function canonType(raw) {
  const s = (raw || 'Other').trim();
  for (const [re, canon] of TYPE_CANON) if (re.test(s)) return canon;
  return s.replace(/\(PI\)\s*$/i, '').trim().replace(/^./, c => c.toUpperCase()).replace(/[A-Z]{3,}/g, w => w[0] + w.slice(1).toLowerCase());
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
    borough: (r.borough || '').trim() || null,
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
  const sortObj = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].total - a[1].total));
  return {
    totals: { rows: rows.length, amount: totalAmount, max_amount: maxAmount },
    fiscal_years: fys,
    agencies: sortObj(agencies),
    types: sortObj(types),
    boroughs: sortObj(boroughs),
    by_fy_agency: byFyAgency,
    top_100: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 100),
  };
}

async function main() {
  console.log('Fetching settled claims from NYC Open Data…');
  const raw = await fetchAll();
  console.log(`Normalizing ${raw.length.toLocaleString()} records…`);
  const rows = raw.map(extract);

  writeFileSync(join(DATA, 'settlements.json'), JSON.stringify(rows));
  writeFileSync(join(DATA, 'summary.json'), JSON.stringify(summarize(rows), null, 2));
  writeFileSync(join(DATA, 'meta.json'), JSON.stringify({
    source_dataset: DATASET,
    source_url: `https://data.cityofnewyork.us/resource/${DATASET}`,
    fetched_at: new Date().toISOString(),
    row_count: rows.length,
    fiscal_year_range: [
      Math.min(...rows.map(r => r.fy).filter(Boolean)),
      Math.max(...rows.map(r => r.fy).filter(Boolean)),
    ],
    total_settled_usd: rows.reduce((s, r) => s + r.amount, 0),
  }, null, 2));

  console.log(`done — wrote ${rows.length.toLocaleString()} settlements.`);
  console.log(`Total disposition amount: $${rows.reduce((s, r) => s + r.amount, 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
}

main().catch(err => { console.error(err); process.exit(1); });
