// src/pages/simulation.jsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMapData } from "@/context/MapDataContext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { X, MapPin, Play, Download, ArrowLeft, ArrowRight, ChevronRight, AlertCircle, Search } from "lucide-react";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/light-v11";

/* ============================== helpers ============================== */
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const toNum = (v) => { const n = +v; return Number.isFinite(n) ? n : null; };
const fmtM = (s) => (Number.isFinite(s) ? (s / 60).toFixed(1) + "m" : "—");
const dist2 = (a, b) => { if (!a || !b) return Number.POSITIVE_INFINITY; const dx=a[0]-b[0], dy=a[1]-b[1]; return dx*dx+dy*dy; };

/* ========================= priority queue ======================= */
class MinPQ {
  constructor() { this.a = []; }
  _swap(i, j) { [this.a[i], this.a[j]] = [this.a[j], this.a[i]]; }
  _up(i) { while (i) { const p=(i-1)>>1; if (this.a[p].k<=this.a[i].k) break; this._swap(i,p); i=p; } }
  _down(i) {
    const n=this.a.length;
    for(;;){ let l=i*2+1,r=l+1,m=i;
      if(l<n && this.a[l].k<this.a[m].k) m=l;
      if(r<n && this.a[r].k<this.a[m].k) m=r;
      if(m===i) break; this._swap(i,m); i=m;
    }
  }
  push(k,v){ this.a.push({k,v}); this._up(this.a.length-1); }
  pop(){ if(!this.a.length) return null; const t=this.a[0]; const b=this.a.pop(); if(this.a.length){ this.a[0]=b; this._down(0); } return t; }
  size(){ return this.a.length; }
}

/* ==================== graph builder ================= */
function buildGraph(road_fc) {
  const nodes = new Map();
  const adj = new Map();
  const edges = [];

  const nodeMetaFromEdge = (p, which, coords) => {
    const coord = which === "u" ? coords[0] : coords[coords.length - 1];
    return {
      coord,
      paId: toInt(p.PA_ID ?? p.pa_id),
      paName: p.PLN_AREA_N ?? p.pln_area_n ?? null,
    };
  };

  for (const f of road_fc?.features || []) {
    const p = f.properties || {};
    const u = toInt(p.u), v = toInt(p.v);
    const w = toNum(p.travel_time);
    const rn_id = toInt(p.RN_ID ?? p.rn_id);
    const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : [];
    if (u == null || v == null || !Number.isFinite(w) || !coords.length) continue;

    if (!nodes.has(u)) nodes.set(u, { id: u, ...nodeMetaFromEdge(p, "u", coords) });
    if (!nodes.has(v)) nodes.set(v, { id: v, ...nodeMetaFromEdge(p, "v", coords) });

    if (!adj.has(u)) adj.set(u, []);
    const e1 = { from: u, to: v, w, rn_id, coords, feature: f };
    adj.get(u).push(e1); edges.push(e1);

    const oneway = String(p.oneway ?? "true").toLowerCase() === "true";
    if (!oneway) {
      if (!adj.has(v)) adj.set(v, []);
      const e2 = { from: v, to: u, w, rn_id, coords: [...coords].reverse(), feature: f };
      adj.get(v).push(e2); edges.push(e2);
    }
  }
  return { nodes, adj, edges };
}

/* ================== snap hospitals ============== */
function snapHospitalsToNodes(amenity_fc, nodes) {
  const hospitals = [];
  const nodeArr = Array.from(nodes.values());
  for (const f of amenity_fc?.features || []) {
    const p = f.properties || {};
    if (String(p.amenity_type).toLowerCase() !== "moh_hospitals") continue;
    const pt = f.geometry?.coordinates;
    if (!pt || !Number.isFinite(+pt[0]) || !Number.isFinite(+pt[1])) continue;

    let best = null;
    for (const n of nodeArr) {
      const d2 = dist2(pt, n.coord);
      if (best == null || d2 < best.d2) best = { nodeId: n.id, d2, node: n };
    }
    if (best) {
      hospitals.push({
        hosp_id: p.amenity_id ?? String(hospitals.length),
        hosp_name: p.amenity_name ?? "hospital",
        node_id: best.nodeId,
        pt,
      });
    }
  }
  return hospitals;
}

