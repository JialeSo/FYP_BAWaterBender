// src/lib/simulation/dijkstra.js
/**
 * Dijkstra's algorithm implementation for multi-source shortest path
 */

import { MinPQ } from './graphUtils';

/**
 * Multi-source Dijkstra's algorithm
 * @param {Object} graph - { nodes: Map, adj: Map }
 * @param {Array} sourceNodeIds - Array of source node IDs (e.g., hospital locations)
 * @param {Function} onProgress - Optional progress callback
 * @param {Function} edgeFilter - Optional edge filter function
 * @returns {Object} - { dist: Map (node_id => travel_time), visited: number }
 */
export function multiSourceDijkstra({ nodes, adj }, sourceNodeIds, onProgress, edgeFilter) {
  const dist = new Map();
  const pq = new MinPQ();

  // Initialize with all source nodes
  for (const s of sourceNodeIds) {
    dist.set(s, 0);
    pq.push(0, s);
  }

  let visited = 0;
  while (pq.size()) {
    const { k: d, v: u } = pq.pop();
    if (d !== dist.get(u)) continue;
    visited++;
    if (visited % 5000 === 0) onProgress?.(visited);

    const edges = adj.get(u);
    if (!edges) continue;

    for (const e of edges) {
      // Apply edge filter if provided (e.g., to exclude flooded roads)
      if (edgeFilter && !edgeFilter(e)) continue;

      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        pq.push(nd, e.to);
      }
    }
  }

  onProgress?.(visited);
  return { dist, visited };
}

/**
 * Compute per-planning-area statistics from Dijkstra results
 * @param {Object} params - Configuration object
 * @returns {Object} - { paStats, amenitiesCount, nodesCount, nodeDist, affectedNodes, unreachableNodes }
 */
export function computePerPAStats({
  graph,
  amenity_fc_enriched,
  onProgress,
  edgeFilter,
  selectedAmenityType = "moh_hospitals",
  excludedAmenities = new Set(),
  snapAmenitiesToNodes // function imported from graphUtils
}) {
  const { nodes, adj } = graph;

  // Snap amenities to nodes
  const amenities = snapAmenitiesToNodes(amenity_fc_enriched, nodes, [selectedAmenityType], excludedAmenities);
  if (!amenities.length) {
    throw new Error(`No amenities found for type: ${selectedAmenityType}`);
  }

  // Run Dijkstra from all amenity nodes
  const amenityNodeIds = amenities.map(a => a.node_id);
  const { dist } = multiSourceDijkstra({ nodes, adj }, amenityNodeIds, onProgress, edgeFilter);

  // Aggregate stats by planning area
  const byPA = new Map();
  let affectedNodesCount = 0;
  let unreachableNodesCount = 0;

  for (const n of nodes.values()) {
    const paId = n.paId ?? -1;
    const paName = n.paName || "(unknown)";
    const t = dist.get(n.id) ?? Infinity;

    if (!byPA.has(paId)) {
      byPA.set(paId, {
        pa_id: paId,
        pa_name: paName,
        nodes: 0,
        sum_s: 0,
        min_s: Infinity,
        max_s: -Infinity,
        unreachable: 0,
        affected: 0, // New: count of affected nodes
      });
    }

    const agg = byPA.get(paId);
    agg.nodes++;

    if (Number.isFinite(t)) {
      agg.sum_s += t;
      agg.min_s = Math.min(agg.min_s, t);
      agg.max_s = Math.max(agg.max_s, t);
    } else {
      agg.unreachable++;
      unreachableNodesCount++;
    }
  }

  const paStats = Array.from(byPA.values()).map(a => ({
    pa_id: a.pa_id,
    pa_name: a.pa_name,
    nodes: a.nodes,
    avg_s: a.nodes - a.unreachable > 0 ? a.sum_s / (a.nodes - a.unreachable) : null,
    min_s: Number.isFinite(a.min_s) ? a.min_s : null,
    max_s: Number.isFinite(a.max_s) ? a.max_s : null,
    unreachable: a.unreachable,
    affected: a.affected,
  }));

  return {
    paStats,
    amenitiesCount: amenities.length,
    nodesCount: nodes.size,
    nodeDist: dist,
    affectedNodesCount,
    unreachableNodesCount,
  };
}

/**
 * Calculate node-level changes between baseline and flooded scenarios
 * @param {Map} baselineDist - Baseline distance map
 * @param {Map} floodedDist - Flooded distance map
 * @param {Map} nodes - Graph nodes
 * @returns {Object} - { affectedNodes, unreachableNodes, affectedByPA, unreachableByPA }
 */
export function calculateNodeLevelChanges(baselineDist, floodedDist, nodes) {
  let affectedNodesCount = 0;
  let unreachableNodesCount = 0;

  const affectedByPA = new Map();
  const unreachableByPA = new Map();

  for (const node of nodes.values()) {
    const baseTime = baselineDist.get(node.id) ?? Infinity;
    const floodTime = floodedDist.get(node.id) ?? Infinity;

    const paId = node.paId ?? -1;

    // Count affected nodes (travel time increased)
    if (Number.isFinite(baseTime) && Number.isFinite(floodTime) && floodTime > baseTime) {
      affectedNodesCount++;
      affectedByPA.set(paId, (affectedByPA.get(paId) || 0) + 1);
    }

    // Count unreachable nodes (became unreachable or remained unreachable)
    if (!Number.isFinite(floodTime)) {
      unreachableNodesCount++;
      unreachableByPA.set(paId, (unreachableByPA.get(paId) || 0) + 1);
    }
  }

  return {
    affectedNodesCount,
    unreachableNodesCount,
    affectedByPA,
    unreachableByPA,
  };
}
