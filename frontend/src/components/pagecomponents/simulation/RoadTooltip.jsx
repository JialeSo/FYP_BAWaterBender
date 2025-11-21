// src/components/pagecomponents/simulation/RoadTooltip.jsx

import { fmtTime } from "@/lib/simulation/metrics";

export function generateRoadTooltipHTML(props, nearestAmenityData = null) {
  const {
    name,
    rn_id,
    pa_name,
    status,
    baseline_time,
    flooded_time,
    delta_time,
  } = props;

  const baselineTimeStr = Number.isFinite(baseline_time)
    ? fmtTime(baseline_time)
    : "Unreachable";
  const floodedTimeStr = Number.isFinite(flooded_time)
    ? fmtTime(flooded_time)
    : "Unreachable";

  let percentageIncrease = null;
  if (
    Number.isFinite(baseline_time) &&
    Number.isFinite(delta_time) &&
    baseline_time > 0 &&
    delta_time !== 0
  ) {
    percentageIncrease = ((delta_time / baseline_time) * 100).toFixed(1);
  }

  const formatChange = () => {
    if (!Number.isFinite(delta_time) || delta_time === 0) return "";
    const sign = delta_time > 0 ? "+" : "";
    const color = delta_time > 0 ? "#fbbf24" : "#22c55e";
    const pctStr =
      percentageIncrease !== null ? `, ${sign}${percentageIncrease}%` : "";
    return `<span style="color: ${color}; font-weight: 600;">(${sign}${fmtTime(
      delta_time
    )}${pctStr})</span>`;
  };

  let statusMsg, statusColor;
  if (status === "unreachable") {
    statusMsg = "🔴 Unreachable";
    statusColor = "#ef4444";
  } else if (status === "blocked") {
    statusMsg = "🔴 Blocked Road";
    statusColor = "#ef4444";
  } else if (status === "affected") {
    statusMsg = "🟡 Affected (Travel time increased)";
    statusColor = "#fbbf24";
  } else {
    statusMsg = "🟢 Unaffected";
    statusColor = "#22c55e";
  }

  // helper to format amenity objects coming from the map container
  const formatAmenity = (amenity) => {
    if (!amenity) return "";
    const timeStr = Number.isFinite(amenity.travel_time_s)
      ? fmtTime(amenity.travel_time_s)
      : "N/A";
    const typeStr = amenity.type
      ? amenity.type.replace(/_/g, " ")
      : "Amenity";

    return `
      <span style="color: #e5e7eb; margin-left: 4px;">
        ${amenity.name || "Unknown"}
        <span style="color: #9ca3af;"> (${typeStr}, ${timeStr})</span>
      </span>
    `;
  };

  let html = `
    <div style="background: #1f2937; color: #fff; padding: 10px 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); min-width: 260px;">
      <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px; color: #f3f4f6;">${name}</div>
      <div style="font-size: 10px; color: #9ca3af; margin-bottom: 2px;">Road ID: ${rn_id}</div>
      ${
        pa_name
          ? `<div style="font-size: 10px; color: #9ca3af; margin-bottom: 8px;">Planning Area: ${pa_name}</div>`
          : ""
      }

      <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 6px;">
        <div style="font-size: 11px; font-weight: 600; color: ${statusColor}; margin-bottom: 8px;">
          ${statusMsg}
        </div>

        <div style="font-size: 11px; margin-bottom: 6px;">
          <div style="color: #9ca3af; margin-bottom: 2px;">Travel Time to Amenity:</div>
          <div style="color: #e5e7eb; margin-left: 8px;">
            ${baselineTimeStr} → ${floodedTimeStr} ${formatChange()}
          </div>
        </div>
  `;

  if (nearestAmenityData) {
    const { before, after, changed } = nearestAmenityData;

    html += `
      <div style="border-top: 1px solid #4b5563; padding-top: 8px; margin-top: 8px;">
        <div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">Nearest Amenity:</div>

        ${
          before
            ? `
          <div style="font-size: 10px; margin-bottom: 3px; margin-left: 8px;">
            <span style="color: #9ca3af;">Dry Scenario:</span>
            ${formatAmenity(before)}
          </div>
        `
            : ""
        }

        ${
          after
            ? `
          <div style="font-size: 10px; margin-bottom: 3px; margin-left: 8px;">
            <span style="color: #9ca3af;">Flood Scenario:</span>
            ${formatAmenity(after)}
          </div>
        `
            : ""
        }

        ${
          changed
            ? `
          <div style="font-size: 10px; color: #fbbf24; font-weight: 600; margin-top: 4px; margin-left: 8px;">
            ⚠️ Nearest amenity changed
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  html += `
      </div>
    </div>
  `;

  return html;
}
