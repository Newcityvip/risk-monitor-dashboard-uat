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
      return buildBrandRow(brand, deposit, withdrawal, {
        depositDiff: toNumber(item.deposit_difference),
        withdrawalDiff: toNumber(item.withdrawal_difference)
      });
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

function buildBrandRow(brand, deposit, withdrawal, extra = {}) {
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
    depositDiff: toNumber(extra.depositDiff),
    withdrawalDiff: toNumber(extra.withdrawalDiff),
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

  const previousRows = getPreviousRows();
  const prevMcw = previousRows.length ? sumRows(previousRows.filter((r) => r.group === "MCW")) : null;
  const prevCx = previousRows.length ? sumRows(previousRows.filter((r) => r.group === "CX")) : null;

  // Overview is a Rival Snapshot now.
  // We do NOT combine MCW + CX here, because they are rival groups.
  // The top cards show MCW net, CX net, net advantage, and pressure gap.
  setMetric("totalDeposit", money(mcw.net), trendBadge(mcw.net, prevMcw?.net, "money"));
  setMetric("totalWithdrawal", money(cx.net), trendBadge(cx.net, prevCx?.net, "money"));
  setMetric("netFlow", formatNetGap(mcw.net, cx.net), trendBadge(mcw.net - cx.net, prevMcw && prevCx ? prevMcw.net - prevCx.net : null, "money"));
  setMetric("withdrawalPressure", formatPressureGap(mcw.pressure, cx.pressure), trendBadge(mcw.pressure - cx.pressure, prevMcw && prevCx ? prevMcw.pressure - prevCx.pressure : null, "pp"));

  setMetric("mcwDeposit", money(mcw.deposit), trendBadge(mcw.deposit, prevMcw?.deposit, "money"));
  setMetric("mcwWithdrawal", money(mcw.withdrawal), trendBadge(mcw.withdrawal, prevMcw?.withdrawal, "money"));
  setMetric("mcwNet", money(mcw.net), trendBadge(mcw.net, prevMcw?.net, "money"));
  setMetric("mcwPressure", percent(mcw.pressure), trendBadge(mcw.pressure, prevMcw?.pressure, "pp"));

  setMetric("cxGroupDeposit", money(cx.deposit), trendBadge(cx.deposit, prevCx?.deposit, "money"));
  setMetric("cxGroupWithdrawal", money(cx.withdrawal), trendBadge(cx.withdrawal, prevCx?.withdrawal, "money"));
  setMetric("cxGroupNet", money(cx.net), trendBadge(cx.net, prevCx?.net, "money"));
  setMetric("cxGroupPressure", percent(cx.pressure), trendBadge(cx.pressure, prevCx?.pressure, "pp"));

  renderDirectComparison(m1, cxBrand);
  renderRiskList();
  renderExecutiveAlert(mcw, cx);
  renderRiskMomentum();
  renderRiskDrivers(mcw, cx);
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

function formatNetGap(mcwNet, cxNet) {
  const gap = toNumber(mcwNet) - toNumber(cxNet);
  if (gap > 0) return `MCW +${money(gap)}`;
  if (gap < 0) return `CX +${money(Math.abs(gap))}`;
  return "Equal";
}

function formatPressureGap(mcwPressure, cxPressure) {
  const gap = toNumber(mcwPressure) - toNumber(cxPressure);
  const points = Math.abs(gap * 100).toFixed(1);
  if (gap > 0) return `MCW Higher Withdrawal Pressure +${points}%`;
if (gap < 0) return `CX Higher Withdrawal Pressure +${points}%`;
  return "Balanced Pressure";
}

function formatPressureDifference(value) {
  const points = Math.abs(toNumber(value) * 100).toFixed(1);
  if (value > 0) return `+${points}% higher`;
  if (value < 0) return `-${points}% lower`;
  return "";
}
function renderExecutiveAlert(mcw, cx) {
  const pressureGap = cx.pressure - mcw.pressure;
  const pressureLeader = pressureGap > 0 ? "CX" : pressureGap < 0 ? "MCW" : "Balanced";
  const pressureText = pressureLeader === "Balanced"
  ? "Balanced withdrawal pressure"
  : `${pressureLeader} withdrawal pressure ${formatPressureDifference(pressureGap)} ${pressureLeader === "CX" ? "than MCW" : "than CX"}`;

  const netGap = mcw.net - cx.net;
  const netWinner = netGap >= 0 ? "MCW" : "CX";
  const riskBrands = [...state.rows]
    .filter((r) => r.risk === "High" || r.pressure >= 1)
    .sort((a, b) => b.pressure - a.pressure || a.net - b.net)
    .slice(0, 3);

  const headline = pressureLeader === "Balanced"
    ? `${netWinner} leading • Stable pressure`
: `${pressureLeader} risk higher • ${netWinner} stronger net`;
  const subline = riskBrands.length
    ? `Watch brands: ${riskBrands.map((r) => `${r.brand} ${percent(r.pressure)}`).join(" • ")}`
    : "No critical pressure spike detected from current live rules.";

  setText("alertHeadline", headline);
  setText("alertSubline", subline);
  setText("alertNetAdvantage", formatNetGap(mcw.net, cx.net));
  setText("alertPressureLeader", `${pressureLeader} higher pressure ${formatSignedPercentPoint(pressureGap)}`);
  setText("alertRiskBrands", riskBrands.length ? riskBrands.map((r) => r.brand).join(", ") : "None");

  const totalDeposit = mcw.deposit + cx.deposit;
  const mcwShare = totalDeposit > 0 ? (mcw.deposit / totalDeposit) * 100 : 50;
  const cxShare = 100 - mcwShare;
  setText("mcwShareLabel", `MCW ${mcwShare.toFixed(1)}% deposit share`);
  setText("cxShareLabel", `CX ${cxShare.toFixed(1)}% deposit share`);
  const mcwBar = $("mcwDominanceBar");
  const cxBar = $("cxDominanceBar");
  if (mcwBar) mcwBar.style.width = `${Math.max(8, mcwShare)}%`;
  if (cxBar) cxBar.style.width = `${Math.max(8, cxShare)}%`;

  const alert = $("executiveAlert");
  if (alert) {
    alert.classList.remove("alert-high", "alert-watch", "alert-normal");
    alert.classList.add(riskBrands.length ? "alert-high" : Math.max(mcw.pressure, cx.pressure) >= 0.8 ? "alert-watch" : "alert-normal");
  }
}

function renderRiskMomentum() {
  if (!$("riskMomentumList")) return;

  const recentSnapshots = state.rawHistory.slice(-4, -1).map((item) => normalizeLatest(item));

  const momentumRows = state.rows.map((row) => {
    const recent = recentSnapshots
      .map((snapshot) => snapshot.find((r) => r.brand === row.brand)?.pressure)
      .filter((value) => Number.isFinite(value));

    const avgPressure = recent.length
      ? recent.reduce((sum, value) => sum + value, 0) / recent.length
      : row.pressure;

    const momentum = row.pressure - avgPressure;
    return { ...row, momentum };
  }).sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum) || b.pressure - a.pressure).slice(0, 6);

  $("riskMomentumList").innerHTML = momentumRows.map((r) => {
    const label = getMomentumLabel(r.momentum);
    const movementText = formatSignedPercentPoint(r.momentum);

    return `
      <div class="signal-row">
        <div>
          <strong>${r.brand}</strong>
          <span>${r.group} • Current ${percent(r.pressure)} • ${label.text}</span>
        </div>
        <div class="signal-right ${label.className}">
          <strong>${movementText || "Stable"}</strong>
          <small>${r.risk}</small>
        </div>
      </div>
    `;
  }).join("");
}

