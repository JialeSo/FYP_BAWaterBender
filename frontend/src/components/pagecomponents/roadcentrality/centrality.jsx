// src/pages/centrality.jsx
"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronsUpDown, X, Info } from "lucide-react";
import { NumberInput } from "@/components/NumberInput";
import {
  PAGE_SIZE,
  PRESETS,
  MOCK_EXAMPLE,
  EMPTY_COLLECTION,
  clamp,
  get_amenity_category,
  get_amenity_category_id,
  get_flood_type,
  get_road_type,
  make_percentiler,
  nznum,
  strip_count_suffix,
  format_number,
  to_title_case,
} from "./shared";
import { LearnHowToUseDialog } from "./LearnHowToUseDialog";
import { CentralityMap } from "./CentralityMap";
import { MultiSelectCombobox } from "./MultiSelectCombobox";
import { CentralityTable } from "./CentralityTable";
import { RoadDetailsPanel } from "./RoadDetailsPanel";

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
];

export default function Centrality() {
  const {
    road_fc_enriched: roadFC,
    floods_fc_enriched: floodsFC,
    amenity_fc_raw: amenityFC,
    category_lookup: categoryLookup,
  } = useMapData();

  /* ===== mock example for UI ===== */

  /* ===== preset handler ===== */
  const applyPreset = (presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    set_w_betweenness(preset.weights.betweenness);
    set_w_closeness(preset.weights.closeness);
    set_w_amenity(preset.weights.amenity);
    set_w_flood(preset.weights.flood);

    setUseCompBetweenness(preset.toggles.betweenness);
    setUseCompCloseness(preset.toggles.closeness);
    setUseCompAmenity(preset.toggles.amenity);
    setUseCompFlood(preset.toggles.flood);
  };


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

  // SLA configuration
  const [useSLAMapping, setUseSLAMapping] = useState(true);
  const [slaTop1Year, setSlaTop1Year] = useState(10); // Top 10%
  const [slaNext3Year, setSlaNext3Year] = useState(30); // Next 30%

  const mockExampleCalc = useMemo(() => {
  // Amenity calculation
  let amenityWeighted = 0;
  for (const { category, count } of MOCK_EXAMPLE.amenities) {
    const enabled = amenityEnabled[category] ?? true;
    const weight = amenityWeights[category] ?? 1.0;
    if (enabled) amenityWeighted += count * weight;
  }
  const amenityScore = Math.min(100, 20 * Math.log10(1 + amenityWeighted));

  // Flood calculation
  let floodWeighted = 0;
  for (const { type, count } of MOCK_EXAMPLE.floods) {
    const enabled = floodEnabled[type] ?? true;
    const weight = floodWeights[type] ?? 1.0;
    if (enabled) floodWeighted += count * weight;
  }
  const floodScore = Math.min(100, 25 * Math.log10(1 + floodWeighted));

  // Final importance
  const betNorm = useCompBetweenness ? MOCK_EXAMPLE.betweenness_norm * 100 : 0;
  const cloNorm = useCompCloseness ? MOCK_EXAMPLE.closeness_norm * 100 : 0;
  const amenComp = useCompAmenity ? amenityScore : 0;
  const floodComp = useCompFlood ? floodScore : 0;

  const importance = 
    (useCompBetweenness ? w_betweenness : 0) * betNorm +
    (useCompCloseness ? w_closeness : 0) * cloNorm +
    (useCompAmenity ? w_amenity : 0) * amenComp +
    (useCompFlood ? w_flood : 0) * floodComp;

  return {
    betNorm,
    cloNorm,
    amenityScore,
    floodScore,
    amenityWeighted,
    floodWeighted,
    importance,
  };
}, [
  amenityWeights, floodWeights, amenityEnabled, floodEnabled,
  useCompBetweenness, useCompCloseness, useCompAmenity, useCompFlood,
  w_betweenness, w_closeness, w_amenity, w_flood
]);

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
  const sortedByImportance = useMemo(() => {
    const arr = [...scored];
    arr.sort((a, b) => (b.properties.importance || 0) - (a.properties.importance || 0));
    return arr;
  }, [scored]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedByImportance.length / PAGE_SIZE)), [sortedByImportance.length]);

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

   // Selected road state
  const [selectedRoadId, setSelectedRoadId] = useState(null);
  const [mapInstance, setMapInstance] = useState(null);

  
  // Calculate SLA tier for a road based on percentile
  const getSLATier = useCallback((importance) => {
    if (!useSLAMapping) return null;
    
    const index = sortedByImportance.findIndex(f => f.properties.importance === importance);
    const percentile = (index / sortedByImportance.length) * 100;
    
    if (percentile < slaTop1Year) return 1;
    if (percentile < slaTop1Year + slaNext3Year) return 3;
    return 5;
  }, [useSLAMapping, slaTop1Year, slaNext3Year, sortedByImportance]);


  
  // Get selected road details
  const selectedRoad = useMemo(() => {
    if (!selectedRoadId) return null;
    return sortedByImportance.find(f => f.properties.RN_ID === selectedRoadId);
  }, [selectedRoadId, sortedByImportance]);


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
    const topRoad = sortedByImportance[0];
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
    sortedByImportance, amenityCategoryCountByRoad, floodTypeCountByRoad,
    amenityWeights, floodWeights, amenityEnabled, floodEnabled
  ]);

  /* ===== ui ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 p-6">
      {/* header */}
      <header className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Road Network Centrality</h1>
          <LearnHowToUseDialog />
          <p className="text-sm text-muted-foreground md:text-base">
            Analyse road importance using weighted components. Each section below is its own accordion. Use per-category toggles to include/exclude categories while setting weights.
          </p>
        </div>

        {/* Road Centrality Configuration - Unified Parent Accordion */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="road-centrality-config" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-lg font-bold">
              Road Centrality Configuration
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-4">
              {/* each subsection is its own accordion */}
              <Accordion type="multiple" className="space-y-4">
          {/* Road Filters */}
          <AccordionItem value="filters" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-6 py-4 text-base font-semibold">
              Road Filters
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4 mb-4">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1">Note: Filters Hide Roads, Don't Recalculate Metrics</p>
                    <p className="text-muted-foreground">
                      Filtering by planning area, subzone, or road type hides roads from the map and table but does <strong>not</strong> recompute 
                      betweenness or closeness centrality. These metrics are precomputed for the entire network and reflect the full road structure.
                    </p>
                  </div>
                </div>
              </div>
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
              Amenity Categories
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
                  <Accordion type="single" collapsible className="rounded-xl border bg-muted/40">
                    <AccordionItem value="example" className="border-0">
                      <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                        Example: {MOCK_EXAMPLE.name}
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-4 text-sm">
                          <div>
                            <div className="font-semibold mb-2">Amenities on this mock road:</div>
                            <div className="space-y-2">
                              {MOCK_EXAMPLE.amenities.map(({ category, count }) => {
                                const weight = amenityWeights[category] ?? 1.0;
                                const enabled = amenityEnabled[category] ?? true;
                                const weighted = enabled ? count * weight : 0;
                                return (
                                  <div key={category} className="rounded-lg border bg-background px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{to_title_case(category)}</span>
                                      <span className="text-muted-foreground font-mono">
                                        {count} × {weight.toFixed(1)} × {enabled ? "on" : "off"} = <b>{weighted.toFixed(1)}</b>
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="rounded-lg border bg-muted/40 p-3">
                            <div className="font-semibold mb-2">Calculation:</div>
                            <div className="text-xs space-y-1 font-mono">
                              <div>Total weighted = {mockExampleCalc.amenityWeighted.toFixed(1)}</div>
                              <div>Amenity score = min(100, 20 × log₁₀(1 + {mockExampleCalc.amenityWeighted.toFixed(1)}))</div>
                              <div className="mt-1">= <b>{mockExampleCalc.amenityScore.toFixed(2)}</b></div>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              This score feeds into the final importance via the component weight.
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>

                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {amenityCategoryKeys.map((cat) => {
                      const val = amenityWeights[cat] ?? 1.0;
                      const enabled = !!amenityEnabled[cat];
                      return (
                        <div key={cat} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(cat)}</span>
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

                            <NumberInput
                              value={val}
                              onValueChange={(numVal) => {
                                if (numVal !== undefined) {
                                  setAmenityWeights((prev) => ({ ...prev, [cat]: numVal }));
                                }
                              }}
                              min={1}
                              max={10}
                              stepper={0.1}
                              decimalScale={1}
                              fixedDecimalScale={true}
                              disabled={!enabled}
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
              Flood Event Types
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Per-Type Toggles & Multipliers</CardTitle>
                  <Accordion type="single" collapsible className="rounded-xl border bg-muted/40">
                    <AccordionItem value="example" className="border-0">
                      <AccordionTrigger className="px-4 py-3 text-sm font-semibold hover:no-underline">
                        Example: {MOCK_EXAMPLE.name}
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        <div className="space-y-4 text-sm">
                          <div>
                            <div className="font-semibold mb-2">Flood events on this mock road:</div>
                            <div className="space-y-2">
                              {MOCK_EXAMPLE.floods.map(({ type, count }) => {
                                const weight = floodWeights[type] ?? 1.0;
                                const enabled = floodEnabled[type] ?? true;
                                const weighted = enabled ? count * weight : 0;
                                return (
                                  <div key={type} className="rounded-lg border bg-background px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{to_title_case(type)}</span>
                                      <span className="text-muted-foreground font-mono">
                                        {count} × {weight.toFixed(1)} × {enabled ? "on" : "off"} = <b>{weighted.toFixed(1)}</b>
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="rounded-lg border bg-muted/40 p-3">
                            <div className="font-semibold mb-2">Calculation:</div>
                            <div className="text-xs space-y-1 font-mono">
                              <div>Total weighted = {mockExampleCalc.floodWeighted.toFixed(1)}</div>
                              <div>Flood score = min(100, 25 × log₁₀(1 + {mockExampleCalc.floodWeighted.toFixed(1)}))</div>
                              <div className="mt-1">= <b>{mockExampleCalc.floodScore.toFixed(2)}</b></div>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              This score feeds into the final importance via the component weight.
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                    {floodTypeKeys.map((type) => {
                      const val = floodWeights[type] ?? 1.0;
                      const enabled = !!floodEnabled[type];
                      return (
                        <div key={type} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(type)}</span>
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

                            <NumberInput
                              value={val}
                              onValueChange={(numVal) => {
                                if (numVal !== undefined) {
                                  setFloodWeights((prev) => ({ ...prev, [type]: numVal }));
                                }
                              }}
                              min={1}
                              max={10}
                              stepper={0.1}
                              decimalScale={1}
                              fixedDecimalScale={true}
                              disabled={!enabled}
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
              Component Weights
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 pt-2 space-y-6">
              <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-4">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1">Note: Component Weights Don't Recalculate Centrality</p>
                    <p className="text-muted-foreground">
                      Adjusting component weights changes how each factor contributes to the final importance, but does <strong>not</strong> recalculate 
                      betweenness or closeness centrality. These are precomputed network metrics.
                    </p>
                  </div>
                </div>
              </div>
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Weight Presets</CardTitle>
                  <CardDescription>Quick configurations for common scenarios. You can tweak sliders after applying a preset.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {Object.entries(PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => applyPreset(key)}
                        className="rounded-lg border bg-muted/30 p-4 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <div className="font-semibold text-sm mb-1">{preset.name}</div>
                        <div className="text-xs text-muted-foreground">{preset.description}</div>
                        <div className="mt-2 text-[10px] font-mono text-muted-foreground">
                          B:{preset.weights.betweenness} C:{preset.weights.closeness} A:{preset.weights.amenity} F:{preset.weights.flood}
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
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
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[w_betweenness * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_w_betweenness((v[0] || 0) / 100)}
                          disabled={!useCompBetweenness}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(w_betweenness * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_w_betweenness(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!useCompBetweenness}
                        />
                      </div>
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
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[w_closeness * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_w_closeness((v[0] || 0) / 100)}
                          disabled={!useCompCloseness}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(w_closeness * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_w_closeness(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!useCompCloseness}
                        />
                      </div>
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
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[w_amenity * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_w_amenity((v[0] || 0) / 100)}
                          disabled={!useCompAmenity}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(w_amenity * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_w_amenity(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!useCompAmenity}
                        />
                      </div>
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
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[w_flood * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_w_flood((v[0] || 0) / 100)}
                          disabled={!useCompFlood}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(w_flood * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_w_flood(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!useCompFlood}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Number of flood events weighted by per-type multipliers.
                      </p>
                    </div>
                  </div>

                  {/* example calculation */}
                  {/* mock example calculation */}
                  <div className="rounded-xl border bg-muted/40 p-4">
                    <div className="font-semibold mb-3">Example Calculation: {MOCK_EXAMPLE.name}</div>
                    <div className="grid gap-3 text-sm">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="text-muted-foreground">Betweenness (0-100):</div>
                        <div className="font-mono">
                          {mockExampleCalc.betNorm.toFixed(2)} × {useCompBetweenness ? w_betweenness.toFixed(2) : "0.00"} = {(useCompBetweenness ? w_betweenness * mockExampleCalc.betNorm : 0).toFixed(2)}
                        </div>
                        <div className="text-muted-foreground">Closeness (0-100):</div>
                        <div className="font-mono">
                          {mockExampleCalc.cloNorm.toFixed(2)} × {useCompCloseness ? w_closeness.toFixed(2) : "0.00"} = {(useCompCloseness ? w_closeness * mockExampleCalc.cloNorm : 0).toFixed(2)}
                        </div>
                        <div className="text-muted-foreground">Amenity Score:</div>
                        <div className="font-mono">
                          {mockExampleCalc.amenityScore.toFixed(2)} × {useCompAmenity ? w_amenity.toFixed(2) : "0.00"} = {(useCompAmenity ? w_amenity * mockExampleCalc.amenityScore : 0).toFixed(2)}
                        </div>
                        <div className="text-muted-foreground">Flood Score:</div>
                        <div className="font-mono">
                          {mockExampleCalc.floodScore.toFixed(2)} × {useCompFlood ? w_flood.toFixed(2) : "0.00"} = {(useCompFlood ? w_flood * mockExampleCalc.floodScore : 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="border-t pt-2 font-mono text-xs">
                        <div className="mb-1 font-semibold">Final Importance:</div>
                        <div className="text-muted-foreground">
                          = {(useCompBetweenness ? w_betweenness * mockExampleCalc.betNorm : 0).toFixed(2)}
                          + {(useCompCloseness ? w_closeness * mockExampleCalc.cloNorm : 0).toFixed(2)}
                          + {(useCompAmenity ? w_amenity * mockExampleCalc.amenityScore : 0).toFixed(2)}
                          + {(useCompFlood ? w_flood * mockExampleCalc.floodScore : 0).toFixed(2)}
                        </div>
                        <div className="mt-1 font-semibold text-base">
                          = {mockExampleCalc.importance.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>

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

          {/* SLA Configuration */}
<AccordionItem value="sla" className="overflow-hidden rounded-xl border bg-card shadow-sm">
  <AccordionTrigger className="px-6 py-4 text-base font-semibold">
    SLA Configuration
  </AccordionTrigger>
  <AccordionContent className="px-6 pb-6 pt-2 space-y-4">
    <Card className="border bg-background/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Configure SLA Tiers by Percentile</CardTitle>
        <CardDescription>
          Automatically assign SLA priorities based on importance percentiles.
          Roads in the top X% get 1-year SLA, next Y% get 3-year, remainder get 5-year.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Percentile Thresholds */}
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>1-Year SLA (Top Percentile)</Label>
              <span className="text-sm font-semibold">{slaTop1Year}%</span>
            </div>
            <Slider
              value={[slaTop1Year]}
              min={1}
              max={50}
              step={1}
              onValueChange={(v) => setSlaTop1Year(v[0])}
            />
            <p className="text-xs text-muted-foreground">
              Top {slaTop1Year}% of roads by importance
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>3-Year SLA (Next Percentile)</Label>
              <span className="text-sm font-semibold">{slaNext3Year}%</span>
            </div>
            <Slider
              value={[slaNext3Year]}
              min={1}
              max={80}
              step={1}
              onValueChange={(v) => setSlaNext3Year(v[0])}
            />
            <p className="text-xs text-muted-foreground">
              Next {slaNext3Year}% of roads
            </p>
          </div>

          <div className="rounded-lg border bg-muted/40 p-4">
            <Label className="text-sm">5-Year SLA (Remainder)</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Remaining {100 - slaTop1Year - slaNext3Year}% of roads
            </p>
          </div>
        </div>

        {/* Preview */}
        {useSLAMapping && (
          <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4">
            <h4 className="text-sm font-semibold mb-3">Preview Distribution</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span>1-Year SLA:</span>
                <strong>{Math.round(sortedByImportance.length * slaTop1Year / 100)} roads</strong>
              </div>
              <div className="flex justify-between">
                <span>3-Year SLA:</span>
                <strong>{Math.round(sortedByImportance.length * slaNext3Year / 100)} roads</strong>
              </div>
              <div className="flex justify-between">
                <span>5-Year SLA:</span>
                <strong>
                  {sortedByImportance.length - 
                   Math.round(sortedByImportance.length * slaTop1Year / 100) - 
                   Math.round(sortedByImportance.length * slaNext3Year / 100)} roads
                </strong>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  </AccordionContent>
</AccordionItem>
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </header>

      {/* Road Details Panel (always visible) */}
      <RoadDetailsPanel
        road={selectedRoad}
        onClose={() => setSelectedRoadId(null)}
        amenityCounts={selectedRoad ? amenityCategoryCountByRoad.get(selectedRoad.properties.RN_ID) : null}
        floodCounts={selectedRoad ? floodTypeCountByRoad.get(selectedRoad.properties.RN_ID) : null}
      />
        {/* Right: Map */}
        <CentralityMap
          data={mapData}
          selectedRoadId={selectedRoadId}
          onMapLoad={setMapInstance}
        />
      <section className="rounded-3xl border bg-card shadow-sm p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">All Segments</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete list of road segments with sortable columns and export capability
          </p>
        </div>
        <CentralityTable
          rows={sortedByImportance}
          totalRows={sortedByImportance.length}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          allColumnDefs={allColumnDefs}
          onRowClick={setSelectedRoadId}
        />
      </section>

      {/* custom popup styles - dark mode */}
      <style>{`
        .mapboxgl-popup-content {
          background-color: #0f172a !important;
          border-radius: 12px !important;
          padding: 0 !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
          border: 1px solid #1e293b !important;
        }
        .mapboxgl-popup-tip {
          border-top-color: #0f172a !important;
        }
        .mapboxgl-popup-close-button {
          color: #94a3b8 !important;
          font-size: 20px !important;
          padding: 4px 8px !important;
        }
        .mapboxgl-popup-close-button:hover {
          background-color: transparent !important;
          color: #fff !important;
        }
      `}</style>
    </div>
  );
}
