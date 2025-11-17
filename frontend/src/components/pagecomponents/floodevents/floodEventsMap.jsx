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
  format_date,
  to_title_case,
  SEVERITY_LEVELS,
} from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

// Visualization modes
const VIZ_MODES = [
  { value: "markers", label: "Markers (Points)" },
  { value: "heatmap", label: "Heatmap (Density)" },
  { value: "both", label: "Both" },
];

// Color metrics for flood events
const COLOR_METRICS = [
  { value: "type", label: "Flood Type" },
  { value: "severity", label: "Severity" },
  { value: "date", label: "Date (Recent)" },
];

// Color schemes
const TYPE_COLORS = {
  flash_flood: "#ef4444",
  flash_flood_risk: "#f97316",
  ponding: "#fbbf24",
  drainage_issue: "#60a5fa",
  unknown: "#9ca3af",
};

const getSeverityColor = (severity) => {
  if (!severity) return "#9ca3af";
  const level = SEVERITY_LEVELS[severity.toLowerCase()];
  return level?.color || "#9ca3af";
};

// Create color expression based on metric
const createColorExpression = (metric, data) => {
  if (metric === "type") {
    // Color by flood type
    return [
      "match",
      ["downcase", ["coalesce", ["get", "flood_type"], ["get", "event"], ["get", "type"], "unknown"]],
      "flash_flood", TYPE_COLORS.flash_flood,
      "flash flood", TYPE_COLORS.flash_flood,
      "flash_flood_risk", TYPE_COLORS.flash_flood_risk,
      "flash flood risk", TYPE_COLORS.flash_flood_risk,
      "ponding", TYPE_COLORS.ponding,
      "drainage_issue", TYPE_COLORS.drainage_issue,
      "drainage issue", TYPE_COLORS.drainage_issue,
      TYPE_COLORS.unknown // default
    ];
  } else if (metric === "severity") {
    // Color by severity
    return [
      "match",
      ["downcase", ["coalesce", ["get", "severity"], ["get", "severity_level"], "unknown"]],
      "critical", SEVERITY_LEVELS.critical.color,
      "high", SEVERITY_LEVELS.high.color,
      "medium", SEVERITY_LEVELS.medium.color,
      "low", SEVERITY_LEVELS.low.color,
      "#9ca3af" // default
    ];
  } else if (metric === "date") {
    // Color by date (recent = red, older = blue)
    // This is a simple approach - in a real app, you'd calculate based on actual dates
    return "#ef4444"; // For now, just use red for all
  }

  return "#ef4444"; // default red
};

