// src/pages/centrality.jsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { computeBounds } from "@/lib/geo";
import { useMapData } from "@/context/MapDataContext";

/* shadcn ui */
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronsUpDown, X, Download } from "lucide-react";

/* ===== map + page config (dark) ===== */
const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const MAPBOX_STYLE = "mapbox://styles/mapbox/dark-v11";
const MAP_DEFAULT_CENTER = [103.8198, 1.3521];
const MAP_DEFAULT_ZOOM = 11;

const PAGE_SIZE = 40;
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

mapboxgl.accessToken = MAPBOX_TOKEN;
if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

/* ===== helpers ===== */
const nznum = (v) => (Number.isFinite(+v) ? +v : 0);
const fmtPct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "—");
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const strip_count_suffix = (s) => String(s).replace(/\s*\(\s*\d[\d,]*\s*\)\s*$/, "").trim();
const to_caps_underscore = (s) => String(s || "")
  .replace(/[\s\-]+/g, "_")
  .replace(/[^\w]+/g, "_")
  .replace(/__+/g, "_")
  .replace(/^_+|_+$/g, "")
  .toUpperCase();

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
  0, "#0b1220",
  20, "#15375a",
  40, "#18597b",
  70, "#1d8f85",
  90, "#23d3a0",
];
const WIDTH_EXPR = [
  "interpolate", ["linear"], ["coalesce", ["to-number", ["get", "betweenness_norm"]], 0],
  0, 1, 0.05, 1.5, 0.1, 2.5, 0.3, 4, 0.6, 6, 1, 8,
];

