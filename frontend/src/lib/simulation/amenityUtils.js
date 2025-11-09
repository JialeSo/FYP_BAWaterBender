// src/lib/simulation/amenityUtils.js
/**
 * Utilities for calculating nearest amenities from nodes/roads
 */

import { snapAmenitiesToNodes } from './graphUtils';

/**
 * Find nearest amenity for a given node
 * @param {number} nodeId - Node ID
 * @param {Map} nodeDist - Map of node distances from Dijkstra
 * @param {Array} amenities - Array of amenity objects with node_id
 * @returns {Object|null} - { amenity_name, distance } or null
 */
export function findNearestAmenity(nodeId, nodeDist, amenities) {
  if (!amenities || !amenities.length) return null;

  let nearest = null;
  let minDist = Infinity;

  // For each amenity, check if we can reach it from this node
  for (const amenity of amenities) {
    // The distance from this node to the amenity node
    const dist = nodeDist.get(nodeId);

    if (Number.isFinite(dist)) {
      if (dist < minDist) {
        minDist = dist;
        nearest = {
          amenity_name: amenity.amenity_name,
          amenity_id: amenity.amenity_id,
          distance: dist,
        };
      }
    }
  }

  return nearest;
}

/**
 * Calculate nearest amenities for all nodes in baseline and flooded scenarios
 * @param {Map} nodes - Graph nodes
 * @param {Map} baselineNodeDist - Baseline distances
 * @param {Map} floodedNodeDist - Flooded distances
 * @param {Object} amenity_fc_enriched - Amenity feature collection
 * @param {string} selectedAmenityType - Amenity type filter
 * @param {Set} excludedAmenities - Excluded amenity IDs
 * @returns {Object} - { baselineAmenities: Map, floodedAmenities: Map }
 */
export function calculateNearestAmenitiesForNodes(
  nodes,
  baselineNodeDist,
  floodedNodeDist,
  amenity_fc_enriched,
  selectedAmenityType,
  excludedAmenities
) {
  // Snap amenities to nodes
  const amenities = snapAmenitiesToNodes(
    amenity_fc_enriched,
    nodes,
    [selectedAmenityType],
    excludedAmenities
  );

  if (!amenities.length) {
    return { baselineAmenities: new Map(), floodedAmenities: new Map() };
  }

  // Create lookup maps: nodeId => nearest amenity
  const baselineAmenities = new Map();
  const floodedAmenities = new Map();

  // Build amenity node lookup
  const amenityNodeMap = new Map();
  for (const amenity of amenities) {
    amenityNodeMap.set(amenity.node_id, amenity);
  }

  // For each node, find its nearest amenity in both scenarios
  for (const node of nodes.values()) {
    const nodeId = node.id;

    // Baseline: find nearest amenity
    let baselineNearest = null;
    let baselineMinDist = Infinity;

    // Flooded: find nearest amenity
    let floodedNearest = null;
    let floodedMinDist = Infinity;

    // Check distance from this node to each amenity node
    for (const amenity of amenities) {
      const amenityNodeId = amenity.node_id;

      // In baseline, check if we can reach the amenity
      const baselineDist = baselineNodeDist.get(nodeId);
      if (Number.isFinite(baselineDist)) {
        // Distance from node to amenity is the node's distance (since amenity is at distance 0)
        if (baselineDist < baselineMinDist) {
          baselineMinDist = baselineDist;
          baselineNearest = amenity;
        }
      }

      // In flooded scenario
      const floodedDist = floodedNodeDist.get(nodeId);
      if (Number.isFinite(floodedDist)) {
        if (floodedDist < floodedMinDist) {
          floodedMinDist = floodedDist;
          floodedNearest = amenity;
        }
      }
    }

    if (baselineNearest) {
      baselineAmenities.set(nodeId, {
        amenity_name: baselineNearest.amenity_name,
        amenity_id: baselineNearest.amenity_id,
        distance: baselineMinDist,
      });
    }

    if (floodedNearest) {
      floodedAmenities.set(nodeId, {
        amenity_name: floodedNearest.amenity_name,
        amenity_id: floodedNearest.amenity_id,
        distance: floodedMinDist,
      });
    }
  }

  return { baselineAmenities, floodedAmenities };
}

/**
 * Get nearest amenity change data for a road (using from node)
 * @param {number} fromNodeId - Road's from node
 * @param {Map} baselineAmenities - Baseline nearest amenities
 * @param {Map} floodedAmenities - Flooded nearest amenities
 * @returns {Object|null} - { before, after, changed } or null
 */
export function getNearestAmenityChange(fromNodeId, baselineAmenities, floodedAmenities) {
  const baselineAmenity = baselineAmenities.get(fromNodeId);
  const floodedAmenity = floodedAmenities.get(fromNodeId);

  if (!baselineAmenity && !floodedAmenity) return null;

  const before = baselineAmenity?.amenity_name || 'None';
  const after = floodedAmenity?.amenity_name || 'None';
  const changed = baselineAmenity?.amenity_id !== floodedAmenity?.amenity_id;

  return { before, after, changed };
}
