const MCW_BRANDS = ["M1", "B1", "K1", "M2", "B2", "B4", "B3", "TK", "B5", "JY"];
const CX_BRANDS = ["CX", "MB", "MP", "JBG", "DZP", "SB", "SLB", "JWAY", "BJD", "KVP", "HBJ"];
const ALL_BRANDS = [...MCW_BRANDS, ...CX_BRANDS];

const DATA_URL = "https://dp-wd-monitor.mdrobiulislam.workers.dev/";
const HISTORY_URL = "data/history.json";

let state = {
  rows: [],
  latest: null,
  history: [],
  rawHistory: [],
  hourlySelectedBrands: [...ALL_BRANDS],
  charts: {}
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn").addEventListener("click", loadDashboard);
  if ($("downloadReportBtn")) $("downloadReportBtn").addEventListener("click", downloadDailyReport);
  $("brandSearch").addEventListener("input", renderTable);
  $("groupFilter").addEventListener("change", renderTable);

  if ($("hourlyDateFilter")) $("hourlyDateFilter").addEventListener("change", renderHourlySection);
  if ($("hourlyMetricFilter")) $("hourlyMetricFilter").addEventListener("change", renderHourlySection);
  if ($("selectAllHourlyBrands")) $("selectAllHourlyBrands").addEventListener("click", () => setHourlyBrands([...ALL_BRANDS]));
  if ($("clearHourlyBrands")) $("clearHourlyBrands").addEventListener("click", () => setHourlyBrands([]));

  loadDashboard();
});

async function loadDashboard() {
  showToast("Refreshing data...");
  try {
    const [latestResult, historyResult] = await Promise.allSettled([
      fetchJson(DATA_URL),
      fetchJson(HISTORY_URL)
    ]);

    if (latestResult.status !== "fulfilled") {
      throw new Error("Could not load live Worker data");
    }

    state.latest = latestResult.value;
    state.rawHistory = historyResult.status === "fulfilled" ? normalizeRawHistory(historyResult.value) : [];
    state.history = normalizeHistory(state.rawHistory);
    state.rows = normalizeLatest(state.latest);
    populateReportDates();

    renderDashboard();
    showToast("Dashboard updated");
  } catch (error) {
    console.error(error);
    $("brandTableBody").innerHTML = `<tr><td colspan="7" class="empty error">Failed to load dashboard data. Check Worker URL or data/latest.json path.</td></tr>`;
    $("lastUpdated").textContent = "Load failed";
    showToast("Data load failed");
  }
}

