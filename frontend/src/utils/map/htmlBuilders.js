// utils/map/htmlbuilders.js
// standardized popups: planning area & subzone show totals + full breakdowns for BOTH floods (by event) and amenities (by category).
// amenity marker & flood marker popups remain focused on a single feature.

export const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// deterministic per-key color (hsl) so each category has a consistent chip color
function colorForKey(key) {
  let h = 0;
  for (let i = 0; i < String(key).length; i++) h = (h * 31 + String(key).charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return {
    bg: `hsl(${hue} 65% 22% / 0.9)`,
    text: `hsl(${hue} 92% 88%)`,
    border: `hsl(${hue} 70% 70% / 0.35)`,
  };
}

function renderCategoryPills(categoryCounts, emptyText = "no categories") {
  const entries = Object.entries(categoryCounts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<div class="text-slate-400">${escapeHtml(emptyText)}</div>`;
  const pills = entries.map(([k, v]) => {
    const { bg, text, border } = colorForKey(k || "other");
    return `
      <span class="px-1.5 py-0.5 rounded border text-[11px]" style="background:${bg};color:${text};border-color:${border}" title="${escapeHtml(k)}">
        ${escapeHtml(k)}: <strong>${v}</strong>
      </span>`;
  });
  return `<div class="flex gap-1.5 flex-wrap mt-1">${pills.join("")}</div>`;
}

function section(title, innerHtml) {
  return `
    <div class="mt-2 first:mt-0">
      <div class="section-title">${escapeHtml(title)}</div>
      ${innerHtml}
    </div>
  `;
}

/* ---------- single flood point popup (unchanged, just tidied) ---------- */
export function buildFloodHoverHtml(props) {
  const dt = escapeHtml(props?.event_date ?? "-");
  const where = escapeHtml(props?.location ?? "-");
  const cause = escapeHtml(props?.event ?? "-");
  const pa = escapeHtml(props?.planning_area ?? "-");
  const sz = escapeHtml(props?.subzone ?? "-");
  return `
    <div class="text-xs leading-5">
      <div class="section-title">flood event</div>
      <div class="kv">date: <strong>${dt}</strong></div>
      <div class="kv">type: <strong>${cause}</strong></div>
      <div class="kv">location: <strong>${where}</strong></div>
      <div class="kv">planning area: <strong>${pa}</strong></div>
      <div class="kv">subzone: <strong>${sz}</strong></div>
    </div>
  `;
}

/* ---------- planning area popup ---------- */
/**
 * @param {*} props geojson feature props for planning area
 * @param {*} overallPlanningCountMap total floods per PA (overall)
 * @param {*} planningCountMap (scoped) floods per PA
 * @param {*} amenityStatsByPARef ref -> { [paName]: { total, by_category: {cat:count} } }
 * @param {*} floodCatsByPARef   ref -> { [paName]: { total, by_category: {event:count} } }
 */
export function buildHoverMarkupPlanning(props, overallPlanningCountMap, planningCountMap, amenityStatsByPARef, floodCatsByPARef) {
  const area = (props?.PLN_AREA_N ?? "").toString().trim();
  const paId = String(props?.PA_ID ?? "-");

  // floods
  const floodTotal = (overallPlanningCountMap?.[area] ?? planningCountMap?.[area] ?? 0);
  const floodCats = floodCatsByPARef?.current?.[area]?.by_category || {};

  // amenities
  const amen = amenityStatsByPARef?.current?.[area];
  const amenTotal = amen?.total ?? 0;
  const amenCats = amen?.by_category || {};

  const head = `
    <div class="text-xs leading-5">
      <div class="section-title">planning area</div>
      <div class="kv">planning area: <strong>${escapeHtml(area || "unknown")}</strong></div>
      <div class="kv">pa_id: <strong>${escapeHtml(paId)}</strong></div>
    </div>
  `;

  const floodsSec = section(
    "no. of floods — breakdown by type",
    `<div class="kv">total: <strong>${floodTotal}</strong></div>${renderCategoryPills(floodCats, "no flood types")}`
  );

  const amenSec = section(
    "no. of amenities — breakdown by category",
    `<div class="kv">total: <strong>${amenTotal}</strong></div>${renderCategoryPills(amenCats, "no amenity categories")}`
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

  const head = `
    <div class="text-xs leading-5">
      <div class="section-title">subzone</div>
      <div class="kv">subzone: <strong>${escapeHtml(sub || "unknown")}</strong></div>
      <div class="kv">planning area: <strong>${escapeHtml(area || "-")}</strong></div>
      <div class="kv">sz_id: <strong>${escapeHtml(code)}</strong></div>
    </div>
  `;

  const floodsSec = section(
    "no. of floods — breakdown by type",
    `<div class="kv">total: <strong>${floodTotal}</strong></div>${renderCategoryPills(floodCats, "no flood types")}`
  );

  const amenSec = section(
    "no. of amenities — breakdown by category",
    `<div class="kv">total: <strong>${amenTotal}</strong></div>${renderCategoryPills(amenCats, "no amenity categories")}`
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
  return `
    <div class="text-xs leading-5">
      <div class="section-title">amenity</div>
      <div class="kv">name: <strong>${name}</strong></div>
      <div class="kv">category: <strong>${category}</strong> <span class="text-slate-500">(type: ${type})</span></div>
      <div class="kv">planning area: <strong>${pa}</strong></div>
      <div class="kv">subzone: <strong>${sub}</strong></div>
    </div>
  `;
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

  const head = `
    <div class="text-xs leading-5">
      <div class="section-title">road</div>
      <div class="kv">name: <strong>${escapeHtml(rdName)}</strong></div>
      <div class="kv">rn_id: <strong>${escapeHtml(String(rnId))}</strong></div>
      <div class="kv">planning area: <strong>${escapeHtml(paName)}</strong></div>
    </div>
  `;

  const floodsSec = section(
    "flood events (road)",
    `<div class="kv">total: <strong>${flood}</strong></div>`
  );

  const amenSec = section(
    "amenities in planning area — breakdown",
    `<div class="kv">total: <strong>${totalAmenities}</strong></div>${renderCategoryPills(amenCats, "no amenity categories")}`
  );

  return `${head}${floodsSec}${amenSec}`;
}
