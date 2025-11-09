// src/lib/simulation/graphUtils.js
/**
 * Utility functions for graph construction and manipulation
 */

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toNum = (v) => {
  const n = +v;
  return Number.isFinite(n) ? n : null;
};

/**
 * Priority Queue implementation for Dijkstra's algorithm
 */
export class MinPQ {
  constructor() {
    this.a = [];
  }

  _swap(i, j) {
    [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
  }

  _up(i) {
    while (i) {
      const p = (i - 1) >> 1;
      if (this.a[p].k <= this.a[i].k) break;
      this._swap(i, p);
      i = p;
    }
  }

  _down(i) {
    const n = this.a.length;
    for(;;) {
      let l = i * 2 + 1, r = l + 1, m = i;
      if(l < n && this.a[l].k < this.a[m].k) m = l;
      if(r < n && this.a[r].k < this.a[m].k) m = r;
      if(m === i) break;
      this._swap(i, m);
      i = m;
    }
  }

  push(k, v) {
    this.a.push({k, v});
    this._up(this.a.length - 1);
  }

  pop() {
    if(!this.a.length) return null;
    const t = this.a[0];
    const b = this.a.pop();
    if(this.a.length) {
      this.a[0] = b;
      this._down(0);
    }
    return t;
  }

  size() {
    return this.a.length;
  }
}

/**
 * Build graph from road feature collection
 * @param {Object} road_fc - GeoJSON feature collection of roads
 * @returns {Object} - { nodes: Map, adj: Map, edges: Array }
 */
export function buildGraph(road_fc) {
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
    adj.get(u).push(e1);
    edges.push(e1);

    const oneway = String(p.oneway ?? "true").toLowerCase() === "true";
    if (!oneway) {
      if (!adj.has(v)) adj.set(v, []);
      const e2 = { from: v, to: u, w, rn_id, coords: [...coords].reverse(), feature: f };
      adj.get(v).push(e2);
      edges.push(e2);
    }
  }

  return { nodes, adj, edges };
}

/**
 * Calculate squared distance between two points
 */
export function dist2(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Snap amenities to nearest graph nodes
 * @param {Object} amenity_fc - GeoJSON feature collection of amenities
 * @param {Map} nodes - Graph nodes
 * @param {Array} selectedTypes - Array of amenity types to include
 * @param {Set} excludedAmenities - Set of amenity IDs to exclude
 * @returns {Array} - Array of amenity objects with snapped node_id
 */
export function snapAmenitiesToNodes(amenity_fc, nodes, selectedTypes = ["moh_hospitals"], excludedAmenities = new Set()) {
  const amenities = [];
  const nodeArr = Array.from(nodes.values());

  for (const f of amenity_fc?.features || []) {
    const p = f.properties || {};
    const amenityType = String(p.amenity_type || "").trim();
    const amenityId = p.amenity_id ?? p.id;

    // Filter by selected types
    if (!selectedTypes.includes(amenityType)) continue;

    // Filter out excluded amenities
    if (amenityId && excludedAmenities.has(amenityId)) continue;

    const pt = f.geometry?.coordinates;
    if (!pt || !Number.isFinite(+pt[0]) || !Number.isFinite(+pt[1])) continue;

    let best = null;
    for (const n of nodeArr) {
      const d2 = dist2(pt, n.coord);
      if (best == null || d2 < best.d2) best = { nodeId: n.id, d2, node: n };
    }

    if (best) {
      amenities.push({
        amenity_id: amenityId ?? String(amenities.length),
        amenity_name: p.amenity_name ?? amenityType,
        amenity_type: amenityType,
        amenity_category: p.amenity_category,
        node_id: best.nodeId,
        pt,
      });
    }
  }

  return amenities;
}
