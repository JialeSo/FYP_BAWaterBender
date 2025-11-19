// src/pages/dashboardlayout.jsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import LeftPanel from "@/components/pagecomponents/historicalMap/leftPanel";
import RightPanel from "./rightPanel";
import { useMapData } from "@/context/mapDataContext";

/* ---------------- helpers ---------------- */
const featureProps = (f) => f?.properties ?? {};
const fcFeatures = (fc) => fc?.features ?? [];

/* optional: build id→name lookups from geojsons (used when flood rows only have ids) */
const buildLookups = (planningData, subzoneData, roadData) => {
  const paNameById = {};
  const szNameById = {};
  const szPaIdBySzId = {};
  const paIdBySzId = {};
  const roadNameById = {};

  for (const f of fcFeatures(planningData)) {
    const p = featureProps(f);
    const id = (p.PA_ID ?? p.PLN_AREA_ID ?? p.PLN_AREA_C ?? "").toString().trim();
    const name = (p.PLN_AREA_N ?? p.planning_area ?? "").toString().trim();
    if (id && name) paNameById[id] = name;
  }

  for (const f of fcFeatures(subzoneData)) {
    const p = featureProps(f);
    const szId = (p.SUBZONE_C ?? p.SUBZONE_ID ?? p.SZ_ID ?? "").toString().trim();
    const szName = (p.SUBZONE_N ?? p.subzone ?? "").toString().trim();
    const paId = (p.PA_ID ?? p.PLN_AREA_ID ?? p.PLN_AREA_C ?? "").toString().trim();
    if (szId && szName) szNameById[szId] = szName;
    if (szId && paId) { szPaIdBySzId[szId] = paId; paIdBySzId[szId] = paId; }
  }

  for (const f of fcFeatures(roadData)) {
    const p = featureProps(f);
    const rid = (p.RN_ID ?? p.UNIQUE_ID ?? p.road_id ?? "").toString().trim();
    const rname = (p.name ?? p.road ?? p.STREET_NAM ?? "").toString().trim();
    if (rid && rname) roadNameById[rid] = rname;
  }

  return { paNameById, szNameById, szPaIdBySzId, paIdBySzId, roadNameById };
};

/* normalise flood row using enriched/raw dataset columns, with lookup fallbacks */
const normaliseFloodRecord = (record = {}, lkp = {}) => {
  const {
    paNameById = {},
    szNameById = {},
    roadNameById = {},
    szPaIdBySzId = {},
    paIdBySzId = {},
  } = lkp || {};

  const planningAreaId = (
    record.start_pa_id ??
    record.end_pa_id ??
    record.start_planning_area_id ??
    record.end_planning_area_id ??
    record.planning_area_id ??
    record.pa_id ??
    ""
  ).toString().trim();

  const subzoneId = (
    record.start_sz_id ??
    record.end_sz_id ??
    record.start_subzone_id ??
    record.end_subzone_id ??
    record.subzone_id ??
    record.sz_id ??
    ""
  ).toString().trim();

  const roadId = (
    record.origin_rn_id ??           // prefer origin (enriched)
    record.start_rn_id ??
    record.end_rn_id ??
    record.start_street_id ??
    record.end_street_id ??
    record.RN_ID ??
    record.UNIQUE_ID ??
    ""
  ).toString().trim();

  const planningAreaExplicit = (
    record.origin_planning_area ??   // prefer origin (enriched)
    record.start_planning_area ??
    record.end_planning_area ??
    record.planning_area ??
    ""
  ).toString().trim();

  const subzoneExplicit = (
    record.origin_subzone ??         // prefer origin (enriched)
    record.start_subzone ??
    record.end_subzone ??
    record.subzone ??
    ""
  ).toString().trim();

  const roadExplicit = (
    record.origin_road ??            // prefer origin (enriched)
    record.start_street_name ??
    record.end_street_name ??
    record.parent_road ??
    record.road ??
    ""
  ).toString().trim();

  const derivedPaId = planningAreaId || szPaIdBySzId[subzoneId] || paIdBySzId[subzoneId] || "";
  const planningArea =
    planningAreaExplicit ||
    paNameById[planningAreaId] ||
    paNameById[derivedPaId] ||
    "";

  const subzone =
    subzoneExplicit ||
    szNameById[subzoneId] ||
    "";

  const road =
    roadExplicit ||
    roadNameById[roadId] ||
    (roadId ? `road ${roadId}` : "");

  const floodType = (
    record.event ??
    record.flood_type ??
    "unknown"
  ).toString().trim().toLowerCase() || "unknown";

  const eventDate = (() => {
    const raw =
      record.event_date_iso ??  // enriched first
      record.event_date ??
      record.start_date ??
      record.date ??
      record.dt ??
      null;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(+d) ? null : d;
  })();

  const year = eventDate && Number.isFinite(eventDate.getFullYear()) ? eventDate.getFullYear() : null;

  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const lat =
    toNum(record.origin_lat) ??
    toNum(record.start_lat) ??
    toNum(record.end_lat);

  const lng =
    toNum(record.origin_lng) ??
    toNum(record.start_lng) ??
    toNum(record.end_lng);

  return {
    ...record,
    planningArea,
    planningAreaId,
    subzone,
    subzoneId,
    road,
    roadId,
    floodType,
    eventDate,
    year,
    lat, lng,
  };
};

