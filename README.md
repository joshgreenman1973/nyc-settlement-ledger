# NYC Settlement Ledger

A browsable public archive of every settled claim against the City of New York — every police-misconduct payout, Rikers death case, sidewalk injury, wrongful conviction, and school settlement, with amounts, agencies, and dates.

**Live:** https://joshgreenman1973.github.io/nyc-settlement-ledger/

## What this is

The NYC Comptroller's office publishes an annual Claims Report. Those reports feed [NYC Open Data dataset `ex6k-ym48`](https://data.cityofnewyork.us/City-Government/Claims-Report-Underlying-Settlements-and-Claims-Fi/ex6k-ym48) ("Claims Report — Underlying Settlements and Claims Filed Data"). This project filters that dataset to **only settled claims with a payout amount greater than zero**, normalizes the agency and claim-type strings, and presents the result as a browsable ledger.

Total payouts in the current dataset: about **$5.0 billion** across fiscal years 2016 through 2023.

## Data currency

The dataset covers fiscal years 2016 through 2023 (through June 30, 2023). That's as current as the Comptroller has released. When the FY2024 Annual Claims Report is published and NYC Open Data ingests it, a re-run of `fetch.mjs` will pick it up automatically.

To check for newer data, re-run `fetch.mjs`. If new fiscal-year data has been published, it will appear automatically.

## Methodology

- **Source:** NYC Open Data dataset `ex6k-ym48`, published by the Office of the NYC Comptroller.
- **Filter:** `claim_action = 'SETTLED' AND disposition_amount > 0`. Dismissed, pending, or zero-payout claims are excluded.
- **Normalization:** The raw data uses inconsistent capitalization and abbreviation for agency names ("Police Department" and "POLICE DEPARTMENT" appear as separate values). `fetch.mjs` collapses these into canonical names. The same is done for claim types. Original values are preserved in `agency_raw` and `type_raw` fields.
- **"Settled" is not liability:** A settlement is the city paying to resolve a claim. It is not an admission of liability by any party.

## Running locally

```bash
node fetch.mjs           # pulls all settled claims, writes data/*.json
python3 -m http.server   # or any static server — then open localhost:8000
```

## Files

- `fetch.mjs` — pulls from Socrata, normalizes, writes three JSON files.
- `data/settlements.json` — full array of settled claims (~17 MB).
- `data/summary.json` — pre-computed aggregates (totals, top 100, by-agency, by-year). Loaded first for instant render.
- `data/meta.json` — run metadata (fetched_at, row count, coverage).
- `index.html` — static single-page interface.

## Refresh cadence

No automatic cron. Run `node fetch.mjs` manually when the Comptroller publishes a new Annual Claims Report (typically late fall / early winter), or set up a GitHub Action on a monthly schedule.
