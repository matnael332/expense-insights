/* Dashboard UI. All data stays in memory in this page; nothing is sent anywhere.
 * Every value that comes from a file is inserted with textContent (never as HTML). */
(function () {
  "use strict";

  const EI = window.EI;
  const STORAGE_KEY = "expenseInsights.categoryOverrides";
  const MAX_TABLE_ROWS = 300;

  const money0 = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat("he-IL", { style: "percent", maximumFractionDigits: 0 });

  const state = {
    files: [],
    overrides: loadOverrides(),
    all: [],
    filters: { from: "", to: "", cards: null },
    metric: "amount",
    nextId: 1,
    search: "",
  };
  const charts = {};

  // ---------- helpers ----------

  const $ = (id) => document.getElementById(id);

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const notify = (message) => { $("notice").textContent = message || ""; };

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("he-IL", { month: "short", year: "2-digit", timeZone: "UTC" });
  }

  function dateLabel(iso) {
    const [y, m, d] = iso.split("-");
    return d + "/" + m + "/" + y;
  }

  function sanitizeOverrides(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    const ids = EI.CATEGORIES.map((c) => c.id);
    for (const [key, value] of Object.entries(raw)) {
      if (key !== "__proto__" && key.length < 200 && ids.includes(value)) out[key] = value;
    }
    return out;
  }

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitizeOverrides(JSON.parse(raw)) : {};
    } catch (error) {
      return {};
    }
  }

  function saveOverrides() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.overrides));
    } catch (error) {
      notify("לא ניתן לשמור שינויים בדפדפן הזה; הם יישמרו עד סגירת הלשונית.");
    }
  }

  // ---------- reading files ----------

  async function readRows(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) {
      return EI.parseCsv(EI.decodeCsvBytes(await file.arrayBuffer()));
    }
    if (name.endsWith(".xlsx")) {
      const picked = EI.pickSheet(await window.readXlsxFile(file));
      if (!picked) throw new Error("לא נמצאו נתונים בקובץ");
      return picked.rows;
    }
    if (name.endsWith(".xls")) throw new Error("פורמט xls ישן אינו נתמך. שמור את הקובץ כ-xlsx או כ-CSV ונסה שוב");
    throw new Error("סוג קובץ לא נתמך (נתמכים: xlsx ו-CSV)");
  }

  function defaultCardName(fileName) {
    return fileName.replace(/\.[^.]+$/, "");
  }

  function process(entry) {
    entry.result = EI.rowsToTransactions(entry.rows, {
      headerRow: entry.table.headerRow,
      columns: entry.table.columns,
      file: entry.name,
      card: entry.card,
      expensesArePositive: entry.sign,
    });
  }

  function addEntry(name, rows, table, card) {
    const entry = { id: state.nextId++, name, rows, table, card, sign: "auto", result: null };
    process(entry);
    state.files.push(entry);
    refresh();
  }

  async function addFiles(fileList) {
    for (const file of Array.from(fileList)) {
      if (state.files.some((f) => f.name === file.name)) {
        notify("הקובץ " + file.name + " כבר נטען.");
        continue;
      }
      try {
        const rows = await readRows(file);
        await ingest(file.name, rows);
      } catch (error) {
        notify("שגיאה בקובץ " + file.name + ": " + error.message);
      }
    }
  }

  async function ingest(name, rows) {
    const card = defaultCardName(name);
    const table = EI.detectTable(rows);
    if (table) {
      addEntry(name, rows, table, card);
      return;
    }
    const mapped = await askMapping(name, rows);
    if (!mapped) {
      notify("הקובץ " + name + " דולג.");
      return;
    }
    const entry = { id: state.nextId++, name, rows, table: mapped.table, card, sign: mapped.sign, result: null };
    process(entry);
    state.files.push(entry);
    refresh();
  }

  // ---------- manual column mapping ----------

  const MAP_FIELDS = [
    ["date", "תאריך עסקה", true],
    ["description", "שם בית עסק", true],
    ["amount", "סכום", true],
    ["card", "כרטיס (אופציונלי)", false],
    ["note", "הערות / תשלומים (אופציונלי)", false],
    ["currency", "מטבע (אופציונלי)", false],
  ];

  function askMapping(fileName, rows) {
    return new Promise((resolve) => {
      const dialog = $("mapDialog");
      const fields = $("mapFields");
      $("mapFile").textContent = "לא זוהה אוטומטית מבנה הטבלה בקובץ " + fileName + ". בחר איזו עמודה היא איזו.";
      let headerRow = EI.guessHeaderRow(rows);
      let sign = "auto";

      const rowInput = el("input", { type: "number", min: "1", max: String(Math.min(rows.length, 40)), value: String(headerRow + 1), id: "mapHeaderRow" });
      const selects = {};

      function fillSelects() {
        const headers = rows[headerRow] || [];
        for (const [key, , required] of MAP_FIELDS) {
          const select = selects[key];
          const previous = select.value;
          select.replaceChildren(el("option", { value: "", text: required ? "בחר עמודה" : "ללא" }));
          headers.forEach((cell, index) => {
            const text = String(cell == null ? "" : cell).trim() || "(עמודה " + (index + 1) + ")";
            select.append(el("option", { value: String(index), text: index + 1 + ": " + text }));
          });
          if (previous && select.querySelector('option[value="' + previous + '"]')) select.value = previous;
        }
      }

      fields.replaceChildren(el("div", { class: "field" }, el("label", { for: "mapHeaderRow", text: "שורת כותרות" }), rowInput));
      for (const [key, label, required] of MAP_FIELDS) {
        const select = el("select", { id: "map-" + key, required: required });
        selects[key] = select;
        fields.append(el("div", { class: "field" }, el("label", { for: "map-" + key, text: label }), select));
      }
      const radios = el("div", { class: "radio-row" });
      for (const [value, label] of [["auto", "זיהוי אוטומטי"], ["true", "הוצאות חיוביות"], ["false", "הוצאות שליליות"]]) {
        const input = el("input", { type: "radio", name: "mapSign", value, checked: value === "auto" });
        input.addEventListener("change", () => { sign = value === "auto" ? "auto" : value === "true"; });
        radios.append(el("label", {}, input, " " + label));
      }
      fields.append(el("div", { class: "field" }, el("span", { text: "סימן הסכומים" }), radios));
      fillSelects();
      rowInput.addEventListener("change", () => {
        const value = Math.max(1, Math.min(Number(rowInput.value) || 1, rows.length));
        headerRow = value - 1;
        fillSelects();
      });

      const form = $("mapForm");
      const cancel = $("mapCancel");
      function cleanup() {
        form.removeEventListener("submit", onSubmit);
        cancel.removeEventListener("click", onCancel);
      }
      function onSubmit(event) {
        event.preventDefault();
        const columns = {};
        for (const [key] of MAP_FIELDS) if (selects[key].value !== "") columns[key] = Number(selects[key].value);
        const chosen = Object.values(columns);
        if (columns.date === undefined || columns.description === undefined || columns.amount === undefined) return;
        if (new Set(chosen).size !== chosen.length) {
          $("mapFile").textContent = "כל עמודה יכולה להיבחר רק פעם אחת.";
          return;
        }
        columns.amountIsBilling = columns.currency === undefined;
        cleanup();
        dialog.close();
        resolve({ table: { headerRow, columns }, sign });
      }
      function onCancel() {
        cleanup();
        dialog.close();
        resolve(null);
      }
      form.addEventListener("submit", onSubmit);
      cancel.addEventListener("click", onCancel);
      dialog.showModal();
    });
  }

  // ---------- file list ----------

  function renderFileList() {
    const list = $("fileList");
    list.replaceChildren();
    for (const entry of state.files) {
      const { transactions, errors, skipped } = entry.result;
      const nameInput = el("input", { type: "text", value: entry.card, "aria-label": "שם הכרטיס עבור " + entry.name });
      nameInput.addEventListener("change", () => {
        entry.card = nameInput.value.trim() || defaultCardName(entry.name);
        process(entry);
        refresh();
      });
      const item = el("li", { class: "file-item" },
        el("div", { class: "file-top" },
          el("span", { class: "file-name", text: entry.name }),
          el("span", {}, el("span", { class: "file-meta", text: "שם כרטיס: " }), nameInput),
          el("button", { type: "button", class: "button button-quiet", onclick: () => removeFile(entry.id), text: "הסר" })),
        el("div", { class: "file-meta" },
          transactions.length + " עסקאות נקראו" + (skipped ? ", " + skipped + " שורות סיכום דולגו" : ""),
          errors.length ? el("span", { class: "badge-err", text: ", " + errors.length + " שורות שגויות לא נכללו" }) : null));
      if (errors.length) {
        item.append(el("details", { class: "file-errors" },
          el("summary", { text: "הצג שורות שגויות" }),
          el("ul", {}, errors.map((e) => el("li", { text: "שורה " + e.row + ": " + e.message })))));
      }
      list.append(item);
    }
    $("clearButton").hidden = state.files.length === 0;
  }

  function removeFile(id) {
    state.files = state.files.filter((f) => f.id !== id);
    refresh();
  }

  // ---------- refresh pipeline ----------

  function refresh() {
    state.all = EI.applyCategories(state.files.flatMap((f) => f.result.transactions), state.overrides);
    renderFileList();
    $("dashboard").hidden = state.all.length === 0;
    if (state.all.length === 0) return;
    syncFilters();
    render();
  }

  function syncFilters() {
    const months = [...new Set(state.all.map((t) => t.date.slice(0, 7)))].sort();
    const cards = [...new Set(state.all.map((t) => t.card))];
    const { filters } = state;
    if (!months.includes(filters.from)) filters.from = months[0];
    if (!months.includes(filters.to)) filters.to = months[months.length - 1];
    if (filters.cards) filters.cards = filters.cards.filter((c) => cards.includes(c));
    for (const [id, value] of [["fromMonth", filters.from], ["toMonth", filters.to]]) {
      const select = $(id);
      select.replaceChildren(...months.map((m) => el("option", { value: m, text: monthLabel(m) })));
      select.value = value;
    }
    const box = $("cardFilter");
    box.replaceChildren(...cards.map((card, index) => {
      const input = el("input", { type: "checkbox", id: "card-" + index, checked: !filters.cards || filters.cards.includes(card) });
      input.addEventListener("change", () => {
        const checked = cards.filter((c, i) => $("card-" + i).checked);
        filters.cards = checked.length === cards.length ? null : checked;
        render();
      });
      return el("label", { for: "card-" + index }, input, card);
    }));
  }

  // ---------- rendering ----------

  function cardColor(card) {
    const index = [...new Set(state.all.map((t) => t.card))].indexOf(card);
    return index >= 0 && index < 8 ? css("--series-" + (index + 1)) : css("--text-muted");
  }

  function selectedTransactions() {
    const { from, to, cards } = state.filters;
    return EI.filterTransactions(state.all, { from, to, cards });
  }

  function render() {
    const tx = selectedTransactions();
    const foreign = state.all.filter((t) => t.foreign).length;
    const note = $("foreignNote");
    note.hidden = foreign === 0;
    note.textContent = foreign ? foreign + " עסקאות במטבע חוץ אינן כלולות בסכומים." : "";

    renderKpis(tx);
    renderTrend(tx);
    renderCategories(tx);
    renderMerchants(tx);
    renderUnusual(tx);
    renderRecurring(tx);
    renderTransactions(tx);
  }

  function renderKpis(tx) {
    const s = EI.summary(tx);
    $("kpiSpent").textContent = money0.format(s.spent);
    $("kpiCredits").textContent = s.credits ? "לא כולל זיכויים והכנסות: " + money0.format(s.credits) : "";
    $("kpiAverage").textContent = money0.format(s.monthlyAverage);
    $("kpiCount").textContent = String(s.count);
    $("kpiBiggest").textContent = s.biggest ? money0.format(-s.biggest.amount) : "-";
    $("kpiBiggestName").textContent = s.biggest ? s.biggest.description + " · " + dateLabel(s.biggest.date) : "";
  }

  function dataTable(headers, rows, numericFrom) {
    const head = el("tr", {}, headers.map((h, i) => el("th", { class: i >= numericFrom ? "num" : "", text: h })));
    const body = rows.map((cells) => el("tr", {}, cells.map((c, i) => (c && c.nodeType ? el("td", { class: i >= numericFrom ? "num" : "" }, c) : el("td", { class: i >= numericFrom ? "num" : "", text: String(c) })))));
    return el("div", { class: "table-wrap" }, el("table", {}, el("thead", {}, head), el("tbody", {}, body)));
  }

  function setChart(key, canvasId, config) {
    if (charts[key]) charts[key].destroy();
    charts[key] = new window.Chart($(canvasId), config);
  }

  function baseOptions() {
    const ink = css("--text-secondary");
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      locale: "he-IL",
      font: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
      color: ink,
    };
  }

  function formatTick(value) {
    return Math.abs(value) >= 10000 ? new Intl.NumberFormat("he-IL", { notation: "compact" }).format(value) : new Intl.NumberFormat("he-IL").format(value);
  }

  function renderTrend(tx) {
    const trend = EI.monthlyTrend(tx);
    const cards = [...new Set(tx.map((t) => t.card))];
    const surface = css("--surface");
    const datasets = cards.map((card) => ({
      label: card,
      data: trend.map((m) => m.byCard[card] || 0),
      backgroundColor: cardColor(card),
      borderColor: surface,
      borderWidth: 2,
      borderRadius: 4,
      borderSkipped: "bottom",
      maxBarThickness: 24,
    }));
    const options = baseOptions();
    setChart("trend", "trendChart", {
      type: "bar",
      data: { labels: trend.map((m) => monthLabel(m.month)), datasets },
      options: {
        ...options,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--text-secondary") } },
          y: { stacked: true, beginAtZero: true, grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--text-secondary"), callback: formatTick } },
        },
        plugins: {
          legend: { display: datasets.length > 1, rtl: true, labels: { color: css("--text-primary"), boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
          tooltip: {
            rtl: true, textDirection: "rtl",
            callbacks: {
              label: (item) => item.dataset.label + ": " + money0.format(item.parsed.y),
              footer: (items) => (items.length > 1 ? "סה״כ: " + money0.format(items.reduce((sum, i) => sum + i.parsed.y, 0)) : ""),
            },
          },
        },
      },
    });
    $("trendTable").replaceChildren(dataTable(["חודש", ...cards, "סה״כ"], trend.map((m) => [monthLabel(m.month), ...cards.map((c) => money0.format(m.byCard[c] || 0)), money0.format(m.total)]), 1));
  }

  // Draws the value just past the end of each horizontal bar (the one label a bar needs).
  const valueLabels = {
    id: "valueLabels",
    afterDatasetsDraw(chart, args, opts) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);
      ctx.save();
      ctx.fillStyle = css("--text-primary");
      ctx.font = "12px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      meta.data.forEach((bar, index) => ctx.fillText(opts.format(chart.data.datasets[0].data[index]), bar.x + 6, bar.y));
      ctx.restore();
    },
  };

  function horizontalBars(key, canvasId, boxId, labels, values, format, tooltipLines) {
    $(boxId).style.height = Math.max(120, labels.length * 30 + 40) + "px";
    setChart(key, canvasId, {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: css("--seq"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }] },
      plugins: [valueLabels],
      options: {
        ...baseOptions(),
        indexAxis: "y",
        layout: { padding: { right: 72 } },
        scales: {
          x: { beginAtZero: true, grid: { color: css("--grid") }, border: { display: false }, ticks: { color: css("--text-secondary"), callback: formatTick, maxTicksLimit: 5 } },
          y: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--text-primary"), autoSkip: false } },
        },
        plugins: {
          legend: { display: false },
          valueLabels: { format },
          tooltip: { rtl: true, textDirection: "rtl", callbacks: { label: (item) => tooltipLines(item.dataIndex) } },
        },
      },
    });
  }

  function renderCategories(tx) {
    const rows = EI.byCategory(tx);
    horizontalBars(
      "category", "categoryChart", "categoryBox",
      rows.map((r) => EI.categoryLabel(r.id)), rows.map((r) => r.total),
      (v) => money0.format(v),
      (i) => money0.format(rows[i].total) + " · " + percent.format(rows[i].share) + " · " + rows[i].count + " עסקאות");
    $("categoryTable").replaceChildren(dataTable(["קטגוריה", "סכום", "חלק", "עסקאות"], rows.map((r) => [EI.categoryLabel(r.id), money0.format(r.total), percent.format(r.share), String(r.count)]), 1));
  }

  function renderMerchants(tx) {
    const top = EI.topMerchants(tx, 10);
    const rows = state.metric === "amount" ? top.byAmount : top.byCount;
    const values = rows.map((r) => (state.metric === "amount" ? r.total : r.count));
    horizontalBars(
      "merchant", "merchantChart", "merchantBox",
      rows.map((r) => r.name), values,
      (v) => (state.metric === "amount" ? money0.format(v) : String(v)),
      (i) => money0.format(rows[i].total) + " · " + rows[i].count + " עסקאות");
    $("merchantTable").replaceChildren(dataTable(["בית עסק", "סכום", "עסקאות"], rows.map((r) => [r.name, money0.format(r.total), String(r.count)]), 1));
  }

  function renderUnusual(tx) {
    const rows = EI.findUnusual(tx);
    const box = $("unusualTable");
    if (!rows.length) {
      box.replaceChildren(el("p", { class: "empty", text: "לא נמצאו הוצאות חריגות." }));
      return;
    }
    box.replaceChildren(dataTable(
      ["תאריך", "בית עסק", "קטגוריה", "סכום", "חציון בקטגוריה", "סטטוס"],
      rows.map((r) => [dateLabel(r.date), r.description, EI.categoryLabel(r.category), money2.format(-r.amount), money2.format(r.baseline),
        el("span", { class: "status" }, el("span", { class: "status-icon", "aria-hidden": "true", text: "▲" }), "חריג")]),
      3));
  }

  function renderRecurring(tx) {
    const rows = EI.findRecurring(tx);
    const box = $("recurringTable");
    if (!rows.length) {
      box.replaceChildren(el("p", { class: "empty", text: "לא נמצאו תשלומים חוזרים." }));
      return;
    }
    const monthlyTotal = rows.reduce((sum, r) => sum + r.monthly, 0);
    box.replaceChildren(
      dataTable(["בית עסק", "קטגוריה", "חודשים", "חודשי", "שנתי"], rows.map((r) => [r.name, EI.categoryLabel(r.category), String(r.months), money2.format(r.monthly), money0.format(r.yearly)]), 2),
      el("p", { class: "hint", text: "סה״כ תשלומים חוזרים: " + money0.format(monthlyTotal) + " בחודש." }));
  }

  function renderTransactions(tx) {
    const query = state.search.trim().toLowerCase();
    const filtered = tx
      .filter((t) => !query || t.description.toLowerCase().includes(query) || EI.categoryLabel(t.category).includes(query) || t.card.toLowerCase().includes(query))
      .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
    const shown = filtered.slice(0, MAX_TABLE_ROWS);
    const rows = shown.map((t) => {
      const select = el("select", { "aria-label": "קטגוריה עבור " + t.description },
        EI.CATEGORIES.map((c) => el("option", { value: c.id, text: c.label, selected: c.id === t.category })));
      select.addEventListener("change", () => {
        state.overrides[t.merchant] = select.value;
        saveOverrides();
        refresh();
      });
      const tags = [];
      if (t.installment) tags.push(el("span", { class: "tag", text: "תשלום " + t.installment.n + "/" + t.installment.of }));
      return [dateLabel(t.date), el("span", {}, t.description, tags), t.card, select, money2.format(-t.amount)];
    });
    const box = $("txTable");
    box.replaceChildren(dataTable(["תאריך", "בית עסק", "כרטיס", "קטגוריה", "סכום"], rows, 4));
    if (filtered.length > shown.length) box.append(el("p", { class: "hint", text: "מוצגות " + shown.length + " מתוך " + filtered.length + " עסקאות. צמצם בעזרת החיפוש או הסינון." }));
  }

  // ---------- events ----------

  function setMetric(metric) {
    state.metric = metric;
    $("metricAmount").setAttribute("aria-pressed", String(metric === "amount"));
    $("metricCount").setAttribute("aria-pressed", String(metric === "count"));
    if (state.all.length) renderMerchants(selectedTransactions());
  }

  function loadDemo() {
    for (const demo of EI.DEMO_FILES) {
      if (state.files.some((f) => f.name === demo.name)) continue;
      const rows = demo.kind === "csv" ? EI.parseCsv(demo.text) : demo.rows;
      const table = EI.detectTable(rows);
      addEntry(demo.name, rows, table, demo.name.replace(/\.[^.]+$/, "") + " (דמו)");
    }
    notify("נטענו נתוני דמו סינתטיים.");
  }

  function exportRules() {
    const blob = new Blob([JSON.stringify(state.overrides, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: "category-overrides.json" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importRules(file) {
    try {
      const imported = sanitizeOverrides(JSON.parse(await file.text()));
      Object.assign(state.overrides, imported);
      saveOverrides();
      refresh();
      notify("יובאו " + Object.keys(imported).length + " שינויי קטגוריה.");
    } catch (error) {
      notify("קובץ השינויים אינו תקין.");
    }
  }

  function init() {
    const input = $("fileInput");
    input.addEventListener("change", () => { addFiles(input.files).then(() => { input.value = ""; }); });
    const zone = $("dropzone");
    for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("is-over"); });
    for (const type of ["dragleave", "drop"]) zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("is-over"); });
    zone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
    $("demoButton").addEventListener("click", loadDemo);
    $("clearButton").addEventListener("click", () => { state.files = []; notify(""); refresh(); });
    $("fromMonth").addEventListener("change", (e) => { state.filters.from = e.target.value; render(); });
    $("toMonth").addEventListener("change", (e) => { state.filters.to = e.target.value; render(); });
    $("metricAmount").addEventListener("click", () => setMetric("amount"));
    $("metricCount").addEventListener("click", () => setMetric("count"));
    $("searchBox").addEventListener("input", (e) => { state.search = e.target.value; if (state.all.length) renderTransactions(selectedTransactions()); });
    $("exportRules").addEventListener("click", exportRules);
    $("importRules").addEventListener("change", (e) => { if (e.target.files[0]) importRules(e.target.files[0]).then(() => { e.target.value = ""; }); });
    $("resetRules").addEventListener("click", () => { state.overrides = {}; saveOverrides(); refresh(); notify("שינויי הקטגוריות אופסו."); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.all.length) render(); });
    refresh();
  }

  init();
})();
