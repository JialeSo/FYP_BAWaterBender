// src/hooks/useSimulationComputation.js
/**
 * Hook to handle simulation computation logic
 * Consolidates Dijkstra runs and metrics calculation
 */

import { useCallback } from "react";
import { buildGraph, snapAmenitiesToNodes } from "@/lib/simulation/graphUtils";
import { multiSourceDijkstra, calculateNodeLevelChanges } from "@/lib/simulation/dijkstra";
import { calculatePADeltas } from "@/lib/simulation/metrics";

export function useSimulationComputation() {
  /**
   * Compute per-planning-area statistics
   */
  const computePerPAStats = useCallback(({
    graph,
    amenity_fc_enriched,
    onProgress,
    edgeFilter,
    selectedAmenityType = "moh_hospitals",
    excludedAmenities = new Set(),
  }) => {
    const { nodes, adj } = graph;

    // Snap amenities to nodes
    const amenities = snapAmenitiesToNodes(
      amenity_fc_enriched,
      nodes,
      [selectedAmenityType],
      excludedAmenities
    );

    if (!amenities.length) {
      throw new Error(`No amenities found for type: ${selectedAmenityType}`);
    }

    // Run Dijkstra from all amenity nodes
    const amenityNodeIds = amenities.map(a => a.node_id);
    const { dist } = multiSourceDijkstra(
      { nodes, adj },
      amenityNodeIds,
      onProgress,
      edgeFilter
    );

    // Aggregate stats by planning area
    const byPA = new Map();

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
    }));

    return {
      paStats,
      amenitiesCount: amenities.length,
      nodesCount: nodes.size,
      nodeDist: dist,
    };
  }, []);

  /**
   * Run full simulation (baseline + flooded scenarios)
   */
  const runSimulation = useCallback(async ({
    graph,
    amenity_fc_enriched,
    edgeFilter,
    selectedAmenityType,
    excludedAmenities,
    onProgress,
  }) => {
    // Baseline scenario
    const baseline = computePerPAStats({
      graph,
      amenity_fc_enriched,
      onProgress: (v) => onProgress?.({ stage: 'baseline', visited: v }),
      edgeFilter: null,
      selectedAmenityType,
      excludedAmenities,
    });

    // Flooded scenario
    const flooded = computePerPAStats({
      graph,
      amenity_fc_enriched,
      onProgress: (v) => onProgress?.({ stage: 'flooded', visited: v }),
      edgeFilter,
      selectedAmenityType,
      excludedAmenities,
    });

    // Calculate node-level changes
    const nodeLevelChanges = calculateNodeLevelChanges(
      baseline.nodeDist,
      flooded.nodeDist,
      graph.nodes
    );

    // Calculate PA deltas
    const paDeltas = calculatePADeltas(
      baseline.paStats,
      flooded.paStats,
      nodeLevelChanges.affectedByPA,
      nodeLevelChanges.unreachableByPA
    );

    return {
      baseline,
      flooded,
      paDeltas,
      nodeLevelChanges,
    };
  }, [computePerPAStats]);

  return {
    computePerPAStats,
    runSimulation,
  };
}

export default useSimulationComputation;
