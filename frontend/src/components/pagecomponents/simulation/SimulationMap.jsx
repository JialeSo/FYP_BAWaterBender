// src/pages/PlanningAreaDebugAndMap.jsx
import { useRef, useState, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import { useMapData } from "@/context/MapDataContext";

/* ===== map defaults ===== */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
const DEFAULT_CENTER = [103.8198, 1.3521];
const DEFAULT_ZOOM = 11;

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== Map (planning + subzone + roads + amenities + floods) with toggles ===== */
function CombinedMap({ planningFC, subzoneFC, roadFC, amenityFC, floodsFC }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [err, setErr] = useState("");

  const [vis, setVis] = useState({
    planning: true,
    subzone: true,
    roads: true,
    amenities: true,
    floods: true,
  });

  // keep visibility in sync with map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const setLayerVis = (id, on) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    setLayerVis("planning-fill", vis.planning);
    setLayerVis("planning-outline", vis.planning);
    setLayerVis("subzone-fill", vis.subzone);
    setLayerVis("subzone-outline", vis.subzone);
    setLayerVis("roads", vis.roads);
    setLayerVis("amenities", vis.amenities);
    setLayerVis("floods", vis.floods);
  }, [vis]);

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErr("Missing Mapbox token (VITE_MAPBOX_TOKEN)."); return; }
    const hasAny =
      planningFC?.features?.length ||
      subzoneFC?.features?.length ||
      roadFC?.features?.length ||
      amenityFC?.features?.length ||
      floodsFC?.features?.length;
    if (!hasAny) return;
    if (mapRef.current) return;

    try {
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
        // planning
        if (planningFC?.features?.length) {
          map.addSource("planning-area", { type: "geojson", data: planningFC, generateId: true });
          map.addLayer({
            id: "planning-fill",
            type: "fill",
            source: "planning-area",
            layout: { visibility: "visible" },
            paint: { "fill-color": "#60a5fa", "fill-opacity": 0.30 },
          });
          map.addLayer({
            id: "planning-outline",
            type: "line",
            source: "planning-area",
            layout: { visibility: "visible" },
            paint: { "line-color": "#1d4ed8", "line-width": 1.2, "line-opacity": 0.9 },
          });
        }

        // subzone
        if (subzoneFC?.features?.length) {
          map.addSource("subzone-area", { type: "geojson", data: subzoneFC, generateId: true });
          map.addLayer({
            id: "subzone-fill",
            type: "fill",
            source: "subzone-area",
            layout: { visibility: "visible" },
            paint: { "fill-color": "#22c55e", "fill-opacity": 0.18 },
          });
          map.addLayer({
            id: "subzone-outline",
            type: "line",
            source: "subzone-area",
            layout: { visibility: "visible" },
            paint: { "line-color": "#16a34a", "line-width": 0.8, "line-opacity": 0.7 },
          });
        }

        // roads
        if (roadFC?.features?.length) {
          map.addSource("road-network", { type: "geojson", data: roadFC, generateId: true });
          map.addLayer({
            id: "roads",
            type: "line",
            source: "road-network",
            layout: { visibility: "visible" },
            paint: { "line-color": "#f97316", "line-width": 2.0, "line-opacity": 0.95 },
          });
        }

        // amenities (as circles)
        if (amenityFC?.features?.length) {
          map.addSource("amenities-src", { type: "geojson", data: amenityFC, generateId: true });
          map.addLayer({
            id: "amenities",
            type: "circle",
            source: "amenities-src",
            layout: { visibility: "visible" },
            paint: {
              "circle-radius": 3,
              "circle-color": "#22c55e",
              "circle-stroke-width": 1,
              "circle-stroke-color": "#065f46",
              "circle-opacity": 0.9,
            },
          });
        }

        // floods (as circles)
        if (floodsFC?.features?.length) {
          map.addSource("floods-src", { type: "geojson", data: floodsFC, generateId: true });
          map.addLayer({
            id: "floods",
            type: "circle",
            source: "floods-src",
            layout: { visibility: "visible" },
            paint: {
              "circle-radius": 3,
              "circle-color": "#38bdf8",
              "circle-stroke-width": 1,
              "circle-stroke-color": "#0ea5e9",
              "circle-opacity": 0.9,
            },
          });
        }

        // fit bounds to whatever we have (priority: planning → subzone → road → amenities → floods)
        const fcForBounds =
          (planningFC?.features?.length && planningFC) ||
          (subzoneFC?.features?.length && subzoneFC) ||
          (roadFC?.features?.length && roadFC) ||
          (amenityFC?.features?.length && amenityFC) ||
          (floodsFC?.features?.length && floodsFC) ||
          null;

        const b = fcForBounds ? computeBounds(fcForBounds) : null;
        if (b) {
          try { map.fitBounds(b, { padding: 40, duration: 700, maxZoom: 14 }); } catch {}
        }
        map.once("idle", () => { try { map.resize(); } catch {} });
        requestAnimationFrame(() => { try { map.resize(); } catch {} });
      });

      map.on("error", (e) => {
        console.error("Mapbox error:", e?.error || e);
        setErr("Mapbox failed to load — check token/style.");
      });

      return () => {
        if (mapRef.current) {
          try { mapRef.current.remove(); } catch {}
          mapRef.current = null;
        }
      };
    } catch (e) {
      console.error(e);
      setErr("Failed to initialise Mapbox.");
    }
  }, [planningFC, subzoneFC, roadFC, amenityFC, floodsFC]);

  return (
    <div className="relative w-full h-[70vh] rounded-xl border border-slate-300/40 overflow-hidden">
      <div ref={containerRef} className="absolute inset-0 min-h-[300px]" />

      {/* checkboxes */}
      <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/95 p-2 shadow">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={vis.planning} onChange={(e)=>setVis(v=>({...v, planning: e.target.checked}))}/>
            Planning
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={vis.subzone} onChange={(e)=>setVis(v=>({...v, subzone: e.target.checked}))}/>
            Subzone
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={vis.roads} onChange={(e)=>setVis(v=>({...v, roads: e.target.checked}))}/>
            Roads
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={vis.amenities} onChange={(e)=>setVis(v=>({...v, amenities: e.target.checked}))}/>
            Amenities
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={vis.floods} onChange={(e)=>setVis(v=>({...v, floods: e.target.checked}))}/>
            Floods
          </label>
        </div>
      </div>

      {err && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-5 text-center shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">map unavailable</p>
            <p className="mt-2 text-sm text-slate-100">{err}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Page ===== */
export default function PlanningAreaDebugAndMap() {
  const {
    planningFC,
    subzoneFC,
    roadFC,
    floodsFC,
    amenityFC,
    loading,
    error,
  } = useMapData();

  const hasAny =
    planningFC?.features?.length ||
    subzoneFC?.features?.length ||
    roadFC?.features?.length ||
    floodsFC?.features?.length ||
    amenityFC?.features?.length;

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4">
      <h1 className="text-xl font-semibold">Planning Areas · Subzones · Roads · Amenities · Floods</h1>

      {!MAPBOX_TOKEN && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Missing <code>VITE_MAPBOX_TOKEN</code>. Set it in your env to see the map.
        </div>
      )}

      {MAPBOX_TOKEN && (
        loading ? (
          <div className="h-[70vh] grid place-items-center rounded-xl border border-slate-300/40 text-sm text-slate-500">
            Loading map…
          </div>
        ) : error ? (
          <div className="h-[70vh] grid place-items-center rounded-xl border border-slate-300/40 text-sm text-rose-600">
            Cannot show map because loading failed.
          </div>
        ) : hasAny ? (
          <CombinedMap
            planningFC={planningFC}
            subzoneFC={subzoneFC}
            roadFC={roadFC}
            amenityFC={amenityFC}
            floodsFC={floodsFC}
          />
        ) : (
          <div className="h-[70vh] grid place-items-center rounded-xl border border-slate-300/40 text-sm text-slate-500">
            No features returned — nothing to render.
          </div>
        )
      )}
    </div>
  );
}
