// src/components/pagecomponents/simulation/RoadTooltip.jsx
/**
 * Enhanced Road Tooltip Component
 * Shows comprehensive road metrics including nearest amenity changes
 */

import { fmtTime } from "@/lib/simulation/metrics";

/**
 * Generate HTML for road hover tooltip
 * @param {Object} props - Road properties
 * @param {Object} nearestAmenityData - Optional nearest amenity before/after data
 * @returns {string} - HTML string for tooltip
 */
export function generateRoadTooltipHTML(props, nearestAmenityData = null) {
  const {
    name,
    rn_id,
    status,
    baseline_time,
    flooded_time,
    delta_time,
  } = props;

  // Format travel times
  const baselineTimeStr = Number.isFinite(baseline_time) ? fmtTime(baseline_time) : 'Unreachable';
  const floodedTimeStr = Number.isFinite(flooded_time) ? fmtTime(flooded_time) : 'Unreachable';
  const deltaTimeStr = Number.isFinite(delta_time) && delta_time !== Infinity
    ? (delta_time > 0 ? `+${fmtTime(delta_time)}` : fmtTime(delta_time))
    : 'N/A';

  // Determine status message and color
  let statusMsg, statusColor;
  if (status === 'unreachable') {
    statusMsg = '🔴 Unreachable';
    statusColor = '#ef4444';
  } else if (status === 'blocked') {
    statusMsg = '🔴 Blocked Road';
    statusColor = '#ef4444';
  } else if (status === 'affected') {
    statusMsg = '🟡 Affected (Travel time increased)';
    statusColor = '#fbbf24';
  } else {
    statusMsg = '🟢 Unaffected';
    statusColor = '#22c55e';
  }

  // Build HTML
  let html = `
    <div style="background: #1f2937; color: #fff; padding: 10px 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); border: 1px solid #374151; min-width: 240px;">
      <div style="font-weight: 600; font-size: 14px; margin-bottom: 6px; color: #f3f4f6;">${name}</div>
      <div style="font-size: 11px; color: #9ca3af; margin-bottom: 8px;">RN_ID: ${rn_id}</div>

      <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 6px;">
        <div style="font-size: 11px; font-weight: 600; color: ${statusColor}; margin-bottom: 8px;">
          ${statusMsg}
        </div>

        <div style="font-size: 11px; margin-top: 6px;">
          <div style="color: #d1d5db; margin-bottom: 3px; font-weight: 500;">Base Travel Time:</div>
          <div style="color: #e5e7eb; margin-left: 8px;">${baselineTimeStr}</div>
        </div>

        <div style="font-size: 11px; margin-top: 6px;">
          <div style="color: #d1d5db; margin-bottom: 3px; font-weight: 500;">Flooded Travel Time:</div>
          <div style="color: #e5e7eb; margin-left: 8px;">${floodedTimeStr}</div>
        </div>

        ${Number.isFinite(delta_time) && delta_time !== 0 ? `
          <div style="font-size: 11px; margin-top: 6px;">
            <div style="color: #d1d5db; margin-bottom: 3px; font-weight: 500;">Change:</div>
            <div style="color: ${delta_time > 0 ? '#fbbf24' : '#22c55e'}; margin-left: 8px; font-weight: 600;">${deltaTimeStr}</div>
          </div>
        ` : ''}
  `;

  // Add nearest amenity information if provided
  if (nearestAmenityData) {
    const { before, after, changed } = nearestAmenityData;

    html += `
      <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 8px;">
        <div style="font-size: 11px; color: #d1d5db; margin-bottom: 6px; font-weight: 500;">Nearest Amenity:</div>

        <div style="font-size: 10px; margin-left: 8px; margin-bottom: 4px;">
          <div style="color: #9ca3af;">Before: <span style="color: #e5e7eb;">${before || 'Unknown'}</span></div>
        </div>

        <div style="font-size: 10px; margin-left: 8px;">
          <div style="color: #9ca3af;">After: <span style="color: #e5e7eb;">${after || 'Unknown'}</span>
          ${changed ? '<span style="color: #fb923c; font-weight: 600; margin-left: 4px;">(Changed)</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}

/**
 * React component wrapper for Road Tooltip
 * This can be used if we want to render tooltips as React components instead of HTML strings
 */
export function RoadTooltip({ roadData, nearestAmenityData }) {
  return (
    <div className="bg-gray-800 text-white p-3 rounded-lg shadow-xl border border-gray-700 min-w-[240px]">
      <div className="font-semibold text-sm mb-2 text-gray-100">{roadData.name}</div>
      <div className="text-xs text-gray-400 mb-2">RN_ID: {roadData.rn_id}</div>

      <div className="border-t border-gray-600 pt-2 mt-2">
        <div className="text-xs font-semibold mb-2" style={{ color: roadData.statusColor }}>
          {roadData.statusMsg}
        </div>

        <div className="text-xs mt-2">
          <div className="text-gray-300 mb-1 font-medium">Base Travel Time:</div>
          <div className="text-gray-200 ml-2">{roadData.baselineTimeStr}</div>
        </div>

        <div className="text-xs mt-2">
          <div className="text-gray-300 mb-1 font-medium">Flooded Travel Time:</div>
          <div className="text-gray-200 ml-2">{roadData.floodedTimeStr}</div>
        </div>

        {roadData.showDelta && (
          <div className="text-xs mt-2">
            <div className="text-gray-300 mb-1 font-medium">Change:</div>
            <div className="ml-2 font-semibold" style={{ color: roadData.deltaColor }}>
              {roadData.deltaTimeStr}
            </div>
          </div>
        )}

        {nearestAmenityData && (
          <div className="border-t border-gray-600 pt-2 mt-2">
            <div className="text-xs text-gray-300 mb-2 font-medium">Nearest Amenity:</div>

            <div className="text-xs ml-2 mb-1">
              <span className="text-gray-400">Before: </span>
              <span className="text-gray-200">{nearestAmenityData.before || 'Unknown'}</span>
            </div>

            <div className="text-xs ml-2">
              <span className="text-gray-400">After: </span>
              <span className="text-gray-200">{nearestAmenityData.after || 'Unknown'}</span>
              {nearestAmenityData.changed && (
                <span className="text-orange-400 font-semibold ml-1">(Changed)</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RoadTooltip;
