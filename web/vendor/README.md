# Vendored libraries

Copied unmodified from the npm packages so the dashboard works offline and makes no network requests.

| File | Package | Version | License |
|---|---|---|---|
| chart.umd.min.js | chart.js | 4.6.1 | MIT (LICENSE-chartjs.md) |
| read-excel-file.min.js | read-excel-file | 9.3.17 | MIT (LICENSE-read-excel-file) |

To update: `npm pack <package>@<version>`, extract, copy the file listed above, and update this table.
Note: read-excel-file reads `.xlsx` only (not the older binary `.xls`).
