/* Statement parsing: dates, amounts, CSV text, header detection and row
 * conversion. Pure functions, no DOM. Works in the browser (window.EI) and in
 * Node (require). */
(function (root) {
  "use strict";

  const categories = typeof require === "function" && typeof module === "object" ? require("./categories.js") : root.EI;

  // ---------- dates ----------

  function isoDate(year, month, day) {
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    const pad = (n, width) => String(n).padStart(width, "0");
    return pad(year, 4) + "-" + pad(month, 2) + "-" + pad(day, 2);
  }

  /* Returns "YYYY-MM-DD" or null. Slash/dot/dash dates are read as DD/MM/YYYY
   * (the Israeli convention); a month above 12 makes the date invalid. */
  function parseDate(value) {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      const utcMidnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
      return utcMidnight
        ? isoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())
        : isoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    if (typeof value === "number") {
      if (!(value >= 20000 && value < 80000)) return null; // plausible Excel serial range
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
      return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    if (typeof value !== "string") return null;
    const text = value.trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(text);
    if (match) return isoDate(+match[1], +match[2], +match[3]);
    match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
    if (match) {
      const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
      return isoDate(year, +match[2], +match[1]);
    }
    return null;
  }

  // ---------- amounts ----------

  /* Returns a number or null. Understands "1,234.56", "1.234,56", "₪ 45", "(45.00)",
   * "45.00-" and the unicode minus. */
  function parseAmount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    let text = value.replace(/[‎‏]/g, "").replace(/₪|ש"ח|שח|nis|ils/gi, "").replace(/\s/g, "");
    if (!text) return null;
    let negative = false;
    if (/^\(.*\)$/.test(text)) {
      negative = true;
      text = text.slice(1, -1);
    }
    text = text.replace(/−/g, "-");
    if (text.endsWith("-")) {
      negative = true;
      text = text.slice(0, -1);
    }
    if (text.startsWith("-")) {
      negative = true;
      text = text.slice(1);
    }
    if (text.startsWith("+")) text = text.slice(1);
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    if (lastComma !== -1 && lastDot !== -1) {
      text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    } else if (lastComma !== -1) {
      text = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
    }
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return negative ? -number : number;
  }

  // ---------- CSV ----------

  /* Decode file bytes: UTF-8 when valid (BOM stripped), otherwise windows-1255,
   * the encoding many Israeli exports use. */
  function decodeCsvBytes(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^﻿/, "");
    } catch (error) {
      return new TextDecoder("windows-1255").decode(buffer);
    }
  }

  /* Quote-aware CSV parser. Delimiter (, ; or tab) is detected from the first lines. */
  function parseCsv(text) {
    const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
    const counts = { ",": 0, ";": 0, "\t": 0 };
    for (const char of firstLines) if (char in counts) counts[char] += 1;
    const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else cell += char;
    }
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  // ---------- header detection ----------

  function normalizeHeader(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[‎‏"'`״׳:()]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Aliases are listed in priority order: the first one present in the file wins.
  const ALIASES = {
    date: ["תאריך עסקה", "תאריך רכישה", "date", "transaction date", "תאריך"],
    description: ["שם בית עסק", "שם בית העסק", "שם העסק", "בית עסק", "תיאור", "פרטים", "description", "merchant", "details", "payee"],
    amount: ["סכום חיוב", "סכום החיוב", "סכום בשקלים", "amount", "סכום עסקה", "סכום"],
    chargeDate: ["תאריך חיוב", "מועד חיוב"],
    card: ["4 ספרות אחרונות", "מספר כרטיס", "כרטיס", "card", "card number"],
    note: ["הערות", "הערה", "פירוט נוסף", "תשלומים", "note", "notes"],
    currency: ["מטבע חיוב", "מטבע עסקה", "מטבע", "currency"],
  };
  const BILLING_AMOUNT = /חיוב|בשקלים/;

  function findColumn(headers, aliases, taken, excludeText) {
    for (const alias of aliases) {
      const exact = headers.findIndex((h, i) => !taken.has(i) && h === alias);
      if (exact !== -1) return exact;
    }
    for (const alias of aliases) {
      const partial = headers.findIndex((h, i) => !taken.has(i) && h.includes(alias) && !(excludeText && h.includes(excludeText)));
      if (partial !== -1) return partial;
    }
    return -1;
  }

  /* Looks for a header row (within the first 40 rows) that has date, description
   * and amount columns. Returns { headerRow, columns } or null. */
  function detectTable(rows) {
    for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
      const headers = (rows[i] || []).map(normalizeHeader);
      const taken = new Set();
      const columns = {};
      for (const field of ["date", "description", "amount", "chargeDate", "card", "note", "currency"]) {
        const index = findColumn(headers, ALIASES[field], taken, field === "date" ? "חיוב" : null);
        if (index !== -1) {
          columns[field] = index;
          taken.add(index);
        }
      }
      if (columns.date !== undefined && columns.description !== undefined && columns.amount !== undefined) {
        columns.amountIsBilling = BILLING_AMOUNT.test(headers[columns.amount]);
        return { headerRow: i, columns };
      }
    }
    return null;
  }

  /* read-excel-file returns [{ sheet, data }]. Pick the first sheet that has a
   * recognizable transaction table; otherwise the first non-empty sheet.
   * Returns { rows, sheet } or null. */
  function pickSheet(sheets) {
    const candidates = (Array.isArray(sheets) ? sheets : []).filter((s) => s && Array.isArray(s.data) && s.data.length);
    const withTable = candidates.find((s) => detectTable(s.data));
    const chosen = withTable || candidates[0];
    return chosen ? { rows: chosen.data, sheet: chosen.sheet } : null;
  }

  /* For the manual mapping step: first row with at least 3 non-empty cells. */
  function guessHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 40); i += 1) {
      if ((rows[i] || []).filter((c) => String(c == null ? "" : c).trim() !== "").length >= 3) return i;
    }
    return 0;
  }

  // ---------- rows -> transactions ----------

  const TOTAL_ROW = /סה.?כ|total|סיכום/i;
  const ILS = new Set(["", "₪", "שח", "ש\"ח", "ils", "nis", "שקל", "שקלים"]);
  const INSTALLMENT = /(\d+)\s*(?:מתוך|\/|of)\s*(\d+)/i;

  function isEmpty(value) {
    return value == null || String(value).trim() === "";
  }

  /* options: { headerRow, columns, file, card, expensesArePositive: true|false|"auto" }
   * Returns { transactions, errors, skipped }. Internal amounts: expenses negative. */
  function rowsToTransactions(rows, options) {
    const { headerRow, columns, file } = options;
    const errors = [];
    let skipped = 0;
    const parsed = [];

    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const cells = rows[r] || [];
      if (cells.every(isEmpty)) continue;
      const rowNumber = r + 1;
      const dateRaw = cells[columns.date];
      const description = isEmpty(cells[columns.description]) ? "" : String(cells[columns.description]).trim();
      const amountRaw = cells[columns.amount];

      const date = parseDate(dateRaw);
      // Totals rows ("סה"כ ...") can carry their label in any column, usually the first.
      const totalsLabel = TOTAL_ROW.test(description) || TOTAL_ROW.test(String(dateRaw == null ? "" : dateRaw));
      if (!date && (totalsLabel || (isEmpty(dateRaw) && isEmpty(amountRaw)))) {
        skipped += 1;
        continue;
      }
      if (!date) {
        errors.push({ file, row: rowNumber, message: "invalid date: " + JSON.stringify(dateRaw == null ? "" : String(dateRaw)) });
        continue;
      }
      const amount = parseAmount(amountRaw);
      if (amount === null) {
        errors.push({ file, row: rowNumber, message: "invalid amount: " + JSON.stringify(amountRaw == null ? "" : String(amountRaw)) });
        continue;
      }
      if (!description) {
        errors.push({ file, row: rowNumber, message: "missing description" });
        continue;
      }
      parsed.push({ date, description, amount, cells, rowNumber });
    }

    let expensesArePositive = options.expensesArePositive;
    if (expensesArePositive === "auto" || expensesArePositive === undefined) {
      const negatives = parsed.filter((p) => p.amount < 0).length;
      const positives = parsed.filter((p) => p.amount > 0).length;
      expensesArePositive = positives >= negatives;
    }

    const transactions = parsed.map((p) => {
      const tx = {
        date: p.date,
        description: p.description,
        merchant: categories.normalizeMerchant(p.description),
        amount: expensesArePositive ? -p.amount : p.amount,
        card: !isEmpty(p.cells[columns.card]) ? String(p.cells[columns.card]).trim() : options.card || file,
        file,
        row: p.rowNumber,
      };
      if (columns.note !== undefined && !isEmpty(p.cells[columns.note])) {
        const match = INSTALLMENT.exec(String(p.cells[columns.note]));
        if (match) tx.installment = { n: +match[1], of: +match[2] };
      }
      if (columns.currency !== undefined && !columns.amountIsBilling) {
        const currency = String(p.cells[columns.currency] == null ? "" : p.cells[columns.currency]).trim().toLowerCase().replace(/["'.]/g, "");
        if (!ILS.has(currency)) tx.foreign = true;
      }
      return tx;
    });

    return { transactions, errors, skipped };
  }

  const api = {
    parseDate, parseAmount, decodeCsvBytes, parseCsv, normalizeHeader,
    detectTable, pickSheet, guessHeaderRow, rowsToTransactions,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EI = Object.assign(root.EI || {}, api);
})(typeof self !== "undefined" ? self : globalThis);