async function fetchJson(url) {
  const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function normalizeLatest(raw) {
  if (raw?.brands && typeof raw.brands === "object") {
    return ALL_BRANDS.map((brand) => {
      const item = raw.brands[brand] || {};
      const deposit = toNumber(item.deposit_amount);
      const withdrawal = toNumber(item.withdrawal_amount);
      return buildBrandRow(brand, deposit, withdrawal);
    });
  }

  return ALL_BRANDS.map((brand) => buildBrandRow(brand, 0, 0));
}

function pickRoot(raw, keys) {
  if (!raw || typeof raw !== "object") return {};
  for (const key of keys) {
    if (raw[key] !== undefined) return raw[key];
  }
  return raw;
}

function getBrandAmount(root, brand, valueKeys) {
  if (!root) return 0;

  if (Array.isArray(root)) {
    const found = root.find((item) => {
      const code = String(item.brand || item.Brand || item.code || item.name || item.Name || "").trim().toUpperCase();
      return code === brand;
    });
    return found ? extractNumber(found, valueKeys) : 0;
  }

  if (typeof root === "object") {
    const direct = root[brand] ?? root[brand.toLowerCase()] ?? root[brand.toUpperCase()];
    if (typeof direct === "number" || typeof direct === "string") return toNumber(direct);
    if (direct && typeof direct === "object") return extractNumber(direct, valueKeys);

    const values = Object.values(root);
    const arrayLikeMatch = values.find((item) => {
      if (!item || typeof item !== "object") return false;
      const code = String(item.brand || item.Brand || item.code || item.name || item.Name || "").trim().toUpperCase();
      return code === brand;
    });
    return arrayLikeMatch ? extractNumber(arrayLikeMatch, valueKeys) : 0;
  }

  return 0;
}

function extractNumber(obj, preferredKeys) {
  for (const key of preferredKeys) {
    if (obj[key] !== undefined) return toNumber(obj[key]);
    const upperKey = key.toUpperCase();
    const titleKey = key.charAt(0).toUpperCase() + key.slice(1);
    if (obj[upperKey] !== undefined) return toNumber(obj[upperKey]);
    if (obj[titleKey] !== undefined) return toNumber(obj[titleKey]);
  }

  const numericCandidate = Object.values(obj).find((value) => {
    if (typeof value === "number") return true;
    if (typeof value === "string") return /[\d,.]+/.test(value);
    return false;
  });

  return toNumber(numericCandidate);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildBrandRow(brand, deposit, withdrawal) {
  const net = deposit - withdrawal;
  const pressure = deposit > 0 ? withdrawal / deposit : withdrawal > 0 ? 9.99 : 0;
  const group = MCW_BRANDS.includes(brand) ? "MCW" : "CX";

  return {
    brand,
    group,
    deposit,
    withdrawal,
    net,
    pressure,
    risk: getRiskLevel(pressure, net)
  };
}

function getRiskLevel(pressure, net) {
  if (pressure >= 1.1 || net < 0) return "High";
  if (pressure >= 0.8) return "Watch";
  return "Normal";
}

function renderDashboard() {
  const total = sumRows(state.rows);
  const mcw = sumRows(state.rows.filter((r) => r.group === "MCW"));
  const cx = sumRows(state.rows.filter((r) => r.group === "CX"));
  const m1 = state.rows.find((r) => r.brand === "M1") || buildBrandRow("M1", 0, 0);
  const cxBrand = state.rows.find((r) => r.brand === "CX") || buildBrandRow("CX", 0, 0);

  $("lastUpdated").textContent = getLastUpdatedText(state.latest);
  setText("totalDeposit", money(total.deposit));
  setText("totalWithdrawal", money(total.withdrawal));
  setText("netFlow", money(total.net));
  setText("withdrawalPressure", percent(total.pressure));

  setText("mcwDeposit", money(mcw.deposit));
  setText("mcwWithdrawal", money(mcw.withdrawal));
  setText("mcwNet", money(mcw.net));
  setText("mcwPressure", percent(mcw.pressure));

  setText("cxGroupDeposit", money(cx.deposit));
  setText("cxGroupWithdrawal", money(cx.withdrawal));
  setText("cxGroupNet", money(cx.net));
  setText("cxGroupPressure", percent(cx.pressure));

  renderDirectComparison(m1, cxBrand);
  renderRiskList();
  renderTable();
  renderGroupChart(mcw, cx);
  renderBrandNetChart();
  renderTrendChart();
  renderHourlyControls();
  renderHourlySection();
  renderAlertPreview(total);
}

function sumRows(rows) {
  const deposit = rows.reduce((sum, r) => sum + r.deposit, 0);
  const withdrawal = rows.reduce((sum, r) => sum + r.withdrawal, 0);
  const net = deposit - withdrawal;
  const pressure = deposit > 0 ? withdrawal / deposit : 0;
  return { deposit, withdrawal, net, pressure };
}

function renderDirectComparison(m1, cxBrand) {
  setText("m1Deposit", money(m1.deposit));
  setText("m1Withdrawal", money(m1.withdrawal));
  setText("m1Net", money(m1.net));
  setText("m1Pressure", percent(m1.pressure));

  setText("cxDeposit", money(cxBrand.deposit));
  setText("cxWithdrawal", money(cxBrand.withdrawal));
  setText("cxNet", money(cxBrand.net));
  setText("cxPressure", percent(cxBrand.pressure));

  const winner = $("m1CxWinner");
  if (m1.net > cxBrand.net) {
    winner.textContent = "M1 stronger net";
    winner.className = "pill good";
  } else if (cxBrand.net > m1.net) {
    winner.textContent = "CX stronger net";
    winner.className = "pill good";
  } else {
    winner.textContent = "Equal net";
    winner.className = "pill neutral";
  }
}

function renderRiskList() {
  const topRisk = [...state.rows]
    .sort((a, b) => b.pressure - a.pressure || a.net - b.net)
    .slice(0, 5);

  const highCount = state.rows.filter((r) => r.risk === "High").length;
  const riskLevel = $("riskLevel");

  if (highCount > 0) {
    riskLevel.textContent = `${highCount} High Risk`;
    riskLevel.className = "pill danger";
  } else {
    riskLevel.textContent = "Normal";
    riskLevel.className = "pill good";
  }

  $("riskList").innerHTML = topRisk.map((r) => `
    <div class="risk-row">
      <div>
        <strong>${r.brand}</strong>
        <span>${r.group} • Net ${money(r.net)}</span>
      </div>
      <div class="risk-right">
        <strong>${percent(r.pressure)}</strong>
        <span class="risk-tag ${r.risk.toLowerCase()}">${r.risk}</span>
      </div>
    </div>
  `).join("");
}

function renderTable() {
  const search = $("brandSearch").value.trim().toUpperCase();
  const group = $("groupFilter").value;

  const rows = state.rows.filter((r) => {
    const matchSearch = !search || r.brand.includes(search);
    const matchGroup = group === "all" || r.group === group;
    return matchSearch && matchGroup;
  });

  if (!rows.length) {
    $("brandTableBody").innerHTML = `<tr><td colspan="7" class="empty">No brand found.</td></tr>`;
    return;
  }

  $("brandTableBody").innerHTML = rows
    .sort((a, b) => b.deposit - a.deposit)
    .map((r) => `
      <tr>
        <td><strong>${r.brand}</strong></td>
        <td><span class="group-badge ${r.group.toLowerCase()}">${r.group}</span></td>
        <td class="num">${money(r.deposit)}</td>
        <td class="num">${money(r.withdrawal)}</td>
        <td class="num ${r.net < 0 ? "neg" : "pos"}">${money(r.net)}</td>
        <td class="num">${percent(r.pressure)}</td>
        <td><span class="risk-tag ${r.risk.toLowerCase()}">${r.risk}</span></td>
      </tr>
    `).join("");
}

function renderGroupChart(mcw, cx) {
  const ctx = $("groupChart");
  destroyChart("groupChart");

  state.charts.groupChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["MCW", "CX"],
      datasets: [
        { label: "Deposit", data: [mcw.deposit, cx.deposit] },
        { label: "Withdrawal", data: [mcw.withdrawal, cx.withdrawal] }
      ]
    },
    options: chartOptions()
  });
}

