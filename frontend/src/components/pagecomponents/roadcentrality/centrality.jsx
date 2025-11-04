// src/pages/centrality.jsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import { useMapData } from "@/context/MapDataContext";

/* shadcn ui */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronsUpDown, X, Download } from "lucide-react";

/* ===== config ===== */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/light-v11";
const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
const MAP_DEFAULT_ZOOM = 11;
const PAGE_SIZE = 40;
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== helpers ===== */
const nznum = (v) => (Number.isFinite(+v) ? +v : 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const strip_count_suffix = (s) => String(s).replace(/\s*\(\s*\d[\d,]*\s*\)\s*$/, "").trim();
const to_title_case = (value) => {
  if (value == null) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (!word) return "";
      const upper = word.toUpperCase();
      if (word === upper && /^[A-Z0-9]+$/.test(word)) return upper;
      const lower = word.toLowerCase();
      if (lower.length <= 2) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

function format_number(val, digits = 1) {
  const n = typeof val === "number" ? val : Number(val);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function format_cell(value, column) {
  if (column?.format) {
    const out = column.format(value);
    if (out !== null && out !== undefined) return out;
  }
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function make_percentiler(values) {
  const arr = values.filter((x) => Number.isFinite(+x)).map(Number).sort((a, b) => a - b);
  if (!arr.length) return () => 0;
  return (v) => {
    if (!Number.isFinite(+v)) return 0;
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= v) lo = mid + 1; else hi = mid;
    }
    return Math.max(0, Math.min(100, (lo / arr.length) * 100));
  };
}

/* ===== schema helpers ===== */
const get_amenity_category = (props = {}) =>
  props.amenity_category ?? props.category ?? props.amenity ?? "unknown";
const get_amenity_category_id = (props = {}) =>
  props.amenity_category_id ?? props.category_id ?? props.amenity_categoryid ?? null;
const get_flood_type = (props = {}) =>
  props.flood_type ?? props.type ?? props.event ?? props.category ?? "unknown";
const get_road_type  = (props = {}) =>
  props.highway ?? props.road_class ?? props.class ?? props.HIGHWAY ?? "unknown";

/* ===== map paint ===== */
const COLOR_SCORE = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "score"]], 0],
  0, "#dbeafe",
  20, "#93c5fd",
  40, "#60a5fa",
  70, "#3b82f6",
  90, "#1d4ed8",
];
const WIDTH_EXPR = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "betweenness_norm"]], 0],
  0, 1, 0.05, 1.5, 0.1, 2.5, 0.3, 4, 0.6, 6, 1, 8,
];

