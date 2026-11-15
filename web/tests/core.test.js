"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const categories = require("../js/categories.js");
const parse = require("../js/parse.js");
const analyze = require("../js/analyze.js");

const SAMPLES = path.join(__dirname, "..", "samples");

// ---------- categories ----------

test("normalizeMerchant strips punctuation and standalone numbers", () => {
  assert.equal(categories.normalizeMerchant('שופרסל דיל 123, תל-אביב'), "שופרסל דיל תל אביב");
  assert.equal(categories.normalizeMerchant("  NETFLIX.COM  "), "netflix com");
});

test("categorize: longest keyword wins, whole words only, credits, overrides", () => {
  assert.equal(categories.categorize("סופר פארם תל אביב", -50), "health");
  assert.equal(categories.categorize("סופר דוד", -50), "groceries");
  assert.equal(categories.categorize("space cafe", -5), "dining");
  assert.equal(categories.categorize("whatever", 20), "credit");
  assert.equal(categories.categorize("whatever", -20), "other");
  assert.equal(categories.categorize("שופרסל", -20, { "שופרסל": "shopping" }), "shopping");
  assert.equal(categories.categorize("שופרסל", -20, { "שופרסל": "not-a-category" }), "groceries");
});

// ---------- dates and amounts ----------

test("parseDate handles ISO, DD/MM/YYYY, 2-digit years, Date and Excel serials", () => {
  assert.equal(parse.parseDate("2026-01-05"), "2026-01-05");
  assert.equal(parse.parseDate("05/06/2026"), "2026-06-05"); // DD/MM, not MM/DD
  assert.equal(parse.parseDate("5.1.26"), "2026-01-05");
  assert.equal(parse.parseDate(new Date(Date.UTC(2026, 0, 5))), "2026-01-05");
  assert.equal(parse.parseDate(46027), "2026-01-05");
});

test("parseDate rejects impossible dates instead of guessing", () => {
  assert.equal(parse.parseDate("31/02/2026"), null);
  assert.equal(parse.parseDate("13/13/2026"), null);
  assert.equal(parse.parseDate("hello"), null);
  assert.equal(parse.parseDate(""), null);
});

test("parseAmount understands common statement formats", () => {
  assert.equal(parse.parseAmount("₪1,234.56"), 1234.56);
  assert.equal(parse.parseAmount("1.234,56"), 1234.56);
  assert.equal(parse.parseAmount("12,50"), 12.5);
  assert.equal(parse.parseAmount("1,234"), 1234);
  assert.equal(parse.parseAmount("(45.00)"), -45);
  assert.equal(parse.parseAmount("45.00-"), -45);
  assert.equal(parse.parseAmount("−7"), -7);
  assert.equal(parse.parseAmount(12.3), 12.3);
  assert.equal(parse.parseAmount("abc"), null);
  assert.equal(parse.parseAmount(""), null);
});

// ---------- CSV ----------

test("parseCsv handles quotes, escaped quotes, and ; or tab delimiters", () => {
  assert.deepEqual(parse.parseCsv('a;b;c\n"x;y";2;"he said ""hi"""\n'), [["a", "b", "c"], ["x;y", "2", 'he said "hi"']]);
  assert.deepEqual(parse.parseCsv("a\tb\r\n1\t2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("decodeCsvBytes falls back to windows-1255 for Hebrew exports", () => {
  const cp1255 = Buffer.from([0xf9, 0xe5, 0xf4, 0xf8, 0xf1, 0xec]); // שופרסל
  assert.equal(parse.decodeCsvBytes(cp1255), "שופרסל");
  const utf8 = Buffer.from("﻿שופרסל", "utf8");
  assert.equal(parse.decodeCsvBytes(utf8), "שופרסל");
});

// ---------- header detection and row conversion ----------

test("detectTable finds the header below preamble rows and prefers billing amount", () => {
  const rows = [
    ["כותרת"], [], ["תאריך רכישה", "שם בית עסק", "סכום עסקה", "מטבע עסקה", "סכום חיוב", "מטבע חיוב", "הערות"],
  ];
  const table = parse.detectTable(rows);
  assert.equal(table.headerRow, 2);
  assert.equal(table.columns.date, 0);
  assert.equal(table.columns.description, 1);
  assert.equal(table.columns.amount, 4);
  assert.equal(table.columns.currency, 5);
  assert.equal(table.columns.amountIsBilling, true);
});

test("detectTable does not take the charge-date column as the date", () => {
  const table = parse.detectTable([["תאריך חיוב", "תאריך", "שם בית עסק", "סכום"]]);
  assert.equal(table.columns.date, 1);
  assert.equal(table.columns.chargeDate, 0);
});

test("detectTable returns null when no usable header exists", () => {
  assert.equal(parse.detectTable([["a", "b"], ["1", "2"]]), null);
});

test("rowsToTransactions: signs, installments, skipped totals, exact error rows", () => {
  const rows = [
    ["תאריך רכישה", "שם בית עסק", "סכום חיוב", "הערות"],
    ["05/01/2026", "KSP", "400", "תשלום 2 מתוך 3"],
    ["06/01/2026", "זיכוי", "-50", ""],
    ["לא תאריך", "קפה", "10", ""],
    ["07/01/2026", "קפה", "abc", ""],
    [null, 'סה"כ', "350", ""],
    [],
  ];
  const table = parse.detectTable(rows);
  const result = parse.rowsToTransactions(rows, { ...table, file: "f.xlsx", card: "Visa", expensesArePositive: "auto" });
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactions[0].amount, -400); // statement expense -> internal negative
  assert.equal(result.transactions[1].amount, 50); // refund -> positive
  assert.deepEqual(result.transactions[0].installment, { n: 2, of: 3 });
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors.map((e) => e.row), [4, 5]);
  assert.match(result.errors[0].message, /invalid date/);
  assert.match(result.errors[1].message, /invalid amount/);
});