function renderBrandNetChart() {
  const ctx = $("brandNetChart");
  destroyChart("brandNetChart");

  const rows = [...state.rows].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 10);

  state.charts.brandNetChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((r) => r.brand),
      datasets: [{ label: "Net Flow", data: rows.map((r) => r.net) }]
    },
    options: chartOptions()
  });
}

function renderTrendChart() {
  const ctx = $("trendChart");
  destroyChart("trendChart");

  const points = state.history.slice(-168);
  const labels = points.map((p) => p.label);
  const deposits = points.map((p) => p.deposit);
  const withdrawals = points.map((p) => p.withdrawal);

  state.charts.trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Deposit", data: deposits, tension: 0.35 },
        { label: "Withdrawal", data: withdrawals, tension: 0.35 }
      ]
    },
    options: chartOptions()
  });
}

function renderHourlyControls() {
  if (!$("hourlyDateFilter") || !$("hourlyBrandPicker")) return;

  const dates = getHourlyDates();
  const dateSelect = $("hourlyDateFilter");
  const currentDate = dateSelect.value;

  dateSelect.innerHTML = dates.map((date) => `<option value="${date}">${date}</option>`).join("");

  if (dates.includes(currentDate)) {
    dateSelect.value = currentDate;
  } else if (dates.length) {
    dateSelect.value = dates[dates.length - 1];
  }

  $("hourlyBrandPicker").innerHTML = ALL_BRANDS.map((brand) => {
    const group = MCW_BRANDS.includes(brand) ? "mcw" : "cx";
    const checked = state.hourlySelectedBrands.includes(brand) ? "checked" : "";
    return `
      <label class="brand-check ${group}">
        <input type="checkbox" value="${brand}" ${checked} />
        <span>${brand}</span>
      </label>
    `;
  }).join("");

  $("hourlyBrandPicker").querySelectorAll("input[type='checkbox']").forEach((box) => {
    box.addEventListener("change", () => {
      state.hourlySelectedBrands = Array.from($("hourlyBrandPicker").querySelectorAll("input[type='checkbox']:checked"))
        .map((input) => input.value);
      renderHourlySection();
    });
  });
}