/* ======================== dijkstra ======================= */
function multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter) {
  const dist = new Map();
  const pq = new MinPQ();

  for (const s of hospitalNodeIds) { dist.set(s, 0); pq.push(0, s); }

  let visited = 0;
  while (pq.size()) {
    const { k: d, v: u } = pq.pop();
    if (d !== dist.get(u)) continue;
    visited++; if (visited % 5000 === 0) onProgress?.(visited);

    const edges = adj.get(u);
    if (!edges) continue;
    for (const e of edges) {
      if (edgeFilter && !edgeFilter(e)) continue;
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        pq.push(nd, e.to);
      }
    }
  }
  onProgress?.(visited);
  return { dist, visited };
}

/* ==================== compute per-PA stats ============= */
function computePerPAStats({ graph, amenity_fc_enriched, onProgress, edgeFilter }) {
  const { nodes, adj } = graph;
  const hospitals = snapHospitalsToNodes(amenity_fc_enriched, nodes);
  if (!hospitals.length) throw new Error("No moh_hospitals found.");

  const hospitalNodeIds = hospitals.map(h => h.node_id);
  const { dist } = multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter);

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

  return { paStats, hospitalsCount: hospitals.length, nodesCount: nodes.size };
}

/* ============================= Color scale ============================ */
function getColorForValue(value, maxValue, isBaseline = false) {
  if (!Number.isFinite(value) || value <= 0) return "#d1d5db";

  if (isBaseline) {
    // Baseline: green (low time) to blue (high time)
    const ratio = Math.min(1, value / maxValue);
    if (ratio < 0.25) return "#86efac"; // green
    if (ratio < 0.5) return "#60a5fa"; // blue-400
    if (ratio < 0.75) return "#3b82f6"; // blue-500
    return "#1d4ed8"; // blue-700
  } else {
    // Delta: green (low increase) to red (high increase)
    const ratio = Math.min(1, value / maxValue);
    if (ratio < 0.25) return "#86efac";
    if (ratio < 0.5) return "#fde047";
    if (ratio < 0.75) return "#fb923c";
    return "#ef4444";
  }
}

/* ============================= CSV ============================ */
function toCSV(arr) {
  if (!arr?.length) return "";
  const headers = Object.keys(arr[0]);
  const esc = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replaceAll('"','""')}"` : String(v));
  const lines = [headers.join(",")];
  for (const obj of arr) lines.push(headers.map(h => esc(obj[h])).join(","));
  return lines.join("\n");
}

