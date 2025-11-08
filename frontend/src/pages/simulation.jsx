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
import { X, MapPin, AlertTriangle, Download } from "lucide-react";

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
    const e1 = { from: u, to: v, w, rn_id, coords };
    adj.get(u).push(e1); edges.push(e1);

    const oneway = String(p.oneway ?? "true").toLowerCase() === "true";
    if (!oneway) {
      if (!adj.has(v)) adj.set(v, []);
      const e2 = { from: v, to: u, w, rn_id, coords: [...coords].reverse() };
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

/* ==================== compute accessibility stats ===================== */
function computeAccessibility({ graph, amenity_fc_enriched, onProgress, edgeFilter }) {
  const { nodes, adj } = graph;
  const hospitals = snapHospitalsToNodes(amenity_fc_enriched, nodes);
  if (!hospitals.length) throw new Error("No moh_hospitals found.");

  const hospitalNodeIds = hospitals.map(h => h.node_id);
  const { dist } = multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter);

  const hospByNode = new Map();
  for (const h of hospitals) hospByNode.set(h.node_id, h);

  const stats = {
    total_nodes: nodes.size,
    hospitals_count: hospitals.length,
    avg_time_s: 0,
    max_time_s: 0,
    nodes_unreachable: 0,
  };

  let sum = 0, count = 0, max = 0;
  for (const n of nodes.values()) {
    const t = dist.get(n.id) ?? Infinity;
    if (!Number.isFinite(t)) {
      stats.nodes_unreachable++;
    } else {
      sum += t;
      count++;
      if (t > max) max = t;
    }
  }
  stats.avg_time_s = count > 0 ? sum / count : 0;
  stats.max_time_s = max;

  return stats;
}