function setHourlyBrands(brands) {
  state.hourlySelectedBrands = brands;
  if ($("hourlyBrandPicker")) {
    $("hourlyBrandPicker").querySelectorAll("input[type='checkbox']").forEach((box) => {
      box.checked = brands.includes(box.value);
    });
  }
  renderHourlySection();
}

function getHourlyDates() {
  const dates = new Set();
  const deposit = state.latest?.hourly?.deposit || {};
  const withdrawal = state.latest?.hourly?.withdrawal || {};

  for (const source of [deposit, withdrawal]) {
    for (const brand of ALL_BRANDS) {
      Object.keys(source?.[brand] || {}).forEach((date) => dates.add(date));
    }
  }

  return Array.from(dates).sort();
}

function renderHourlySection() {
  if (!$("hourlyTableBody")) return;

  const selectedDate = $("hourlyDateFilter")?.value || getHourlyDates().slice(-1)[0];
  const selectedBrands = state.hourlySelectedBrands.length ? state.hourlySelectedBrands : [];
  const metric = $("hourlyMetricFilter")?.value || "difference";
  const hourlyRows = buildHourlyRows(selectedDate, selectedBrands);

  updateHourlySummary(selectedBrands, selectedDate, metric);
  renderHourlyTable(hourlyRows);
  renderHourlyTrendChart(hourlyRows, metric);
  renderHourlyNetChart(hourlyRows);
}

function buildHourlyRows(date, selectedBrands) {
  if (!date || !selectedBrands.length) return [];

  const hours = new Set();
  const deposit = state.latest?.hourly?.deposit || {};
  const withdrawal = state.latest?.hourly?.withdrawal || {};

  for (const brand of selectedBrands) {
    Object.keys(deposit?.[brand]?.[date] || {}).forEach((hour) => hours.add(hour));
    Object.keys(withdrawal?.[brand]?.[date] || {}).forEach((hour) => hours.add(hour));
  }

  return Array.from(hours).sort().map((hour) => {
    let depositAmount = 0;
    let depositDifference = 0;
    let withdrawalAmount = 0;
    let withdrawalDifference = 0;

    for (const brand of selectedBrands) {
      const dep = deposit?.[brand]?.[date]?.[hour] || {};
      const wd = withdrawal?.[brand]?.[date]?.[hour] || {};

      depositAmount += toNumber(dep.amount);
      depositDifference += toNumber(dep.difference);
      withdrawalAmount += toNumber(wd.amount);
      withdrawalDifference += toNumber(wd.difference);
    }

    return {
      hour,
      depositAmount,
      depositDifference,
      withdrawalAmount,
      withdrawalDifference,
      net: depositAmount - withdrawalAmount,
      netDifference: depositDifference - withdrawalDifference
    };
  });
}

function updateHourlySummary(selectedBrands, selectedDate, metric) {
  if ($("hourlySelectionSummary")) {
    const countText = selectedBrands.length === ALL_BRANDS.length
      ? "All brands selected"
      : `${selectedBrands.length} brand(s) selected`;
    $("hourlySelectionSummary").textContent = `${countText}${selectedDate ? ` • ${selectedDate}` : ""}`;
  }

  if ($("hourlyChartSubtitle")) {
    $("hourlyChartSubtitle").textContent = metric === "amount"
      ? "Amount by selected brands"
      : "Difference by selected brands";
  }
}

