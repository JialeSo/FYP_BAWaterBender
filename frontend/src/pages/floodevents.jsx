// src/components/floodevents.jsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMapData } from "@/context/mapDataContext";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import * as turf from "@turf/turf";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, } from "@/components/ui/collapsible";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronsUpDown, MapPin, Search, X } from "lucide-react";
import { NumberInput } from "@/components/numberInput";
import { FloodEventsLearnDialog } from "./floodEventsLearnDialog";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/light-v11";
const page_size = 20;

/* ===== utils ===== */
const to_num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const fmt = (v, d = 6) => (Number.isFinite(+v) ? (+v).toFixed(d) : "N/A");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
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
const format_option_label = (value, fallback) => {
  if (!value || value === "all") return fallback || "All";
  return to_title_case(value);
};
const date_in_range = (dt, from, to) => { if (!dt) return true; if (from && dt < from) return false; if (to && dt > to) return false; return true; };
const dist_m = (lng1, lat1, lng2, lat2) => turf.distance([lng1, lat1], [lng2, lat2], { units: "kilometers" }) * 1000;

// Metric filters removed - no longer used in UI

const METRIC_SUMMARY_ROWS = [
  {
    metric: "Roads Affected",
    meaning: "Total number of roads within the inner and outer distance rings from each flood location.",
    insight: "Higher values indicate more road infrastructure at risk. Roads in inner ring are weighted more heavily. Contributes to AR Impact via roads score.",
  },
  {
    metric: "Amenities Affected",
    meaning: "Total number of amenities (hospitals, schools, etc.) within the inner and outer distance rings from each flood location.",
    insight: "Higher values indicate more critical facilities at risk. Each amenity category has a different weight (e.g., emergency services weighted highest).",
  },
  {
    metric: "Betweenness Norm",
    meaning: "Normalized betweenness centrality of the affected road (0-1 scale). Measures how often the road lies on shortest paths between other roads.",
    insight: "Higher values indicate roads critical for network connectivity. Roads with high betweenness are key transit routes whose flooding disrupts many journeys.",
  },
  {
    metric: "Closeness Norm",
    meaning: "Normalized closeness centrality of the affected road (0-1 scale). Measures how central the road is to the entire network.",
    insight: "Higher values indicate roads with good access to all other roads. Flooding these roads affects reachability across the entire network.",
  },
  {
    metric: "AR Impact",
    meaning: "Amenity-Road Impact score combining 4 weighted components: betweenness, closeness, amenity exposure, and roads affected.",
    insight: "Final risk score (formula: AR = w_b × betweenness + w_c × closeness + w_a × amenity_score + w_r × roads_score). Use presets or adjust weights to prioritize different factors.",
  },
];



const RANKING_METRICS = [
  { key: "ar_impact", label: "AR Impact", precision: 3 },
  { key: "impact_total", label: "Impact Total", precision: 2 },
  { key: "ring_total", label: "Total Amenities", precision: 0 },
  { key: "centrality", label: "Centrality", precision: 3 },
];