function renderRiskDrivers(mcw, cx) {
  if (!$("riskDriversList")) return;
  const drivers = [];

  const highPressure = [...state.rows].sort((a, b) => b.pressure - a.pressure).slice(0, 1)[0];
  if (highPressure) drivers.push({
    title: `${highPressure.brand} highest pressure`,
    body: `${percent(highPressure.pressure)} withdrawal pressure • Net ${money(highPressure.net)}`,
    level: highPressure.pressure >= 1 ? "danger" : highPressure.pressure >= 0.8 ? "warn" : "good"
  });

  const wdSpike = [...state.rows].sort((a, b) => b.withdrawalDiff - a.withdrawalDiff).slice(0, 1)[0];
  if (wdSpike && wdSpike.withdrawalDiff > 0) drivers.push({
    title: `${wdSpike.brand} withdrawal spike`,
    body: `Withdrawal change +${money(wdSpike.withdrawalDiff)} from source difference`,
    level: "warn"
  });

  const weakDeposit = [...state.rows].filter((r) => r.depositDiff < 0).sort((a, b) => a.depositDiff - b.depositDiff).slice(0, 1)[0];
  if (weakDeposit) drivers.push({
    title: `${weakDeposit.brand} deposit weakness`,
    body: `Deposit change ${money(weakDeposit.depositDiff)} from source difference`,
    level: "warn"
  });

  drivers.push({
    title: "Group pressure gap",
    body: formatPressureGap(mcw.pressure, cx.pressure),
    level: Math.max(mcw.pressure, cx.pressure) >= 1 ? "danger" : "good"
  });

  $("riskDriversList").innerHTML = drivers.slice(0, 5).map((item) => `
    <div class="signal-row">
      <div>
        <strong>${item.title}</strong>
        <span>${item.body}</span>
      </div>
      <span class="driver-dot ${item.level}"></span>
    </div>
  `).join("");
}