function renderHourlyTable(rows) {
  if (!rows.length) {
    $("hourlyTableBody").innerHTML = `<tr><td colspan="6" class="empty">No hourly data for selected date / brands.</td></tr>`;
    return;
  }

  $("hourlyTableBody").innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${row.hour}</strong></td>
      <td class="num">${money(row.depositAmount)}</td>
      <td class="num ${row.depositDifference < 0 ? "neg" : "pos"}">${money(row.depositDifference)}</td>
      <td class="num">${money(row.withdrawalAmount)}</td>
      <td class="num ${row.withdrawalDifference < 0 ? "neg" : "pos"}">${money(row.withdrawalDifference)}</td>
      <td class="num ${row.net < 0 ? "neg" : "pos"}">${money(row.net)}</td>
    </tr>
  `).join("");
}

function renderHourlyTrendChart(rows, metric) {
  const ctx = $("hourlyTrendChart");
  if (!ctx) return;
  destroyChart("hourlyTrendChart");

  const labels = rows.map((row) => row.hour);
  const depositData = rows.map((row) => metric === "amount" ? row.depositAmount : row.depositDifference);
  const withdrawalData = rows.map((row) => metric === "amount" ? row.withdrawalAmount : row.withdrawalDifference);
  const metricLabel = metric === "amount" ? "Amount" : "Difference";

  state.charts.hourlyTrendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: `Deposit ${metricLabel}`, data: depositData, tension: 0.35 },
        { label: `Withdrawal ${metricLabel}`, data: withdrawalData, tension: 0.35 }
      ]
    },
    options: chartOptions()
  });
}

function renderHourlyNetChart(rows) {
  const ctx = $("hourlyNetChart");
  if (!ctx) return;
  destroyChart("hourlyNetChart");

  state.charts.hourlyNetChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map((row) => row.hour),
      datasets: [{ label: "Net Flow", data: rows.map((row) => row.net) }]
    },
    options: chartOptions()
  });
}

function normalizeHistory(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.history) ? raw.history : [];
  return list.map((item, index) => {
    const rows = normalizeLatest(item);
    const total = sumRows(rows);
    return {
      label: getHistoryLabel(item, index),
      deposit: total.deposit,
      withdrawal: total.withdrawal,
      net: total.net
    };
  });
}

function getHistoryLabel(item, index) {
  const rawDate =
    item.updated_at_utc ||
    item.timestamp ||
    item.updated_at ||
    item.created_at ||
    item.time ||
    item.date;

  if (!rawDate) return `Point ${index + 1}`;

  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) return String(rawDate);

  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Singapore",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function renderAlertPreview(total) {
  const items = [];

  if (total.pressure >= 0.9) {
    items.push(`Overall withdrawal pressure is high at ${percent(total.pressure)}.`);
  }

  const highRiskBrands = state.rows.filter((r) => r.risk === "High");
  if (highRiskBrands.length) {
    items.push(`${highRiskBrands.length} brand(s) currently show high risk pressure.`);
  }

  const negativeNet = state.rows.filter((r) => r.net < 0).map((r) => r.brand);
  if (negativeNet.length) {
    items.push(`Negative net flow detected: ${negativeNet.join(", ")}.`);
  }

  if (!items.length) {
    items.push("No critical alert based on current rule preview.");
  }

  $("alertPreview").innerHTML = items.map((text) => `<div class="alert-item">${text}</div>`).join("");
}

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#d9e2ff" } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${money(ctx.raw)}`
        }
      }
    },
    scales: {
      x: { ticks: { color: "#aebbe7" }, grid: { color: "rgba(255,255,255,.06)" } },
      y: { ticks: { color: "#aebbe7", callback: (v) => shortMoney(v) }, grid: { color: "rgba(255,255,255,.06)" } }
    }
  };
}

function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    state.charts[key] = null;
  }
}

