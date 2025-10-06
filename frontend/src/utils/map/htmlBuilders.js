// utils/map/htmlBuilders.js
// Standardized popups with themed "cards" and micro-bar category pills.
// Planning area & subzone show totals + breakdowns for BOTH floods (by event)
// and amenities (by category). Amenity & flood marker popups stay focused on
// a single feature.

export const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// Deterministic per-key color (HSL) so each category keeps a consistent chip color.
function colorForKey(key) {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    bg: `hsl(${hue} 65% 22% / 0.9)`,
    text: `hsl(${hue} 92% 88%)`,
    border: `hsl(${hue} 70% 70% / 0.35)`,
    bar: `hsl(${hue} 75% 55% / 0.85)`,
  };
}

// Render category chips with tiny bars (width = share vs max in that section)
function renderCategoryPills(categoryCounts, emptyText = "no categories") {
  const entries = Object.entries(categoryCounts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<div class="text-slate-400">${escapeHtml(emptyText)}</div>`;
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1);

  const pills = entries.map(([k, v]) => {
    const { bg, text, border, bar } = colorForKey(k || "other");
    const pct = Math.max(8, Math.round((Number(v) || 0) / max * 100)); // ensure minimum visible width
    return `
      <span class="pill" style="background:${bg};color:${text};border-color:${border}" title="${escapeHtml(k)}">
        <span class="pill-label">${escapeHtml(k)}</span>
        <span class="pill-barwrap"><span class="pill-bar" style="width:${pct}%;background:${bar}"></span></span>
        <span class="pill-count">${v}</span>
      </span>`;
  });

  return `<div class="flex gap-1.5 flex-wrap mt-1">${pills.join("")}</div>`;
}

// Soft themed cards per section
const THEMES = {
  planning: { icon: "🗺️", bg: "linear-gradient(180deg, rgba(37,99,235,.18), rgba(15,23,42,.4))", border: "#4f46e5" },
  subzone:  { icon: "📍", bg: "linear-gradient(180deg, rgba(139,92,246,.20), rgba(15,23,42,.4))", border: "#8b5cf6" },
  floods:   { icon: "🌧️", bg: "linear-gradient(180deg, rgba(56,189,248,.20), rgba(15,23,42,.4))", border: "#38bdf8" },
  amenities:{ icon: "🏬", bg: "linear-gradient(180deg, rgba(16,185,129,.20), rgba(15,23,42,.4))", border: "#10b981" },
  road:     { icon: "🛣️", bg: "linear-gradient(180deg, rgba(251,191,36,.22), rgba(15,23,42,.4))", border: "#f59e0b" },
  default:  { icon: "ℹ️", bg: "linear-gradient(180deg, rgba(148,163,184,.18), rgba(15,23,42,.4))", border: "#94a3b8" },
};

function section(title, innerHtml, themeKey = "default") {
  const t = THEMES[themeKey] || THEMES.default;
  return `
    <div class="card mt-2 first:mt-0" style="background:${t.bg};border-color:${t.border}">
      <div class="card-head"><span class="card-ico">${t.icon}</span><span class="section-title">${escapeHtml(title)}</span></div>
      ${innerHtml}
    </div>
  `;
}

/* ---------- single flood point popup ---------- */
export function buildFloodHoverHtml(props) {
  const dt = escapeHtml(props?.event_date ?? "-");
  const where = escapeHtml(props?.location ?? "-");
  const cause = escapeHtml(props?.event ?? "-");
  const pa = escapeHtml(props?.planning_area ?? "-");
  const sz = escapeHtml(props?.subzone ?? "-");

  const body = `
    <div class="kv">date: <strong>${dt}</strong></div>
    <div class="kv">type: <strong>${cause}</strong></div>
    <div class="kv">location: <strong>${where}</strong></div>
    <div class="kv">planning area: <strong>${pa}</strong></div>
    <div class="kv">subzone: <strong>${sz}</strong></div>
  `;
  return section("flood event", body, "floods");
}

/* ---------- planning area popup ---------- */
/**
 * @param {*} props geojson feature props for planning area
 * @param {*} overallPlanningCountMap total floods per PA (overall)
 * @param {*} planningCountMap (scoped) floods per PA
 * @param {*} amenityStatsByPARef ref -> { [paName]: { total, by_category: {cat:count} } }
 * @param {*} floodCatsByPARef   ref -> { [paName]: { total, by_category: {event:count} } }
 */
export function buildHoverMarkupPlanning(
  props,
  overallPlanningCountMap,
  planningCountMap,
  amenityStatsByPARef,
  floodCatsByPARef
) {
  const area = (props?.PLN_AREA_N ?? "").toString().trim();
  const paId = String(props?.PA_ID ?? "-");

  // floods
  const floodTotal = (overallPlanningCountMap?.[area] ?? planningCountMap?.[area] ?? 0);
  const floodCats = floodCatsByPARef?.current?.[area]?.by_category || {};

  // amenities
  const amen = amenityStatsByPARef?.current?.[area];
  const amenTotal = amen?.total ?? 0;
  const amenCats = amen?.by_category || {};

  const headBody = `
    <div class="kv">planning area: <strong>${escapeHtml(area || "unknown")}</strong></div>
    <div class="kv">pa_id: <strong>${escapeHtml(paId)}</strong></div>
  `;
  const head = section("planning area", headBody, "planning");

  const floodsSec = section(
    "no. of floods — breakdown by type",
    `<div class="total-lg">${floodTotal}</div>${renderCategoryPills(floodCats, "no flood types")}`,
    "floods"
  );

  const amenSec = section(
    "no. of amenities — breakdown by category",
    `<div class="total-lg">${amenTotal}</div>${renderCategoryPills(amenCats, "no amenity categories")}`,
    "amenities"
  );

  return `${head}${floodsSec}${amenSec}`;
}

/* ---------- subzone popup ---------- */
/**
 * @param {*} props geojson feature props for subzone
 * @param {*} subzoneCountMap { [subzoneName]: floodsCount }
 * @param {*} amenityStatsBySZRef ref -> { [subzoneName]: { total, by_category: {cat:count} } }
 * @param {*} floodCatsBySZRef    ref -> { [subzoneName]: { total, by_category: {event:count} } }
 */
export function buildHoverMarkupSubzone(props, subzoneCountMap, amenityStatsBySZRef, floodCatsBySZRef) {
  const sub = (props?.SUBZONE_N ?? "").toString().trim();
  const area = (props?.PLN_AREA_N ?? "").toString().trim();
  const code = String(props?.SZ_ID ?? "-");

  // floods
  const floodTotal = (subzoneCountMap?.[sub] ?? 0);
  const floodCats = floodCatsBySZRef?.current?.[sub]?.by_category || {};

  // amenities
  const amen = amenityStatsBySZRef?.current?.[sub];
  const amenTotal = amen?.total ?? 0;
  const amenCats = amen?.by_category || {};

  const headBody = `
    <div class="kv">subzone: <strong>${escapeHtml(sub || "unknown")}</strong></div>
    <div class="kv">planning area: <strong>${escapeHtml(area || "-")}</strong></div>
    <div class="kv">sz_id: <strong>${escapeHtml(code)}</strong></div>
  `;
  const head = section("subzone", headBody, "subzone");

  const floodsSec = section(
    "no. of floods — breakdown by type",
    `<div class="total-lg">${floodTotal}</div>${renderCategoryPills(floodCats, "no flood types")}`,
    "floods"
  );

  const amenSec = section(
    "no. of amenities — breakdown by category",
    `<div class="total-lg">${amenTotal}</div>${renderCategoryPills(amenCats, "no amenity categories")}`,
    "amenities"
  );

  return `${head}${floodsSec}${amenSec}`;
}

/* ---------- amenity point popup ---------- */
export function buildAmenityHoverHtml(props) {
  const name = escapeHtml(props?.amenity_name ?? "unknown amenity");
  const category = escapeHtml(props?.amenity_category ?? (props?.amenity_type ?? "-"));
  const type = escapeHtml(props?.amenity_type ?? "-");
  const pa = escapeHtml(props?.planning_area ?? "-");
  const sub = escapeHtml(props?.subzone ?? "-");

  const body = `
    <div class="kv">name: <strong>${name}</strong></div>
    <div class="kv">category: <strong>${category}</strong> <span class="text-slate-500">(type: ${type})</span></div>
    <div class="kv">planning area: <strong>${pa}</strong></div>
    <div class="kv">subzone: <strong>${sub}</strong></div>
  `;
  return section("amenity", body, "amenities");
}

/* ---------- road segment popup ---------- */
export function buildHoverMarkupRoad(props, roadCountMap, paIdToNameRef, amenityStatsByPARef) {
  const rnId = props?.RN_ID ?? props?.RD_CODE ?? "-";
  const rdName = (props?.RD_NAME ?? "").toString().trim() || "-";
  const paId = (props?.PA_ID != null) ? String(props.PA_ID) : null;
  const paName = paId ? (paIdToNameRef.current?.[paId] ?? "-") : "-";
  const roadKey = rnId !== "-" ? rnId : rdName;
  const flood = (roadCountMap?.[roadKey] ?? 0);
  const amen = amenityStatsByPARef.current?.[paName];
  const totalAmenities = amen?.total ?? 0;
  const amenCats = amen?.by_category || {};

  const head = section(
    "road",
    `
      <div class="kv">name: <strong>${escapeHtml(rdName)}</strong></div>
      <div class="kv">rn_id: <strong>${escapeHtml(String(rnId))}</strong></div>
      <div class="kv">planning area: <strong>${escapeHtml(paName)}</strong></div>
    `,
    "road"
  );

  const floodsSec = section(
    "flood events (road)",
    `<div class="total-lg">${flood}</div>`,
    "floods"
  );

  const amenSec = section(
    "amenities in planning area — breakdown",
    `<div class="total-lg">${totalAmenities}</div>${renderCategoryPills(amenCats, "no amenity categories")}`,
    "amenities"
  );

  return `${head}${floodsSec}${amenSec}`;
}
