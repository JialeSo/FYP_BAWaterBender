// src/pages/simulation-node-breakdown.jsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useMapData } from "@/context/MapDataContext";

/* ============================== helpers ============================== */
const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const toNum = (v) => { const n = +v; return Number.isFinite(n) ? n : null; };
const fmtS = (s) => (Number.isFinite(s) ? `${Math.round(s)}s` : "—");
const fmtM = (s) => (Number.isFinite(s) ? (s / 60).toFixed(1) + "m" : "—");
const dist2 = (a, b) => { if (!a || !b) return Number.POSITIVE_INFINITY; const dx=a[0]-b[0], dy=a[1]-b[1]; return dx*dx+dy*dy; };
const Arrow = ({ active, dir }) => <span className="ml-1 inline-block w-3 text-muted-foreground">{active ? (dir === "asc" ? "▲" : "▼") : ""}</span>;
const toggleDir = (d) => (d === "asc" ? "desc" : "asc");

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

/* ==================== graph builder (directed, time) =================
   We keep edges with rn_id + coordinates so we can filter them later.   */
function buildGraph(road_fc) {
  const nodes = new Map();          // nodeId -> { id, coord:[lon,lat], paId, paName, szId, szName }
  const adj = new Map();            // nodeId -> Array<{to, w, rn_id, coords}>
  const edges = [];                 // flat list for spatial/radius filtering

  const nodeMetaFromEdge = (p, which, coords) => {
    const coord = which === "u" ? coords[0] : coords[coords.length - 1];
    return {
      coord,
      paId: toInt(p.PA_ID ?? p.pa_id),
      paName: p.PLN_AREA_N ?? p.pln_area_n ?? null,
      szId: toInt(p.SZ_ID ?? p.sz_id),
      szName: p.SUBZONE_N ?? p.subzone_n ?? null,
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
function snapHospitalsToNodes(amenity_fc, nodes, planningLookup) {
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
      const pa = planningLookup?.by_id?.[best.node.paId] || null;
      hospitals.push({
        hosp_id: p.amenity_id ?? String(hospitals.length),
        hosp_name: p.amenity_name ?? "hospital",
        node_id: best.nodeId,
        node_pa_id: best.node.paId ?? null,
        node_pa_name: pa?.name ?? best.node.paName ?? null,
        pt,
      });
    }
  }
  return hospitals;
}

/* ======================== multi-source dijkstra =======================
   Accepts an optional edgeFilter(edge) => boolean to dynamically ignore
   flooded/filtered roads WITHOUT rebuilding the graph structures.       */
function multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter) {
  const dist = new Map();           // nodeId -> seconds
  const srcOf = new Map();          // nodeId -> hospitalNodeId
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

/* ================== aggregates + row construction ===================== */
function buildRows({ graph, amenity_fc_enriched, lookups, onProgress, edgeFilter }) {
  const { nodes, adj } = graph;
  const hospitals = snapHospitalsToNodes(amenity_fc_enriched, nodes, lookups?.planning);
  if (!hospitals.length) throw new Error("No moh_hospitals found to seed Dijkstra.");
  const hospitalNodeIds = hospitals.map(h => h.node_id);
  const { dist, srcOf } = multiSourceDijkstra({ nodes, adj }, hospitalNodeIds, onProgress, edgeFilter);

  const hospByNode = new Map();
  for (const h of hospitals) hospByNode.set(h.node_id, h);

  const nodeRows = [];
  for (const n of nodes.values()) {
    const t = dist.get(n.id) ?? Infinity;
    const src = srcOf.get(n.id) ?? null;
    const h = src != null ? hospByNode.get(src) : null;
    nodeRows.push({
      node_id: n.id,
      node_lon: n.coord?.[0] ?? null,
      node_lat: n.coord?.[1] ?? null,
      node_pa_id: n.paId ?? null,
      node_pa_name: n.paName ?? "",
      node_sz_id: n.szId ?? null,
      node_sz_name: n.szName ?? "",
      nearest_hospital_node: src ?? null,
      nearest_hospital_id: h?.hosp_id ?? null,
      nearest_hospital_name: h?.hosp_name ?? null,
      nearest_hospital_pa_id: h?.node_pa_id ?? null,
      nearest_hospital_pa_name: h?.node_pa_name ?? "",
      travel_time_s: Number.isFinite(t) ? t : null,
      travel_time_min: Number.isFinite(t) ? t / 60 : null,
      cross_pa: n.paId != null && h?.node_pa_id != null && n.paId !== h.node_pa_id ? 1 : 0,
    });
  }

  const byPA = new Map();
  for (const r of nodeRows) {
    const key = r.node_pa_id ?? -1;
    if (!byPA.has(key)) byPA.set(key, { pa_id: r.node_pa_id, pa_name: r.node_pa_name, n: 0, min_s: Infinity, max_s: -Infinity, sum_s: 0, cross_pa_nodes: 0 });
    const agg = byPA.get(key);
    if (r.travel_time_s != null) {
      agg.n += 1;
      agg.min_s = Math.min(agg.min_s, r.travel_time_s);
      agg.max_s = Math.max(agg.max_s, r.travel_time_s);
      agg.sum_s += r.travel_time_s;
    }
    if (r.cross_pa) agg.cross_pa_nodes += 1;
  }
  const paRows = Array.from(byPA.values()).map(a => ({
    pa_id: a.pa_id,
    pa_name: a.pa_name || "(unknown)",
    nodes: a.n,
    min_s: Number.isFinite(a.min_s) ? a.min_s : null,
    min_min: Number.isFinite(a.min_s) ? a.min_s / 60 : null,
    avg_s: a.n ? a.sum_s / a.n : null,
    avg_min: a.n ? (a.sum_s / a.n) / 60 : null,
    max_s: Number.isFinite(a.max_s) ? a.max_s : null,
    max_min: Number.isFinite(a.max_s) ? a.max_s / 60 : null,
    cross_pa_nodes: a.cross_pa_nodes,
  }));
  return { nodeRows, paRows, hospitalsCount: hospitals.length, nodesCount: nodes.size };
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

/* =============================== Page ================================= */
export default function SimulationNodeBreakdown() {
  const { road_fc_enriched, amenity_fc_enriched, lookups, loading, error } = useMapData();

  // graph & readiness
  const graph = useMemo(() => buildGraph(road_fc_enriched), [road_fc_enriched]);
  const ready = useMemo(
    () => !!graph.nodes?.size && !!graph.edges?.length && !!amenity_fc_enriched?.features?.length,
    [graph, amenity_fc_enriched]
  );

  // UI state
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // filters: by RN_ID, by PA (planning area), by radius around [lon,lat]
  const [blockedRnIdsText, setBlockedRnIdsText] = useState("");  // comma/space separated list
  const [blockedPA, setBlockedPA] = useState("");                 // optional PA name slug or exact
  const [radiusCenter, setRadiusCenter] = useState({ lon: "", lat: "" });
  const [radiusMeters, setRadiusMeters] = useState("");           // approximate using degrees

  // results (baseline & flooded)
  const [baseline, setBaseline] = useState({ nodeRows: [], paRows: [], nodesCount: 0, hospitalsCount: 0 });
  const [flooded, setFlooded]   = useState({ nodeRows: [], paRows: [], nodesCount: 0, hospitalsCount: 0 });

  // table sorting
  const [paSort, setPaSort] = useState({ key: "pa_name", dir: "asc" });
  const [nodeSort, setNodeSort] = useState({ key: "travel_time_s", dir: "asc" });

  // build edgeFilter from UI
  const edgeFilter = useMemo(() => {
    // rn_id set
    const rnSet = new Set(
      blockedRnIdsText
        .split(/[^0-9]+/)
        .map((s) => toInt(s))
        .filter((x) => x != null)
    );

    // PA blocker (match edge coords' PA via original properties is heavy; use rn-based if PA provided by matching the PA on edge properties in road_fc_enriched)
    const paSlug = String(blockedPA || "").trim().toLowerCase();
    const paIds = new Set();
    if (paSlug) {
      for (const f of road_fc_enriched?.features || []) {
        const name = String(f.properties?.PLN_AREA_N ?? f.properties?.pln_area_n ?? "").toLowerCase();
        if (name && name.includes(paSlug)) {
          const rid = toInt(f.properties?.RN_ID ?? f.properties?.rn_id);
          if (rid != null) paIds.add(rid);
        }
      }
    }

    // radius blocker: approximate degrees (1 deg ~ 111,000m). We'll compare to vertices along the line.
    const lon0 = +radiusCenter.lon, lat0 = +radiusCenter.lat;
    const hasCenter = Number.isFinite(lon0) && Number.isFinite(lat0);
    const radM = +radiusMeters;
    const radDeg = Number.isFinite(radM) ? (radM / 111000) : null;
    const rad2 = (hasCenter && Number.isFinite(radDeg)) ? (radDeg * radDeg) : null;
    const center = hasCenter ? [lon0, lat0] : null;

    return (e) => {
      if (rnSet.size && e.rn_id != null && rnSet.has(e.rn_id)) return false;
      if (paIds.size && e.rn_id != null && paIds.has(e.rn_id)) return false;

      if (center && rad2 != null && Array.isArray(e.coords)) {
        for (const pt of e.coords) {
          if (dist2(pt, center) <= rad2) return false; // block edge if any vertex is within radius
        }
      }
      return true; // keep edge
    };
  }, [blockedRnIdsText, blockedPA, radiusCenter, radiusMeters, road_fc_enriched]);

  const computeAll = useCallback(async () => {
    if (!ready) return;
    setBusy(true); setProgress(0);
    try {
      // baseline
      const base = buildRows({
        graph,
        amenity_fc_enriched,
        lookups,
        onProgress: (v) => setProgress(v),
        edgeFilter: null, // no filtering
      });
      setBaseline(base);

      // flooded (with edge filter)
      setProgress(0);
      const flood = buildRows({
        graph,
        amenity_fc_enriched,
        lookups,
        onProgress: (v) => setProgress(v),
        edgeFilter, // apply filter
      });
      setFlooded(flood);
    } catch (e) {
      console.error(e);
      alert(e?.message || "Failed to compute.");
    } finally {
      setBusy(false);
    }
  }, [ready, graph, amenity_fc_enriched, lookups, edgeFilter]);

  useEffect(() => { if (ready && !baseline.nodeRows.length && !busy) computeAll(); }, [ready]); // eslint-disable-line

  // derive PA comparison with deltas
  const paCompare = useMemo(() => {
    const byName = new Map();
    for (const r of baseline.paRows) byName.set(r.pa_name || "(unknown)", { base: r, flood: null });
    for (const r of flooded.paRows) {
      const key = r.pa_name || "(unknown)";
      const obj = byName.get(key) || { base: null, flood: null };
      obj.flood = r; byName.set(key, obj);
    }
    const rows = [];
    for (const [name, { base, flood }] of byName.entries()) {
      rows.push({
        pa_name: name,
        nodes_base: base?.nodes ?? 0,
        min_base: base?.min_s ?? null,
        avg_base: base?.avg_s ?? null,
        max_base: base?.max_s ?? null,
        nodes_flood: flood?.nodes ?? 0,
        min_flood: flood?.min_s ?? null,
        avg_flood: flood?.avg_s ?? null,
        max_flood: flood?.max_s ?? null,
        d_min: (base?.min_s != null && flood?.min_s != null) ? (flood.min_s - base.min_s) : null,
        d_avg: (base?.avg_s != null && flood?.avg_s != null) ? (flood.avg_s - base.avg_s) : null,
        d_max: (base?.max_s != null && flood?.max_s != null) ? (flood.max_s - base.max_s) : null,
      });
    }
    return rows;
  }, [baseline.paRows, flooded.paRows]);

  // sorting
  const [paSortKey, setPaSortKey] = useState("d_avg");
  const [paSortDir, setPaSortDir] = useState("desc");
  const paSorted = useMemo(() => {
    const arr = [...paCompare];
    const key = paSortKey, dir = paSortDir;
    const cmp = (a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      }
      return dir === "asc" ? (va - vb) : (vb - va);
    };
    arr.sort(cmp); return arr;
  }, [paCompare, paSortKey, paSortDir]);

  const [nodeSortKey, setNodeSortKey] = useState("travel_time_s");
  const [nodeSortDir, setNodeSortDir] = useState("asc");
  const nodeSorted = useMemo(() => {
    const arr = [...flooded.nodeRows]; // show the CURRENT (filtered) state
    const key = nodeSortKey, dir = nodeSortDir;
    const cmp = (a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      }
      return dir === "asc" ? (va - vb) : (vb - va);
    };
    arr.sort(cmp); return arr;
  }, [flooded.nodeRows, nodeSortKey, nodeSortDir]);

  const exportCSV = (name, rows) => {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading base data…</div>;
  if (error)   return <div className="p-4 text-sm text-red-500">{String(error)}</div>;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 py-6">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Simulation Playground</h1>
        <p className="text-base text-muted-foreground">
          Node-level hospital accessibility (nearest <code>moh_hospitals</code> by network travel time) with dynamic road filtering.
        </p>
      </section>

      {/* Controls */}
      <section className="rounded-2xl border p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1">Block roads by RN_ID (comma/space separated)</label>
            <input
              value={blockedRnIdsText}
              onChange={(e) => setBlockedRnIdsText(e.target.value)}
              placeholder="e.g. 12, 345, 6789"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">These roads will be removed from the graph during the flooded run.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Block roads by Planning Area (contains)</label>
            <input
              value={blockedPA}
              onChange={(e) => setBlockedPA(e.target.value)}
              placeholder="e.g. KALLANG"
              className="w-full rounded-md border px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">Matches road segments whose PA name contains this text.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1">Radius center lon</label>
              <input value={radiusCenter.lon} onChange={(e)=>setRadiusCenter(s=>({...s,lon:e.target.value}))}
                     placeholder="103.85" className="w-full rounded-md border px-3 py-2 text-sm"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Radius center lat</label>
              <input value={radiusCenter.lat} onChange={(e)=>setRadiusCenter(s=>({...s,lat:e.target.value}))}
                     placeholder="1.30" className="w-full rounded-md border px-3 py-2 text-sm"/>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Radius (meters)</label>
              <input value={radiusMeters} onChange={(e)=>setRadiusMeters(e.target.value)}
                     placeholder="300" className="w-full rounded-md border px-3 py-2 text-sm"/>
            </div>
            <p className="col-span-3 text-xs text-muted-foreground">Any road with a vertex inside this radius will be blocked.</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={computeAll}
            disabled={!ready || busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Computing…" : "Run Simulation (baseline & flooded)"}
          </button>
          <div className="text-xs text-muted-foreground ml-2">
            Nodes: <b>{baseline.nodesCount || 0}</b> • Hospitals: <b>{baseline.hospitalsCount || 0}</b>
          </div>
        </div>

        {busy ? (
          <div className="mt-3 rounded-md border p-3">
            <div className="mb-2 text-sm">Running multi-source Dijkstra…</div>
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div className="h-2 bg-primary transition-all" style={{ width: "50%" }} />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Visited ~{progress} nodes</div>
          </div>
        ) : null}
      </section>

      {/* Planning Area comparison (sortable, with deltas) */}
      <section className="rounded-2xl border">
        <div className="flex items-center justify-between border-b p-3">
          <div className="text-sm font-medium">Planning Area – Baseline vs Flooded (deltas)</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV("planning_areas_comparison.csv", paCompare)}
              className="rounded-md border px-3 py-1.5 text-sm"
              disabled={!paCompare.length || busy}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="max-h-[45vh] overflow-auto text-sm">
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                <th className="cursor-pointer hover:underline"
                    onClick={()=>{ setPaSortKey("pa_name"); setPaSortDir(paSortKey==="pa_name"?toggleDir(paSortDir):"asc"); }}>
                  PA <Arrow active={paSortKey==="pa_name"} dir={paSortDir}/>
                </th>
                <th>Nodes (base)</th>
                <th className="cursor-pointer hover:underline"
                    onClick={()=>{ setPaSortKey("min_base"); setPaSortDir(paSortKey==="min_base"?toggleDir(paSortDir):"asc"); }}>
                  Min (s) base <Arrow active={paSortKey==="min_base"} dir={paSortDir}/>
                </th>
                <th>Avg (s) base</th>
                <th className="cursor-pointer hover:underline"
                    onClick={()=>{ setPaSortKey("max_base"); setPaSortDir(paSortKey==="max_base"?toggleDir(paSortDir):"desc"); }}>
                  Max (s) base <Arrow active={paSortKey==="max_base"} dir={paSortDir}/>
                </th>
                <th>Nodes (flood)</th>
                <th>Min (s) flood</th>
                <th>Avg (s) flood</th>
                <th>Max (s) flood</th>
                <th className="cursor-pointer hover:underline"
                    onClick={()=>{ setPaSortKey("d_avg"); setPaSortDir(paSortKey==="d_avg"?toggleDir(paSortDir):"desc"); }}>
                  Δ Avg (s) <Arrow active={paSortKey==="d_avg"} dir={paSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline"
                    onClick={()=>{ setPaSortKey("d_max"); setPaSortDir(paSortKey==="d_max"?toggleDir(paSortDir):"desc"); }}>
                  Δ Max (s) <Arrow active={paSortKey==="d_max"} dir={paSortDir}/>
                </th>
              </tr>
            </thead>
            <tbody>
              {paSorted.map((r, i) => (
                <tr key={i} className="border-t [&>td]:px-3 [&>td]:py-2">
                  <td className="font-medium">{r.pa_name}</td>
                  <td>{r.nodes_base}</td>
                  <td>{fmtS(r.min_base)}</td>
                  <td>{fmtS(r.avg_base)}</td>
                  <td>{fmtS(r.max_base)}</td>
                  <td>{r.nodes_flood}</td>
                  <td>{fmtS(r.min_flood)}</td>
                  <td>{fmtS(r.avg_flood)}</td>
                  <td>{fmtS(r.max_flood)}</td>
                  <td className={Number(r.d_avg) > 0 ? "text-amber-700" : ""}>{fmtS(r.d_avg)}</td>
                  <td className={Number(r.d_max) > 0 ? "text-red-700" : ""}>{fmtS(r.d_max)}</td>
                </tr>
              ))}
              {!paSorted.length && (
                <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">No data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Node table (current = flooded/filtered state), sortable */}
      <section className="rounded-2xl border">
        <div className="flex items-center justify-between border-b p-3">
          <div className="text-sm font-medium">All Nodes – Current (after filtering)</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCSV("nodes_current_filtered.csv", flooded.nodeRows)}
              className="rounded-md border px-3 py-1.5 text-sm"
              disabled={!flooded.nodeRows.length || busy}
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="max-h-[50vh] overflow-auto text-sm">
          <table className="w-full">
            <thead className="sticky top-0 bg-background">
              <tr className="[&>th]:px-3 [&>th]:py-2 text-left">
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("node_id"); setNodeSortDir(nodeSortKey==="node_id"?toggleDir(nodeSortDir):"asc"); }}>
                  Node <Arrow active={nodeSortKey==="node_id"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("node_lon"); setNodeSortDir(nodeSortKey==="node_lon"?toggleDir(nodeSortDir):"asc"); }}>
                  Lon <Arrow active={nodeSortKey==="node_lon"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("node_lat"); setNodeSortDir(nodeSortKey==="node_lat"?toggleDir(nodeSortDir):"asc"); }}>
                  Lat <Arrow active={nodeSortKey==="node_lat"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("node_pa_name"); setNodeSortDir(nodeSortKey==="node_pa_name"?toggleDir(nodeSortDir):"asc"); }}>
                  PA <Arrow active={nodeSortKey==="node_pa_name"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("node_sz_name"); setNodeSortDir(nodeSortKey==="node_sz_name"?toggleDir(nodeSortDir):"asc"); }}>
                  Subzone <Arrow active={nodeSortKey==="node_sz_name"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("nearest_hospital_name"); setNodeSortDir(nodeSortKey==="nearest_hospital_name"?toggleDir(nodeSortDir):"asc"); }}>
                  Nearest hospital <Arrow active={nodeSortKey==="nearest_hospital_name"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("nearest_hospital_pa_name"); setNodeSortDir(nodeSortKey==="nearest_hospital_pa_name"?toggleDir(nodeSortDir):"asc"); }}>
                  Hospital PA <Arrow active={nodeSortKey==="nearest_hospital_pa_name"} dir={nodeSortDir}/>
                </th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("travel_time_s"); setNodeSortDir(nodeSortKey==="travel_time_s"?toggleDir(nodeSortDir):"asc"); }}>
                  Time (s) <Arrow active={nodeSortKey==="travel_time_s"} dir={nodeSortDir}/>
                </th>
                <th>Time (min)</th>
                <th className="cursor-pointer hover:underline" onClick={()=>{ setNodeSortKey("cross_pa"); setNodeSortDir(nodeSortKey==="cross_pa"?toggleDir(nodeSortDir):"desc"); }}>
                  Cross-PA <Arrow active={nodeSortKey==="cross_pa"} dir={nodeSortDir}/>
                </th>
              </tr>
            </thead>
            <tbody>
              {nodeSorted.map((r) => (
                <tr key={r.node_id} className="border-t [&>td]:px-3 [&>td]:py-2">
                  <td className="font-mono">{r.node_id}</td>
                  <td>{Number.isFinite(r.node_lon) ? r.node_lon.toFixed(6) : ""}</td>
                  <td>{Number.isFinite(r.node_lat) ? r.node_lat.toFixed(6) : ""}</td>
                  <td>{r.node_pa_name || ""}</td>
                  <td>{r.node_sz_name || ""}</td>
                  <td>{r.nearest_hospital_name || `(node ${r.nearest_hospital_node ?? "—"})`}</td>
                  <td>{r.nearest_hospital_pa_name || ""}</td>
                  <td>{fmtS(r.travel_time_s)}</td>
                  <td>{fmtM(r.travel_time_s)}</td>
                  <td>{r.cross_pa ? "✓" : ""}</td>
                </tr>
              ))}
              {!nodeSorted.length && (
                <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">No data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Tip: Filtering roads changes the graph only during the “flooded” run. Baseline remains intact for comparison. You can block by RN_IDs, any PA name substring, and/or a radius around a lon/lat.
      </p>
    </div>
  );
}