function getLastUpdatedText(raw) {
  const value =
    raw?.updated_at_utc ||
    raw?.timestamp ||
    raw?.updated_at ||
    raw?.last_updated ||
    raw?.generated_at;

  if (!value) return "Not available";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }) + " (GMT+8)";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function money(value) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(toNumber(value));
  return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function shortMoney(value) {
  const abs = Math.abs(toNumber(value));
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function percent(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return `${(safe * 100).toFixed(1)}%`;
}

let toastTimer = null;
function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function downloadDailyReport() {
  if (!state.rows || state.rows.length === 0) {
    alert("No data available");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("Excel export library is still loading. Please refresh and try again.");
    return;
  }

  const reportData = getSelectedReportData();
  const selectedDate = reportData.date;
  const snapshot = reportData.snapshot;
  const rows = reportData.rows;

  if (!rows.length) {
    alert("No report data available for selected date");
    return;
  }

  const mcw = sumRows(rows.filter((r) => r.group === "MCW"));
  const cx = sumRows(rows.filter((r) => r.group === "CX"));
  const hourlyRows = buildHourlyReportRows(snapshot, selectedDate);
  const groupHourlyRows = buildGroupHourlyReportRows(hourlyRows);
  const heatmapRows = buildHourlyHeatmapRows(hourlyRows);
  const highRiskBrands = rows
    .filter((r) => r.risk === "High" || r.pressure >= 1)
    .sort((a, b) => b.pressure - a.pressure || a.net - b.net)
    .map((r) => `${r.brand} (${percent(r.pressure)})`)
    .join(" | ") || "None";

  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, "Executive Summary", [
    ["Risk Monitor Daily Report"],
    ["Report Date", selectedDate],
    ["Generated At", getCurrentGMT8Text()],
    ["Data Source", snapshot?.source?.mode || "dashboard"],
    [],
    ["Executive Summary"],
    ["Metric", "MCW", "CX", "Business View"],
    ["Deposit", roundNumber(mcw.deposit), roundNumber(cx.deposit), "Total deposit by rival group"],
    ["Withdrawal", roundNumber(mcw.withdrawal), roundNumber(cx.withdrawal), "Total withdrawal by rival group"],
    ["Net Flow", roundNumber(mcw.net), roundNumber(cx.net), reportFormatNetGap(mcw.net, cx.net)],
    ["Withdrawal Pressure", percent(mcw.pressure), percent(cx.pressure), reportFormatPressureGap(mcw.pressure, cx.pressure)],
    ["Risk Brands", "", "", highRiskBrands],
    [],
    ["Note"],
    ["Pressure = Withdrawal / Deposit. Net Flow = Deposit - Withdrawal. Heatmap values show hourly withdrawal pressure by brand."]
  ]);

  appendSheet(workbook, "Brand Summary", [
    ["Date", "Brand", "Group", "Deposit", "Withdrawal", "Net Flow", "Pressure %", "Risk", "Deposit Difference", "Withdrawal Difference"],
    ...rows
      .slice()
      .sort((a, b) => b.pressure - a.pressure || a.net - b.net)
      .map((r) => [
        selectedDate,
        r.brand,
        r.group,
        roundNumber(r.deposit),
        roundNumber(r.withdrawal),
        roundNumber(r.net),
        roundNumber(r.pressure * 100, 2),
        r.risk,
        roundNumber(r.depositDiff),
        roundNumber(r.withdrawalDiff)
      ])
  ]);

  appendSheet(workbook, "Group Hourly Summary", [
    ["Date", "Hour", "Group", "Deposit Count", "Deposit Amount", "Deposit Difference", "Withdrawal Count", "Withdrawal Amount", "Withdrawal Difference", "Net Flow", "Pressure %", "Risk"],
    ...groupHourlyRows.map((r) => [
      r.date,
      r.hour,
      r.group,
      r.depositCount,
      roundNumber(r.depositAmount),
      roundNumber(r.depositDifference),
      r.withdrawalCount,
      roundNumber(r.withdrawalAmount),
      roundNumber(r.withdrawalDifference),
      roundNumber(r.net),
      roundNumber(r.pressure * 100, 2),
      r.risk
    ])
  ]);

  appendSheet(workbook, "Hourly Brand Details", [
    ["Date", "Hour", "Brand", "Group", "Deposit Count", "Deposit Amount", "Deposit Difference", "Withdrawal Count", "Withdrawal Amount", "Withdrawal Difference", "Net Flow", "Pressure %", "Risk"],
    ...hourlyRows.map((r) => [
      r.date,
      r.hour,
      r.brand,
      r.group,
      r.depositCount,
      roundNumber(r.depositAmount),
      roundNumber(r.depositDifference),
      r.withdrawalCount,
      roundNumber(r.withdrawalAmount),
      roundNumber(r.withdrawalDifference),
      roundNumber(r.net),
      roundNumber(r.pressure * 100, 2),
      r.risk
    ])
  ]);

  appendSheet(workbook, "Hourly Heatmap", [
    ["Hourly Heatmap - Withdrawal Pressure %"],
    ["Date", selectedDate],
    ["Legend", "HIGH = pressure >= 110% or negative net", "WATCH = pressure >= 80%", "NORMAL = below 80%"],
    [],
    ...heatmapRows
  ]);

  XLSX.writeFile(workbook, `risk-monitor-report-${selectedDate}.xlsx`);
  showToast("Excel report downloaded");
}

