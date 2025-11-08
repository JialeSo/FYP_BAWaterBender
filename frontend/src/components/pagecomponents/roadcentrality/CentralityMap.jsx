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

// Calculate color thresholds based on max value (5 equal buckets)
const calculateColorThresholds = (data, metric) => {
  if (!data?.features?.length) return [0, 0, 0, 0, 0, 0];

  const values = data.features
    .map(f => f.properties?.[metric])
    .filter(v => v !== null && v !== undefined && !isNaN(v));

  if (values.length === 0) return [0, 0, 0, 0, 0, 0];

  const maxValue = Math.max(...values);

  // Create 5 equal buckets from 0 to max
  return [
    0,
    maxValue * 0.2,
    maxValue * 0.4,
    maxValue * 0.6,
    maxValue * 0.8,
    maxValue,
  ];
};

// Function to create color expression based on value thresholds
const createColorExpression = (metric, thresholds) => {
  const [t0, t20, t40, t60, t80, t100] = thresholds;

  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["to-number", ["get", metric]], 0],
    t0, "#dbeafe",    // Light blue (0-20% of max) - visible even at 0
    t20, "#93c5fd",   // Light blue (20-40% of max)
    t40, "#60a5fa",   // Medium blue (40-60% of max)
    t60, "#3b82f6",   // Blue (60-80% of max)
    t80, "#1d4ed8",   // Dark blue (80-100% of max)
    t100, "#1e40af",  // Very dark blue (100% of max)
  ];
};

// Function to create width expression based on metric
const createWidthExpression = (metric) => {
  if (metric === "none") {
    return 3; // Uniform width
  }
  return [
    "interpolate", ["linear"], ["coalesce", ["to-number", ["get", metric]], 0],
    0, 1, 0.05, 1.5, 0.1, 2.5, 0.3, 4, 0.6, 6, 1, 8,
  ];
};

export function CentralityMap({ data, selectedRoadId, onMapLoad, onRoadClick }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [colorMetric, setColorMetric] = useState("importance");
  const [thicknessMetric, setThicknessMetric] = useState("none");

  // Calculate color thresholds based on max value
  const colorThresholds = useMemo(() => {
    return calculateColorThresholds(data, colorMetric);
  }, [data, colorMetric]);

  // Update map paint properties when metrics or data change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("roads")) return;

    try {
      map.setPaintProperty("roads", "line-color", createColorExpression(colorMetric, colorThresholds));
      map.setPaintProperty("roads", "line-width", createWidthExpression(thicknessMetric));
    } catch (e) {
      console.error("Failed to update paint properties:", e);
    }
  }, [colorMetric, thicknessMetric, colorThresholds]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || mapRef.current || !containerRef.current) return;
    if (!mapboxgl.supported()) return;

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
            "line-color": createColorExpression(colorMetric, colorThresholds),
            "line-width": createWidthExpression(thicknessMetric),
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
              <div style="color:#94a3b8;">SLA Category</div><div style="color:#10b981; font-weight:600;">${slaCategory}</div>
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
        if (src && src.setData) src.setData(data?.features?.length ? data : EMPTY_COLLECTION);
        if (data?.features?.length) {
          const b = computeBounds(data);
          if (b) {
            try {
              map.fitBounds(b, { padding: 40, duration: 600, maxZoom: 15 });
            } catch {}
          }
        }
        map.once("idle", () => {
          try {
            map.resize();
          } catch {}
        });
      } catch {}
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

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
        } catch {}
        return;
      }
    }

    highlightSource.setData(EMPTY_COLLECTION);
  }, [selectedRoadId, data]);

  const colorLabel = COLOR_METRICS.find(m => m.value === colorMetric)?.label || "Importance";
  const thicknessLabel = THICKNESS_METRICS.find(m => m.value === thicknessMetric)?.label || "None (Uniform)";

  return (
    <div className="relative h-[60vh] min-h-[26rem] w-full rounded-2xl overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0 min-h-[560px]" />

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
