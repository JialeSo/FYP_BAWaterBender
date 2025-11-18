// src/components/pagecomponents/simulation/AmenityTooltip.jsx
/**
 * Amenity Marker Tooltip Component
 * Shows amenity information on hover
 */

import { capitalizeWords } from "@/lib/simulation/metrics";

/**
 * Generate HTML for amenity marker hover tooltip
 * @param {Object} amenityData - Amenity properties
 * @returns {string} - HTML string for tooltip
 */
export function generateAmenityTooltipHTML(amenityData) {
  const {
    amenity_name,
    amenity_type,
    amenity_category,
    planning_area,
    subzone,
  } = amenityData;

  const displayName = capitalizeWords(amenity_name || 'Unnamed Amenity');
  const displayType = amenity_type ? capitalizeWords(amenity_type.replace(/_/g, ' ')) : 'Unknown';
  const displayCategory = amenity_category ? capitalizeWords(amenity_category) : null;

  const html = `
    <div style="background: #1f2937; color: #fff; padding: 10px 12px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); min-width: 200px;">
      <div style="font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #f3f4f6;">${displayName}</div>

      ${displayCategory ? `
        <div style="display: inline-block; background: #3b82f6; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 500; margin-bottom: 8px;">
          ${displayCategory}
        </div>
      ` : ''}

      <div style="font-size: 11px; color: #9ca3af; margin-top: 6px;">
        <div style="margin-bottom: 4px;">
          <span style="color: #d1d5db; font-weight: 500;">Type:</span>
          <span style="color: #e5e7eb; margin-left: 4px;">${displayType}</span>
        </div>

        ${planning_area ? `
          <div style="margin-bottom: 4px;">
            <span style="color: #d1d5db; font-weight: 500;">Planning Area:</span>
            <span style="color: #e5e7eb; margin-left: 4px;">${planning_area}</span>
          </div>
        ` : ''}

        ${subzone ? `
          <div>
            <span style="color: #d1d5db; font-weight: 500;">Subzone:</span>
            <span style="color: #e5e7eb; margin-left: 4px;">${subzone}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  return html;
}

/**
 * React component wrapper for Amenity Tooltip
 */
export function AmenityTooltip({ amenityData }) {
  const displayName = capitalizeWords(amenityData.amenity_name || 'Unnamed Amenity');
  const displayType = amenityData.amenity_type
    ? capitalizeWords(amenityData.amenity_type.replace(/_/g, ' '))
    : 'Unknown';
  const displayCategory = amenityData.amenity_category
    ? capitalizeWords(amenityData.amenity_category)
    : null;

  return (
    <div className="bg-gray-800 text-white p-3 rounded-lg shadow-xl border border-gray-700 min-w-[200px]">
      <div className="font-semibold text-sm mb-2 text-gray-100">{displayName}</div>

      {displayCategory && (
        <div className="inline-block bg-blue-500 text-white px-2 py-1 rounded-full text-xs font-medium mb-2">
          {displayCategory}
        </div>
      )}

      <div className="text-xs text-gray-400 mt-2">
        <div className="mb-1">
          <span className="text-gray-300 font-medium">Type:</span>
          <span className="text-gray-200 ml-1">{displayType}</span>
        </div>

        {amenityData.planning_area && (
          <div className="mb-1">
            <span className="text-gray-300 font-medium">Planning Area:</span>
            <span className="text-gray-200 ml-1">{amenityData.planning_area}</span>
          </div>
        )}

        {amenityData.subzone && (
          <div>
            <span className="text-gray-300 font-medium">Subzone:</span>
            <span className="text-gray-200 ml-1">{amenityData.subzone}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default AmenityTooltip;
