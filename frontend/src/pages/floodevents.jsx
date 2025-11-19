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
import {
  default_weight_by_category,
  AMENITY_WEIGHT_PRESETS,
  AR_IMPACT_PRESETS,
  createMetricFilterState,
} from "@/components/pagecomponents/floodevents/constants";

import {
  popup_html,
  clear_selected_rings,
  roads_within_rings,
  bounds_from_floods,
  await_style,
  normalize01,
  meters_to_deg,
  to_num,
  to_title_case,
  format_option_label,
  date_in_range,
  dist_m,
  clamp,
  fmt,
} from "@/components/pagecomponents/floodevents/utils";
import FloodEventDetails from "@/components/pagecomponents/floodevents/FloodEventDetails";
import FloodConfigurationPanel from "@/components/pagecomponents/floodevents/FloodConfigurationPanel";
import FloodTable from "@/components/pagecomponents/floodevents/FloodTable";
import FloodMap from "@/components/pagecomponents/floodevents/FloodMap";

mapboxgl.accessToken = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
const mapbox_style = "mapbox://styles/mapbox/light-v11";
const page_size = 20;

/* ===== utils ===== */
// Utilities now imported from @/components/pagecomponents/floodevents/utils
function normalizeCat(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_"); 
}

const norm = (s) =>
  String(s).trim().toLowerCase().replace(/\s+/g, "_");


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

