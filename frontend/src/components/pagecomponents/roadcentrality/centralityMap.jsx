"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import {
  EMPTY_COLLECTION,
  MAPBOX_STYLE,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  format_number,
} from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

// Metric options for color and thickness
const COLOR_METRICS = [
  { value: "importance", label: "Importance" },
  { value: "amenity_count_total", label: "Amenity Count" },
  { value: "flood_count_total", label: "Flood Count" },
  { value: "betweenness_norm", label: "Betweenness (Normalized)" },
  { value: "closeness_norm", label: "Closeness (Normalized)" },
];

const THICKNESS_METRICS = [
  { value: "none", label: "None (Uniform)" },
  { value: "importance", label: "Importance" },
  { value: "amenity_count_total", label: "Amenity Count" },
  { value: "flood_count_total", label: "Flood Count" },
  { value: "betweenness_norm", label: "Betweenness (Normalized)" },
  { value: "closeness_norm", label: "Closeness (Normalized)" },
];

// Check if data has valid computed scores (not all zero or missing)
const hasValidScores = (data, metric) => {
  if (!data?.features?.length) return false;

  const values = data.features
    .map(f => f.properties?.[metric])
    .filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);

  // If more than 10% of roads have non-zero values, consider it valid
  return values.length > data.features.length * 0.1 && Math.max(...values, 0) > 0.01;
};

// Calculate color thresholds based on max value (5 equal buckets)
const calculateColorThresholds = (data, metric) => {
  if (!data?.features?.length) return [0, 0.001, 0.002, 0.003, 0.004, 0.005];

  const values = data.features
    .map(f => f.properties?.[metric])
    .filter(v => v !== null && v !== undefined && !isNaN(v));

  if (values.length === 0) return [0, 0.001, 0.002, 0.003, 0.004, 0.005];

  const maxValue = Math.max(...values);

  // If maxValue is 0 or very small, return small ascending values
  if (maxValue < 0.000001) return [0, 0.001, 0.002, 0.003, 0.004, 0.005];

  // Create 5 equal buckets from 0 to max
  const thresholds = [
    0,
    maxValue * 0.2,
    maxValue * 0.4,
    maxValue * 0.6,
    maxValue * 0.8,
    maxValue,
  ];

  // Ensure strictly ascending order by adding small increments if needed
  for (let i = 1; i < thresholds.length; i++) {
    if (thresholds[i] <= thresholds[i - 1]) {
      thresholds[i] = thresholds[i - 1] + 0.00001;
    }
  }

  return thresholds;
};

// Function to create color expression based on value thresholds
const createColorExpression = (metric, thresholds, hasValidData) => {
  // If no valid data, use neutral gray color
  if (!hasValidData) {
    return "#9ca3af"; // Neutral gray for uncomputed/missing data
  }

  const [t0, t20, t40, t60, t80, t100] = thresholds;

  // Ensure we have meaningful thresholds
  // For normalized metrics (betweenness_norm, closeness_norm), check if max > 0.01
  // For count metrics (flood_count_total, amenity_count_total), check if max > 0
  // For importance, check if max > 0.1
  const isCountMetric = metric.includes("_count_") || metric === "flood_count_total" || metric === "amenity_count_total";
  const isNormalizedMetric = metric.includes("_norm");
  const minThreshold = isCountMetric ? 0 : isNormalizedMetric ? 0.01 : 0.1;

  if (t100 <= minThreshold) {
    return "#9ca3af"; // If max value is too small or zero, use neutral gray
  }

  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", metric]], 0],
    t0, "#e5e7eb",    // Very light gray for near-zero values
    t20, "#93c5fd",   // Light blue (20-40% of max)
    t40, "#60a5fa",   // Medium blue (40-60% of max)
    t60, "#3b82f6",   // Blue (60-80% of max)
    t80, "#1d4ed8",   // Dark blue (80-100% of max)
    t100, "#1e40af",  // Very dark blue (100% of max)
  ];
};

