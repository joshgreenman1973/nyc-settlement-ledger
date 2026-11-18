# New York City Settlement Ledger

What New York City pays each year to resolve claims and lawsuits, and every tort settlement payment in the Comptroller's claim-level file.

**Live:** https://joshgreenman1973.github.io/nyc-settlement-ledger/

## Sources

1. **Yearly totals, fiscal 2010 to the present** (`data/annual.json`): the Comptroller's [claims dashboard](https://comptroller.nyc.gov/services/for-the-public/claims-dashboard/trends-data/), which replaced the Annual Claims Report in 2025. It splits payments into tort claims (injury and property damage) and law claims (salary, special education, contracts). The dashboard is a Power BI report with no download, so these numbers were copied by hand from the trends page (Area filter on All, then Tort, then Law). `annual.json` records the date they were read. Fiscal 2027 is partial.
2. **Claim-level tort payments, fiscal 2016 to 2023** (`data/settlements.json`): NYC Open Data data set [`ex6k-ym48`](https://data.cityofnewyork.us/d/ex6k-ym48), filtered to `claim_action = 'SETTLED' AND disposition_amount > 0`. Tort claims only. Last updated by the city on Jan. 13, 2025.

The two sources disagree for the same years: the dashboard's tort totals for fiscal 2016 to 2023 are about $533 million higher than the Open Data file's. The Open Data totals match the fiscal 2023 Annual Claims Report ($739.6 million). The page shows the year-by-year gap in its notes.

## Cleaning

`fetch.mjs` folds the file's many spellings of each agency into one name ("Dept OF Transportation," "DOT - Bureau OF Traffic" and "Department of Transportation" are one agency; Health + Hospitals had three names). Claim types get the same treatment, and boroughs are reduced to the five plus "Outside the city." Original strings are kept as `agency_raw` and `type_raw`.

Some claim numbers have more than one payment in different years, so rows are payments, not claims (63,918 payments on 63,545 claim numbers).

## Updating

- `node fetch.mjs` pulls the Open Data file and rewrites `data/settlements.json`, `data/summary.json` and `data/meta.json`. A GitHub Actions job (`.github/workflows/refresh.yml`) runs it on the 1st of each month.
- `data/annual.json` is updated by hand from the dashboard. Add or replace the year rows and change `read_on`. Tort plus law should equal the total, within $1.

## Files

- `index.html`: the page. `house.css`: shared house style (copy of `experiments/house-style/house.css`).
- `data/annual.json`: dashboard totals by fiscal year.
- `data/settlements.json`: every payment (about 17 MB).
- `data/summary.json`: precomputed totals by agency, type, borough and year, plus the 100 largest payments.
- `data/meta.json`: when the fetch last ran.