/* ===== 100% stacked bar ===== */
function StackedBar100({ parts, title }) {
  const entries = Object.entries(parts || {});
  const totalRaw = entries.reduce((a, [,v]) => a + (v||0), 0);
  const total = totalRaw > 0 ? totalRaw : 0;
  const norm = total > 0 ? entries.map(([k,v]) => [k, (v||0)/total]) : entries.map(([k]) => [k, 0]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className={`text-xs ${Math.abs(total - 1) < 1e-6 ? "text-slate-400" : "text-amber-400"}`}>
          total = {(total * 100).toFixed(1)}%
        </div>
      </div>
      <div className="w-full h-6 rounded-md overflow-hidden border border-slate-800 bg-slate-950 flex">
        {norm.map(([label, share], i) => {
          const hue = (i * 47) % 360;
          return (
            <div
              key={label}
              className="h-full relative"
              style={{ width: `${share * 100}%`, background: `hsl(${hue} 85% 55%)` }}
              title={`${label}: ${(share * 100).toFixed(1)}%`}
            >
              {share > 0.08 && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white/90">
                  {to_caps_underscore(label)} · {(share * 100).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {total > 1.001 && (
        <div className="mt-1 text-[11px] text-amber-400">heads up: total &gt; 100% (free mode)</div>
      )}
    </div>
  );
}

/* ===== row editor ===== */
function WeightsRowEditor({
  keysOrdered = [],
  values = {},
  onChange,
  label = "weights",
  normaliseMode = true,
  onToggleNormalise,
  showScoringToggle = false,
  scoringNormalised = true,
  onToggleScoringNormalised,
}) {
  const activeKeys = keysOrdered;

  const makeRecommendation = useCallback((lockKey = null) => {
    const cur = activeKeys.map((k) => [k, Math.max(0, values[k] ?? 0)]);
    const sum = cur.reduce((a, [,v]) => a + v, 0);
    if (activeKeys.length === 0) return {};
    if (Math.abs(sum - 1) < 1e-9) return Object.fromEntries(cur);

    const others = cur.filter(([k]) => k !== lockKey);
    const sumOthers = others.reduce((a, [,v]) => a + v, 0);
    const next = Object.fromEntries(cur);
    if (lockKey && sumOthers > 1e-12) {
      const remain = Math.max(0, 1 - (values[lockKey] ?? 0));
      for (const [k, v] of others) {
        const w = v / sumOthers;
        next[k] = remain * w;
      }
      return next;
    }
    if (sum > 1e-12) {
      for (const [k, v] of cur) next[k] = v / sum;
      return next;
    }
    const eq = 1 / activeKeys.length;
    return Object.fromEntries(activeKeys.map((k) => [k, eq]));
  }, [activeKeys, values]);

  const total = useMemo(() => activeKeys.reduce((a, k) => a + Math.max(0, values[k] ?? 0), 0), [activeKeys, values]);
  const recommendation = useMemo(() => makeRecommendation(), [makeRecommendation]);

  const setValue = (k, nextPctStr) => {
    let nextPct = Number(nextPctStr);
    if (!Number.isFinite(nextPct)) nextPct = 0;
    nextPct = clamp(nextPct, 0, 100);
    const nextVal = nextPct / 100;

    if (!normaliseMode) {
      onChange?.({ ...values, [k]: nextVal });
      return;
    }
    const others = activeKeys.filter((x) => x !== k);
    const remain = Math.max(0, 1 - nextVal);
    const sumOthers = others.reduce((a, x) => a + (values[x] ?? 0), 0);
    const next = { ...values, [k]: nextVal };
    if (others.length && sumOthers > 1e-12) {
      for (const x of others) next[x] = remain * ((values[x] ?? 0) / sumOthers);
    } else if (others.length) {
      const split = remain / others.length;
      for (const x of others) next[x] = split;
    }
    onChange?.(next);
  };

  const normaliseNow = () => onChange?.(makeRecommendation(null));
  const applyRecommendation = (lockKey = null) => onChange?.(makeRecommendation(lockKey));

  const handleToggleNormalise = (checked) => {
    onToggleNormalise?.(!!checked);
    if (checked) onChange?.(makeRecommendation(null));
  };

  const parts = Object.fromEntries(activeKeys.map((k) => [k, Math.max(0, values[k] ?? 0)]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-100">{label}</div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={!!normaliseMode}
              onChange={(e) => handleToggleNormalise(e.target.checked)}
              className="accent-sky-500"
            />
            normalise to 100%
          </label>
          {showScoringToggle && (
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={!!scoringNormalised}
                onChange={(e) => onToggleScoringNormalised?.(e.target.checked)}
                className="accent-sky-500"
              />
              normalise for scoring
            </label>
          )}
        </div>
      </div>

      <StackedBar100 parts={parts} title="stacked weights" />

      {!normaliseMode && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 border-slate-700 text-slate-200" onClick={normaliseNow}>
            normalise now
          </Button>
          <span className="text-xs text-slate-500">free mode — totals can be ≠ 100%. snap when needed.</span>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {activeKeys.map((k, i) => {
          const hue = (i * 47) % 360;
          const share = Math.max(0, (values[k] ?? 0));
          const pct = (share * 100).toFixed(1);
          return (
            <div key={k} className="rounded-md border border-slate-800 p-2 bg-slate-950">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-sm" style={{ background: `hsl(${hue} 85% 55%)` }} />
                  <span className="text-xs text-slate-100">{to_caps_underscore(k)}</span>
                </div>
                <div className="text-xs text-slate-400">{pct}%</div>
              </div>

              <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={pct}
                  onChange={(e) => setValue(k, e.target.value)}
                  className="w-full"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={pct}
                    onChange={(e) => setValue(k, e.target.value)}
                    className="w-20 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-500">%</span>
                </div>
              </div>

              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-slate-300"
                  onClick={() => {
                    if (!normaliseMode) {
                      onChange?.({ ...values, [k]: 1 });
                    } else {
                      const next = Object.fromEntries(activeKeys.map((x) => [x, x === k ? 1 : 0]));
                      onChange?.(next);
                    }
                  }}
                >
                  set 100%
                </Button>
              </div>

              {!normaliseMode && Math.abs(total - 1) > 1e-6 && (
                <div className="mt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 border-slate-700 text-slate-200"
                    onClick={() => applyRecommendation(k)}
                    title="apply recommendation while keeping this factor unchanged"
                  >
                    apply suggestion (lock this)
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================================
   map (dark)
   ========================================================================== */
function CentralityMap({ data }) {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const hoverFeatureIdRef = useRef(null);

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
        map.addSource("road-network", { type: "geojson", data: EMPTY_COLLECTION, generateId: true });
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
      if (!map.getLayer("roads-hover")) {
        map.addLayer({
          id: "roads-hover",
          type: "line",
          source: "road-network",
          filter: ["boolean", ["feature-state", "hover"], false],
          layout: { visibility: "visible", "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#38bdf8", "line-width": 8, "line-opacity": 0.9 },
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
          if (hoverFeatureIdRef.current != null) {
            map.setFeatureState({ source: "road-network", id: hoverFeatureIdRef.current }, { hover: false });
            hoverFeatureIdRef.current = null;
          }
          hide_popup();
          return;
        }
        const fid = f.id;
        if (fid !== hoverFeatureIdRef.current) {
          if (hoverFeatureIdRef.current != null) {
            map.setFeatureState({ source: "road-network", id: hoverFeatureIdRef.current }, { hover: false });
          }
          hoverFeatureIdRef.current = fid;
          map.setFeatureState({ source: "road-network", id: fid }, { hover: true });
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
        if (hoverFeatureIdRef.current != null) {
          map.setFeatureState({ source: "road-network", id: hoverFeatureIdRef.current }, { hover: false });
          hoverFeatureIdRef.current = null;
        }
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
      {/* legend (dark) */}
      <div className="pointer-events-none absolute left-4 bottom-4 z-10 rounded-md bg-slate-900/90 border border-slate-800 p-3 text-xs text-slate-300">
        <p className="font-semibold text-slate-100">legend</p>
        <div className="mt-2">
          <p>colour = importance score</p>
          <div className="mt-1 h-2 rounded" style={{ background: "linear-gradient(to right, #0b1220, #15375a, #18597b, #1d8f85, #23d3a0)" }} />
          <div className="mt-1 flex justify-between text-slate-500"><span>low</span><span>high</span></div>
        </div>
        <div className="mt-2">
          <p>thickness = betweenness</p>
          <div className="mt-1 flex items-center gap-2"><span className="inline-block h-[2px] w-10 bg-slate-600" /><span>low</span></div>
          <div className="mt-1 flex items-center gap-2"><span className="inline-block h-[6px] w-10 bg-slate-200" /><span>high</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---------- multiselect (dark) ---------- */
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

  const toggle = useCallback((val) => {
    const v = val.trim();
    const exists = selectedValues.includes(v);
    const next = exists ? selectedValues.filter((x) => x !== v) : [...selectedValues, v];
    onChange?.(next);
  }, [onChange, selectedValues]);

  const clearAll = () => onChange?.([]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {label && <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">{label}</span>}
        {showClear && (
          <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs text-slate-300" onClick={clearAll} disabled={!selectedValues.length}>
            clear
          </Button>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between border-slate-700 text-slate-200">
            <span className="truncate text-left">{selectedValues.length ? `${selectedValues.length} selected` : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className={`z-50 ${popoverWidthClass} p-0 bg-slate-950 text-white border border-slate-800 rounded-lg overflow-hidden max-h-[70vh]`}
        >
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              className="h-9 text-xs text-white bg-slate-900 placeholder:text-slate-500"
            />
            <CommandEmpty>{emptyText}</CommandEmpty>

            <ScrollArea className="max-h-[62vh] overflow-y-auto">
              <CommandList>
                <CommandGroup>
                  {filteredOptions.map((opt) => {
                    const active = selectedSet.has(opt);
                    return (
                      <CommandItem
                        key={opt}
                        value={opt}
                        onSelect={() => toggle(opt)}
                        className="flex items-center justify-between gap-2 cursor-pointer"
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
            <Badge key={v} variant="secondary" className="flex items-center gap-1 bg-slate-800 text-slate-100">
              <span className="truncate max-w-[160px]">{v}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-white/10"
                onClick={() => toggle(v)}
                aria-label={`remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== base column defs (labels are caps_with_underscores) ===== */
const BASE_COLUMNS = [
  { key: "RN_ID", label: "RN_ID", type: "number" },
  { key: "name", label: "NAME", type: "string" },
  { key: "PLN_AREA_N", label: "PLANNING_AREA", type: "string" },
  { key: "SUBZONE_N", label: "SUBZONE", type: "string" },
  { key: "road_type", label: "ROAD_TYPE", type: "string" },
  { key: "betweenness_norm", label: "BETWEENNESS_NORM", type: "number" },
  { key: "closeness_norm", label: "CLOSENESS_NORM", type: "number" },
  { key: "_pb", label: "PB_PERCENTILE", type: "number", format: (v) => format_number(v, 1) },
  { key: "_pc", label: "PC_PERCENTILE", type: "number", format: (v) => format_number(v, 1) },
  { key: "_pa", label: "AMENITIES_COMPONENT", type: "number", format: (v) => format_number(v, 2) },
  { key: "_pf", label: "FLOODS_COMPONENT", type: "number", format: (v) => format_number(v, 2) },
  { key: "amenity_count_total", label: "AMENITY_COUNT_TOTAL", type: "number" },
  { key: "flood_count_total", label: "FLOOD_COUNT_TOTAL", type: "number" },
  { key: "importance", label: "IMPORTANCE", type: "number", format: (v) => format_number(v, 2) },
  { key: "sla_priority", label: "SLA_PRIORITY", type: "number", format: (v) => format_number(v, 2) },
  { key: "score", label: "SCORE", type: "number", format: (v) => format_number(v, 2) },
];

/* ===== table (dark) with column chooser, sorting, export, local filter ===== */
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
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, currentPage]);

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    }
  };

  const allColumnLabels = useMemo(
    () => allColumnDefs.map((c) => c.key),
    [allColumnDefs]
  );

  const export_csv = () => {
    const header = visibleColumns.map((c) => c.label || to_caps_underscore(c.key));
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
    a.download = "centrality_table_export.csv";
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
          <span className="text-sm text-slate-300">
            showing {start.toLocaleString()} to {end.toLocaleString()} of {totalRows.toLocaleString()} segments
          </span>
          {totalRows > PAGE_SIZE && (
            <div className="ml-2 flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 border-slate-700 text-slate-200" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>prev</Button>
              <span className="text-xs text-slate-400">page {currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" className="h-8 border-slate-700 text-slate-200" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>next</Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* column chooser */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="border-slate-700 text-slate-200">choose columns</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="z-50 w-[360px] p-0 bg-slate-950 border border-slate-800">
              <div className="p-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">columns</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(allColumnLabels)}>all</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols([])}>none</Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(defaultKeys)}>reset</Button>
                  </div>
                </div>
                <ScrollArea className="max-h-[50vh] pr-2">
                  <div className="space-y-1">
                    {allColumnDefs.map((c) => {
                      const active = selectedCols.includes(c.key);
                      return (
                        <label key={c.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-900">
                          <span className="text-sm text-slate-200 truncate">{c.label || to_caps_underscore(c.key)}</span>
                          <input
                            type="checkbox"
                            className="accent-sky-500"
                            checked={active}
                            onChange={() => {
                              setSelectedCols((prev) => active ? prev.filter((k) => k !== c.key) : [...prev, c.key]);
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </PopoverContent>
          </Popover>

          {/* table search (local-only; does not affect top list) */}
          <input
            value={tableQ}
            onChange={(e) => setTableQ(e.target.value)}
            placeholder="filter table (local)…"
            className="w-56 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />

          {/* export */}
          <Button onClick={export_csv} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            export csv
          </Button>
        </div>
      </div>

      {/* table */}
      <div className="overflow-auto rounded-2xl bg-slate-950 border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-900">
            <tr>
              {visibleColumns.map((col) => {
                const isSort = col.key === sortKey;
                return (
                  <th
                    key={col.key}
                    className="px-4 py-3 text-left font-semibold uppercase tracking-wide text-slate-200 cursor-pointer select-none"
                    onClick={() => toggleSort(col.key)}
                    title="click to sort"
                  >
                    <div className="flex items-center gap-2">
                      <span>{col.label || to_caps_underscore(col.key)}</span>
                      {isSort && <span className="text-xs text-slate-400">{sortDir === "desc" ? "▼" : "▲"}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {pageRows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-slate-500">no segments.</td></tr>
            ) : (
              pageRows.map((f, i) => {
                const p = f?.properties ?? {};
                const key = p.RN_ID ?? p.osmid ?? i;
                return (
                  <tr key={key} className="odd:bg-slate-950 even:bg-slate-900">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-2 align-top text-slate-100">
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
    </div>
  );
}

/* ===== example preview ===== */
function ExampleWeightsPreview({ wImpUsed, wSlaUsed, example, amenityKeys, floodKeys, impMode, slaMode }) {
  const { pb, pc, pa, pf } = example;
  const dot = (w) => (w.pb*pb + w.pc*pc + w.pa*pa + w.pf*pf);
  const imp = dot(wImpUsed);
  const sla = dot(wSlaUsed);
  const fmt = (x) => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toFixed(2) : "—");

  return (
    <div className="rounded-xl border border-slate-800 p-3 text-sm bg-slate-950">
      <div className="font-semibold mb-2 text-slate-100">example (how your weights combine)</div>
      <div className="grid gap-1 text-slate-300">
        <div className="text-xs uppercase tracking-wide text-slate-500 mt-1">component scores</div>
        <div>PB: <b>{fmt(pb)}</b> · PC: <b>{fmt(pc)}</b> · PA: <b>{fmt(pa)}</b> · PF: <b>{fmt(pf)}</b></div>

        <div className="text-xs uppercase tracking-wide text-slate-500 mt-3">importance weights ({impMode ? "normalised" : "raw"})</div>
        <div>PB: <b>{fmt(wImpUsed.pb)}</b> · PC: <b>{fmt(wImpUsed.pc)}</b> · PA: <b>{fmt(wImpUsed.pa)}</b> · PF: <b>{fmt(wImpUsed.pf)}</b></div>

        <div className="text-xs uppercase tracking-wide text-slate-500 mt-2">sla weights ({slaMode ? "normalised" : "raw"})</div>
        <div>PB: <b>{fmt(wSlaUsed.pb)}</b> · PC: <b>{fmt(wSlaUsed.pc)}</b> · PA: <b>{fmt(wSlaUsed.pa)}</b> · PF: <b>{fmt(wSlaUsed.pf)}</b></div>
      </div>
    </div>
  );
}

/* ===== page ===== */
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
    () => Object.keys(amenityCounts).sort((a, b) => a.localeCompare(b)).map((c) => `${to_caps_underscore(c)} (${(amenityCounts[c] || 0).toLocaleString()})`),
    [amenityCounts]
  );
  const floodOptionsDisplay = useMemo(
    () => Object.keys(floodCounts).sort((a, b) => a.localeCompare(b)).map((t) => `${to_caps_underscore(t)} (${(floodCounts[t] || 0).toLocaleString()})`),
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

  /* ===== dynamic keys ===== */
  const amenityCategoryKeys = useMemo(
    () => Object.keys(amenityCounts).sort((a, b) => a.localeCompare(b)),
    [amenityCounts]
  );
  const floodTypeKeys = useMemo(
    () => Object.keys(floodCounts).sort((a, b) => a.localeCompare(b)),
    [floodCounts]
  );

  const visibleAmenityKeys = useMemo(
    () => (amenitySelectedRawSet.size ? Array.from(amenitySelectedRawSet) : amenityCategoryKeys),
    [amenitySelectedRawSet, amenityCategoryKeys]
  );
  const visibleFloodKeys = useMemo(
    () => (floodSelectedRawSet.size ? Array.from(floodSelectedRawSet) : floodTypeKeys),
    [floodSelectedRawSet, floodTypeKeys]
  );

  /* ===== amenity/flood weights + mode toggles ===== */
  const makeEqualFractions = (keys) => {
    const n = Math.max(1, keys.length);
    const v = 1 / n;
    return Object.fromEntries(keys.map((k) => [k, v]));
  };

  const [amenityVals, setAmenityVals] = useState({});
  const [floodVals, setFloodVals] = useState({});
  const [amenityNormalise, setAmenityNormalise] = useState(true);
  const [floodNormalise, setFloodNormalise] = useState(true);

  useEffect(() => {
    setAmenityVals((prev) => {
      if (!visibleAmenityKeys.length) return {};
      if (!amenityNormalise) return Object.fromEntries(visibleAmenityKeys.map((k) => [k, prev[k] ?? 0]));
      let sum = 0; for (const k of visibleAmenityKeys) sum += prev[k] ?? 0;
      if (sum > 1e-9) return Object.fromEntries(visibleAmenityKeys.map((k) => [k, (prev[k] ?? 0) / sum]));
      return makeEqualFractions(visibleAmenityKeys);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleAmenityKeys.join("|"), amenityNormalise]);

  useEffect(() => {
    setFloodVals((prev) => {
      if (!visibleFloodKeys.length) return {};
      if (!floodNormalise) return Object.fromEntries(visibleFloodKeys.map((k) => [k, prev[k] ?? 0]));
      let sum = 0; for (const k of visibleFloodKeys) sum += prev[k] ?? 0;
      if (sum > 1e-9) return Object.fromEntries(visibleFloodKeys.map((k) => [k, (prev[k] ?? 0) / sum]));
      return makeEqualFractions(visibleFloodKeys);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFloodKeys.join("|"), floodNormalise]);

  /* ===== amenity/flood components ===== */
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

  function computeAmenityComponent(rn) {
    const row = amenityCategoryCountByRoad.get(rn);
    if (!row) return 0;
    let weighted = 0;
    for (const cat of Object.keys(amenityVals)) {
      const c = row.get(cat) || 0;
      const w = amenityVals[cat] || 0;
      weighted += c * w;
    }
    return Math.min(100, 20 * Math.log10(1 + weighted));
  }
  function computeFloodComponent(rn) {
    const row = floodTypeCountByRoad.get(rn);
    if (!row) return 0;
    let weighted = 0;
    for (const t of Object.keys(floodVals)) {
      const c = row.get(t) || 0;
      const w = floodVals[t] || 0;
      weighted += c * w;
    }
    return Math.min(100, 25 * Math.log10(1 + weighted));
  }

  /* ===== filters (map/top list) ===== */
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

  /* ===== enrich ===== */
  const enriched = useMemo(() => {
    return filtered.map((f) => {
      if (!f) return null;
      const p = f.properties ?? {};
      const rn = p.RN_ID == null ? null : Number(p.RN_ID);
      const bet = nznum(p.betweenness_norm);
      const clo = nznum(p.closeness_norm);
      const pb = pBet(bet);
      const pc = pClo(clo);
      const pa = rn != null ? computeAmenityComponent(rn) : 0;
      const pf = rn != null ? computeFloodComponent(rn) : 0;

      // totals for extra columns
      const amenRow = amenityCategoryCountByRoad.get(rn) || new Map();
      const floodRow = floodTypeCountByRoad.get(rn) || new Map();
      const amenTot = Array.from(amenRow.values()).reduce((a, v) => a + v, 0);
      const floodTot = Array.from(floodRow.values()).reduce((a, v) => a + v, 0);

      return {
        ...f,
        properties: {
          ...p,
          road_type: get_road_type(p),
          betweenness_norm: bet,
          closeness_norm: clo,
          _pb: pb, _pc: pc, _pa: pa, _pf: pf,
          amenity_count_total: amenTot,
          flood_count_total: floodTot,
        },
      };
    }).filter(Boolean);
  }, [filtered, pBet, pClo, amenityVals, floodVals, amenityCategoryCountByRoad, floodTypeCountByRoad]);

  /* ===== importance & sla weights ===== */
  const [wImpRaw, setWImpRaw] = useState({ pb: 0.4, pc: 0.3, pa: 0.2, pf: 0.1 });
  const [wSlaRaw, setWSlaRaw] = useState({ pb: 0.4, pc: 0.3, pa: 0.2, pf: 0.1 });
  const [impNormalise, setImpNormalise] = useState(true);
  const [slaNormalise, setSlaNormalise] = useState(true);
  const [impScoringNormalised, setImpScoringNormalised] = useState(true);
  const [slaScoringNormalised, setSlaScoringNormalised] = useState(true);

  const normaliseSelected = (obj) => {
    const keys = ["pb","pc","pa","pf"];
    const sum = keys.reduce((a, k) => a + Math.max(0, +obj[k] || 0), 0);
    if (sum <= 1e-12) return Object.fromEntries(keys.map((k) => [k, 0]));
    const out = {};
    for (const k of keys) out[k] = Math.max(0, +obj[k] || 0) / sum;
    return out;
  };

  const wImpUsed = useMemo(() => (impScoringNormalised ? normaliseSelected(wImpRaw) : wImpRaw), [wImpRaw, impScoringNormalised]);
  const wSlaUsed = useMemo(() => (slaScoringNormalised ? normaliseSelected(wSlaRaw) : wSlaRaw), [wSlaRaw, slaScoringNormalised]);

  /* ===== scoring + paging ===== */
  const scored = useMemo(() => {
    const dot = (w, p) => (w.pb*(p._pb||0) + w.pc*(p._pc||0) + w.pa*(p._pa||0) + w.pf*(p._pf||0));
    return enriched.map((e) => {
      const p = e.properties;
      const importance = Math.round(dot(wImpUsed, p) * 100) / 100;
      const sla_priority = Math.round(dot(wSlaUsed, p) * 100) / 100;
      const score = importance;
      return { ...e, properties: { ...p, importance, sla_priority, score } };
    });
  }, [enriched, wImpUsed, wSlaUsed]);

  const [currentPage, setCurrentPage] = useState(1);
  const sortedByScore = useMemo(() => {
    const arr = [...scored];
    arr.sort((a, b) => (b.properties.score || 0) - (a.properties.score || 0));
    return arr;
  }, [scored]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedByScore.length / PAGE_SIZE)), [sortedByScore.length]);
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedByScore.slice(start, start + PAGE_SIZE);
  }, [sortedByScore, currentPage]);

  // table columns available = base + any discovered props (caps labels)
  const allColumnDefs = useMemo(() => {
    const keys = new Set(BASE_COLUMNS.map((c) => c.key));
    // include any extra discovered props for flexibility
    for (const f of scored) {
      const p = f?.properties || {};
      Object.keys(p).forEach((k) => keys.add(k));
    }
    // assemble defs
    const map = Object.fromEntries(BASE_COLUMNS.map((c) => [c.key, c]));
    const defs = Array.from(keys).map((k) => {
      if (map[k]) return map[k];
      return { key: k, label: to_caps_underscore(k), type: (typeof scored?.[0]?.properties?.[k] === "number" ? "number" : "string") };
    });
    // prefer stable ordering (by provided base, then alpha)
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
  ]);

  const example = useMemo(() => {
    const p = sortedByScore[0]?.properties;
    if (!p) return { pb: 50, pc: 50, pa: 20, pf: 10 };
    return { pb: p._pb ?? 0, pc: p._pc ?? 0, pa: p._pa ?? 0, pf: p._pf ?? 0 };
  }, [sortedByScore]);

  /* ===== ui (dark) ===== */
  return (
    <div className="space-y-6 py-4 bg-slate-900 text-slate-100">
      {/* settings (same as before, omitted for brevity changes) */}
      <section className="rounded-2xl bg-slate-950 border border-slate-800 p-3 md:p-4">
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="settings" className="border-b-0">
            <AccordionTrigger className="text-sm uppercase text-slate-100">settings</AccordionTrigger>
            <AccordionContent className="pt-2">
              {/* road filter */}
              <div className="rounded-xl border border-slate-800 p-3 md:p-4 bg-slate-950 mb-4">
                <Accordion type="multiple">
                  <AccordionItem value="road-filter" className="border-b-0">
                    <AccordionTrigger className="text-sm uppercase text-slate-100">road filter</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                        <MultiSelectCombobox
                          label="planning area"
                          options={planningOptions}
                          selected={planningSelected}
                          onChange={setPlanningSelected}
                          placeholder="select planning areas"
                          searchPlaceholder="search planning areas…"
                          emptyText="no planning area found."
                          popoverWidthClass="w-[360px]"
                          showClear
                        />

                        {/* subzone */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-200">subzone</Label>
                            <Button variant="ghost" size="sm" className="h-7 px-2 py-1 text-xs text-slate-300" onClick={() => setSubzonesSelected([])} disabled={!subzonesSelected.length}>clear</Button>
                          </div>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="outline" className="w-full justify-between border-slate-700 text-slate-200">
                                <span className="truncate text-left">
                                  {subzonesSelected.length ? `${subzonesSelected.length} selected` : "select subzones"}
                                </span>
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="z-50 w-[360px] p-0 bg-slate-950 border border-slate-800" align="start">
                              <Command>
                                <CommandInput placeholder="search by subzone or planning area" />
                                <CommandEmpty>no subzone found.</CommandEmpty>
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
                                                <div className="text-xs text-slate-500 truncate">{o.planningArea}</div>
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
                                <Badge key={v} variant="secondary" className="flex items-center gap-1 bg-slate-800 text-slate-100">
                                  <span className="truncate max-w-[160px]">{v}</span>
                                  <button type="button" className="rounded-full p-0.5 hover:bg-white/10" onClick={() => setSubzonesSelected((prev) => prev.filter((x) => x !== v))}>
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        <MultiSelectCombobox
                          label="type of roads"
                          options={roadTypeOptions}
                          selected={roadTypesSelected}
                          onChange={setRoadTypesSelected}
                          placeholder="select road types"
                          searchPlaceholder="search road types…"
                          emptyText="no road type found."
                          popoverWidthClass="w-[360px]"
                          showClear
                        />
                      </div>

                      {/* search */}
                      <div className="mt-6 space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-200">search</span>
                        <input
                          value={q}
                          onChange={(e) => setQ(e.target.value)}
                          placeholder="name / rn id / area…"
                          className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>

              {/* amenities weights */}
              <div className="rounded-xl border border-slate-800 p-3 md:p-4 bg-slate-950 mb-4">
                <Accordion type="single" collapsible>
                  <AccordionItem value="amenities" className="border-b-0">
                    <AccordionTrigger className="text-sm uppercase text-slate-100">amenities</AccordionTrigger>
                    <AccordionContent>
                      <MultiSelectCombobox
                        label="categories"
                        options={amenityOptionsDisplay}
                        selected={amenitySelectedLabels}
                        onChange={setAmenitySelectedLabels}
                        placeholder="select amenity categories"
                        searchPlaceholder="search amenity categories…"
                        emptyText="no category found."
                        popoverWidthClass="w-[420px]"
                        showClear
                      />

                      <div className="mt-4">
                        <WeightsRowEditor
                          keysOrdered={visibleAmenityKeys}
                          values={amenityVals}
                          onChange={setAmenityVals}
                          label="amenity category weights"
                          normaliseMode={amenityNormalise}
                          onToggleNormalise={(v) => setAmenityNormalise(!!v)}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>

              {/* floods weights */}
              <div className="rounded-xl border border-slate-800 p-3 md:p-4 bg-slate-950 mb-4">
                <Accordion type="single" collapsible>
                  <AccordionItem value="floods" className="border-b-0">
                    <AccordionTrigger className="text-sm uppercase text-slate-100">floods</AccordionTrigger>
                    <AccordionContent>
                      <MultiSelectCombobox
                        label="event types"
                        options={floodOptionsDisplay}
                        selected={floodSelectedLabels}
                        onChange={setFloodSelectedLabels}
                        placeholder="select flood types"
                        searchPlaceholder="search flood types…"
                        emptyText="no type found."
                        popoverWidthClass="w-[420px]"
                        showClear
                      />

                      <div className="mt-4">
                        <WeightsRowEditor
                          keysOrdered={visibleFloodKeys}
                          values={floodVals}
                          onChange={setFloodVals}
                          label="flood type weights"
                          normaliseMode={floodNormalise}
                          onToggleNormalise={(v) => setFloodNormalise(!!v)}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>

              {/* importance & sla weights */}
              <div className="rounded-2xl border border-slate-800 p-3 md:p-4 bg-slate-950">
                <Accordion type="single" collapsible>
                  <AccordionItem value="weights" className="border-b-0">
                    <AccordionTrigger className="text-sm uppercase text-slate-100">importance & sla weights</AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                        {/* left: importance */}
                        <div className="xl:col-span-7 space-y-4 rounded-xl border border-slate-800 p-3 md:p-4 bg-slate-950">
                          <div className="text-sm font-semibold text-slate-100">importance (custom blend)</div>
                          <p className="text-xs text-slate-500 -mt-1">slider + type-in. free mode shows suggested fix; normalised mode autoscale.</p>

                          <WeightsRowEditor
                            keysOrdered={["pb","pc","pa","pf"]}
                            values={wImpRaw}
                            onChange={setWImpRaw}
                            label="importance weights"
                            normaliseMode={impNormalise}
                            onToggleNormalise={(v) => setImpNormalise(!!v)}
                            showScoringToggle
                            scoringNormalised={impScoringNormalised}
                            onToggleScoringNormalised={(v) => setImpScoringNormalised(!!v)}
                          />
                        </div>

                        {/* right: sla & example */}
                        <div className="xl:col-span-5 space-y-4">
                          <div className="rounded-xl border border-slate-800 p-3 md:p-4 bg-slate-950">
                            <div className="text-sm font-semibold text-slate-100">sla (custom blend)</div>
                            <p className="text-xs text-slate-500 -mt-1">independent weights; same behaviour.</p>

                            <WeightsRowEditor
                              keysOrdered={["pb","pc","pa","pf"]}
                              values={wSlaRaw}
                              onChange={setWSlaRaw}
                              label="sla weights"
                              normaliseMode={slaNormalise}
                              onToggleNormalise={(v) => setSlaNormalise(!!v)}
                              showScoringToggle
                              scoringNormalised={slaScoringNormalised}
                              onToggleScoringNormalised={(v) => setSlaScoringNormalised(!!v)}
                            />
                          </div>

                          <ExampleWeightsPreview
                            wImpUsed={impScoringNormalised ? normaliseSelected(wImpRaw) : wImpRaw}
                            wSlaUsed={slaScoringNormalised ? normaliseSelected(wSlaRaw) : wSlaRaw}
                            example={example}
                          />

                          <div className="flex justify-end">
                            <Button
                              variant="outline" size="sm" className="border-slate-700 text-slate-200"
                              onClick={() => {
                                setPlanningSelected([]); setSubzonesSelected([]); setRoadTypesSelected([]);
                                setAmenitySelectedLabels([]); setFloodSelectedLabels([]); setQ("");
                                setWImpRaw({ pb: 0.4, pc: 0.3, pa: 0.2, pf: 0.1 });
                                setWSlaRaw({ pb: 0.4, pc: 0.3, pa: 0.2, pf: 0.1 });
                                setAmenityVals({}); setFloodVals({});
                                setAmenityNormalise(true); setFloodNormalise(true);
                                setImpNormalise(true); setSlaNormalise(true);
                                setImpScoringNormalised(true); setSlaScoringNormalised(true);
                              }}
                            >
                              reset all
                            </Button>
                          </div>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      {/* map + top list */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CentralityMap data={mapData} />
        </div>

        {/* top ranked (independent of bottom table filter) */}
        <aside className="h-[60vh] min-h-[26rem] rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 p-4 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">importance (custom) · top 20</h2>
          </div>
          <div className="flex-1 overflow-auto pr-1">
            {sortedByScore.slice(0, 20).map((f, i) => {
              const p = f.properties || {};
              return (
                <div key={p.RN_ID ?? i} className="mb-2 rounded-md border border-slate-800 p-2 bg-slate-950">
                  <div className="flex items-center justify-between text-xs">
                    <div className="font-semibold text-slate-100 truncate">{p.name || "unnamed segment"}</div>
                    <div className="text-slate-400">#{i + 1}</div>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-300">
                    <div><span className="text-slate-500">PLANNING_AREA:</span> {p.PLN_AREA_N || "—"}</div>
                    <div><span className="text-slate-500">RN_ID:</span> {p.RN_ID ?? "—"}</div>
                    <div><span className="text-slate-500">IMPORTANCE:</span> <b className="text-slate-100">{format_number(p.importance, 2) ?? "—"}</b></div>
                    <div><span className="text-slate-500">SLA:</span> <b className="text-slate-100">{format_number(p.sla_priority, 2) ?? "—"}</b></div>
                    <div><span className="text-slate-500">AMENITY_COUNT_TOTAL:</span> {p.amenity_count_total ?? "—"}</div>
                    <div><span className="text-slate-500">FLOOD_COUNT_TOTAL:</span> {p.flood_count_total ?? "—"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* table */}
      <section className="rounded-2xl bg-slate-950 border border-slate-800 p-4">
        <CentralityTable
          rows={sortedByScore}
          totalRows={sortedByScore.length}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          allColumnDefs={BASE_COLUMNS}
        />
      </section>
    </div>
  );
}