// Function to create width expression based on metric with five thickness categories
const createWidthExpression = (metric, data) => {
  if (metric === "none") {
    return 3; // Uniform width
  }

  // For any metric, use five discrete thickness buckets
  if (data?.features?.length) {
    const values = data.features
      .map(f => f.properties?.[metric])
      .filter(v => v !== null && v !== undefined && !isNaN(v) && v > 0);

    if (values.length === 0) return 3;

    const maxValue = Math.max(...values);
    if (maxValue < 0.01) return 3;

    // Create five thickness thresholds (quintiles) - 20% increments
    const t20 = maxValue * 0.2;
    const t40 = maxValue * 0.4;
    const t60 = maxValue * 0.6;
    const t80 = maxValue * 0.8;

    // Five thickness buckets increasing by 0.5px: 2, 2.5, 3, 3.5, 4
    return [
      "case",
      ["<=", ["coalesce", ["to-number", ["get", metric]], 0], t20], 2,     // Bucket 1: 0-20%
      ["<=", ["coalesce", ["to-number", ["get", metric]], 0], t40], 2.5,   // Bucket 2: 20-40%
      ["<=", ["coalesce", ["to-number", ["get", metric]], 0], t60], 3,     // Bucket 3: 40-60%
      ["<=", ["coalesce", ["to-number", ["get", metric]], 0], t80], 3.5,   // Bucket 4: 60-80%
      4  // Bucket 5: 80-100%
    ];
  }

  return 3; // Default uniform width
};

