"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import {
  COLOR_SCORE,
  EMPTY_COLLECTION,
  MAPBOX_STYLE,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  WIDTH_EXPR,
  format_number,
} from "./shared";

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

export function CentralityMap({ data, selectedRoadId, onMapLoad }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);

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
          paint: { "line-color": COLOR_SCORE, "line-width": WIDTH_EXPR, "line-opacity": 0.95 },
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
        const name = p.name || p.ref || "unnamed segment";
        const html = `
          <div style="font:12px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto; color:#e2e8f0;">
            <div style="font-weight:600; margin-bottom:4px; color:#fff;">${name}</div>
            <div style="display:grid; grid-template-columns:auto auto; gap:6px 10px;">
              <div style="color:#94a3b8;">RN_ID</div><div>${p.RN_ID ?? "—"}</div>
              <div style="color:#94a3b8;">PLANNING_AREA</div><div>${p.PLN_AREA_N ?? "—"}</div>
              <div style="color:#94a3b8;">IMPORTANCE</div><div>${format_number(p.importance, 2) ?? "—"}</div>
              <div style="color:#94a3b8;">SLA</div><div>${format_number(p.sla_priority, 2) ?? "—"}</div>
              <div style="color:#94a3b8;">BETWEENNESS</div><div>${format_number(p.betweenness_norm, 4) ?? "—"}</div>
              <div style="color:#94a3b8;">CLOSENESS</div><div>${format_number(p.closeness_norm, 4) ?? "—"}</div>
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

  return (
    <div className="relative h-[60vh] min-h-[26rem] w-full rounded-2xl overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0 min-h-[560px]" />
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-xl bg-card/95 backdrop-blur-sm border p-3 text-xs shadow-lg">
        <p className="font-semibold mb-2">Legend</p>
        <div className="space-y-2">
          <div>
            <p className="text-muted-foreground mb-1">Colour = Importance Score</p>
            <div className="h-2 rounded" style={{ background: "linear-gradient(to right, #dbeafe, #93c5fd, #60a5fa, #3b82f6, #1d4ed8)" }} />
            <div className="mt-1 flex justify-between text-muted-foreground text-[10px]">
              <span>low</span>
              <span>high</span>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Thickness = Betweenness</p>
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
        </div>
      </div>
    </div>
  );
}
