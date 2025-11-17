// src/pages/centrality.jsx
"use client";
 // update
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMapData } from "@/context/mapDataContext";

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
import { NumberInput } from "@/components/numberInput";
import {
  PAGE_SIZE,
  PRESETS,
  AMENITY_PRESETS,
  FLOOD_PRESETS,
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
import { CentralityMap } from "./centralityMap";
import { MultiSelectCombobox } from "./multiSelectCombobox";
import { CentralityTable } from "./centralityTable";
import { RoadDetailsPanel } from "./roadDetailsPanel";

const BASE_COLUMNS = [
  { key: "RN_ID", label: "RN ID", type: "number" },
  { key: "name", label: "Name", type: "string" },
  { key: "PLN_AREA_N", label: "Planning Area", type: "string" },
  { key: "SUBZONE_N", label: "Subzone", type: "string" },
  { key: "road_type", label: "Road Type", type: "string" },
  { key: "betweenness_norm", label: "Betweenness (Normalized)", type: "number", format: (v) => format_number(v, 4) },
  { key: "closeness_norm", label: "Closeness (Normalized)", type: "number", format: (v) => format_number(v, 4) },
  { key: "amenity_score", label: "Amenity Score", type: "number", format: (v) => format_number(v, 2) },
  { key: "flood_score", label: "Flood Score", type: "number", format: (v) => format_number(v, 2) },
  { key: "amenity_count_total", label: "Amenity Count", type: "number" },
  { key: "flood_count_total", label: "Flood Count", type: "number" },
  { key: "importance", label: "Importance", type: "number", format: (v) => format_number(v, 2) },
  { key: "sla_priority", label: "Maintenance Category", type: "string" },
];

export default function Centrality() {
  const {
    road_fc_enriched: roadFC,
    floods_fc_enriched: floodsFC,
    amenity_fc_raw: amenityFC,
    category_lookup: categoryLookup,
  } = useMapData();

  const [isCalculating, setIsCalculating] = useState(false);

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
    for (const k of amenityCategoryKeys) w[k] = 5.0;
    return w;
  }, [amenityCategoryKeys]);
  const default_amenity_enabled = useMemo(() => {
    const e = {};
    for (const k of amenityCategoryKeys) e[k] = true;
    return e;
  }, [amenityCategoryKeys]);

  const default_flood_weights = useMemo(() => {
    const w = {};
    for (const k of floodTypeKeys) w[k] = 5.0;
    return w;
  }, [floodTypeKeys]);
  const default_flood_enabled = useMemo(() => {
    const e = {};
    for (const k of floodTypeKeys) e[k] = true;
    return e;
  }, [floodTypeKeys]);

  // Active weight states (used for calculations)
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

  // Pending weight states (modified by UI, applied on button click)
  const [pendingAmenityWeights, setPendingAmenityWeights] = useState(default_amenity_weights);
  const [pendingAmenityEnabled, setPendingAmenityEnabled] = useState(default_amenity_enabled);
  const [pendingFloodWeights, setPendingFloodWeights] = useState(default_flood_weights);
  const [pendingFloodEnabled, setPendingFloodEnabled] = useState(default_flood_enabled);

  const [pendingUseCompBetweenness, setPendingUseCompBetweenness] = useState(true);
  const [pendingUseCompCloseness, setPendingUseCompCloseness] = useState(true);
  const [pendingUseCompAmenity, setPendingUseCompAmenity] = useState(true);
  const [pendingUseCompFlood, setPendingUseCompFlood] = useState(true);

  const [pending_w_betweenness, set_pending_w_betweenness] = useState(0.4);
  const [pending_w_closeness, set_pending_w_closeness] = useState(0.3);
  const [pending_w_amenity, set_pending_w_amenity] = useState(0.2);
  const [pending_w_flood, set_pending_w_flood] = useState(0.1);

  /* ===== mock example for UI ===== */

  /* ===== preset handlers ===== */
  const applyPreset = useCallback((presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;

    // Apply to pending states (UI will show changes immediately)
    set_pending_w_betweenness(preset.weights.betweenness);
    set_pending_w_closeness(preset.weights.closeness);
    set_pending_w_amenity(preset.weights.amenity);
    set_pending_w_flood(preset.weights.flood);

    setPendingUseCompBetweenness(preset.toggles.betweenness);
    setPendingUseCompCloseness(preset.toggles.closeness);
    setPendingUseCompAmenity(preset.toggles.amenity);
    setPendingUseCompFlood(preset.toggles.flood);
  }, []);

  const applyAmenityPreset = useCallback((presetKey) => {
    const preset = AMENITY_PRESETS[presetKey];
    if (!preset || !preset.weights) return;

    // Apply to pending states
    setPendingAmenityWeights((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(key => {
        updated[key] = preset.weights[key];
      });
      return updated;
    });

    // Enable all categories in the preset
    setPendingAmenityEnabled((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(key => {
        updated[key] = true;
      });
      return updated;
    });
  }, []);

  const applyFloodPreset = useCallback((presetKey) => {
    const preset = FLOOD_PRESETS[presetKey];
    if (!preset || !preset.weights) return;

    // Apply to pending states
    setPendingFloodWeights((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(key => {
        updated[key] = preset.weights[key];
      });
      return updated;
    });

    // Enable all flood types in the preset
    setPendingFloodEnabled((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(key => {
        updated[key] = true;
      });
      return updated;
    });
  }, []);

  // Check if a main preset is currently active (based on pending values)
  const isMainPresetActive = useCallback((presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return false;

    // Check if pending weights match
    const weightsMatch =
      Math.abs(pending_w_betweenness - preset.weights.betweenness) < 0.01 &&
      Math.abs(pending_w_closeness - preset.weights.closeness) < 0.01 &&
      Math.abs(pending_w_amenity - preset.weights.amenity) < 0.01 &&
      Math.abs(pending_w_flood - preset.weights.flood) < 0.01;

    // Check if pending toggles match
    const togglesMatch =
      pendingUseCompBetweenness === preset.toggles.betweenness &&
      pendingUseCompCloseness === preset.toggles.closeness &&
      pendingUseCompAmenity === preset.toggles.amenity &&
      pendingUseCompFlood === preset.toggles.flood;

    return weightsMatch && togglesMatch;
  }, [pending_w_betweenness, pending_w_closeness, pending_w_amenity, pending_w_flood, pendingUseCompBetweenness, pendingUseCompCloseness, pendingUseCompAmenity, pendingUseCompFlood]);

  // Check if an amenity preset is currently active (based on pending values)
  const isAmenityPresetActive = useCallback((presetKey) => {
    const preset = AMENITY_PRESETS[presetKey];
    if (!preset || !preset.weights) return false;

    // Check if all weights match and all categories are enabled
    return Object.keys(preset.weights).every(key =>
      Math.abs((pendingAmenityWeights[key] || 0) - preset.weights[key]) < 0.01 &&
      pendingAmenityEnabled[key] === true
    );
  }, [pendingAmenityWeights, pendingAmenityEnabled]);

  // Check if a flood preset is currently active (based on pending values)
  const isFloodPresetActive = useCallback((presetKey) => {
    const preset = FLOOD_PRESETS[presetKey];
    if (!preset || !preset.weights) return false;

    // Check if all weights match and all flood types are enabled
    return Object.keys(preset.weights).every(key =>
      Math.abs((pendingFloodWeights[key] || 0) - preset.weights[key]) < 0.01 &&
      pendingFloodEnabled[key] === true
    );
  }, [pendingFloodWeights, pendingFloodEnabled]);

  // Check if there are unapplied weight changes
  const hasUnappliedWeightChanges = useMemo(() => {
    // Check component weights and toggles
    const componentChanges =
      Math.abs(pending_w_betweenness - w_betweenness) > 0.001 ||
      Math.abs(pending_w_closeness - w_closeness) > 0.001 ||
      Math.abs(pending_w_amenity - w_amenity) > 0.001 ||
      Math.abs(pending_w_flood - w_flood) > 0.001 ||
      pendingUseCompBetweenness !== useCompBetweenness ||
      pendingUseCompCloseness !== useCompCloseness ||
      pendingUseCompAmenity !== useCompAmenity ||
      pendingUseCompFlood !== useCompFlood;

    // Check amenity weights and toggles
    const amenityChanges = Object.keys(pendingAmenityWeights).some(key =>
      Math.abs((pendingAmenityWeights[key] || 0) - (amenityWeights[key] || 0)) > 0.01 ||
      pendingAmenityEnabled[key] !== amenityEnabled[key]
    );

    // Check flood weights and toggles
    const floodChanges = Object.keys(pendingFloodWeights).some(key =>
      Math.abs((pendingFloodWeights[key] || 0) - (floodWeights[key] || 0)) > 0.01 ||
      pendingFloodEnabled[key] !== floodEnabled[key]
    );

    return componentChanges || amenityChanges || floodChanges;
  }, [
    pending_w_betweenness, w_betweenness, pending_w_closeness, w_closeness,
    pending_w_amenity, w_amenity, pending_w_flood, w_flood,
    pendingUseCompBetweenness, useCompBetweenness, pendingUseCompCloseness, useCompCloseness,
    pendingUseCompAmenity, useCompAmenity, pendingUseCompFlood, useCompFlood,
    pendingAmenityWeights, amenityWeights, pendingAmenityEnabled, amenityEnabled,
    pendingFloodWeights, floodWeights, pendingFloodEnabled, floodEnabled
  ]);

  // Apply pending weights to active weights
  const applyWeightChanges = useCallback(() => {
    set_w_betweenness(pending_w_betweenness);
    set_w_closeness(pending_w_closeness);
    set_w_amenity(pending_w_amenity);
    set_w_flood(pending_w_flood);
    setUseCompBetweenness(pendingUseCompBetweenness);
    setUseCompCloseness(pendingUseCompCloseness);
    setUseCompAmenity(pendingUseCompAmenity);
    setUseCompFlood(pendingUseCompFlood);
    setAmenityWeights(pendingAmenityWeights);
    setAmenityEnabled(pendingAmenityEnabled);
    setFloodWeights(pendingFloodWeights);
    setFloodEnabled(pendingFloodEnabled);
  }, [
    pending_w_betweenness, pending_w_closeness, pending_w_amenity, pending_w_flood,
    pendingUseCompBetweenness, pendingUseCompCloseness, pendingUseCompAmenity, pendingUseCompFlood,
    pendingAmenityWeights, pendingAmenityEnabled, pendingFloodWeights, pendingFloodEnabled
  ]);


  /* ===== derived options ===== */
  const planningOptions = useMemo(() => {
    const s = new Set();
    (roadFC?.features || []).forEach((f) => { const v = f?.properties?.PLN_AREA_N; if (v) s.add(String(v)); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [roadFC]);

  const roadTypeOptions = useMemo(() => {
    const s = new Set();
    (roadFC?.features || []).forEach((f) => s.add(String(get_road_type(f.properties))));
    s.delete("unknown");
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [roadFC]);

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
  const [roadTypesSelected, setRoadTypesSelected] = useState([]);
  const [amenitySelectedLabels, setAmenitySelectedLabels] = useState([]);
  const [floodSelectedLabels, setFloodSelectedLabels] = useState([]);
  const amenitySelectedRawSet = useMemo(() => new Set(amenitySelectedLabels.map((s) => strip_count_suffix(s.replaceAll("_"," ").toLowerCase()))), [amenitySelectedLabels]);
  const floodSelectedRawSet   = useMemo(() => new Set(floodSelectedLabels.map((s) => strip_count_suffix(s.replaceAll("_"," ").toLowerCase()))), [floodSelectedLabels]);

  const [q, setQ] = useState("");

  // Pending road filter states (modified by UI, applied on button click)
  const [pendingPlanningSelected, setPendingPlanningSelected] = useState([]);
  const [pendingRoadTypesSelected, setPendingRoadTypesSelected] = useState([]);
  const [pendingQ, setPendingQ] = useState("");

  /* ===== advanced filters ===== */
  // Active filter states (used for actual filtering)
  const [amenityCountMin, setAmenityCountMin] = useState("");
  const [amenityCountMax, setAmenityCountMax] = useState("");
  const [floodCountMin, setFloodCountMin] = useState("");
  const [floodCountMax, setFloodCountMax] = useState("");
  const [betweennessMin, setBetweennessMin] = useState("");
  const [betweennessMax, setBetweennessMax] = useState("");
  const [closenessMin, setClosenessMin] = useState("");
  const [closenessMax, setClosenessMax] = useState("");
  const [importanceMin, setImportanceMin] = useState("");
  const [importanceMax, setImportanceMax] = useState("");
  const [slaCategories, setSlaCategories] = useState([]); // Array of selected SLA categories

  // Pending filter states (modified by UI, applied on button click)
  const [pendingAmenityCountMin, setPendingAmenityCountMin] = useState("");
  const [pendingAmenityCountMax, setPendingAmenityCountMax] = useState("");
  const [pendingFloodCountMin, setPendingFloodCountMin] = useState("");
  const [pendingFloodCountMax, setPendingFloodCountMax] = useState("");
  const [pendingBetweennessMin, setPendingBetweennessMin] = useState("");
  const [pendingBetweennessMax, setPendingBetweennessMax] = useState("");
  const [pendingClosenessMin, setPendingClosenessMin] = useState("");
  const [pendingClosenessMax, setPendingClosenessMax] = useState("");
  const [pendingImportanceMin, setPendingImportanceMin] = useState("");
  const [pendingImportanceMax, setPendingImportanceMax] = useState("");
  const [pendingSlaCategories, setPendingSlaCategories] = useState([]);

  // Check if there are unapplied filter changes
  const hasUnappliedFilterChanges = useMemo(() => {
    return (
      pendingAmenityCountMin !== amenityCountMin ||
      pendingAmenityCountMax !== amenityCountMax ||
      pendingFloodCountMin !== floodCountMin ||
      pendingFloodCountMax !== floodCountMax ||
      pendingBetweennessMin !== betweennessMin ||
      pendingBetweennessMax !== betweennessMax ||
      pendingClosenessMin !== closenessMin ||
      pendingClosenessMax !== closenessMax ||
      pendingImportanceMin !== importanceMin ||
      pendingImportanceMax !== importanceMax ||
      JSON.stringify(pendingSlaCategories.sort()) !== JSON.stringify(slaCategories.sort()) ||
      JSON.stringify(pendingPlanningSelected.sort()) !== JSON.stringify(planningSelected.sort()) ||
      JSON.stringify(pendingRoadTypesSelected.sort()) !== JSON.stringify(roadTypesSelected.sort()) ||
      pendingQ !== q
    );
  }, [
    pendingAmenityCountMin, amenityCountMin, pendingAmenityCountMax, amenityCountMax,
    pendingFloodCountMin, floodCountMin, pendingFloodCountMax, floodCountMax,
    pendingBetweennessMin, betweennessMin, pendingBetweennessMax, betweennessMax,
    pendingClosenessMin, closenessMin, pendingClosenessMax, closenessMax,
    pendingImportanceMin, importanceMin, pendingImportanceMax, importanceMax,
    pendingSlaCategories, slaCategories,
    pendingPlanningSelected, planningSelected, pendingRoadTypesSelected, roadTypesSelected,
    pendingQ, q
  ]);

  // Apply pending filters to active filters
  const applyTableFilters = useCallback(() => {
    // Apply road filters
    setPlanningSelected(pendingPlanningSelected);
    setRoadTypesSelected(pendingRoadTypesSelected);
    setQ(pendingQ);
    // Apply table filters
    setAmenityCountMin(pendingAmenityCountMin);
    setAmenityCountMax(pendingAmenityCountMax);
    setFloodCountMin(pendingFloodCountMin);
    setFloodCountMax(pendingFloodCountMax);
    setBetweennessMin(pendingBetweennessMin);
    setBetweennessMax(pendingBetweennessMax);
    setClosenessMin(pendingClosenessMin);
    setClosenessMax(pendingClosenessMax);
    setImportanceMin(pendingImportanceMin);
    setImportanceMax(pendingImportanceMax);
    setSlaCategories(pendingSlaCategories);
  }, [
    pendingPlanningSelected, pendingRoadTypesSelected, pendingQ,
    pendingAmenityCountMin, pendingAmenityCountMax,
    pendingFloodCountMin, pendingFloodCountMax,
    pendingBetweennessMin, pendingBetweennessMax,
    pendingClosenessMin, pendingClosenessMax,
    pendingImportanceMin, pendingImportanceMax,
    pendingSlaCategories
  ]);

  // Clear all filters (both pending and active)
  const clearAllTableFilters = useCallback(() => {
    // Clear road filters
    setPlanningSelected([]);
    setRoadTypesSelected([]);
    setQ("");
    setPendingPlanningSelected([]);
    setPendingRoadTypesSelected([]);
    setPendingQ("");
    // Clear table filters
    setAmenityCountMin("");
    setAmenityCountMax("");
    setFloodCountMin("");
    setFloodCountMax("");
    setBetweennessMin("");
    setBetweennessMax("");
    setClosenessMin("");
    setClosenessMax("");
    setImportanceMin("");
    setImportanceMax("");
    setSlaCategories([]);
    setPendingAmenityCountMin("");
    setPendingAmenityCountMax("");
    setPendingFloodCountMin("");
    setPendingFloodCountMax("");
    setPendingBetweennessMin("");
    setPendingBetweennessMax("");
    setPendingClosenessMin("");
    setPendingClosenessMax("");
    setPendingImportanceMin("");
    setPendingImportanceMax("");
    setPendingSlaCategories([]);
  }, []);

  // SLA configuration
  const [useSLAMapping, setUseSLAMapping] = useState(true);
  const [slaTop1Year, setSlaTop1Year] = useState(10); // Top 10%
  const [slaNext3Year, setSlaNext3Year] = useState(30); // Next 30%

  // Show loading indicator when weights change
  useEffect(() => {
    setIsCalculating(true);
    const timer = setTimeout(() => setIsCalculating(false), 300);
    return () => clearTimeout(timer);
  }, [amenityWeights, floodWeights, w_betweenness, w_closeness, w_amenity, w_flood, useCompBetweenness, useCompCloseness, useCompAmenity, useCompFlood]);

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
    const hasRT = roadTypesSelected.length > 0;
    const paSet = new Set(planningSelected.map(String));
    const rtSet = new Set(roadTypesSelected.map(String));

    return (features || []).filter((f) => {
      const p = f?.properties;
      if (!p) return false;

      if (hasPA && p.PLN_AREA_N && !paSet.has(String(p.PLN_AREA_N))) return false;
      if (hasRT) {
        const rt = String(get_road_type(p));
        if (!rtSet.has(rt)) return false;
      }

      if (!term) return true;
      const hay = [p.RN_ID, p.name, p.PLN_AREA_N].map((x) => String(x || "").toLowerCase()).join("|");
      return hay.includes(term);
    });
  }, [features, planningSelected, roadTypesSelected, q]);

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
      // Only count enabled categories/types
      const amenTot = Array.from(amenRow.entries())
        .filter(([cat]) => amenityEnabled[cat])
        .reduce((a, [_, v]) => a + v, 0);
      const floodTot = Array.from(floodRow.entries())
        .filter(([type]) => floodEnabled[type])
        .reduce((a, [_, v]) => a + v, 0);

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

    // Add Maintenance Category labels after sorting
    return arr.map((f, index) => {
      const importance = f.properties.importance;
      const percentile = (index / arr.length) * 100;

      let slaCategory = "5 year";
      if (percentile < slaTop1Year) {
        slaCategory = "1 year";
      } else if (percentile < slaTop1Year + slaNext3Year) {
        slaCategory = "3 year";
      }

      return {
        ...f,
        properties: {
          ...f.properties,
          sla_priority: slaCategory,
        }
      };
    });
  }, [scored, slaTop1Year, slaNext3Year]);

  // Apply advanced filters
  const filteredSorted = useMemo(() => {
    return sortedByImportance.filter((f) => {
      const p = f.properties;

      // Amenity count filter
      if (amenityCountMin !== "" && (p.amenity_count_total || 0) < parseFloat(amenityCountMin)) return false;
      if (amenityCountMax !== "" && (p.amenity_count_total || 0) > parseFloat(amenityCountMax)) return false;

      // Flood count filter
      if (floodCountMin !== "" && (p.flood_count_total || 0) < parseFloat(floodCountMin)) return false;
      if (floodCountMax !== "" && (p.flood_count_total || 0) > parseFloat(floodCountMax)) return false;

      // Betweenness filter
      if (betweennessMin !== "" && (p.betweenness_norm || 0) < parseFloat(betweennessMin)) return false;
      if (betweennessMax !== "" && (p.betweenness_norm || 0) > parseFloat(betweennessMax)) return false;

      // Closeness filter
      if (closenessMin !== "" && (p.closeness_norm || 0) < parseFloat(closenessMin)) return false;
      if (closenessMax !== "" && (p.closeness_norm || 0) > parseFloat(closenessMax)) return false;

      // Importance filter
      if (importanceMin !== "" && (p.importance || 0) < parseFloat(importanceMin)) return false;
      if (importanceMax !== "" && (p.importance || 0) > parseFloat(importanceMax)) return false;

      // SLA category filter
      if (slaCategories.length > 0 && !slaCategories.includes(p.sla_priority)) return false;

      return true;
    });
  }, [sortedByImportance, amenityCountMin, amenityCountMax, floodCountMin, floodCountMax,
      betweennessMin, betweennessMax, closenessMin, closenessMax, importanceMin, importanceMax, slaCategories]);

  // Calculate dynamic max values for sliders
  const maxValues = useMemo(() => {
    if (!sortedByImportance.length) return { amenity: 100, flood: 100, betweenness: 1, closeness: 1, importance: 100 };
    return {
      amenity: Math.max(...sortedByImportance.map(r => r.properties.amenity_count_total || 0)),
      flood: Math.max(...sortedByImportance.map(r => r.properties.flood_count_total || 0)),
      betweenness: Math.max(...sortedByImportance.map(r => r.properties.betweenness_norm || 0)),
      closeness: Math.max(...sortedByImportance.map(r => r.properties.closeness_norm || 0)),
      importance: Math.max(...sortedByImportance.map(r => r.properties.importance || 0)),
    };
  }, [sortedByImportance]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE)), [filteredSorted.length]);

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

  const mapData = useMemo(() => {
    // Always create a new object to ensure React detects changes
    return { type: "FeatureCollection", features: [...filteredSorted] };
  }, [filteredSorted]);

   // Selected road state
  const [selectedRoadId, setSelectedRoadId] = useState(null);
  const [mapInstance, setMapInstance] = useState(null);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const mapSectionRef = useRef(null);
  const detailsPanelRef = useRef(null);

  // Handle road selection with scroll to details panel
  const handleRoadSelect = useCallback((roadId) => {
    setSelectedRoadId(roadId);
    setSelectedMarker(null); // Clear marker when selecting a new road
    // Scroll to details panel smoothly
    if (detailsPanelRef.current) {
      detailsPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Handle marker selection from accordion
  const handleMarkerClick = useCallback((marker) => {
    setSelectedMarker(marker);
  }, []);

  
  // Calculate SLA tier for a road based on percentile
  const getSLATier = useCallback((importance) => {
    if (!useSLAMapping) return null;

    const index = sortedByImportance.findIndex(f => f.properties.importance === importance);
    const percentile = (index / sortedByImportance.length) * 100;

    if (percentile < slaTop1Year) return 1;
    if (percentile < slaTop1Year + slaNext3Year) return 3;
    return 5;
  }, [useSLAMapping, slaTop1Year, slaNext3Year, sortedByImportance]);

  // Convert maintenance tier to category label
  const getSLACategory = useCallback((importance) => {
    const tier = getSLATier(importance);
    if (tier === 1) return "1 year";
    if (tier === 3) return "3 year";
    if (tier === 5) return "5 year";
    return "—";
  }, [getSLATier]);


  
  // Get selected road details
  const selectedRoad = useMemo(() => {
    if (!selectedRoadId) return null;
    return sortedByImportance.find(f => f.properties.RN_ID === selectedRoadId);
  }, [selectedRoadId, sortedByImportance]);

  // Get amenity items for selected road
  const selectedAmenityItems = useMemo(() => {
    if (!selectedRoadId || !amenityFC) return [];
    const byId = categoryLookup?.by_id || {};
    return (amenityFC.features || [])
      .filter(a => a?.properties?.rn_id === selectedRoadId)
      .map(a => {
        const id = get_amenity_category_id(a.properties);
        const fromLookup = (id != null && byId[id]?.amenity_category) ? byId[id].amenity_category : null;
        const category = fromLookup || String(get_amenity_category(a.properties));
        return {
          ...a,
          category,
          name: a.properties?.amenity_name || a.properties?.name || a.properties?.amenity || 'Unknown',
        };
      })
      .filter(a => amenityEnabled[a.category]); // Only enabled categories
  }, [selectedRoadId, amenityFC, categoryLookup, amenityEnabled]);

  // Get flood items for selected road
  const selectedFloodItems = useMemo(() => {
    if (!selectedRoadId || !floodsFC) return [];
    return (floodsFC.features || [])
      .filter(f => f?.properties?.start_rn_id === selectedRoadId)
      .map(f => {
        const type = String(get_flood_type(f.properties));
        return {
          ...f,
          type,
          name: f.properties?.location || `${type} event`,
          date: f.properties?.event_date || f.properties?.date,
        };
      })
      .filter(f => floodEnabled[f.type]); // Only enabled types
  }, [selectedRoadId, floodsFC, floodEnabled]);

  // Get road rank (1-based index in sorted list)
  const selectedRoadRank = useMemo(() => {
    if (!selectedRoadId) return null;
    const index = sortedByImportance.findIndex(f => f.properties.RN_ID === selectedRoadId);
    return index >= 0 ? index + 1 : null;
  }, [selectedRoadId, sortedByImportance]);


  useEffect(() => {
    setCurrentPage(1);
  }, [
    planningSelected.join("|"),
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
    <div className="mx-auto flex w-full flex-col gap-5 relative">
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
        {/* Road Centrality Configuration - Unified Parent Accordion */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="road-centrality-config" className={`overflow-hidden rounded-xl border shadow-sm ${hasUnappliedWeightChanges ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700' : 'bg-card'}`}>
            <AccordionTrigger className="px-4 py-3 text-lg font-bold">
              <div className="flex items-center gap-2 w-full">
                <span>Road Centrality Configuration</span>
                {hasUnappliedWeightChanges && (
                  <span className="px-2 py-1 rounded-md text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700">
                    • Unapplied Changes
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              {/* each subsection is its own accordion */}
              <Accordion type="multiple" className="space-y-3">
          {/* Amenity Categories */}
          <AccordionItem value="amenities" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
              Amenity Categories
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Per-Category Toggles & Multipliers</CardTitle>
                  <CardDescription>
                    Example: if a road has 5 amenities (e.g., 2 hospitals, 3 schools), the weighted total is (2×hospital weight) + (3×school weight). Disabled categories contribute 0.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
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

                  {/* Amenity Weight Presets */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Weight Presets</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {Object.entries(AMENITY_PRESETS).map(([key, preset]) => {
                        const isActive = isAmenityPresetActive(key);
                        return (
                          <button
                            key={key}
                            onClick={() => applyAmenityPreset(key)}
                            className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                              isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-background'
                            }`}
                          >
                            <div className="font-semibold text-sm mb-1">
                              {preset.name}
                              {isActive && <span className="ml-2 text-xs text-primary">✓</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{preset.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <ScrollArea className="max-h-[400px]">
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 pr-4">
                    {amenityCategoryKeys.map((cat) => {
                      const val = pendingAmenityWeights[cat] ?? 1.0;
                      const enabled = !!pendingAmenityEnabled[cat];
                      return (
                        <div key={cat} className="space-y-1.5 rounded-lg bg-muted/30 p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(cat)}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`amen-${cat}`}
                                checked={enabled}
                                onCheckedChange={(ck) => setPendingAmenityEnabled((prev) => ({ ...prev, [cat]: !!ck }))}
                              />
                              <Label htmlFor={`amen-${cat}`} className="text-xs cursor-pointer">enable</Label>
                            </div>

                            <NumberInput
                              value={val}
                              onValueChange={(numVal) => {
                                if (numVal !== undefined) {
                                  setPendingAmenityWeights((prev) => ({ ...prev, [cat]: numVal }));
                                }
                              }}
                              min={1}
                              max={10}
                              stepper={0.1}
                              decimalScale={1}
                              fixedDecimalScale={true}
                              disabled={!enabled}
                              hideSteppers={true}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Flood Event Types */}
          <AccordionItem value="floods" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
              Flood Event Types
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
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
                <CardContent className="space-y-3">
                  {/* Flood Weight Presets */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Weight Presets</Label>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {Object.entries(FLOOD_PRESETS).map(([key, preset]) => {
                        const isActive = isFloodPresetActive(key);
                        return (
                          <button
                            key={key}
                            onClick={() => applyFloodPreset(key)}
                            className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                              isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-background'
                            }`}
                          >
                            <div className="font-semibold text-sm mb-1">
                              {preset.name}
                              {isActive && <span className="ml-2 text-xs text-primary">✓</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{preset.description}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <ScrollArea className="max-h-[400px]">
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 pr-4">
                    {floodTypeKeys.map((type) => {
                      const val = pendingFloodWeights[type] ?? 1.0;
                      const enabled = !!pendingFloodEnabled[type];
                      return (
                        <div key={type} className="space-y-1.5 rounded-lg bg-muted/30 p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{to_title_case(type)}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                id={`flood-${type}`}
                                checked={enabled}
                                onCheckedChange={(ck) => setPendingFloodEnabled((prev) => ({ ...prev, [type]: !!ck }))}
                              />
                              <Label htmlFor={`flood-${type}`} className="text-xs cursor-pointer">enable</Label>
                            </div>

                            <NumberInput
                              value={val}
                              onValueChange={(numVal) => {
                                if (numVal !== undefined) {
                                  setPendingFloodWeights((prev) => ({ ...prev, [type]: numVal }));
                                }
                              }}
                              min={1}
                              max={10}
                              stepper={0.1}
                              decimalScale={1}
                              fixedDecimalScale={true}
                              disabled={!enabled}
                              hideSteppers={true}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Component Weights */}
          <AccordionItem value="weights" className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
              Component Weights
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2 space-y-4">
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
                    {Object.entries(PRESETS).map(([key, preset]) => {
                      const isActive = isMainPresetActive(key);
                      return (
                        <button
                          key={key}
                          onClick={() => applyPreset(key)}
                          className={`rounded-lg p-4 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                            isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-background'
                          }`}
                        >
                          <div className="font-semibold text-sm mb-1">
                            {preset.name}
                            {isActive && <span className="ml-2 text-xs text-primary">✓ Active</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{preset.description}</div>
                          <div className="mt-2 text-[10px] font-mono text-muted-foreground">
                            B:{preset.weights.betweenness} C:{preset.weights.closeness} A:{preset.weights.amenity} F:{preset.weights.flood}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
              <Card className="border bg-background/80 shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Adjust Component Contribution</CardTitle>
                  <CardDescription>Adjust sliders, then click "Apply Changes" to recalculate importance scores.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-6 md:grid-cols-2">
                    {/* betweenness */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Betweenness Centrality</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch id="comp-bet" checked={pendingUseCompBetweenness} onCheckedChange={setPendingUseCompBetweenness} />
                            <Label htmlFor="comp-bet" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{pending_w_betweenness.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[pending_w_betweenness * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_pending_w_betweenness((v[0] || 0) / 100)}
                          disabled={!pendingUseCompBetweenness}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(pending_w_betweenness * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_pending_w_betweenness(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!pendingUseCompBetweenness}
                          hideSteppers={true}
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
                            <Switch id="comp-clo" checked={pendingUseCompCloseness} onCheckedChange={setPendingUseCompCloseness} />
                            <Label htmlFor="comp-clo" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{pending_w_closeness.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[pending_w_closeness * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_pending_w_closeness((v[0] || 0) / 100)}
                          disabled={!pendingUseCompCloseness}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(pending_w_closeness * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_pending_w_closeness(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!pendingUseCompCloseness}
                          hideSteppers={true}
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
                            <Switch id="comp-amen" checked={pendingUseCompAmenity} onCheckedChange={setPendingUseCompAmenity} />
                            <Label htmlFor="comp-amen" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{pending_w_amenity.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[pending_w_amenity * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_pending_w_amenity((v[0] || 0) / 100)}
                          disabled={!pendingUseCompAmenity}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(pending_w_amenity * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_pending_w_amenity(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!pendingUseCompAmenity}
                          hideSteppers={true}
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
                            <Switch id="comp-flood" checked={pendingUseCompFlood} onCheckedChange={setPendingUseCompFlood} />
                            <Label htmlFor="comp-flood" className="text-xs cursor-pointer">enable</Label>
                          </div>
                          <span className="text-sm font-semibold">{pending_w_flood.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Slider
                          value={[pending_w_flood * 100]}
                          min={0} max={100} step={1}
                          onValueChange={(v) => set_pending_w_flood((v[0] || 0) / 100)}
                          disabled={!pendingUseCompFlood}
                          className="flex-1"
                        />
                        <NumberInput
                          value={Math.round(pending_w_flood * 100)}
                          onValueChange={(numVal) => {
                            if (numVal !== undefined) {
                              set_pending_w_flood(numVal / 100);
                            }
                          }}
                          min={0}
                          max={100}
                          stepper={1}
                          decimalScale={0}
                          disabled={!pendingUseCompFlood}
                          hideSteppers={true}
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
                </CardContent>
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* Maintenance Category Configuration */}
<AccordionItem value="sla" className="overflow-hidden rounded-xl border bg-card shadow-sm">
  <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
    Maintenance Category Configuration
  </AccordionTrigger>
  <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
    <Card className="border bg-background/80 shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Configure Maintenance Tiers by Percentile</CardTitle>
        <CardDescription>
          Automatically assign maintenance priorities based on importance percentiles.
          Roads in the top X% get 1 year, next Y% get 3 year, remainder get 5 year.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Percentile Thresholds */}
        <div className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>1 year (Top Percentile)</Label>
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
              <Label>3 year (Next Percentile)</Label>
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
            <Label className="text-sm">5 year (Remainder)</Label>
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
                <span>1 year:</span>
                <strong>{Math.round(sortedByImportance.length * slaTop1Year / 100)} roads</strong>
              </div>
              <div className="flex justify-between">
                <span>3 year:</span>
                <strong>{Math.round(sortedByImportance.length * slaNext3Year / 100)} roads</strong>
              </div>
              <div className="flex justify-between">
                <span>5 year:</span>
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

              {/* Apply Changes and Reset All buttons */}
              <div className="flex justify-between items-center pt-4 mt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPlanningSelected([]); setRoadTypesSelected([]);
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
                <Button
                  onClick={applyWeightChanges}
                  disabled={!hasUnappliedWeightChanges}
                  size="default"
                  className={hasUnappliedWeightChanges ? "bg-primary" : ""}
                >
                  Apply Changes
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </header>

      {/* Road Details Panel (always visible) */}
      <div ref={detailsPanelRef}>
        <RoadDetailsPanel
          road={selectedRoad}
          onClose={() => setSelectedRoadId(null)}
          amenityCounts={selectedRoad ? amenityCategoryCountByRoad.get(selectedRoad.properties.RN_ID) : null}
          floodCounts={selectedRoad ? floodTypeCountByRoad.get(selectedRoad.properties.RN_ID) : null}
          totalRoads={sortedByImportance.length}
          roadRank={selectedRoadRank}
          getSLACategory={getSLACategory}
          amenityEnabled={amenityEnabled}
          floodEnabled={floodEnabled}
          allRoads={sortedByImportance}
          amenityItems={selectedAmenityItems}
          floodItems={selectedFloodItems}
          onMarkerClick={handleMarkerClick}
        />
      </div>
        {/* Right: Map */}
        <div ref={mapSectionRef}>
          <CentralityMap
            data={mapData}
            selectedRoadId={selectedRoadId}
            onMapLoad={setMapInstance}
            onRoadClick={handleRoadSelect}
            selectedMarker={selectedMarker}
          />
        </div>
      <section className="rounded-3xl border bg-card shadow-sm p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">All Segments</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Complete list of road segments with sortable columns and export capability
          </p>
        </div>

        {/* Filters Accordion */}
        <Accordion type="single" collapsible className="mb-4">
          <AccordionItem value="filters" className="border rounded-lg bg-background">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">Filters</span>
                <span className="text-xs text-muted-foreground">
                  ({[amenityCountMin, amenityCountMax, floodCountMin, floodCountMax, betweennessMin, betweennessMax, closenessMin, closenessMax, importanceMin, importanceMax].filter(v => v !== "").length > 0 || slaCategories.length > 0 || planningSelected.length > 0 || roadTypesSelected.length > 0 || q ? 'Active' : 'None'})
                </span>
                {hasUnappliedFilterChanges && (
                  <span className="px-2 py-1 rounded-md text-sm font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700">
                    • Unapplied Changes
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-2">
              <p className="text-xs text-muted-foreground mb-3">
                Adjust filters below, then click "Apply Filters" to update the table and map. Note: Filters hide roads but don't recalculate centrality metrics.
              </p>
              <div className="space-y-3">
                {/* Road Filters */}
                <div className="rounded-lg border bg-muted/20 p-3">
                  <Label className="text-sm font-medium mb-3 block">Road Filters</Label>
                  <div className="grid gap-3 md:grid-cols-3">
                    <MultiSelectCombobox
                      label="Planning Area"
                      options={planningOptions}
                      selected={pendingPlanningSelected}
                      onChange={setPendingPlanningSelected}
                      placeholder="All areas"
                      searchPlaceholder="Search areas…"
                      popoverWidthClass="w-[300px]"
                    />

                    <MultiSelectCombobox
                      label="Road Type"
                      options={roadTypeOptions}
                      selected={pendingRoadTypesSelected}
                      onChange={setPendingRoadTypesSelected}
                      placeholder="All types"
                      searchPlaceholder="Search types…"
                      popoverWidthClass="w-[300px]"
                    />

                    <div className="space-y-1.5">
                      <Label htmlFor="road-search">Search</Label>
                      <Input
                        id="road-search"
                        value={pendingQ}
                        onChange={(e) => setPendingQ(e.target.value)}
                        placeholder="Name, RN ID, area…"
                      />
                    </div>
                  </div>
                </div>

                {/* Table Filters */}
                <div className="rounded-lg border bg-muted/20 p-3">
                  <Label className="text-sm font-medium mb-3 block">Value Filters</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Amenity Count */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Amenity Count</Label>
                      <span className="text-xs text-muted-foreground">
                        {pendingAmenityCountMin || 0} - {pendingAmenityCountMax || maxValues.amenity}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={maxValues.amenity}
                      step={1}
                      value={[
                        pendingAmenityCountMin !== "" ? parseFloat(pendingAmenityCountMin) : 0,
                        pendingAmenityCountMax !== "" ? parseFloat(pendingAmenityCountMax) : maxValues.amenity
                      ]}
                      onValueChange={([min, max]) => {
                        setPendingAmenityCountMin(min.toString());
                        setPendingAmenityCountMax(max.toString());
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Flood Count */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Flood Count</Label>
                      <span className="text-xs text-muted-foreground">
                        {pendingFloodCountMin || 0} - {pendingFloodCountMax || maxValues.flood}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={maxValues.flood}
                      step={1}
                      value={[
                        pendingFloodCountMin !== "" ? parseFloat(pendingFloodCountMin) : 0,
                        pendingFloodCountMax !== "" ? parseFloat(pendingFloodCountMax) : maxValues.flood
                      ]}
                      onValueChange={([min, max]) => {
                        setPendingFloodCountMin(min.toString());
                        setPendingFloodCountMax(max.toString());
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Betweenness */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Betweenness (Normalized)</Label>
                      <span className="text-xs text-muted-foreground">
                        {pendingBetweennessMin || "0"} - {pendingBetweennessMax || maxValues.betweenness.toFixed(4)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={maxValues.betweenness}
                      step={0.0001}
                      value={[
                        pendingBetweennessMin !== "" ? parseFloat(pendingBetweennessMin) : 0,
                        pendingBetweennessMax !== "" ? parseFloat(pendingBetweennessMax) : maxValues.betweenness
                      ]}
                      onValueChange={([min, max]) => {
                        setPendingBetweennessMin(min.toFixed(4));
                        setPendingBetweennessMax(max.toFixed(4));
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Closeness */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Closeness (Normalized)</Label>
                      <span className="text-xs text-muted-foreground">
                        {pendingClosenessMin || "0"} - {pendingClosenessMax || maxValues.closeness.toFixed(4)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={maxValues.closeness}
                      step={0.0001}
                      value={[
                        pendingClosenessMin !== "" ? parseFloat(pendingClosenessMin) : 0,
                        pendingClosenessMax !== "" ? parseFloat(pendingClosenessMax) : maxValues.closeness
                      ]}
                      onValueChange={([min, max]) => {
                        setPendingClosenessMin(min.toFixed(4));
                        setPendingClosenessMax(max.toFixed(4));
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Importance */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">Importance Score</Label>
                      <span className="text-xs text-muted-foreground">
                        {pendingImportanceMin || 0} - {pendingImportanceMax || maxValues.importance.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={maxValues.importance}
                      step={0.01}
                      value={[
                        pendingImportanceMin !== "" ? parseFloat(pendingImportanceMin) : 0,
                        pendingImportanceMax !== "" ? parseFloat(pendingImportanceMax) : maxValues.importance
                      ]}
                      onValueChange={([min, max]) => {
                        setPendingImportanceMin(min.toFixed(2));
                        setPendingImportanceMax(max.toFixed(2));
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Maintenance Category */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Maintenance Category</Label>
                    <MultiSelectCombobox
                      label=""
                      options={["1 year", "3 year", "5 year"]}
                      selected={pendingSlaCategories}
                      onChange={setPendingSlaCategories}
                      placeholder="All categories"
                      searchPlaceholder="Search categories…"
                    />
                  </div>
                </div>
                </div>

                {/* Action buttons */}
                <div className="flex justify-between items-center pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearAllTableFilters}
                  >
                    Clear All Filters
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={applyTableFilters}
                    disabled={!hasUnappliedFilterChanges}
                    className={hasUnappliedFilterChanges ? "bg-primary" : ""}
                  >
                    Apply Filters
                  </Button>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <CentralityTable
          rows={filteredSorted}
          totalRows={filteredSorted.length}
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          allColumnDefs={allColumnDefs}
          onRowClick={handleRoadSelect}
          selectedRoadId={selectedRoadId}
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
