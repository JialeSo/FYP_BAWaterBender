// src/pages/simulation.jsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMapData } from "@/context/MapDataContext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, MapPin, AlertTriangle, Play, RefreshCw } from "lucide-react";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/light-v11";

/* ============================== helpers ============================== */
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const toNum = (v) => { const n = +v; return Number.isFinite(n) ? n : null; };
const fmtS = (s) => (Number.isFinite(s) ? `${Math.round(s)}s` : "—");
const fmtM = (s) => (Number.isFinite(s) ? (s / 60).toFixed(1) + "m" : "—");
const dist2 = (a, b) => { if (!a || !b) return Number.POSITIVE_INFINITY; const dx=a[0]-b[0], dy=a[1]-b[1]; return dx*dx+dy*dy; };

/* ========================= tiny priority queue ======================= */
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

/* ==================== graph builder (directed, time) ================= */
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

/* ================== snap moh_hospitals to nearest nodes ============== */
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

/* ======================== multi-source dijkstra ======================= */
function multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter) {
  const dist = new Map();
  const srcOf = new Map();
  const pq = new MinPQ();

  for (const s of hospitalNodeIds) { dist.set(s, 0); srcOf.set(s, s); pq.push(0, s); }

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
        srcOf.set(e.to, srcOf.get(u));
        pq.push(nd, e.to);
      }
    }
  }
  onProgress?.(visited);
  return { dist, srcOf, visited };
}

/* ==================== compute per-PA accessibility stats ============= */
function computePerPAStats({ graph, amenity_fc_enriched, onProgress, edgeFilter }) {
  const { nodes, adj } = graph;
  const hospitals = snapHospitalsToNodes(amenity_fc_enriched, nodes);
  if (!hospitals.length) throw new Error("No moh_hospitals found.");

  const hospitalNodeIds = hospitals.map(h => h.node_id);
  const { dist } = multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter);

  // Aggregate by planning area
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
    avg_s: a.nodes > 0 ? a.sum_s / a.nodes : null,
    min_s: Number.isFinite(a.min_s) ? a.min_s : null,
    max_s: Number.isFinite(a.max_s) ? a.max_s : null,
    unreachable: a.unreachable,
  }));

  return { paStats, hospitalsCount: hospitals.length, nodesCount: nodes.size };
}

/* ============================= Color scale ============================ */
function getColorForDelta(deltaSeconds, maxDelta) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return "#d1d5db"; // gray
  const ratio = Math.min(1, deltaSeconds / maxDelta);
  // Color scale: green → yellow → orange → red
  if (ratio < 0.25) return "#86efac"; // green-300
  if (ratio < 0.5) return "#fde047"; // yellow-300
  if (ratio < 0.75) return "#fb923c"; // orange-400
  return "#ef4444"; // red-500
}

