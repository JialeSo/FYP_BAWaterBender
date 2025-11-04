// src/workers/simWorker.js
let N = 0;
let U = null,
  V = null,
  W = null; // typed arrays

// adjacency (CSR-like via edge-linked lists)
let head = null,
  next = null,
  to = null,
  wt = null;

self.onmessage = (evt) => {
  const msg = evt.data || {};
  if (msg.kind === "build") {
    N = msg.nodesN | 0;
    U = msg.edgesU;
    V = msg.edgesV;
    W = msg.travelSec;
    buildAdj();
    self.postMessage({ kind: "built" });
  } else if (msg.kind === "solve-baseline") {
    const dist = multiSourceDijkstra(msg.destNodes, null);
    // remember destinations for flood re-runs
    self.lastDestNodes = msg.destNodes?.slice?.() || [];
    self.postMessage({ kind: "baseline-result", travelSecByNode: dist }, [dist.buffer]);
  } else if (msg.kind === "solve-flood") {
    const dist = multiSourceDijkstra(self.lastDestNodes || [], msg.blocked);
    self.postMessage({ kind: "flood-result", travelSecByNode: dist }, [dist.buffer]);
  }
};

function buildAdj() {
  const m = U.length;
  head = new Int32Array(N).fill(-1);
  next = new Int32Array(m);
  to = new Int32Array(m);
  wt = new Float32Array(m);

  for (let e = 0; e < m; e++) {
    const u = U[e];
    const v = V[e];
    next[e] = head[u];
    head[u] = e;
    to[e] = v;
    wt[e] = W[e];
  }
}

function multiSourceDijkstra(destNodes, blocked) {
  const INF = 1e30;
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = INF;

  // min-heap
  const pq = [];
  const push = (i, d) => {
    pq.push({ i, d });
    up(pq.length - 1);
  };
  const pop = () => {
    const r = pq[0];
    const x = pq.pop();
    if (pq.length) {
      pq[0] = x;
      down(0);
    }
    return r;
  };
  const up = (i) => {
    while (i) {
      const p = (i - 1) >> 1;
      if (pq[p].d <= pq[i].d) break;
      [pq[p], pq[i]] = [pq[i], pq[p]];
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      let l = i * 2 + 1,
        r = l + 1,
        m = i;
      if (l < pq.length && pq[l].d < pq[m].d) m = l;
      if (r < pq.length && pq[r].d < pq[m].d) m = r;
      if (m === i) break;
      [pq[m], pq[i]] = [pq[i], pq[m]];
      i = m;
    }
  };

  // multi-source init (dist to hospitals = 0)
  for (const s of destNodes) {
    if (s == null) continue;
    dist[s] = 0;
    push(s, 0);
  }

  while (pq.length) {
    const { i: u, d } = pop();
    if (d !== dist[u]) continue;
    for (let e = head[u]; e !== -1; e = next[e]) {
      if (blocked && blocked[e]) continue; // flooded edge
      const v = to[e];
      const nd = d + wt[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        push(v, nd);
      }
    }
  }
  return dist;
}
