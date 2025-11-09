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
    base_max_s,
    flood_avg_s,
    flood_max_s,
    delta_avg_s,
    delta_max_s,
    pct_avg_increase,
    pct_max_increase,
    pct_unreachable,
    affected_nodes,
    unreachable_nodes,
  } = paData;

  const html = `
    <div style="background: #1f2937; color: #fff; padding: 12px 14px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); min-width: 280px;">
      <div style="font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #f9fafb;">${pa_name}</div>

      <div style="font-size: 11px; color: #9ca3af; margin-bottom: 8px;">
        Total Intersections: <span style="color: #e5e7eb; font-weight: 500;">${total_nodes}</span>
      </div>

      <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 6px;">
        <!-- Travel Time Stats -->
        <div style="margin-bottom: 10px;">
          <div style="font-size: 11px; color: #d1d5db; font-weight: 600; margin-bottom: 6px;">Travel Time to Nearest Amenity:</div>

          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
            <span style="color: #9ca3af;">Min Travel Time:</span>
            <span style="color: #e5e7eb;">${fmtM(base_avg_s)}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
            <span style="color: #9ca3af;">Max Travel Time (Dry):</span>
            <span style="color: #e5e7eb;">${fmtM(base_max_s)}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
            <span style="color: #9ca3af;">Max Travel Time (Flood):</span>
            <span style="color: #e5e7eb;">${fmtM(flood_max_s)}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
            <span style="color: #9ca3af;">Avg Travel Time (Dry):</span>
            <span style="color: #e5e7eb;">${fmtM(base_avg_s)}</span>
          </div>

          <div style="display: flex; justify-content: space-between; font-size: 10px;">
            <span style="color: #9ca3af;">Avg Travel Time (Flood):</span>
            <span style="color: #e5e7eb;">${fmtM(flood_avg_s)}</span>
          </div>
        </div>

        <!-- Change Stats -->
        <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 8px;">
          <div style="font-size: 11px; color: #d1d5db; font-weight: 600; margin-bottom: 6px;">Impact:</div>

          ${Number.isFinite(pct_max_increase) ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
              <span style="color: #9ca3af;">% Increase (Max Time):</span>
              <span style="color: ${pct_max_increase > 0 ? '#fbbf24' : '#22c55e'}; font-weight: 600;">
                ${pct_max_increase > 0 ? '+' : ''}${pct_max_increase.toFixed(1)}%
              </span>
            </div>
          ` : ''}

          ${Number.isFinite(pct_avg_increase) ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
              <span style="color: #9ca3af;">% Increase (Avg Time):</span>
              <span style="color: ${pct_avg_increase > 0 ? '#fbbf24' : '#22c55e'}; font-weight: 600;">
                ${pct_avg_increase > 0 ? '+' : ''}${pct_avg_increase.toFixed(1)}%
              </span>
            </div>
          ` : ''}

          ${affected_nodes != null ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
              <span style="color: #9ca3af;">Affected Intersections:</span>
              <span style="color: ${affected_nodes > 0 ? '#fbbf24' : '#22c55e'}; font-weight: 600;">
                ${affected_nodes}
              </span>
            </div>
          ` : ''}

          ${unreachable_nodes != null ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px;">
              <span style="color: #9ca3af;">Unreachable Intersections:</span>
              <span style="color: ${unreachable_nodes > 0 ? '#ef4444' : '#22c55e'}; font-weight: 600;">
                ${unreachable_nodes}
              </span>
            </div>
          ` : ''}

          ${Number.isFinite(pct_unreachable) ? `
            <div style="display: flex; justify-content: space-between; font-size: 10px;">
              <span style="color: #9ca3af;">% Unreachable:</span>
              <span style="color: ${pct_unreachable > 0 ? '#ef4444' : '#22c55e'}; font-weight: 600;">
                ${pct_unreachable.toFixed(1)}%
              </span>
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
