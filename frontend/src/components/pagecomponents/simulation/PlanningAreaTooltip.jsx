// src/components/pagecomponents/simulation/PlanningAreaTooltip.jsx
/**
 * Planning Area Tooltip Component
 * Shows comprehensive planning area metrics
 */

import { fmtTime, fmtM } from "@/lib/simulation/metrics";

/**
 * Generate HTML for planning area hover tooltip
 * @param {Object} paData - Planning area data with metrics
 * @returns {string} - HTML string for tooltip
 */
export function generatePlanningAreaTooltipHTML(paData) {
  const {
    pa_name,
    total_nodes,
    base_avg_s,
    base_min_s,
    base_max_s,
    base_unreachable,
    flood_avg_s,
    flood_min_s,
    flood_max_s,
    flood_unreachable,
    delta_avg_s,
    delta_max_s,
    pct_avg_increase,
    pct_max_increase,
  } = paData;

  // Calculate min delta and percentage
  const delta_min_s = Number.isFinite(flood_min_s) && Number.isFinite(base_min_s)
    ? flood_min_s - base_min_s
    : null;
  const pct_min_increase = Number.isFinite(base_min_s) && base_min_s > 0 && Number.isFinite(delta_min_s)
    ? (delta_min_s / base_min_s) * 100
    : null;

  // Calculate reachable nodes
  const base_reachable = total_nodes - (base_unreachable || 0);
  const flood_reachable = total_nodes - (flood_unreachable || 0);
  const delta_reachable = flood_reachable - base_reachable;
  const pct_reachable_change = base_reachable > 0 ? (delta_reachable / base_reachable) * 100 : 0;

  // Helper function to format change with color
  const formatChange = (delta, pct, isNegativeGood = false) => {
    if (!Number.isFinite(delta) || !Number.isFinite(pct)) return '';
    const sign = delta > 0 ? '+' : '';
    const color = isNegativeGood
      ? (delta < 0 ? '#22c55e' : delta > 0 ? '#ef4444' : '#9ca3af')
      : (delta > 0 ? '#fbbf24' : delta < 0 ? '#22c55e' : '#9ca3af');
    return `<span style="color: ${color}; font-weight: 600;">(${sign}${fmtTime(delta)}, ${sign}${pct.toFixed(1)}%)</span>`;
  };

  const formatReachableChange = (delta, pct) => {
    if (!Number.isFinite(delta)) return '';
    const sign = delta > 0 ? '+' : '';
    const color = delta < 0 ? '#ef4444' : delta > 0 ? '#22c55e' : '#9ca3af';
    return `<span style="color: ${color}; font-weight: 600;">(${sign}${delta}, ${sign}${pct.toFixed(1)}%)</span>`;
  };

  const html = `
    <div style="background: #1f2937; color: #fff; padding: 12px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); min-width: 300px;">
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 10px; color: #f9fafb;">${pa_name}</div>

      <div style="border-top: 1px solid #4b5563; padding-top: 8px;">
        <!-- Travel Time Stats -->
        <div style="font-size: 11px; margin-bottom: 4px;">
          <div style="color: #9ca3af;">Min Travel Time:</div>
          <div style="color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
            ${fmtTime(base_min_s)} → ${fmtTime(flood_min_s)} ${formatChange(delta_min_s, pct_min_increase)}
          </div>
        </div>

        <div style="font-size: 11px; margin-bottom: 4px;">
          <div style="color: #9ca3af;">Max Travel Time:</div>
          <div style="color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
            ${fmtTime(base_max_s)} → ${fmtTime(flood_max_s)} ${formatChange(delta_max_s, pct_max_increase)}
          </div>
        </div>

        <div style="font-size: 11px; margin-bottom: 4px;">
          <div style="color: #9ca3af;">Average Travel Time:</div>
          <div style="color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
            ${fmtTime(base_avg_s)} → ${fmtTime(flood_avg_s)} ${formatChange(delta_avg_s, pct_avg_increase)}
          </div>
        </div>

        <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 8px;">
          <div style="font-size: 11px; color: #9ca3af; margin-bottom: 6px;">Road Network Status:</div>
          ${paData.total_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-bottom: 4px;">
              <span style="color: #9ca3af;">●</span> Total Roads: <span style="font-weight: 600;">${paData.total_roads || 0}</span>
            </div>
          ` : ''}
          ${paData.unaffected_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
              <span style="color: #22c55e;">●</span> Unaffected Roads: <span style="font-weight: 600;">${paData.unaffected_roads || 0}</span>
            </div>
          ` : ''}
          ${paData.flooded_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
              <span style="color: #ef4444;">●</span> Flooded Roads: <span style="font-weight: 600;">${paData.flooded_roads || 0}</span>
            </div>
          ` : ''}
          ${paData.affected_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
              <span style="color: #fbbf24;">●</span> Affected Roads: <span style="font-weight: 600;">${paData.affected_roads || 0}</span>
            </div>
          ` : ''}
          ${paData.blocked_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
              <span style="color: #ff6b00;">●</span> Blocked Roads: <span style="font-weight: 600;">${paData.blocked_roads || 0}</span>
            </div>
          ` : ''}
          ${paData.unreachable_roads != null ? `
            <div style="font-size: 10px; color: #e5e7eb; margin-left: 8px; margin-top: 2px;">
              <span style="color: #ef4444;">●</span> Unreachable Roads: <span style="font-weight: 600;">${paData.unreachable_roads || 0}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div style="font-size: 9px; color: #6b7280; margin-top: 10px; padding-top: 8px; border-top: 1px solid #374151; text-align: center;">
        Click to view detailed road network
      </div>
    </div>
  `;

  return html;
}