/* ============================= CSV export ============================= */
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
  const { road_fc_enriched, amenity_fc_enriched, loading, error } = useMapData();

  // Build graph (lazy - only when data ready, doesn't auto-compute)
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

  // Flood markers (array of {id, lng, lat})
  const [floodMarkers, setFloodMarkers] = useState([]);
  const [radiusMeters, setRadiusMeters] = useState(500);

  // Results
  const [baselineStats, setBaselineStats] = useState(null);
  const [floodedStats, setFloodedStats] = useState(null);
  const [affectedRoads, setAffectedRoads] = useState([]);

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
      // Add sources for flood markers and affected roads
      map.addSource("flood-markers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("affected-roads", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("flood-radius", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Affected roads layer (red)
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

      // Flood markers layer (red dots)
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

  // Update radius circles on map
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
        const dx = radiusInKm * Math.cos(angle) / 111; // approximate degrees
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

  // Build edge filter based on flood markers and radius
  const edgeFilter = useMemo(() => {
    if (!floodMarkers.length) return null;

    const radDeg = radiusMeters / 111000;
    const rad2 = radDeg * radDeg;
    const centers = floodMarkers.map(m => [m.lng, m.lat]);

    return (e) => {
      // Block edge if ANY vertex is within radius of ANY flood marker
      if (Array.isArray(e.coords)) {
        for (const pt of e.coords) {
          for (const center of centers) {
            if (dist2(pt, center) <= rad2) return false;
          }
        }
      }
      return true;
    };
  }, [floodMarkers, radiusMeters]);

  // Compute baseline (no filter)
  const computeBaseline = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    setProgress(0);
    try {
      const stats = computeAccessibility({
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
    if (!ready || !edgeFilter) return;
    setBusy(true);
    setProgress(0);
    try {
      const stats = computeAccessibility({
        graph,
        amenity_fc_enriched,
        onProgress: (v) => setProgress(v),
        edgeFilter,
      });
      setFloodedStats(stats);

      // Get affected roads (edges blocked by filter)
      const blockedEdges = [];
      for (const e of graph.edges) {
        if (!edgeFilter(e)) {
          blockedEdges.push({
            rn_id: e.rn_id,
            coords: e.coords,
          });
        }
      }

      // Deduplicate by rn_id and build features
      const seenRnIds = new Set();
      const roadFeatures = [];
      for (const e of blockedEdges) {
        if (e.rn_id != null && !seenRnIds.has(e.rn_id)) {
          seenRnIds.add(e.rn_id);
          roadFeatures.push({
            type: "Feature",
            properties: { rn_id: e.rn_id },
            geometry: { type: "LineString", coordinates: e.coords },
          });
        }
      }
      setAffectedRoads(roadFeatures);

      // Update map
      const map = map_ref.current;
      if (map && initialized) {
        map.getSource("affected-roads")?.setData({
          type: "FeatureCollection",
          features: roadFeatures,
        });
      }
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to compute flooded scenario.");
    } finally {
      setBusy(false);
    }
  }, [ready, graph, amenity_fc_enriched, edgeFilter, initialized]);

  // Remove flood marker
  const removeMarker = (id) => {
    setFloodMarkers(prev => prev.filter(m => m.id !== id));
  };

  // Clear all markers
  const clearAll = () => {
    setFloodMarkers([]);
    setFloodedStats(null);
    setAffectedRoads([]);
    const map = map_ref.current;
    if (map && initialized) {
      map.getSource("affected-roads")?.setData({ type: "FeatureCollection", features: [] });
    }
  };

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading base data…</div>;
  if (error) return <div className="p-4 text-sm text-red-500">{String(error)}</div>;

  return (
    <div className="flex h-full w-full">
      {/* Left Sidebar - Controls */}
      <div className="w-96 border-r bg-card flex flex-col overflow-hidden">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-semibold tracking-tight">Flood Simulation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Click on the map to mark flood locations and see impact on hospital accessibility
          </p>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Baseline Computation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 1: Baseline</CardTitle>
              <CardDescription>Compute normal hospital accessibility (no flooding)</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={computeBaseline}
                disabled={!ready || busy}
                className="w-full"
              >
                {busy && !baselineStats ? "Computing…" : baselineStats ? "✓ Baseline Computed" : "Compute Baseline"}
              </Button>

              {baselineStats && (
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Nodes:</span>
                    <span className="font-semibold">{baselineStats.total_nodes.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hospitals:</span>
                    <span className="font-semibold">{baselineStats.hospitals_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Time:</span>
                    <span className="font-semibold">{fmtM(baselineStats.avg_time_s)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Time:</span>
                    <span className="font-semibold">{fmtM(baselineStats.max_time_s)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Flood Markers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 2: Mark Flood Locations</CardTitle>
              <CardDescription>Click on the map to add flood markers</CardDescription>
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
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Click on the map to add flood locations
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-auto">
                    {floodMarkers.map((m) => (
                      <div key={m.id} className="flex items-center justify-between p-2 border rounded-lg bg-muted/30">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-red-500" />
                          <div className="text-xs font-mono">
                            {m.lng.toFixed(5)}, {m.lat.toFixed(5)}
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
                    Clear All Markers
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Run Simulation */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Step 3: Run Simulation</CardTitle>
              <CardDescription>Compute impact with flooded roads blocked</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={computeFlooded}
                disabled={!ready || !baselineStats || floodMarkers.length === 0 || busy}
                className="w-full"
              >
                {busy && floodedStats !== null ? "Computing…" : "Run Flood Simulation"}
              </Button>

              {busy && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Running Dijkstra… Visited ~{progress.toLocaleString()} nodes
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded bg-muted">
                    <div className="h-2 bg-primary transition-all" style={{ width: "50%" }} />
                  </div>
                </div>
              )}

              {floodedStats && (
                <div className="space-y-4">
                  <div className="space-y-2 text-sm">
                    <div className="font-semibold text-base mb-2">Flooded Scenario</div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Avg Time:</span>
                      <span className="font-semibold">{fmtM(floodedStats.avg_time_s)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max Time:</span>
                      <span className="font-semibold">{fmtM(floodedStats.max_time_s)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Unreachable Nodes:</span>
                      <span className="font-semibold text-red-600">{floodedStats.nodes_unreachable}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Roads Affected:</span>
                      <span className="font-semibold text-red-600">{affectedRoads.length}</span>
                    </div>
                  </div>

                  {baselineStats && (
                    <div className="border-t pt-4">
                      <div className="font-semibold text-base mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        Impact Analysis
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Δ Avg Time:</span>
                          <span className={`font-semibold ${(floodedStats.avg_time_s - baselineStats.avg_time_s) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            +{fmtM(floodedStats.avg_time_s - baselineStats.avg_time_s)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Δ Max Time:</span>
                          <span className={`font-semibold ${(floodedStats.max_time_s - baselineStats.max_time_s) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            +{fmtM(floodedStats.max_time_s - baselineStats.max_time_s)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Avg Increase:</span>
                          <span className="font-semibold text-red-600">
                            {baselineStats.avg_time_s > 0 ? (((floodedStats.avg_time_s - baselineStats.avg_time_s) / baselineStats.avg_time_s) * 100).toFixed(1) : 0}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Right - Map */}
      <div className="flex-1 relative">
        <div ref={container_ref} className="absolute inset-0" />

        {/* Map Legend */}
        <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 space-y-2 text-xs">
          <div className="font-semibold mb-2">Legend</div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500 border-2 border-white" />
            <span>Flood Location</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-red-500" style={{ opacity: 0.7 }} />
            <span>Affected Roads</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-red-500 border-dashed rounded-full" style={{ opacity: 0.3 }} />
            <span>Flood Radius</span>
          </div>
        </div>

        {/* Instructions Overlay */}
        {!baselineStats && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-md pointer-events-auto">
              <h3 className="font-semibold text-lg mb-2">Getting Started</h3>
              <ol className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-semibold">1.</span>
                  <span>Click "Compute Baseline" in the left panel to calculate normal hospital accessibility</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">2.</span>
                  <span>Click on the map to mark flood locations</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">3.</span>
                  <span>Adjust the flood radius if needed</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold">4.</span>
                  <span>Click "Run Flood Simulation" to see the impact</span>
                </li>
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