export function CentralityMap({ data, selectedRoadId, onMapLoad, onRoadClick, selectedMarker = null }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [colorMetric, setColorMetric] = useState("importance");
  const [thicknessMetric, setThicknessMetric] = useState("none");
  const markerRef = useRef(null);

  // Calculate color thresholds based on max value
  const colorThresholds = useMemo(() => {
    return calculateColorThresholds(data, colorMetric);
  }, [data, colorMetric]);

  // Check if data has valid scores
  const dataHasValidScores = useMemo(() => {
    return hasValidScores(data, colorMetric);
  }, [data, colorMetric]);

  // Update map paint properties when metrics or data change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("roads")) return;

    try {
      map.setPaintProperty("roads", "line-color", createColorExpression(colorMetric, colorThresholds, dataHasValidScores));
      map.setPaintProperty("roads", "line-width", createWidthExpression(thicknessMetric, data));
    } catch (e) {
      console.error("Failed to update paint properties:", e);
    }
  }, [colorMetric, thicknessMetric, colorThresholds, dataHasValidScores, data]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    if (!mapboxgl.supported()) {
      console.error("MapboxGL is not supported in this browser");
      return;
    }

    console.log("Initializing centrality map...", {
      hasContainer: !!containerRef.current,
      hasToken: !!MAPBOX_TOKEN,
      tokenLength: MAPBOX_TOKEN?.length
    });

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAPBOX_STYLE,
        center: MAP_DEFAULT_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        attributionControl: true,
      });
      mapRef.current = map;

      console.log("Map object created");

      if (onMapLoad) onMapLoad(map);

      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

      const ensureBase = () => {
      if (!map.getSource("road-network")) {
        map.addSource("road-network", { type: "geojson", data: EMPTY_COLLECTION });
      }
      if (!map.getLayer("roads")) {
        map.addLayer({
          id: "roads",
          type: "line",
          source: "road-network",
          layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#9ca3af", // Neutral gray initially (no data loaded yet)
            "line-width": 3, // Uniform width initially
            "line-opacity": 0.95
          },
        });
      }
    };

    const showPopup = (lngLat, html) => {
      if (!map._centrality_popup) {
        map._centrality_popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: [0, 8], maxWidth: "320px" });
      }
      map._centrality_popup.setLngLat(lngLat).setHTML(html).addTo(map);
    };

    const hidePopup = () => {
      if (map._centrality_popup) {
        try {
          map._centrality_popup.remove();
        } catch {}
      }
    };

      map.on("load", () => {
        console.log("Map load event fired");
        ensureBase();

      const canvas = containerRef.current?.querySelector(".mapboxgl-canvas");
      if (canvas) {
        canvas.style.borderRadius = "1rem";
        canvas.style.outline = "none";
        canvas.style.border = "0";
        canvas.style.boxShadow = "none";
        canvas.style.background = "transparent";
      }

      const onMove = (e) => {
        const f = e.features?.[0];
        if (!f) {
          hidePopup();
          return;
        }

        const p = f.properties || {};
        const name = p.name || p.ref || "Unnamed Road";
        const slaCategory = p.sla_priority || "—";
        const html = `
          <div style="font:12px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto; background:#0f172a; color:#e2e8f0; padding:10px; border-radius:8px;">
            <div style="font-weight:600; margin-bottom:10px; color:#fff; font-size:14px; padding-bottom:8px; border-bottom:1px solid #1e293b;">${name}</div>
            <div style="display:grid; grid-template-columns:auto auto; gap:8px 14px; font-size:11px;">
              <div style="color:#94a3b8;">Road ID</div><div style="color:#f1f5f9;">${p.RN_ID ?? "—"}</div>
              <div style="color:#94a3b8;">Planning Area</div><div style="color:#f1f5f9;">${p.PLN_AREA_N ?? "—"}</div>
              <div style="color:#94a3b8;">Subzone</div><div style="color:#f1f5f9;">${p.SUBZONE_N ?? "—"}</div>
              <div style="color:#94a3b8;">Importance</div><div style="color:#60a5fa; font-weight:700;">${format_number(p.importance, 2) ?? "—"}</div>
              <div style="color:#94a3b8;">Betweenness</div><div style="color:#f1f5f9;">${format_number(p.betweenness_norm, 4) ?? "—"}</div>
              <div style="color:#94a3b8;">Closeness</div><div style="color:#f1f5f9;">${format_number(p.closeness_norm, 4) ?? "—"}</div>
              <div style="color:#94a3b8;">Amenity Count</div><div style="color:#f1f5f9;">${p.amenity_count_total ?? "0"}</div>
              <div style="color:#94a3b8;">Flood Count</div><div style="color:#f1f5f9;">${p.flood_count_total ?? "0"}</div>
              <div style="color:#94a3b8;">Maintenance Category</div><div style="color:#10b981; font-weight:600;">${slaCategory}</div>
            </div>
          </div>
        `;
        showPopup(e.lngLat, html);
      };

      const onLeave = () => {
        hidePopup();
      };

      map.on("mousemove", "roads", onMove);
      map.on("mouseleave", "roads", onLeave);

      // Click handler
      map.on("click", "roads", (e) => {
        const f = e.features?.[0];
        if (f && onRoadClick) {
          const p = f.properties || {};
          onRoadClick(p.RN_ID);
        }
      });

      try {
        map.resize();
      } catch {}
      requestAnimationFrame(() => {
        try {
          map.resize();
        } catch {}
      });
      });

      map.on("error", (e) => {
        console.error("Map error:", e);
      });
    } catch (error) {
      console.error("Failed to create map:", error);
    }

    return () => {
      try {
        mapRef.current?.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [onMapLoad]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        const src = map.getSource("road-network");
        if (src && src.setData) {
          // Always update the data, even if it's empty
          const newData = data?.features?.length ? data : EMPTY_COLLECTION;
          src.setData(newData);

          // Log for debugging
          console.log(`Map data updated: ${data?.features?.length || 0} features`);

          // Update paint properties after data is set to ensure colors appear on initial load
          if (map.getLayer("roads")) {
            const validScores = hasValidScores(data, colorMetric);
            const thresholds = calculateColorThresholds(data, colorMetric);

            try {
              map.setPaintProperty("roads", "line-color", createColorExpression(colorMetric, thresholds, validScores));
              map.setPaintProperty("roads", "line-width", createWidthExpression(thicknessMetric, data));
            } catch (e) {
              console.error("Failed to update paint properties after data load:", e);
            }
          }
        }
        if (data?.features?.length) {
          const b = computeBounds(data);
          if (b) {
            try {
              map.fitBounds(b, { padding: 40, duration: 600, maxZoom: 15 });
            } catch {}
          }
        }
      } catch (err) {
        console.error("Error updating map data:", err);
      }
    };

    // Try to apply immediately if style is loaded
    if (map.isStyleLoaded()) {
      apply();
    } else {
      // If not loaded, wait for it
      map.once("load", apply);
    }

    // Also listen for styledata event to handle style changes
    const onStyleData = () => {
      const src = map.getSource("road-network");
      if (src) {
        apply();
      }
    };
    map.on("styledata", onStyleData);

    return () => {
      map.off("styledata", onStyleData);
    };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Wait for map to be fully loaded before manipulating layers
    const applyHighlight = () => {
      try {
        if (!map.getSource("selected-road")) {
          map.addSource("selected-road", {
            type: "geojson",
            data: EMPTY_COLLECTION,
          });

          map.addLayer({
            id: "selected-road-line",
            type: "line",
            source: "selected-road",
            paint: {
              "line-color": "#fbbf24",
              "line-width": 6,
              "line-opacity": 0.9,
            },
          });
        }

        const highlightSource = map.getSource("selected-road");
        if (!highlightSource) return;

        if (selectedRoadId && data?.features) {
          const selectedFeature = data.features.find((f) => f.properties.RN_ID === selectedRoadId);

          if (selectedFeature) {
            highlightSource.setData({
              type: "FeatureCollection",
              features: [selectedFeature],
            });

            const bounds = new mapboxgl.LngLatBounds();
            if (selectedFeature.geometry.type === "LineString") {
              selectedFeature.geometry.coordinates.forEach((coord) => {
                bounds.extend(coord);
              });
            }
            try {
              map.fitBounds(bounds, { padding: 100, duration: 800 });
            } catch (e) {
              console.warn("Could not fit bounds:", e);
            }
            return;
          }
        }

        highlightSource.setData(EMPTY_COLLECTION);
      } catch (e) {
        console.warn("Could not apply road highlight:", e);
      }
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) {
      applyHighlight();
    } else {
      map.once("load", applyHighlight);
    }
  }, [selectedRoadId, data]);

  // Show a single marker when selected from the accordion
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing marker
    if (markerRef.current) {
      try {
        markerRef.current.remove();
      } catch (e) {
        console.warn("Error removing marker:", e);
      }
      markerRef.current = null;
    }

    // If no marker selected, exit
    if (!selectedMarker) return;

    const addMarker = () => {
      try {
        const { item, type } = selectedMarker;
        let coords = null;

        // Get coordinates based on item type
        if (type === 'amenity') {
          if (item.geometry?.type === 'Point') {
            coords = item.geometry.coordinates;
          }
        } else if (type === 'flood') {
          const lat = item.properties?.origin_lat;
          const lng = item.properties?.origin_lng;
          if (lat && lng) {
            coords = [lng, lat];
          }
        }

        if (!coords) return;

        const [lng, lat] = coords;
        const isAmenity = type === 'amenity';
        const color = isAmenity ? '#3b82f6' : '#f97316';
        const name = item.name || (isAmenity ? 'Unknown Amenity' : 'Flood Event');

        // Create marker element
        const el = document.createElement('div');
        el.className = isAmenity ? 'amenity-marker' : 'flood-marker';
        el.style.width = '24px';
        el.style.height = '24px';
        el.style.borderRadius = '50%';
        el.style.backgroundColor = color;
        el.style.border = '3px solid white';
        el.style.cursor = 'pointer';
        el.style.boxShadow = '0 3px 6px rgba(0,0,0,0.4)';

        // Helper function to format category/type names
        const formatLabel = (text) => {
          if (!text) return 'N/A';
          return String(text)
            .replace(/[_-]+/g, ' ')
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        };

        // Create popup with details
        const popupHTML = isAmenity
          ? `<div style="padding: 12px; max-width: 300px; background: #0f172a; color: #e2e8f0; border-radius: 8px;">
               <div style="font-weight: 600; margin-bottom: 10px; color: #60a5fa; font-size: 15px;">${name}</div>
               <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 12px; color: #cbd5e1;">
                 <div style="color: #94a3b8;">Category</div><div>${formatLabel(item.category)}</div>
                 ${item.properties?.postal_code ? `<div style="color: #94a3b8;">Postal Code</div><div>${item.properties.postal_code}</div>` : ''}
               </div>
               <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #334155; font-size: 11px; color: #94a3b8;">
                 ${lat.toFixed(5)}, ${lng.toFixed(5)}
               </div>
             </div>`
          : `<div style="padding: 12px; max-width: 300px; background: #0f172a; color: #e2e8f0; border-radius: 8px;">
               <div style="font-weight: 600; margin-bottom: 10px; color: #fb923c; font-size: 15px;">${name}</div>
               <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 12px; color: #cbd5e1;">
                 <div style="color: #94a3b8;">Type</div><div>${formatLabel(item.type)}</div>
                 ${item.date ? `<div style="color: #94a3b8;">Date</div><div>${item.date}</div>` : ''}
                 ${item.properties?.location ? `<div style="color: #94a3b8;">Location</div><div>${item.properties.location}</div>` : ''}
               </div>
               <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #334155; font-size: 11px; color: #94a3b8;">
                 ${lat.toFixed(5)}, ${lng.toFixed(5)}
               </div>
             </div>`;

        const popup = new mapboxgl.Popup({ offset: 30, closeButton: true, closeOnClick: true })
          .setHTML(popupHTML);

        const marker = new mapboxgl.Marker(el)
          .setLngLat(coords)
          .setPopup(popup)
          .addTo(map);

        // Fly to the marker and open popup
        map.flyTo({
          center: coords,
          zoom: 17,
          duration: 1000
        });

        // Open popup after fly animation
        setTimeout(() => {
          try {
            marker.togglePopup();
          } catch (e) {
            console.warn("Error toggling popup:", e);
          }
        }, 1000);

        markerRef.current = marker;
      } catch (e) {
        console.warn("Error adding marker:", e);
      }
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) {
      addMarker();
    } else {
      map.once("load", addMarker);
    }

    // Cleanup
    return () => {
      if (markerRef.current) {
        try {
          markerRef.current.remove();
        } catch (e) {
          console.warn("Error in marker cleanup:", e);
        }
        markerRef.current = null;
      }
    };
  }, [selectedMarker]);

  const colorLabel = COLOR_METRICS.find(m => m.value === colorMetric)?.label || "Importance";
  const thicknessLabel = THICKNESS_METRICS.find(m => m.value === thicknessMetric)?.label || "None (Uniform)";

  return (
    <div className="relative w-full h-[600px] rounded-2xl overflow-hidden bg-slate-950">
      <div ref={containerRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }} />

      {/* Metric Controls - Top Right */}
      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-auto">
        <div className="rounded-xl bg-card/95 backdrop-blur-sm border p-3 shadow-lg space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Color Metric</Label>
            <Select value={colorMetric} onValueChange={setColorMetric}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLOR_METRICS.map((metric) => (
                  <SelectItem key={metric.value} value={metric.value}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Thickness</Label>
            <Select value={thicknessMetric} onValueChange={setThicknessMetric}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THICKNESS_METRICS.map((metric) => (
                  <SelectItem key={metric.value} value={metric.value}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Dynamic Legend - Bottom Left */}
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-xl bg-card/95 backdrop-blur-sm border p-3 text-xs shadow-lg">
        <p className="font-semibold mb-2">Legend</p>
        <div className="space-y-2">
          <div>
            <p className="text-muted-foreground mb-1">Colour = {colorLabel}</p>
            <div className="h-2 rounded" style={{ background: "linear-gradient(to right, #dbeafe, #93c5fd, #60a5fa, #3b82f6, #1d4ed8, #1e40af)" }} />
            <div className="mt-1 flex justify-between text-muted-foreground text-[9px]">
              <span>{format_number(colorThresholds[0], 1)}</span>
              <span>{format_number(colorThresholds[5], 1)}</span>
            </div>
            <div className="mt-0.5 text-center text-muted-foreground text-[8px]">
              Range: 0 to {format_number(colorThresholds[5], 2)} (max)
            </div>
          </div>
          {thicknessMetric !== "none" && (
            <div>
              <p className="text-muted-foreground mb-1">Thickness = {thicknessLabel}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[2px] w-10 bg-muted-foreground" />
                  <span className="text-muted-foreground text-[10px]">low</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-[6px] w-10 bg-foreground" />
                  <span className="text-muted-foreground text-[10px]">high</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
