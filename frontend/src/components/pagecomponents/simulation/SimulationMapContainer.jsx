// src/components/pagecomponents/simulation/SimulationMapContainer.jsx
/**
 * Enhanced Map Container Component for Simulation Results
 * Handles choropleth visualization, road networks, amenity markers, and all interactions
 */

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  getColorForValue,
  getColorForTravelTime,
  getColorForUnreachable,
  fmtTime
} from "@/lib/simulation/metrics";
import { calculateNearestAmenitiesForNodes, getNearestAmenityChange } from "@/lib/simulation/amenityUtils";
import { generateRoadTooltipHTML } from "./RoadTooltip";
import { generatePlanningAreaTooltipHTML } from "./PlanningAreaTooltip";
import { generateAmenityTooltipHTML } from "./AmenityTooltip";

const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
const DEFAULT_CENTER = [103.82, 1.35];
const DEFAULT_ZOOM = 11;

/**
 * Main Map Container Component
 */
export function SimulationMapContainer({
  planning_fc_raw,
  amenity_fc_enriched,
  graph,
  paDeltas,
  baselineNodeDist,
  floodedNodeDist,
  affectedRoads,
  selectedMetric = "delta_time",
  travelTime = 480,
  selectedAmenityType = "moh_hospitals",
  excludedAmenities = new Set(),
  onPlanningAreaSelect,
  selectedPA,
  showAmenities = true,
}) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const paPopupRef = useRef(null);
  const roadPopupRef = useRef(null);
  const amenityPopupRef = useRef(null);

  const [mapReady, setMapReady] = useState(false);

  /**
   * Calculate nearest amenities for all nodes (baseline and flooded scenarios)
   */
  const nearestAmenities = useMemo(() => {
    if (!graph?.nodes || !baselineNodeDist || !floodedNodeDist || !amenity_fc_enriched) {
      return { baselineAmenities: new Map(), floodedAmenities: new Map() };
    }

    return calculateNearestAmenitiesForNodes(
      graph.nodes,
      baselineNodeDist,
      floodedNodeDist,
      amenity_fc_enriched,
      selectedAmenityType,
      excludedAmenities
    );
  }, [graph?.nodes, baselineNodeDist, floodedNodeDist, amenity_fc_enriched, selectedAmenityType, excludedAmenities]);

  /**
   * Calculate line width based on travel time delta severity
   */
  const calculateLineWidth = useCallback((delta, status) => {
    if (status === "unreachable" || status === "blocked") {
      return 5; // Bold for unreachable/blocked
    }

    if (!Number.isFinite(delta) || delta <= 0) {
      return 2; // Thin for unaffected
    }

    // Scale width based on delta (0-60s = 2px, 60-180s = 3px, 180-300s = 4px, >300s = 5px)
    if (delta < 60) return 2;
    if (delta < 180) return 3;
    if (delta < 300) return 4;
    return 5;
  }, []);

  /**
   * Update choropleth data based on selected metric
   */
  const updateChoroplethData = useCallback((metric, filterPAId = null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !planning_fc_raw?.features?.length) return;

    const features = planning_fc_raw.features
      .filter(f => {
        // If filterPAId is provided, only show that PA
        if (filterPAId !== null) {
          const paId = parseInt(f.properties?.PA_ID ?? f.properties?.pa_id, 10);
          return paId === filterPAId;
        }
        return true;
      })
      .map(f => {
        const paId = parseInt(f.properties?.PA_ID ?? f.properties?.pa_id, 10);
        const delta = paDeltas.find(d => d.pa_id === paId);

        let fillColor = "#d1d5db"; // Default gray
        let value = null;

        if (delta) {
        switch (metric) {
          case "delta_time": {
            value = delta.delta_avg_s;
            const maxDelta = Math.max(...paDeltas.map(d => d.delta_avg_s || 0));
            if (Number.isFinite(value) && value > 0) {
              fillColor = getColorForValue(value, maxDelta, false);
            }
            break;
          }
          case "unreachable": {
            value = delta.unreachable_nodes || 0;
            fillColor = getColorForUnreachable(value);
            break;
          }
          case "baseline_time": {
            value = delta.base_avg_s;
            const maxTime = Math.max(...paDeltas.map(d => d.base_avg_s || 0));
            if (Number.isFinite(value)) {
              fillColor = getColorForValue(value, maxTime, true);
            }
            break;
          }
          case "flooded_time": {
            value = delta.flood_avg_s;
            const maxTime = Math.max(...paDeltas.map(d => d.flood_avg_s || 0));
            if (Number.isFinite(value)) {
              fillColor = getColorForValue(value, maxTime, true);
            }
            break;
          }
          case "travel_time": {
            value = delta.base_avg_s;
            if (Number.isFinite(value)) {
              fillColor = getColorForTravelTime(value, travelTime);
            }
            break;
          }
        }
      }

      return {
        ...f,
        id: paId,
        properties: {
          ...f.properties,
          pa_id: paId,
          fillColor,
          metricValue: value,
          ...delta,
        },
      };
    });

    const source = map.getSource("choropleth");
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features,
      });
    }
  }, [planning_fc_raw, paDeltas, travelTime]);

  /**
   * Update blocked roads layer
   */
  const updateBlockedRoadsLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const blockedRoadsFeatures = [];
    const affectedRoadSet = new Set(affectedRoads.map(r => r.rn_id));

    for (const edge of graph.edges) {
      if (affectedRoadSet.has(edge.rn_id)) {
        blockedRoadsFeatures.push({
          type: "Feature",
          properties: {
            rn_id: edge.rn_id,
            name: edge.feature?.properties?.name || `Road ${edge.rn_id}`,
          },
          geometry: {
            type: "LineString",
            coordinates: edge.coords,
          },
        });
      }
    }

    const source = map.getSource("blocked-roads");
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: blockedRoadsFeatures,
      });
    }
  }, [affectedRoads, graph.edges]);

  /**
   * Update all roads layer for global view (green/red only)
   */
  const updateAllRoadsLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const allRoadsFeatures = [];
    const affectedRoadSet = new Set(affectedRoads.map(r => r.rn_id));

    // Create a map to track unique roads (by rn_id)
    const roadMap = new Map();

    for (const edge of graph.edges) {
      if (edge.rn_id != null && !roadMap.has(edge.rn_id)) {
        const isFlooded = affectedRoadSet.has(edge.rn_id);
        const color = isFlooded ? "#ef4444" : "#22c55e"; // Red if flooded, green if not

        roadMap.set(edge.rn_id, {
          type: "Feature",
          properties: {
            rn_id: edge.rn_id,
            name: edge.feature?.properties?.name || `Road ${edge.rn_id}`,
            color,
            flooded: isFlooded,
          },
          geometry: {
            type: "LineString",
            coordinates: edge.coords,
          },
        });
      }
    }

    allRoadsFeatures.push(...roadMap.values());

    const source = map.getSource("all-roads");
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: allRoadsFeatures,
      });
    }
  }, [affectedRoads, graph.edges]);

  /**
   * Show detailed roads for selected planning area
   */
  const showPlanningAreaRoads = useCallback((paId, feature) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const roadsInPA = [];
    const affectedRoadSet = new Set(affectedRoads.map(r => r.rn_id));

    for (const edge of graph.edges) {
      const nodeFrom = graph.nodes.get(edge.from);
      const nodeTo = graph.nodes.get(edge.to);

      if (nodeFrom?.paId === paId || nodeTo?.paId === paId) {
        const isBlocked = affectedRoadSet.has(edge.rn_id);
        const baselineDist = baselineNodeDist?.get(edge.from) ?? Infinity;
        const floodedDist = floodedNodeDist?.get(edge.from) ?? Infinity;

        const delta = Number.isFinite(baselineDist) && Number.isFinite(floodedDist)
          ? floodedDist - baselineDist
          : null;

        let color = "#22c55e"; // Green - unaffected
        let status = "unaffected";

        if (isBlocked) {
          color = "#ff6b00"; // Orange - blocked road directly flooded
          status = "blocked";
        } else if (!Number.isFinite(floodedDist)) {
          color = "#ef4444"; // Red - unreachable (cut off by blocked roads)
          status = "unreachable";
        } else if (delta && delta > 0) {
          color = "#fbbf24"; // Yellow - affected (increased travel time)
          status = "affected";
        }

        const width = calculateLineWidth(delta, status);

        // Get nearest amenity data for this road
        const amenityChange = getNearestAmenityChange(
          edge.from,
          nearestAmenities.baselineAmenities,
          nearestAmenities.floodedAmenities
        );

        roadsInPA.push({
          type: "Feature",
          properties: {
            rn_id: edge.rn_id,
            name: edge.feature?.properties?.name || `Road ${edge.rn_id}`,
            pa_name: nodeFrom?.paName || nodeTo?.paName || null,
            travel_time: edge.w,
            blocked: isBlocked,
            status,
            color,
            width,
            baseline_time: baselineDist,
            flooded_time: floodedDist,
            delta_time: delta,
            // Nearest amenity data
            nearest_amenity_before: amenityChange?.before || null,
            nearest_amenity_after: amenityChange?.after || null,
            nearest_amenity_changed: amenityChange?.changed || false,
          },
          geometry: {
            type: "LineString",
            coordinates: edge.coords,
          },
        });
      }
    }

    // Update roads layer
    const source = map.getSource("roads");
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: roadsInPA,
      });
    }

    // Zoom to planning area
    if (feature.geometry) {
      const bounds = new mapboxgl.LngLatBounds();
      if (feature.geometry.type === "Polygon") {
        feature.geometry.coordinates[0].forEach(coord => bounds.extend(coord));
      } else if (feature.geometry.type === "MultiPolygon") {
        feature.geometry.coordinates.forEach(poly => {
          poly[0].forEach(coord => bounds.extend(coord));
        });
      }
      map.fitBounds(bounds, { padding: 50, maxZoom: 13 });
    }
  }, [graph, affectedRoads, baselineNodeDist, floodedNodeDist, calculateLineWidth, nearestAmenities]);

  /**
   * Initialize map
   */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

    map.on("load", () => {
      // Add sources
      map.addSource("choropleth", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("roads", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("blocked-roads", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("all-roads", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addSource("amenities", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Add choropleth layers
      map.addLayer({
        id: "choropleth-fill",
        type: "fill",
        source: "choropleth",
        paint: {
          "fill-color": ["get", "fillColor"],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.75,
            0.5
          ],
        },
      });

      map.addLayer({
        id: "choropleth-outline",
        type: "line",
        source: "choropleth",
        paint: {
          "line-color": "#1d4ed8",
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            3,
            1.5
          ],
          "line-opacity": 0.9,
        },
      });

      // Add all roads layer for global view (green/red only)
      map.addLayer({
        id: "all-roads-line",
        type: "line",
        source: "all-roads",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.7,
        },
      });

      // Add blocked roads layer (visible when not zoomed into PA) - DEPRECATED, replaced by all-roads
      map.addLayer({
        id: "blocked-roads-line",
        type: "line",
        source: "blocked-roads",
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-opacity": 0,  // Hidden, using all-roads instead
        },
      });

      // Add roads layer (visible when zoomed into PA)
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: "roads",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.9,
        },
      });

      // Add amenities layer
      map.addLayer({
        id: "amenities-circle",
        type: "circle",
        source: "amenities",
        paint: {
          "circle-radius": 6,
          "circle-color": "#3b82f6",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": [
            "case",
            ["boolean", ["get", "dimmed"], false],
            0.5,
            0.95
          ],
        },
      });

      setMapReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  /**
   * Update amenities layer
   */
  useEffect(() => {
    if (!mapReady || !amenity_fc_enriched?.features?.length) return;

    const map = mapRef.current;
    const amenityFeatures = amenity_fc_enriched.features
      .filter(f => f.properties?.amenity_type === selectedAmenityType)
      .filter(f => !excludedAmenities.has(f.properties?.amenity_id))
      .map(f => ({
        type: "Feature",
        properties: {
          ...f.properties,
          dimmed: selectedPA != null, // Dim when PA is selected
        },
        geometry: f.geometry,
      }));

    const source = map.getSource("amenities");
    if (source) {
      source.setData({
        type: "FeatureCollection",
        features: amenityFeatures,
      });
    }
  }, [mapReady, amenity_fc_enriched, selectedAmenityType, excludedAmenities, selectedPA]);

  /**
   * Update all roads layer in global view
   */
  useEffect(() => {
    if (mapReady && graph.edges.length > 0 && !selectedPA) {
      updateAllRoadsLayer();
    }
  }, [mapReady, affectedRoads, graph.edges, selectedPA, updateAllRoadsLayer]);

  /**
   * Update blocked roads layer when affected roads or graph changes (DEPRECATED - using all-roads instead)
   */
  useEffect(() => {
    if (mapReady && affectedRoads.length > 0 && graph.edges.length > 0 && !selectedPA) {
      updateBlockedRoadsLayer();
    }
  }, [mapReady, affectedRoads, graph.edges, selectedPA, updateBlockedRoadsLayer]);

  /**
   * Update choropleth when metric or data changes
   */
  useEffect(() => {
    if (mapReady && paDeltas.length > 0) {
      // Small delay to ensure map is fully loaded
      const timer = setTimeout(() => {
        updateChoroplethData(selectedMetric, selectedPA);
        if (!selectedPA) {
          updateBlockedRoadsLayer();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [mapReady, selectedMetric, paDeltas, updateChoroplethData, updateBlockedRoadsLayer, selectedPA]);

  /**
   * Setup map interaction handlers
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    let hoveredPAId = null;

    // Planning area hover
    const onPAMouseMove = (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const paId = feature.properties.pa_id;

        if (hoveredPAId !== null && hoveredPAId !== paId) {
          map.setFeatureState({ source: "choropleth", id: hoveredPAId }, { hover: false });
        }

        hoveredPAId = paId;
        map.setFeatureState({ source: "choropleth", id: paId }, { hover: true });
        map.getCanvas().style.cursor = "pointer";

        // Check if mouse is over a road - if so, don't show PA tooltip
        const roadFeatures = map.queryRenderedFeatures(e.point, {
          layers: ["roads-line", "blocked-roads-line", "all-roads-line"]
        });

        // Show tooltip only if NOT hovering over a road
        if (paPopupRef.current) {
          paPopupRef.current.remove();
        }

        if (roadFeatures.length === 0) {
          const delta = paDeltas.find(d => d.pa_id === paId);
          if (delta) {
            paPopupRef.current = new mapboxgl.Popup({
              closeButton: false,
              closeOnClick: false,
              maxWidth: "300px",
            })
              .setLngLat(e.lngLat)
              .setHTML(generatePlanningAreaTooltipHTML(delta))
              .addTo(map);
          }
        }
      }
    };

    const onPAMouseLeave = () => {
      if (hoveredPAId !== null) {
        map.setFeatureState({ source: "choropleth", id: hoveredPAId }, { hover: false });
      }
      hoveredPAId = null;
      map.getCanvas().style.cursor = "";

      if (paPopupRef.current) {
        paPopupRef.current.remove();
        paPopupRef.current = null;
      }
    };

    // Planning area click
    const onPAClick = (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const paId = feature.properties.pa_id;

        // Clear PA popup when clicking
        if (paPopupRef.current) {
          paPopupRef.current.remove();
          paPopupRef.current = null;
        }

        // Clear hover state
        if (hoveredPAId !== null) {
          map.setFeatureState({ source: "choropleth", id: hoveredPAId }, { hover: false });
          hoveredPAId = null;
        }

        // Show roads for this PA
        showPlanningAreaRoads(paId, feature);
        onPlanningAreaSelect?.(paId, feature);
      }
    };

    // Road hover
    const onRoadMouseMove = (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;

        if (roadPopupRef.current) {
          roadPopupRef.current.remove();
        }

        // Build nearest amenity data if available
        let nearestAmenityData = null;
        if (props.nearest_amenity_before || props.nearest_amenity_after) {
          nearestAmenityData = {
            before: props.nearest_amenity_before,
            after: props.nearest_amenity_after,
            changed: props.nearest_amenity_changed === true || props.nearest_amenity_changed === 'true',
          };
        }

        roadPopupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: "280px",
        })
          .setLngLat(e.lngLat)
          .setHTML(generateRoadTooltipHTML(props, nearestAmenityData))
          .addTo(map);

        map.getCanvas().style.cursor = "pointer";
      }
    };

    const onRoadMouseLeave = () => {
      if (roadPopupRef.current) {
        roadPopupRef.current.remove();
        roadPopupRef.current = null;
      }
      map.getCanvas().style.cursor = "";
    };

    // Amenity hover
    const onAmenityMouseMove = (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;

        if (amenityPopupRef.current) {
          amenityPopupRef.current.remove();
        }

        amenityPopupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: "220px",
        })
          .setLngLat(e.lngLat)
          .setHTML(generateAmenityTooltipHTML(props))
          .addTo(map);

        map.getCanvas().style.cursor = "pointer";
      }
    };

    const onAmenityMouseLeave = () => {
      if (amenityPopupRef.current) {
        amenityPopupRef.current.remove();
        amenityPopupRef.current = null;
      }
      map.getCanvas().style.cursor = "";
    };

    // Click outside to reset
    const onMapClick = (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["choropleth-fill"] });

      if (features.length === 0 && selectedPA) {
        // Clear selection
        onPlanningAreaSelect?.(null, null);

        // Clear roads
        const roadsSource = map.getSource("roads");
        if (roadsSource) {
          roadsSource.setData({ type: "FeatureCollection", features: [] });
        }

        // Restore choropleth and blocked roads
        updateChoroplethData(selectedMetric, null);
        updateBlockedRoadsLayer();

        // Reset zoom
        map.fitBounds([
          [103.6, 1.15],
          [104.1, 1.47]
        ], { padding: 20 });
      }
    };

    // Attach event listeners
    map.on("mousemove", "choropleth-fill", onPAMouseMove);
    map.on("mouseleave", "choropleth-fill", onPAMouseLeave);
    map.on("click", "choropleth-fill", onPAClick);
    map.on("mousemove", "roads-line", onRoadMouseMove);
    map.on("mouseleave", "roads-line", onRoadMouseLeave);
    map.on("mousemove", "all-roads-line", onRoadMouseMove);
    map.on("mouseleave", "all-roads-line", onRoadMouseLeave);
    map.on("mousemove", "amenities-circle", onAmenityMouseMove);
    map.on("mouseleave", "amenities-circle", onAmenityMouseLeave);
    map.on("click", onMapClick);

    return () => {
      map.off("mousemove", "choropleth-fill", onPAMouseMove);
      map.off("mouseleave", "choropleth-fill", onPAMouseLeave);
      map.off("click", "choropleth-fill", onPAClick);
      map.off("mousemove", "roads-line", onRoadMouseMove);
      map.off("mouseleave", "roads-line", onRoadMouseLeave);
      map.off("mousemove", "all-roads-line", onRoadMouseMove);
      map.off("mouseleave", "all-roads-line", onRoadMouseLeave);
      map.off("mousemove", "amenities-circle", onAmenityMouseMove);
      map.off("mouseleave", "amenities-circle", onAmenityMouseLeave);
      map.off("click", onMapClick);
    };
  }, [
    mapReady,
    paDeltas,
    showPlanningAreaRoads,
    onPlanningAreaSelect,
    selectedPA,
    selectedMetric,
    updateChoroplethData,
    updateBlockedRoadsLayer,
  ]);

  /**
   * Toggle amenity markers visibility
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const visibility = showAmenities ? "visible" : "none";
    if (map.getLayer("amenities-circle")) {
      map.setLayoutProperty("amenities-circle", "visibility", visibility);
    }
  }, [mapReady, showAmenities]);

  /**
   * Toggle roads visibility based on view mode
   * Global view: Always show all-roads layer (green/red)
   * PA view: Show detailed roads-line layer
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (selectedPA) {
      // PA drill-down view: Show detailed roads, hide global all-roads
      if (map.getLayer("all-roads-line")) {
        map.setLayoutProperty("all-roads-line", "visibility", "none");
      }
      if (map.getLayer("roads-line")) {
        map.setLayoutProperty("roads-line", "visibility", "visible");
      }
      if (map.getLayer("blocked-roads-line")) {
        map.setLayoutProperty("blocked-roads-line", "visibility", "none");
      }
    } else {
      // Global view: Always show all-roads, hide detailed roads
      if (map.getLayer("all-roads-line")) {
        map.setLayoutProperty("all-roads-line", "visibility", "visible");
      }
      if (map.getLayer("roads-line")) {
        map.setLayoutProperty("roads-line", "visibility", "none");
      }
      if (map.getLayer("blocked-roads-line")) {
        map.setLayoutProperty("blocked-roads-line", "visibility", "none");
      }
    }
  }, [mapReady, selectedPA]);


  return (
    <>
      <div ref={containerRef} className="absolute inset-0" style={{ height: "800px", minHeight: "800px", maxHeight: "800px" }} />

      {/* Custom popup styles - dark mode, no borders */}
      <style>{`
        .mapboxgl-canvas {
          height: 800px !important;
        }
        .mapboxgl-popup-content {
          background-color: #1f2937 !important;
          border-radius: 8px !important;
          padding: 0 !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
          border: none !important;
        }
        .mapboxgl-popup-tip {
          border-top-color: #1f2937 !important;
        }
        .mapboxgl-popup-close-button {
          color: #9ca3af !important;
          font-size: 18px !important;
          padding: 4px 8px !important;
        }
        .mapboxgl-popup-close-button:hover {
          background-color: transparent !important;
          color: #fff !important;
        }
      `}</style>
    </>
  );
}

export default SimulationMapContainer;
