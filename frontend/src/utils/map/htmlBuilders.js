export const escapeHtml = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export function formatTopCategoriesHTML(stats, maxCats = 4) {
  if (!stats || !stats.by_category) return `<div class="text-slate-400">no amenity categories</div>`;
  const entries = Object.entries(stats.by_category).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, maxCats);
  const otherCount = entries.slice(maxCats).reduce((s, [, v]) => s + v, 0);
  const items = top.map(
    ([k, v]) => `<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">${escapeHtml(k)}: ${v}</span>`
  );
  if (otherCount > 0) items.push(`<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">others: ${otherCount}</span>`);
  return `<div class="flex gap-1.5 flex-wrap mt-1">${items.join("")}</div>`;
}

export function buildFloodHoverHtml(props) {
  const dt = escapeHtml(props?.event_date ?? "-");
  const where = escapeHtml(props?.location ?? "-");
  const cause = escapeHtml(props?.event ?? "-");
  const pa = escapeHtml(props?.planning_area ?? "-");
  const sz = escapeHtml(props?.subzone ?? "-");
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">flood event</div>
      <div class="text-slate-300">date: ${dt}</div>
      <div class="text-slate-300">type: ${cause}</div>
      <div class="text-slate-300">location: ${where}</div>
      <div class="text-slate-300">planning area: ${pa}</div>
      <div class="text-slate-300">subzone: ${sz}</div>
    </div>
  `;
}

export function buildHoverMarkupPlanning(props, overallPlanningCountMap, planningCountMap, amenityStatsByPARef) {
  const area = (props?.PLN_AREA_N ?? "").toString().trim();
  const paId = String(props?.PA_ID ?? "-");
  const flood = (overallPlanningCountMap?.[area] ?? planningCountMap?.[area] ?? 0);
  const amen = amenityStatsByPARef.current?.[area];
  const totalAmenities = amen?.total ?? 0;
  const catsHtml = formatTopCategoriesHTML(amen);
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${escapeHtml(area || "unknown planning area")}</div>
      <div class="text-slate-300">pa_id: ${escapeHtml(paId)}</div>
      <div class="mt-1 text-slate-300">flood events: <span class="font-semibold text-white">${flood}</span></div>
      <div class="text-slate-300">amenities: <span class="font-semibold text-white">${totalAmenities}</span></div>
      <div class="mt-1"><div class="text-slate-400 mb-0.5">top categories</div>${catsHtml}</div>
    </div>
  `;
}

export function buildHoverMarkupSubzone(props, subzoneCountMap, amenityStatsBySZRef) {
  const sub = (props?.SUBZONE_N ?? "").toString().trim();
  const area = (props?.PLN_AREA_N ?? "").toString().trim();
  const code = String(props?.SZ_ID ?? "-");
  const flood = (subzoneCountMap?.[sub] ?? 0);
  const amen = amenityStatsBySZRef.current?.[sub];
  const totalAmenities = amen?.total ?? 0;
  const catsHtml = formatTopCategoriesHTML(amen);
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${escapeHtml(sub || "unknown subzone")}</div>
      <div class="text-slate-300">planning area: ${escapeHtml(area || "-")}</div>
      <div class="text-slate-300">sz_id: ${escapeHtml(code)}</div>
      <div class="mt-1 text-slate-300">flood events: <span class="font-semibold text-white">${flood}</span></div>
      <div class="text-slate-300">amenities: <span class="font-semibold text-white">${totalAmenities}</span></div>
      <div class="mt-1"><div class="text-slate-400 mb-0.5">top categories</div>${catsHtml}</div>
    </div>
  `;
}

export function buildAmenityHoverHtml(props) {
  const name = escapeHtml(props?.amenity_name ?? "unknown amenity");
  const category = escapeHtml(props?.amenity_category ?? (props?.amenity_type ?? "-"));
  const type = escapeHtml(props?.amenity_type ?? "-");
  const pa = escapeHtml(props?.planning_area ?? "-");
  const sub = escapeHtml(props?.subzone ?? "-");
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${name}</div>
      <div class="text-slate-300">category: ${category} <span class="text-slate-500">(type: ${type})</span></div>
      <div class="text-slate-300">planning area: ${pa}</div>
      <div class="text-slate-300">subzone: ${sub}</div>
    </div>
  `;
}

export function buildHoverMarkupRoad(props, roadCountMap, paIdToNameRef, amenityStatsByPARef) {
  const rnId = props?.RN_ID ?? props?.RD_CODE ?? "-";
  const rdName = (props?.RD_NAME ?? "").toString().trim() || "-";
  const paId = (props?.PA_ID != null) ? String(props.PA_ID) : null;
  const paName = paId ? (paIdToNameRef.current?.[paId] ?? "-") : "-";
  const roadKey = rnId !== "-" ? rnId : rdName;
  const flood = (roadCountMap?.[roadKey] ?? 0);
  const amen = amenityStatsByPARef.current?.[paName];
  const totalAmenities = amen?.total ?? 0;
  const catsHtml = formatTopCategoriesHTML(amen);
  return `
    <div class="text-xs leading-5">
      <div class="font-semibold text-white">${escapeHtml(rdName)}</div>
      <div class="text-slate-300">rn_id: ${escapeHtml(String(rnId))}</div>
      <div class="text-slate-300">planning area: ${escapeHtml(paName)}</div>
      <div class="mt-1 text-slate-300">flood events (road): <span class="font-semibold text-white">${flood}</span></div>
      <div class="text-slate-300">amenities in pa: <span class="font-semibold text-white">${totalAmenities}</span></div>
      <div class="mt-1"><div class="text-slate-400 mb-0.5">top categories (pa)</div>${catsHtml}</div>
    </div>
  `;
}