function getMomentumLabel(momentum) {
  if (momentum >= 0.10) return { text: "High Risk", className: "bad" };
  if (momentum >= 0.03) return { text: "Increasing Risk", className: "warn" };
  if (momentum <= -0.03) return { text: "Improving", className: "good" };
  return { text: "Stable", className: "neutral" };
}

function formatSignedPercentPoint(value) {
  const points = Math.abs(toNumber(value) * 100).toFixed(1);
  if (value > 0) return `+${points}pp`;
  if (value < 0) return `-${points}pp`;
  return "";
}

function getPreviousRows() {
  if (!state.rawHistory.length) return [];
  const latestTime = getSnapshotTime(state.latest);
  const candidates = state.rawHistory.filter((item) => {
    const time = getSnapshotTime(item);
    return !latestTime || !time || time < latestTime;
  });
  const snapshot = candidates.length ? candidates[candidates.length - 1] : state.rawHistory[state.rawHistory.length - 2];
  return snapshot ? normalizeLatest(snapshot) : [];
}

function getSnapshotTime(item) {
  const raw = item?.updated_at_utc || item?.timestamp || item?.updated_at || item?.created_at || item?.time || item?.date;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
}

function trendBadge(current, previous, type = "money") {
  if (previous === null || previous === undefined || !Number.isFinite(Number(previous))) return "";
  const diff = toNumber(current) - toNumber(previous);
  if (Math.abs(diff) < 0.000001) return `<span class="trend-badge flat">→ No change</span>`;
  const arrow = diff > 0 ? "↑" : "↓";
  const text = type === "pp" ? formatPressureDifference(diff) : `${diff > 0 ? "+" : ""}${money(diff)}`;
  return `<span class="trend-badge ${diff > 0 ? "up" : "down"}">${arrow} ${text}</span>`;
}

function setMetric(id, value, trendHtml = "") {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `${value}${trendHtml || ""}`;
}

function normalizeRawHistory(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.history)) return raw.history;
  return [];
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