function MultiSelectFilter({ id, label, options = [], values = [], onChange, placeholder = "All" }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const normalized = useMemo(() => {
    return options
      .map((opt) => {
        const value = String(opt ?? "").trim();
        if (!value) return null;
        return { value, label: format_option_label(value, value) };
      })
      .filter(Boolean);
  }, [options]);

  const labelMap = useMemo(() => {
    const map = new Map();
    for (const opt of normalized) map.set(opt.value, opt.label);
    return map;
  }, [normalized]);

  const selectedValues = useMemo(
    () => values.map((v) => String(v ?? "").trim()).filter(Boolean),
    [values]
  );
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );
  }, [normalized, search]);

  const orderedFromSet = (set) =>
    normalized.map((opt) => opt.value).filter((value) => set.has(value));

  const toggle = (raw) => {
    const value = String(raw ?? "").trim();
    if (!value) return;
    const nextSet = new Set(selectedValues);
    if (nextSet.has(value)) nextSet.delete(value);
    else nextSet.add(value);
    onChange?.(orderedFromSet(nextSet));
  };

  const displayLabel = selectedValues.length
    ? (selectedValues.length <= 2
        ? selectedValues.map((v) => labelMap.get(v) ?? v).join(", ")
        : `${selectedValues.length} selected`)
    : placeholder;

  return (
    <div className="space-y-1.5">
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            <span className="truncate text-left">{displayLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="z-50 w-[320px] p-0"
        >
          <Command>
            <CommandInput
              placeholder={`Search ${label?.toLowerCase() ?? "options"}`}
              value={search}
              onValueChange={setSearch}
            />
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandList className="max-h-64 overflow-y-auto">
              <CommandGroup>
                <CommandItem
                  value="__all__"
                  onSelect={() => {
                    onChange?.([]);
                    setSearch("");
                  }}
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    checked={selectedValues.length === 0}
                    readOnly
                    className="h-4 w-4"
                  />
                  <span className="truncate">All (no filter)</span>
                </CommandItem>
                <div className="my-1 h-px bg-border/60" />
                {filtered.map((opt) => {
                  const active = selectedSet.has(opt.value);
                  return (
                    <CommandItem
                      key={opt.value}
                      value={opt.value}
                      onSelect={() => toggle(opt.value)}
                      className="flex items-center gap-2"
                    >
                      <Checkbox checked={active} readOnly className="h-4 w-4" />
                      <span className="truncate">{opt.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedValues.map((value) => {
            const labelText = labelMap.get(value) ?? format_option_label(value, value);
            return (
              <button
                type="button"
                key={value}
                onClick={() => toggle(value)}
                aria-label={`Remove ${labelText}`}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                <span className="truncate">{labelText}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function await_style(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded && map.isStyleLoaded()) return resolve();
    const on_load = () => { map.off("load", on_load); resolve(); };
    map.on("load", on_load);
  });
}

function bounds_from_floods(fc) {
  const b = new mapboxgl.LngLatBounds();
  let had = false;
  for (const f of fc?.features || []) {
    const p = f.properties || {};
    const lng = to_num(p.start_lng);
    const lat = to_num(p.start_lat);
    if (!Number.isNaN(lng) && !Number.isNaN(lat)) { b.extend([lng, lat]); had = true; }
  }
  return had ? b : null;
}

function build_flood_detail(p) {
  const origin = [to_num(p.origin_lng), to_num(p.origin_lat)];
  const start  = [to_num(p.start_lng),  to_num(p.start_lat)];
  const pred_a = [to_num(p.end100_a_lng), to_num(p.end100_a_lat)];
  const pred_b = [to_num(p.end100_b_lng), to_num(p.end100_b_lat)];
  const end    = [to_num(p.end_lng),    to_num(p.end_lat)];
  const has = (xy) => !Number.isNaN(xy?.[0]) && !Number.isNaN(xy?.[1]) && Math.abs(xy[0]) <= 180 && Math.abs(xy[1]) <= 90;

  const points = [];
  if (has(origin)) points.push({ role: "origin", coord: origin });
  if (has(start))  points.push({ role: "start",  coord: start });
  if (has(pred_a)) points.push({ role: "pred_a", coord: pred_a });
  if (has(pred_b)) points.push({ role: "pred_b", coord: pred_b });
  if (has(end))    points.push({ role: "end",    coord: end });

  const seg = (a, b, role) => (has(a) && has(b) ? [{ role, a, b }] : []);
  const lines = [
    ...seg(origin, start, "origin_to_start"),
    ...seg(start, pred_a, "start_to_pred_a"),
    ...seg(start, pred_b, "start_to_pred_b"),
    ...seg(pred_a, end,  "pred_a_to_end"),
    ...seg(pred_b, end,  "pred_b_to_end"),
    ...(!has(end) && has(pred_a) && has(pred_b) ? seg(pred_a, pred_b, "pred_a_to_pred_b") : []),
  ];

  const center = has(start) ? start : (has(origin) ? origin : points[0]?.coord);
  return { points, lines, center };
}

function popup_html(p = {}) {
  const safe = (x) => (x ?? "—");
  const coord = (lat, lng) => {
    const latNum = to_num(lat);
    const lngNum = to_num(lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;
    }
    return "—";
  };
  const typ = to_title_case((p.event || "").replace(/_/g, " ")) || "—";
  const road = p.parent_road || "—";
  return `
    <div>
      <div class="text-xs uppercase opacity-70">Flood</div>
      <div><b>ID:</b> ${safe(p.id)}</div>
      <div><b>Date:</b> ${safe(p.event_date)}</div>
      <div><b>Type:</b> ${typ}</div>
      <div><b>Road:</b> ${road}</div>
      <div class="mt-1 text-xs opacity-70">
        Start: ${coord(p.start_lat, p.start_lng)}
      </div>
      <div class="mt-1 text-xs opacity-70">
        Pred A: ${coord(p.end100_a_lat, p.end100_a_lng)}<br/>
        Pred B: ${coord(p.end100_b_lat, p.end100_b_lng)}<br/>
        End: ${coord(p.end_lat, p.end_lng)}
      </div>
    </div>
  `;
}


/* ===== weights & scoring ===== */
const default_weight_by_category = {
  community_spaces: 1,
  education_institutions: 3.464,
  emergency_services: 5,
  essential_services: 2,
  government_services: 3.162,
  healthcare_facilities: 4,
  others: 1,
  residential: 3.162,
  retail_services: 1,
  tourism: 1,
  transport_services: 3.742,
};

const AMENITY_WEIGHT_PRESETS = {
  default: {
    name: "Default Balanced",
    description: "Weighted priorities for critical services",
    weights: {
      Community_spaces: 2.0,
      Education_institutions: 2.5,
      Emergency_services: 3.5,
      Essential_services: 3.0,
      Government_services: 2.5,
      Healthcare_facilities: 4.0,
      Residential: 1.5,
      Retail_services: 1.5,
      Tourism: 1.0,
      Transport_services: 2.5,
    },
  },
  balanced: {
    name: "Equal Weights",
    description: "All categories weighted equally",
    weights: {
      Community_spaces: 1.0,
      Education_institutions: 1.0,
      Emergency_services: 1.0,
      Essential_services: 1.0,
      Government_services: 1.0,
      Healthcare_facilities: 1.0,
      Residential: 1.0,
      Retail_services: 1.0,
      Tourism: 1.0,
      Transport_services: 1.0,
    },
  },
  emergency: {
    name: "Emergency Focus",
    description: "Prioritize emergency and healthcare",
    weights: {
      Community_spaces: 1.0,
      Education_institutions: 1.5,
      Emergency_services: 5.0,
      Essential_services: 3.5,
      Government_services: 2.0,
      Healthcare_facilities: 5.0,
      Residential: 1.0,
      Retail_services: 1.0,
      Tourism: 0.5,
      Transport_services: 3.0,
    },
  },
};

const AR_IMPACT_PRESETS = {
  centrality_focused: {
    name: "Centrality Focused",
    description: "Prioritizes road network importance",
    weights: { betweenness: 0.35, closeness: 0.35, amenity: 0.15, roads: 0.15 },
  },
  balanced: {
    name: "Balanced",
    description: "Equal weighting across all factors",
    weights: { betweenness: 0.25, closeness: 0.25, amenity: 0.25, roads: 0.25 },
  },
  amenity_focused: {
    name: "Amenity Focused",
    description: "Emphasizes facility exposure",
    weights: { betweenness: 0.15, closeness: 0.15, amenity: 0.5, roads: 0.2 },
  },
  roads_focused: {
    name: "Roads Focused",
    description: "Prioritizes affected road count",
    weights: { betweenness: 0.15, closeness: 0.15, amenity: 0.2, roads: 0.5 },
  },
};

function normalize01(val, min, max) {
  if (!Number.isFinite(val) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return (val - min) / (max - min);
}

/* ===== roads distance helper (dynamic pad; supports multilinestring) ===== */
function meters_to_deg(lat, meters) {
  const deg_lat = meters / 111320;
  const deg_lng = meters / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  return { deg_lat, deg_lng };
}


function clear_selected_rings() {
  const map = map_ref.current;
  try {
    map.setLayoutProperty("rings-selected-inner-fill", "visibility", "none");
    map.setLayoutProperty("rings-selected-outer-fill", "visibility", "none");
    map.setLayoutProperty("rings-selected-inner-line", "visibility", "none");
    map.setLayoutProperty("rings-selected-outer-line", "visibility", "none");
    map.getSource("rings-selected-inner")?.setData({ type:"FeatureCollection", features: [] });
    map.getSource("rings-selected-outer")?.setData({ type:"FeatureCollection", features: [] });
  } catch {}
}


function roads_within_rings(road_fc, center, r_in, r_out) {
  if (!road_fc?.features?.length || !center) return { inner: [], outer: [] };

  const [lng0, lat0] = center;
  const { deg_lat, deg_lng } = meters_to_deg(lat0, Math.max(r_out, 50));
  const minx = lng0 - deg_lng, maxx = lng0 + deg_lng;
  const miny = lat0 - deg_lat, maxy = lat0 + deg_lat;

  const pt = turf.point(center);
  const inner = [], outer = [];

  for (const rf of road_fc.features) {
    if (!rf?.geometry) continue;

    const bb = turf.bbox(rf);
    if (bb[0] > maxx || bb[2] < minx || bb[1] > maxy || bb[3] < miny) continue;

    let d;
    try {
      d = turf.pointToLineDistance(pt, rf, { units: "meters" });
    } catch {
      const ls = [];
      if (rf.geometry.type === "MultiLineString") {
        for (const coords of rf.geometry.coordinates || []) {
          ls.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} });
        }
      } else if (rf.geometry.type === "LineString") {
        ls.push(rf);
      }
      d = Math.min(
        ...ls.map(f => turf.pointToLineDistance(pt, f, { units: "meters" })).filter(Number.isFinite)
      );
    }

    if (!Number.isFinite(d) || d > r_out) continue;

    const band = d <= r_in ? "inner" : "outer";
    const rp = rf.properties || {};
    const name = rp.name || rp.road_name || rp.ROAD_NAME || "(unnamed)";
    const rn_id = rp.rn_id ?? rp.RN_ID ?? null;

    const item = {
      band, d: Math.round(d), name, rn_id,
      geometry: rf.geometry,
      props: { ...rp },
    };
    (band === "inner" ? inner : outer).push(item);
  }

  inner.sort((a, b) => a.d - b.d);
  outer.sort((a, b) => a.d - b.d);
  return { inner, outer };
}

/* ===== main component ===== */
export default function floodevents() {
  const {
    floods_fc_enriched: floods_fc,
    amenity_fc_raw: amenity_fc,
    road_fc_enriched: road_fc,
    category_lookup,
    lookups,
  } = useMapData();

  const [isCalculating, setIsCalculating] = useState(false);

  const map_ref = useRef(null);
  const container_ref = useRef(null);
  const popup_ref = useRef(null);

  const [r_inner, set_r_inner] = useState(200);
  const [r_outer, set_r_outer] = useState(500);
  const [q, set_q] = useState("");
  const [event_types_filter, set_event_types_filter] = useState([]);
  const [from_str, set_from_str] = useState("");
  const [to_str, set_to_str] = useState("");
  const [pa_filter, set_pa_filter] = useState([]);
  const [metric_filters, set_metric_filters] = useState(createMetricFilterState);
  const from_date = useMemo(() => (from_str ? new Date(from_str) : null), [from_str]);
  const to_date = useMemo(() => (to_str ? new Date(to_str) : null), [to_str]);
  const [selected, set_selected] = useState(null);
  const [selected_props, set_selected_props] = useState(null);
  const [panel_open, set_panel_open] = useState(true);
  const [panel_tab, set_panel_tab] = useState("amenities"); // "amenities" | "roads"
  const [ring_filter, set_ring_filter] = useState("all");
  const [show_page_rings, set_show_page_rings] = useState(false);
  const [sort_key, set_sort_key] = useState("dt_desc");
  const [page, set_page] = useState(1);
  const [amenity_search_term, set_amenity_search_term] = useState("");
  const [road_search_term, set_road_search_term] = useState("");
  const [focused_amenity, set_focused_amenity] = useState(null);
  const [focused_road, set_focused_road] = useState(null);
  const [visible_cols, set_visible_cols] = useState({
    id: true, event_date: true, event: true, planning_area: true, location: true, parent_road: true,
    roads_total: true, ring_total: true, betweenness_norm: true, closeness_norm: true, ar_impact: true,
    // Optional/advanced columns (hidden by default)
    roads_inner: false, roads_outer: false,
    ring_inner: false, ring_outer: false,
    impact_inner: false, impact_outer: false, impact_total: false,
    start_postal_code: false, start_lat: false, start_lng: false,
  });

  const [cat_weights, setCatWeights] = useState(() => {
    // Start with default preset instead of default_weight_by_category
    const defaultPreset = AMENITY_WEIGHT_PRESETS.default;
    return { ...defaultPreset.weights };
  });

   /* amenities flat list */
  const amenity_list = useMemo(() => {
    const feats = amenity_fc?.features || [];
    const arr = [];
    for (const f of feats) {
      const p = f?.properties || {};
      const c = f?.geometry?.coordinates || [];
      const lng = +c[0], lat = +c[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const catname =
        p.amenity_category_name ||
        category_lookup?.by_id?.[p.amenity_category_id || 0]?.amenity_category ||
        "others";
      arr.push({
        id: p.amenity_id ?? f.id ?? `${Math.random()}`,
        lng, lat,
        name: p.amenity_name ?? p.name ?? p.poi_name ?? p.display_name ?? p.place_name ?? "(unnamed)",
        category: catname,
      });
    }
    return arr;
  }, [amenity_fc, category_lookup]);
  const categories = useMemo(() => {
    const items = Object.values(category_lookup?.by_id || {});
    return items.sort((a, b) => (a.id || 0) - (b.id || 0));
  }, [category_lookup]);


  const [cat_enabled, setCatEnabled] = useState(() => {
    const out = {};
    for (const c of Object.values(category_lookup?.by_id || {})) {
      const name = String(c.amenity_category || "").trim();
      out[name] = true;
    }
    // Also enable default categories
    Object.keys(default_weight_by_category).forEach((name) => {
      if (!(name in out)) out[name] = true;
    });
    return out;
  });

  const [inner_mult, set_inner_mult] = useState(2);
  const [outer_mult, set_outer_mult] = useState(1);
  const [inner_enabled, set_inner_enabled] = useState(true);
  const [outer_enabled, set_outer_enabled] = useState(true);

  // Start with balanced preset for AR Impact
  const balancedPreset = AR_IMPACT_PRESETS.balanced;
  const [w_betweenness, set_w_betweenness] = useState(balancedPreset.weights.betweenness);
  const [w_closeness, set_w_closeness] = useState(balancedPreset.weights.closeness);
  const [w_amenity, set_w_amenity] = useState(balancedPreset.weights.amenity);
  const [w_roads, set_w_roads] = useState(balancedPreset.weights.roads);

  // Pending states for configuration (not applied until user clicks Apply Changes)
  // Initialize with the same presets
  const defaultPresetWeights = AMENITY_WEIGHT_PRESETS.default.weights;
  const [pendingCatWeights, setPendingCatWeights] = useState(() => ({ ...defaultPresetWeights }));
  const [pendingCatEnabled, setPendingCatEnabled] = useState(() => {
    const out = {};
    for (const c of Object.values(category_lookup?.by_id || {})) {
      const name = String(c.amenity_category || "").trim();
      out[name] = true;
    }
    // Also enable default categories
    Object.keys(default_weight_by_category).forEach((name) => {
      if (!(name in out)) out[name] = true;
    });
    return out;
  });
  const [pendingInnerMult, setPendingInnerMult] = useState(2);
  const [pendingOuterMult, setPendingOuterMult] = useState(1);
  const [pendingInnerEnabled, setPendingInnerEnabled] = useState(true);
  const [pendingOuterEnabled, setPendingOuterEnabled] = useState(true);
  const [pendingWBetweenness, setPendingWBetweenness] = useState(balancedPreset.weights.betweenness);
  const [pendingWCloseness, setPendingWCloseness] = useState(balancedPreset.weights.closeness);
  const [pendingWAmenity, setPendingWAmenity] = useState(balancedPreset.weights.amenity);
  const [pendingWRoads, setPendingWRoads] = useState(balancedPreset.weights.roads);

  // Check if there are unapplied configuration changes
  const hasUnappliedConfigChanges = useMemo(() => {
    // Check category weights
    const catWeightChanges = Object.keys({ ...cat_weights, ...pendingCatWeights }).some(
      key => Math.abs((cat_weights[key] || 0) - (pendingCatWeights[key] || 0)) > 0.001
    );

    // Check category enabled
    const catEnabledChanges = Object.keys({ ...cat_enabled, ...pendingCatEnabled }).some(
      key => (cat_enabled[key] ?? true) !== (pendingCatEnabled[key] ?? true)
    );

    // Check band weights
    const bandChanges =
      Math.abs(inner_mult - pendingInnerMult) > 0.001 ||
      Math.abs(outer_mult - pendingOuterMult) > 0.001 ||
      inner_enabled !== pendingInnerEnabled ||
      outer_enabled !== pendingOuterEnabled;

    // Check AR Impact weights
    const arWeightChanges =
      Math.abs(w_betweenness - pendingWBetweenness) > 0.001 ||
      Math.abs(w_closeness - pendingWCloseness) > 0.001 ||
      Math.abs(w_amenity - pendingWAmenity) > 0.001 ||
      Math.abs(w_roads - pendingWRoads) > 0.001;

    return catWeightChanges || catEnabledChanges || bandChanges || arWeightChanges;
  }, [
    cat_weights, pendingCatWeights,
    cat_enabled, pendingCatEnabled,
    inner_mult, pendingInnerMult,
    outer_mult, pendingOuterMult,
    inner_enabled, pendingInnerEnabled,
    outer_enabled, pendingOuterEnabled,
    w_betweenness, pendingWBetweenness,
    w_closeness, pendingWCloseness,
    w_amenity, pendingWAmenity,
    w_roads, pendingWRoads,
  ]);

  // Apply pending configuration changes
  const applyConfigChanges = useCallback(() => {
    setCatWeights({ ...pendingCatWeights });
    setCatEnabled({ ...pendingCatEnabled });
    set_inner_mult(pendingInnerMult);
    set_outer_mult(pendingOuterMult);
    set_inner_enabled(pendingInnerEnabled);
    set_outer_enabled(pendingOuterEnabled);
    set_w_betweenness(pendingWBetweenness);
    set_w_closeness(pendingWCloseness);
    set_w_amenity(pendingWAmenity);
    set_w_roads(pendingWRoads);
  }, [
    pendingCatWeights, pendingCatEnabled,
    pendingInnerMult, pendingOuterMult,
    pendingInnerEnabled, pendingOuterEnabled,
    pendingWBetweenness, pendingWCloseness,
    pendingWAmenity, pendingWRoads,
  ]);

  // Reset pending configuration changes to current active values
  const resetConfigChanges = useCallback(() => {
    setPendingCatWeights({ ...cat_weights });
    setPendingCatEnabled({ ...cat_enabled });
    setPendingInnerMult(inner_mult);
    setPendingOuterMult(outer_mult);
    setPendingInnerEnabled(inner_enabled);
    setPendingOuterEnabled(outer_enabled);
    setPendingWBetweenness(w_betweenness);
    setPendingWCloseness(w_closeness);
    setPendingWAmenity(w_amenity);
    setPendingWRoads(w_roads);
  }, [
    cat_weights, cat_enabled,
    inner_mult, outer_mult,
    inner_enabled, outer_enabled,
    w_betweenness, w_closeness,
    w_amenity, w_roads,
  ]);

  const applyAmenityPreset = useCallback((presetKey) => {
    const preset = AMENITY_WEIGHT_PRESETS[presetKey];
    if (!preset || !preset.weights) return;

    // Apply weights using forEach to trigger re-renders properly
    setPendingCatWeights((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(key => {
        updated[key] = preset.weights[key];
      });
      return updated;
    });

    // Enable all categories
    setPendingCatEnabled((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach(key => {
        updated[key] = true;
      });
      return updated;
    });
  }, []);

  const applyARImpactPreset = useCallback((presetKey) => {
    const preset = AR_IMPACT_PRESETS[presetKey];
    if (!preset || !preset.weights) return;

    setPendingWBetweenness(preset.weights.betweenness);
    setPendingWCloseness(preset.weights.closeness);
    setPendingWAmenity(preset.weights.amenity);
    setPendingWRoads(preset.weights.roads);
  }, []);

  // Check if an amenity weight preset is currently active
  const isAmenityWeightPresetActive = useCallback((presetKey) => {
    const preset = AMENITY_WEIGHT_PRESETS[presetKey];
    if (!preset || !preset.weights) return false;

    // Check if all weights match the preset
    return Object.keys(preset.weights).every(key =>
      Math.abs((pendingCatWeights[key] || 0) - preset.weights[key]) < 0.01
    );
  }, [pendingCatWeights]);

  // Check if an AR Impact preset is currently active
  const isARImpactPresetActive = useCallback((presetKey) => {
    const preset = AR_IMPACT_PRESETS[presetKey];
    if (!preset || !preset.weights) return false;

    return (
      Math.abs(pendingWBetweenness - preset.weights.betweenness) < 0.01 &&
      Math.abs(pendingWCloseness - preset.weights.closeness) < 0.01 &&
      Math.abs(pendingWAmenity - preset.weights.amenity) < 0.01 &&
      Math.abs(pendingWRoads - preset.weights.roads) < 0.01
    );
  }, [pendingWBetweenness, pendingWCloseness, pendingWAmenity, pendingWRoads]);

  /* roads index by rn_id for centrality */
  const roads_by_id = useMemo(() => {
    const idx = new Map();
    for (const f of road_fc?.features || []) {
      const rn = f?.properties?.rn_id ?? f?.properties?.RN_ID ?? null;
      if (rn == null) continue;
      const key = String(rn);
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(f);
    }
    return idx;
  }, [road_fc]);

  const centrality_scale = useMemo(() => {
    let bmins = +Infinity, bmaxs = -Infinity, cmins = +Infinity, cmaxs = -Infinity;
    for (const f of road_fc?.features || []) {
      const p = f.properties || {};
      const b = +((p.betweenness_norm ?? p.betweenness ?? p.BETWEENNESS_NORM ?? p.BETWEENNESS) || NaN);
      const c = +((p.closeness_norm   ?? p.closeness   ?? p.CLOSENESS_NORM   ?? p.CLOSENESS)   || NaN);
      if (Number.isFinite(b)) { bmins = Math.min(bmins,b); bmaxs = Math.max(bmaxs,b); }
      if (Number.isFinite(c)) { cmins = Math.min(cmins,c); cmaxs = Math.max(cmaxs,c); }
    }
    if (!Number.isFinite(bmins)) { bmins=0; bmaxs=1; }
    if (!Number.isFinite(cmins)) { cmins=0; cmaxs=1; }
    return { bmins, bmaxs, cmins, cmaxs };
  }, [road_fc]);

  const query_amenities = (lng, lat, max_m) => {
    const pad_deg = 0.009;
    const out = [];
    for (const a of amenity_list) {
      if (a.lng < lng - pad_deg || a.lng > lng + pad_deg || a.lat < lat - pad_deg || a.lat > lat + pad_deg) continue;
      const d = dist_m(lng, lat, a.lng, a.lat);
      if (d <= max_m) out.push({ ...a, _distm: d });
    }
    out.sort((x, y) => x._distm - y._distm);
    return out;
  };

  const stats_by_flood_distance = useMemo(() => {
    const out = new Map();
    const floods = floods_fc?.features || [];
    if (!floods.length) return out;

    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);

    for (const f of floods) {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const lng = to_num(p.start_lng), lat = to_num(p.start_lat);
      if (Number.isNaN(lng) || Number.isNaN(lat)) continue;

      let inner = 0, outer = 0;
      let impact_inner = 0, impact_outer = 0;
      const near = amenity_list.length ? query_amenities(lng, lat, r_out) : [];

      for (const a of near) {
        const d = a._distm;
        const band = d <= r_in ? "inner" : "outer";
        const enabled = cat_enabled[a.category] ?? true;
        const w = enabled ? (+cat_weights[a.category] || 0.0) : 0.0;
        if (band === "inner") { inner++; impact_inner += w * inner_mult; }
        else { outer++; impact_outer += w * outer_mult; }
      }

      // Only include counts from enabled bands
      const activeInner = inner_enabled ? inner : 0;
      const activeOuter = outer_enabled ? outer : 0;
      const counts = { inner: activeInner, outer: activeOuter, total: activeInner + activeOuter };
      const impact_total = impact_inner + impact_outer;

      // Calculate roads affected within distance rings
      const roads_near = roads_within_rings(road_fc, [lng, lat], r_in, r_out);
      const activeInnerRoads = inner_enabled ? roads_near.inner.length : 0;
      const activeOuterRoads = outer_enabled ? roads_near.outer.length : 0;
      const roads_counts = {
        inner: activeInnerRoads,
        outer: activeOuterRoads,
        total: activeInnerRoads + activeOuterRoads
      };

      let bnorm = 0, cnorm = 0;
      if (p.start_rn_id != null) {
        const rlist = roads_by_id.get(String(p.start_rn_id)) || [];
        let bmax = -Infinity, cmax = -Infinity;
        for (const r of rlist) {
          const rp = r.properties || {};
          const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
          const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
          if (Number.isFinite(b)) bmax = Math.max(bmax, b);
          if (Number.isFinite(c)) cmax = Math.max(cmax, c);
        }
        if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
        if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);
      }

      const amenity_score = 1 - Math.exp(-(impact_total) / 10.0);

      // Calculate roads score with band weighting
      const inner_weight_mult = inner_enabled ? inner_mult : 0;
      const outer_weight_mult = outer_enabled ? outer_mult : 0;
      const roads_impact = (roads_counts.inner * inner_weight_mult) + (roads_counts.outer * outer_weight_mult);
      const roads_score = 1 - Math.exp(-(roads_impact) / 10.0);

      const ar_impact = (w_betweenness * bnorm) + (w_closeness * cnorm) + (w_amenity * amenity_score) + (w_roads * roads_score);

      out.set(id, {
        center: [lng, lat],
        counts,
        roads_counts,
        impact: { inner: impact_inner, outer: impact_outer, total: impact_total },
        centrality: { bnorm, cnorm },
        scores: { amenity_score, roads_score, roads_impact, ar_impact },
      });
    }
    return out;
  }, [floods_fc, amenity_list, road_fc, r_inner, r_outer, cat_weights, cat_enabled, inner_mult, outer_mult, inner_enabled, outer_enabled, roads_by_id, centrality_scale, w_betweenness, w_closeness, w_amenity, w_roads]);

  /* rows & filters */
  const rows = useMemo(() => {
    const fc = floods_fc || { type: "featurecollection", features: [] };
    const planning_by_id = lookups?.planning?.by_id || {};
    const pickName = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const str = String(candidate).trim();
        if (str) return str;
      }
      return "";
    };

    const arr = (fc.features || []).map((f) => {
      const p = f.properties || {};
      const id = String(p.id ?? f.id ?? "");
      const stats = stats_by_flood_distance.get(id);
      const event_date = p.event_date || "";
      const event = p.event || "";
      const location = p.location || "";
      const parent_road = p.parent_road || "";
      const planning_area = pickName(
        p.start_planning_area,
        planning_by_id[p.start_pa_id]?.name,
        planning_by_id[p.origin_pa_id]?.name,
        planning_by_id[p.end_pa_id]?.name
      );
      const start_postal_code = p.start_postal_code || "";
      const start_lat = to_num(p.start_lat);
      const start_lng = to_num(p.start_lng);
      const dt = p.event_date_iso ? new Date(p.event_date_iso) : (p.event_date ? new Date(p.event_date) : null);
      return {
        id, event_date, event, dt, location, parent_road, planning_area,
        start_postal_code, start_lat, start_lng,
        // Amenities affected
        ring_inner: stats?.counts.inner ?? 0,
        ring_outer: stats?.counts.outer ?? 0,
        ring_total: stats?.counts.total ?? 0,
        // Roads affected
        roads_inner: stats?.roads_counts?.inner ?? 0,
        roads_outer: stats?.roads_counts?.outer ?? 0,
        roads_total: stats?.roads_counts?.total ?? 0,
        // Weighted impacts (for advanced users)
        impact_inner: +(stats?.impact.inner ?? 0).toFixed(2),
        impact_outer:  +(stats?.impact.outer ?? 0).toFixed(2),
        impact_total:  +(stats?.impact.total ?? 0).toFixed(2),
        // Centrality components
        betweenness_norm: +(stats?.centrality.bnorm ?? 0).toFixed(3),
        closeness_norm: +(stats?.centrality.cnorm ?? 0).toFixed(3),
        centrality: +((w_betweenness * (stats?.centrality.bnorm ?? 0)) + (w_closeness * (stats?.centrality.cnorm ?? 0))).toFixed(3),
        // Final AR Impact score
        ar_impact: +(stats?.scores.ar_impact ?? 0).toFixed(3),
        _props: p,
      };
    });

    const planning_areas = Array.from(new Set(arr.map(r => r.planning_area).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));

    Object.defineProperty(arr, "_options", {
      value: {
        event_types: ["all", ...Array.from(new Set(arr.map(r => r.event).filter(Boolean))).sort()],
        planning_areas,
      },
      enumerable: false,
    });

    return arr;
  }, [floods_fc, stats_by_flood_distance, lookups]);

  // Calculate bounds for metric sliders
  const metric_bounds = useMemo(() => {
    if (!rows.length) {
      return {
        inner: { min: 0, max: 100 },
        total: { min: 0, max: 100 },
        centrality: { min: 0, max: 1 },
        impactInner: { min: 0, max: 100 },
        impactOuter: { min: 0, max: 100 },
        impactTotal: { min: 0, max: 100 },
      };
    }

    const bounds = {};
    const metrics = {
      inner: 'ring_inner',
      total: 'ring_total',
      centrality: 'centrality',
      impactInner: 'impact_inner',
      impactOuter: 'impact_outer',
      impactTotal: 'impact_total',
    };

    Object.entries(metrics).forEach(([key, field]) => {
      const values = rows.map(r => r[field]).filter(v => Number.isFinite(v));
      bounds[key] = {
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 100,
      };
    });

    return bounds;
  }, [rows]);

  // Show loading indicator when weights change
  useEffect(() => {
    setIsCalculating(true);
    const timer = setTimeout(() => setIsCalculating(false), 300);
    return () => clearTimeout(timer);
  }, [cat_weights, inner_mult, outer_mult, inner_enabled, outer_enabled, w_betweenness, w_closeness, w_amenity, w_roads]);



  const [selected_stats, set_selected_stats] = useState(null); // includes amenities & index scores
  const [roads_nearby_state, set_roads_nearby_state] = useState({ inner: [], outer: [] }); // for panel roads

  /* precompute fast amenity counts per flood for table */
 
  function paint_selected_rings(center, r_in, r_out) {
  const map = map_ref.current;
  if (!map || !center) return;
  const inner = turf.circle(center, r_in,  { steps: 128, units: "meters" });
  const outer = turf.circle(center, r_out, { steps: 128, units: "meters" });
  try {
    map.getSource("rings-selected-inner")?.setData(inner);
    map.getSource("rings-selected-outer")?.setData(outer);
    map.setLayoutProperty("rings-selected-inner-fill", "visibility", "visible");
    map.setLayoutProperty("rings-selected-outer-fill", "visibility", "visible");
    map.setLayoutProperty("rings-selected-inner-line", "visibility", "visible");
    map.setLayoutProperty("rings-selected-outer-line", "visibility", "visible");
  } catch {}
}

 
  const event_type_options = rows._options?.event_types || ["all"];
  const pa_options = rows._options?.planning_areas || [];

  useEffect(() => {
    if (!pa_filter.length) return;
    const allowed = new Set(pa_options);
    if (pa_filter.every((value) => allowed.has(value))) return;
    set_pa_filter(pa_filter.filter((value) => allowed.has(value)));
  }, [pa_options, pa_filter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pa_selected = new Set(pa_filter);
    const has_pa_filter = pa_selected.size > 0;
    const event_types_selected = new Set(event_types_filter);
    const has_event_types_filter = event_types_selected.size > 0;
    const parseBound = (raw) => {
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    };
    const passesRange = (value, range) => {
      if (!range) return true;
      const min = parseBound(range.min);
      const max = parseBound(range.max);
      if (min != null && value < min) return false;
      if (max != null && value > max) return false;
      return true;
    };

    return rows.filter((r) => {
      if (has_event_types_filter && !event_types_selected.has(r.event)) return false;
      if (!date_in_range(r.dt, from_date, to_date)) return false;
      if (has_pa_filter && !pa_selected.has(r.planning_area)) return false;
      if (!passesRange(r.ring_inner, metric_filters.inner)) return false;
      if (!passesRange(r.ring_total, metric_filters.total)) return false;
      if (!passesRange(r.centrality, metric_filters.centrality)) return false;
      if (!passesRange(r.impact_inner, metric_filters.impactInner)) return false;
      if (!passesRange(r.impact_outer, metric_filters.impactOuter)) return false;
      if (!passesRange(r.impact_total, metric_filters.impactTotal)) return false;
      if (!needle) return true;
      const haystacks = [
        r.id,
        r.location || "",
        r.parent_road || "",
        r.planning_area || "",
      ];
      return haystacks.some((txt) => String(txt).toLowerCase().includes(needle));
    });
  }, [rows, q, event_types_filter, from_date, to_date, pa_filter, metric_filters]);

  const has_active_metric_filters = useMemo(() => {
    return Object.values(metric_filters).some((range) => {
      const minActive = typeof range?.min === "string" && range.min.trim() !== "";
      const maxActive = typeof range?.max === "string" && range.max.trim() !== "";
      return minActive || maxActive;
    });
  }, [metric_filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const by = (k, dir = "asc") => {
      const sgn = dir === "asc" ? 1 : -1;
      arr.sort((a, b) => {
        let va = a[k], vb = b[k];
        if (k === "dt") { va = a.dt ? a.dt.getTime() : 0; vb = b.dt ? b.dt.getTime() : 0; }
        if (typeof va === "string") return sgn * (va || "").localeCompare(vb || "");
        return sgn * ((va ?? 0) - (vb ?? 0));
      });
    };
    if (sort_key === "dt_desc") by("dt", "desc");
    else if (sort_key.endsWith("_asc"))  by(sort_key.slice(0, -4), "asc");
    else if (sort_key.endsWith("_desc")) by(sort_key.slice(0, -5), "desc");
    return arr;
  }, [filtered, sort_key]);

  const total_pages = Math.max(1, Math.ceil(sorted.length / page_size));
  const page_safe = clamp(page, 1, total_pages);
  const paged = useMemo(() => {
    const start = (page_safe - 1) * page_size;
    return sorted.slice(start, start + page_size);
  }, [sorted, page_safe]);

  const bounds = useMemo(() => bounds_from_floods(floods_fc), [floods_fc]);

  /* ===== map init ===== */
  useEffect(() => {
    if (!container_ref.current || !floods_fc) return;

    const map = new mapboxgl.Map({
      container: container_ref.current,
      style: mapbox_style,
      center: [103.82, 1.35],
      zoom: 11,
      attributionControl: false,
      cooperativeGestures: true,
    });
    map_ref.current = map;

    (async () => {
      await await_style(map);

      map.addSource("floods", {
        type: "geojson",
        data: floods_fc,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40,
        promoteId: "id",
      });

      map.addLayer({
        id: "flood-clusters",
        type: "circle",
        source: "floods",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": ["step", ["get", "point_count"], "#93c5fd", 10, "#60a5fa", 30, "#3b82f6"],
          "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 30, 26],
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1.2,
          "circle-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "flood-cluster-count",
        type: "symbol",
        source: "floods",
        filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-allow-overlap": true },
        paint: { "text-color": "#0b122a", "text-halo-color": "#ffffff", "text-halo-width": 1.0 },
      });

      map.addLayer({
        id: "flood-points",
        type: "circle",
        source: "floods",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 5,
          "circle-color": "#60a5fa",
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 1.25,
          "circle-opacity": 0.95,
        },
        layout: { visibility: "visible" },
      });

      map.addSource("flood-selected-points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-lines",  { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("flood-selected-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "flood-selected-lines-casing",
        type: "line",
        source: "flood-selected-lines",
        paint: { "line-color": "#0b1220", "line-opacity": 0.25, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 6, 13, 8, 15, 10] },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-lines",
        type: "line",
        source: "flood-selected-lines",
        paint: {
          "line-color": [
            "match", ["get", "role"],
            "origin_to_start", "#22c55e",
            "start_to_pred_a", "#f59e0b",
            "start_to_pred_b", "#f59e0b",
            "pred_a_to_end",  "#ef4444",
            "pred_b_to_end",  "#ef4444",
            "pred_a_to_pred_b", "#94a3b8",
            "#f97316",
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 13, 3.5, 15, 4.5],
          "line-opacity": 0.98,
          "line-dasharray": [2, 2],
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-points",
        type: "circle",
        source: "flood-selected-points",
        paint: {
          "circle-radius": 7,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0b1220",
          "circle-color": [
            "match", ["get", "role"],
            "origin", "#22c55e",
            "start",  "#3b82f6",
            "pred_a", "#f59e0b",
            "pred_b", "#f59e0b",
            "end",    "#ef4444",
            "#737373",
          ],
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "flood-selected-labels",
        type: "symbol",
        source: "flood-selected-labels",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-allow-overlap": true, "visibility": "none" },
        paint: { "text-color": "#111827", "text-halo-color": "#ffffff", "text-halo-width": 1.0 },
      });

      /* start road only (original) */
      map.addSource("affected-road", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "affected-road",
        type: "line",
        source: "affected-road",
        paint: { "line-color": "#38bdf8", "line-opacity": 0.45, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 13, 2.0, 15, 3.0] },
        layout: { visibility: "none" },
      });

      /* all roads within rings (inner/outer bands) */
      map.addSource("roads-nearby-inner", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("roads-nearby-outer", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({
        id: "roads-nearby-outer",
        type: "line",
        source: "roads-nearby-outer",
        paint: {
          "line-color": "#0ea5e9",
          "line-opacity": 0.75,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.6, 13, 2.6, 15, 3.6]
        },
        layout: { visibility: "none" }
      });
      map.addLayer({
        id: "roads-nearby-inner",
        type: "line",
        source: "roads-nearby-inner",
        paint: {
          "line-color": "#22c55e",
          "line-opacity": 0.9,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 13, 2.8, 15, 3.8]
        },
        layout: { visibility: "none" }
      });

      /* rings (per page or per selection) */
      map.addSource("rings-selected-inner", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("rings-selected-outer", { type: "geojson", data: { type: "FeatureCollection", features: [] } });

      map.addLayer({ id: "rings-selected-outer-fill", type: "fill", source: "rings-selected-outer",
        paint: { "fill-color": "#0ea5e9", "fill-opacity": 0.10 }, layout: { visibility: "none" } });
      map.addLayer({ id: "rings-selected-inner-fill", type: "fill", source: "rings-selected-inner",
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.12 }, layout: { visibility: "none" } });

      map.addLayer({ id: "rings-selected-outer-line", type: "line", source: "rings-selected-outer",
        paint: { "line-color": "#0ea5e9", "line-width": 1.2, "line-opacity": 0.9 }, layout: { visibility: "none" } });
      map.addLayer({ id: "rings-selected-inner-line", type: "line", source: "rings-selected-inner",
        paint: { "line-color": "#22c55e", "line-width": 1.2, "line-opacity": 0.95 }, layout: { visibility: "none" } });
      /* amenities */
      map.addSource("amenities-nearby", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "amenities-nearby",
        type: "circle",
        source: "amenities-nearby",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["get", "count"],
            0, 10,
            50, 20,
            100, 30,
            500, 40
          ],
          "circle-color": ["match", ["get", "band"], "inner", "#22c55e", "outer", "#0ea5e9", "#6b7280"],
          "circle-opacity": 0.7,
          "circle-stroke-color": "#111827",
          "circle-stroke-width": 2,
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "amenities-nearby-labels",
        type: "symbol",
        source: "amenities-nearby",
        layout: {
          "text-field": ["get", "count"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 14,
          "text-allow-overlap": true,
          "visibility": "none",
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 2
        },
      });

      /* focused amenity marker */
      map.addSource("focused-amenity", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "focused-amenity",
        type: "circle",
        source: "focused-amenity",
        paint: {
          "circle-radius": 8,
          "circle-color": "#f59e0b",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
        layout: { visibility: "none" },
      });

      /* focused road highlight */
      map.addSource("focused-road", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "focused-road",
        type: "line",
        source: "focused-road",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 4,
          "line-opacity": 0.8,
        },
        layout: { visibility: "none" },
      });

      /* ensure roads draw above fills so they're always visible */
      try {
        map.moveLayer("roads-nearby-outer", "amenities-nearby");
        map.moveLayer("roads-nearby-inner", "roads-nearby-outer");
        map.moveLayer("focused-amenity");
        map.moveLayer("focused-road");
      } catch {}

      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0 });

      map.on("mousemove", "flood-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        show_popup(e.lngLat, popup_html(p));
      });
      map.on("mouseleave", "flood-points", () => hide_popup());

      map.on("mousemove", "flood-selected-points", (e) => {
        const p = selected_props || {};
        show_popup(e.lngLat, popup_html(p));
      });
      map.on("mouseleave", "flood-selected-points", () => hide_popup());

      map.on("click", "flood-points", (e) => {
        const f = e?.features?.[0];
        const id = f?.properties?.id ?? f?.id;
        if (id != null) {
          const idStr = String(id);
          set_selected(idStr);
          focus_select(idStr);
        }
      });
      map.on("click", "flood-clusters", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["flood-clusters"] });
        const cluster_id = features[0]?.properties?.cluster_id;
        const source = map.getSource("floods");
        if (!source || cluster_id == null) return;
        source.getClusterExpansionZoom(cluster_id, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: e.lngLat, zoom });
        });
      });

      map.on("click", (e) => {
        const bbox = [[e.point.x - 2, e.point.y - 2],[e.point.x + 2, e.point.y + 2]];
        const hit = map.queryRenderedFeatures(bbox, {
          layers: [
            "flood-clusters","flood-cluster-count","flood-points","flood-selected-points",
            "flood-selected-labels","amenities-nearby","amenities-nearby-labels",
            "rings-page-inner-fill","rings-page-outer-fill","roads-nearby-inner","roads-nearby-outer"
          ],
        });
        if (!hit || hit.length === 0) clear_selection();
      });
    })();

    try {
      const map = map_ref.current;
      map.moveLayer("flood-selected-labels");
      map.moveLayer("flood-selected-lines");
      map.moveLayer("flood-selected-lines-casing");
      map.moveLayer("amenities-nearby-labels");
      map.moveLayer("amenities-nearby");
      map.moveLayer("roads-nearby-outer");
      map.moveLayer("roads-nearby-inner");
      map.moveLayer("affected-road");
    } catch {}
    return () => { try { map_ref.current?.remove(); } catch {} };
  }, [floods_fc, bounds]);

  useEffect(() => {
    const on_key = (e) => { if (e.key === "Escape") clear_selection(); };
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, []);

  useEffect(() => {
    if (!floods_fc?.features?.length) return;
    const ids = floods_fc.features.map(ft => String(ft.properties?.id ?? ft.id ?? ""));
    const target = ids[0];
    if (target) focus_select(target);
  }, [floods_fc, stats_by_flood_distance]);

 
  useEffect(() => {
    if (!selected) return;
    focus_select(selected);
  }, [cat_weights, cat_enabled, inner_mult, outer_mult, w_betweenness, w_closeness, w_amenity]);

  // While editing radius, just repaint the selected rings so they never flicker off
  useEffect(() => {
    const center = selected_stats?.center;
    if (!center) return;
    const rin  = Math.max(0, Math.min(r_inner, r_outer));
    const rout = Math.max(rin, r_outer);
    paint_selected_rings(center, rin, rout);
  }, [r_inner, r_outer, selected_stats?.center]);

  useEffect(() => {
    const map = map_ref.current;
    if (!map) return;

    const set_vis = (vis) => {
      try {
        map.setLayoutProperty("rings-page-inner-fill", vis);
        map.setLayoutProperty("rings-page-outer-fill", vis);
        map.setLayoutProperty("rings-page-inner-line", vis);
        map.setLayoutProperty("rings-page-outer-line", vis);
      } catch {}
    };

    if (!show_page_rings) {
      set_vis("none");
      try {
        map.getSource("rings-page-inner")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("rings-page-outer")?.setData({ type: "FeatureCollection", features: [] });
      } catch {}
      return;
    }

    const inner_feats = [];
    const outer_feats = [];
    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);

    for (const row of paged) {
      const stats = stats_by_flood_distance.get(String(row.id));
      if (!stats?.center) continue;
      const [lng, lat] = stats.center;
      const inner = turf.circle([lng, lat], r_in,  { steps: 64, units: "meters" });
      const outer = turf.circle([lng, lat], r_out, { steps: 64, units: "meters" });
      inner.properties = { id: row.id, band: "inner" };
      outer.properties = { id: row.id, band: "outer" };
      inner_feats.push(inner);
      outer_feats.push(outer);
    }

    try {
      map.getSource("rings-page-inner")?.setData({ type: "FeatureCollection", features: inner_feats });
      map.getSource("rings-page-outer")?.setData({ type: "FeatureCollection", features: outer_feats });
      set_vis("visible");
    } catch {}
  }, [show_page_rings, paged, r_inner, r_outer, stats_by_flood_distance]);

  /* ===== helper functions ===== */
  const set_metric_range = (key, field, value) => {
    set_metric_filters((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
    set_page(1);
  };

  const reset_metric_filters = () => {
    set_metric_filters(createMetricFilterState());
  };

  const reset_all_filters = () => {
    set_q("");
    set_event_types_filter([]);
    set_pa_filter([]);
    set_from_str("");
    set_to_str("");
    reset_metric_filters();
    set_page(1);
  };

  function show_popup(lnglat, html) {
    hide_popup();
    popup_ref.current = new mapboxgl.Popup({ closeOnClick: false, closeButton: false, className: "popup-dark", offset: 10, maxWidth: "320px" })
      .setLngLat(lnglat)
      .setHTML(html)
      .addTo(map_ref.current);
  }
  function hide_popup() { try { popup_ref.current?.remove(); } catch {} popup_ref.current = null; }

  /* ===== selection ===== */
  async function focus_select(id_str) {
    set_selected(id_str);

    const feat = (floods_fc?.features || []).find((ft) => String(ft.properties?.id ?? ft.id) === String(id_str));
    if (!feat) return;
    const p = feat.properties || {};

    // Get center from start coordinates instead of build_flood_detail (removed to reduce lag)
    const center = [to_num(p.start_lng), to_num(p.start_lat)];
    if (Number.isNaN(center[0]) || Number.isNaN(center[1])) return;

    const map = map_ref.current;
    if (!map || !center) return;

    set_selected_props({ ...p });

    try {
      map.setFilter("flood-points", ["all", ["!", ["has", "point_count"]], ["==", ["to-string", ["get", "id"]], String(id_str)]]);
      map.setLayoutProperty("flood-clusters", "visibility", "none");
      map.setLayoutProperty("flood-cluster-count", "visibility", "none");
    } catch {}

    // REMOVED: Individual flood detail points and lines (causing lag)
    // const point_features = detail.points.map(pt => ({ ... }));
    // const line_features  = detail.lines.map(l => ({ ... }));

    // Hide the flood detail layers
    try {
      map.getSource("flood-selected-points")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("flood-selected-lines")?.setData({ type: "FeatureCollection", features: [] });
      map.getSource("flood-selected-labels")?.setData({ type: "FeatureCollection", features: [] });
      map.setLayoutProperty("flood-selected-points", "visibility", "none");
      map.setLayoutProperty("flood-selected-lines-casing", "visibility", "none");
      map.setLayoutProperty("flood-selected-lines", "visibility", "none");
      map.setLayoutProperty("flood-selected-labels", "visibility", "none");
    } catch {}

    /* start road highlight (original) */
    const road_id = p.start_rn_id == null ? null : String(p.start_rn_id);
    const road_feats = road_id ? (roads_by_id.get(road_id) || []) : [];
    try {
      map.getSource("affected-road")?.setData({
        type: "FeatureCollection",
        features: road_feats.map(r => ({ type: "Feature", properties: { rn_id: r.properties?.rn_id ?? r.properties?.RN_ID ?? null, name: r.properties?.name || "" }, geometry: r.geometry })),
      });
      map.setLayoutProperty("affected-road", "visibility", road_feats.length ? "visible" : "none");
    } catch {}

    /* rings for this selection */
    /* rings for this selection — independent of page rings */
    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);
    const inner = turf.circle(center, r_in,  { steps: 128, units: "meters" });
    const outer = turf.circle(center, r_out, { steps: 128, units: "meters" });

    
    try {
      map.getSource("rings-selected-inner")?.setData(inner);
      map.getSource("rings-selected-outer")?.setData(outer);

      map.setLayoutProperty("rings-selected-inner-fill", "visibility", "visible");
      map.setLayoutProperty("rings-selected-outer-fill", "visibility", "visible");
      map.setLayoutProperty("rings-selected-inner-line", "visibility", "visible");
      map.setLayoutProperty("rings-selected-outer-line", "visibility", "visible");
    } catch {}

    /* amenities near */
    const near = query_amenities(center[0], center[1], r_out);
    let inner_count = 0, outer_count = 0, impact_inner = 0, impact_outer = 0;

    // Count amenities by band
    for (const a of near) {
      const band = a._distm <= r_in ? "inner" : "outer";
      const enabled = cat_enabled[a.category] ?? true;
      const w = enabled ? (+cat_weights[a.category] || 0) : 0;
      if (band === "inner") { inner_count++; impact_inner += w * inner_mult; }
      else { outer_count++; impact_outer += w * outer_mult; }
    }

    // Amenity bubbles removed - no longer displaying count markers on map

    /* roads near (inner/outer) — rendered & for panel */
    const roads_pack = roads_within_rings(road_fc, center, r_in, r_out);
    set_roads_nearby_state(roads_pack);

    try {
      map.getSource("roads-nearby-inner")?.setData({
        type: "FeatureCollection",
        features: roads_pack.inner.map(r => ({ type: "Feature", properties: { band: "inner", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
      });
      map.getSource("roads-nearby-outer")?.setData({
        type: "FeatureCollection",
        features: roads_pack.outer.map(r => ({ type: "Feature", properties: { band: "outer", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
      });
      map.setLayoutProperty("roads-nearby-inner", roads_pack.inner.length ? "visible" : "none");
      map.setLayoutProperty("roads-nearby-outer", roads_pack.outer.length ? "visible" : "none");
    } catch {}

    /* scores */
    let bnorm = 0, cnorm = 0;
    if (p.start_rn_id != null) {
      const rlist = roads_by_id.get(String(p.start_rn_id)) || [];
      let bmax = -Infinity, cmax = -Infinity;
      for (const r of rlist) {
        const rp = r.properties || {};
        const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
        const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
        if (Number.isFinite(b)) bmax = Math.max(bmax, b);
        if (Number.isFinite(c)) cmax = Math.max(cmax, c);
      }
      if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
      if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);
    }
    const impact_total = impact_inner + impact_outer;
    const amenity_score = 1 - Math.exp(-impact_total / 10.0);

    // Calculate roads score with band weighting (matching batch calculation)
    const inner_weight_mult = inner_enabled ? inner_mult : 0;
    const outer_weight_mult = outer_enabled ? outer_mult : 0;
    const roads_impact = (roads_pack.inner.length * inner_weight_mult) + (roads_pack.outer.length * outer_weight_mult);
    const roads_score = 1 - Math.exp(-roads_impact / 10.0);

    // AR Impact with all 4 components
    const ar_impact = (w_betweenness * bnorm) + (w_closeness * cnorm) + (w_amenity * amenity_score) + (w_roads * roads_score);

    // Only include counts from enabled bands
    const activeInnerAmenities = inner_enabled ? inner_count : 0;
    const activeOuterAmenities = outer_enabled ? outer_count : 0;
    const activeInnerRoads = inner_enabled ? roads_pack.inner.length : 0;
    const activeOuterRoads = outer_enabled ? roads_pack.outer.length : 0;

    set_selected_stats({
      center,
      counts: { inner: activeInnerAmenities, outer: activeOuterAmenities, total: activeInnerAmenities + activeOuterAmenities },
      roads_counts: { inner: activeInnerRoads, outer: activeOuterRoads, total: activeInnerRoads + activeOuterRoads },
      impact: { inner: +impact_inner.toFixed(2), outer: +impact_outer.toFixed(2), total: +impact_total.toFixed(2) },
      centrality: { bnorm, cnorm },
      scores: { amenity_score: +amenity_score.toFixed(3), roads_score: +roads_score.toFixed(3), roads_impact: +roads_impact.toFixed(2), ar_impact: +ar_impact.toFixed(3) },
    });

    const rin = Math.max(0, Math.min(r_inner, r_outer));
    const rout = Math.max(rin, r_outer);
    paint_selected_rings(center, rin, rout);

    try { map.flyTo({ center, zoom: 15, essential: true }); } catch {}
  }

  function clear_selection() {
    set_selected(null);
    set_selected_props(null);
    set_selected_stats(null);
    set_roads_nearby_state({ inner: [], outer: [] });
    set_ring_filter("all");
    set_focused_amenity(null);
    set_focused_road(null);
    hide_popup();
    const map = map_ref.current;
    if (map) {
      try {
        map.setFilter("flood-points", ["all", ["!", ["has", "point_count"]]]);
        map.setLayoutProperty("flood-clusters", "visibility", "visible");
        map.setLayoutProperty("flood-cluster-count", "visibility", "visible");
        map.setLayoutProperty("flood-selected-points", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines-casing", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines", "visibility", "none");
        map.setLayoutProperty("flood-selected-labels", "visibility", "none");
        map.setLayoutProperty("amenities-nearby", "visibility", "none");
        map.setLayoutProperty("amenities-nearby-labels", "visibility", "none");
        map.setLayoutProperty("rings-page-inner-fill", "visibility", "none");
        map.setLayoutProperty("rings-page-outer-fill", "visibility", "none");
        map.setLayoutProperty("rings-page-inner-line", "visibility", "none");
        map.setLayoutProperty("rings-page-outer-line", "visibility", "none");
        map.setLayoutProperty("rings-selected-inner-fill", "visibility", "none");
        map.setLayoutProperty("rings-selected-outer-fill", "visibility", "none");
        map.setLayoutProperty("rings-selected-inner-line", "visibility", "none");
        map.setLayoutProperty("rings-selected-outer-line", "visibility", "none");
        map.setLayoutProperty("roads-nearby-inner", "visibility", "none");
        map.setLayoutProperty("roads-nearby-outer", "visibility", "none");
        map.setLayoutProperty("focused-amenity", "visibility", "none");
        map.setLayoutProperty("focused-road", "visibility", "none");
        map.getSource("amenities-nearby")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("roads-nearby-inner")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("roads-nearby-outer")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("focused-amenity")?.setData({ type: "FeatureCollection", features: [] });
        map.getSource("focused-road")?.setData({ type: "FeatureCollection", features: [] });
      } catch {}
    }
    clear_selected_rings();
  }

  function export_csv() {
    const cols = Object.keys(visible_cols).filter(k => visible_cols[k]);
    const header = cols.join(",");
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = sorted.map(r => cols.map(k => escape(k === "event" ? r[k]?.replace("_"," ") : r[k])).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floods_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const columns = [
    // Basic event information
    { key: "id", label: "ID", type: "string" },
    { key: "event_date", label: "Event Date", type: "string" },
    { key: "event", label: "Event Type", type: "string", render: (v)=>v?.replace("_"," ") },
    { key: "planning_area", label: "Planning Area", type: "string" },
    { key: "location", label: "Location", type: "string" },
    { key: "parent_road", label: "Road", type: "string" },

    // Primary metrics (shown by default)
    { key: "roads_total", label: "Roads Affected", type: "number" },
    { key: "ring_total", label: "Amenities Affected", type: "number" },
    { key: "betweenness_norm", label: "Betweenness Norm", type: "number" },
    { key: "closeness_norm", label: "Closeness Norm", type: "number" },
    { key: "ar_impact", label: "AR Impact", type: "number" },

    // Detailed breakdowns (optional, hidden by default)
    { key: "roads_inner", label: "Roads (Inner)", type: "number", optional: true },
    { key: "roads_outer", label: "Roads (Outer)", type: "number", optional: true },
    { key: "ring_inner", label: "Amenities (Inner)", type: "number", optional: true },
    { key: "ring_outer", label: "Amenities (Outer)", type: "number", optional: true },
    { key: "impact_inner", label: "Weighted Impact (Inner)", type: "number", optional: true },
    { key: "impact_outer", label: "Weighted Impact (Outer)", type: "number", optional: true },
    { key: "impact_total", label: "Weighted Impact Total", type: "number", optional: true },
    { key: "centrality", label: "Weighted Centrality", type: "number", optional: true },

    // Additional metadata (optional)
    { key: "start_postal_code", label: "Postal Code", type: "string", optional: true },
    { key: "start_lat", label: "Start Latitude", type: "number", optional: true },
    { key: "start_lng", label: "Start Longitude", type: "number", optional: true },
  ];

  const sort_icon = (key) => {
    if (key === "dt") return sort_key === "dt_desc" ? "↓" : "↑";
    if (sort_key === `${key}_asc`) return "↑";
    if (sort_key === `${key}_desc`) return "↓";
    return "↕";
  };
  const toggle_sort = (key) => {
    if (key === "dt") {
      set_sort_key(sort_key === "dt_desc" ? "dt_asc" : "dt_desc");
      return;
    }
    if (sort_key === `${key}_asc`) set_sort_key(`${key}_desc`);
    else if (sort_key === `${key}_desc`) set_sort_key(`${key}_asc`);
    else set_sort_key(`${key}_asc`);
  };

  /* ===== ui header with accordions ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-6 relative">
      {/* Loading overlay */}
      {isCalculating && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm font-medium">Recalculating...</span>
            </div>
          </div>
        </div>
      )}

      <header className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Flood Events Dashboard</h1>
          <FloodEventsLearnDialog />
          <p className="text-sm text-muted-foreground md:text-base">
            Amenities & Road Impact (AR Impact) combines road centrality with amenity exposure. Click a row or map point to focus. Press{" "}
            <kbd className="rounded-md border px-1.5 py-0.5 text-xs uppercase">Esc</kbd> to clear.
          </p>
        </div>

        {/* Flood Events Configuration - Unified Parent Accordion */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem
            value="flood-config"
            className={`overflow-hidden rounded-xl border shadow-sm ${
              hasUnappliedConfigChanges
                ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700'
                : 'bg-card'
            }`}
          >
            <AccordionTrigger className="px-6 py-4 text-lg font-bold">
              <div className="flex items-center gap-2 w-full">
                <span>Flood Events Configuration</span>
                {hasUnappliedConfigChanges && (
                  <span className="px-2 py-1 rounded-md text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700">
                    • Unapplied Changes
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-4">
              {/* Nested accordions for each subsection */}
              <Accordion type="multiple" className="space-y-4">

                {/* Amenity Categories & Weights */}
                <AccordionItem value="amenities" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                    Amenity Categories & Weights
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Per-Category Toggles & Weights</CardTitle>
                        <CardDescription>
                          Enable/disable categories and set their weights (1-10). Disabled categories contribute 0 to the impact calculation.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Amenity Weight Presets */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Weight Presets</Label>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {Object.entries(AMENITY_WEIGHT_PRESETS).map(([key, preset]) => {
                              const isActive = isAmenityWeightPresetActive(key);
                              return (
                                <button
                                  key={key}
                                  onClick={() => applyAmenityPreset(key)}
                                  className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                                    isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-muted/30'
                                  }`}
                                >
                                  <div className="font-semibold text-sm mb-1">{preset.name}</div>
                                  <div className="text-xs text-muted-foreground">{preset.description}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Category grid */}
                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                          {(categories.length ? categories.map((c) => c.amenity_category) : Object.keys(default_weight_by_category)).map((name) => {
                            const enabled = pendingCatEnabled[name] ?? true;
                            const weight = pendingCatWeights[name] ?? 1;
                            return (
                              <div key={name} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">{to_title_case(name)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      id={`amenity-${name}`}
                                      checked={enabled}
                                      onCheckedChange={(checked) =>
                                        setPendingCatEnabled((prev) => ({ ...prev, [name]: !!checked }))
                                      }
                                    />
                                    <Label htmlFor={`amenity-${name}`} className="text-xs cursor-pointer">
                                      enable
                                    </Label>
                                  </div>
                                  <NumberInput
                                    key={`${name}-${weight}`}
                                    value={weight}
                                    onValueChange={(numVal) => {
                                      if (numVal !== undefined) {
                                        setPendingCatWeights((prev) => ({ ...prev, [name]: numVal }));
                                      }
                                    }}
                                    min={1}
                                    max={10}
                                    stepper={1}
                                    decimalScale={3}
                                    fixedDecimalScale={false}
                                    disabled={!enabled}
                                    hideSteppers={true}
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

                {/* Distance Rings & Band Weights */}
                <AccordionItem value="rings" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                    Distance Rings & Band Weights
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Band Toggles & Weights</CardTitle>
                        <CardDescription>
                          Enable/disable distance bands and set their weight multipliers (1-10). Disabled bands contribute 0 to the calculation.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          {/* Inner Band */}
                          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">Inner Band</span>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="inner-radius" className="text-xs">Radius (meters)</Label>
                              <NumberInput
                                id="inner-radius"
                                value={r_inner}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    const next = clamp(numVal, 0, 5000);
                                    set_r_inner(next);
                                    if (next > r_outer) set_r_outer(next);
                                  }
                                }}
                                min={0}
                                max={5000}
                                stepper={10}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="inner-band-toggle"
                                  checked={pendingInnerEnabled}
                                  onCheckedChange={setPendingInnerEnabled}
                                />
                                <Label htmlFor="inner-band-toggle" className="text-xs cursor-pointer">
                                  enable
                                </Label>
                              </div>
                              <NumberInput
                                value={pendingInnerMult}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingInnerMult(numVal);
                                  }
                                }}
                                min={1}
                                max={10}
                                stepper={1}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                disabled={!pendingInnerEnabled}
                                hideSteppers={true}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              Inner Band: {r_inner} m — Weight: {pendingInnerEnabled ? pendingInnerMult : 0}
                            </div>
                          </div>

                          {/* Outer Band */}
                          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-sm">Outer Band</span>
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="outer-radius" className="text-xs">Radius (meters)</Label>
                              <NumberInput
                                id="outer-radius"
                                value={r_outer}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    const next = clamp(numVal, 0, 10000);
                                    set_r_outer(next);
                                    if (next < r_inner) set_r_inner(next);
                                  }
                                }}
                                min={0}
                                max={10000}
                                stepper={10}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Switch
                                  id="outer-band-toggle"
                                  checked={pendingOuterEnabled}
                                  onCheckedChange={setPendingOuterEnabled}
                                />
                                <Label htmlFor="outer-band-toggle" className="text-xs cursor-pointer">
                                  enable
                                </Label>
                              </div>
                              <NumberInput
                                value={pendingOuterMult}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingOuterMult(numVal);
                                  }
                                }}
                                min={1}
                                max={10}
                                stepper={1}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                disabled={!pendingOuterEnabled}
                                hideSteppers={true}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground font-mono">
                              Outer Band: {r_outer} m — Weight: {pendingOuterEnabled ? pendingOuterMult : 0}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Amenity Road Impact Configuration */}
                <AccordionItem value="ar-impact" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-6 py-4 text-base font-semibold">
                    Amenity Road Impact Weights
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Amenity Road Weight Presets</CardTitle>
                        <CardDescription>
                          Quick configurations for common scenarios. Fine-tune sliders after applying a preset.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                          {Object.entries(AR_IMPACT_PRESETS).map(([key, preset]) => {
                            const isActive = isARImpactPresetActive(key);
                            return (
                              <button
                                key={key}
                                onClick={() => applyARImpactPreset(key)}
                                className={`rounded-lg p-4 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                                  isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-muted/30'
                                }`}
                              >
                                <div className="font-semibold text-sm mb-1">{preset.name}</div>
                                <div className="text-xs text-muted-foreground">{preset.description}</div>
                                <div className="mt-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                                  <div>B:{preset.weights.betweenness} C:{preset.weights.closeness}</div>
                                  <div>A:{preset.weights.amenity} R:{preset.weights.roads}</div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Adjust Component Weights</CardTitle>
                        <CardDescription>
                          Control how betweenness, closeness, and amenity impact combine into the AR Impact score.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Betweenness Weight</Label>
                              <NumberInput
                                value={pendingWBetweenness * 100}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingWBetweenness(clamp(numVal / 100, 0, 1));
                                  }
                                }}
                                min={0}
                                max={100}
                                stepper={5}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                                className="w-16"
                              />
                            </div>
                            <Slider
                              value={[pendingWBetweenness * 100]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={(value) => setPendingWBetweenness(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                            />
                            <p className="text-xs text-muted-foreground">
                              How often the affected road lies on shortest paths between other roads.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Closeness Weight</Label>
                              <NumberInput
                                value={pendingWCloseness * 100}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingWCloseness(clamp(numVal / 100, 0, 1));
                                  }
                                }}
                                min={0}
                                max={100}
                                stepper={5}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                                className="w-16"
                              />
                            </div>
                            <Slider
                              value={[pendingWCloseness * 100]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={(value) => setPendingWCloseness(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                            />
                            <p className="text-xs text-muted-foreground">
                              How quickly the affected road can reach all other roads in the network.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Amenity Weight</Label>
                              <NumberInput
                                value={pendingWAmenity * 100}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingWAmenity(clamp(numVal / 100, 0, 1));
                                  }
                                }}
                                min={0}
                                max={100}
                                stepper={5}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                                className="w-16"
                              />
                            </div>
                            <Slider
                              value={[pendingWAmenity * 100]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={(value) => setPendingWAmenity(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                            />
                            <p className="text-xs text-muted-foreground">
                              Density and type of amenities affected, weighted by category multipliers and ring weights.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-sm">Roads Weight</Label>
                              <NumberInput
                                value={pendingWRoads * 100}
                                onValueChange={(numVal) => {
                                  if (numVal !== undefined) {
                                    setPendingWRoads(clamp(numVal / 100, 0, 1));
                                  }
                                }}
                                min={0}
                                max={100}
                                stepper={5}
                                decimalScale={0}
                                fixedDecimalScale={false}
                                hideSteppers={true}
                                className="w-16"
                              />
                            </div>
                            <Slider
                              value={[pendingWRoads * 100]}
                              min={0}
                              max={100}
                              step={5}
                              onValueChange={(value) => setPendingWRoads(clamp((value?.[0] ?? 0) / 100, 0, 1))}
                            />
                            <p className="text-xs text-muted-foreground">
                              Number of roads affected within distance rings, weighted by band multipliers.
                            </p>
                          </div>
                        </div>

                        {/* Dynamic Formula Display - Shows pending values */}
                        <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
                          <div className="mb-2 font-semibold uppercase tracking-wide text-muted-foreground">
                            Pending Formula
                          </div>
                          <p className="font-mono text-xs mb-2">
                            AR Impact = ({pendingWBetweenness.toFixed(2)} × Betweenness) + ({pendingWCloseness.toFixed(2)} × Closeness) + ({pendingWAmenity.toFixed(2)} × Amenity Score) + ({pendingWRoads.toFixed(2)} × Roads Score)
                          </p>
                          <ul className="mt-2 list-disc space-y-1 pl-4">
                            <li>
                              Betweenness and Closeness are normalized centrality values (0-1) for the affected road.
                            </li>
                            <li>
                              Amenity Score = 1 - exp(-impact_amenity / 10), where impact_amenity = {inner_enabled ? inner_mult : 0} × Σ(inner amenities × category weight) + {outer_enabled ? outer_mult : 0} × Σ(outer amenities × category weight).
                            </li>
                            <li>
                              Roads Score = 1 - exp(-impact_roads / 10), where impact_roads = {inner_enabled ? inner_mult : 0} × (inner roads count) + {outer_enabled ? outer_mult : 0} × (outer roads count).
                            </li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Apply Changes and Reset Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={resetConfigChanges}
                  disabled={!hasUnappliedConfigChanges}
                  className="text-sm"
                >
                  Reset
                </Button>
                <Button
                  onClick={applyConfigChanges}
                  disabled={!hasUnappliedConfigChanges}
                  className="text-sm bg-primary hover:bg-primary/90"
                >
                  Apply Changes
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 relative rounded-3xl border border-border bg-card shadow-sm h-[36rem] overflow-hidden">
            {selected && (
            <>
              {/* Legend */}
              <div className="flood-legend absolute left-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg">
                <div className="mb-2 font-medium">legend</div>
                <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#22c55e"}} /><span>origin / inner ring / inner roads</span></div>
                <div className="flex items-center gap-2 mb-1"><span className="legend-swatch" style={{background:"#3b82f6"}} /><span>start</span></div>
                <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#f59e0b"}} /><span>predicted a / b</span></div>
                <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#ef4444"}} /><span>end</span></div>
                <div className="flex items-center gap-2 mb-2"><span className="legend-swatch" style={{background:"#0ea5e9"}} /><span>outer ring / outer roads</span></div>
              </div>

              {/* Count Bubble - positioned to the right */}
              <div className="absolute right-3 top-3 z-10 rounded-xl p-3 text-xs shadow-lg bg-background border-2 border-primary">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{panel_tab === "amenities" ? (selected_stats.counts?.total ?? 0) : (selected_stats.roads_counts?.total ?? 0)}</div>
                  <div className="text-[10px] text-muted-foreground uppercase font-medium mt-1">
                    {panel_tab === "amenities" ? "Amenities" : "Roads"}
                  </div>
                </div>
              </div>
            </>
          )}
          <div ref={container_ref} className="h-full w-full min-h-[36rem]" />
        </div>

          <div className="lg:col-span-1 rounded-3xl border border-border bg-card shadow-sm h-[36rem] overflow-hidden flex flex-col">
            {selected && selected_stats ? (
              <div className="flex flex-col h-full overflow-hidden">
                <ScrollArea className="flex-1" style={{ height: 'calc(36rem - 0px)' }}>
                  <div className="p-3 space-y-1.5">
                    {/* Header with Close Button */}
                    <div className="flex items-center justify-between pb-1.5 border-b">
                      <div>
                        <h3 className="text-sm font-semibold">Flood Event Details</h3>
                        <p className="text-xs text-muted-foreground">{selected_props ? (selected_props.start_planning_area || "—") : "—"}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={clear_selection} className="h-7 w-7 p-0">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* (A) Top Section - Event Details Cards */}

                    {/* Three Metric Cards - Compact with Rankings */}
                    {(() => {
                      // Calculate rank based on AR Impact
                      const rankIndex = sorted.findIndex(f => f.id === selected);
                      const totalCount = sorted.length;
                      const rankPercent = totalCount > 0 ? ((rankIndex + 1) / totalCount * 100).toFixed(1) : null;

                      return (
                        <div className="grid grid-cols-3 gap-1.5">
                          {/* AR Impact Score */}
                          <Card className="border border-primary/20 bg-primary/5">
                            <CardHeader className="pb-1 pt-2 px-2">
                              <CardDescription className="text-[10px] uppercase font-medium">AR Impact</CardDescription>
                              <CardTitle className="text-base font-bold">{selected_stats.scores?.ar_impact?.toFixed(3) ?? 'N/A'}</CardTitle>
                              {rankPercent && <p className="text-[9px] text-muted-foreground mt-0.5">Top {rankPercent}%</p>}
                            </CardHeader>
                          </Card>

                          {/* Amenities Affected */}
                          <Card className="border">
                            <CardHeader className="pb-1 pt-2 px-2">
                              <CardDescription className="text-[10px] uppercase font-medium">Amenities</CardDescription>
                              <CardTitle className="text-base font-bold text-orange-600">{selected_stats.counts?.total ?? 0}</CardTitle>
                              <p className="text-[9px] text-muted-foreground mt-0.5">Affected</p>
                            </CardHeader>
                          </Card>

                          {/* Roads Affected */}
                          <Card className="border">
                            <CardHeader className="pb-1 pt-2 px-2">
                              <CardDescription className="text-[10px] uppercase font-medium">Roads</CardDescription>
                              <CardTitle className="text-base font-bold text-blue-600">{selected_stats.roads_counts?.total ?? 0}</CardTitle>
                              <p className="text-[9px] text-muted-foreground mt-0.5">Affected</p>
                            </CardHeader>
                          </Card>
                        </div>
                      );
                    })()}

                    {/* Event Information Grid */}
                    <Card className="border">
                      <CardHeader className="pb-1 pt-2 px-2">
                        <CardTitle className="text-xs font-semibold">Event Information</CardTitle>
                      </CardHeader>
                      <CardContent className="px-2 pb-2 pt-1">
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">ID</div>
                            <div className="font-mono text-xs">{selected_props?.id ?? 'N/A'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Type</div>
                            <div className="text-xs">{to_title_case(selected_props?.event ?? 'Unknown')}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Date</div>
                            <div className="text-xs">{selected_props?.event_date ?? 'N/A'}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Area</div>
                            <div className="text-xs truncate">{selected_props?.start_planning_area ?? 'N/A'}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Location</div>
                            <div className="text-xs truncate" title={selected_props?.location}>{selected_props?.location ?? 'N/A'}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Main Road</div>
                            <div className="text-xs truncate" title={selected_props?.parent_road}>{selected_props?.parent_road ?? 'N/A'}</div>
                          </div>
                          <div className="col-span-2">
                            <div className="text-[10px] text-muted-foreground mb-0.5 uppercase">Coordinates</div>
                            <div className="font-mono text-[10px]">
                              {Number.isFinite(Number(selected_props?.start_lat)) ? Number(selected_props.start_lat).toFixed(5) : 'N/A'}, {Number.isFinite(Number(selected_props?.start_lng)) ? Number(selected_props.start_lng).toFixed(5) : 'N/A'}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* (B) Bottom Section - Tabs with Flat Lists */}
                    <Card className="border">
                      <Tabs defaultValue="amenities" onValueChange={(val) => set_panel_tab(val)} className="w-full">
                        <div className="border-b px-2 pt-2">
                          <TabsList className="w-full grid grid-cols-2 h-8">
                            <TabsTrigger value="amenities" className="text-[10px]">
                              Amenities ({selected_stats.counts?.total ?? 0})
                            </TabsTrigger>
                            <TabsTrigger value="roads" className="text-[10px]">
                              Roads ({selected_stats.roads_counts?.total ?? 0})
                            </TabsTrigger>
                          </TabsList>
                        </div>

                        {/* Affected Amenities Tab - First */}
                        <TabsContent value="amenities" className="px-2 pb-2 space-y-1 mt-2">
                          {(() => {
                            // Get amenities from selected_stats
                            const center = selected_stats.center;
                            if (!center) return <p className="text-xs text-muted-foreground py-6 text-center">No location data</p>;

                            // Query amenities in both rings, only if bands are enabled
                            const innerAmenities = inner_enabled
                              ? query_amenities(center[0], center[1], r_inner).map(a => ({ ...a, band: 'inner' }))
                              : [];
                            const outerAmenities = outer_enabled
                              ? query_amenities(center[0], center[1], r_outer)
                                  .filter(a => a._distm > r_inner)
                                  .map(a => ({ ...a, band: 'outer' }))
                              : [];
                            const allAmenities = [...innerAmenities, ...outerAmenities];

                            // Filter by search
                            const filteredAmenities = amenity_search_term.trim()
                              ? allAmenities.filter(a =>
                                  (a.name || "").toLowerCase().includes(amenity_search_term.toLowerCase()) ||
                                  (a.category || "").toLowerCase().includes(amenity_search_term.toLowerCase())
                                )
                              : allAmenities;

                            return (
                              <>
                                {/* Search input */}
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                  <Input
                                    placeholder="Search amenities..."
                                    value={amenity_search_term}
                                    onChange={(e) => set_amenity_search_term(e.target.value)}
                                    className="pl-7 h-7 text-xs"
                                  />
                                </div>

                                {filteredAmenities.length > 0 ? (
                              <ScrollArea className="h-[200px]">
                                <div className="space-y-1 pr-2">
                                  {filteredAmenities.map((amenity, idx) => {
                                    const amenityName = amenity.name || "Unnamed Amenity";
                                    const category = amenity.category || "Unknown";
                                    const distance = amenity._distm;
                                    const band = amenity.band || "unknown";

                                    return (
                                      <div
                                        key={`${amenity.id}-${idx}`}
                                        className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/30 hover:bg-muted transition-colors"
                                      >
                                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                          <span className="font-medium text-foreground truncate text-[10px]">{amenityName}</span>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] text-muted-foreground">{to_title_case(category)}</span>
                                            {distance && (
                                              <span className="text-[9px] text-muted-foreground font-medium">{distance.toFixed(0)}m</span>
                                            )}
                                            <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                                              band === 'inner'
                                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                            }`}>
                                              {band}
                                            </span>
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant={focused_amenity?.id === amenity.id ? "default" : "ghost"}
                                          onClick={() => {
                                            const map = map_ref.current;
                                            if (!map) return;

                                            // Toggle focus
                                            if (focused_amenity?.id === amenity.id) {
                                              // Unfocus
                                              set_focused_amenity(null);
                                              map.getSource("focused-amenity")?.setData({ type: "FeatureCollection", features: [] });
                                              map.setLayoutProperty("focused-amenity", "visibility", "none");
                                              hide_popup();
                                            } else {
                                              // Focus on this amenity
                                              set_focused_amenity(amenity);
                                              const feature = {
                                                type: "Feature",
                                                geometry: { type: "Point", coordinates: [amenity.lng, amenity.lat] },
                                                properties: { name: amenityName }
                                              };
                                              map.getSource("focused-amenity")?.setData({ type: "FeatureCollection", features: [feature] });
                                              map.setLayoutProperty("focused-amenity", "visibility", "visible");

                                              // Show popup with amenity details
                                              const popupContent = `
                                                <div class="text-xs">
                                                  <div class="font-semibold mb-1">${amenityName}</div>
                                                  <div class="text-muted-foreground">
                                                    <div>Category: ${to_title_case(category)}</div>
                                                    <div>Distance: ${distance ? distance.toFixed(0) + 'm' : 'N/A'}</div>
                                                    <div>Band: ${band}</div>
                                                  </div>
                                                </div>
                                              `;
                                              show_popup({ lng: amenity.lng, lat: amenity.lat }, popupContent);

                                              map.flyTo({ center: [amenity.lng, amenity.lat], zoom: 17, essential: true });
                                            }
                                          }}
                                          className="h-6 px-1.5 text-[9px] hover:bg-primary/10 ml-1 shrink-0"
                                        >
                                          {focused_amenity?.id === amenity.id ? "Unfocus" : "Focus"}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </ScrollArea>
                            ) : (
                              <p className="text-xs text-muted-foreground py-6 text-center">
                                {amenity_search_term.trim() ? "No amenities match your search" : "No affected amenities"}
                              </p>
                            )}
                            </>
                            );
                          })()}
                        </TabsContent>

                        {/* Affected Roads Tab - Second */}
                        <TabsContent value="roads" className="px-2 pb-2 space-y-1 mt-2">
                          {(() => {
                            // Flatten roads from both bands, only if bands are enabled
                            const allRoads = [];
                            if (inner_enabled) {
                              (roads_nearby_state.inner || []).forEach(r => allRoads.push({ ...r, band: 'inner' }));
                            }
                            if (outer_enabled) {
                              (roads_nearby_state.outer || []).forEach(r => allRoads.push({ ...r, band: 'outer' }));
                            }

                            // Filter by search
                            const filteredRoads = road_search_term.trim()
                              ? allRoads.filter(r =>
                                  (r.name || "").toLowerCase().includes(road_search_term.toLowerCase()) ||
                                  String(r.rn_id || r.RN_ID || "").includes(road_search_term)
                                )
                              : allRoads;

                            return (
                              <>
                                {/* Search input */}
                                <div className="relative">
                                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                                  <Input
                                    placeholder="Search roads..."
                                    value={road_search_term}
                                    onChange={(e) => set_road_search_term(e.target.value)}
                                    className="pl-7 h-7 text-xs"
                                  />
                                </div>

                                {filteredRoads.length > 0 ? (
                              <ScrollArea className="h-[200px]">
                                <div className="space-y-1 pr-2">
                                  {filteredRoads.map((road, idx) => {
                                    const roadName = road.name || "Unnamed Road";
                                    const roadId = road.rn_id || road.RN_ID || "";
                                    const distance = road.d || road._distm;
                                    const band = road.band || "unknown";

                                    return (
                                      <div
                                        key={`${roadId}-${idx}`}
                                        className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/30 hover:bg-muted transition-colors"
                                      >
                                        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                          <span className="font-medium text-foreground truncate text-[10px]">{roadName}</span>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[9px] text-muted-foreground font-mono">ID: {roadId}</span>
                                            {distance && (
                                              <span className="text-[9px] text-muted-foreground font-medium">{distance}m</span>
                                            )}
                                            <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                                              band === 'inner'
                                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                            }`}>
                                              {band}
                                            </span>
                                          </div>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant={focused_road?.rn_id === roadId ? "default" : "ghost"}
                                          onClick={() => {
                                            const map = map_ref.current;
                                            if (!map || !road.geometry) return;
                                            try {
                                              // Toggle focus
                                              if (focused_road?.rn_id === roadId) {
                                                // Unfocus
                                                set_focused_road(null);
                                                map.getSource("focused-road")?.setData({ type: "FeatureCollection", features: [] });
                                                map.setLayoutProperty("focused-road", "visibility", "none");
                                                hide_popup();
                                              } else {
                                                // Focus on this road
                                                set_focused_road({ ...road, rn_id: roadId });
                                                const feature = {
                                                  type: "Feature",
                                                  geometry: road.geometry,
                                                  properties: { name: roadName }
                                                };
                                                map.getSource("focused-road")?.setData({ type: "FeatureCollection", features: [feature] });
                                                map.setLayoutProperty("focused-road", "visibility", "visible");

                                                // Show popup with road details
                                                const bb = turf.bbox({ type: "Feature", geometry: road.geometry, properties: {} });
                                                const centerLng = (bb[0] + bb[2]) / 2;
                                                const centerLat = (bb[1] + bb[3]) / 2;
                                                const popupContent = `
                                                  <div class="text-xs">
                                                    <div class="font-semibold mb-1">${roadName}</div>
                                                    <div class="text-muted-foreground">
                                                      <div>ID: ${roadId}</div>
                                                      <div>Distance: ${distance ? distance + 'm' : 'N/A'}</div>
                                                      <div>Band: ${band}</div>
                                                    </div>
                                                  </div>
                                                `;
                                                show_popup({ lng: centerLng, lat: centerLat }, popupContent);

                                                map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: 60, duration: 500 });
                                              }
                                            } catch {}
                                          }}
                                          className="h-6 px-1.5 text-[9px] hover:bg-primary/10 ml-1 shrink-0"
                                        >
                                          {focused_road?.rn_id === roadId ? "Unfocus" : "Focus"}
                                        </Button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </ScrollArea>
                            ) : (
                              <p className="text-xs text-muted-foreground py-6 text-center">
                                {road_search_term.trim() ? "No roads match your search" : "No affected roads"}
                              </p>
                            )}
                            </>
                            );
                          })()}
                        </TabsContent>
                      </Tabs>
                    </Card>
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center px-6">
                <div className="text-center space-y-2">
                  <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">No flood event selected</p>
                  <p className="text-[10px] text-muted-foreground">Click on a row in the table below to view details</p>
                </div>
              </div>
            )}
        </div>
      </div>
      <section className="rounded-3xl border border-border bg-card shadow-sm">
        <div className="px-6 py-5 space-y-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Filters</h2>
              <p className="text-sm text-muted-foreground">
                Use the ranges below to focus the flood list on amenity density, impact and road centrality.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={reset_metric_filters} disabled={!has_active_metric_filters}>
                Clear metric ranges
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-12">
            <div className="space-y-1.5 md:col-span-4">
              <Label htmlFor="flood-search">Search</Label>
              <Input
                id="flood-search"
                value={q}
                onChange={(e) => {
                  set_q(e.target.value);
                  set_page(1);
                }}
                placeholder="Search by ID, location or road"
              />
            </div>

            <div className="md:col-span-3">
              <MultiSelectFilter
                id="event-type"
                label="Event Type"
                options={event_type_options.filter(opt => opt !== "all")}
                values={event_types_filter}
                onChange={(selected) => {
                  set_event_types_filter(selected);
                  set_page(1);
                }}
                placeholder="All Event Types"
              />
            </div>

            <div className="md:col-span-3">
              <MultiSelectFilter
                id="planning-area"
                label="Planning Area"
                options={pa_options}
                values={pa_filter}
                onChange={(next) => {
                  set_pa_filter(next);
                  set_page(1);
                }}
                placeholder="All Planning Areas"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="from-date">From Date</Label>
              <Input
                id="from-date"
                type="date"
                value={from_str}
                onChange={(e) => {
                  set_from_str(e.target.value);
                  set_page(1);
                }}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="to-date">To Date</Label>
              <Input
                id="to-date"
                type="date"
                value={to_str}
                onChange={(e) => {
                  set_to_str(e.target.value);
                  set_page(1);
                }}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            {METRIC_FILTER_CONFIG.map((metric) => {
              const range = metric_filters[metric.key] || { min: "", max: "" };
              const step = metric.step ?? 1;
              const bounds = metric_bounds[metric.key] || { min: 0, max: 100 };

              // Parse current filter values, default to bounds if empty
              const parsedMin = range.min !== "" ? parseFloat(range.min) : bounds.min;
              const parsedMax = range.max !== "" ? parseFloat(range.max) : bounds.max;
              const sliderValue = [
                Number.isFinite(parsedMin) ? parsedMin : bounds.min,
                Number.isFinite(parsedMax) ? parsedMax : bounds.max
              ];

              return (
                <div key={metric.key} className="space-y-2">
                  <Label>{metric.label}</Label>
                  <div className="space-y-3 pt-2">
                    <Slider
                      value={sliderValue}
                      min={bounds.min}
                      max={bounds.max}
                      step={step}
                      onValueChange={(value) => {
                        if (value && value.length === 2) {
                          // Only update if values changed from bounds (user is filtering)
                          const isDefaultRange = value[0] === bounds.min && value[1] === bounds.max;
                          set_metric_range(metric.key, "min", isDefaultRange ? "" : value[0].toString());
                          set_metric_range(metric.key, "max", isDefaultRange ? "" : value[1].toString());
                        }
                      }}
                      className="w-full"
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{sliderValue[0].toFixed(step < 1 ? 2 : 0)}</span>
                      <span>{sliderValue[1].toFixed(step < 1 ? 2 : 0)}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{metric.description}</p>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Switch
                id="show-page-rings"
                checked={Boolean(show_page_rings)}
                onCheckedChange={(checked) => set_show_page_rings(checked)}
              />
              <Label htmlFor="show-page-rings" className="text-sm text-muted-foreground">
                Show rings for visible page
              </Label>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card shadow-sm">
        {/* Table controls */}
        <div className="px-6 py-4 border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {page_safe} of {total_pages} ({filtered.length} events)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    choose columns
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[360px] max-h-[80vh] p-0">
                  <div className="p-2 flex flex-col max-h-[80vh]">
                    <div className="flex items-center justify-between mb-2 shrink-0">
                      <span className="text-xs font-semibold uppercase tracking-wide">columns</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                          const allKeys = {};
                          columns.forEach(c => allKeys[c.key] = true);
                          set_visible_cols(allKeys);
                        }}>
                          all
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                          const noneKeys = {};
                          columns.forEach(c => noneKeys[c.key] = false);
                          set_visible_cols(noneKeys);
                        }}>
                          none
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => set_visible_cols({
                          id: true, event_date: true, event: true, planning_area: true, location: true, parent_road: true,
                          roads_total: true, ring_total: true, betweenness_norm: true, closeness_norm: true, ar_impact: true,
                          roads_inner: false, roads_outer: false, ring_inner: false, ring_outer: false,
                          impact_inner: false, impact_outer: false, impact_total: false,
                          start_postal_code: false, start_lat: false, start_lng: false,
                        })}>
                          reset
                        </Button>
                      </div>
                    </div>
                    <div className="overflow-y-auto flex-1 min-h-0 pr-2">
                      <div className="space-y-1 pb-2">
                        {columns.map((c) => {
                          const active = visible_cols[c.key];
                          return (
                            <label key={c.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer">
                              <span className="text-sm truncate mr-2">{c.label}</span>
                              <input
                                type="checkbox"
                                className="accent-primary shrink-0"
                                checked={active}
                                onChange={() => {
                                  set_visible_cols((prev) => ({ ...prev, [c.key]: !active }));
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
            </div>
          </div>

          {/* Filter Accordion */}
          <Accordion type="single" collapsible className="px-6">
            <AccordionItem value="filters" className="border-none">
              <AccordionTrigger className="py-3 text-sm hover:no-underline">
                <span className="flex items-center gap-2">
                  Table Filters
                  {q.trim() && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">Active</span>}
                </span>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-2">
                  <Label htmlFor="table-search" className="text-sm">Search Table</Label>
                  <Input
                    id="table-search"
                    value={q}
                    onChange={(e) => { set_q(e.target.value); set_page(1); }}
                    placeholder="Search by ID, location, road..."
                    className="max-w-md"
                  />
                  {q.trim() && (
                    <Button variant="ghost" size="sm" onClick={() => { set_q(""); set_page(1); }}>
                      Clear search
                    </Button>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {columns.filter(c=>visible_cols[c.key]).map((c)=>{
                  const k = c.key === "event_date" ? "dt" : c.key;
                  return (
                    <th key={c.key} className="px-4 py-3 cursor-pointer select-none" onClick={()=>toggle_sort(k)} title="click to sort">
                      <div className="flex items-center gap-2">
                        <span>{c.label}</span>
                        <span className="text-xs">{sort_icon(k)}</span>
                      </div>
                    </th>
                  );
                })}
                <th className="px-4 py-3">action</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => {
                const active = String(selected ?? "") === String(r.id);
                return (
                  <tr
                    key={r.id}
                    onClick={() => set_selected(prev => {
                      const next = String(prev) === String(r.id) ? null : r.id;
                      if (next) focus_select(next); else clear_selection();
                      return next;
                    })}
                    className={`border-t cursor-pointer hover:bg-muted/60 transition-colors ${active ? "bg-primary/10 border-l-4 border-l-primary" : ""}`}
                  >
                    {columns.filter(c=>visible_cols[c.key]).map((c)=>(
                      <td key={c.key} className="px-4 py-2">
                        {c.render ? c.render(r[c.key]) : (r[c.key] ?? "N/A")}
                      </td>
                    ))}
                    <td className="px-4 py-2">
                      <button
                        onClick={(e)=>{ e.stopPropagation(); set_selected(prev => {
                          const next = String(prev) === String(r.id) ? null : r.id;
                          if (next) focus_select(next); else clear_selection();
                          return next;
                        }); }}
                        className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                      >
                        {active ? "hide" : "view on map"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={columns.filter(c=>visible_cols[c.key]).length+1} className="px-4 py-6 text-center text-muted-foreground">
                    no rows match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t px-6 py-4 md:flex-row md:items-center md:justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page_safe} of {total_pages}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={reset_all_filters}>
              Reset Filters
            </Button>
            <Button
              variant="outline"
              onClick={() => set_page((p) => clamp(p - 1, 1, total_pages))}
              disabled={page_safe <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              onClick={() => set_page((p) => clamp(p + 1, 1, total_pages))}
              disabled={page_safe >= total_pages}
            >
              Next
            </Button>
            <Button variant="secondary" onClick={export_csv}>
              Export CSV
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-card shadow-sm">
        <div className="px-6 py-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Metric Reference</h2>
            <p className="text-sm text-muted-foreground">
              Quick definitions to help interpret the amenity and centrality metrics that drive the flood index.
            </p>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Metric</th>
                  <th className="px-4 py-2">What it represents</th>
                  <th className="px-4 py-2">How to interpret it</th>
                </tr>
              </thead>
              <tbody>
                {METRIC_SUMMARY_ROWS.map((row) => (
                  <tr key={row.metric} className="border-t">
                    <td className="px-4 py-3 font-medium">{row.metric}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.meaning}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.insight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <style>{`
        .mapboxgl-popup.popup-dark .mapboxgl-popup-content {
          background: rgba(2, 6, 23, 0.96);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          padding: 10px 12px;
        }
        .mapboxgl-popup.popup-dark .mapboxgl-popup-tip {
          border-top-color: rgba(2, 6, 23, 0.96) !important;
          border-bottom-color: rgba(2, 6, 23, 0.96) !important;
          border-left-color: rgba(2, 6, 23, 0.96) !important;
          border-right-color: rgba(2, 6, 23, 0.96) !important;
        }
        .flood-legend {
          background: rgba(2, 6, 23, 0.92);
          color: #e5e7eb;
          border: 1px solid rgba(148, 163, 184, .25);
          backdrop-filter: blur(6px) saturate(120%);
        }
        @media (prefers-color-scheme: light) {
          .flood-legend {
            background: rgba(255, 255, 255, 0.92);
            color: #0f172a;
            border-color: rgba(15, 23, 42, .08);
          }
        }
        .flood-legend .legend-swatch {
          display: inline-block; width: 12px; height: 12px; border-radius: 9999px;
          border: 1px solid rgba(0,0,0,.4);
        }
      `}</style>
    </div>
  );
}

/* ===== amenities panel (capitalized component) ===== */
function AmenitiesPanel({ center, stats, amenity_list, ring_filter, r_inner, r_outer, on_center }) {
  const [q, set_q] = useState("");
  const [open_band, set_open_band] = useState({ inner: true, outer: true });
  const [open_types, set_open_types] = useState({});
  const [limit_per_type, set_limit_per_type] = useState(200);

  const list = useMemo(() => {
    if (!center || !stats) return [];
    const pad = 0.009;
    const arr = [];
    for (const a of amenity_list) {
      if (a.lng < center[0] - pad || a.lng > center[0] + pad || a.lat < center[1] - pad || a.lat > center[1] + pad) continue;
      const d = turf.distance([center[0], center[1]], [a.lng, a.lat], { units: "kilometers" }) * 1000;
      if (d <= Math.max(r_inner, r_outer)) {
        arr.push({ ...a, distm: Math.round(d), band: d <= Math.max(0, Math.min(r_inner, r_outer)) ? "inner" : "outer" });
      }
    }
    return arr;
  }, [center, stats, amenity_list, r_inner, r_outer]);

  const needle = q.trim().toLowerCase();
  const filtered = list
    .filter(r => (ring_filter === "all" || r.band === ring_filter))
    .filter(r => !needle || (r.name || "").toLowerCase().includes(needle) || (r.category || "").toLowerCase().includes(needle));

  const grouped = useMemo(() => {
    const g = { inner: new Map(), outer: new Map() };
    for (const r of filtered) {
      const key = r.category || "others";
      const bucket_map = g[r.band];
      if (!bucket_map.has(key)) bucket_map.set(key, []);
      bucket_map.get(key).push(r);
    }
    return g;
  }, [filtered]);

  const totals = useMemo(() => {
    if (!stats) return { inner: 0, outer: 0, total: 0, types_inner: 0, types_outer: 0 };
    const inner = stats.counts?.inner || 0;
    const outer = stats.counts?.outer || 0;
    return { inner, outer, total: inner + outer, types_inner: grouped.inner.size, types_outer: grouped.outer.size };
  }, [stats, grouped]);

  if (!center || !stats) return <div className="text-sm text-muted-foreground p-3">select a flood to compute nearby amenities.</div>;
  if (totals.total === 0) return <div className="text-sm text-muted-foreground p-3">no amenities within ≤{r_outer} m.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e)=>set_q(e.target.value)} placeholder="search name / category…" className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          total: <b>{totals.total}</b> · AR Impact: <b>{stats.scores?.ar_impact ?? "—"}</b>
        </span>
      </div>

      {(["inner","outer"]).filter(b => ring_filter==="all" || ring_filter===b).map((band)=>{
        const m = grouped[band];
        const is_open = open_band[band];
        const count = band==="inner" ? totals.inner : totals.outer;
        const label = band==="inner" ? `≤${r_inner} m` : `≤${r_outer} m`;
        if (count===0) return null;
        return (
          <div key={band} className="rounded-2xl border">
            <div className="flex items-center justify-between p-3">
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground uppercase">{label}</div>
                <div className="text-sm"><b>{count}</b> amenities</div>
              </div>
              <button onClick={()=>set_open_band((s)=>({ ...s, [band]: !s[band] }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                {is_open ? "collapse" : "expand"}
              </button>
            </div>

            {is_open && (
              <div className="p-2 pt-0">
                {[...m.keys()].sort((a,b)=>a.localeCompare(b)).map((bucket)=>{
                  const items = m.get(bucket) || [];
                  const tkey = `${band}::${bucket}`;
                  const open = (open_types[tkey] ?? true);
                  const show = open ? items.slice(0, limit_per_type) : [];
                  const more = open && items.length > limit_per_type;

                  return (
                    <div key={bucket} className="mb-2 rounded-xl border">
                      <div className="flex items-center justify-between p-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs capitalize">{bucket}</span>
                          <span className="text-xs text-muted-foreground">· {items.length}</span>
                        </div>
                        <button onClick={()=>set_open_types((s)=>({ ...s, [tkey]: !(s[tkey] ?? true) }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                          {open ? "hide" : "show"}
                        </button>
                      </div>

                      {open && (
                        <div className="max-h-64 overflow-auto divide-y">
                          {show.map((a)=>(
                            <div key={a.id} className="p-2 text-sm flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium truncate">{a.name || "(unnamed)"}</div>
                                <div className="text-[11px] text-muted-foreground font-mono">{fmt(a.lat,5)}, {fmt(a.lng,5)} · {a.distm} m</div>
                              </div>
                              <div className="shrink-0">
                                <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted" onClick={()=>on_center?.(a.lng, a.lat)}>focus</button>
                              </div>
                            </div>
                          ))}
                          {more && (
                            <div className="p-2 text-center">
                              <button onClick={()=>set_limit_per_type((n)=>clamp(n+200,0,5000))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                                show more…
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ===== roads panel (capitalized component) ===== */
function RoadsPanel({ center, roads_pack, ring_filter, r_inner, r_outer, on_focus_rn }) {
  const [q, set_q] = useState("");
  const [open_band, set_open_band] = useState({ inner: true, outer: true });
  const [limit, set_limit] = useState(300);

  const list = useMemo(() => {
    const rows = [];
    for (const band of ["inner","outer"]) {
      for (const r of roads_pack[band] || []) {
        rows.push({ ...r, band });
      }
    }
    return rows;
  }, [roads_pack]);

  const needle = q.trim().toLowerCase();
  const filtered = list
    .filter(r => (ring_filter === "all" || r.band === ring_filter))
    .filter(r => !needle || (r.name || "").toLowerCase().includes(needle) || String(r.rn_id || "").includes(needle));

  const grouped = useMemo(() => {
    return {
      inner: (filtered.filter(x=>x.band==="inner")),
      outer: (filtered.filter(x=>x.band==="outer")),
    };
  }, [filtered]);

  const totals = useMemo(() => ({
    inner: roads_pack.inner?.length || 0,
    outer: roads_pack.outer?.length || 0,
    total: (roads_pack.inner?.length || 0) + (roads_pack.outer?.length || 0),
  }), [roads_pack]);

  if (!center) return <div className="text-sm text-muted-foreground p-3">select a flood to compute nearby roads.</div>;
  if (totals.total === 0) return <div className="text-sm text-muted-foreground p-3">no roads within ≤{r_outer} m.</div>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e)=>set_q(e.target.value)} placeholder="search road name / rn id…" className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring" />
        <span className="text-xs text-muted-foreground whitespace-nowrap">total: <b>{totals.total}</b></span>
      </div>

      {(["inner","outer"]).filter(b => ring_filter==="all" || ring_filter===b).map((band)=>{
        const rows = grouped[band] || [];
        if (!rows.length) return null;
        const is_open = open_band[band];
        const label = band==="inner" ? `≤${r_inner} m` : `≤${r_outer} m`;
        return (
          <div key={band} className="rounded-2xl border">
            <div className="flex items-center justify-between p-3">
              <div className="space-y-0.5">
                <div className="text-xs text-muted-foreground uppercase">{label}</div>
                <div className="text-sm"><b>{rows.length}</b> roads</div>
              </div>
              <button onClick={()=>set_open_band((s)=>({ ...s, [band]: !s[band] }))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                {is_open ? "collapse" : "expand"}
              </button>
            </div>

            {is_open && ( 
              <div className="max-h-64 overflow-auto divide-y">
                {rows.slice(0, limit).map((r, i)=>(
                  <div key={`${r.rn_id}-${i}-${r.d}`} className="p-2 text-sm flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">rn_id: {r.rn_id ?? "—"} · {r.d} m</div>
                    </div>
                    <div className="shrink-0">
                      <button className="rounded-lg border px-2 py-1 text-xs hover:bg-muted" onClick={()=>on_focus_rn?.(r.geometry)}>focus</button>
                    </div>
                  </div>
                ))}
                {rows.length > limit && (
                  <div className="p-2 text-center">
                    <button onClick={()=>set_limit(n=>clamp(n+300,0,5000))} className="rounded-lg border px-2 py-1 text-xs hover:bg-muted">
                      show more…
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
