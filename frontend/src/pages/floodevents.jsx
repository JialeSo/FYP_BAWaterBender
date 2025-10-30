import { useState, useEffect, useMemo, useRef } from "react";
import { useMapData } from "@/context/MapDataContext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";

/* ---------- tiny utils ---------- */
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
};
const fmt = (v, d = 6) => (Number.isFinite(+v) ? (+v).toFixed(d) : "—");

const parse_dmy = (s) => {
  // dd/mm/yyyy → Date|null
  if (!s) return null;
  const [dd, mm, yyyy] = String(s).split(/[/-]/).map((x) => parseInt(x, 10));
  if (!yyyy || !mm || !dd) return null;
  const dt = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const date_in_range = (dt, from, to) => {
  if (!dt) return true;
  if (from && dt < from) return false;
  if (to && dt > to) return false;
  return true;
};

function buildBoundsFromFloods(fc) {
  const b = new mapboxgl.LngLatBounds();
  let had = false;
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const lng = toNum(p.start_lng);
    const lat = toNum(p.start_lat);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
      b.extend([lng, lat]);
      had = true;
    }
  }
  return had ? b : null;
}

function awaitStyle(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded && map.isStyleLoaded()) return resolve();
    const onLoad = () => {
      map.off("load", onLoad);
      resolve();
    };
    map.on("load", onLoad);
  });
}

/* build id→name maps from planning/subzone fc (best-effort) */
function buildIdNameMap(fc) {
  const map = new Map();
  for (const f of fc?.features || []) {
    const props = f.properties || {};
    const idCandidate =
      props.id ?? f.id ?? props.pa_id ?? props.PA_ID ?? props.sz_id ?? props.SZ_ID ?? null;

    const nameCandidate =
      props.name ??
      props.pa_name ??
      props.PA_NAME ??
      props.planning_area ??
      props.PLN_AREA_N ??
      props.subzone_name ??
      props.SUBZONE_N ??
      props.sz_name ??
      null;

    if (idCandidate != null) map.set(String(idCandidate), nameCandidate || String(idCandidate));
  }
  return map;
}

/* draw detail (origin/start/pred a/pred b/end) */
function buildFloodDetail(p) {
  const origin = [toNum(p.origin_lng), toNum(p.origin_lat)];
  const start = [toNum(p.start_lng), toNum(p.start_lat)];
  const predA = [toNum(p.end100_a_lng), toNum(p.end100_a_lat)];
  const predB = [toNum(p.end100_b_lng), toNum(p.end100_b_lat)];
  const end = [toNum(p.end_lng), toNum(p.end_lat)];
  const has = (xy) => !Number.isNaN(xy?.[0]) && !Number.isNaN(xy?.[1]);

  const points = [];
  if (has(origin)) points.push({ role: "origin", coord: origin });
  if (has(start)) points.push({ role: "start", coord: start });
  if (has(predA)) points.push({ role: "pred_a", coord: predA });
  if (has(predB)) points.push({ role: "pred_b", coord: predB });
  if (has(end)) points.push({ role: "end", coord: end });

  const seg = (a, b, role) => (has(a) && has(b) ? [{ role, a, b }] : []);
  const lines = [
    ...seg(origin, start, "origin_to_start"),
    ...seg(start, predA, "start_to_pred_a"),
    ...seg(start, predB, "start_to_pred_b"),
    ...seg(predA, end, "pred_a_to_end"),
    ...seg(predB, end, "pred_b_to_end"),
    ...(!has(end) && has(predA) && has(predB) ? seg(predA, predB, "pred_a_to_pred_b") : []),
  ];

  return { points, lines };
}