function getSelectedReportData() {
  const selectedDate = $("reportDateFilter")?.value || getLiveDate();
  const latestDate = getLiveDate();

  if (selectedDate === latestDate) {
    return {
      date: selectedDate,
      snapshot: state.latest,
      rows: state.rows
    };
  }

  const snapshots = (state.rawHistory || [])
    .filter((item) => getItemDate(item) === selectedDate)
    .sort((a, b) => {
      const ta = new Date(a.updated_at_utc || a.date || 0).getTime();
      const tb = new Date(b.updated_at_utc || b.date || 0).getTime();
      return ta - tb;
    });

  const snapshot = snapshots[snapshots.length - 1] || state.latest;

  return {
    date: selectedDate,
    snapshot,
    rows: normalizeLatest(snapshot)
  };
}

function getLiveDate() {
  return state.latest?.date || (state.latest?.updated_at_utc ? String(state.latest.updated_at_utc).slice(0, 10) : new Date().toISOString().slice(0, 10));
}

function getItemDate(item) {
  return item?.date || (item?.updated_at_utc ? String(item.updated_at_utc).slice(0, 10) : "");
}

function buildHourlyReportRows(snapshot, selectedDate) {
  const deposit = snapshot?.hourly?.deposit || {};
  const withdrawal = snapshot?.hourly?.withdrawal || {};
  const rows = [];

  for (const brand of ALL_BRANDS) {
    const group = MCW_BRANDS.includes(brand) ? "MCW" : "CX";
    const hours = new Set([
      ...Object.keys(deposit?.[brand]?.[selectedDate] || {}),
      ...Object.keys(withdrawal?.[brand]?.[selectedDate] || {})
    ]);

    Array.from(hours).sort(compareHourForReport).forEach((hour) => {
      const dep = deposit?.[brand]?.[selectedDate]?.[hour] || {};
      const wd = withdrawal?.[brand]?.[selectedDate]?.[hour] || {};

      const depositCount = toNumber(dep.count);
      const depositAmount = toNumber(dep.amount);
      const depositDifference = toNumber(dep.difference);
      const withdrawalCount = toNumber(wd.count);
      const withdrawalAmount = toNumber(wd.amount);
      const withdrawalDifference = toNumber(wd.difference);

      const hasRealData = depositCount !== 0 || depositAmount !== 0 || withdrawalCount !== 0 || withdrawalAmount !== 0 || depositDifference !== 0 || withdrawalDifference !== 0;
      if (!hasRealData) return;

      const net = depositAmount - withdrawalAmount;
      const pressure = depositAmount > 0 ? withdrawalAmount / depositAmount : withdrawalAmount > 0 ? 9.99 : 0;

      rows.push({
        date: selectedDate,
        hour,
        brand,
        group,
        depositCount,
        depositAmount,
        depositDifference,
        withdrawalCount,
        withdrawalAmount,
        withdrawalDifference,
        net,
        pressure,
        risk: getRiskLevel(pressure, net)
      });
    });
  }

  return rows.sort((a, b) => compareHourForReport(a.hour, b.hour) || a.group.localeCompare(b.group) || a.brand.localeCompare(b.brand));
}

