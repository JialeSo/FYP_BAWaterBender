"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import { useMapData } from "@/context/MapDataContext";

/* ===== Map config ===== */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
// Light base tends to read best with blue scale lines
const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
const MAP_DEFAULT_ZOOM = 11;

const PAGE_SIZE = 50;
const DEFAULT_SORT_KEY = "betweenness_norm";
const DEFAULT_SORT_DIRECTION = "desc";
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== Table columns ===== */
const COLUMNS = [
  { key: "RN_ID", label: "RN ID", type: "number" },
  { key: "name", label: "Name", type: "string" },
  { key: "highway", label: "Highway", type: "string" },
  { key: "lanes", label: "Lanes", type: "string" },
  { key: "maxspeed", label: "Max Speed", type: "number" },
  { key: "length", label: "Length (m)", type: "number", format: (v) => formatNumber(v, 1) },
  { key: "travel_time", label: "Travel Time (s)", type: "number", format: (v) => formatNumber(v, 1) },
  { key: "betweenness_norm", label: "Betweenness (norm)", type: "number", format: (v) => formatNumber(v, 4) },
  { key: "closeness_norm", label: "Closeness (norm)", type: "number", format: (v) => formatNumber(v, 4) },
  { key: "PLN_AREA_N", label: "Planning Area", type: "string" },
  { key: "SUBZONE_N", label: "Subzone", type: "string" },
];

/* ===== Map styling (color = closeness, width = betweenness) ===== */
const COLOR_EXPRESSION = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "closeness_norm"]], 0],
  0, "#cbd5f5",
  0.25, "#a5bdfb",
  0.5, "#60a5fa",
  0.75, "#2563eb",
  1, "#1e3a8a",
];

const WIDTH_EXPRESSION = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "betweenness_norm"]], 0],
  0, 1,
  0.05, 1.5,
  0.1, 2.5,
  0.3, 4,
  0.6, 6,
  1, 8,
];

