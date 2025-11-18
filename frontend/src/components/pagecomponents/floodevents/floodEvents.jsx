"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useMapData } from "@/context/mapDataContext";

/* shadcn ui */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberInput } from "@/components/numberInput";
import {
  FLOOD_TYPE_PRESETS,
  DATE_RANGE_PRESETS,
  SEVERITY_LEVELS,
  to_title_case,
  format_date,
  get_flood_type,
  get_planning_area,
  get_subzone,
  findFeaturesInBands,
} from "./shared";
import { FloodEventsMap } from "./floodEventsMap";
import { FloodDetailsPanel } from "./floodDetailsPanel";
import { FloodListPanel } from "./floodListPanel";

export default function FloodEvents() {
  const {
    floods_fc_enriched: floodsFC,
    road_fc_enriched: roadFC,
    amenity_fc_raw: amenityFC,
    planning_area_fc: planningAreaFC,
  } = useMapData();

  const [isCalculating, setIsCalculating] = useState(false);

  /* ===== counts ===== */
  const floodTypeCounts = useMemo(() => {
    const m = Object.create(null);
    for (const f of floodsFC?.features || []) {
      const t = String(get_flood_type(f.properties));
      m[t] = (m[t] || 0) + 1;
    }
    return m;
  }, [floodsFC]);

  const planningAreaCounts = useMemo(() => {
    const m = Object.create(null);
    for (const f of floodsFC?.features || []) {
      const pa = String(get_planning_area(f.properties));
      m[pa] = (m[pa] || 0) + 1;
    }
    return m;
  }, [floodsFC]);

  /* ===== flood type configuration ===== */
  const floodTypeKeys = useMemo(
    () => Object.keys(floodTypeCounts).sort((a, b) => a.localeCompare(b)),
    [floodTypeCounts]
  );

  const planningAreaKeys = useMemo(
    () => Object.keys(planningAreaCounts).sort((a, b) => a.localeCompare(b)),
    [planningAreaCounts]
  );

  const defaultFloodPreset = useMemo(() => {
    if (FLOOD_TYPE_PRESETS?.balanced) return FLOOD_TYPE_PRESETS.balanced;
    const firstKey = Object.keys(FLOOD_TYPE_PRESETS)[0];
    return FLOOD_TYPE_PRESETS[firstKey];
  }, []);

  // Default flood type enabled state and multipliers
  const default_flood_enabled = useMemo(() => {
    const e = {};
    for (const k of floodTypeKeys) {
      if (defaultFloodPreset?.types && Object.prototype.hasOwnProperty.call(defaultFloodPreset.types, k)) {
        e[k] = defaultFloodPreset.types[k];
      } else {
        e[k] = true;
      }
    }
    return e;
  }, [floodTypeKeys, defaultFloodPreset]);

  const default_flood_weights = useMemo(() => {
    const w = {};
    for (const k of floodTypeKeys) {
      if (defaultFloodPreset?.weights && Object.prototype.hasOwnProperty.call(defaultFloodPreset.weights, k)) {
        w[k] = defaultFloodPreset.weights[k];
      } else {
        w[k] = 1.0;
      }
    }
    return w;
  }, [floodTypeKeys, defaultFloodPreset]);

  // Active states (used for filtering)
  const [floodTypesEnabled, setFloodTypesEnabled] = useState(default_flood_enabled);
  const [floodTypeWeights, setFloodTypeWeights] = useState(default_flood_weights);

  // Map visualization state
  const [vizMode, setVizMode] = useState("markers");
  const [colorMetric, setColorMetric] = useState("type");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedPlanningAreas, setSelectedPlanningAreas] = useState([]);
  const [selectedSeverities, setSelectedSeverities] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Pending states (modified by UI, applied on button click)
  const [pendingFloodTypesEnabled, setPendingFloodTypesEnabled] = useState(default_flood_enabled);
  const [pendingFloodTypeWeights, setPendingFloodTypeWeights] = useState(default_flood_weights);
  const [pendingDateFrom, setPendingDateFrom] = useState("");
  const [pendingDateTo, setPendingDateTo] = useState("");
  const [pendingSelectedPlanningAreas, setPendingSelectedPlanningAreas] = useState([]);
  const [pendingSelectedSeverities, setPendingSelectedSeverities] = useState([]);
  const [pendingSearchQuery, setPendingSearchQuery] = useState("");

  /* ===== preset handlers ===== */
  const applyFloodTypePreset = useCallback((presetKey) => {
    const preset = FLOOD_TYPE_PRESETS[presetKey];
    if (!preset) return;

    // Apply weights to pending states
    setPendingFloodTypeWeights((prev) => {
      const updated = { ...prev };
      Object.keys(preset.weights).forEach(type => {
        updated[type] = preset.weights[type];
      });
      return updated;
    });

    // Apply toggles to pending states
    setPendingFloodTypesEnabled((prev) => {
      const updated = { ...prev };
      Object.keys(preset.types).forEach(type => {
        updated[type] = preset.types[type];
      });
      return updated;
    });
  }, []);

  const applyDateRangePreset = useCallback((presetKey) => {
    const preset = DATE_RANGE_PRESETS[presetKey];
    if (!preset) return;

    const dates = preset.getDates();
    setPendingDateFrom(dates.from);
    setPendingDateTo(dates.to);
  }, []);

  // Check if a flood type preset is currently active (based on pending values)
  const isFloodTypePresetActive = useCallback((presetKey) => {
    const preset = FLOOD_TYPE_PRESETS[presetKey];
    if (!preset) return false;

    // Check if weights match
    const weightsMatch = Object.keys(preset.weights).every(type =>
      Math.abs((pendingFloodTypeWeights[type] || 0) - preset.weights[type]) < 0.01
    );

    // Check if toggles match
    const togglesMatch = Object.keys(preset.types).every(type =>
      pendingFloodTypesEnabled[type] === preset.types[type]
    );

    return weightsMatch && togglesMatch;
  }, [pendingFloodTypeWeights, pendingFloodTypesEnabled]);

  // Check if a date range preset is currently active (based on pending values)
  const isDateRangePresetActive = useCallback((presetKey) => {
    const preset = DATE_RANGE_PRESETS[presetKey];
    if (!preset) return false;

    const dates = preset.getDates();
    return pendingDateFrom === dates.from && pendingDateTo === dates.to;
  }, [pendingDateFrom, pendingDateTo]);

  // Check if there are unapplied filter changes
  const hasUnappliedFilterChanges = useMemo(() => {
    // Check flood type toggles
    const floodTypeChanges = Object.keys(pendingFloodTypesEnabled).some(type =>
      pendingFloodTypesEnabled[type] !== floodTypesEnabled[type]
    );

    // Check flood type weights
    const weightChanges = Object.keys(pendingFloodTypeWeights).some(type =>
      Math.abs((pendingFloodTypeWeights[type] || 0) - (floodTypeWeights[type] || 0)) > 0.001
    );

    // Check date range
    const dateChanges = pendingDateFrom !== dateFrom || pendingDateTo !== dateTo;

    // Check planning areas
    const planningAreaChanges =
      JSON.stringify([...pendingSelectedPlanningAreas].sort()) !== JSON.stringify([...selectedPlanningAreas].sort());

    // Check severities
    const severityChanges =
      JSON.stringify([...pendingSelectedSeverities].sort()) !== JSON.stringify([...selectedSeverities].sort());

    // Check search query
    const searchChanges = pendingSearchQuery !== searchQuery;

    return floodTypeChanges || weightChanges || dateChanges || planningAreaChanges || severityChanges || searchChanges;
  }, [
    pendingFloodTypesEnabled, floodTypesEnabled,
    pendingFloodTypeWeights, floodTypeWeights,
    pendingDateFrom, dateFrom, pendingDateTo, dateTo,
    pendingSelectedPlanningAreas, selectedPlanningAreas,
    pendingSelectedSeverities, selectedSeverities,
    pendingSearchQuery, searchQuery
  ]);

  // Apply pending filters to active filters
  const applyFilters = useCallback(() => {
    setFloodTypesEnabled({ ...pendingFloodTypesEnabled });
    setFloodTypeWeights({ ...pendingFloodTypeWeights });
    setDateFrom(pendingDateFrom);
    setDateTo(pendingDateTo);
    setSelectedPlanningAreas([...pendingSelectedPlanningAreas]);
    setSelectedSeverities([...pendingSelectedSeverities]);
    setSearchQuery(pendingSearchQuery);
  }, [
    pendingFloodTypesEnabled, pendingFloodTypeWeights, pendingDateFrom, pendingDateTo,
    pendingSelectedPlanningAreas, pendingSelectedSeverities, pendingSearchQuery
  ]);

  // Clear all filters (both pending and active) - Reset to default preset
  const clearAllFilters = useCallback(() => {
    const resetFloodTypes = { ...default_flood_enabled };
    const resetFloodWeights = { ...default_flood_weights };

    setFloodTypesEnabled(resetFloodTypes);
    setFloodTypeWeights(resetFloodWeights);
    setDateFrom("");
    setDateTo("");
    setSelectedPlanningAreas([]);
    setSelectedSeverities([]);
    setSearchQuery("");

    setPendingFloodTypesEnabled(resetFloodTypes);
    setPendingFloodTypeWeights(resetFloodWeights);
    setPendingDateFrom("");
    setPendingDateTo("");
    setPendingSelectedPlanningAreas([]);
    setPendingSelectedSeverities([]);
    setPendingSearchQuery("");
  }, [default_flood_enabled, default_flood_weights]);

  useEffect(() => {
    setIsCalculating(true);
    const timer = setTimeout(() => setIsCalculating(false), 300);
    return () => clearTimeout(timer);
  }, [
    floodTypesEnabled,
    floodTypeWeights,
    dateFrom,
    dateTo,
    selectedPlanningAreas,
    selectedSeverities,
    searchQuery,
  ]);

  /* ===== sync flood types when they change ===== */
  useEffect(() => {
    setFloodTypesEnabled((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of floodTypeKeys) {
        if (!(k in next)) {
          next[k] = default_flood_enabled[k] ?? true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setPendingFloodTypesEnabled((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of floodTypeKeys) {
        if (!(k in next)) {
          next[k] = default_flood_enabled[k] ?? true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setFloodTypeWeights((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of floodTypeKeys) {
        if (!(k in next)) {
          next[k] = default_flood_weights[k] ?? 1.0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setPendingFloodTypeWeights((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of floodTypeKeys) {
        if (!(k in next)) {
          next[k] = default_flood_weights[k] ?? 1.0;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [floodTypeKeys, default_flood_enabled, default_flood_weights]);

  /* ===== filters ===== */
  const features = useMemo(() => floodsFC?.features ?? [], [floodsFC]);

  const filtered = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    const hasPAs = selectedPlanningAreas.length > 0;
    const hasSeverities = selectedSeverities.length > 0;
    const paSet = new Set(selectedPlanningAreas.map(String));
    const sevSet = new Set(selectedSeverities.map(String));

    return (features || []).filter((f) => {
      const p = f?.properties;
      if (!p) return false;

      // Filter by flood type
      const floodType = String(get_flood_type(p));
      if (!floodTypesEnabled[floodType]) return false;

      // Filter by planning area
      if (hasPAs) {
        const pa = String(get_planning_area(p));
        if (!paSet.has(pa)) return false;
      }

      // Filter by severity
      if (hasSeverities) {
        const sev = String(p.severity || p.severity_level || "").toLowerCase();
        if (!sevSet.has(sev)) return false;
      }

      // Filter by date range
      const eventDate = p.event_date_iso || p.event_date || p.date || p.dt || "";
      if (dateFrom && eventDate < dateFrom) return false;
      if (dateTo && eventDate > dateTo) return false;

      // Filter by search term
      if (!term) return true;
      const location = p.location || p.address || p.origin_road || "";
      const subzone = get_subzone(p);
      const planningArea = get_planning_area(p);
      const hay = [floodType, location, subzone, planningArea]
        .map((x) => String(x || "").toLowerCase())
        .join("|");
      return hay.includes(term);
    });
  }, [features, floodTypesEnabled, selectedPlanningAreas, selectedSeverities, dateFrom, dateTo, searchQuery]);

  // Sort by date (most recent first)
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const dateA = a.properties?.event_date_iso || a.properties?.event_date || a.properties?.date || "";
      const dateB = b.properties?.event_date_iso || b.properties?.event_date || b.properties?.date || "";
      return dateB.localeCompare(dateA); // Descending order (newest first)
    });
    return arr;
  }, [filtered]);

  const mapData = useMemo(() => {
    return { type: "FeatureCollection", features: [...sorted] };
  }, [sorted]);

  // Selected flood state
  const [selectedFloodId, setSelectedFloodId] = useState(null);
  const [mapInstance, setMapInstance] = useState(null);
  const detailsPanelRef = useRef(null);

  // Handle flood selection with scroll to details panel
  const handleFloodSelect = useCallback((floodId) => {
    setSelectedFloodId(floodId);
    // Scroll to details panel smoothly
    if (detailsPanelRef.current) {
      detailsPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Handle focusing on a specific feature (road or amenity) on the map
  const handleFocusFeature = useCallback(({ item, type }) => {
    if (!mapInstance) return;

    try {
      // Extract coordinates based on type
      let coords = null;
      if (type === 'road') {
        // For LineStrings, use the first coordinate or centroid
        const geometry = item.geometry;
        if (geometry?.type === 'LineString' && geometry.coordinates?.length > 0) {
          coords = geometry.coordinates[0]; // First point
        }
      } else if (type === 'amenity') {
        // For Points, use the coordinates directly
        const geometry = item.geometry;
        if (geometry?.type === 'Point' && geometry.coordinates) {
          coords = geometry.coordinates;
        }
      }

      if (!coords || coords.length < 2) return;

      // Pan to the feature
      mapInstance.flyTo({
        center: coords,
        zoom: 16,
        duration: 1000,
      });
    } catch (error) {
      console.error('Error focusing on feature:', error);
    }
  }, [mapInstance]);

  // Get selected flood details
  const selectedFlood = useMemo(() => {
    if (!selectedFloodId) return null;
    return sorted.find(f => {
      const p = f.properties || {};
      const id = p.id || p.event_id || p.flood_id;
      return id === selectedFloodId;
    });
  }, [selectedFloodId, sorted]);

  // Define distance bands for infrastructure analysis
  const DISTANCE_BANDS = useMemo(() => [
    { min: 0, max: 250, label: 'inner' },
    { min: 250, max: 500, label: 'outer' },
  ], []);

  // Get nearby roads for selected flood (in bands) - optimized with shared utility
  const nearbyRoadsByBand = useMemo(() => {
    if (!selectedFlood || !roadFC) return {};
    const floodLat = selectedFlood.properties?.origin_lat || selectedFlood.properties?.latitude;
    const floodLng = selectedFlood.properties?.origin_lng || selectedFlood.properties?.longitude;
    if (!floodLat || !floodLng) return {};

    const roadsByBand = findFeaturesInBands(
      roadFC.features || [],
      floodLat,
      floodLng,
      DISTANCE_BANDS,
      (road) => road.geometry?.coordinates?.[0] // Extract first coordinate from LineString
    );

    // Add name property for display in each band
    const result = {};
    for (const [band, roads] of Object.entries(roadsByBand)) {
      result[band] = roads.map(road => ({
        ...road,
        name: road.properties?.name || "Unnamed Road",
      }));
    }
    return result;
  }, [selectedFlood, roadFC, DISTANCE_BANDS]);

  // Get nearby amenities for selected flood (in bands) - optimized with shared utility
  const nearbyAmenitiesByBand = useMemo(() => {
    if (!selectedFlood || !amenityFC) return {};
    const floodLat = selectedFlood.properties?.origin_lat || selectedFlood.properties?.latitude;
    const floodLng = selectedFlood.properties?.origin_lng || selectedFlood.properties?.longitude;
    if (!floodLat || !floodLng) return {};

    const amenitiesByBand = findFeaturesInBands(
      amenityFC.features || [],
      floodLat,
      floodLng,
      DISTANCE_BANDS,
      (amenity) => amenity.geometry?.coordinates // Extract coordinates from Point
    );

    // Add name and category properties for display in each band
    const result = {};
    for (const [band, amenities] of Object.entries(amenitiesByBand)) {
      result[band] = amenities.map(amenity => ({
        ...amenity,
        name: amenity.properties?.amenity_name || amenity.properties?.name || "Unnamed Amenity",
        category: amenity.properties?.amenity_category || amenity.properties?.category || "Unknown",
      }));
    }
    return result;
  }, [selectedFlood, amenityFC, DISTANCE_BANDS]);

  /* ===== ui ===== */
  return (
    <div className="mx-auto flex w-full flex-col gap-5 relative">
      {/* Loading overlay */}
      {isCalculating && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-sm font-medium">Filtering...</span>
            </div>
          </div>
        </div>
      )}

      <header className="space-y-5">
        <div>
          <h1 className="text-3xl font-bold">Flood Events</h1>
          <p className="text-muted-foreground mt-1">
            Explore and filter historical flood events across Singapore
          </p>
        </div>

        {/* Flood Events Configuration - Unified Parent Accordion */}
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem
            value="flood-config"
            className={`overflow-hidden rounded-xl border shadow-sm ${
              hasUnappliedFilterChanges
                ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700'
                : 'bg-card'
            }`}
          >
            <AccordionTrigger className="px-4 py-3 text-lg font-bold">
              <div className="flex items-center gap-2 w-full">
                <span>Flood Events Configuration</span>
                {hasUnappliedFilterChanges && (
                  <span className="px-2 py-1 rounded-md text-xs font-bold text-orange-700 dark:text-orange-300 bg-orange-100 dark:bg-orange-900/40 border border-orange-300 dark:border-orange-700">
                    • Unapplied Changes
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 pt-2">
              {/* each subsection is its own accordion */}
              <Accordion type="multiple" className="space-y-3">
                {/* Flood Type Configuration */}
                <AccordionItem value="flood-types" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
                    Flood Type Configuration
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Per-Type Toggles & Multipliers</CardTitle>
                        <CardDescription>
                          Adjust weights for different flood types to prioritize severity levels
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Flood Type Weight Presets */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Weight Presets</Label>
                          <div className="grid gap-2 sm:grid-cols-3">
                            {Object.entries(FLOOD_TYPE_PRESETS).map(([key, preset]) => {
                              const isActive = isFloodTypePresetActive(key);
                              return (
                                <button
                                  key={key}
                                  onClick={() => applyFloodTypePreset(key)}
                                  className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                                    isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-background'
                                  }`}
                                >
                                  <div className="font-semibold text-sm mb-1">
                                    {preset.name}
                                    {isActive && <span className="ml-2 text-xs text-primary">Active</span>}
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
                              const enabled = !!pendingFloodTypesEnabled[type];
                              const weight = pendingFloodTypeWeights[type] ?? 1.0;
                              const count = floodTypeCounts[type] || 0;
                              return (
                                <div key={type} className="space-y-1.5 rounded-lg bg-muted/30 p-2.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">{to_title_case(type)}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {count.toLocaleString()} events
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        id={`flood-${type}`}
                                        checked={enabled}
                                        onCheckedChange={(checked) =>
                                          setPendingFloodTypesEnabled((prev) => ({ ...prev, [type]: checked }))
                                        }
                                      />
                                      <Label htmlFor={`flood-${type}`} className="text-xs cursor-pointer">
                                        enable
                                      </Label>
                                    </div>

                                    <NumberInput
                                      value={weight}
                                      onValueChange={(val) => {
                                        if (val !== undefined) {
                                          setPendingFloodTypeWeights((prev) => ({ ...prev, [type]: val }));
                                        }
                                      }}
                                      min={0.5}
                                      max={5}
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

                {/* Date Range Filter */}
                <AccordionItem value="date-range" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
                    Date Range Filter
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Filter by Date</CardTitle>
                        <CardDescription>
                          Select a date range to filter flood events
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Date Range Presets */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Date Range Presets</Label>
                          <div className="grid gap-2 sm:grid-cols-4">
                            {Object.entries(DATE_RANGE_PRESETS).map(([key, preset]) => {
                              const isActive = isDateRangePresetActive(key);
                              return (
                                <button
                                  key={key}
                                  onClick={() => applyDateRangePreset(key)}
                                  className={`rounded-lg p-3 text-left transition-colors hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring border ${
                                    isActive ? 'border-2 border-primary bg-primary/10' : 'border-border bg-background'
                                  }`}
                                >
                                  <div className="font-semibold text-sm">
                                    {preset.name}
                                    {isActive && <span className="ml-2 text-xs text-primary">✓</span>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Custom Date Range */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Custom Date Range</Label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="date-from" className="text-xs">From Date</Label>
                              <Input
                                id="date-from"
                                type="date"
                                value={pendingDateFrom}
                                onChange={(e) => setPendingDateFrom(e.target.value)}
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="date-to" className="text-xs">To Date</Label>
                              <Input
                                id="date-to"
                                type="date"
                                value={pendingDateTo}
                                onChange={(e) => setPendingDateTo(e.target.value)}
                                className="h-9"
                              />
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>

                {/* Location and Severity Filters */}
                <AccordionItem value="location-severity" className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <AccordionTrigger className="px-4 py-2.5 text-base font-semibold">
                    Location & Severity Filters
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 pt-2 space-y-3">
                    <Card className="border bg-background/80 shadow-none">
                      <CardHeader>
                        <CardTitle className="text-base">Additional Filters</CardTitle>
                        <CardDescription>
                          Filter by planning area, severity, and search for specific locations
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Search */}
                        <div className="space-y-1.5">
                          <Label htmlFor="search-query" className="text-sm font-medium">Search Location</Label>
                          <Input
                            id="search-query"
                            placeholder="Search by location, road name, subzone..."
                            value={pendingSearchQuery}
                            onChange={(e) => setPendingSearchQuery(e.target.value)}
                            className="h-9"
                          />
                        </div>

                        {/* Planning Areas */}
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">Planning Areas (Multi-select)</Label>
                          <ScrollArea className="h-[120px] rounded-md border p-2">
                            <div className="space-y-1">
                              {planningAreaKeys.map((pa) => {
                                const isSelected = pendingSelectedPlanningAreas.includes(pa);
                                return (
                                  <div key={pa} className="flex items-center gap-2 py-1">
                                    <Switch
                                      id={`pa-${pa}`}
                                      checked={isSelected}
                                      onCheckedChange={(ck) => {
                                        if (ck) {
                                          setPendingSelectedPlanningAreas(prev => [...prev, pa]);
                                        } else {
                                          setPendingSelectedPlanningAreas(prev => prev.filter(x => x !== pa));
                                        }
                                      }}
                                    />
                                    <Label htmlFor={`pa-${pa}`} className="text-xs cursor-pointer">
                                      {pa} ({planningAreaCounts[pa] || 0})
                                    </Label>
                                  </div>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </div>

                        {/* Severities */}
                        <div className="space-y-1.5">
                          <Label className="text-sm font-medium">Severity Levels</Label>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {Object.entries(SEVERITY_LEVELS).map(([level, info]) => {
                              const isSelected = pendingSelectedSeverities.includes(level);
                              return (
                                <div key={level} className="flex items-center gap-2 rounded-lg bg-muted/30 p-2">
                                  <Switch
                                    id={`severity-${level}`}
                                    checked={isSelected}
                                    onCheckedChange={(ck) => {
                                      if (ck) {
                                        setPendingSelectedSeverities(prev => [...prev, level]);
                                      } else {
                                        setPendingSelectedSeverities(prev => prev.filter(x => x !== level));
                                      }
                                    }}
                                  />
                                  <Label htmlFor={`severity-${level}`} className="text-xs cursor-pointer flex items-center gap-2">
                                    <div className="w-3 h-3 rounded" style={{ backgroundColor: info.color }} />
                                    {info.name}
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Apply Changes and Reset All buttons */}
              <div className="flex justify-between items-center pt-4 mt-4 border-t">
                <Button
                  variant="outline"
                  onClick={clearAllFilters}
                >
                  Reset All Settings
                </Button>
                <Button
                  onClick={applyFilters}
                  disabled={!hasUnappliedFilterChanges}
                  size="default"
                  className={hasUnappliedFilterChanges ? "bg-primary" : ""}
                >
                  Apply Changes
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Stats Banner */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold">{sorted.length.toLocaleString()}</div>
                <div className="text-sm text-muted-foreground">Flood Events</div>
              </div>
              <div className="h-10 w-px bg-border" />
              <div>
                <div className="text-2xl font-bold">{Object.keys(floodTypesEnabled).filter(k => floodTypesEnabled[k]).length}</div>
                <div className="text-sm text-muted-foreground">Active Types</div>
              </div>
              {(dateFrom || dateTo) && (
                <>
                  <div className="h-10 w-px bg-border" />
                  <div>
                    <div className="text-sm font-medium">
                      {dateFrom && format_date(dateFrom)} - {dateTo && format_date(dateTo)}
                    </div>
                    <div className="text-sm text-muted-foreground">Date Range</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr,400px] gap-5">
        {/* Left Column - Map */}
        <div className="w-full">
          <FloodEventsMap
            data={mapData}
            selectedFloodId={selectedFloodId}
            onMapLoad={setMapInstance}
            onFloodClick={handleFloodSelect}
            vizMode={vizMode}
            colorMetric={colorMetric}
          />
        </div>

        {/* Right Column - Details Panel */}
        <div ref={detailsPanelRef} className="lg:h-[600px]">
          <FloodDetailsPanel
            flood={selectedFlood}
            onClose={() => setSelectedFloodId(null)}
            nearbyRoadsByBand={nearbyRoadsByBand}
            nearbyAmenitiesByBand={nearbyAmenitiesByBand}
            onFocusFeature={handleFocusFeature}
            vizMode={vizMode}
            onVizModeChange={setVizMode}
            colorMetric={colorMetric}
            onColorMetricChange={setColorMetric}
          />
        </div>
      </div>

      {/* List Panel - Below Map and Details */}
      <div>
        <FloodListPanel
          floods={sorted}
          selectedFloodId={selectedFloodId}
          onSelectFlood={handleFloodSelect}
        />
      </div>
    </div>
  );
}