function downloadCSV(name, rows) {
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/* =============================== Page ================================= */
export default function Simulation() {
  const { road_fc_enriched, amenity_fc_enriched, lookups, loading, error } = useMapData();

  // Build graph
  const graph = useMemo(() => {
    if (!road_fc_enriched?.features?.length) return { nodes: new Map(), adj: new Map(), edges: [] };
    return buildGraph(road_fc_enriched);
  }, [road_fc_enriched]);

  const ready = useMemo(
    () => !!graph.nodes?.size && !!graph.edges?.length && !!amenity_fc_enriched?.features?.length,
    [graph, amenity_fc_enriched]
  );

  // Stepper state
  const [step, setStep] = useState(1);
  const [floodInputMethod, setFloodInputMethod] = useState("manual"); // "manual" | "scenario"
  const [selectedScenario, setSelectedScenario] = useState("");
  const [floodScenarios, setFloodScenarios] = useState([]);

  // Manual flood configuration
  const [floodMarkers, setFloodMarkers] = useState([]);
  const [affectedRoads, setAffectedRoads] = useState([]);
  const [roadSearchTerm, setRoadSearchTerm] = useState("");

  // Maps
  const baselineMapRef = useRef(null);
  const floodedMapRef = useRef(null);
  const baselineContainerRef = useRef(null);
  const floodedContainerRef = useRef(null);
  const configMapRef = useRef(null);
  const configContainerRef = useRef(null);

  // Computation state
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [baselineStats, setBaselineStats] = useState(null);
  const [floodedStats, setFloodedStats] = useState(null);
  const [paDeltas, setPaDeltas] = useState([]);
  const [selectedPA, setSelectedPA] = useState(null);
  const [hoveredPA, setHoveredPA] = useState(null);

  // Load flood scenarios CSV
  useEffect(() => {
    fetch("/data/road_network_flood_scenarios.csv")
      .then(res => res.text())
      .then(text => {
        const lines = text.trim().split("\n");
        if (lines.length < 2) return;

        const headers = lines[0].split(",");
        const scenarioCol = headers.indexOf("flood_scenario");
        const rnIdCol = headers.indexOf("RN_ID");
        const nameCol = headers.indexOf("RD_NAME");

        if (scenarioCol === -1 || rnIdCol === -1) return;

        const byScenario = new Map();
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(",");
          const scenario = cols[scenarioCol]?.trim();
          const rn_id = toInt(cols[rnIdCol]);
          const name = cols[nameCol]?.trim() || `Road ${rn_id}`;

          if (!scenario || rn_id == null) continue;

          if (!byScenario.has(scenario)) {
            byScenario.set(scenario, []);
          }
          byScenario.get(scenario).push({ rn_id, name });
        }

        const scenarios = Array.from(byScenario.entries()).map(([name, roads]) => ({
          name,
          roads,
        }));
        setFloodScenarios(scenarios);
        console.log("Loaded scenarios:", scenarios.length, scenarios);
      })
      .catch(err => console.error("Failed to load scenarios:", err));
  }, []);

  // Reset markers when going back to step 1
  useEffect(() => {
    if (step === 1) {
      setFloodMarkers([]);
      setAffectedRoads([]);
      setRoadSearchTerm("");
      setSelectedPA(null);
      setHoveredPA(null);
    }
  }, [step]);

  // Initialize config map
  useEffect(() => {
    if (!configContainerRef.current || configMapRef.current || step !== 2 || floodInputMethod !== "manual") return;

    const map = new mapboxgl.Map({
      container: configContainerRef.current,
      style: mapbox_style,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
    });
    configMapRef.current = map;

    map.on("load", () => {
      map.addSource("markers", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "radius-fill",
        type: "fill",
        source: "radius",
        paint: { "fill-color": "#ef4444", "fill-opacity": 0.1 },
      });
      map.addLayer({
        id: "radius-line",
        type: "line",
        source: "radius",
        paint: { "line-color": "#ef4444", "line-width": 2, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: "roads",
        paint: { "line-color": "#ef4444", "line-width": 3, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "markers-circle",
        type: "circle",
        source: "markers",
        paint: { "circle-radius": 8, "circle-color": "#ef4444", "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
      });
    });

    map.on("click", (e) => {
      const { lng, lat } = e.lngLat;
      const id = `marker-${Date.now()}`;
      setFloodMarkers(prev => [...prev, { id, lng, lat, radius: 500 }]);
    });

    return () => {
      if (configMapRef.current) {
        configMapRef.current.remove();
        configMapRef.current = null;
      }
    };
  }, [step, floodInputMethod]);

  // Update config map markers
  useEffect(() => {
    const map = configMapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const markerFeatures = floodMarkers.map(m => ({
      type: "Feature",
      properties: { id: m.id },
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
    }));

    const radiusFeatures = floodMarkers.map(m => {
      const radiusInKm = m.radius / 1000;
      const points = 64;
      const coords = [];
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * 2 * Math.PI;
        const dx = radiusInKm * Math.cos(angle) / 111;
        const dy = radiusInKm * Math.sin(angle) / 111;
        coords.push([m.lng + dx, m.lat + dy]);
      }
      return {
        type: "Feature",
        properties: { id: m.id },
        geometry: { type: "Polygon", coordinates: [coords] },
      };
    });

    map.getSource("markers")?.setData({ type: "FeatureCollection", features: markerFeatures });
    map.getSource("radius")?.setData({ type: "FeatureCollection", features: radiusFeatures });
  }, [floodMarkers]);

  // Find affected roads
  useEffect(() => {
    if (floodInputMethod !== "manual" || !floodMarkers.length) {
      setAffectedRoads([]);
      return;
    }

    const seenRnIds = new Set();
    const roads = [];

    for (const marker of floodMarkers) {
      const radDeg = marker.radius / 111000;
      const rad2 = radDeg * radDeg;
      const center = [marker.lng, marker.lat];

      for (const e of graph.edges) {
        if (e.rn_id == null || seenRnIds.has(e.rn_id)) continue;

        let affected = false;
        if (Array.isArray(e.coords)) {
          for (const pt of e.coords) {
            if (dist2(pt, center) <= rad2) {
              affected = true;
              break;
            }
          }
        }

        if (affected) {
          seenRnIds.add(e.rn_id);
          const props = e.feature?.properties || {};
          roads.push({
            rn_id: e.rn_id,
            name: props.name ?? props.NAME ?? `Road ${e.rn_id}`,
            coords: e.coords,
            selected: true,
          });
        }
      }
    }

    setAffectedRoads(roads);
  }, [floodMarkers, floodInputMethod, graph.edges]);

  // Update roads on config map
  useEffect(() => {
    const map = configMapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const selectedRoads = affectedRoads.filter(r => r.selected);
    const features = selectedRoads.map(r => ({
      type: "Feature",
      properties: { rn_id: r.rn_id },
      geometry: { type: "LineString", coordinates: r.coords },
    }));

    map.getSource("roads")?.setData({ type: "FeatureCollection", features });
  }, [affectedRoads]);

  // Build edge filter
  const edgeFilter = useMemo(() => {
    let blockedRnIds = new Set();

    if (floodInputMethod === "manual") {
      blockedRnIds = new Set(affectedRoads.filter(r => r.selected).map(r => r.rn_id));
    } else if (floodInputMethod === "scenario" && selectedScenario) {
      const scenario = floodScenarios.find(s => s.name === selectedScenario);
      if (scenario) {
        blockedRnIds = new Set(scenario.roads.map(r => r.rn_id));
      }
    }

    if (!blockedRnIds.size) return null;

    return (e) => {
      if (e.rn_id != null && blockedRnIds.has(e.rn_id)) return false;
      return true;
    };
  }, [floodInputMethod, affectedRoads, selectedScenario, floodScenarios]);

  // Run simulation
  const runSimulation = useCallback(async () => {
    if (!ready || !edgeFilter) return;
    setBusy(true);
    setProgress(0);

    try {
      // Baseline
      const baseline = computePerPAStats({
        graph,
        amenity_fc_enriched,
        onProgress: (v) => setProgress(v),
        edgeFilter: null,
      });
      setBaselineStats(baseline);

      // Flooded
      setProgress(0);
      const flooded = computePerPAStats({
        graph,
        amenity_fc_enriched,
        onProgress: (v) => setProgress(v),
        edgeFilter,
      });
      setFloodedStats(flooded);

      // Deltas
      const baseByName = new Map();
      for (const pa of baseline.paStats) {
        baseByName.set(pa.pa_name, pa);
      }

      const deltas = [];
      for (const paFlood of flooded.paStats) {
        const paBase = baseByName.get(paFlood.pa_name);
        if (!paBase) continue;

        const delta_avg_s = (paFlood.avg_s ?? 0) - (paBase.avg_s ?? 0);
        const delta_unreachable = paFlood.unreachable - paBase.unreachable;

        deltas.push({
          pa_id: paFlood.pa_id,
          pa_name: paFlood.pa_name,
          total_nodes: paFlood.nodes,
          base_avg_s: paBase.avg_s,
          base_unreachable: paBase.unreachable,
          flood_avg_s: paFlood.avg_s,
          flood_unreachable: paFlood.unreachable,
          delta_avg_s,
          delta_unreachable,
        });
      }
      setPaDeltas(deltas);
      setStep(4);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Simulation failed");
    } finally {
      setBusy(false);
    }
  }, [ready, graph, amenity_fc_enriched, edgeFilter]);

  // Initialize result maps
  useEffect(() => {
    if (step !== 4 || !baselineStats || !floodedStats || !lookups?.planning) return;

    // Baseline map
    if (baselineContainerRef.current && !baselineMapRef.current) {
      const map = new mapboxgl.Map({
        container: baselineContainerRef.current,
        style: mapbox_style,
        center: [103.82, 1.35],
        zoom: 10,
        attributionControl: false,
      });
      baselineMapRef.current = map;

      map.on("load", () => {
        map.addSource("choropleth", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "choropleth-fill",
          type: "fill",
          source: "choropleth",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "hover"], false],
              0.8,
              0.6
            ]
          },
        });
        map.addLayer({
          id: "choropleth-line",
          type: "line",
          source: "choropleth",
          paint: { "line-color": "#000", "line-width": 1, "line-opacity": 0.3 },
        });

        // Add baseline data
        const maxTime = Math.max(...baselineStats.paStats.map(pa => pa.avg_s || 0), 1);
        const paById = new Map(baselineStats.paStats.map(pa => [pa.pa_id, pa]));
        const features = [];
        for (const pa of Object.values(lookups.planning.by_id || {})) {
          const stats = paById.get(pa.id);
          const color = stats ? getColorForValue(stats.avg_s, maxTime, true) : "#d1d5db";
          if (pa.geometry) {
            features.push({
              type: "Feature",
              id: pa.id,
              properties: {
                pa_id: pa.id,
                pa_name: pa.name,
                color,
                avg_s: stats?.avg_s || 0,
                nodes: stats?.nodes || 0,
                unreachable: stats?.unreachable || 0,
              },
              geometry: pa.geometry,
            });
          }
        }
        map.getSource("choropleth")?.setData({ type: "FeatureCollection", features });

        // Add hover cursor
        map.on("mousemove", "choropleth-fill", (e) => {
          map.getCanvas().style.cursor = "pointer";
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const props = feature.properties;

            const html = `
              <div class="font-semibold">${props.pa_name}</div>
              <div class="text-sm mt-1">Avg Time: ${fmtM(props.avg_s)}</div>
              <div class="text-sm">Total Nodes: ${props.nodes}</div>
              <div class="text-sm">Unreachable: ${props.unreachable}</div>
            `;

            new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
          }
        });

        map.on("mouseleave", "choropleth-fill", () => {
          map.getCanvas().style.cursor = "";
          const popups = document.getElementsByClassName("mapboxgl-popup");
          if (popups.length) popups[0].remove();
        });
      });
    }

    // Flooded map
    if (floodedContainerRef.current && !floodedMapRef.current) {
      const map = new mapboxgl.Map({
        container: floodedContainerRef.current,
        style: mapbox_style,
        center: [103.82, 1.35],
        zoom: 10,
        attributionControl: false,
      });
      floodedMapRef.current = map;

      map.on("load", () => {
        map.addSource("choropleth", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

        map.addLayer({
          id: "choropleth-fill",
          type: "fill",
          source: "choropleth",
          paint: {
            "fill-color": ["get", "color"],
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.4,
              ["boolean", ["feature-state", "hover"], false],
              0.8,
              0.6
            ]
          },
        });
        map.addLayer({
          id: "choropleth-line",
          type: "line",
          source: "choropleth",
          paint: {
            "line-color": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              "#3b82f6",
              "#000"
            ],
            "line-width": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              3,
              1
            ],
            "line-opacity": 0.6
          },
        });
        map.addLayer({
          id: "roads-line",
          type: "line",
          source: "roads",
          paint: { "line-color": "#ef4444", "line-width": 3, "line-opacity": 0.8 },
        });

        // Add delta data
        const maxDelta = Math.max(...paDeltas.map(d => d.delta_avg_s || 0), 1);
        const paById = new Map(paDeltas.map(d => [d.pa_id, d]));
        const features = [];
        for (const pa of Object.values(lookups.planning.by_id || {})) {
          const delta = paById.get(pa.id);
          const color = delta ? getColorForValue(delta.delta_avg_s, maxDelta, false) : "#d1d5db";
          if (pa.geometry) {
            features.push({
              type: "Feature",
              id: pa.id,
              properties: {
                pa_id: pa.id,
                pa_name: pa.name,
                color,
                total_nodes: delta?.total_nodes || 0,
                base_avg_s: delta?.base_avg_s || 0,
                flood_avg_s: delta?.flood_avg_s || 0,
                delta_avg_s: delta?.delta_avg_s || 0,
                base_unreachable: delta?.base_unreachable || 0,
                flood_unreachable: delta?.flood_unreachable || 0,
                delta_unreachable: delta?.delta_unreachable || 0,
              },
              geometry: pa.geometry,
            });
          }
        }
        map.getSource("choropleth")?.setData({ type: "FeatureCollection", features });

        // Add hover popup
        map.on("mousemove", "choropleth-fill", (e) => {
          map.getCanvas().style.cursor = "pointer";
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const props = feature.properties;

            const html = `
              <div class="font-semibold">${props.pa_name}</div>
              <div class="text-xs mt-1">Total Nodes: ${props.total_nodes}</div>
              <div class="text-xs mt-2"><strong>Baseline:</strong></div>
              <div class="text-xs">Avg Time: ${fmtM(props.base_avg_s)}</div>
              <div class="text-xs">Unreachable: ${props.base_unreachable}</div>
              <div class="text-xs mt-1"><strong>Flooded:</strong></div>
              <div class="text-xs">Avg Time: ${fmtM(props.flood_avg_s)}</div>
              <div class="text-xs">Unreachable: ${props.flood_unreachable}</div>
              <div class="text-xs mt-1 font-semibold text-red-600"><strong>Delta:</strong></div>
              <div class="text-xs text-red-600">Δ Time: +${fmtM(props.delta_avg_s)}</div>
              <div class="text-xs text-red-600">Δ Unreachable: +${props.delta_unreachable}</div>
              <div class="text-xs mt-1 text-muted-foreground">Click to view roads</div>
            `;

            new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
          }
        });

        map.on("mouseleave", "choropleth-fill", () => {
          map.getCanvas().style.cursor = "";
          const popups = document.getElementsByClassName("mapboxgl-popup");
          if (popups.length) popups[0].remove();
        });

        // Add click handler to show roads
        map.on("click", "choropleth-fill", (e) => {
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const paId = feature.properties.pa_id;
            const paName = feature.properties.pa_name;

            // Clear previous selection
            if (selectedPA) {
              map.removeFeatureState({ source: "choropleth", id: selectedPA.pa_id });
            }

            // Set new selection
            map.setFeatureState({ source: "choropleth", id: paId }, { selected: true });
            setSelectedPA({ pa_id: paId, pa_name: paName });

            // Filter roads within this planning area
            const roadsInPA = [];
            for (const edge of graph.edges) {
              const nodeFrom = graph.nodes.get(edge.from);
              const nodeTo = graph.nodes.get(edge.to);
              if (nodeFrom?.paId === paId || nodeTo?.paId === paId) {
                if (edge.rn_id != null && edge.coords) {
                  roadsInPA.push({
                    type: "Feature",
                    properties: {
                      rn_id: edge.rn_id,
                      name: edge.feature?.properties?.name || `Road ${edge.rn_id}`,
                      travel_time: edge.w,
                    },
                    geometry: { type: "LineString", coordinates: edge.coords },
                  });
                }
              }
            }

            // Show roads on map
            map.getSource("roads")?.setData({
              type: "FeatureCollection",
              features: roadsInPA,
            });

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
          }
        });

        // Add road hover
        map.on("mousemove", "roads-line", (e) => {
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const props = feature.properties;

            const html = `
              <div class="font-semibold">${props.name}</div>
              <div class="text-xs mt-1">RN_ID: ${props.rn_id}</div>
              <div class="text-xs">Travel Time: ${fmtM(props.travel_time)}</div>
            `;

            new mapboxgl.Popup({ closeButton: false, closeOnClick: false })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);
          }
        });

        map.on("mouseleave", "roads-line", () => {
          const popups = document.getElementsByClassName("mapboxgl-popup");
          if (popups.length) popups[0].remove();
        });
      });
    }

    return () => {
      if (baselineMapRef.current) { baselineMapRef.current.remove(); baselineMapRef.current = null; }
      if (floodedMapRef.current) { floodedMapRef.current.remove(); floodedMapRef.current = null; }
    };
  }, [step, baselineStats, floodedStats, paDeltas, lookups]);

  const canProceedToStep2 = floodInputMethod === "manual" || (floodInputMethod === "scenario" && selectedScenario);
  const canProceedToStep3 = floodInputMethod === "scenario" ? !!selectedScenario : floodMarkers.length > 0;

  // Filter roads by search term
  const filteredAffectedRoads = useMemo(() => {
    if (!roadSearchTerm.trim()) return affectedRoads;
    const term = roadSearchTerm.toLowerCase();
    return affectedRoads.filter(r =>
      r.name.toLowerCase().includes(term) ||
      String(r.rn_id).includes(term)
    );
  }, [affectedRoads, roadSearchTerm]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-500">{String(error)}</div>;

  return (
    <div className="flex flex-col h-screen">
      {/* Header with stepper */}
      <div className="border-b p-6">
        <h1 className="text-2xl font-semibold mb-4">Flood Impact Simulation</h1>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                  s === step ? "bg-primary text-primary-foreground" : s < step ? "bg-green-500 text-white cursor-pointer hover:bg-green-600" : "bg-muted text-muted-foreground"
                }`}
                onClick={() => {
                  if (s < step) setStep(s);
                }}
              >
                {s}
              </div>
              {s < 4 && <ChevronRight className="h-4 w-4 mx-1 text-muted-foreground" />}
            </div>
          ))}
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          {step === 1 && "Choose flood input method"}
          {step === 2 && "Configure flood details"}
          {step === 3 && "Review and run simulation"}
          {step === 4 && "View results"}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Step 1: Choose Method */}
        {step === 1 && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>How would you like to define the flood event?</CardTitle>
              <CardDescription>Choose between predefined scenarios or manually marking locations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={floodInputMethod} onValueChange={setFloodInputMethod}>
                <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50" onClick={() => setFloodInputMethod("scenario")}>
                  <RadioGroupItem value="scenario" id="scenario" />
                  <div className="flex-1">
                    <Label htmlFor="scenario" className="cursor-pointer font-semibold">Use Predefined Scenario</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Select from historical flood scenarios (e.g., Historical_highest60mins)
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50" onClick={() => setFloodInputMethod("manual")}>
                  <RadioGroupItem value="manual" id="manual" />
                  <div className="flex-1">
                    <Label htmlFor="manual" className="cursor-pointer font-semibold">Manually Mark Locations</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Click on map to add flood markers and configure radius for each
                    </p>
                  </div>
                </div>
              </RadioGroup>

              {floodInputMethod === "scenario" && (
                <div className="mt-4 space-y-2">
                  <Label>Select Scenario</Label>
                  <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a scenario..." />
                    </SelectTrigger>
                    <SelectContent>
                      {floodScenarios.map((s) => (
                        <SelectItem key={s.name} value={s.name}>
                          {s.name} ({s.roads.length} roads)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <Button onClick={() => setStep(2)} disabled={!canProceedToStep2}>
                  Next <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Configure */}
        {step === 2 && (
          <div className="space-y-4">
            {floodInputMethod === "manual" ? (
              <div className="grid grid-cols-[400px_1fr] gap-4 h-[calc(100vh-16rem)]">
                <Card>
                  <CardHeader>
                    <CardTitle>Flood Markers</CardTitle>
                    <CardDescription>Click map to add markers</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ScrollArea className="h-[calc((100vh-28rem)/2)]">
                      <div className="space-y-3">
                        {floodMarkers.map((marker, idx) => (
                          <div key={marker.id} className="border rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">Marker {idx + 1}</span>
                              <Button size="sm" variant="ghost" onClick={() => setFloodMarkers(prev => prev.filter(m => m.id !== marker.id))}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              {marker.lng.toFixed(4)}, {marker.lat.toFixed(4)}
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Radius: {marker.radius}m</Label>
                              <Slider
                                value={[marker.radius]}
                                min={100}
                                max={2000}
                                step={50}
                                onValueChange={(v) => {
                                  setFloodMarkers(prev => prev.map(m => m.id === marker.id ? { ...m, radius: v[0] } : m));
                                }}
                              />
                            </div>
                          </div>
                        ))}
                        {floodMarkers.length === 0 && (
                          <div className="text-center text-sm text-muted-foreground py-8">
                            Click on the map to add flood markers
                          </div>
                        )}
                      </div>
                    </ScrollArea>

                    {affectedRoads.length > 0 && (
                      <>
                        <Separator />
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-sm font-semibold">Affected Roads ({affectedRoads.filter(r => r.selected).length}/{affectedRoads.length})</Label>
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" onClick={() => setAffectedRoads(prev => prev.map(r => ({ ...r, selected: true })))}>All</Button>
                              <Button size="sm" variant="outline" onClick={() => setAffectedRoads(prev => prev.map(r => ({ ...r, selected: false })))}>None</Button>
                            </div>
                          </div>
                          <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder="Search roads..."
                              value={roadSearchTerm}
                              onChange={(e) => setRoadSearchTerm(e.target.value)}
                              className="pl-8 h-9"
                            />
                          </div>
                          <ScrollArea className="h-[calc((100vh-28rem)/2)] border rounded p-2">
                            <div className="space-y-2">
                              {filteredAffectedRoads.map((road) => (
                                <div key={road.rn_id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`road-${road.rn_id}`}
                                    checked={road.selected}
                                    onCheckedChange={() => setAffectedRoads(prev => prev.map(r => r.rn_id === road.rn_id ? { ...r, selected: !r.selected } : r))}
                                  />
                                  <label htmlFor={`road-${road.rn_id}`} className="text-xs flex-1 cursor-pointer">{road.name}</label>
                                </div>
                              ))}
                              {filteredAffectedRoads.length === 0 && (
                                <div className="text-center text-sm text-muted-foreground py-4">
                                  No roads match your search
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <div ref={configContainerRef} className="rounded-lg border" />
              </div>
            ) : (
              <Card className="max-w-2xl mx-auto">
                <CardHeader>
                  <CardTitle>Scenario Configuration</CardTitle>
                  <CardDescription>Review the selected scenario</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="font-semibold">{selectedScenario}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {floodScenarios.find(s => s.name === selectedScenario)?.roads.length || 0} roads will be blocked
                    </div>
                  </div>

                  <ScrollArea className="h-64 border rounded-lg p-4">
                    <div className="space-y-2">
                      {floodScenarios.find(s => s.name === selectedScenario)?.roads.map((road, idx) => (
                        <div key={idx} className="text-sm border-b py-2">
                          <div className="font-medium">{road.name}</div>
                          <div className="text-xs text-muted-foreground">RN_ID: {road.rn_id}</div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between max-w-6xl mx-auto">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canProceedToStep3}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Run */}
        {step === 3 && (
          <Card className="max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle>Review Configuration</CardTitle>
              <CardDescription>Confirm your flood scenario before running simulation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="font-semibold">Input Method:</span>
                  <span className="capitalize">{floodInputMethod}</span>
                </div>
                {floodInputMethod === "scenario" && (
                  <div className="flex justify-between">
                    <span className="font-semibold">Scenario:</span>
                    <span>{selectedScenario}</span>
                  </div>
                )}
                {floodInputMethod === "manual" && (
                  <div className="flex justify-between">
                    <span className="font-semibold">Flood Markers:</span>
                    <span>{floodMarkers.length}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-semibold">Roads Blocked:</span>
                  <span>{floodInputMethod === "manual" ? affectedRoads.filter(r => r.selected).length : floodScenarios.find(s => s.name === selectedScenario)?.roads.length || 0}</span>
                </div>
              </div>

              {busy && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Computing... {progress.toLocaleString()} nodes visited</div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className="h-full bg-primary transition-all" style={{ width: "50%" }} />
                  </div>
                </div>
              )}

              <div className="flex justify-between mt-6">
                <Button variant="outline" onClick={() => setStep(2)} disabled={busy}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button onClick={runSimulation} disabled={!ready || busy}>
                  <Play className="mr-2 h-4 w-4" /> Run Simulation
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Results */}
        {step === 4 && baselineStats && floodedStats && (
          <div className="space-y-6">
            {/* Side-by-side maps */}
            <div className="grid grid-cols-2 gap-4" style={{ height: "50vh" }}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Baseline (No Flooding)</CardTitle>
                  <CardDescription>Average time to nearest hospital</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div ref={baselineContainerRef} style={{ height: "calc(50vh - 5rem)" }} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Flooded Scenario - Delta Impact</CardTitle>
                  <CardDescription>Hover to see impact, click planning area to view roads</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div ref={floodedContainerRef} style={{ height: "calc(50vh - 5rem)" }} />
                </CardContent>
              </Card>
            </div>

            {/* Results table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Planning Area Impact Analysis</CardTitle>
                    <CardDescription>Comparison of baseline vs flooded scenarios</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadCSV("simulation_results.csv", paDeltas)}>
                    <Download className="h-4 w-4 mr-2" /> Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="border rounded-lg overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="[&>th]:px-3 [&>th]:py-2 text-left text-xs">
                        <th>Planning Area</th>
                        <th>Total Nodes</th>
                        <th>Baseline Avg</th>
                        <th>Baseline Unreachable</th>
                        <th>Flooded Avg</th>
                        <th>Flooded Unreachable</th>
                        <th>Δ Avg Time</th>
                        <th>Δ Unreachable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paDeltas.sort((a, b) => (b.delta_avg_s || 0) - (a.delta_avg_s || 0)).map((d, i) => (
                        <tr key={i} className="border-t [&>td]:px-3 [&>td]:py-2">
                          <td className="font-medium">{d.pa_name}</td>
                          <td className="text-muted-foreground">{d.total_nodes}</td>
                          <td>{fmtM(d.base_avg_s)}</td>
                          <td>{d.base_unreachable}</td>
                          <td>{fmtM(d.flood_avg_s)}</td>
                          <td className={d.flood_unreachable > d.base_unreachable ? "text-red-600 font-semibold" : ""}>{d.flood_unreachable}</td>
                          <td className={d.delta_avg_s > 0 ? "text-red-600 font-semibold" : ""}>{d.delta_avg_s > 0 ? `+${fmtM(d.delta_avg_s)}` : fmtM(d.delta_avg_s)}</td>
                          <td className={d.delta_unreachable > 0 ? "text-red-600 font-semibold" : ""}>{d.delta_unreachable > 0 ? `+${d.delta_unreachable}` : d.delta_unreachable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-start">
              <Button variant="outline" onClick={() => { setStep(1); setFloodMarkers([]); setAffectedRoads([]); setBaselineStats(null); setFloodedStats(null); setPaDeltas([]); }}>
                Start New Simulation
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
