// src/lib/simulation/metrics.js
/**
 * Metrics calculation and visualization utilities
 */

/**
 * Format time in seconds to minutes and seconds
 */
export function fmtTime(s) {
  if (!Number.isFinite(s)) return "—";
  const minutes = (s / 60).toFixed(1);
  const seconds = Math.round(s);
  return `${minutes}m (${seconds}s)`;
}

/**
 * Format time in seconds to minutes only
 */
export function fmtM(s) {
  return Number.isFinite(s) ? (s / 60).toFixed(1) + "m" : "—";
}

/**
 * Capitalize words in a string
 */
export function capitalizeWords(str) {
  return str.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Get color for choropleth based on metric value
 * @param {number} value - Metric value
 * @param {number} maxValue - Maximum value for normalization
 * @param {boolean} isBaseline - Whether this is baseline data (affects color scheme)
 * @returns {string} - Hex color code
 */
export function getColorForValue(value, maxValue, isBaseline = false) {
  if (!Number.isFinite(value) || value <= 0) return "#d1d5db"; // Gray for no data

  if (isBaseline) {
    // Baseline: green (low time) to blue (high time)
    const ratio = Math.min(1, value / maxValue);
    if (ratio < 0.25) return "#86efac"; // green-300
    if (ratio < 0.5) return "#60a5fa";  // blue-400
    if (ratio < 0.75) return "#3b82f6"; // blue-500
    return "#1d4ed8"; // blue-700
  } else {
    // Delta: green (low increase) to red (high increase)
    const ratio = Math.min(1, value / maxValue);
    if (ratio < 0.25) return "#86efac"; // green-300
    if (ratio < 0.5) return "#fde047";  // yellow-300
    if (ratio < 0.75) return "#fb923c"; // orange-400
    return "#ef4444"; // red-500
  }
}

/**
 * Get color for golden time metric
 * @param {number} value - Travel time value
 * @param {number} goldenTime - Target golden time
 * @returns {string} - Hex color code
 */
export function getColorForGoldenTime(value, goldenTime) {
  if (!Number.isFinite(value)) return "#d1d5db"; // Gray for unreachable

  if (value <= goldenTime) {
    return "#22c55e"; // Green - within target
  }

  const excess = (value - goldenTime) / goldenTime;
  if (excess <= 0.25) return "#fbbf24"; // Yellow - slightly over (0-25%)
  if (excess <= 0.5) return "#fb923c";  // Orange - moderately over (25-50%)
  return "#ef4444"; // Red - significantly over (>50%)
}

/**
 * Get color for unreachable nodes metric
 * @param {number} count - Number of unreachable nodes
 * @returns {string} - Hex color code
 */
export function getColorForUnreachable(count) {
  if (count === 0) return "#86efac"; // green-300
  if (count <= 5) return "#fde047";  // yellow-300
  if (count <= 15) return "#fb923c"; // orange-400
  return "#ef4444"; // red-500
}

/**
 * Calculate planning area deltas between baseline and flooded scenarios
 * @param {Array} baselineStats - Baseline PA stats
 * @param {Array} floodedStats - Flooded PA stats
 * @param {Map} affectedByPA - Affected nodes count by PA
 * @param {Map} unreachableByPA - Unreachable nodes count by PA (from flooded scenario)
 * @returns {Array} - Array of PA delta objects
 */
export function calculatePADeltas(baselineStats, floodedStats, affectedByPA = new Map(), unreachableByPA = new Map()) {
  const deltas = [];

  for (const base of baselineStats) {
    const flood = floodedStats.find(f => f.pa_id === base.pa_id);
    if (!flood) continue;

    const delta_avg_s = Number.isFinite(flood.avg_s) && Number.isFinite(base.avg_s)
      ? flood.avg_s - base.avg_s
      : null;

    const delta_max_s = Number.isFinite(flood.max_s) && Number.isFinite(base.max_s)
      ? flood.max_s - base.max_s
      : null;

    const delta_unreachable = flood.unreachable - base.unreachable;

    // Calculate percentage increases
    const pct_avg_increase = Number.isFinite(base.avg_s) && base.avg_s > 0 && Number.isFinite(delta_avg_s)
      ? (delta_avg_s / base.avg_s) * 100
      : null;

    const pct_max_increase = Number.isFinite(base.max_s) && base.max_s > 0 && Number.isFinite(delta_max_s)
      ? (delta_max_s / base.max_s) * 100
      : null;

    const pct_unreachable = base.nodes > 0
      ? (flood.unreachable / base.nodes) * 100
      : null;

    deltas.push({
      pa_id: base.pa_id,
      pa_name: base.pa_name,
      total_nodes: base.nodes,

      // Baseline stats
      base_avg_s: base.avg_s,
      base_min_s: base.min_s,
      base_max_s: base.max_s,
      base_unreachable: base.unreachable,

      // Flooded stats
      flood_avg_s: flood.avg_s,
      flood_min_s: flood.min_s,
      flood_max_s: flood.max_s,
      flood_unreachable: flood.unreachable,

      // Deltas
      delta_avg_s,
      delta_max_s,
      delta_unreachable,

      // Percentage changes
      pct_avg_increase,
      pct_max_increase,
      pct_unreachable,

      // Node-level metrics
      affected_nodes: affectedByPA.get(base.pa_id) || 0,
      unreachable_nodes: unreachableByPA.get(base.pa_id) || 0,
    });
  }

  return deltas;
}

/**
 * CSV export utilities
 */
export function toCSV(arr) {
  if (!arr?.length) return "";
  const headers = Object.keys(arr[0]);
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"','""')}"` : String(v));
  const lines = [headers.join(",")];
  for (const obj of arr) lines.push(headers.map(h => esc(obj[h])).join(","));
  return lines.join("\n");
}

export function downloadCSV(name, rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