test("rowsToTransactions skips a totals row whose label sits in the date column", () => {
  const rows = [["date", "description", "amount"], ["2026-01-01", "a", "5"], ['סה"כ', "", "5"]];
  const table = parse.detectTable(rows);
  const result = parse.rowsToTransactions(rows, { ...table, file: "t.csv", card: "c", expensesArePositive: true });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.errors, []);
});

test("rowsToTransactions auto-detects expenses-negative files", () => {
  const rows = [["date", "description", "amount"], ["2026-01-01", "Salary", "1000"], ["2026-01-02", "Coffee", "-5"], ["2026-01-03", "Taxi", "-20"]];
  const table = parse.detectTable(rows);
  const result = parse.rowsToTransactions(rows, { ...table, file: "g.csv", card: "Bank", expensesArePositive: "auto" });
  assert.deepEqual(result.transactions.map((t) => t.amount), [1000, -5, -20]);
});

test("foreign-currency rows are flagged only when the amount column is not the billed amount", () => {
  const rows = [["date", "description", "amount", "currency"], ["2026-01-01", "Shop", "10", "USD"], ["2026-01-02", "Shop", "10", "₪"]];
  const table = parse.detectTable(rows);
  const result = parse.rowsToTransactions(rows, { ...table, file: "x.csv", card: "c", expensesArePositive: true });
  assert.deepEqual(result.transactions.map((t) => !!t.foreign), [true, false]);
});

// ---------- analysis ----------

function tx(date, merchant, amount, card = "A", category) {
  const m = categories.normalizeMerchant(merchant);
  return { date, description: merchant, merchant: m, amount, card, category: category || categories.categorize(m, amount) };
}

test("monthlyTrend totals per month and per card; credits are not netted", () => {
  const trend = analyze.monthlyTrend([tx("2026-01-03", "קפה", -30, "A"), tx("2026-01-09", "פיצה", -20, "B"), tx("2026-01-10", "זיכוי", 5, "A"), tx("2026-02-01", "קפה", -10, "A")]);
  assert.deepEqual(trend, [
    { month: "2026-01", total: 50, byCard: { A: 30, B: 20 } },
    { month: "2026-02", total: 10, byCard: { A: 10 } },
  ]);
});

test("byCategory shares add up to 1 and sort by total", () => {
  const result = analyze.byCategory([tx("2026-01-01", "שופרסל", -75), tx("2026-01-02", "קפה", -25)]);
  assert.deepEqual(result.map((r) => r.id), ["groceries", "dining"]);
  assert.equal(result[0].share, 0.75);
});

test("filterTransactions applies months, cards and drops foreign rows", () => {
  const list = [tx("2026-01-01", "a", -1, "A"), tx("2026-02-01", "b", -1, "B"), { ...tx("2026-02-02", "c", -1, "B"), foreign: true }];
  assert.equal(analyze.filterTransactions(list, { from: "2026-02" }).length, 1);
  assert.equal(analyze.filterTransactions(list, { cards: ["A"] }).length, 1);
  assert.equal(analyze.filterTransactions(list, {}).length, 2);
});

