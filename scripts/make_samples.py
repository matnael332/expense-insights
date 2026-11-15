"""Generate synthetic credit-card statements for the dashboard demo.

Everything here is invented. The layouts imitate common Israeli card-company
exports (Hebrew headers, preamble rows, a totals row) but are NOT copies of real
statements and have not been verified against real files.

Writes: web/samples/*.xlsx, web/samples/*.csv and web/js/demo-data.js
Run:    python scripts/make_samples.py   (needs: pip install openpyxl)
"""

import csv
import json
import random
from datetime import date
from pathlib import Path

from openpyxl import Workbook

ROOT = Path(__file__).resolve().parent.parent
random.seed(11)
MONTHS = (7, 8, 9)
YEAR = 2026


def fmt(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def money(low: float, high: float) -> float:
    return round(random.uniform(low, high), 2)


def isracard_rows():
    rows = []  # (date, merchant, transaction_amount, transaction_currency, charge_amount, note)
    for m in MONTHS:
        for d in (3, 10, 17, 24):
            rows.append((date(YEAR, m, d), "שופרסל דיל סניף 214", None, "₪", money(190, 420), ""))
        for d in (6, 20):
            rows.append((date(YEAR, m, d), "פז תחנת דלק 1187", None, "₪", money(240, 340), ""))
        for d in (5, 13, 22, 28):
            rows.append((date(YEAR, m, d), random.choice(["קפה גרג תל אביב", "ארומה אספרסו בר", "פיצה האט"]), None, "₪", money(32, 98), ""))
        rows.append((date(YEAR, m, 9), "סופר פארם 56", None, "₪", money(45, 130), ""))
        rows.append((date(YEAR, m, 12), "KSP מחשבים", None, "₪", 400.00, f"תשלום {m - 6} מתוך 3"))
    rows.append((date(YEAR, 8, 19), "AMAZON COM", 49.99, "USD", 183.20, ""))
    rows.append((date(YEAR, 9, 14), "איקאה נתניה", None, "₪", 2890.00, ""))
    rows.append((date(YEAR, 9, 16), "זארה ישראל", None, "₪", money(180, 260), ""))
    rows.append((date(YEAR, 8, 7), "קסטרו", None, "₪", money(140, 230), ""))
    rows.append((date(YEAR, 7, 25), "פוקס", None, "₪", money(90, 160), ""))
    rows.append((date(YEAR, 8, 30), "זיכוי קסטרו", None, "₪", -139.00, ""))
    return sorted(rows, key=lambda r: r[0])


def max_rows():
    rows = []  # (date, merchant, category_label, last4, charge_amount, note)
    for m in MONTHS:
        rows.append((date(YEAR, m, 2), "חברת החשמל", "חשמל ומים", "5678", money(190, 270), ""))
        rows.append((date(YEAR, m, 4), "בזק אינטרנט", "תקשורת", "5678", 89.90, ""))
        rows.append((date(YEAR, m, 8), "NETFLIX.COM", "בילוי", "5678", 54.90, ""))
        rows.append((date(YEAR, m, 8), "Spotify", "בילוי", "5678", 24.90, ""))
        for d in (7, 14, 21, 27):
            rows.append((date(YEAR, m, d), "רמי לוי שיווק השקמה", "מזון", "5678", money(150, 380), ""))
        rows.append((date(YEAR, m, 11), "רכבת ישראל", "תחבורה", "5678", money(30, 70), ""))
        rows.append((date(YEAR, m, 18), "מכבי שירותי בריאות", "בריאות", "5678", money(60, 120), ""))
    rows.append((date(YEAR, 9, 27), "מסעדת הים הגדול", "מסעדות", "5678", 760.00, ""))
    return sorted(rows, key=lambda r: r[0])


def generic_rows():
    rows = []  # (date, description, amount) expenses negative
    for m in MONTHS:
        rows.append((date(YEAR, m, 1), "Salary ACME Ltd", 9500.00))
        for d in (9, 23):
            rows.append((date(YEAR, m, d), "Wolt delivery", -money(60, 140)))
        rows.append((date(YEAR, m, 15), "Gett taxi", -money(35, 75)))
    return sorted(rows, key=lambda r: r[0])


def write_isracard(path: Path, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(["פירוט עסקאות לכרטיס אשראי (נתוני דמו)"])
    ws.append(["כרטיס המסתיים ב-1234"])
    ws.append([])
    ws.append(["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "הערות"])
    for d, merchant, tx_amount, tx_cur, charge, note in rows:
        ws.append([d, merchant, tx_amount if tx_amount is not None else charge, tx_cur, charge, "₪", note])
    ws.append(['סה"כ', None, None, None, round(sum(r[4] for r in rows), 2), None, None])
    wb.save(path)


def write_max(path: Path, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(["תאריך עסקה", "שם בית העסק", "קטגוריה", "4 ספרות אחרונות", "סכום חיוב", "הערות"])
    for d, merchant, category, last4, charge, note in rows:
        ws.append([d, merchant, category, last4, charge, note])
    wb.save(path)


def write_generic(path: Path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["date", "description", "amount"])
        for d, description, amount in rows:
            writer.writerow([fmt(d), description, f"{amount:.2f}"])


def sheet_rows_isracard(rows):
    out = [["פירוט עסקאות לכרטיס אשראי (נתוני דמו)"], ["כרטיס המסתיים ב-1234"], [],
           ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "הערות"]]
    for d, merchant, tx_amount, tx_cur, charge, note in rows:
        out.append([fmt(d), merchant, tx_amount if tx_amount is not None else charge, tx_cur, charge, "₪", note])
    out.append(['סה"כ', None, None, None, round(sum(r[4] for r in rows), 2), None, None])
    return out


def sheet_rows_max(rows):
    out = [["תאריך עסקה", "שם בית העסק", "קטגוריה", "4 ספרות אחרונות", "סכום חיוב", "הערות"]]
    for d, merchant, category, last4, charge, note in rows:
        out.append([fmt(d), merchant, category, last4, charge, note])
    return out


def main():
    samples = ROOT / "web" / "samples"
    samples.mkdir(parents=True, exist_ok=True)
    isr, mx, gen = isracard_rows(), max_rows(), generic_rows()
    write_isracard(samples / "isracard-demo.xlsx", isr)
    write_max(samples / "max-demo.xlsx", mx)
    write_generic(samples / "generic-demo.csv", gen)

    demo = [
        {"name": "isracard-demo.xlsx", "kind": "rows", "rows": sheet_rows_isracard(isr)},
        {"name": "max-demo.xlsx", "kind": "rows", "rows": sheet_rows_max(mx)},
        {"name": "generic-demo.csv", "kind": "csv", "text": (samples / "generic-demo.csv").read_text(encoding="utf-8-sig")},
    ]
    js = "/* Generated by scripts/make_samples.py. Synthetic data only. */\n"
    js += "(function (root) {\n  root.EI = root.EI || {};\n  root.EI.DEMO_FILES = " + json.dumps(demo, ensure_ascii=False, indent=1) + ";\n})(typeof self !== \"undefined\" ? self : globalThis);\n"
    (ROOT / "web" / "js" / "demo-data.js").write_text(js, encoding="utf-8")
    print(len(isr), len(mx), len(gen))


if __name__ == "__main__":
    main()