function buildGroupHourlyReportRows(hourlyRows) {
  const grouped = new Map();

  hourlyRows.forEach((row) => {
    const key = `${row.date}|${row.hour}|${row.group}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        date: row.date,
        hour: row.hour,
        group: row.group,
        depositCount: 0,
        depositAmount: 0,
        depositDifference: 0,
        withdrawalCount: 0,
        withdrawalAmount: 0,
        withdrawalDifference: 0
      });
    }

    const item = grouped.get(key);
    item.depositCount += row.depositCount;
    item.depositAmount += row.depositAmount;
    item.depositDifference += row.depositDifference;
    item.withdrawalCount += row.withdrawalCount;
    item.withdrawalAmount += row.withdrawalAmount;
    item.withdrawalDifference += row.withdrawalDifference;
  });

  return Array.from(grouped.values()).map((item) => {
    const net = item.depositAmount - item.withdrawalAmount;
    const pressure = item.depositAmount > 0 ? item.withdrawalAmount / item.depositAmount : item.withdrawalAmount > 0 ? 9.99 : 0;
    return {
      ...item,
      net,
      pressure,
      risk: getRiskLevel(pressure, net)
    };
  }).sort((a, b) => compareHourForReport(a.hour, b.hour) || a.group.localeCompare(b.group));
}

function buildHourlyHeatmapRows(hourlyRows) {
  const hours = Array.from(new Set(hourlyRows.map((row) => row.hour))).sort(compareHourForReport);
  const byBrand = new Map();

  hourlyRows.forEach((row) => {
    if (!byBrand.has(row.brand)) byBrand.set(row.brand, { group: row.group, hours: {} });
    byBrand.get(row.brand).hours[row.hour] = row;
  });

  const rows = [["Brand", "Group", ...hours]];

  ALL_BRANDS.forEach((brand) => {
    const item = byBrand.get(brand);
    if (!item) return;

    rows.push([
      brand,
      item.group,
      ...hours.map((hour) => {
        const row = item.hours[hour];
        if (!row) return "";
        return `${row.risk} ${roundNumber(row.pressure * 100, 1)}%`;
      })
    ]);
  });

  return rows;
}

function compareHourForReport(a, b) {
  const [ah, am] = String(a).split(":").map(Number);
  const [bh, bm] = String(b).split(":").map(Number);
  return (ah || 0) - (bh || 0) || (am || 0) - (bm || 0);
}

function roundNumber(value, digits = 0) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function getCurrentGMT8Text() {
  return new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }) + " (GMT+8)";
}

function reportFormatNetGap(mcwNet, cxNet) {
  const gap = toNumber(mcwNet) - toNumber(cxNet);
  if (gap > 0) return `MCW +${money(gap)}`;
  if (gap < 0) return `CX +${money(Math.abs(gap))}`;
  return "Equal";
}

function reportFormatPressureGap(mcwPressure, cxPressure) {
  const gap = toNumber(mcwPressure) - toNumber(cxPressure);
  const points = Math.abs(gap * 100).toFixed(1);
  if (gap > 0) return `MCW Higher Withdrawal Pressure +${points}%`;
  if (gap < 0) return `CX Higher Withdrawal Pressure +${points}%`;
  return "Balanced Pressure";
}

function appendSheet(workbook, sheetName, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = getColumnWidths(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
}

function getColumnWidths(rows) {
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: maxColumns }, (_, index) => {
    const maxLength = rows.reduce((max, row) => {
      const value = row[index] === undefined || row[index] === null ? "" : String(row[index]);
      return Math.max(max, Math.min(value.length + 2, 40));
    }, 10);
    return { wch: maxLength };
  });
}

function populateReportDates() {
  const select = $("reportDateFilter");
  if (!select) return;

  const currentValue = select.value;
  const dates = new Set();

  const liveDate = getLiveDate();
  if (liveDate) dates.add(liveDate);

  (state.rawHistory || []).forEach((item) => {
    const date = getItemDate(item);
    if (date) dates.add(date);
  });

  const sortedDates = Array.from(dates).sort().reverse();
  select.innerHTML = sortedDates.map((date) => `<option value="${date}">${date}</option>`).join("");

  if (sortedDates.includes(currentValue)) {
    select.value = currentValue;
  } else if (sortedDates.includes(liveDate)) {
    select.value = liveDate;
  } else if (sortedDates.length) {
    select.value = sortedDates[0];
  }
}