const aggregateCounts = (events, selector) => {
  const tally = new Map();
  events.forEach((e) => {
    const key = selector(e);
    const label = key ? String(key).trim() : "unknown";
    tally.set(label, (tally.get(label) || 0) + 1);
  });
  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

const countsToMap = (entries, selector = (e) => e.label) => {
  const map = {};
  let max = 0;
  entries.forEach((entry) => {
    const key = selector(entry);
    if (!key || key === "unknown") return;
    map[key] = entry.count;
    if (entry.count > max) max = entry.count;
  });
  return { map, max };
};

const withinDate = (value, fromISO, toISO) => {
  if (!fromISO && !toISO) return true;
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  if (fromISO && d < new Date(fromISO)) return false;
  if (toISO && d > new Date(toISO)) return false;
  return true;
};



/* ---------------- component ---------------- */
export default function dashboardlayout({ mapcomponent: MapComponent }) {
  const ctx = useMapData();

  // prefer enriched datasets, fallback to raw if needed
  const planningData =
    ctx?.planning_fc_enriched ??
    ctx?.planning_fc_raw ??
    ctx?.planningFC ??
    ctx?.planning_fc ??
    ctx?.planning ??
    null;

  const subzoneData =
    ctx?.subzone_fc_enriched ??
    ctx?.subzone_fc_raw ??
    ctx?.subzoneFC ??
    ctx?.subzone_fc ??
    ctx?.subzone ??
    null;

  const roadData =
    ctx?.road_fc_enriched ??
    ctx?.roadFC ??
    ctx?.road_fc ??
    ctx?.road ??
    null;

  const amenityData =
    ctx?.amenity_fc_enriched ??   // ⬅️ enriched amenities (names + category)
    ctx?.amenity_fc_raw ??
    ctx?.amenityFC ??
    ctx?.amenity_fc ??
    ctx?.amenities ??
    null;

  const floodData =
    ctx?.floods_fc_enriched ??    // ⬅️ enriched floods (origin/end + event_date_iso)
    ctx?.floods_fc_raw ??
    ctx?.floodsFC ??
    ctx?.floods_fc ??
    ctx?.floods ??
    null;

  const dataLoading = ctx.loading;
  const dataError   = ctx.error;

  const ready =
    !!planningData && !!subzoneData && !!roadData && !!amenityData && !!floodData &&
    Array.isArray(planningData.features) &&
    Array.isArray(subzoneData.features) &&
    Array.isArray(roadData.features) &&
    Array.isArray(amenityData.features) &&
    Array.isArray(floodData.features);

  /* ui state */
  const [resizeSignal, setResizeSignal] = useState(0);
  const [showFloods, setShowFloods] = useState(true);
  const [showAmenities, setShowAmenities] = useState(true);

  /* selections */
  const [planningAreas, setPlanningAreas] = useState([]);
  const [selectedPlanningAreas, setSelectedPlanningAreas] = useState([]);
  const [planningSelectionInitialized, setPlanningSelectionInitialized] = useState(false);
  const [selectedSubzone, setSelectedSubzone] = useState(null);

  /* amenity filters */
  const [amenityCategories, setAmenityCategories] = useState([]);
  const [amenityTypesAll, setAmenityTypesAll] = useState([]);
  const [selectedAmenityCategories, setSelectedAmenityCategories] = useState([]);
  const [selectedAmenityTypes, setSelectedAmenityTypes] = useState([]);

  /* flood filters */
  const [floodTypesAll, setFloodTypesAll] = useState([]);
  const [selectedFloodTypes, setSelectedFloodTypes] = useState([]);
  const [floodDateFrom, setFloodDateFrom] = useState("");
  const [floodDateTo, setFloodDateTo] = useState("");

  /* insights base */
  const [floodRows, setFloodRows] = useState([]);
  const [floodLoading, setFloodLoading] = useState(false);
  const [floodError, setFloodError] = useState(null);
  const [selectedSubzones, setSelectedSubzones] = useState([]); // <-- add this

  /* ---------- react to datasets ---------- */
  useEffect(() => {
    let cancelled = false;
    setFloodLoading(true);
    setFloodError(null);

    try {
      const paNames = Array.from(
        new Set(
          fcFeatures(planningData)
            .map((f) => featureProps(f)?.PLN_AREA_N)
            .filter(Boolean)
            .map((s) => String(s).trim())
        )
      ).sort();
      if (!cancelled) {
        setPlanningAreas(paNames);
      }

      const amenCats = Array.from(
        new Set(
          fcFeatures(amenityData)
            .map((f) => featureProps(f)?.amenity_category)
            .filter(Boolean)
            .map((s) => String(s).trim())
        )
      ).sort();

      const amenTypes = Array.from(
        new Set(
          fcFeatures(amenityData)
            .map((f) => featureProps(f)?.amenity_type)
            .filter(Boolean)
            .map((s) => String(s).trim())
        )
      ).sort();

      const floodTypes = Array.from(
        new Set(
          fcFeatures(floodData)
            .map((f) => featureProps(f))
            .map((p) => (p?.event ?? p?.flood_type ?? "").toString().trim().toLowerCase())
            .filter(Boolean)
        )
      ).sort();

      const floodRowsObjects = fcFeatures(floodData).map((f) => featureProps(f));

      if (!cancelled) {
        setAmenityCategories(amenCats);
        setAmenityTypesAll(amenTypes);
        setFloodTypesAll(floodTypes);
        setFloodRows(floodRowsObjects);
      }
    } catch (e) {
      if (!cancelled) {
        setFloodError(e instanceof Error ? e.message : "unable to prepare datasets");
        setFloodRows([]);
        setPlanningAreas([]);
        setAmenityCategories([]);
        setAmenityTypesAll([]);
        setFloodTypesAll([]);
      }
    } finally {
      if (!cancelled) setFloodLoading(false);
    }

    return () => { cancelled = true; };
  }, [planningData, amenityData, floodData]);

  /* ---------- options ---------- */
  const planningOptions = useMemo(
    () => [...new Set(planningAreas)].sort((a, b) => a.localeCompare(b)),
    [planningAreas]
  );

  useEffect(() => {
    if (planningSelectionInitialized) return;
    if (!planningOptions.length) return;
    setSelectedPlanningAreas(planningOptions);
    setPlanningSelectionInitialized(true);
  }, [planningOptions, planningSelectionInitialized]);

  /* ---------- lookups + insights precompute ---------- */
  const floodLookups = useMemo(
    () => buildLookups(planningData, subzoneData, roadData),
    [planningData, subzoneData, roadData]
  );

  const floodEvents = useMemo(
    () => floodRows.map((r) => normaliseFloodRecord(r, floodLookups)),
    [floodRows, floodLookups]
  );

  const filteredFloodEvents = useMemo(() => {
    if (!planningSelectionInitialized) return floodEvents;
    if (!selectedPlanningAreas.length) return [];

    const allSelected = planningOptions.length && selectedPlanningAreas.length === planningOptions.length;
    const paAllowed = new Set(selectedPlanningAreas.map((pa) => String(pa || "").trim()).filter(Boolean));
    const base = (!allSelected && paAllowed.size)
      ? floodEvents.filter((e) => e.planningArea && paAllowed.has(e.planningArea))
      : floodEvents;

    const typeAllowed = new Set(
      (selectedFloodTypes || []).map((s) => String(s).trim().toLowerCase())
    );
    const byType = typeAllowed.size ? base.filter((e) => typeAllowed.has(e.floodType)) : base;

    return byType.filter((e) => withinDate(e.eventDate, floodDateFrom, floodDateTo));
  }, [
    floodEvents,
    selectedPlanningAreas,
    selectedFloodTypes,
    floodDateFrom,
    floodDateTo,
    planningOptions,
    planningSelectionInitialized,
  ]);

  const floodInsights = useMemo(() => {
    if (!floodEvents.length) {
      return {
        totals: { events: 0, subzoneEvents: 0, planningAreas: 0, subzones: 0, roads: 0, topType: null },
        byPlanningArea: [],
        bySubzone: [],
        byRoad: [],
        byType: [],
        yearSeries: [],
        topRoads: [],
        topSubzones: [],
        focusSubzoneName: null,
        planningCountMap: {},
        subzoneCountMap: {},
        roadCountMap: {},
        overallPlanningCountMap: {},
        maxPlanningCount: 0,
        maxSubzoneCount: 0,
        maxRoadCount: 0,
        overallMaxPlanningCount: 0,
      };
    }

    const filtered = filteredFloodEvents;
    const overallPlanningCounts = aggregateCounts(floodEvents, (e) => e.planningArea);

    const focusSubzoneName = selectedSubzone?.properties?.SUBZONE_N?.trim() || null;
    const subzoneScopedEvents = focusSubzoneName
      ? filtered.filter((e) => e.subzone === focusSubzoneName)
      : filtered;

    const byPlanningArea = aggregateCounts(filtered, (e) => e.planningArea);
    const bySubzone = aggregateCounts(filtered, (e) => e.subzone);
    const byType = aggregateCounts(filtered, (e) => e.floodType);

    const yearSeries = aggregateCounts(
      filtered.filter((e) => Number.isInteger(e.year)),
      (e) => String(e.year)
    )
      .map(({ label, count }) => ({ year: Number(label), count }))
      .sort((a, b) => a.year - b.year);

    const roadTally = new Map();
    const roadSourceEvents = focusSubzoneName ? subzoneScopedEvents : filtered;
    roadSourceEvents.forEach((e) => {
      const id = (e.roadId || "").trim();
      const name = e.road || id || "unknown";
      const key = id || name;
      if (!key) return;
      const entry = roadTally.get(key) || { id: id || null, name, count: 0, planningArea: null, subzone: null };
      entry.count += 1;
      if (!entry.name && name) entry.name = name;
      // Store planning area and subzone from the event
      if (!entry.planningArea && e.planningArea) entry.planningArea = e.planningArea;
      if (!entry.subzone && e.subzone) entry.subzone = e.subzone;
      roadTally.set(key, entry);
    });
    const roadEntries = Array.from(roadTally.values()).sort((a, b) => b.count - a.count);
    const byRoad = roadEntries.map(({ id, name, count, planningArea, subzone }) => ({ label: id || name, name, count, planningArea, subzone }));
    const topRoads = roadEntries
      .filter((r) => (r.id || r.name) && r.name && r.name !== "unknown")
      .slice(0, 5)
      .map(({ name, count, planningArea, subzone }) => ({ name, count, planningArea, subzone }));

    const subzoneSource = focusSubzoneName ? subzoneScopedEvents : filtered;
    // Build subzone list with planning area information
    const subzoneTally = new Map();
    subzoneSource.forEach((e) => {
      const szName = String(e.subzone || "").trim();
      if (!szName || szName === "unknown") return;
      const entry = subzoneTally.get(szName) || { name: szName, count: 0, planningArea: null };
      entry.count += 1;
      if (!entry.planningArea && e.planningArea) entry.planningArea = e.planningArea;
      subzoneTally.set(szName, entry);
    });
    const topSubzones = Array.from(subzoneTally.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ name, count, planningArea }) => ({ name, count, planningArea }));

    const { map: planningCountMap, max: maxPlanningCount } = countsToMap(byPlanningArea);
    const { map: overallPlanningCountMap, max: overallMaxPlanningCount } =
      countsToMap(overallPlanningCounts);
    const { map: subzoneCountMap, max: maxSubzoneCount } = countsToMap(bySubzone);
    const { map: roadCountMap, max: maxRoadCount } = countsToMap(byRoad, (e) => e.label);

    const totals = {
      events: filtered.length,
      subzoneEvents: subzoneScopedEvents.length,
      planningAreas: new Set(filtered.map((e) => e.planningArea).filter(Boolean)).size,
      subzones: new Set(filtered.map((e) => e.subzone).filter(Boolean)).size,
      roads: new Set(filtered.map((e) => e.road).filter(Boolean)).size,
      topType: byType[0]?.label ?? null,
    };

    return {
      totals,
      byPlanningArea,
      bySubzone,
      byRoad,
      byType,
      yearSeries,
      topRoads,
      topSubzones,
      focusSubzoneName,
      planningCountMap,
      subzoneCountMap,
      roadCountMap,
      overallPlanningCountMap,
      maxPlanningCount,
      maxSubzoneCount,
      maxRoadCount,
      overallMaxPlanningCount,
    };
  }, [filteredFloodEvents, floodEvents, selectedSubzone]);

  /* ---------- subzone options ---------- */
  const subzoneOptions = useMemo(() => {
    const feats = fcFeatures(subzoneData);
    const paAllowed = new Set(selectedPlanningAreas);
    const rows = feats
      .filter((f) => {
        if (!f?.properties) return false;
        if (!paAllowed.size) return true;
        return paAllowed.has(String(f.properties.PLN_AREA_N || "").trim());
      })
      .map((f) => ({
        name: String(f.properties.SUBZONE_N || "").trim(),
        planningArea: String(f.properties.PLN_AREA_N || "").trim(),
      }))
      .filter((r) => r.name);
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
  }, [subzoneData, selectedPlanningAreas]);

  /* ---------- amenity type options depend on selected categories ---------- */
  const amenityTypeOptionsScoped = useMemo(() => {
    if (!amenityData?.features?.length) return [];
    const cats = new Set(selectedAmenityCategories.map(String));
    const feats = amenityData.features;
    const raw = feats
      .filter((f) => {
        if (!cats.size) return true;
        const c = String(f?.properties?.amenity_category ?? "").trim();
        return c && cats.has(c);
      })
      .map((f) => String(f?.properties?.amenity_type ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).sort();
  }, [amenityData, selectedAmenityCategories]);

  const amenityFilteredFeatures = useMemo(() => {
    const feats = amenityData?.features || [];
    if (!feats.length) return [];
    if (!planningSelectionInitialized) return feats;
    if (!selectedPlanningAreas.length) return [];

    const allSelected = planningOptions.length && selectedPlanningAreas.length === planningOptions.length;
    const paAllowed = new Set(selectedPlanningAreas.map((pa) => String(pa || "").trim()).filter(Boolean));
    const cats = new Set(selectedAmenityCategories.map(String));
    const types = new Set(selectedAmenityTypes.map(String));

    return feats.filter((f) => {
      const p = f.properties || {};
      if (!allSelected && paAllowed.size) {
        const paName = String(p.planning_area || "").trim();
        if (!paName || !paAllowed.has(paName)) return false;
      }
      if (cats.size) {
        const cat = String(p.amenity_category ?? "").trim();
        if (!cat || !cats.has(cat)) return false;
      }
      if (types.size) {
        const t = String(p.amenity_type ?? "").trim();
        if (!t || !types.has(t)) return false;
      }
      return true;
    });
  }, [
    amenityData,
    selectedPlanningAreas,
    selectedAmenityCategories,
    selectedAmenityTypes,
    planningOptions,
    planningSelectionInitialized,
  ]);

  const amenityInsights = useMemo(() => {
    const feats = amenityFilteredFeatures;
    if (!feats.length) {
      return {
        totals: {
          amenities: 0,
          planningAreas: 0,
          subzones: 0,
          categories: 0,
          types: 0,
          topCategory: null,
          topType: null,
        },
        byPlanningArea: [],
        bySubzone: [],
        byCategory: [],
        byType: [],
        topSubzones: [],
        topTypes: [],
        topRoads: [],
        planningCountMap: {},
        overallPlanningCountMap: {},
      };
    }
    const tally = (arr, sel) => {
      const m = new Map();
      arr.forEach((f) => {
        const k = sel(f) || "unknown";
        m.set(k, (m.get(k) || 0) + 1);
      });
      return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };

    const byPlanningArea = tally(feats, (f) => String(f.properties?.planning_area || "").trim());
    const bySubzone = tally(feats, (f) => String(f.properties?.subzone || "").trim());
    const byCategory = tally(feats, (f) => String(f.properties?.amenity_category || "").trim());
    const byType = tally(feats, (f) => String(f.properties?.amenity_type || "").trim());

    // Build subzone list with planning area information
    const subzoneTally = new Map();
    feats.forEach((f) => {
      const p = f.properties || {};
      const szName = String(p.subzone || "").trim();
      if (!szName || szName === "unknown") return;
      const entry = subzoneTally.get(szName) || { name: szName, count: 0, planningArea: null };
      entry.count += 1;
      if (!entry.planningArea && p.planning_area) entry.planningArea = String(p.planning_area).trim();
      subzoneTally.set(szName, entry);
    });
    const topSubzones = Array.from(subzoneTally.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ name, count, planningArea }) => ({ name, count, planningArea }));

    const topTypes = byType.slice(0, 10).map(({ label, count }) => ({ name: label, count }));

    // Road aggregation for amenities - improved to handle road IDs
    const roadTally = new Map();
    feats.forEach((f) => {
      const p = f.properties || {};

      // Try to get road ID first, then fall back to road name
      const roadId = String(p.road_id || p.rn_id || p.RN_ID || p.UNIQUE_ID || "").trim();
      const roadNameDirect = String(p.road || p.street_name || p.road_name || p.STREET_NAM || "").trim();

      // Look up road name from roadData if we have an ID
      const roadNameFromLookup = roadId && floodLookups?.roadNameById?.[roadId] || "";
      const roadName = roadNameFromLookup || roadNameDirect;

      if (!roadName || roadName === "unknown") return;

      const key = roadId || roadName;
      const entry = roadTally.get(key) || { id: roadId || null, name: roadName, count: 0, planningArea: null, subzone: null };
      entry.count += 1;
      if (!entry.name && roadName) entry.name = roadName;
      if (!entry.planningArea && p.planning_area) entry.planningArea = String(p.planning_area).trim();
      if (!entry.subzone && p.subzone) entry.subzone = String(p.subzone).trim();
      roadTally.set(key, entry);
    });
    const topRoads = Array.from(roadTally.values())
      .filter((r) => r.name && r.name !== "unknown")
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(({ name, count, planningArea, subzone }) => ({ name, count, planningArea, subzone }));

    // Add planning count maps for amenities (similar to floods)
    const { map: planningCountMap } = countsToMap(byPlanningArea);
    const overallPlanningCountMap = planningCountMap; // For amenities, use the same map

    return {
      totals: {
        amenities: feats.length,
        planningAreas: byPlanningArea.filter((x) => x.label && x.label !== "unknown").length,
        subzones: bySubzone.filter((x) => x.label && x.label !== "unknown").length,
        categories: byCategory.filter((x) => x.label && x.label !== "unknown").length,
        types: byType.filter((x) => x.label && x.label !== "unknown").length,
        topCategory: byCategory[0]?.label ?? null,
        topType: byType[0]?.label ?? null,
      },
      byPlanningArea,
      bySubzone,
      byCategory,
      byType,
      topSubzones,
      topTypes,
      topRoads,
      planningCountMap,
      overallPlanningCountMap,
    };
  }, [amenityFilteredFeatures, floodLookups]);

  /* ---------- ui helpers ---------- */
  const triggerResize = useCallback(() => setResizeSignal((v) => v + 1), []);

  const handlePlanningAreaSelection = useCallback((areas) => setSelectedPlanningAreas(areas), []);
  const handleResetPlanningAreas = useCallback(() => setSelectedPlanningAreas(planningOptions), [planningOptions]);
  const handlePlanningAreaFromMap = useCallback((areaName) => {
    if (!areaName) {
      // Reset to all planning areas and clear all filters
      setSelectedPlanningAreas(planningOptions);
      setSelectedSubzones([]);
      setSelectedAmenityCategories([]);
      setSelectedAmenityTypes([]);
      setSelectedFloodTypes([]);
      setFloodDateFrom("");
      setFloodDateTo("");
      return;
    }
    setSelectedPlanningAreas([areaName]);
  }, [planningOptions]);

  const handleSubzoneSelect = useCallback(
    (feature) => {
      setSelectedSubzone(feature);
    },
    []
  );

  const handleSubzonePickByName = useCallback(
    (subzoneName) => {
      if (!subzoneName) {
        setSelectedSubzone(null);
        return;
      }
      const feat = (subzoneData?.features || []).find(
        (f) => String(f?.properties?.SUBZONE_N || "").trim() === subzoneName
      );
      setSelectedSubzone(feat || null);
      const pa = feat?.properties?.PLN_AREA_N ? String(feat.properties.PLN_AREA_N).trim() : null;
      if (pa) setSelectedPlanningAreas([pa]);
    },
    [subzoneData]
  );

  useEffect(() => {
    if (!selectedPlanningAreas.length) return setSelectedSubzone(null);
    if (
      selectedSubzone?.properties?.PLN_AREA_N &&
      !selectedPlanningAreas.includes(selectedSubzone.properties.PLN_AREA_N)
    ) {
      setSelectedSubzone(null);
    }
  }, [selectedPlanningAreas, selectedSubzone]);

  /* ---------- render ---------- */
  return (
    <div className="flex h-full min-h-0 flex-col gap-6 px-4 py-6 md:px-6 lg:px-10">
      <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row max-h-[95dvh]">
        {/* left filters (match map height, scroll if needed) */}
        <aside className="min-h-0 flex flex-col md:basis-1/4 md:max-w-[25%]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="max-h-[95dvh] h-full overflow-y-auto">
              <LeftPanel
                options={planningOptions}
                selected={selectedPlanningAreas}
                onSelectionChange={handlePlanningAreaSelection}
                onResetSelection={handleResetPlanningAreas}
                subzoneOptions={subzoneOptions}
                selectedSubzones={selectedSubzones}
                onSelectedSubzonesChange={setSelectedSubzones}
                amenityCategoriesOptions={amenityCategories}
                selectedAmenityCategories={selectedAmenityCategories}
                onAmenityCategoriesChange={setSelectedAmenityCategories}
                amenityTypesOptions={amenityTypesAll}
                selectedAmenityTypes={selectedAmenityTypes}
                onAmenityTypesChange={setSelectedAmenityTypes}
                floodTypeOptions={floodTypesAll}
                selectedFloodTypes={selectedFloodTypes}
                onFloodTypesChange={setSelectedFloodTypes}
                floodDateFrom={floodDateFrom}
                floodDateTo={floodDateTo}
                onFloodDateFromChange={setFloodDateFrom}
                onFloodDateToChange={setFloodDateTo}
              />
            </div>
          </div>
        </aside>

        {/* map column */}
        <div className="relative min-w-0 min-h-0 flex grow flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm h-[95dvh] md:basis-1/2 md:max-w-[50%]">
          <div className="flex-1 min-h-0">
            {!dataLoading && !dataError && ready && MapComponent ? (
              <MapComponent
                resizeSignal={resizeSignal}
                selectedPlanningAreas={selectedPlanningAreas}
                selectedSubzone={selectedSubzone}
                onPlanningAreaToggle={handlePlanningAreaFromMap}
                onSubzoneSelect={handleSubzoneSelect}
                planningData={planningData}
                subzoneData={subzoneData}
                roadData={roadData}
                amenityData={amenityData}
                floodData={floodData}
                /* filters */
                selectedSubzones={selectedSubzones}
                selectedAmenityCategories={selectedAmenityCategories}
                selectedAmenityTypes={selectedAmenityTypes}
                onAmenityTypesChange={setSelectedAmenityTypes}
                selectedFloodTypes={selectedFloodTypes}
                onFloodTypesChange={setSelectedFloodTypes}
                floodDateFrom={floodDateFrom}
                floodDateTo={floodDateTo}
                /* options / stats */
                amenityTypes={amenityCategories}  /* categories list used by map for icons */
                floodTypes={floodTypesAll}
                onPlanningAreasLoaded={setPlanningAreas}
                floodStats={floodInsights}
                /* toggles */
                showFloods={showFloods}
                setShowFloods={setShowFloods}
                showAmenities={showAmenities}
                setShowAmenities={setShowAmenities}
              />
            ) : null}
          </div>
        </div>

        {/* right info (match height, scroll if needed) */}
        <aside className="min-h-0 flex flex-col md:basis-1/4 md:max-w-[25%]">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="max-h-[95dvh] h-full overflow-y-auto">
              <RightPanel
                feature={selectedSubzone}
                onClearSelection={() => setSelectedSubzone(null)}
                stats={floodInsights}
                amenityStats={amenityInsights}
                loading={dataLoading || floodLoading}
                error={dataError || floodError}
                selectedPlanningAreas={selectedPlanningAreas}
                allPlanningAreasSelected={planningSelectionInitialized && selectedPlanningAreas.length === planningOptions.length}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