/* ===== map component ===== */
function CentralityMap({ data }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!MAPBOX_TOKEN || mapRef.current || !containerRef.current) return;
    if (!mapboxgl.supported()) return;

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

    const ensure_base = () => {
      if (!map.getSource("road-network")) {
        map.addSource("road-network", { type: "geojson", data: EMPTY_COLLECTION });
      }
      if (!map.getLayer("roads")) {
        map.addLayer({
          id: "roads",
          type: "line",
          source: "road-network",
          layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
          paint: { "line-color": COLOR_SCORE, "line-width": WIDTH_EXPR, "line-opacity": 0.95 },
        });
      }
    };

    const show_popup = (lngLat, html) => {
      if (!map._centrality_popup) {
        map._centrality_popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: [0, 8], maxWidth: "320px" });
      }
      map._centrality_popup.setLngLat(lngLat).setHTML(html).addTo(map);
    };
    const hide_popup = () => { if (map._centrality_popup) { try { map._centrality_popup.remove(); } catch {} } };

    map.on("load", () => {
      ensure_base();

      const canvas = containerRef.current?.querySelector(".mapboxgl-canvas");
      if (canvas) {
        canvas.style.borderRadius = "1rem";
        canvas.style.outline = "none";
        canvas.style.border = "0";
        canvas.style.boxShadow = "none";
        canvas.style.background = "transparent";
      }

      const on_move = (e) => {
        const f = e.features?.[0];
        if (!f) {
          hide_popup();
          return;
        }

        const p = f.properties || {};
        const name = p.name || p.ref || "unnamed segment";
        const html = `
          <div style="font:12px ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto; color:#e2e8f0;">
            <div style="font-weight:600; margin-bottom:4px; color:#fff;">${name}</div>
            <div style="display:grid; grid-template-columns:auto auto; gap:6px 10px;">
              <div style="color:#94a3b8;">RN_ID</div><div>${p.RN_ID ?? "—"}</div>
              <div style="color:#94a3b8;">PLANNING_AREA</div><div>${p.PLN_AREA_N ?? "—"}</div>
              <div style="color:#94a3b8;">IMPORTANCE</div><div>${format_number(p.importance,2) ?? "—"}</div>
              <div style="color:#94a3b8;">SLA</div><div>${format_number(p.sla_priority,2) ?? "—"}</div>
              <div style="color:#94a3b8;">BETWEENNESS</div><div>${format_number(p.betweenness_norm,4) ?? "—"}</div>
              <div style="color:#94a3b8;">CLOSENESS</div><div>${format_number(p.closeness_norm,4) ?? "—"}</div>
            </div>
          </div>
        `;
        show_popup(e.lngLat, html);
      };

      const on_leave = () => {
        hide_popup();
      };

      map.on("mousemove", "roads", on_move);
      map.on("mouseleave", "roads", on_leave);

      try { map.resize(); } catch {}
      requestAnimationFrame(() => { try { map.resize(); } catch {} });
    });

    return () => {
      try { mapRef.current?.remove(); } catch {}
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      try {
        const src = map.getSource("road-network");
        if (src && src.setData) src.setData(data?.features?.length ? data : EMPTY_COLLECTION);
        if (data?.features?.length) {
          const b = computeBounds(data);
          if (b) { try { map.fitBounds(b, { padding: 40, duration: 600, maxZoom: 15 }); } catch {} }
        }
        map.once("idle", () => { try { map.resize(); } catch {} });
      } catch {}
    };

    if (map.isStyleLoaded()) apply(); else map.once("load", apply);
  }, [data]);

  return (
    <div className="relative h-[60vh] min-h-[26rem] w-full rounded-2xl overflow-hidden bg-slate-950">
      <div ref={containerRef} className="absolute inset-0 min-h-[560px]" />
      {/* legend */}
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-xl bg-card/95 backdrop-blur-sm border p-3 text-xs shadow-lg">
        <p className="font-semibold mb-2">Legend</p>
        <div className="space-y-2">
          <div>
            <p className="text-muted-foreground mb-1">Colour = Importance Score</p>
            <div className="h-2 rounded" style={{ background: "linear-gradient(to right, #dbeafe, #93c5fd, #60a5fa, #3b82f6, #1d4ed8)" }} />
            <div className="mt-1 flex justify-between text-muted-foreground text-[10px]"><span>low</span><span>high</span></div>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">Thickness = Betweenness</p>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><span className="inline-block h-[2px] w-10 bg-muted-foreground" /><span className="text-muted-foreground text-[10px]">low</span></div>
              <div className="flex items-center gap-2"><span className="inline-block h-[6px] w-10 bg-foreground" /><span className="text-muted-foreground text-[10px]">high</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===== multiselect ===== */
function MultiSelectCombobox({
  label,
  options = [],
  selected = [],
  onChange,
  placeholder = "select",
  searchPlaceholder = "search…",
  emptyText = "no results.",
  popoverWidthClass = "w-[320px]",
  showClear = true,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalizedOptions = useMemo(() => options.map((o) => `${o}`.trim()).filter(Boolean), [options]);
  const selectedValues = useMemo(() => selected.map((v) => `${v}`.trim()).filter(Boolean), [selected]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((o) => o.toLowerCase().includes(q));
  }, [normalizedOptions, search]);

  const toggle = (val) => {
    const v = val.trim();
    const exists = selectedValues.includes(v);
    const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v];
    onChange?.(next);
  };

  const clearAll = () => onChange?.([]);

  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          {showClear && selectedValues.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs" onClick={clearAll}>
              clear
            </Button>
          )}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
            <span className="truncate text-left">{selectedValues.length ? `${selectedValues.length} selected` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="start" className={`z-50 ${popoverWidthClass} p-0`}>
          <Command>
            <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            <CommandEmpty>{emptyText}</CommandEmpty>

            <ScrollArea className="max-h-[60vh]">
              <CommandList>
                <CommandGroup>
                  {filteredOptions.map((opt) => {
                    const active = selectedSet.has(opt);
                    return (
                      <CommandItem
                        key={opt}
                        value={opt}
                        onSelect={() => toggle(opt)}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{opt}</span>
                        <Check className={active ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
      </Popover>

      {!!selectedValues.length && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => toggle(v)}
              aria-label={`Remove ${v}`}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="truncate max-w-[160px]">{v}</span>
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== base column defs ===== */
const BASE_COLUMNS = [
  { key: "RN_ID", label: "RN ID", type: "number" },
  { key: "name", label: "Name", type: "string" },
  { key: "PLN_AREA_N", label: "Planning Area", type: "string" },
  { key: "SUBZONE_N", label: "Subzone", type: "string" },
  { key: "road_type", label: "Road Type", type: "string" },
  { key: "betweenness_norm", label: "Betweenness", type: "number", format: (v) => format_number(v, 4) },
  { key: "closeness_norm", label: "Closeness", type: "number", format: (v) => format_number(v, 4) },
  { key: "betweenness_percentile", label: "Betweenness %ile", type: "number", format: (v) => format_number(v, 1) },
  { key: "closeness_percentile", label: "Closeness %ile", type: "number", format: (v) => format_number(v, 1) },
  { key: "amenity_score", label: "Amenity Score", type: "number", format: (v) => format_number(v, 2) },
  { key: "flood_score", label: "Flood Score", type: "number", format: (v) => format_number(v, 2) },
  { key: "amenity_count_total", label: "Amenity Count", type: "number" },
  { key: "flood_count_total", label: "Flood Count", type: "number" },
  { key: "importance", label: "Importance", type: "number", format: (v) => format_number(v, 2) },
  { key: "sla_priority", label: "SLA Priority", type: "number", format: (v) => format_number(v, 2) },
  { key: "score", label: "Score", type: "number", format: (v) => format_number(v, 2) },
];

/* ===== table ===== */
function CentralityTable({
  rows,
  totalRows,
  currentPage,
  totalPages,
  onPageChange,
  allColumnDefs,
  defaultKeys = ["RN_ID","name","PLN_AREA_N","score","importance","sla_priority","flood_count_total","amenity_count_total","betweenness_norm","closeness_norm"],
}) {
  const [tableQ, setTableQ] = useState("");
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedCols, setSelectedCols] = useState(defaultKeys);

  const columnMap = useMemo(() => {
    const m = Object.create(null);
    for (const c of allColumnDefs) m[c.key] = c;
    return m;
  }, [allColumnDefs]);

  const visibleColumns = useMemo(
    () => selectedCols.map((k) => columnMap[k]).filter(Boolean),
    [selectedCols, columnMap]
  );

  const start = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = totalRows === 0 ? 0 : Math.min(totalRows, currentPage * PAGE_SIZE);

  const filteredRows = useMemo(() => {
    const q = tableQ.trim().toLowerCase();
    if (!q) return rows;
    const keysForSearch = Object.keys(columnMap);
    return rows.filter((f) => {
      const p = f?.properties || {};
      for (const k of keysForSearch) {
        const v = p[k];
        if (v === null || v === undefined) continue;
        const s = String(v).toLowerCase();
        if (s.includes(q)) return true;
      }
      return false;
    });
  }, [rows, tableQ, columnMap]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const pa = a?.properties || {};
      const pb = b?.properties || {};
      const va = pa[sortKey];
      const vb = pb[sortKey];
      const na = Number(va); const nb = Number(vb);
      const bothNum = Number.isFinite(na) && Number.isFinite(nb);
      let cmp = 0;
      if (bothNum) cmp = na - nb;
      else cmp = String(va ?? "").localeCompare(String(vb ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  const pageRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [sortedRows, currentPage]);

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    }
  };

  const allColumnLabels = useMemo(() => allColumnDefs.map((c) => c.key), [allColumnDefs]);

  const export_csv = () => {
    const header = visibleColumns.map((c) => c.label || to_title_case(c.key));
    const lines = [header.join(",")];

    for (const f of sortedRows) {
      const p = f?.properties || {};
      const row = visibleColumns.map((c) => {
        let v = p[c.key];
        if (c.format && typeof v === "number") {
          const out = c.format(v);
          if (out !== null && out !== undefined) v = out;
        }
        if (v === null || v === undefined) v = "";
        const str = String(v).replace(/"/g, '""');
        return `"${str}"`;
      });
      lines.push(row.join(","));
    }

    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "centrality_export.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  };

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            showing {start.toLocaleString()} to {end.toLocaleString()} of {totalRows.toLocaleString()} segments
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* column chooser */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">choose columns</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[360px] max-h-[80vh] p-0">
              <div className="p-2 flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wide">columns</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(allColumnLabels)}>all</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols([])}>none</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(defaultKeys)}>reset</Button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 pr-2">
                  <div className="space-y-1 pb-2">
                    {allColumnDefs.map((c) => {
                      const active = selectedCols.includes(c.key);
                      return (
                        <label key={c.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer">
                          <span className="text-sm truncate mr-2">{c.label || to_title_case(c.key)}</span>
                          <input
                            type="checkbox"
                            className="accent-primary shrink-0"
                            checked={active}
                            onChange={() => {
                              setSelectedCols((prev) => active ? prev.filter((k) => k !== c.key) : [...prev, c.key]);
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* table search */}
          <Input
            value={tableQ}
            onChange={(e) => setTableQ(e.target.value)}
            placeholder="filter table…"
            className="w-56"
          />

          {/* export */}
          <Button onClick={export_csv} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            export csv
          </Button>
        </div>
      </div>

      {/* pagination top */}
      {totalRows > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onPageChange(Math.max(1, currentPage - 1))} 
            disabled={currentPage === 1}
          >
            previous
          </Button>
          <span className="text-xs text-muted-foreground">page {currentPage} / {totalPages}</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} 
            disabled={currentPage === totalPages}
          >
            next
          </Button>
        </div>
      )}

      {/* table */}
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {visibleColumns.map((col) => {
                const isSort = col.key === sortKey;
                return (
                  <th
                    key={col.key}
                    className="px-4 py-3 cursor-pointer select-none"
                    onClick={() => toggleSort(col.key)}
                    title="click to sort"
                  >
                    <div className="flex items-center gap-2">
                      <span>{col.label || to_title_case(col.key)}</span>
                      {isSort && <span className="text-xs">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-muted-foreground">no segments.</td></tr>
            ) : (
              pageRows.map((f, i) => {
                const p = f?.properties ?? {};
                const key = p.RN_ID ?? p.osmid ?? i;
                return (
                  <tr key={key} className="border-t hover:bg-muted/60">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-2">
                        {format_cell(p[col.key], col)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* pagination bottom */}
      {totalRows > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t pt-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onPageChange(Math.max(1, currentPage - 1))} 
            disabled={currentPage === 1}
          >
            previous
          </Button>
          <span className="text-xs text-muted-foreground">page {currentPage} / {totalPages}</span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} 
            disabled={currentPage === totalPages}
          >
            next
          </Button>
        </div>
      )}
    </div>
  );
}

/* ===== main component ===== */
export default function Centrality() {
  const {
    road_fc_enriched: roadFC,
    floods_fc_enriched: floodsFC,
    amenity_fc_raw: amenityFC,
    category_lookup: categoryLookup,
  } = useMapData();

  /* ===== derived options ===== */
  const planningOptions = useMemo(() => {
    const s = new Set();
    (roadFC?.features || []).forEach((f) => { const v = f?.properties?.PLN_AREA_N; if (v) s.add(String(v)); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [roadFC]);

  const subzoneOptionsRaw = useMemo(() => {
    const arr = [];
    (roadFC?.features || []).forEach((f) => {
      const p = f?.properties || {};
      const sz = p.SUBZONE_N ? String(p.SUBZONE_N) : null;
      const pa = p.PLN_AREA_N ? String(p.PLN_AREA_N) : null;
      if (sz) arr.push({ name: sz, planningArea: pa || "" });
    });
    const seen = new Set();
    return arr.filter(({ name, planningArea }) => {
      const k = `${planningArea}::${name}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [roadFC]);

  const roadTypeOptions = useMemo(() => {
    const s = new Set();
    (roadFC?.features || []).forEach((f) => s.add(String(get_road_type(f.properties))));
    s.delete("unknown");
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [roadFC]);

  /* ===== counts ===== */
  const amenityCounts = useMemo(() => {
    const m = Object.create(null);
    const byId = categoryLookup?.by_id || {};
    for (const a of amenityFC?.features || []) {
      const id = get_amenity_category_id(a.properties);
      const fromLookup = (id != null && byId[id]?.amenity_category) ? byId[id].amenity_category : null;
      const name = fromLookup || String(get_amenity_category(a.properties));
      m[name] = (m[name] || 0) + 1;
    }
    for (const row of categoryLookup?.table || []) {
      const name = row.amenity_category;
      if (!(name in m)) m[name] = 0;
    }
    return m;
  }, [amenityFC, categoryLookup]);

  const floodCounts = useMemo(() => {
    const m = Object.create(null);
    for (const f of floodsFC?.features || []) {
      const t = String(get_flood_type(f.properties));
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }, [floodsFC]);

  const amenityOptionsDisplay = useMemo(
    () => Object.keys(amenityCounts).sort((a, b) => a.localeCompare(b)).map((c) => `${to_title_case(c)} (${(amenityCounts[c] || 0).toLocaleString()})`),
    [amenityCounts]
  );
  const floodOptionsDisplay = useMemo(
    () => Object.keys(floodCounts).sort((a, b) => a.localeCompare(b)).map((t) => `${to_title_case(t)} (${(floodCounts[t] || 0).toLocaleString()})`),
    [floodCounts]
  );

  /* ===== selections ===== */
  const [planningSelected, setPlanningSelected] = useState([]);
  const [subzonesSelected, setSubzonesSelected] = useState([]);
  const [roadTypesSelected, setRoadTypesSelected] = useState([]);
  const [amenitySelectedLabels, setAmenitySelectedLabels] = useState([]);
  const [floodSelectedLabels, setFloodSelectedLabels] = useState([]);
  const amenitySelectedRawSet = useMemo(() => new Set(amenitySelectedLabels.map((s) => strip_count_suffix(s.replaceAll("_"," ").toLowerCase()))), [amenitySelectedLabels]);
  const floodSelectedRawSet   = useMemo(() => new Set(floodSelectedLabels.map((s) => strip_count_suffix(s.replaceAll("_"," ").toLowerCase()))), [floodSelectedLabels]);

  const [q, setQ] = useState("");

  /* ===== multiplier-based weights ===== */
  const amenityCategoryKeys = useMemo(
    () => Object.keys(amenityCounts).sort((a, b) => a.localeCompare(b)),
    [amenityCounts]
  );
  const floodTypeKeys = useMemo(
    () => Object.keys(floodCounts).sort((a, b) => a.localeCompare(b)),
    [floodCounts]
  );

  // Default multipliers and per-category toggles
  const default_amenity_weights = useMemo(() => {
    const w = {};
    for (const k of amenityCategoryKeys) w[k] = 1.0;
    return w;
  }, [amenityCategoryKeys]);
  const default_amenity_enabled = useMemo(() => {
    const e = {};
    for (const k of amenityCategoryKeys) e[k] = true;
    return e;
  }, [amenityCategoryKeys]);

  const default_flood_weights = useMemo(() => {
    const w = {};
    for (const k of floodTypeKeys) w[k] = 1.0;
    return w;
  }, [floodTypeKeys]);
  const default_flood_enabled = useMemo(() => {
    const e = {};
    for (const k of floodTypeKeys) e[k] = true;
    return e;
  }, [floodTypeKeys]);

  const [amenityWeights, setAmenityWeights] = useState(default_amenity_weights);
  const [amenityEnabled, setAmenityEnabled] = useState(default_amenity_enabled);
  const [floodWeights, setFloodWeights] = useState(default_flood_weights);
  const [floodEnabled, setFloodEnabled] = useState(default_flood_enabled);

  // Component toggles + weights
  const [useCompBetweenness, setUseCompBetweenness] = useState(true);
  const [useCompCloseness, setUseCompCloseness] = useState(true);
  const [useCompAmenity, setUseCompAmenity] = useState(true);
  const [useCompFlood, setUseCompFlood] = useState(true);

  const [w_betweenness, set_w_betweenness] = useState(0.4);
  const [w_closeness, set_w_closeness] = useState(0.3);
  const [w_amenity, set_w_amenity] = useState(0.2);
  const [w_flood, set_w_flood] = useState(0.1);

  /* ===== sync weights/toggles when categories change ===== */
  useEffect(() => {
    setAmenityWeights((prev) => {
      const next = { ...prev };
      for (const k of amenityCategoryKeys) if (!(k in next)) next[k] = 1.0;
      return next;
    });
    setAmenityEnabled((prev) => {
      const next = { ...prev };
      for (const k of amenityCategoryKeys) if (!(k in next)) next[k] = true;
      return next;
    });
  }, [amenityCategoryKeys]);

  useEffect(() => {
    setFloodWeights((prev) => {
      const next = { ...prev };
      for (const k of floodTypeKeys) if (!(k in next)) next[k] = 1.0;
      return next;
    });
    setFloodEnabled((prev) => {
      const next = { ...prev };
      for (const k of floodTypeKeys) if (!(k in next)) next[k] = true;
      return next;
    });
  }, [floodTypeKeys]);

  /* ===== amenity/flood components (by road) ===== */
  const amenityCategoryCountByRoad = useMemo(() => {
    const m = new Map();
    const byId = categoryLookup?.by_id || {};
    for (const a of amenityFC?.features || []) {
      const rn = a?.properties?.rn_id;
      if (rn == null) continue;
      const id = get_amenity_category_id(a.properties);
      const fromLookup = (id != null && byId[id]?.amenity_category) ? byId[id].amenity_category : null;
      const cat = fromLookup || String(get_amenity_category(a.properties));
      if (!m.has(rn)) m.set(rn, new Map());
      const inner = m.get(rn);
      inner.set(cat, (inner.get(cat) || 0) + 1);
    }
    return m;
  }, [amenityFC, categoryLookup]);

  const floodTypeCountByRoad = useMemo(() => {
    const m = new Map();
    for (const f of floodsFC?.features || []) {
      const rn = f?.properties?.start_rn_id;
      if (rn == null) continue;
      const t = String(get_flood_type(f.properties));
      if (!m.has(rn)) m.set(rn, new Map());
      const inner = m.get(rn);
      inner.set(t, (inner.get(t) || 0) + 1);
    }
    return m;
  }, [floodsFC]);

  function computeAmenityScore(rn) {
    if (!useCompAmenity) return 0;
    const row = amenityCategoryCountByRoad.get(rn);
    if (!row) return 0;
    let weighted = 0;
    for (const [cat, count] of row.entries()) {
      if (!amenityEnabled[cat]) continue; // category toggled off
      const w = amenityWeights[cat] ?? 1.0;
      weighted += count * w;
    }
    // Example rule-of-thumb scaling
    return Math.min(100, 20 * Math.log10(1 + weighted));
  }

  function computeFloodScore(rn) {
    if (!useCompFlood) return 0;
    const row = floodTypeCountByRoad.get(rn);
    if (!row) return 0;
    let weighted = 0;
    for (const [type, count] of row.entries()) {
      if (!floodEnabled[type]) continue; // type toggled off
      const w = floodWeights[type] ?? 1.0;
      weighted += count * w;
    }
    return Math.min(100, 25 * Math.log10(1 + weighted));
  }

  /* ===== filters ===== */
  const features = useMemo(() => roadFC?.features ?? [], [roadFC]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const hasPA = planningSelected.length > 0;
    const hasSZ = subzonesSelected.length > 0;
    const hasRT = roadTypesSelected.length > 0;
    const paSet = new Set(planningSelected.map(String));
    const szSet = new Set(subzonesSelected.map(String));
    const rtSet = new Set(roadTypesSelected.map(String));

    return (features || []).filter((f) => {
      const p = f?.properties;
      if (!p) return false;

      if (hasPA && p.PLN_AREA_N && !paSet.has(String(p.PLN_AREA_N))) return false;
      if (hasSZ) {
        const sz = p.SUBZONE_N ? String(p.SUBZONE_N) : "";
        if (!szSet.has(sz)) return false;
      }
      if (hasRT) {
        const rt = String(get_road_type(p));
        if (!rtSet.has(rt)) return false;
      }

      if (!term) return true;
      const hay = [p.RN_ID, p.name, p.PLN_AREA_N, p.SUBZONE_N].map((x) => String(x || "").toLowerCase()).join("|");
      return hay.includes(term);
    });
  }, [features, planningSelected, subzonesSelected, roadTypesSelected, q]);

  /* ===== percentilers ===== */
  const pBet = useMemo(() => make_percentiler(features.map((f) => +f?.properties?.betweenness_norm)), [features]);
  const pClo = useMemo(() => make_percentiler(features.map((f) => +f?.properties?.closeness_norm)), [features]);

  /* ===== enrich & score ===== */
  const scored = useMemo(() => {
    return filtered.map((f) => {
      if (!f) return null;
      const p = f.properties ?? {};
      const rn = p.RN_ID == null ? null : Number(p.RN_ID);
      const bet = nznum(p.betweenness_norm);
      const clo = nznum(p.closeness_norm);
      const bet_percentile = pBet(bet);
      const clo_percentile = pClo(clo);

      const amenity_score = rn != null ? computeAmenityScore(rn) : 0;
      const flood_score = rn != null ? computeFloodScore(rn) : 0;

      const amenRow = amenityCategoryCountByRoad.get(rn) || new Map();
      const floodRow = floodTypeCountByRoad.get(rn) || new Map();
      const amenTot = Array.from(amenRow.values()).reduce((a, v) => a + v, 0);
      const floodTot = Array.from(floodRow.values()).reduce((a, v) => a + v, 0);

      // Components 0-100 (bet/clo already 0-1)
      const bet_norm = useCompBetweenness ? bet * 100 : 0;
      const clo_norm = useCompCloseness ? clo * 100 : 0;

      const importance = (
        (useCompBetweenness ? w_betweenness : 0) * bet_norm +
        (useCompCloseness ? w_closeness : 0) * clo_norm +
        (useCompAmenity ? w_amenity : 0) * amenity_score +
        (useCompFlood ? w_flood : 0) * flood_score
      );

      const sla_priority = importance;
      const score = importance;

      return {
        ...f,
        properties: {
          ...p,
          road_type: get_road_type(p),
          betweenness_norm: bet,
          closeness_norm: clo,
          betweenness_percentile: bet_percentile,
          closeness_percentile: clo_percentile,
          amenity_score,
          flood_score,
          amenity_count_total: amenTot,
          flood_count_total: floodTot,
          importance: Math.round(importance * 100) / 100,
          sla_priority: Math.round(sla_priority * 100) / 100,
          score: Math.round(score * 100) / 100,
        },
      };
    }).filter(Boolean);
  }, [
    filtered, pBet, pClo,
    amenityWeights, floodWeights,
    amenityEnabled, floodEnabled,
    useCompAmenity, useCompFlood, useCompBetweenness, useCompCloseness,
    w_betweenness, w_closeness, w_amenity, w_flood,
    amenityCategoryCountByRoad, floodTypeCountByRoad
  ]);

  /* ===== paging ===== */
  const [currentPage, setCurrentPage] = useState(1);
  const sortedByScore = useMemo(() => {
    const arr = [...scored];
    arr.sort((a, b) => (b.properties.score || 0) - (a.properties.score || 0));
    return arr;
  }, [scored]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedByScore.length / PAGE_SIZE)), [sortedByScore.length]);

  const allColumnDefs = useMemo(() => {
    const keys = new Set(BASE_COLUMNS.map((c) => c.key));
    for (const f of scored) {
      const p = f?.properties || {};
      Object.keys(p).forEach((k) => keys.add(k));
    }
    const map = Object.fromEntries(BASE_COLUMNS.map((c) => [c.key, c]));
    const defs = Array.from(keys).map((k) => {
      if (map[k]) return map[k];
      return { key: k, label: to_title_case(k), type: (typeof scored?.[0]?.properties?.[k] === "number" ? "number" : "string") };
    });
    const baseOrder = new Map(BASE_COLUMNS.map((c, i) => [c.key, i]));
    defs.sort((a, b) => {
      const ia = baseOrder.has(a.key) ? baseOrder.get(a.key) : 1e9;
      const ib = baseOrder.has(b.key) ? baseOrder.get(b.key) : 1e9;
      if (ia !== ib) return ia - ib;
      return (a.label || a.key).localeCompare(b.label || b.key);
    });
    return defs;
  }, [scored]);

  const mapData = useMemo(() => (scored.length ? { type: "FeatureCollection", features: scored } : EMPTY_COLLECTION), [scored]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    planningSelected.join("|"),
    subzonesSelected.join("|"),
    roadTypesSelected.join("|"),
    q,
    amenitySelectedLabels.join("|"),
    floodSelectedLabels.join("|"),
    JSON.stringify(amenityEnabled),
    JSON.stringify(floodEnabled),
  ]);

  /* ===== example calculation ===== */
  const exampleSegment = useMemo(() => {
    const topRoad = sortedByScore[0];
    if (!topRoad) return null;

    const p = topRoad.properties;
    const rn = p.RN_ID;

    // Amenity breakdown (respect per-category toggle)
    const amenRow = amenityCategoryCountByRoad.get(rn) || new Map();
    const amenityBreakdown = [];
    for (const [cat, count] of amenRow.entries()) {
      const enabled = !!amenityEnabled[cat];
      const weight = amenityWeights[cat] ?? 1.0;
      const weighted = enabled ? count * weight : 0;
      amenityBreakdown.push({ category: cat, count, weight, enabled, weighted });
    }
    amenityBreakdown.sort((a, b) => b.weighted - a.weighted);

    // Flood breakdown (respect per-type toggle)
    const floodRow = floodTypeCountByRoad.get(rn) || new Map();
    const floodBreakdown = [];
    for (const [type, count] of floodRow.entries()) {
      const enabled = !!floodEnabled[type];
      const weight = floodWeights[type] ?? 1.0;
      const weighted = enabled ? count * weight : 0;
      floodBreakdown.push({ type, count, weight, enabled, weighted });
    }
    floodBreakdown.sort((a, b) => b.weighted - a.weighted);

    return {
      name: p.name || "Example Road",
      betweenness: p.betweenness_norm,
      closeness: p.closeness_norm,
      amenity_score: p.amenity_score,
      flood_score: p.flood_score,
      importance: p.importance,
      amenityBreakdown,
      floodBreakdown,
    };
  }, [
    sortedByScore, amenityCategoryCountByRoad, floodTypeCountByRoad,
    amenityWeights, floodWeights, amenityEnabled, floodEnabled
  ]);

  /* ===== ui ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-6">
      {/* header */}
      <header className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Road Network Centrality</h1>
          <p className="text-sm text-muted-foreground md:text-base">
            Analyse road importance using weighted components. Each section below is its own accordion. Use per-category toggles to include/exclude categories while setting weights.
          </p>
        </div>

        {/* each subsection is its own accordion */}
        <Accordion type="multiple" className="space-y-4">
          {/* Road Filters */}
          <AccordionItem value="filters" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-base font-semibold">
              Road Filters
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Filter by Area, Subzone, Road Type, Search</CardTitle>
                  <CardDescription>Filter the road network by location, type, or search term.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <MultiSelectCombobox
                      label="Planning Area"
                      options={planningOptions}
                      selected={planningSelected}
                      onChange={setPlanningSelected}
                      placeholder="Select planning areas"
                      searchPlaceholder="Search planning areas…"
                      popoverWidthClass="w-[360px]"
                    />

                    {/* subzone */}
                    <div className="space-y-1.5">
                      <Label>Subzone</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button type="button" variant="outline" className="w-full justify-between">
                            <span className="truncate text-left">
                              {subzonesSelected.length ? `${subzonesSelected.length} selected` : "Select subzones"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[360px] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search by subzone or planning area" />
                            <CommandEmpty>No subzone found.</CommandEmpty>
                            <CommandList>
                              <CommandGroup>
                                <ScrollArea className="max-h-64">
                                  {(subzoneOptionsRaw || [])
                                    .filter((z) => {
                                      if (!planningSelected.length) return true;
                                      return z.planningArea && planningSelected.includes(z.planningArea);
                                    })
                                    .map((o) => {
                                      const active = subzonesSelected.includes(o.name);
                                      const value = `${o.name} ${o.planningArea}`;
                                      return (
                                        <CommandItem
                                          key={`${o.planningArea}::${o.name}`}
                                          value={value}
                                          onSelect={() => {
                                            const exists = active;
                                            setSubzonesSelected((prev) =>
                                              exists ? prev.filter((x) => x !== o.name) : [...prev, o.name]
                                            );
                                          }}
                                          className="flex items-center justify-between gap-2"
                                        >
                                          <div className="min-w-0">
                                            <div className="truncate">{o.name}</div>
                                            <div className="text-xs text-muted-foreground truncate">{o.planningArea}</div>
                                          </div>
                                          <Check className={active ? "h-4 w-4" : "h-4 w-4 opacity-0"} />
                                        </CommandItem>
                                      );
                                    })}
                                </ScrollArea>
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>

                      {!!subzonesSelected.length && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {subzonesSelected.map((v) => (
                            <button
                              type="button"
                              key={v}
                              onClick={() => setSubzonesSelected((prev) => prev.filter((x) => x !== v))}
                              aria-label={`Remove ${v}`}
                              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                            >
                              <span className="truncate max-w-[160px]">{v}</span>
                              <X className="h-3 w-3" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <MultiSelectCombobox
                      label="Road Type"
                      options={roadTypeOptions}
                      selected={roadTypesSelected}
                      onChange={setRoadTypesSelected}
                      placeholder="Select road types"
                      searchPlaceholder="Search road types…"
                      popoverWidthClass="w-[360px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="road-search">Search</Label>
                    <Input
                      id="road-search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Name, RN ID, area…"
                    />
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Amenity Categories */}
          <AccordionItem value="amenities" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-base font-semibold">
              Amenity Categories (toggle per-category)
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Per-Category Toggles & Multipliers</CardTitle>
                  <CardDescription>
                    Example: if a road has 5 amenities (e.g., 2 hospitals, 3 schools), the weighted total is (2×hospital weight) + (3×school weight). Disabled categories contribute 0.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Example accordion */}
                  {exampleSegment && (
                    <Accordion type="single" collapsible className="rounded-xl border bg-muted/40">
                      <AccordionItem value="example" className="border-0">
                        <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                          Example: {exampleSegment.name}
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="space-y-4 text-sm">
                            {exampleSegment.amenityBreakdown && exampleSegment.amenityBreakdown.length > 0 ? (
                              <>
                                <div>
                                  <div className="font-semibold mb-2">Amenities on this road:</div>
                                  <div className="space-y-2">
                                    {exampleSegment.amenityBreakdown.map(({ category, count, weight, enabled, weighted }) => (
                                      <div key={category} className="rounded-lg border bg-background px-3 py-2 text-xs">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium">{to_title_case(category)}</span>
                                          <span className="text-muted-foreground">
                                            {count} × {weight.toFixed(1)} × {enabled ? "on" : "off"} = <b>{weighted.toFixed(1)}</b>
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-lg border bg-muted/40 p-3">
                                  <div className="font-semibold mb-2">Calculation:</div>
                                  <div className="text-xs space-y-1 font-mono">
                                    <div>
                                      Total weighted = {
                                        exampleSegment.amenityBreakdown
                                          .map(b => b.weighted)
                                          .reduce((a, v) => a + v, 0).toFixed(1)
                                      }
                                    </div>
                                    <div>Amenity score = min(100, 20 × log₁₀(1 + total weighted))</div>
                                    <div className="mt-1">= <b>{exampleSegment.amenity_score.toFixed(2)}</b></div>
                                  </div>
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    This score feeds into the final importance via the component weight below.
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-muted-foreground">No amenities on this road segment.</div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {amenityCategoryKeys.map((cat) => {
                      const val = amenityWeights[cat] ?? 1.0;
                      const enabled = !!amenityEnabled[cat];
                      return (
                        <div key={cat} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(cat)}</span>
                            <span className="text-xs text-muted-foreground">{amenityCounts[cat] || 0} total</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`amen-${cat}`}
                                checked={enabled}
                                onCheckedChange={(ck) => setAmenityEnabled((prev) => ({ ...prev, [cat]: !!ck }))}
                              />
                              <Label htmlFor={`amen-${cat}`} className="text-xs cursor-pointer">enable</Label>
                            </div>

                            <Input
                              type="number"
                              min="1"
                              max="10"
                              step="0.1"
                              value={val}
                              onChange={(e) => {
                                const next = clamp(+e.target.value || 1, 1, 10);
                                setAmenityWeights((prev) => ({ ...prev, [cat]: next }));
                              }}
                              disabled={!enabled}
                              className="h-9 w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Flood Event Types */}
          <AccordionItem value="floods" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-base font-semibold">
              Flood Event Types (toggle per-type)
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Per-Type Toggles & Multipliers</CardTitle>
                  <CardDescription>
                    Example: if a road has 4 flood events (1 drain overflow, 3 ponding), the weighted total is (1×drain weight) + (3×ponding weight). Disabled types contribute 0.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Example accordion */}
                  {exampleSegment && (
                    <Accordion type="single" collapsible className="rounded-xl border bg-muted/40">
                      <AccordionItem value="example" className="border-0">
                        <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                          Example: {exampleSegment.name}
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4">
                          <div className="space-y-4 text-sm">
                            {exampleSegment.floodBreakdown && exampleSegment.floodBreakdown.length > 0 ? (
                              <>
                                <div>
                                  <div className="font-semibold mb-2">Flood events on this road:</div>
                                  <div className="space-y-2">
                                    {exampleSegment.floodBreakdown.map(({ type, count, weight, enabled, weighted }) => (
                                      <div key={type} className="rounded-lg border bg-background px-3 py-2 text-xs">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium">{to_title_case(type)}</span>
                                          <span className="text-muted-foreground">
                                            {count} × {weight.toFixed(1)} × {enabled ? "on" : "off"} = <b>{weighted.toFixed(1)}</b>
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-lg border bg-muted/40 p-3">
                                  <div className="font-semibold mb-2">Calculation:</div>
                                  <div className="text-xs space-y-1 font-mono">
                                    <div>
                                      Total weighted = {
                                        exampleSegment.floodBreakdown
                                          .map(b => b.weighted)
                                          .reduce((a, v) => a + v, 0).toFixed(1)
                                      }
                                    </div>
                                    <div>Flood score = min(100, 25 × log₁₀(1 + total weighted))</div>
                                    <div className="mt-1">= <b>{exampleSegment.flood_score.toFixed(2)}</b></div>
                                  </div>
                                  <div className="mt-2 text-xs text-muted-foreground">
                                    This score feeds into the final importance via the component weight below.
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="text-xs text-muted-foreground">No flood events on this road segment.</div>
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {floodTypeKeys.map((type) => {
                      const val = floodWeights[type] ?? 1.0;
                      const enabled = !!floodEnabled[type];
                      return (
                        <div key={type} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(type)}</span>
                            <span className="text-xs text-muted-foreground">{floodCounts[type] || 0} events</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`flood-${type}`}
                                checked={enabled}
                                onCheckedChange={(ck) => setFloodEnabled((prev) => ({ ...prev, [type]: !!ck }))}
                              />
                              <Label htmlFor={`flood-${type}`} className="text-xs cursor-pointer">enable</Label>
                            </div>

                            <Input
                              type="number"
                              min="1"
                              max="10"
                              step="0.1"
                              value={val}
                              onChange={(e) => {
                                const next = clamp(+e.target.value || 1, 1, 10);
                                setFloodWeights((prev) => ({ ...prev, [type]: next }));
                              }}
                              disabled={!enabled}
                              className="h-9 w-24 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Component Weights */}
          <AccordionItem value="weights" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-base font-semibold">
              Component Weights (toggle components)
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-6">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Adjust Component Contribution</CardTitle>
                  <CardDescription>Turn components on/off and set their weights. Components off contribute 0.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* betweenness */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Betweenness Centrality</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch id="comp-bet" checked={useCompBetweenness} onCheckedChange={setUseCompBetweenness} />
                            <Label htmlFor="comp-bet" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{w_betweenness.toFixed(2)}</span>
                        </div>
                      </div>
                      <Slider
                        value={[w_betweenness * 100]}
                        min={0} max={100} step={1}
                        onValueChange={(v) => set_w_betweenness((v[0] || 0) / 100)}
                        disabled={!useCompBetweenness}
                      />
                      <p className="text-xs text-muted-foreground">
                        How often this road lies on shortest paths between other roads.
                      </p>
                    </div>

                    {/* closeness */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Closeness Centrality</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch id="comp-clo" checked={useCompCloseness} onCheckedChange={setUseCompCloseness} />
                            <Label htmlFor="comp-clo" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{w_closeness.toFixed(2)}</span>
                        </div>
                      </div>
                      <Slider
                        value={[w_closeness * 100]}
                        min={0} max={100} step={1}
                        onValueChange={(v) => set_w_closeness((v[0] || 0) / 100)}
                        disabled={!useCompCloseness}
                      />
                      <p className="text-xs text-muted-foreground">
                        How quickly this road can reach all other roads in the network.
                      </p>
                    </div>

                    {/* amenities */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Amenity Impact</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch id="comp-amen" checked={useCompAmenity} onCheckedChange={setUseCompAmenity} />
                            <Label htmlFor="comp-amen" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{w_amenity.toFixed(2)}</span>
                        </div>
                      </div>
                      <Slider
                        value={[w_amenity * 100]}
                        min={0} max={100} step={1}
                        onValueChange={(v) => set_w_amenity((v[0] || 0) / 100)}
                        disabled={!useCompAmenity}
                      />
                      <p className="text-xs text-muted-foreground">
                        Density of nearby amenities weighted by per-category multipliers.
                      </p>
                    </div>

                    {/* floods */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Flood History</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch id="comp-flood" checked={useCompFlood} onCheckedChange={setUseCompFlood} />
                            <Label htmlFor="comp-flood" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{w_flood.toFixed(2)}</span>
                        </div>
                      </div>
                      <Slider
                        value={[w_flood * 100]}
                        min={0} max={100} step={1}
                        onValueChange={(v) => set_w_flood((v[0] || 0) / 100)}
                        disabled={!useCompFlood}
                      />
                      <p className="text-xs text-muted-foreground">
                        Number of flood events weighted by per-type multipliers.
                      </p>
                    </div>
                  </div>

                  {/* example calculation */}
                  {exampleSegment && (
                    <div className="rounded-xl border bg-muted/40 p-4">
                      <div className="font-semibold mb-3">Flat Example: {exampleSegment.name}</div>
                      <div className="grid gap-3 text-sm">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="text-muted-foreground">Betweenness (0-100):</div>
                          <div className="font-mono">{(exampleSegment.betweenness * 100).toFixed(2)} × {useCompBetweenness ? w_betweenness.toFixed(2) : "0.00"}</div>
                          <div className="text-muted-foreground">Closeness (0-100):</div>
                          <div className="font-mono">{(exampleSegment.closeness * 100).toFixed(2)} × {useCompCloseness ? w_closeness.toFixed(2) : "0.00"}</div>
                          <div className="text-muted-foreground">Amenity Score:</div>
                          <div className="font-mono">{exampleSegment.amenity_score.toFixed(2)} × {useCompAmenity ? w_amenity.toFixed(2) : "0.00"}</div>
                          <div className="text-muted-foreground">Flood Score:</div>
                          <div className="font-mono">{exampleSegment.flood_score.toFixed(2)} × {useCompFlood ? w_flood.toFixed(2) : "0.00"}</div>
                        </div>
                        <div className="border-t pt-2 font-mono text-xs">
                          <div className="mb-1">Sum:</div>
                          <div className="text-muted-foreground">
                            = {(useCompBetweenness ? w_betweenness : 0).toFixed(2)} × {(exampleSegment.betweenness * 100).toFixed(2)}
                            + {(useCompCloseness ? w_closeness : 0).toFixed(2)} × {(exampleSegment.closeness * 100).toFixed(2)}
                            + {(useCompAmenity ? w_amenity : 0).toFixed(2)} × {exampleSegment.amenity_score.toFixed(2)}
                            + {(useCompFlood ? w_flood : 0).toFixed(2)} × {exampleSegment.flood_score.toFixed(2)}
                          </div>
                          <div className="mt-1 font-semibold">
                            = {exampleSegment.importance.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPlanningSelected([]); setSubzonesSelected([]); setRoadTypesSelected([]);
                        setAmenitySelectedLabels([]); setFloodSelectedLabels([]); setQ("");

                        setAmenityWeights(default_amenity_weights);
                        setAmenityEnabled(default_amenity_enabled);
                        setFloodWeights(default_flood_weights);
                        setFloodEnabled(default_flood_enabled);

                        setUseCompBetweenness(true);
                        setUseCompCloseness(true);
                        setUseCompAmenity(true);
                        setUseCompFlood(true);

                        set_w_betweenness(0.4);
                        set_w_closeness(0.3);
                        set_w_amenity(0.2);
                        set_w_flood(0.1);
                      }}
                    >
                      Reset All Settings
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </header>

      {/* map + top list */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CentralityMap data={mapData} />
        </div>

        {/* top ranked */}
        <aside className="h-[60vh] min-h-[26rem] rounded-3xl overflow-hidden border bg-card shadow-sm p-4 flex flex-col">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Top 20 by Importance</h2>
            <p className="text-xs text-muted-foreground mt-1">Highest-scoring road segments based on current weights</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-2 pr-2">
              {sortedByScore.slice(0, 20).map((f, i) => {
                const p = f.properties || {};
                return (
                  <div key={p.RN_ID ?? i} className="rounded-xl border p-3 bg-muted/30">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="font-semibold truncate">{p.name || "Unnamed Segment"}</div>
                      <div className="text-muted-foreground">#{i + 1}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <div><span className="font-medium">Area:</span> {p.PLN_AREA_N || "—"}</div>
                      <div><span className="font-medium">RN ID:</span> {p.RN_ID ?? "—"}</div>
                      <div><span className="font-medium">Importance:</span> <b className="text-foreground">{format_number(p.importance, 2) ?? "—"}</b></div>
                      <div><span className="font-medium">SLA:</span> <b className="text-foreground">{format_number(p.sla_priority, 2) ?? "—"}</b></div>
                      <div><span className="font-medium">Amenities:</span> {p.amenity_count_total ?? "—"}</div>
                      <div><span className="font-medium">Floods:</span> {p.flood_count_total ?? "—"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>
      </div>

      {/* table */}
      <section className="rounded-3xl border bg-card shadow-sm p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">All Segments</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete list of road segments with sortable columns and export capability
          </p>
        </div>
        <CentralityTable
          rows={sortedByScore}
          totalRows={sortedByScore.length}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          allColumnDefs={allColumnDefs}
        />
      </section>

      {/* custom popup styles */}
      <style>{`
        .centrality-popup .mapboxgl-popup-content {
          border-radius: 12px;
          padding: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
      `}</style>
    </div>
  );
}