export function FloodEventsMap({ data, selectedFloodId, onMapLoad, onFloodClick }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [vizMode, setVizMode] = useState("markers");
  const [colorMetric, setColorMetric] = useState("type");
  const markerRefs = useRef([]);

  // Update map paint properties when metrics change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("flood-points")) return;

    const colorExpr = createColorExpression(colorMetric, data);

    // Use requestAnimationFrame to batch updates
    const rafId = requestAnimationFrame(() => {
      try {
        map.setPaintProperty("flood-points", "circle-color", colorExpr);
        console.log(`Updated flood marker colors for metric: ${colorMetric}`);
      } catch (e) {
        console.error("Failed to update paint properties:", e);
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [colorMetric, data]);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    if (!mapboxgl.supported()) {
      console.error("MapboxGL is not supported in this browser");
      return;
    }

    console.log("Initializing flood events map...");

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAPBOX_STYLE,
        center: MAP_DEFAULT_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        attributionControl: true,
      });
      mapRef.current = map;

      if (onMapLoad) onMapLoad(map);

      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

      const ensureBase = () => {
        if (!map.getSource("flood-events")) {
          map.addSource("flood-events", { type: "geojson", data: EMPTY_COLLECTION });
        }

        // Add heatmap layer
        if (!map.getLayer("flood-heatmap")) {
          map.addLayer({
            id: "flood-heatmap",
            type: "heatmap",
            source: "flood-events",
            maxzoom: 15,
            layout: { visibility: "none" },
            paint: {
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 15, 20],
              "heatmap-opacity": 0.8,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0, "rgba(255,255,255,0)",
                0.2, "#fee2e2",
                0.4, "#fecaca",
                0.6, "#fca5a5",
                0.8, "#ef4444",
                1, "#991b1b"
              ],
            },
          });
        }

        // Add points layer
        if (!map.getLayer("flood-points")) {
          map.addLayer({
            id: "flood-points",
            type: "circle",
            source: "flood-events",
            layout: { visibility: "visible" },
            paint: {
              "circle-radius": 6,
              "circle-color": "#ef4444",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
              "circle-opacity": 0.9,
            },
          });
        }
      };

      const showPopup = (lngLat, html) => {
        if (!map._flood_popup) {
          map._flood_popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: [0, -10],
            maxWidth: "320px"
          });
        }
        map._flood_popup.setLngLat(lngLat).setHTML(html).addTo(map);
      };

      const hidePopup = () => {
        if (map._flood_popup) {
          try {
            map._flood_popup.remove();
          } catch {}
        }
      };

      map.on("load", () => {
        console.log("Flood events map load event fired");
        ensureBase();

        const canvas = containerRef.current?.querySelector(".mapboxgl-canvas");
        if (canvas) {
          canvas.style.borderRadius = "1rem";
          canvas.style.outline = "none";
          canvas.style.border = "0";
        }

        const onMove = (e) => {
          const f = e.features?.[0];
          if (!f) {
            hidePopup();
            return;
          }

          const p = f.properties || {};
          const type = p.flood_type || p.event || p.type || "Unknown";
          const date = p.event_date_iso || p.event_date || p.date || p.dt || "";
          const location = p.location || p.address || p.origin_road || "Unknown location";
          const planningArea = p.origin_planning_area || p.planning_area || p.PLN_AREA_N || "—";
          const severity = p.severity || p.severity_level || "—";

          const html = `
            <div style="font:12px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto; background:#0f172a; color:#e2e8f0; padding:10px; border-radius:8px;">
              <div style="font-weight:600; margin-bottom:10px; color:#fff; font-size:14px; padding-bottom:8px; border-bottom:1px solid #1e293b;">${to_title_case(type)}</div>
              <div style="display:grid; grid-template-columns:auto auto; gap:8px 14px; font-size:11px;">
                <div style="color:#94a3b8;">Date</div><div style="color:#f1f5f9;">${format_date(date)}</div>
                <div style="color:#94a3b8;">Location</div><div style="color:#f1f5f9;">${location}</div>
                <div style="color:#94a3b8;">Planning Area</div><div style="color:#f1f5f9;">${planningArea}</div>
                <div style="color:#94a3b8;">Severity</div><div style="color:#fb923c; font-weight:700;">${to_title_case(severity)}</div>
              </div>
            </div>
          `;
          showPopup(e.lngLat, html);
        };

        const onLeave = () => {
          hidePopup();
        };

        map.on("mousemove", "flood-points", onMove);
        map.on("mouseleave", "flood-points", onLeave);

        // Click handler
        map.on("click", "flood-points", (e) => {
          const f = e.features?.[0];
          if (f && onFloodClick) {
            const p = f.properties || {};
            const id = p.id || p.event_id || p.flood_id;
            onFloodClick(id);
          }
        });

        try {
          map.resize();
        } catch {}
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
  }, [onMapLoad, onFloodClick]);

  // Update map data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        const src = map.getSource("flood-events");
        if (src && src.setData) {
          const newData = data?.features?.length ? data : EMPTY_COLLECTION;
          src.setData(newData);
          console.log(`Flood map data updated: ${data?.features?.length || 0} events`);

          // Update paint properties after data is set
          if (map.getLayer("flood-points")) {
            const colorExpr = createColorExpression(colorMetric, data);
            try {
              map.setPaintProperty("flood-points", "circle-color", colorExpr);
            } catch (e) {
              console.error("Failed to update paint properties after data load:", e);
            }
          }
        }

        if (data?.features?.length) {
          const b = computeBounds(data);
          if (b) {
            try {
              map.fitBounds(b, { padding: 40, duration: 600, maxZoom: 14 });
            } catch {}
          }
        }
      } catch (err) {
        console.error("Error updating map data:", err);
      }
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }

    const onStyleData = () => {
      const src = map.getSource("flood-events");
      if (src) apply();
    };
    map.on("styledata", onStyleData);

    return () => {
      map.off("styledata", onStyleData);
    };
  }, [data, colorMetric]);

  // Update visualization mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const showMarkers = vizMode === "markers" || vizMode === "both";
    const showHeatmap = vizMode === "heatmap" || vizMode === "both";

    if (map.getLayer("flood-points")) {
      map.setLayoutProperty("flood-points", "visibility", showMarkers ? "visible" : "none");
    }
    if (map.getLayer("flood-heatmap")) {
      map.setLayoutProperty("flood-heatmap", "visibility", showHeatmap ? "visible" : "none");
    }
  }, [vizMode]);

  // Highlight selected flood
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const applyHighlight = () => {
      try {
        if (!map.getSource("selected-flood")) {
          map.addSource("selected-flood", {
            type: "geojson",
            data: EMPTY_COLLECTION,
          });

          map.addLayer({
            id: "selected-flood-circle",
            type: "circle",
            source: "selected-flood",
            paint: {
              "circle-radius": 12,
              "circle-color": "#fbbf24",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 3,
              "circle-opacity": 0.7,
            },
          });
        }

        const highlightSource = map.getSource("selected-flood");
        if (!highlightSource) return;

        if (selectedFloodId && data?.features) {
          const selectedFeature = data.features.find((f) => {
            const p = f.properties || {};
            const id = p.id || p.event_id || p.flood_id;
            return id === selectedFloodId;
          });

          if (selectedFeature) {
            highlightSource.setData({
              type: "FeatureCollection",
              features: [selectedFeature],
            });

            // Zoom to selected flood
            if (selectedFeature.geometry.type === "Point") {
              const coords = selectedFeature.geometry.coordinates;
              try {
                map.flyTo({ center: coords, zoom: 15, duration: 800 });
              } catch (e) {
                console.warn("Could not fly to flood:", e);
              }
            }
            return;
          }
        }

        highlightSource.setData(EMPTY_COLLECTION);
      } catch (e) {
        console.warn("Could not apply flood highlight:", e);
      }
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) {
      applyHighlight();
    } else {
      map.once("load", applyHighlight);
    }
  }, [selectedFloodId, data]);

  const colorLabel = COLOR_METRICS.find(m => m.value === colorMetric)?.label || "Flood Type";
  const vizLabel = VIZ_MODES.find(m => m.value === vizMode)?.label || "Markers";

  // Generate legend based on color metric
  const legendItems = useMemo(() => {
    if (colorMetric === "type") {
      return Object.entries(TYPE_COLORS).map(([type, color]) => ({
        color,
        label: to_title_case(type),
      }));
    } else if (colorMetric === "severity") {
      return Object.entries(SEVERITY_LEVELS).map(([level, info]) => ({
        color: info.color,
        label: to_title_case(level),
      }));
    }
    return [];
  }, [colorMetric]);

  return (
    <div className="relative w-full h-[600px] rounded-2xl overflow-hidden bg-slate-950">
      <div ref={containerRef} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }} />

      {/* Controls - Top Right */}
      <div className="absolute top-4 right-4 z-10 space-y-2 pointer-events-auto">
        <div className="rounded-xl bg-card/95 backdrop-blur-sm border p-3 shadow-lg space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Visualization</Label>
            <Select value={vizMode} onValueChange={setVizMode}>
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIZ_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Color By</Label>
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
        </div>
      </div>

      {/* Legend - Bottom Left */}
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-xl bg-card/95 backdrop-blur-sm border p-3 text-xs shadow-lg min-w-[200px]">
        <p className="font-semibold mb-2">{colorLabel}</p>
        <div className="space-y-1">
          {legendItems.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-6 h-3 rounded" style={{ backgroundColor: item.color }}></div>
              <span className="text-[10px] text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
