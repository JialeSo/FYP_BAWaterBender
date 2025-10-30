import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMapData } from "@/context/MapDataContext";

const MAP_STYLE = "mapbox://styles/mapbox/light-v11";
const DEFAULT_CENTER = [103.8198, 1.3521];
const DEFAULT_ZOOM = 11;

export default function FloodMap({
  selectedId = null,
  onSelect = () => {},
  className = "w-full h-[28rem] rounded-3xl overflow-hidden",
}) {
  const { floodsFC } = useMapData();
  const mapRef = useRef(null);
  const divRef = useRef(null);
  const [ready, setReady] = useState(false);

  const bbox = useMemo(() => {
    const fc = floodsFC || { type: "FeatureCollection", features: [] };
    let minx = +180, miny = +90, maxx = -180, maxy = -90;
    for (const f of fc.features || []) {
      const coords = f?.geometry?.coordinates;
      if (!coords) continue;
      const [x, y] = coords;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minx = Math.min(minx, x); miny = Math.min(miny, y);
        maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
      }
    }
    if (minx === +180) return null;
    return [[minx, miny], [maxx, maxy]];
  }, [floodsFC]);

  useEffect(() => {
    const token = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
    if (!token || !divRef.current || mapRef.current) return;
    mapboxgl.accessToken = token;

    try {
      if (typeof mapboxgl.setTelemetryEnabled === "function")
        mapboxgl.setTelemetryEnabled(false);
    } catch {}

    const map = new mapboxgl.Map({
      container: divRef.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      setReady(true);

      // Cleanup if rerendered
      if (map.getSource("floods")) map.removeSource("floods");
      if (map.getLayer("floods")) map.removeLayer("floods");
      if (map.getLayer("floods_highlight")) map.removeLayer("floods_highlight");
      if (map.getLayer("floods_label")) map.removeLayer("floods_label");

      map.addSource("floods", {
        type: "geojson",
        data: floodsFC || { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "floods",
        type: "circle",
        source: "floods",
        paint: {
          "circle-radius": 5,
          "circle-color": "#2563eb",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.25,
          "circle-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "floods_highlight",
        type: "circle",
        source: "floods",
        paint: {
          "circle-radius": 8,
          "circle-color": "#dc2626",
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
        filter: ["==", ["to-string", ["get", "id"]], "__none__"],
      });

      map.addLayer({
        id: "floods_label",
        type: "symbol",
        source: "floods",
        layout: {
          "text-field": ["coalesce", ["get", "location"], ["to-string", ["get", "id"]]],
          "text-size": 11,
          "text-offset": [0, 1],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      });

      const popup = new mapboxgl.Popup({ closeButton: true, closeOnClick: true });
      map.on("click", "floods", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const html = `
          <div style="min-width:220px">
            <div style="font-weight:600;margin-bottom:2px">flood ${p.id || ""} — ${p.event || ""}</div>
            <div style="font-size:12px;opacity:.8">${p.event_date || ""}</div>
            <div style="margin-top:6px">location: <b>${p.location || ""}</b></div>
            ${p.text ? `<div style="margin-top:6px;font-size:12px">${p.text}</div>` : ""}
          </div>`;
        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        onSelect(p.id || f.id);
      });

      map.on("mouseenter", "floods", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "floods", () => {
        map.getCanvas().style.cursor = "";
      });

      if (bbox) {
        map.fitBounds(bbox, { padding: 40, duration: 0 });
      }
    });

    return () => {
      try {
        map.remove();
      } catch {}
    };
  }, [floodsFC]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const layer = map.getLayer("floods_highlight");
    const idVal = selectedId == null ? "__none__" : String(selectedId);
    if (layer) {
      map.setFilter("floods_highlight", [
        "==",
        ["to-string", ["get", "id"]],
        idVal,
      ]);
    }

    if (selectedId != null && floodsFC) {
      const f = floodsFC.features.find(
        (ft) => String(ft.properties?.id ?? ft.id) === String(selectedId)
      );
      const coords = f?.geometry?.coordinates;
      if (coords && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
        try {
          map.flyTo({ center: coords, zoom: 14, essential: true });
        } catch {}
      }
    }
  }, [selectedId, ready, floodsFC]);

  return (
    <div className={className}>
      <div ref={divRef} className="w-full h-full" />
    </div>
  );
}