/* ===== main component ===== */
export default function floodevents() {
  const {
    floods_fc_enriched: floods_fc,
    amenity_fc_raw: amenity_fc,
    road_fc_enriched: road_fc,
    category_lookup,
    lookups,
    loading,
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

  // Pending filter states (for "Apply Filters" pattern)
  const [pending_q, set_pending_q] = useState("");
  const [pending_event_types_filter, set_pending_event_types_filter] = useState([]);
  const [pending_from_str, set_pending_from_str] = useState("");
  const [pending_to_str, set_pending_to_str] = useState("");
  const [pending_pa_filter, set_pending_pa_filter] = useState([]);

  // Slider filter states (active and pending)
  const [roads_total_min, set_roads_total_min] = useState("");
  const [roads_total_max, set_roads_total_max] = useState("");
  const [ring_total_min, set_ring_total_min] = useState("");
  const [ring_total_max, set_ring_total_max] = useState("");
  const [ar_impact_min, set_ar_impact_min] = useState("");
  const [ar_impact_max, set_ar_impact_max] = useState("");

  const [pending_roads_total_min, set_pending_roads_total_min] = useState("");
  const [pending_roads_total_max, set_pending_roads_total_max] = useState("");
  const [pending_ring_total_min, set_pending_ring_total_min] = useState("");
  const [pending_ring_total_max, set_pending_ring_total_max] = useState("");
  const [pending_ar_impact_min, set_pending_ar_impact_min] = useState("");
  const [pending_ar_impact_max, set_pending_ar_impact_max] = useState("");
  const from_date = useMemo(() => (from_str ? new Date(from_str) : null), [from_str]);
  const to_date = useMemo(() => (to_str ? new Date(to_str) : null), [to_str]);
  const [selected, set_selected] = useState(null);
  const [selected_props, set_selected_props] = useState(null);
  const [panel_open, set_panel_open] = useState(true);
  const [panel_tab, set_panel_tab] = useState("amenities"); // "amenities" | "roads"
  const [ring_filter, set_ring_filter] = useState("all");
  const [show_page_rings, set_show_page_rings] = useState(false);
  const [sort_col, set_sort_col] = useState("dt");
  const [sort_asc, set_sort_asc] = useState(false); // dt_desc means descending
  const [page, set_page] = useState(1);
  const [amenity_search_term, set_amenity_search_term] = useState("");
  const [road_search_term, set_road_search_term] = useState("");
  const [amenity_sort, set_amenity_sort] = useState("all"); // "all", "inner", "outer"
  const [road_sort, set_road_sort] = useState("all"); // "all", "inner", "outer"
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
    const defaultPreset = AMENITY_WEIGHT_PRESETS.default;
    const out = {};
    Object.entries(defaultPreset.weights).forEach(([key, val]) => {
      out[normalizeCat(key)] = val;
    });
    return out;
  });

   /* amenities flat list - deferred to avoid blocking navigation */
  const [amenity_list, set_amenity_list] = useState([]);
  useEffect(() => {
    // Defer amenity processing to avoid blocking page navigation
    const timer = setTimeout(() => {
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
      set_amenity_list(arr);
    }, 0);
    return () => clearTimeout(timer);
  }, [amenity_fc, category_lookup]);
  const categories = useMemo(() => {
    const items = Object.values(category_lookup?.by_id || {});
    return items.sort((a, b) => (a.id || 0) - (b.id || 0));
  }, [category_lookup]);


  const [cat_enabled, setCatEnabled] = useState(() => {
    const out = {};
    // start purely from default_weight_by_category
    Object.keys(default_weight_by_category).forEach((name) => {
      out[name] = true;
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
    Object.keys(default_weight_by_category).forEach((name) => {
      out[name] = true;
    });
    return out;
  });


  // helper: normalized + raw lookup for amenity categories
  const getAmenityKey = (category) => {
    const raw = String(category ?? "").trim();
    const normKey = normalizeCat(raw);
    return { raw, normKey };
  };

  const isAmenityCategoryEnabled = (category) => {
    const { raw, normKey } = getAmenityKey(category);
    if (typeof cat_enabled[normKey] === "boolean") return cat_enabled[normKey];
    if (typeof cat_enabled[raw] === "boolean") return cat_enabled[raw];
    return true; // default on
  };

  const getAmenityWeight = (category) => {
    const { raw, normKey } = getAmenityKey(category);
    if (typeof cat_weights[normKey] === "number") return cat_weights[normKey];
    if (typeof cat_weights[raw] === "number") return cat_weights[raw];
    return 0;
  };

  useEffect(() => {
  if (!category_lookup?.by_id) return;

  // merge new categories into active state (keep user toggles)
  setCatEnabled((prev) => {
    const next = { ...prev };
    for (const c of Object.values(category_lookup.by_id)) {
      const key = normalizeCat(c.amenity_category);
      if (!(key in next)) next[key] = true;
    }
    return next;
  });

  // same for pending state
  setPendingCatEnabled(prev => {
    const next = { ...prev };
    for (const c of Object.values(category_lookup.by_id)) {
      const norm = normalizeCat(c.amenity_category);
      if (!(norm in next)) next[norm] = true;
    }
    return next;
  });
  }, [category_lookup]);
  

  

  // Pending state for ring radii
  const [pendingRInner, setPendingRInner] = useState(200);
  const [pendingROuter, setPendingROuter] = useState(500);

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

    // Check ring radii
    const radiusChanges =
      Math.abs(r_inner - pendingRInner) > 0.001 ||
      Math.abs(r_outer - pendingROuter) > 0.001;

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

    return catWeightChanges || catEnabledChanges || radiusChanges || bandChanges || arWeightChanges;
  }, [
    cat_weights, pendingCatWeights,
    cat_enabled, pendingCatEnabled,
    r_inner, pendingRInner,
    r_outer, pendingROuter,
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
    set_r_inner(pendingRInner);
    set_r_outer(pendingROuter);
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
    pendingRInner, pendingROuter,
    pendingInnerMult, pendingOuterMult,
    pendingInnerEnabled, pendingOuterEnabled,
    pendingWBetweenness, pendingWCloseness,
    pendingWAmenity, pendingWRoads,
  ]);

  // Reset pending configuration changes to current active values
  const resetConfigChanges = useCallback(() => {
    setPendingCatWeights({ ...cat_weights });
    setPendingCatEnabled({ ...cat_enabled });
    setPendingRInner(r_inner);
    setPendingROuter(r_outer);
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
    r_inner, r_outer,
    inner_mult, outer_mult,
    inner_enabled, outer_enabled,
    w_betweenness, w_closeness,
    w_amenity, w_roads,
  ]);

  const applyAmenityPreset = useCallback((presetKey) => {
    const preset = AMENITY_WEIGHT_PRESETS[presetKey];
    if (!preset) return;

    const normalized = {};
    Object.entries(preset.weights).forEach(([key, val]) => {
      normalized[norm(key)] = val;
    });

    setPendingCatWeights(normalized);

    const enabled = {};
    Object.keys(normalized).forEach(k => enabled[k] = true);
    setPendingCatEnabled(enabled);

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

  // Deferred calculation to avoid blocking navigation
  const [stats_by_flood_distance, set_stats_by_flood_distance] = useState(new Map());

  useEffect(() => {
    // Defer expensive calculation to avoid blocking page navigation
    const timer = setTimeout(() => {
      const out = new Map();
      const floods = floods_fc?.features || [];
      if (!floods.length) {
        set_stats_by_flood_distance(out);
        return;
      }

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

          const enabled = isAmenityCategoryEnabled(a.category);
          const w = getAmenityWeight(a.category);

          if (!enabled) continue;

          if (band === "inner") {
            inner++;
            impact_inner += w * inner_mult;
          } else {
            outer++;
            impact_outer += w * outer_mult;
          }
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

        // Calculate centrality using all affected roads (origin, real end, or predicted endpoints)
        let bnorm = 0, cnorm = 0;
        const getAffectedRoadIds = (props) => {
          const ids = [];
          const origin_id = props.origin_rn_id ?? props.start_rn_id;
          if (origin_id != null) ids.push(String(origin_id));

          const hasRealEnd = props.end_rn_id != null &&
                             props.end_lat != null && props.end_lng != null &&
                             to_num(props.end_lat) !== 0 && to_num(props.end_lng) !== 0;

          if (hasRealEnd) {
            ids.push(String(props.end_rn_id));
          } else {
            if (props.end100_a_rn_id != null) ids.push(String(props.end100_a_rn_id));
            if (props.end100_b_rn_id != null) ids.push(String(props.end100_b_rn_id));
          }
          return ids;
        };

        const affected_road_ids = getAffectedRoadIds(p);
        let bmax = -Infinity, cmax = -Infinity;

        for (const rid of affected_road_ids) {
          const rlist = roads_by_id.get(rid) || [];
          for (const r of rlist) {
            const rp = r.properties || {};
            const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
            const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
            if (Number.isFinite(b)) bmax = Math.max(bmax, b);
            if (Number.isFinite(c)) cmax = Math.max(cmax, c);
          }
        }

        if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
        if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);

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
      set_stats_by_flood_distance(out);
    }, 0);

    return () => clearTimeout(timer);
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

  // Percentiles per event for AR impact, amenities and roads
  const percentiles_by_id = useMemo(() => {
    const map = new Map();
    if (!rows.length) return map;

    const arValues = rows
      .map((r) => r.ar_impact)
      .filter((v) => Number.isFinite(v));
    const amenityValues = rows
      .map((r) => r.ring_total)
      .filter((v) => Number.isFinite(v));
    const roadValues = rows
      .map((r) => r.roads_total)
      .filter((v) => Number.isFinite(v));

    const sortAsc = (arr) => [...arr].sort((a, b) => a - b);

    const sortedAr = sortAsc(arValues);
    const sortedAmenity = sortAsc(amenityValues);
    const sortedRoads = sortAsc(roadValues);

    const getPercentile = (value, sorted) => {
      if (!sorted.length || !Number.isFinite(value)) return null;

      // position of this value among all values (inclusive)
      let idx = 0;
      while (idx < sorted.length && sorted[idx] <= value) idx += 1;

      const denom = Math.max(sorted.length - 1, 1);
      const pct = (idx - 1) / denom; // 0–1
      return Math.max(0, Math.min(1, pct));
    };

    rows.forEach((r) => {
      map.set(String(r.id), {
        ar_impact: getPercentile(r.ar_impact, sortedAr),
        amenities: getPercentile(r.ring_total, sortedAmenity),
        roads: getPercentile(r.roads_total, sortedRoads),
      });
    });

    return map;
  }, [rows]);

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
      // Check slider filters
      if (!passesRange(r.roads_total, { min: roads_total_min, max: roads_total_max })) return false;
      if (!passesRange(r.ring_total, { min: ring_total_min, max: ring_total_max })) return false;
      if (!passesRange(r.ar_impact, { min: ar_impact_min, max: ar_impact_max })) return false;
      if (!needle) return true;
      const haystacks = [
        r.id,
        r.location || "",
        r.parent_road || "",
        r.planning_area || "",
      ];
      return haystacks.some((txt) => String(txt).toLowerCase().includes(needle));
    });
  }, [rows, q, event_types_filter, from_date, to_date, pa_filter, metric_filters, roads_total_min, roads_total_max, ring_total_min, ring_total_max, ar_impact_min, ar_impact_max]);

  const has_active_metric_filters = useMemo(() => {
    return Object.values(metric_filters).some((range) => {
      const minActive = typeof range?.min === "string" && range.min.trim() !== "";
      const maxActive = typeof range?.max === "string" && range.max.trim() !== "";
      return minActive || maxActive;
    });
  }, [metric_filters]);

  // Calculate max values for slider filters
  const maxValues = useMemo(() => {
    if (!rows.length) return { roads_total: 100, ring_total: 100, ar_impact: 10 };
    return {
      roads_total: Math.max(...rows.map(r => r.roads_total || 0)),
      ring_total: Math.max(...rows.map(r => r.ring_total || 0)),
      ar_impact: Math.max(...rows.map(r => r.ar_impact || 0)),
    };
  }, [rows]);

  // Check if there are unapplied filter changes
  const hasUnappliedFilterChanges = useMemo(() => {
    return (
      pending_q !== q ||
      JSON.stringify(pending_event_types_filter.sort()) !== JSON.stringify(event_types_filter.sort()) ||
      pending_from_str !== from_str ||
      pending_to_str !== to_str ||
      JSON.stringify(pending_pa_filter.sort()) !== JSON.stringify(pa_filter.sort()) ||
      pending_roads_total_min !== roads_total_min ||
      pending_roads_total_max !== roads_total_max ||
      pending_ring_total_min !== ring_total_min ||
      pending_ring_total_max !== ring_total_max ||
      pending_ar_impact_min !== ar_impact_min ||
      pending_ar_impact_max !== ar_impact_max
    );
  }, [
    pending_q, q,
    pending_event_types_filter, event_types_filter,
    pending_from_str, from_str,
    pending_to_str, to_str,
    pending_pa_filter, pa_filter,
    pending_roads_total_min, roads_total_min,
    pending_roads_total_max, roads_total_max,
    pending_ring_total_min, ring_total_min,
    pending_ring_total_max, ring_total_max,
    pending_ar_impact_min, ar_impact_min,
    pending_ar_impact_max, ar_impact_max,
  ]);

  // Apply pending filters to active filters
  const applyTableFilters = useCallback(() => {
    set_q(pending_q);
    set_event_types_filter(pending_event_types_filter);
    set_from_str(pending_from_str);
    set_to_str(pending_to_str);
    set_pa_filter(pending_pa_filter);
    set_roads_total_min(pending_roads_total_min);
    set_roads_total_max(pending_roads_total_max);
    set_ring_total_min(pending_ring_total_min);
    set_ring_total_max(pending_ring_total_max);
    set_ar_impact_min(pending_ar_impact_min);
    set_ar_impact_max(pending_ar_impact_max);
    set_page(1);
    // Clear map selection when filters change
    clear_selection();
  }, [
    pending_q, pending_event_types_filter, pending_from_str, pending_to_str, pending_pa_filter,
    pending_roads_total_min, pending_roads_total_max,
    pending_ring_total_min, pending_ring_total_max,
    pending_ar_impact_min, pending_ar_impact_max,
  ]);

  // Clear all filters (both pending and active)
  const clearAllTableFilters = useCallback(() => {
    // Clear active filters
    set_q("");
    set_event_types_filter([]);
    set_from_str("");
    set_to_str("");
    set_pa_filter([]);
    set_roads_total_min("");
    set_roads_total_max("");
    set_ring_total_min("");
    set_ring_total_max("");
    set_ar_impact_min("");
    set_ar_impact_max("");
    // Clear pending filters
    set_pending_q("");
    set_pending_event_types_filter([]);
    set_pending_from_str("");
    set_pending_to_str("");
    set_pending_pa_filter([]);
    set_pending_roads_total_min("");
    set_pending_roads_total_max("");
    set_pending_ring_total_min("");
    set_pending_ring_total_max("");
    set_pending_ar_impact_min("");
    set_pending_ar_impact_max("");
    set_page(1);
    // Clear map selection
    clear_selection();
  }, []);

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
    if (sort_col) {
      by(sort_col, sort_asc ? "asc" : "desc");
    }
    return arr;
  }, [filtered, sort_col, sort_asc]);

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

      // Floods source - will only show selected flood
      map.addSource("floods", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        promoteId: "id",
      });

      // Single flood marker (only shows when a flood is selected)
      map.addLayer({
        id: "flood-points",
        type: "circle",
        source: "floods",
        paint: {
          "circle-radius": 8,
          "circle-color": "#3b82f6",
          "circle-stroke-color": "#0b1220",
          "circle-stroke-width": 2,
          "circle-opacity": 0.95,
        },
        layout: { visibility: "none" },
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

      // Show popup on hover for flood markers
      map.on("mousemove", "flood-selected-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        show_popup(e.lngLat, popup_html(p, lookups));
      });
      map.on("mouseleave", "flood-selected-points", () => hide_popup());

      // Show popup on hover for main flood point
      map.on("mousemove", "flood-points", (e) => {
        const f = e?.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        show_popup(e.lngLat, popup_html(p, lookups));
      });
      map.on("mouseleave", "flood-points", () => hide_popup());
    })();

    try {
      const map = map_ref.current;
      // Order layers from bottom to top (roads -> amenities -> markers)
      map.moveLayer("flood-selected-lines-casing");
      map.moveLayer("flood-selected-lines");
      map.moveLayer("affected-road");
      map.moveLayer("roads-nearby-outer");
      map.moveLayer("roads-nearby-inner");
      map.moveLayer("amenities-nearby");
      map.moveLayer("amenities-nearby-labels");
      map.moveLayer("focused-road");
      map.moveLayer("focused-amenity");
      // Markers on top
      map.moveLayer("flood-points");
      map.moveLayer("flood-selected-points");
      map.moveLayer("flood-selected-labels");
    } catch {}
    return () => { try { map_ref.current?.remove(); } catch {} };
  }, [floods_fc, bounds]);

  useEffect(() => {
    const map = map_ref.current;
    if (!map) return;

    const src = map.getSource("focused-amenity");
    if (!src) return;

    if (!focused_amenity) {
      // clear + hide layer
      try {
        src.setData({
          type: "FeatureCollection",
          features: [],
        });
        if (map.getLayer("focused-amenity")) {
          map.setLayoutProperty("focused-amenity", "visibility", "none");
        }
      } catch (e) {
        console.warn("error clearing focused amenity:", e);
      }
      return;
    }

    // build a point feature
    const { lng, lat, ...props } = focused_amenity;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    const feature = {
      type: "Feature",
      properties: { ...props },
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
    };

    try {
      src.setData({
        type: "FeatureCollection",
        features: [feature],
      });
      if (map.getLayer("focused-amenity")) {
        map.setLayoutProperty("focused-amenity", "visibility", "visible");
        // keep marker on top
        map.moveLayer("focused-amenity");
      }
    } catch (e) {
      console.warn("error setting focused amenity:", e);
    }
    }, [focused_amenity]);

    useEffect(() => {
    const map = map_ref.current;
    if (!map) return;

    const src = map.getSource("focused-road");
    if (!src) return;

    if (!focused_road || !focused_road.geometry) {
      // clear + hide layer
      try {
        src.setData({
          type: "FeatureCollection",
          features: [],
        });
        if (map.getLayer("focused-road")) {
          map.setLayoutProperty("focused-road", "visibility", "none");
        }
      } catch (e) {
        console.warn("error clearing focused road:", e);
      }
      return;
    }

    const feature = {
      type: "Feature",
      properties: {
        rn_id: focused_road.rn_id ?? focused_road.RN_ID ?? null,
        name: focused_road.name || "",
      },
      geometry: focused_road.geometry,
    };

    try {
      src.setData({
        type: "FeatureCollection",
        features: [feature],
      });
      if (map.getLayer("focused-road")) {
        map.setLayoutProperty("focused-road", "visibility", "visible");
        map.moveLayer("focused-road");
      }
    } catch (e) {
      console.warn("error setting focused road:", e);
    }
  }, [focused_road]);


  useEffect(() => {
    const on_key = (e) => { if (e.key === "Escape") clear_selection(); };
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, []);

  // Removed: Auto-select first flood on load
  // User should manually click on a flood event to select it
  // useEffect(() => {
  //   if (!floods_fc?.features?.length) return;
  //   const ids = floods_fc.features.map(ft => String(ft.properties?.id ?? ft.id ?? ""));
  //   const target = ids[0];
  //   if (target) focus_select(target);
  // }, [floods_fc, stats_by_flood_distance]);

 
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

  // sync focused amenity to map source + popup
useEffect(() => {
  const map = map_ref.current;
  if (!map) return;

  const empty = {
    type: "FeatureCollection",
    features: [],
  };

  if (!focused_amenity) {
    try {
      map.getSource("focused-amenity")?.setData(empty);
      map.setLayoutProperty("focused-amenity", "visibility", "none");
    } catch {}
    return;
  }

  const { lng, lat } = focused_amenity;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

  const feat = {
    type: "Feature",
    properties: {
      name: focused_amenity.name || "Amenity",
      category: focused_amenity.category || "Unknown",
      distm: focused_amenity._distm ?? null,
    },
    geometry: {
      type: "Point",
      coordinates: [lng, lat],
    },
  };

  try {
    map.getSource("focused-amenity")?.setData({
      type: "FeatureCollection",
      features: [feat],
    });
    map.setLayoutProperty("focused-amenity", "visibility", "visible");
  } catch {}

  // optional: show popup immediately on focus
  const html = `
    <div class="flood-popup">
      <div class="flood-popup-title">
        ${feat.properties.name || "Amenity"}
      </div>
      <div class="flood-popup-sub">
        ${to_title_case(feat.properties.category || "Unknown")}
      </div>
      ${
        feat.properties.distm != null
          ? `<div class="flood-popup-pill">
               ${feat.properties.distm.toFixed(0)} m from flood
             </div>`
          : ""
      }
    </div>
  `;
  show_popup([lng, lat], html);
}, [focused_amenity]);

// sync focused road to map source + popup
useEffect(() => {
  const map = map_ref.current;
  if (!map) return;

  const empty = {
    type: "FeatureCollection",
    features: [],
  };

  if (!focused_road || !focused_road.geometry) {
    try {
      map.getSource("focused-road")?.setData(empty);
      map.setLayoutProperty("focused-road", "visibility", "none");
    } catch {}
    return;
  }

  const feat = {
    type: "Feature",
    properties: {
      name: focused_road.name || "Road",
      rn_id: focused_road.rn_id || focused_road.RN_ID || "",
      distm: focused_road.d ?? focused_road._distm ?? null,
    },
    geometry: focused_road.geometry,
  };

  try {
    map.getSource("focused-road")?.setData({
      type: "FeatureCollection",
      features: [feat],
    });
    map.setLayoutProperty("focused-road", "visibility", "visible");
  } catch {}

  // approximate a centre for the popup
  try {
    const center = turf.centerOfMass(feat);
    const [lng, lat] = center.geometry.coordinates;

    const html = `
      <div class="flood-popup">
        <div class="flood-popup-title">
          ${feat.properties.name || "Road"}
        </div>
        <div class="flood-popup-sub">
          Road ID: ${feat.properties.rn_id || "–"}
        </div>
        ${
          feat.properties.distm != null
            ? `<div class="flood-popup-pill">
                 ${feat.properties.distm.toFixed(0)} m from flood
               </div>`
            : ""
        }
      </div>
    `;
    show_popup([lng, lat], html);
  } catch {}
}, [focused_road]);



  /* ===== selection ===== */
  function focus_select(id_str) {
    // Note: set_selected is called by the caller (table row or map click handler)
    // We don't call it here to avoid redundant state updates

    const feat = (floods_fc?.features || []).find((ft) => String(ft.properties?.id ?? ft.id) === String(id_str));
    if (!feat) {
      console.warn("No feature found for ID:", id_str);
      return;
    }
    const p = feat.properties || {};

    // Use origin as center for rings (fallback to start if origin not available)
    const origin_lng = to_num(p.origin_lng);
    const origin_lat = to_num(p.origin_lat);
    const start_lng = to_num(p.start_lng);
    const start_lat = to_num(p.start_lat);

    let center;
    if (!Number.isNaN(origin_lng) && !Number.isNaN(origin_lat)) {
      center = [origin_lng, origin_lat];
    } else if (!Number.isNaN(start_lng) && !Number.isNaN(start_lat)) {
      center = [start_lng, start_lat];
    } else {
      console.warn("No valid center coordinates for ID:", id_str);
      return;
    }

    const map = map_ref.current;
    if (!map || !center) {
      console.warn("Map not ready or no center");
      return;
    }

    set_selected_props({ ...p });

    // Check if map is fully loaded and style is ready for visualization
    const mapReady = map.isStyleLoaded && map.isStyleLoaded();

    // Update floods source to show the origin marker (center of flood)
    if (mapReady) {
      try {
        const originFeature = {
          type: "Feature",
          properties: { ...p },
          geometry: { type: "Point", coordinates: center }
        };
        map.getSource("floods")?.setData({
          type: "FeatureCollection",
          features: [originFeature]
        });
        map.setLayoutProperty("flood-points", "visibility", "visible");
      } catch (e) {
        console.warn("Error showing selected flood:", e);
      }
    }

    // Create markers for flood endpoints (origin is already shown as main marker)
    const point_features = [];
    const label_features = [];

    // Helper to create marker
    const createMarker = (lng, lat, role, label) => {
      if (Number.isNaN(lng) || Number.isNaN(lat)) return null;
      return {
        type: "Feature",
        properties: { role, label, ...p },
        geometry: { type: "Point", coordinates: [lng, lat] }
      };
    };

    // Check if real end exists
    const end_lng = to_num(p.end_lng);
    const end_lat = to_num(p.end_lat);
    const hasRealEnd = !Number.isNaN(end_lng) && !Number.isNaN(end_lat) &&
                       Math.abs(end_lng) > 0 && Math.abs(end_lat) > 0;

    if (hasRealEnd) {
      // Show real end as red marker
      const endMarker = createMarker(end_lng, end_lat, "end", "End");
      if (endMarker) {
        point_features.push(endMarker);
        label_features.push(endMarker);
      }
    } else {
      // Show predicted endpoints as orange markers
      const pred_a_lng = to_num(p.end100_a_lng);
      const pred_a_lat = to_num(p.end100_a_lat);
      const predAMarker = createMarker(pred_a_lng, pred_a_lat, "pred_a", "Pred A");
      if (predAMarker) {
        point_features.push(predAMarker);
        label_features.push(predAMarker);
      }

      const pred_b_lng = to_num(p.end100_b_lng);
      const pred_b_lat = to_num(p.end100_b_lat);
      const predBMarker = createMarker(pred_b_lng, pred_b_lat, "pred_b", "Pred B");
      if (predBMarker) {
        point_features.push(predBMarker);
        label_features.push(predBMarker);
      }
    }

    // Update marker layers
    if (mapReady) {
      try {
        map.getSource("flood-selected-points")?.setData({
          type: "FeatureCollection",
          features: point_features
        });
        map.getSource("flood-selected-labels")?.setData({
          type: "FeatureCollection",
          features: label_features
        });
        map.setLayoutProperty("flood-selected-points", "visibility", point_features.length ? "visible" : "none");
        map.setLayoutProperty("flood-selected-labels", "visibility", label_features.length ? "visible" : "none");

        // Hide lines (not used in simplified view)
        map.getSource("flood-selected-lines")?.setData({ type: "FeatureCollection", features: [] });
        map.setLayoutProperty("flood-selected-lines-casing", "visibility", "none");
        map.setLayoutProperty("flood-selected-lines", "visibility", "none");
      } catch (e) {
        console.warn("Error setting flood markers:", e);
      }
    }

    /* Affected roads highlight - includes origin, real end, or predicted endpoints */
    // Helper function to get all affected road IDs for this flood event
    const getAffectedRoadIds = (props) => {
      const ids = [];

      // 1. Always include origin road (start_rn_id or origin_rn_id)
      const origin_id = props.origin_rn_id ?? props.start_rn_id;
      if (origin_id != null) {
        ids.push(String(origin_id));
      }

      // 2. Check if real end point exists (end coordinates and end_rn_id)
      const hasRealEnd = props.end_rn_id != null &&
                         props.end_lat != null && props.end_lng != null &&
                         to_num(props.end_lat) !== 0 && to_num(props.end_lng) !== 0;

      if (hasRealEnd) {
        // Use real end road
        ids.push(String(props.end_rn_id));
      } else {
        // 3. Fall back to predicted endpoints A and B
        if (props.end100_a_rn_id != null) {
          ids.push(String(props.end100_a_rn_id));
        }
        if (props.end100_b_rn_id != null) {
          ids.push(String(props.end100_b_rn_id));
        }
      }

      return ids;
    };

    const affected_road_ids = getAffectedRoadIds(p);
    const affected_road_feats = [];

    for (const rid of affected_road_ids) {
      const rlist = roads_by_id.get(rid) || [];
      for (const r of rlist) {
        affected_road_feats.push({
          type: "Feature",
          properties: {
            rn_id: r.properties?.rn_id ?? r.properties?.RN_ID ?? null,
            name: r.properties?.name || "",
            is_origin: rid === String(p.origin_rn_id ?? p.start_rn_id)
          },
          geometry: r.geometry
        });
      }
    }

    if (mapReady) {
      try {
        map.getSource("affected-road")?.setData({
          type: "FeatureCollection",
          features: affected_road_feats
        });
        map.setLayoutProperty("affected-road", "visibility", affected_road_feats.length ? "visible" : "none");
      } catch (e) {
        console.warn("Error setting affected roads:", e);
      }
    }

    /* rings for this selection */
    /* rings for this selection — independent of page rings */
    const r_in = Math.max(0, Math.min(r_inner, r_outer));
    const r_out = Math.max(r_in, r_outer);
    const inner = turf.circle(center, r_in,  { steps: 128, units: "meters" });
    const outer = turf.circle(center, r_out, { steps: 128, units: "meters" });


    if (mapReady) {
      try {
        map.getSource("rings-selected-inner")?.setData(inner);
        map.getSource("rings-selected-outer")?.setData(outer);

        map.setLayoutProperty("rings-selected-inner-fill", "visibility", "visible");
        map.setLayoutProperty("rings-selected-outer-fill", "visibility", "visible");
        map.setLayoutProperty("rings-selected-inner-line", "visibility", "visible");
        map.setLayoutProperty("rings-selected-outer-line", "visibility", "visible");
      } catch (e) {
        console.warn("Error setting rings:", e);
      }
    }

    /* amenities near */
    const near = query_amenities(center[0], center[1], r_out);
    let inner_count = 0, outer_count = 0, impact_inner = 0, impact_outer = 0;

    // Count amenities by band - only include enabled categories
    for (const a of near) {
      const band = a._distm <= r_in ? "inner" : "outer";

      const enabled = isAmenityCategoryEnabled(a.category);
      const w = getAmenityWeight(a.category);

      if (!enabled) continue;

      if (band === "inner") {
        inner_count++;
        impact_inner += w * inner_mult;
      } else {
        outer_count++;
        impact_outer += w * outer_mult;
      }
    }

    // Amenity bubbles removed - no longer displaying count markers on map

    /* roads near (inner/outer) — rendered & for panel */
    const roads_pack = roads_within_rings(road_fc, center, r_in, r_out);
    set_roads_nearby_state(roads_pack);

    if (mapReady) {
      try {
        map.getSource("roads-nearby-inner")?.setData({
          type: "FeatureCollection",
          features: roads_pack.inner.map(r => ({ type: "Feature", properties: { band: "inner", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
        });
        map.getSource("roads-nearby-outer")?.setData({
          type: "FeatureCollection",
          features: roads_pack.outer.map(r => ({ type: "Feature", properties: { band: "outer", rn_id: r.rn_id, name: r.name, distm: r.d }, geometry: r.geometry }))
        });

        // Check if layers exist before setting visibility
        if (map.getLayer("roads-nearby-inner")) {
          map.setLayoutProperty("roads-nearby-inner", "visibility", roads_pack.inner.length ? "visible" : "none");
        }
        if (map.getLayer("roads-nearby-outer")) {
          map.setLayoutProperty("roads-nearby-outer", "visibility", roads_pack.outer.length ? "visible" : "none");
        }

        // Ensure markers stay on top after updating roads
        if (map.getLayer("flood-points")) map.moveLayer("flood-points");
        if (map.getLayer("flood-selected-points")) map.moveLayer("flood-selected-points");
        if (map.getLayer("flood-selected-labels")) map.moveLayer("flood-selected-labels");
      } catch (e) {
        console.warn("Error setting nearby roads:", e);
      }
    }

    /* scores - calculate centrality using all affected roads */
    let bnorm = 0, cnorm = 0;
    let bmax = -Infinity, cmax = -Infinity;

    for (const rid of affected_road_ids) {
      const rlist = roads_by_id.get(rid) || [];
      for (const r of rlist) {
        const rp = r.properties || {};
        const b = +((rp.betweenness_norm ?? rp.betweenness ?? rp.BETWEENNESS_NORM ?? rp.BETWEENNESS) || NaN);
        const c = +((rp.closeness_norm   ?? rp.closeness   ?? rp.CLOSENESS_NORM   ?? rp.CLOSENESS)   || NaN);
        if (Number.isFinite(b)) bmax = Math.max(bmax, b);
        if (Number.isFinite(c)) cmax = Math.max(cmax, c);
      }
    }

    if (Number.isFinite(bmax)) bnorm = normalize01(bmax, centrality_scale.bmins, centrality_scale.bmaxs);
    if (Number.isFinite(cmax)) cnorm = normalize01(cmax, centrality_scale.cmins, centrality_scale.cmaxs);
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

    const stats = {
      center,
      counts: {
        inner: activeInnerAmenities,
        outer: activeOuterAmenities,
        total: activeInnerAmenities + activeOuterAmenities,
      },
      roads_counts: {
        inner: activeInnerRoads,
        outer: activeOuterRoads,
        total: activeInnerRoads + activeOuterRoads,
      },
      impact: {
        inner: +impact_inner.toFixed(2),
        outer: +impact_outer.toFixed(2),
        total: +impact_total.toFixed(2),
      },
      centrality: { bnorm, cnorm },
      scores: {
        amenity_score: +amenity_score.toFixed(3),
        roads_score: +roads_score.toFixed(3),
        roads_impact: +roads_impact.toFixed(2),
        ar_impact: +ar_impact.toFixed(3),
      },
      // ✅ this is what FloodEventDetails reads for rank:
      percentiles: percentiles_by_id.get(String(id_str)) || null,
    };

    set_selected_stats(stats);

    if (mapReady) {
      const rin = Math.max(0, Math.min(r_inner, r_outer));
      const rout = Math.max(rin, r_outer);
      paint_selected_rings(center, rin, rout);

      try { map.flyTo({ center, zoom: 15, essential: true }); } catch (e) {
        console.warn("Error flying to location:", e);
      }
    }
  }

  useEffect(() => {
    applyAmenityPreset("default");
  }, []);

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
        // Hide the flood marker when no flood is selected
        map.getSource("floods")?.setData({ type: "FeatureCollection", features: [] });
        map.setLayoutProperty("flood-points", "visibility", "none");
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
    { key: "location", label: "Location", type: "string", render: (v, row) => {
      const name = v || "Unnamed";
      const roadId = row._props?.start_rn_id || row._props?.origin_rn_id;
      return roadId ? `${name} (ID: ${roadId})` : name;
    }},
    { key: "parent_road", label: "Road", type: "string", render: (v, row) => {
      const name = v || "Unnamed";
      const roadId = row._props?.start_rn_id || row._props?.origin_rn_id;
      return roadId ? `${name} (ID: ${roadId})` : name;
    }},

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


  /* ===== ui header with accordions ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-6 relative">
      {/* Loading overlay */}
      {(loading || isCalculating) && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm font-medium">{loading ? "Loading data..." : "Recalculating..."}</span>
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

        <FloodConfigurationPanel
          pendingCatWeights={pendingCatWeights}
          setPendingCatWeights={setPendingCatWeights}
          pendingCatEnabled={pendingCatEnabled}
          setPendingCatEnabled={setPendingCatEnabled}
          cat_weights={cat_weights}
          cat_enabled={cat_enabled}
          pendingRInner={pendingRInner}
          setPendingRInner={setPendingRInner}
          pendingROuter={pendingROuter}
          setPendingROuter={setPendingROuter}
          pendingInnerMult={pendingInnerMult}
          setPendingInnerMult={setPendingInnerMult}
          pendingOuterMult={pendingOuterMult}
          setPendingOuterMult={setPendingOuterMult}
          pendingInnerEnabled={pendingInnerEnabled}
          setPendingInnerEnabled={setPendingInnerEnabled}
          pendingOuterEnabled={pendingOuterEnabled}
          setPendingOuterEnabled={setPendingOuterEnabled}
          r_inner={r_inner}
          r_outer={r_outer}
          inner_mult={inner_mult}
          outer_mult={outer_mult}
          inner_enabled={inner_enabled}
          outer_enabled={outer_enabled}
          pendingWBetweenness={pendingWBetweenness}
          setPendingWBetweenness={setPendingWBetweenness}
          pendingWCloseness={pendingWCloseness}
          setPendingWCloseness={setPendingWCloseness}
          pendingWAmenity={pendingWAmenity}
          setPendingWAmenity={setPendingWAmenity}
          pendingWRoads={pendingWRoads}
          setPendingWRoads={setPendingWRoads}
          w_betweenness={w_betweenness}
          w_closeness={w_closeness}
          w_amenity={w_amenity}
          w_roads={w_roads}
          applyConfigChanges={applyConfigChanges}
          resetConfigChanges={resetConfigChanges}
          applyAmenityPreset={applyAmenityPreset}
          applyARImpactPreset={applyARImpactPreset}
          isAmenityWeightPresetActive={isAmenityWeightPresetActive}
          isARImpactPresetActive={isARImpactPresetActive}
          categories={categories}
          hasUnappliedConfigChanges={hasUnappliedConfigChanges}
        />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FloodMap
          selected={selected}
          selected_props={selected_props}
          selected_stats={selected_stats}
          panel_tab={panel_tab}
          container_ref={container_ref}
          to_num={to_num}
        />

        {/* Details Panel */}
        <div className="lg:col-span-1 h-[36rem] rounded-3xl border border-border bg-card shadow-sm overflow-hidden">
          <FloodEventDetails
            selected={selected}
            selected_props={selected_props}
            selected_stats={selected_stats}
            panel_tab={panel_tab}
            set_panel_tab={set_panel_tab}
            amenity_search_term={amenity_search_term}
            set_amenity_search_term={set_amenity_search_term}
            road_search_term={road_search_term}
            set_road_search_term={set_road_search_term}
            inner_enabled={inner_enabled}
            outer_enabled={outer_enabled}
            r_inner={r_inner}
            r_outer={r_outer}
            query_amenities={query_amenities}
            roads_nearby_state={roads_nearby_state}
            map_ref={map_ref}
            onClose={clear_selection}
            focused_amenity={focused_amenity}
            set_focused_amenity={set_focused_amenity}
            focused_road={focused_road}
            set_focused_road={set_focused_road}
          />
      </div>


      </div>

      <FloodTable
        paged={paged}
        sorted={sorted}
        filtered={filtered}
        page_safe={page_safe}
        total_pages={total_pages}
        visible_cols={visible_cols}
        set_page={set_page}
        set_visible_cols={set_visible_cols}
        export_csv={export_csv}
        set_selected={set_selected}
        focus_select={focus_select}
        clear_selection={clear_selection}
        selected={selected}
        sort_col={sort_col}
        sort_asc={sort_asc}
        set_sort_col={set_sort_col}
        set_sort_asc={set_sort_asc}
        MultiSelectFilter={MultiSelectFilter}
        pending_q={pending_q}
        set_pending_q={set_pending_q}
        event_type_options={event_type_options}
        pending_event_types_filter={pending_event_types_filter}
        set_pending_event_types_filter={set_pending_event_types_filter}
        pa_options={pa_options}
        pending_pa_filter={pending_pa_filter}
        set_pending_pa_filter={set_pending_pa_filter}
        pending_from_str={pending_from_str}
        set_pending_from_str={set_pending_from_str}
        pending_to_str={pending_to_str}
        set_pending_to_str={set_pending_to_str}
        pending_roads_total_min={pending_roads_total_min}
        set_pending_roads_total_min={set_pending_roads_total_min}
        pending_roads_total_max={pending_roads_total_max}
        set_pending_roads_total_max={set_pending_roads_total_max}
        pending_ring_total_min={pending_ring_total_min}
        set_pending_ring_total_min={set_pending_ring_total_min}
        pending_ring_total_max={pending_ring_total_max}
        set_pending_ring_total_max={set_pending_ring_total_max}
        pending_ar_impact_min={pending_ar_impact_min}
        set_pending_ar_impact_min={set_pending_ar_impact_min}
        pending_ar_impact_max={pending_ar_impact_max}
        set_pending_ar_impact_max={set_pending_ar_impact_max}
        applyTableFilters={applyTableFilters}
        clearAllTableFilters={clearAllTableFilters}
        hasUnappliedFilterChanges={hasUnappliedFilterChanges}
      />

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

        .flood-popup {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .flood-popup-title {
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: capitalize;
        }
        .flood-popup-sub {
          font-size: 0.75rem;
          opacity: 0.8;
        }
        .flood-popup-pill {
          margin-top: 4px;
          align-self: flex-start;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 0.7rem;
          font-weight: 500;
          background: rgba(59, 130, 246, 0.18);
          border: 1px solid rgba(59, 130, 246, 0.5);
        }
      `}</style>
    </div>
  );
}