export default function FloodEvents() {
  const { floodsFC, planningFC, subzoneFC } = useMapData();
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [selectedProps, setSelectedProps] = useState(null);

  /* -------- enrichment catalogs -------- */
  const paNameMap = useMemo(() => buildIdNameMap(planningFC), [planningFC]);
  const szNameMap = useMemo(() => buildIdNameMap(subzoneFC), [subzoneFC]);

  /* -------- filters state -------- */
  const [q, setQ] = useState("");
  const [eventType, setEventType] = useState("all");
  const [fromStr, setFromStr] = useState("");
  const [toStr, setToStr] = useState("");
  const [paFilter, setPaFilter] = useState("all");
  const [szFilter, setSzFilter] = useState("all");

  const fromDate = useMemo(() => (fromStr ? new Date(fromStr) : null), [fromStr]);
  const toDate = useMemo(() => (toStr ? new Date(toStr) : null), [toStr]);

  /* -------- data prep for table (ENRICHED) -------- */
  const enrichedRows = useMemo(() => {
    const fc = floodsFC || { type: "FeatureCollection", features: [] };
    const rows = (fc.features || []).map((f) => {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const event_date = p.event_date || "";
      const event = p.event || "";
      const location = p.location || "";
      const parent_road = p.parent_road || "";
      const start_postal_code = p.start_postal_code || "";
      const start_pa_id = p.start_pa_id ? String(p.start_pa_id) : "";
      const start_sz_id = p.start_sz_id ? String(p.start_sz_id) : "";
      const planning_area = start_pa_id ? (paNameMap.get(start_pa_id) || start_pa_id) : "";
      const subzone = start_sz_id ? (szNameMap.get(start_sz_id) || start_sz_id) : "";
      const dt = parse_dmy(event_date);

      return {
        id,
        event_date,
        event,
        dt,
        location,
        parent_road,
        start_postal_code,
        planning_area,
        subzone,
        _props: p,
      };
    });

    // attach options for filters (on the returned array object)
    const allPA = new Set(rows.map((r) => r.planning_area).filter(Boolean));
    const allSZ = new Set(rows.map((r) => r.subzone).filter(Boolean));
    const allTypes = new Set(rows.map((r) => r.event).filter(Boolean));

    // store as non-enumerable to avoid React key warnings and re-renders
    Object.defineProperty(rows, "_options", {
      value: {
        eventTypes: ["all", ...Array.from(allTypes).sort()],
        planningAreas: ["all", ...Array.from(allPA).sort()],
        subzones: ["all", ...Array.from(allSZ).sort()],
      },
      enumerable: false,
    });

    return rows;
  }, [floodsFC, paNameMap, szNameMap]);

  /* ---------- ui options from data (read AFTER enrichedRows exists) ---------- */
  const eventTypeOptions = enrichedRows._options?.eventTypes || ["all"];
  const paOptions = enrichedRows._options?.planningAreas || ["all"];
  const szOptions = enrichedRows._options?.subzones || ["all"];

  /* -------- apply filters -------- */
  const filteredRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return enrichedRows
      .filter((r) =>
        (eventType === "all" || r.event === eventType) &&
        date_in_range(r.dt, fromDate, toDate) &&
        (paFilter === "all" || r.planning_area === paFilter) &&
        (szFilter === "all" || r.subzone === szFilter) &&
        (
          !query ||
          r.id.toLowerCase().includes(query) ||
          r.location.toLowerCase().includes(query) ||
          r.parent_road.toLowerCase().includes(query)
        )
      )
      .sort((a, b) => {
        const ta = a.dt ? a.dt.getTime() : 0;
        const tb = b.dt ? b.dt.getTime() : 0;
        if (tb !== ta) return tb - ta; // date desc
        return a.id.localeCompare(b.id);
      });
  }, [enrichedRows, q, eventType, fromDate, toDate, paFilter, szFilter]);

  /* -------- map bounds -------- */
  const bounds = useMemo(() => buildBoundsFromFloods(floodsFC), [floodsFC]);

  /* ---------- init map (with dark popup css) ---------- */
  useEffect(() => {
    if (!containerRef.current || !floodsFC) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;

    (async () => {
      await awaitStyle(map);

      if (!map.getSource("floods")) {
        map.addSource("floods", { type: "geojson", data: floodsFC });
      }
      if (!map.getLayer("flood-points")) {
        map.addLayer({
          id: "flood-points",
          type: "circle",
          source: "floods",
          paint: {
            "circle-radius": 5,
            "circle-color": "#60a5fa",
            "circle-stroke-color": "#0b1220",
            "circle-stroke-width": 1.25,
            "circle-opacity": 0.95,
          },
          layout: { visibility: "visible" },
        });
      }

      // detail sources
      if (!map.getSource("flood-selected-points")) {
        map.addSource("flood-selected-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!map.getSource("flood-selected-lines")) {
        map.addSource("flood-selected-lines", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      // labels
      if (!map.getLayer("flood-selected-labels")) {
        map.addLayer({
          id: "flood-selected-labels",
          type: "symbol",
          source: "flood-selected-points",
          layout: {
            "text-field": [
              "match",
              ["get", "role"],
              "origin", "origin",
              "start", "start",
              "pred_a", "pred a",
              "pred_b", "pred b",
              "end", "end",
              ""
            ],
            "text-size": 11,
            "text-offset": [0, 1.0],
            "text-anchor": "top",
            "symbol-avoid-edges": true,
          },
          paint: {
            "text-color": "#e5e7eb",
            "text-halo-color": "#000",
            "text-halo-width": 0.75,
            "text-halo-blur": 0.5,
          },
          layout: { visibility: "none" },
        });
      }

      // points
      if (!map.getLayer("flood-selected-points")) {
        map.addLayer({
          id: "flood-selected-points",
          type: "circle",
          source: "flood-selected-points",
          paint: {
            "circle-radius": 7,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#0b1220",
            "circle-color": [
              "match",
              ["get", "role"],
              "origin", "#22c55e",
              "start", "#3b82f6",
              "pred_a", "#f59e0b",
              "pred_b", "#f59e0b",
              "end", "#ef4444",
              "#737373",
            ],
          },
          layout: { visibility: "none" },
        });
      }

      // lines
      if (!map.getLayer("flood-selected-lines")) {
        map.addLayer({
          id: "flood-selected-lines",
          type: "line",
          source: "flood-selected-lines",
          paint: {
            "line-color": [
              "match",
              ["get", "role"],
              "origin_to_start", "#22c55e",
              "start_to_pred_a", "#f59e0b",
              "start_to_pred_b", "#f59e0b",
              "pred_a_to_end", "#ef4444",
              "pred_b_to_end", "#ef4444",
              "pred_a_to_pred_b", "#94a3b8",
              "#f97316",
            ],
            "line-width": 3,
            "line-opacity": 0.95,
            "line-dasharray": [2, 2],
          },
          layout: { visibility: "none" },
        });
      }

      // clicks
      if (!map.__floodClickBound) {
        const popup = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: true,
          className: "popup-dark",
        });

        map.on("click", "flood-points", (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const id = f.properties?.id ?? f.id;
          setSelected(String(id));

          const p = f.properties || {};
          const html = `
            <div class="flood-popup">
              <div class="title">flood ${p.id || ""} — ${p.event || ""}</div>
              <div class="sub">${p.event_date || ""}</div>
              <div class="row">location: <b>${p.location || ""}</b></div>
              <div class="grid">
                <div><span>origin</span><code>${fmt(p.origin_lat)}, ${fmt(p.origin_lng)}</code></div>
                <div><span>start</span><code>${fmt(p.start_lat)}, ${fmt(p.start_lng)}</code></div>
                <div><span>pred a</span><code>${fmt(p.end100_a_lat)}, ${fmt(p.end100_a_lng)}</code></div>
                <div><span>pred b</span><code>${fmt(p.end100_b_lat)}, ${fmt(p.end100_b_lng)}</code></div>
                <div><span>end</span><code>${fmt(p.end_lat)}, ${fmt(p.end_lng)}</code></div>
              </div>
            </div>`;
          popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        });

        // click bg → reset
        map.on("click", (e) => {
          const feats = map.queryRenderedFeatures(e.point, { layers: ["flood-points", "flood-selected-points"] });
          if (!feats.length) setSelected(null);
        });

        map.__floodClickBound = true;
      }

      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });
    })();

    return () => {
      try { map.remove(); } catch {}
    };
  }, [floodsFC, bounds]);

  /* ---------- react to selection ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    (async () => {
      await awaitStyle(map);

      if (selected == null) {
        if (map.getLayer("flood-points")) map.setLayoutProperty("flood-points", "visibility", "visible");
        if (map.getLayer("flood-selected-points")) map.setLayoutProperty("flood-selected-points", "visibility", "none");
        if (map.getLayer("flood-selected-lines")) map.setLayoutProperty("flood-selected-lines", "visibility", "none");
        if (map.getLayer("flood-selected-labels")) map.setLayoutProperty("flood-selected-labels", "visibility", "none");

        map.getSource("flood-selected-points")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("flood-selected-lines")?.setData({ type: "FeatureCollection", features: [] });
        setSelectedProps(null);
        if (bounds) map.fitBounds(bounds, { padding: 40 });
        return;
      }

      const feat = (floodsFC?.features || []).find(
        (ft) => String(ft.properties?.id ?? ft.id) === String(selected)
      );
      if (!feat) return;

      const p = feat.properties || {};
      setSelectedProps(p);

      const { points, lines } = buildFloodDetail(p);

      const pointsFC = {
        type: "FeatureCollection",
        features: points.map((pt) => ({
          type: "Feature",
          properties: { role: pt.role },
          geometry: { type: "Point", coordinates: pt.coord },
        })),
      };
      const linesFC = {
        type: "FeatureCollection",
        features: lines.map((l) => ({
          type: "Feature",
          properties: { role: l.role },
          geometry: { type: "LineString", coordinates: [l.a, l.b] },
        })),
      };

      if (map.getLayer("flood-points")) map.setLayoutProperty("flood-points", "visibility", "none");
      if (map.getLayer("flood-selected-points")) map.setLayoutProperty("flood-selected-points", "visibility", "visible");
      if (map.getLayer("flood-selected-lines")) map.setLayoutProperty("flood-selected-lines", "visibility", "visible");
      if (map.getLayer("flood-selected-labels")) map.setLayoutProperty("flood-selected-labels", "visibility", "visible");

      map.getSource("flood-selected-points")?.setData(pointsFC);
      map.getSource("flood-selected-lines")?.setData(linesFC);

      const center =
        points.find((pt) => pt.role === "start")?.coord ||
        points.find((pt) => pt.role === "origin")?.coord ||
        points[0]?.coord;
      if (center) {
        try { map.flyTo({ center, zoom: 15, essential: true }); } catch {}
      }
    })();
  }, [selected, floodsFC, bounds]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">flood events</h1>
        <p className="text-muted-foreground">
          search + filter the table below. click a row to show origin → start → predicted (a/b) → end on the map.
        </p>

        {/* filters */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search id / location / road…"
            className="md:col-span-4 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring"
          />
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {eventTypeOptions.map((t) => (
              <option key={t} value={t}>{t === "all" ? "all types" : t.replace("_"," ")}</option>
            ))}
          </select>
          <select
            value={paFilter}
            onChange={(e) => setPaFilter(e.target.value)}
            className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {paOptions.map((n) => (
              <option key={n} value={n}>{n === "all" ? "all planning areas" : n}</option>
            ))}
          </select>
          <select
            value={szFilter}
            onChange={(e) => setSzFilter(e.target.value)}
            className="md:col-span-3 rounded-lg border bg-background px-3 py-2 text-sm"
          >
            {szOptions.map((n) => (
              <option key={n} value={n}>{n === "all" ? "all subzones" : n}</option>
            ))}
          </select>

          <input
            type="date"
            value={fromStr}
            onChange={(e) => setFromStr(e.target.value)}
            className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="from"
          />
          <input
            type="date"
            value={toStr}
            onChange={(e) => setToStr(e.target.value)}
            className="md:col-span-2 rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="to"
          />
          <button
            onClick={() => { setQ(""); setEventType("all"); setPaFilter("all"); setSzFilter("all"); setFromStr(""); setToStr(""); }}
            className="md:col-span-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            clear
          </button>
        </div>
      </header>

      {/* map */}
      <div className="relative rounded-3xl border border-border bg-card shadow-sm min-h-[28rem] overflow-hidden">
        {/* legend */}
        <div className="flood-legend absolute left-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg">
        <div className="mb-2 font-medium">legend</div>
        <div className="flex items-center gap-2 mb-1">
            <span className="legend-swatch" data-color="#22c55e" />
            <span>origin</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
            <span className="legend-swatch" data-color="#3b82f6" />
            <span>start</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
            <span className="legend-swatch" data-color="#f59e0b" />
            <span>predicted a / b</span>
        </div>
        <div className="flex items-center gap-2">
            <span className="legend-swatch" data-color="#ef4444" />
            <span>end</span>
        </div>
        </div>
        <button
          onClick={() => setSelected(null)}
          className="absolute z-10 right-3 top-3 rounded-lg border border-white/10 px-3 py-1.5 text-sm bg-white/10 text-white/90 hover:bg-white/20 backdrop-blur shadow"
        >
          reset
        </button>
        <div ref={containerRef} className="h-full w-full min-h-[28rem]" />
      </div>

      {/* details panel */}
      {selectedProps && (
        <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-2 text-sm text-muted-foreground">selected flood</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
            <div><div className="text-xs uppercase text-muted-foreground">id</div><div className="font-medium">{selectedProps.id}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">date</div><div className="font-medium">{selectedProps.event_date || "—"}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">type</div><div className="font-medium">{(selectedProps.event || "").replace("_", " ")}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">location</div><div className="font-medium">{selectedProps.location || "—"}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">origin (lat, lng)</div><div className="font-mono">{fmt(selectedProps.origin_lat)}, {fmt(selectedProps.origin_lng)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">start (lat, lng)</div><div className="font-mono">{fmt(selectedProps.start_lat)}, {fmt(selectedProps.start_lng)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">pred a (lat, lng)</div><div className="font-mono">{fmt(selectedProps.end100_a_lat)}, {fmt(selectedProps.end100_a_lng)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">pred b (lat, lng)</div><div className="font-mono">{fmt(selectedProps.end100_b_lat)}, {fmt(selectedProps.end100_b_lng)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">end (lat, lng)</div><div className="font-mono">{fmt(selectedProps.end_lat)}, {fmt(selectedProps.end_lng)}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">pa / sz</div><div className="font-mono">
              {(paNameMap.get(String(selectedProps.start_pa_id || "")) || selectedProps.start_pa_id || "—")}
              {" / "}
              {(szNameMap.get(String(selectedProps.start_sz_id || "")) || selectedProps.start_sz_id || "—")}
            </div></div>
            <div><div className="text-xs uppercase text-muted-foreground">postal</div><div className="font-mono">{selectedProps.start_postal_code || "—"}</div></div>
            <div><div className="text-xs uppercase text-muted-foreground">parent road</div><div className="font-mono">{selectedProps.parent_road || "—"}</div></div>
          </div>
        </div>
      )}

      {/* table */}
      <div className="overflow-auto rounded-3xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2">id</th>
              <th className="px-4 py-2">date</th>
              <th className="px-4 py-2">type</th>
              <th className="px-4 py-2">planning area</th>
              <th className="px-4 py-2">subzone</th>
              <th className="px-4 py-2">location</th>
              <th className="px-4 py-2">road</th>
              <th className="px-4 py-2">postal</th>
              <th className="px-4 py-2">action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const active = String(selected ?? "") === String(r.id);
              return (
                <tr
                  key={r.id}
                  className={`hover:bg-muted/50 ${active ? "bg-blue-100/30 font-semibold" : ""}`}
                >
                  <td className="px-4 py-2">{r.id}</td>
                  <td className="px-4 py-2">{r.event_date}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-md bg-blue-500/10 px-2 py-0.5 text-xs capitalize text-blue-400 border border-blue-400/20">
                      {r.event.replace("_"," ")}
                    </span>
                  </td>
                  <td className="px-4 py-2">{r.planning_area || "—"}</td>
                  <td className="px-4 py-2">{r.subzone || "—"}</td>
                  <td className="px-4 py-2">{r.location}</td>
                  <td className="px-4 py-2">{r.parent_road || "—"}</td>
                  <td className="px-4 py-2">{r.start_postal_code || "—"}</td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setSelected(r.id)}
                      className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                    >
                      view on map
                    </button>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                  no rows match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* popup dark css */}
      <style>{`
        .mapboxgl-popup.popup-dark .mapboxgl-popup-content {
          background: rgba(2, 6, 23, 0.96);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          padding: 10px 12px;
        }
        .mapboxgl-popup.popup-dark .mapboxgl-popup-close-button { color: #94a3b8; }
        .mapboxgl-popup.popup-dark .mapboxgl-popup-tip {
          border-top-color: rgba(2, 6, 23, 0.96) !important;
          border-bottom-color: rgba(2, 6, 23, 0.96) !important;
          border-left-color: rgba(2, 6, 23, 0.96) !important;
          border-right-color: rgba(2, 6, 23, 0.96) !important;
        }
        .flood-popup .title { font-weight: 600; margin-bottom: 2px; color:#f8fafc; }
        .flood-popup .sub { font-size: 12px; opacity: .7; }
        .flood-popup .row { margin-top: 6px; }
        .flood-popup .grid {
          margin-top: 8px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px 12px;
          font-size: 12px;
        }
        .flood-popup span { color:#94a3b8; text-transform: uppercase; font-size: 10px; letter-spacing: .02em; display:block; }
        .flood-popup code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color:#e5e7eb; 
        
        /* dark-friendly legend */
            .flood-legend {
            /* dark default */
            background: rgba(2, 6, 23, 0.92);       /* near-black */
            color: #e5e7eb;                          /* slate-200 */
            border: 1px solid rgba(148, 163, 184, .25); /* slate-400/25 */
            backdrop-filter: blur(6px) saturate(120%);
            }

            /* light mode fallback */
            @media (prefers-color-scheme: light) {
            .flood-legend {
                background: rgba(255, 255, 255, 0.92);
                color: #0f172a;                        /* slate-900 */
                border-color: rgba(15, 23, 42, .08);   /* subtle dark border */
            }
            }

            /* circular, fully-filled color chips */
            .flood-legend .legend-swatch {
            display: inline-block;
            width: 12px; height: 12px;
            border-radius: 9999px;
            border: 1px solid rgba(0,0,0,.4);
            background: currentColor;
            }

            /* let each swatch take its hex from data-color */
            .flood-legend .legend-swatch[data-color] {
            color: var(--legend-color, #999);
            }
            .flood-legend .legend-swatch[data-color="#22c55e"] { --legend-color: #22c55e; }
            .flood-legend .legend-swatch[data-color="#3b82f6"] { --legend-color: #3b82f6; }
            .flood-legend .legend-swatch[data-color="#f59e0b"] { --legend-color: #f59e0b; }
            .flood-legend .legend-swatch[data-color="#ef4444"] { --legend-color: #ef4444; }

            /* make mapbox controls readable on dark backgrounds */
            .mapboxgl-ctrl {
            background: rgba(2, 6, 23, 0.8) !important;
            border: 1px solid rgba(148, 163, 184, 0.25) !important;
            border-radius: 10px !important;
            }
            .mapboxgl-ctrl button {
            color: #e5e7eb !important;
            }

        
        }
      `}</style>
    </div>
  );
}
