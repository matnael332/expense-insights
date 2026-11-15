/* Aggregations for the dashboard. Pure functions over transaction objects:
 * { date: "YYYY-MM-DD", description, merchant, amount (expenses negative), card, category, foreign? } */
(function (root) {
  "use strict";

  const categories = typeof require === "function" && typeof module === "object" ? require("./categories.js") : root.EI;

  const round2 = (n) => Math.round(n * 100) / 100;
  const monthOf = (tx) => tx.date.slice(0, 7);

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /* Assigns tx.category from overrides/keywords. Returns new objects. */
  function applyCategories(transactions, overrides) {
    return transactions.map((tx) => ({ ...tx, category: categories.categorize(tx.merchant, tx.amount, overrides) }));
  }

  /* filters: { from: "YYYY-MM", to: "YYYY-MM", cards: [names] }. Foreign-currency
   * rows are excluded from all totals. */
  function filterTransactions(transactions, filters) {
    const { from, to, cards } = filters || {};
    return transactions.filter((tx) => {
      if (tx.foreign) return false;
      const month = monthOf(tx);
      if (from && month < from) return false;
      if (to && month > to) return false;
      if (cards && cards.length && !cards.includes(tx.card)) return false;
      return true;
    });
  }

  const expensesOf = (transactions) => transactions.filter((tx) => tx.amount < 0);

  /* Spending per month, split by card, as positive numbers. Only expenses count:
   * credits (refunds, salary on a bank file) are reported separately by summary()
   * and are not netted against spending. */
  function monthlyTrend(transactions) {
    const months = new Map();
    for (const tx of expensesOf(transactions)) {
      const key = monthOf(tx);
      if (!months.has(key)) months.set(key, { month: key, total: 0, byCard: {} });
      const entry = months.get(key);
      entry.total += -tx.amount;
      entry.byCard[tx.card] = (entry.byCard[tx.card] || 0) + -tx.amount;
    }
    return [...months.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        month: m.month,
        total: round2(m.total),
        byCard: Object.fromEntries(Object.entries(m.byCard).map(([card, value]) => [card, round2(value)])),
      }));
  }

  function byCategory(transactions) {
    const expenses = expensesOf(transactions);
    const totals = new Map();
    for (const tx of expenses) {
      const entry = totals.get(tx.category) || { id: tx.category, total: 0, count: 0 };
      entry.total += -tx.amount;
      entry.count += 1;
      totals.set(tx.category, entry);
    }
    const grand = [...totals.values()].reduce((sum, e) => sum + e.total, 0);
    return [...totals.values()]
      .sort((a, b) => b.total - a.total)
      .map((e) => ({ ...e, total: round2(e.total), share: grand ? e.total / grand : 0 }));
  }

  /* Groups expenses by normalized merchant. Display name = most frequent raw description. */
  function merchantGroups(transactions) {
    const groups = new Map();
    for (const tx of expensesOf(transactions)) {
      if (!groups.has(tx.merchant)) groups.set(tx.merchant, { merchant: tx.merchant, total: 0, count: 0, names: new Map(), category: tx.category });
      const group = groups.get(tx.merchant);
      group.total += -tx.amount;
      group.count += 1;
      group.names.set(tx.description, (group.names.get(tx.description) || 0) + 1);
    }
    return [...groups.values()].map((g) => ({
      merchant: g.merchant,
      name: [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0],
      total: round2(g.total),
      count: g.count,
      category: g.category,
    }));
  }

  function topMerchants(transactions, limit = 10) {
    const groups = merchantGroups(transactions);
    return {
      byAmount: [...groups].sort((a, b) => b.total - a.total).slice(0, limit),
      byCount: [...groups].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, limit),
    };
  }

  /* Same rule as the Python CLI: an expense above `factor` x its category's median,
   * only for categories with at least `minSamples` expenses. */
  function findUnusual(transactions, factor = 3, minSamples = 4) {
    const byCat = new Map();
    for (const tx of expensesOf(transactions)) {
      if (!byCat.has(tx.category)) byCat.set(tx.category, []);
      byCat.get(tx.category).push(tx);
    }
    const flagged = [];
    for (const items of byCat.values()) {
      if (items.length < minSamples) continue;
      const baseline = median(items.map((tx) => -tx.amount));
      for (const tx of items) if (-tx.amount > factor * baseline) flagged.push({ ...tx, baseline: round2(baseline) });
    }
    return flagged.sort((a, b) => a.date.localeCompare(b.date));
  }

  /* Recurring payment = a merchant charged exactly once in most of its months,
   * in at least `minMonths` months, with amounts within `tolerance` of the median. */
  function findRecurring(transactions, minMonths = 3, tolerance = 0.1) {
    const byMerchant = new Map();
    for (const tx of expensesOf(transactions)) {
      if (!byMerchant.has(tx.merchant)) byMerchant.set(tx.merchant, new Map());
      const months = byMerchant.get(tx.merchant);
      const key = monthOf(tx);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(tx);
    }
    const result = [];
    for (const [merchant, months] of byMerchant) {
      const singles = [...months.values()].filter((list) => list.length === 1).map((list) => list[0]);
      if (singles.length < minMonths || singles.length / months.size < 0.7) continue;
      const baseline = median(singles.map((tx) => -tx.amount));
      const steady = singles.filter((tx) => Math.abs(-tx.amount - baseline) <= tolerance * baseline);
      if (steady.length < minMonths) continue;
      result.push({
        merchant,
        name: steady[0].description,
        category: steady[0].category,
        months: steady.length,
        monthly: round2(baseline),
        yearly: round2(baseline * 12),
      });
    }
    return result.sort((a, b) => b.yearly - a.yearly);
  }

  function summary(transactions) {
    const expenses = expensesOf(transactions);
    const months = new Set(expenses.map(monthOf));
    const spent = -expenses.reduce((sum, tx) => sum + tx.amount, 0);
    const credits = transactions.filter((tx) => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
    const biggest = expenses.reduce((best, tx) => (!best || tx.amount < best.amount ? tx : best), null);
    return {
      spent: round2(spent),
      monthlyAverage: months.size ? round2(spent / months.size) : 0,
      count: expenses.length,
      credits: round2(credits),
      biggest,
    };
  }

  const api = { applyCategories, filterTransactions, monthlyTrend, byCategory, topMerchants, findUnusual, findRecurring, summary };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EI = Object.assign(root.EI || {}, api);
})(typeof self !== "undefined" ? self : globalThis);