test("topMerchants groups by normalized name and ranks by amount and count", () => {
  const list = [tx("2026-01-01", "שופרסל 12", -100), tx("2026-01-08", "שופרסל 99", -50), tx("2026-01-09", "גרג", -300), tx("2026-01-10", "קפה", -5)];
  const top = analyze.topMerchants(list, 2);
  assert.equal(top.byAmount[0].merchant, "גרג");
  assert.equal(top.byCount[0].merchant, "שופרסל");
  assert.equal(top.byCount[0].total, 150);
});

test("findUnusual flags an outlier, skips small categories", () => {
  const base = [1, 2, 3, 4].map((d) => tx("2026-01-0" + d, "קפה", -30));
  const outlier = tx("2026-01-09", "קפה גרג", -500);
  assert.equal(analyze.findUnusual([...base, outlier]).length, 1);
  assert.equal(analyze.findUnusual(base).length, 0);
  assert.equal(analyze.findUnusual([base[0], outlier]).length, 0);
});

test("findRecurring finds steady monthly charges and ignores varying shopping", () => {
  const netflix = ["2026-01-08", "2026-02-08", "2026-03-08"].map((d) => tx(d, "NETFLIX.COM", -54.9));
  const groceries = [
    tx("2026-01-03", "שופרסל", -200), tx("2026-01-10", "שופרסל", -310), tx("2026-02-04", "שופרסל", -150),
    tx("2026-02-11", "שופרסל", -90), tx("2026-03-02", "שופרסל", -400), tx("2026-03-09", "שופרסל", -120),
  ];
  const varying = ["2026-01-05", "2026-02-05", "2026-03-05"].map((d, i) => tx(d, "חנות", -[100, 300, 50][i]));
  const result = analyze.findRecurring([...netflix, ...groceries, ...varying]);
  assert.deepEqual(result.map((r) => r.merchant), ["netflix com"]);
  assert.equal(result[0].yearly, 658.8);
});

test("summary counts expenses only and reports credits separately", () => {
  const s = analyze.summary([tx("2026-01-01", "a", -100), tx("2026-02-01", "b", -300), tx("2026-02-02", "c", 50)]);
  assert.equal(s.spent, 400);
  assert.equal(s.monthlyAverage, 200);
  assert.equal(s.count, 2);
  assert.equal(s.credits, 50);
  assert.equal(s.biggest.description, "b");
});

// ---------- end to end on the synthetic sample files ----------

test("real .xlsx sample files go through the vendored reader and parse cleanly", async () => {
  const readXlsxFile = require("../vendor/read-excel-file.min.js");
  const results = {};
  for (const [file, card] of [["isracard-demo.xlsx", "Isracard"], ["max-demo.xlsx", "Max"]]) {
    const buffer = fs.readFileSync(path.join(SAMPLES, file));
    const picked = parse.pickSheet(await readXlsxFile(new Blob([buffer])));
    assert.ok(picked, file + ": sheet found");
    const rows = picked.rows;
    const table = parse.detectTable(rows);
    assert.ok(table, file + ": header detected");
    const result = parse.rowsToTransactions(rows, { ...table, file, card, expensesArePositive: "auto" });
    assert.deepEqual(result.errors, [], file + ": no row errors");
    results[file] = result;
  }
  const isr = results["isracard-demo.xlsx"];
  assert.equal(isr.transactions.length, 42); // 42 data rows incl. the refund; the totals row is skipped
  assert.equal(isr.skipped, 1);
  assert.ok(isr.transactions.some((t) => t.installment && t.installment.of === 3));
  assert.ok(isr.transactions.every((t) => /^2026-0[789]-\d\d$/.test(t.date)));
  assert.ok(isr.transactions.some((t) => t.amount > 0), "refund is a credit");
  const max = results["max-demo.xlsx"];
  assert.equal(max.transactions.length, 31);
  assert.ok(max.transactions.every((t) => t.card === "5678"), "card taken from the 4-digits column");
});

test("pickSheet prefers the sheet with a transaction table", () => {
  const sheets = [{ sheet: "Info", data: [["hello"]] }, { sheet: "Data", data: [["date", "description", "amount"], ["2026-01-01", "x", "1"]] }];
  assert.equal(parse.pickSheet(sheets).sheet, "Data");
  assert.equal(parse.pickSheet([]), null);
});

test("generic CSV sample parses with expenses negative and income positive", () => {
  const text = parse.decodeCsvBytes(fs.readFileSync(path.join(SAMPLES, "generic-demo.csv")));
  const rows = parse.parseCsv(text);
  const table = parse.detectTable(rows);
  const result = parse.rowsToTransactions(rows, { ...table, file: "generic-demo.csv", card: "Bank", expensesArePositive: "auto" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.transactions.length, 12);
  assert.equal(result.transactions.filter((t) => t.amount > 0).length, 3);
});