/* ===== Utils ===== */
function formatNumber(value, fractionDigits = 1) {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return num.toLocaleString(undefined, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function formatCell(value, column) {
  if (column?.format) {
    const formatted = column.format(value);
    if (formatted !== null && formatted !== undefined) return formatted;
  }
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sanitizeMetric(value) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}
function sanitizeNumber(value) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}
function normalizeSortValue(value, type) {
  if (type === "number") {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ").toLowerCase();
  return String(value).toLowerCase();
}

/* =======================================================================
   Map (robust): hover highlight + popup + style rehydrate + resize obs
   ======================================================================= */
function CentralityMap({ data, betweennessValuesSorted, closenessValuesSorted }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [err, setErr] = useState("");
  const hoverIdRef = useRef(null);
  const popupRef = useRef(null);

  // quick percentile helper with pre-sorted ascending arrays
  const percentileFor = (val, sortedAsc) => {
    if (!sortedAsc?.length || typeof val !== "number") return null;
    // lower-bound binary search
    let lo = 0, hi = sortedAsc.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedAsc[mid] <= val) lo = mid + 1; else hi = mid;
    }
    const pct = (lo / sortedAsc.length) * 100; // rank as percentage
    return Math.max(0, Math.min(100, pct));
  };

  useEffect(() => {
    if (!MAPBOX_TOKEN) { setErr("Missing Mapbox token (VITE_MAPBOX_TOKEN)."); return; }
    if (mapRef.current || !containerRef.current) return;

    if (!mapboxgl.supported()) {
      setErr("WebGL not supported in this browser/device.");
      return;
    }

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: MAPBOX_STYLE,
        center: MAP_DEFAULT_CENTER,
        zoom: MAP_DEFAULT_ZOOM,
        attributionControl: true,
      });
      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), "bottom-right");
      map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

      const ensureBase = () => {
        if (!map.getSource("road-network")) {
          map.addSource("road-network", { type: "geojson", data: EMPTY_COLLECTION, generateId: true });
        }
        // base line
        if (!map.getLayer("roads")) {
          map.addLayer({
            id: "roads",
            type: "line",
            source: "road-network",
            layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": COLOR_EXPRESSION,
              "line-width": WIDTH_EXPRESSION,
              "line-opacity": 0.9,
            },
          });
        }
        // hover emphasis via feature-state
        if (!map.getLayer("roads-hover")) {
          map.addLayer({
            id: "roads-hover",
            type: "line",
            source: "road-network",
            layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                "#0ea5e9", // cyan-ish emphasis
                "transparent",
              ],
              "line-width": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                8,
                0.0001,
              ],
              "line-opacity": [
                "case",
                ["boolean", ["feature-state", "hover"], false],
                1,
                0,
              ],
            },
          });
        }
      };

      map.on("load", () => {
        ensureBase();

        // hover interactions
        const onMove = (e) => {
          const f = e.features?.[0];
          const srcId = "road-network";

          // clear previous hover
          if (hoverIdRef.current != null) {
            try { map.setFeatureState({ source: srcId, id: hoverIdRef.current }, { hover: false }); } catch {}
            hoverIdRef.current = null;
          }

          if (!f) { hidePopup(); return; }

          const id = f.id;
          if (id == null) { hidePopup(); return; }
          hoverIdRef.current = id;
          try { map.setFeatureState({ source: srcId, id }, { hover: true }); } catch {}

          // prepare popup content
          const p = f.properties || {};
          const name = p.name || p.ref || "Unnamed segment";
          const len = formatNumber(p.length, 1);
          const speed = formatNumber(p.maxspeed, 0);
          const lanes = p.lanes ?? "-";
          const pa = p.PLN_AREA_N || "-";
          const sz = p.SUBZONE_N || "-";
          const bet = Number(p.betweenness_norm);
          const clo = Number(p.closeness_norm);
          const betPct = percentileFor(bet, betweennessValuesSorted);
          const cloPct = percentileFor(clo, closenessValuesSorted);

          const content = `
            <div style="font: 12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; color:#0f172a;">
              <div style="font-weight:600; margin-bottom:4px;">${name}</div>
              <div style="display:grid; grid-template-columns:auto auto; gap:6px 10px;">
                <div style="color:#475569;">Highway</div><div>${p.highway ?? "-"}</div>
                <div style="color:#475569;">Lanes</div><div>${lanes}</div>
                <div style="color:#475569;">Max speed</div><div>${speed ? speed + " km/h" : "-"}</div>
                <div style="color:#475569;">Length</div><div>${len ? len + " m" : "-"}</div>
                <div style="color:#475569;">Planning</div><div>${pa}</div>
                <div style="color:#475569;">Subzone</div><div>${sz}</div>
                <div style="color:#475569;">Betweenness</div>
                  <div>${formatNumber(bet,4) ?? "-"} ${betPct!=null ? `· <span style="color:#16a34a;">Top ${Math.max(1, Math.round(100 - betPct))}%</span>` : ""}</div>
                <div style="color:#475569;">Closeness</div>
                  <div>${formatNumber(clo,4) ?? "-"} ${cloPct!=null ? `· <span style="color:#16a34a;">Top ${Math.max(1, Math.round(100 - cloPct))}%</span>` : ""}</div>
              </div>
            </div>
          `;

          showPopup(e.lngLat, content);
        };

        const onLeave = () => {
          const srcId = "road-network";
          if (hoverIdRef.current != null) {
            try { map.setFeatureState({ source: srcId, id: hoverIdRef.current }, { hover: false }); } catch {}
            hoverIdRef.current = null;
          }
          hidePopup();
        };

        map.on("mousemove", "roads", onMove);
        map.on("mousemove", "roads-hover", onMove); // also respond on hover-layer
        map.on("mouseleave", "roads", onLeave);
        map.on("mouseleave", "roads-hover", onLeave);

        // nudge layout to compute size
        try { map.resize(); } catch {}
        requestAnimationFrame(() => { try { map.resize(); } catch {} });
      });

      // Re-add layers/sources if style reloads
      const rehydrate = () => {
        const inst = mapRef.current;
        if (!inst) return;
        ensureBase();
      };
      map.on("styledata", rehydrate);

      map.on("error", (event) => {
        console.error("Mapbox error:", event?.error || event);
        setErr("Mapbox failed to load — check token/style.");
      });

      // Resize observer keeps canvas happy when parent resizes
      const el = containerRef.current;
      const ro = new ResizeObserver(() => {
        if (!map) return;
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
          try { map.resize(); } catch {}
        }
      });
      if (el) ro.observe(el);

      // helpers: popup
      function showPopup(lngLat, html) {
        if (!popupRef.current) {
          popupRef.current = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: [0, 8],
            maxWidth: "320px",
          });
        }
        popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
      }
      function hidePopup() {
        if (popupRef.current) {
          try { popupRef.current.remove(); } catch {}
        }
      }

      return () => {
        try { map.off("styledata", rehydrate); } catch {}
        if (map) {
          try { map.remove(); } catch {}
        }
        mapRef.current = null;
        popupRef.current = null;
      };
    } catch (e) {
      console.error("Map initialisation error:", e);
      setErr("Failed to initialise Mapbox.");
    }
  }, [betweennessValuesSorted, closenessValuesSorted]);

  // feed data + fit bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        const src = map.getSource("road-network");
        if (src && src.setData) {
          src.setData(data?.features?.length ? data : EMPTY_COLLECTION);
        }
        if (data?.features?.length) {
          const bounds = computeBounds(data);
          if (bounds) {
            try { map.fitBounds(bounds, { padding: 40, duration: 600, maxZoom: 15 }); } catch {}
          }
        }
        map.once("idle", () => { try { map.resize(); } catch {} });
      } catch (e) {
        console.warn("update source failed:", e);
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [data]);

  return (
    <div className="relative h-[62vh] min-h-[26rem] w-full rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* CRITICAL: keep min height on the inner container too */}
      <div ref={containerRef} className="absolute inset-0 min-h-[600px]" />

      {/* Legend */}
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-md bg-white/95 p-3 text-xs text-slate-600 shadow">
        <p className="font-semibold text-slate-700">Legend</p>
        <div className="mt-2 space-y-2">
          <div>
            <p>Colour shows closeness centrality</p>
            <div
              className="mt-1 h-2 rounded"
              style={{ background: "linear-gradient(to right, #cbd5f5 0%, #a5bdfb 25%, #60a5fa 50%, #2563eb 75%, #1e3a8a 100%)" }}
            />
            <div className="mt-1 flex justify-between"><span>Low</span><span>High</span></div>
          </div>
          <div>
            <p>Thickness shows betweenness centrality</p>
            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-10 bg-slate-400" /><span>Low</span></div>
              <div className="flex items-center gap-2"><span className="inline-block h-[6px] w-10 bg-slate-600" /><span>High</span></div>
            </div>
          </div>
        </div>
      </div>

      {!MAPBOX_TOKEN && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="max-w-sm rounded-lg bg-slate-900/90 p-5 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Map unavailable</p>
            <p className="mt-2 text-sm text-slate-100">Missing VITE_MAPBOX_TOKEN. Set it to visualise the road network on the map.</p>
          </div>
        </div>
      )}

      {MAPBOX_TOKEN && err && (
        <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
          <div className="max-w-sm rounded-lg bg-slate-900/90 p-5 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">Map error</p>
            <p className="mt-2 text-sm text-slate-100">{err}</p>
          </div>
        </div>
      )}

      {MAPBOX_TOKEN && !err && !data?.features?.length && (
        <div className="absolute inset-0 grid place-items-center bg-white/80 p-6 text-slate-600">
          <div className="max-w-sm rounded-lg border border-slate-200 bg-white p-5 text-center shadow">
            <p className="text-sm font-semibold">No road segments to display</p>
            <p className="mt-1 text-xs">Adjust the filters to see road centrality visualised on the map.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ===== Table ===== */
function CentralityTable({ rows, totalRows, sortConfig, onSort, currentPage, totalPages, onPageChange }) {
  const start = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = totalRows === 0 ? 0 : Math.min(totalRows, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <p>Showing {start.toLocaleString()} to {end.toLocaleString()} of {totalRows.toLocaleString()} segments</p>
        {totalRows > PAGE_SIZE && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={currentPage === 1}
            >
              Prev
            </button>
            <span className="text-xs">Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={currentPage === totalPages}
            >
              Next
            </button>
          </div>
        )}
      </div>

      <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {COLUMNS.map((column) => {
                const isActive = sortConfig.key === column.key;
                const directionLabel = isActive ? (sortConfig.direction === "asc" ? " (asc)" : " (desc)") : "";
                return (
                  <th key={column.key} scope="col" className="px-4 py-3 text-left text-slate-700">
                    <button
                      type="button"
                      onClick={() => onSort(column.key)}
                      className="flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-slate-900"
                    >
                      <span>{column.label}</span>
                      {directionLabel && <span className="text-xs">{directionLabel}</span>}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-6 text-center text-slate-500">
                  No road segments match the selected filters.
                </td>
              </tr>
            ) : (
              rows.map((feature, index) => {
                const properties = feature?.properties ?? {};
                const rowKey = properties.RN_ID ?? properties.osmid ?? index;
                return (
                  <tr key={rowKey} className="odd:bg-white even:bg-slate-50/40">
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="px-4 py-2 align-top text-slate-700">
                        {formatCell(properties[column.key], column)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ===== Page wrapper (data + map + table) ===== */
export default function Centrality() {
  const { roadFC, loading, error } = useMapData();
  const [highwayFilter, setHighwayFilter] = useState("ALL");
  const [planningFilter, setPlanningFilter] = useState("ALL");
  const [sortConfig, setSortConfig] = useState({ key: DEFAULT_SORT_KEY, direction: DEFAULT_SORT_DIRECTION });
  const [currentPage, setCurrentPage] = useState(1);

  const features = useMemo(() => roadFC?.features ?? [], [roadFC]);

  const highwayOptions = useMemo(() => {
    const values = new Set();
    features.forEach((f) => { const v = f?.properties?.highway; if (v) values.add(String(v)); });
    return ["ALL", ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [features]);

  const planningOptions = useMemo(() => {
    const values = new Set();
    features.forEach((f) => { const v = f?.properties?.PLN_AREA_N; if (v) values.add(String(v)); });
    return ["ALL", ...Array.from(values).sort((a, b) => a.localeCompare(b))];
  }, [features]);

  const filteredFeatures = useMemo(() => {
    return features.filter((feature) => {
      if (!feature?.properties) return false;
      const highway = feature.properties.highway;
      const planning = feature.properties.PLN_AREA_N;
      const highwayMatch = highwayFilter === "ALL" || (highway && String(highway) === highwayFilter);
      const planningMatch = planningFilter === "ALL" || (planning && String(planning) === planningFilter);
      return highwayMatch && planningMatch;
    });
  }, [features, highwayFilter, planningFilter]);

  const sanitizedFeatures = useMemo(() => {
    return filteredFeatures.map((feature) => {
      if (!feature) return null;
      const p = feature.properties ?? {};
      return {
        ...feature,
        properties: {
          ...p,
          betweenness_norm: sanitizeMetric(p.betweenness_norm),
          closeness_norm: sanitizeMetric(p.closeness_norm),
          length: sanitizeNumber(p.length),
          travel_time: sanitizeNumber(p.travel_time),
          maxspeed: sanitizeNumber(p.maxspeed),
        },
      };
    }).filter(Boolean);
  }, [filteredFeatures]);

  const sortedFeatures = useMemo(() => {
    const columnMeta = COLUMNS.find((c) => c.key === sortConfig.key);
    const type = columnMeta?.type || "string";
    const direction = sortConfig.direction === "asc" ? 1 : -1;

    const rows = [...sanitizedFeatures];
    rows.sort((a, b) => {
      const A = a?.properties?.[sortConfig.key];
      const B = b?.properties?.[sortConfig.key];
      const nA = normalizeSortValue(A, type);
      const nB = normalizeSortValue(B, type);
      if (nA === nB) return 0;

      if (type === "number") {
        const fA = Number.isFinite(nA); const fB = Number.isFinite(nB);
        if (!fA && !fB) return 0;
        if (!fA) return 1;
        if (!fB) return -1;
        return direction === 1 ? nA - nB : nB - nA;
      }
      return direction === 1 ? String(nA).localeCompare(String(nB)) : String(nB).localeCompare(String(nA));
    });
    return rows;
  }, [sanitizedFeatures, sortConfig]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedFeatures.length / PAGE_SIZE)), [sortedFeatures.length]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedFeatures.slice(start, start + PAGE_SIZE);
  }, [currentPage, sortedFeatures]);

  const mapData = useMemo(() => {
    return sanitizedFeatures.length ? { type: "FeatureCollection", features: sanitizedFeatures } : EMPTY_COLLECTION;
  }, [sanitizedFeatures]);

  // precompute sorted metric arrays for percentile display in popup
  const betweennessValuesSorted = useMemo(() => {
    const arr = sanitizedFeatures.map((f) => Number(f?.properties?.betweenness_norm)).filter((x) => Number.isFinite(x));
    return arr.sort((a, b) => a - b);
  }, [sanitizedFeatures]);
  const closenessValuesSorted = useMemo(() => {
    const arr = sanitizedFeatures.map((f) => Number(f?.properties?.closeness_norm)).filter((x) => Number.isFinite(x));
    return arr.sort((a, b) => a - b);
  }, [sanitizedFeatures]);

  useEffect(() => { setCurrentPage(1); }, [highwayFilter, planningFilter, sortConfig]);
  useEffect(() => { setCurrentPage((prev) => Math.min(prev, totalPages)); }, [totalPages]);

  const handleSort = (columnKey) => {
    setSortConfig((prev) =>
      prev.key === columnKey
        ? { key: columnKey, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key: columnKey, direction: DEFAULT_SORT_DIRECTION }
    );
  };

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Road Network Centrality</h1>
        <p className="text-sm text-muted-foreground">
          Colour encodes closeness centrality; line thickness encodes betweenness. Hover a segment to see context.
        </p>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading road network data...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 shadow-sm">
          Cannot show road network data because loading failed.
        </div>
      ) : (
        <>
          <CentralityMap
            data={mapData}
            betweennessValuesSorted={betweennessValuesSorted}
            closenessValuesSorted={closenessValuesSorted}
          />
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-6">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-600">
                Highway Type
                <select
                  value={highwayFilter}
                  onChange={(e) => setHighwayFilter(e.target.value)}
                  className="mt-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {highwayOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "ALL" ? "All highway types" : opt}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-600">
                Planning Area
                <select
                  value={planningFilter}
                  onChange={(e) => setPlanningFilter(e.target.value)}
                  className="mt-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {planningOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "ALL" ? "All planning areas" : opt}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <CentralityTable
              rows={paginatedRows}
              totalRows={sortedFeatures.length}
              sortConfig={sortConfig}
              onSort={handleSort}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </section>
        </>
      )}
    </div>
  );
}