/**
 * React component wrapper for Planning Area Tooltip
 */
export function PlanningAreaTooltip({ paData }) {
  return (
    <div className="bg-gray-800 text-white p-3 rounded-lg shadow-xl border border-gray-700 min-w-[280px]">
      <div className="font-bold text-base mb-2 text-gray-50">{paData.pa_name}</div>

      <div className="text-xs text-gray-400 mb-2">
        Total Intersections: <span className="text-gray-200 font-medium">{paData.total_nodes}</span>
      </div>

      <div className="border-t border-gray-600 pt-2 mt-2">
        {/* Travel Time Stats */}
        <div className="mb-3">
          <div className="text-xs text-gray-300 font-semibold mb-2">Travel Time to Nearest Amenity:</div>

          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Min Travel Time:</span>
            <span className="text-gray-200">{fmtM(paData.base_avg_s)}</span>
          </div>

          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Max Travel Time (Dry):</span>
            <span className="text-gray-200">{fmtM(paData.base_max_s)}</span>
          </div>

          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Max Travel Time (Flood):</span>
            <span className="text-gray-200">{fmtM(paData.flood_max_s)}</span>
          </div>

          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Avg Travel Time (Dry):</span>
            <span className="text-gray-200">{fmtM(paData.base_avg_s)}</span>
          </div>

          <div className="flex justify-between text-xs">
            <span className="text-gray-400">Avg Travel Time (Flood):</span>
            <span className="text-gray-200">{fmtM(paData.flood_avg_s)}</span>
          </div>
        </div>

        {/* Change Stats */}
        <div className="border-t border-gray-600 pt-2 mt-2">
          <div className="text-xs text-gray-300 font-semibold mb-2">Impact:</div>

          {Number.isFinite(paData.pct_max_increase) && (
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">% Increase (Max Time):</span>
              <span className={`font-semibold ${paData.pct_max_increase > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                {paData.pct_max_increase > 0 ? '+' : ''}{paData.pct_max_increase.toFixed(1)}%
              </span>
            </div>
          )}

          {Number.isFinite(paData.pct_avg_increase) && (
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">% Increase (Avg Time):</span>
              <span className={`font-semibold ${paData.pct_avg_increase > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                {paData.pct_avg_increase > 0 ? '+' : ''}{paData.pct_avg_increase.toFixed(1)}%
              </span>
            </div>
          )}

          {paData.affected_nodes != null && (
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Affected Intersections:</span>
              <span className={`font-semibold ${paData.affected_nodes > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                {paData.affected_nodes}
              </span>
            </div>
          )}

          {paData.unreachable_nodes != null && (
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">Unreachable Intersections:</span>
              <span className={`font-semibold ${paData.unreachable_nodes > 0 ? 'text-red-500' : 'text-green-400'}`}>
                {paData.unreachable_nodes}
              </span>
            </div>
          )}

          {Number.isFinite(paData.pct_unreachable) && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">% Unreachable:</span>
              <span className={`font-semibold ${paData.pct_unreachable > 0 ? 'text-red-500' : 'text-green-400'}`}>
                {paData.pct_unreachable.toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-gray-500 mt-3 pt-2 border-t border-gray-700 text-center">
        Click to view detailed road network
      </div>
    </div>
  );
}

export default PlanningAreaTooltip;