/* =============================== Page ================================= */
export default function Simulation() {
  const { road_fc_enriched, amenity_fc_enriched, lookups, loading, error } = useMapData();

  // Build graph (lazy)
  const graph = useMemo(() => {
    if (!road_fc_enriched?.features?.length) return { nodes: new Map(), adj: new Map(), edges: [] };
    return buildGraph(road_fc_enriched);
  }, [road_fc_enriched]);

  const ready = useMemo(
    () => !!graph.nodes?.size && !!graph.edges?.length && !!amenity_fc_enriched?.features?.length,
    [graph, amenity_fc_enriched]
  );

  // Map
  const container_ref = useRef(null);
  const map_ref = useRef(null);

  // UI state
  const [initialized, setInitialized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // Flood markers
  const [floodMarkers, setFloodMarkers] = useState([]);
  const [radiusMeters, setRadiusMeters] = useState(500);

  // Affected roads (with selection state)
  const [affectedRoads, setAffectedRoads] = useState([]); // Array of { rn_id, name, coords, selected }

  // Results
  const [baselineStats, setBaselineStats] = useState(null); // { paStats, hospitalsCount, nodesCount }
  const [floodedStats, setFloodedStats] = useState(null);
  const [paDeltas, setPaDeltas] = useState([]); // Array of { pa_id, pa_name, delta_avg_s, ... }

  // Initialize map
  useEffect(() => {
    if (!container_ref.current || map_ref.current) return;

    const map = new mapboxgl.Map({
      container: container_ref.current,
      style: mapbox_style,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
    });
    map_ref.current = map;

    map.on("load", () => {
      // Add sources
      map.addSource("flood-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("flood-radius", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("affected-roads", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("planning-areas-choropleth", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Choropleth layer (planning areas colored by delta)
      map.addLayer({
        id: "pa-choropleth-fill",
        type: "fill",
        source: "planning-areas-choropleth",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.6,
        },
      });
      map.addLayer({
        id: "pa-choropleth-line",
        type: "line",
        source: "planning-areas-choropleth",
        paint: {
          "line-color": "#000000",
          "line-width": 1,
          "line-opacity": 0.3,
        },
      });

      // Affected roads layer
      map.addLayer({
        id: "affected-roads-line",
        type: "line",
        source: "affected-roads",
        paint: {
          "line-color": "#ef4444",
          "line-width": 3,
          "line-opacity": 0.7,
        },
      });

      // Flood radius circles
      map.addLayer({
        id: "flood-radius-fill",
        type: "fill",
        source: "flood-radius",
        paint: {
          "fill-color": "#ef4444",
          "fill-opacity": 0.1,
        },
      });
      map.addLayer({
        id: "flood-radius-line",
        type: "line",
        source: "flood-radius",
        paint: {
          "line-color": "#ef4444",
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.5,
        },
      });

      // Flood markers
      map.addLayer({
        id: "flood-markers-circle",
        type: "circle",
        source: "flood-markers",
        paint: {
          "circle-radius": 8,
          "circle-color": "#ef4444",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      setInitialized(true);
    });

    // Click to add flood marker
    map.on("click", (e) => {
      const { lng, lat } = e.lngLat;
      const id = `flood-${Date.now()}`;
      setFloodMarkers(prev => [...prev, { id, lng, lat }]);
    });

    return () => {
      if (map_ref.current) {
        map_ref.current.remove();
        map_ref.current = null;
      }
    };
  }, []);

  // Update flood markers on map
  useEffect(() => {
    const map = map_ref.current;
    if (!map || !initialized) return;

    const features = floodMarkers.map(m => ({
      type: "Feature",
      properties: { id: m.id },
      geometry: { type: "Point", coordinates: [m.lng, m.lat] },
    }));

    map.getSource("flood-markers")?.setData({
      type: "FeatureCollection",
      features,
    });
  }, [floodMarkers, initialized]);

  // Update radius circles
  useEffect(() => {
    const map = map_ref.current;
    if (!map || !initialized) return;

    const features = floodMarkers.map(m => {
      const center = [m.lng, m.lat];
      const radiusInKm = radiusMeters / 1000;
      const points = 64;
      const coords = [];
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * 2 * Math.PI;
        const dx = radiusInKm * Math.cos(angle) / 111;
        const dy = radiusInKm * Math.sin(angle) / 111;
        coords.push([center[0] + dx, center[1] + dy]);
      }
      return {
        type: "Feature",
        properties: { id: m.id },
        geometry: { type: "Polygon", coordinates: [coords] },
      };
    });

    map.getSource("flood-radius")?.setData({
      type: "FeatureCollection",
      features,
    });
  }, [floodMarkers, radiusMeters, initialized]);

  // Find affected roads when flood markers or radius change
  const findAffectedRoads = useCallback(() => {
    if (!floodMarkers.length) {
      setAffectedRoads([]);
      return;
    }

    const radDeg = radiusMeters / 111000;
    const rad2 = radDeg * radDeg;
    const centers = floodMarkers.map(m => [m.lng, m.lat]);

    const seenRnIds = new Set();
    const roads = [];

    for (const e of graph.edges) {
      if (e.rn_id == null || seenRnIds.has(e.rn_id)) continue;

      // Check if any vertex is within radius of any flood marker
      let affected = false;
      if (Array.isArray(e.coords)) {
        for (const pt of e.coords) {
          for (const center of centers) {
            if (dist2(pt, center) <= rad2) {
              affected = true;
              break;
            }
          }
          if (affected) break;
        }
      }

      if (affected) {
        seenRnIds.add(e.rn_id);
        const props = e.feature?.properties || {};
        roads.push({
          rn_id: e.rn_id,
          name: props.name ?? props.NAME ?? `Road ${e.rn_id}`,
          coords: e.coords,
          selected: true, // Default: selected for blocking
        });
      }
    }

    setAffectedRoads(roads);
  }, [floodMarkers, radiusMeters, graph.edges]);

  useEffect(() => {
    findAffectedRoads();
  }, [findAffectedRoads]);

  // Update affected roads on map
  useEffect(() => {
    const map = map_ref.current;
    if (!map || !initialized) return;

    const selectedRoads = affectedRoads.filter(r => r.selected);
    const features = selectedRoads.map(r => ({
      type: "Feature",
      properties: { rn_id: r.rn_id },
      geometry: { type: "LineString", coordinates: r.coords },
    }));

    map.getSource("affected-roads")?.setData({
      type: "FeatureCollection",
      features,
    });
  }, [affectedRoads, initialized]);

  // Build edge filter based on selected affected roads
  const edgeFilter = useMemo(() => {
    const selectedRnIds = new Set(affectedRoads.filter(r => r.selected).map(r => r.rn_id));
    if (!selectedRnIds.size) return null;

    return (e) => {
      if (e.rn_id != null && selectedRnIds.has(e.rn_id)) return false; // block this edge
      return true;
    };
  }, [affectedRoads]);

  // Compute baseline
  const computeBaseline = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    setProgress(0);
    try {
      const stats = computePerPAStats({
        graph,
        amenity_fc_enriched,
        onProgress: (v) => setProgress(v),
        edgeFilter: null,
      });
      setBaselineStats(stats);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to compute baseline.");
    } finally {
      setBusy(false);
    }
  }, [ready, graph, amenity_fc_enriched]);

  // Compute flooded scenario
  const computeFlooded = useCallback(async () => {
    if (!ready || !baselineStats || !edgeFilter) return;
    setBusy(true);
    setProgress(0);
    try {
      const stats = computePerPAStats({
        graph,
        amenity_fc_enriched,
        onProgress: (v) => setProgress(v),
        edgeFilter,
      });
      setFloodedStats(stats);

      // Calculate deltas per PA
      const baseByName = new Map();
      for (const pa of baselineStats.paStats) {
        baseByName.set(pa.pa_name, pa);
      }

      const deltas = [];
      for (const paFlood of stats.paStats) {
        const paBase = baseByName.get(paFlood.pa_name);
        if (!paBase) continue;

        const delta_avg_s = (paFlood.avg_s ?? 0) - (paBase.avg_s ?? 0);
        const delta_max_s = (paFlood.max_s ?? 0) - (paBase.max_s ?? 0);
        const delta_unreachable = paFlood.unreachable - paBase.unreachable;

        deltas.push({
          pa_id: paFlood.pa_id,
          pa_name: paFlood.pa_name,
          base_avg_s: paBase.avg_s,
          flood_avg_s: paFlood.avg_s,
          delta_avg_s,
          delta_max_s,
          delta_unreachable,
        });
      }
      setPaDeltas(deltas);

      // Update choropleth map
      const map = map_ref.current;
      if (map && initialized && lookups?.planning) {
        const maxDelta = Math.max(...deltas.map(d => d.delta_avg_s || 0), 1);
        const paById = new Map();
        for (const d of deltas) {
          paById.set(d.pa_id, d);
        }

        const features = [];
        for (const pa of Object.values(lookups.planning.by_id || {})) {
          const delta = paById.get(pa.id);
          const color = delta ? getColorForDelta(delta.delta_avg_s, maxDelta) : "#d1d5db";

          if (pa.geometry) {
            features.push({
              type: "Feature",
              properties: {
                pa_id: pa.id,
                pa_name: pa.name,
                delta_avg_s: delta?.delta_avg_s ?? 0,
                color,
              },
              geometry: pa.geometry,
            });
          }
        }

        map.getSource("planning-areas-choropleth")?.setData({
          type: "FeatureCollection",
          features,
        });
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to compute flooded scenario.");
    } finally {
      setBusy(false);
    }
  }, [ready, graph, amenity_fc_enriched, baselineStats, edgeFilter, initialized, lookups]);

  // Toggle road selection
  const toggleRoadSelection = (rn_id) => {
    setAffectedRoads(prev => prev.map(r =>
      r.rn_id === rn_id ? { ...r, selected: !r.selected } : r
    ));
  };

  // Select/deselect all roads
  const selectAllRoads = (selected) => {
    setAffectedRoads(prev => prev.map(r => ({ ...r, selected })));
  };

  // Remove flood marker
  const removeMarker = (id) => {
    setFloodMarkers(prev => prev.filter(m => m.id !== id));
  };

  // Clear all
  const clearAll = () => {
    setFloodMarkers([]);
    setAffectedRoads([]);
    setFloodedStats(null);
    setPaDeltas([]);
    const map = map_ref.current;
    if (map && initialized) {
      map.getSource("affected-roads")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("planning-areas-choropleth")?.setData({ type: "FeatureCollection", features: [] });
    }
  };

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading base data…</div>;
  if (error) return <div className="p-4 text-sm text-red-500">{String(error)}</div>;

  const selectedRoadsCount = affectedRoads.filter(r => r.selected).length;

  return (
    <div className="flex h-full w-full">
      {/* Left Sidebar */}
      <div className="w-96 border-r bg-card flex flex-col overflow-hidden">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-semibold tracking-tight">Flood Simulation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Visualize planning area impact with choropleth map
          </p>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {/* Step 1: Baseline */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 1: Compute Baseline</CardTitle>
                <CardDescription>Calculate normal hospital accessibility</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={computeBaseline}
                  disabled={!ready || busy}
                  className="w-full"
                >
                  {busy && !baselineStats ? "Computing…" : baselineStats ? "✓ Baseline Complete" : "Compute Baseline"}
                </Button>

                {baselineStats && (
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Planning Areas:</span>
                      <span className="font-semibold">{baselineStats.paStats.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Nodes:</span>
                      <span className="font-semibold">{baselineStats.nodesCount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hospitals:</span>
                      <span className="font-semibold">{baselineStats.hospitalsCount}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Step 2: Mark Flood Locations */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 2: Mark Flood Locations</CardTitle>
                <CardDescription>Click on map to add flood markers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Radius Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Flood Radius</Label>
                    <span className="text-sm font-semibold">{radiusMeters}m</span>
                  </div>
                  <Slider
                    value={[radiusMeters]}
                    min={100}
                    max={2000}
                    step={50}
                    onValueChange={(v) => setRadiusMeters(v[0])}
                  />
                </div>

                {/* Marker List */}
                <div className="space-y-2">
                  <Label className="text-sm">
                    Flood Markers ({floodMarkers.length})
                  </Label>
                  {floodMarkers.length === 0 ? (
                    <div className="border-2 border-dashed rounded-lg p-6 text-center">
                      <MapPin className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                      <p className="text-xs text-muted-foreground">
                        Click on map to add locations
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-32 overflow-auto">
                      {floodMarkers.map((m) => (
                        <div key={m.id} className="flex items-center justify-between p-2 border rounded-lg bg-muted/30">
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3 w-3 text-red-500" />
                            <div className="text-xs font-mono">
                              {m.lng.toFixed(4)}, {m.lat.toFixed(4)}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeMarker(m.id)}
                            className="h-6 w-6 p-0"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {floodMarkers.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAll}
                      className="w-full"
                    >
                      Clear All
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Step 3: Select Affected Roads */}
            {affectedRoads.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Step 3: Select Affected Roads</CardTitle>
                  <CardDescription>
                    {selectedRoadsCount} of {affectedRoads.length} roads selected
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectAllRoads(true)}
                      className="flex-1"
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => selectAllRoads(false)}
                      className="flex-1"
                    >
                      Clear All
                    </Button>
                  </div>

                  <ScrollArea className="h-48 border rounded-md p-2">
                    <div className="space-y-2">
                      {affectedRoads.map((road) => (
                        <div key={road.rn_id} className="flex items-center space-x-2">
                          <Checkbox
                            id={`road-${road.rn_id}`}
                            checked={road.selected}
                            onCheckedChange={() => toggleRoadSelection(road.rn_id)}
                          />
                          <label
                            htmlFor={`road-${road.rn_id}`}
                            className="text-xs flex-1 cursor-pointer"
                          >
                            {road.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Step 4: Run Simulation */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Step 4: Run Simulation</CardTitle>
                <CardDescription>Compute flooded scenario & show choropleth</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={computeFlooded}
                  disabled={!ready || !baselineStats || selectedRoadsCount === 0 || busy}
                  className="w-full"
                >
                  <Play className="h-4 w-4 mr-2" />
                  {busy && floodedStats !== null ? "Computing…" : "Run Flood Simulation"}
                </Button>

                {busy && (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">
                      Running Dijkstra… {progress.toLocaleString()} nodes
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-muted">
                      <div className="h-2 bg-primary transition-all" style={{ width: "50%" }} />
                    </div>
                  </div>
                )}

                {floodedStats && paDeltas.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="font-semibold text-sm">Top Affected Planning Areas</span>
                    </div>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {paDeltas
                          .filter(d => d.delta_avg_s > 0)
                          .sort((a, b) => b.delta_avg_s - a.delta_avg_s)
                          .slice(0, 10)
                          .map((pa) => (
                            <div key={pa.pa_id} className="border rounded-lg p-2">
                              <div className="font-semibold text-xs">{pa.pa_name}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Δ Avg: <span className="text-red-600 font-semibold">+{fmtM(pa.delta_avg_s)}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>

      {/* Right - Map */}
      <div className="flex-1 relative h-full">
        <div ref={container_ref} className="absolute inset-0" />

        {/* Color Legend */}
        {paDeltas.length > 0 && (
          <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3 space-y-2">
            <div className="font-semibold text-xs">Avg Time Increase</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#86efac" }} />
                <span className="text-xs">Low (0-25%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fde047" }} />
                <span className="text-xs">Medium (25-50%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#fb923c" }} />
                <span className="text-xs">High (50-75%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: "#ef4444" }} />
                <span className="text-xs">Severe (75-100%)</span>
              </div>
            </div>
          </div>
        )}

        {/* Map Legend */}
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 space-y-2 text-xs">
          <div className="font-semibold">Map Legend</div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white" />
            <span>Flood Location</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-red-500" />
            <span>Blocked Roads</span>
          </div>
        </div>

        {/* Instructions */}
        {!baselineStats && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md pointer-events-auto">
              <h3 className="font-semibold text-lg mb-2">Getting Started</h3>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li>1. Compute baseline accessibility</li>
                <li>2. Click map to mark flood locations</li>
                <li>3. Review and select affected roads</li>
                <li>4. Run simulation to see choropleth map</li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
