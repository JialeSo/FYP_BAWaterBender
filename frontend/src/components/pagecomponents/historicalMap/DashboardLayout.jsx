import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import LeftPanel from "@/components/pagecomponents/historicalMap/LeftPanel";
import RightPanel from "./RightPanel";
import { PanelLeft, PanelRight } from "lucide-react";

/** shared parsers */
import {
  parseCsv,
  amenitiesCsvToGeoJSON,
  floodsCsvToGeoJSON,
} from "../../../utils/map/parsers";

/* ---------------- utilities for insights ---------------- */
const normaliseFloodRecord = (record) => {
  const planningArea = (record.start_planning_area || record.end_planning_area || "").trim();
  const subzone = (record.start_subzone || record.end_subzone || "").trim();
  const road = (record.start_street_name || record.end_street_name || record.parent_road || "").trim();
  const roadId = (record.start_street_id || record.end_street_id || record.RN_ID || record.UNIQUE_ID || road || "").trim();
  const floodType = (record.event || "unknown").trim().toLowerCase() || "unknown";
  const eventDate = record.event_date ? new Date(record.event_date) : null;
  const year = eventDate && Number.isFinite(eventDate.getFullYear()) ? eventDate.getFullYear() : null;

  return { ...record, planningArea, subzone, road, roadId, floodType, eventDate, year };
};

const aggregateCounts = (events, selector) => {
  const tally = new Map();
  events.forEach((event) => {
    const key = selector(event);
    const label = key ? String(key).trim() : "Unknown";
    tally.set(label, (tally.get(label) || 0) + 1);
  });
  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
};

const countsToMap = (entries, selector = (entry) => entry.label) => {
  const map = {};
  let max = 0;
  entries.forEach((entry) => {
    const key = selector(entry);
    if (!key || key === "Unknown") return;
    map[key] = entry.count;
    if (entry.count > max) max = entry.count;
  });
  return { map, max };
};

/* ---------------- helpers for flexible filtering ---------------- */

const withinDate = (value, fromISO, toISO) => {
  if (!fromISO && !toISO) return true;
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  if (fromISO && d < new Date(fromISO)) return false;
  if (toISO && d > new Date(toISO)) return false;
  return true;
};

/* ---------------- component ---------------- */
export default function DashboardLayout({ mapcomponent: MapComponent }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [resizeSignal, setResizeSignal] = useState(0);
  const [showFloods, setShowFloods] = useState(true);
  const [showAmenities, setShowAmenities] = useState(true);

  /* selection state */
  const [planningAreas, setPlanningAreas] = useState([]);
  const [selectedPlanningAreas, setSelectedPlanningAreas] = useState([]);
  const [selectedSubzone, setSelectedSubzone] = useState(null);

  /* amenity filters */
  const [amenityCategories, setAmenityCategories] = useState([]); // all categories from data
  const [amenityTypesAll, setAmenityTypesAll] = useState([]);     // all types from data
  const [selectedAmenityCategories, setSelectedAmenityCategories] = useState([]);
  const [selectedAmenityTypes, setSelectedAmenityTypes] = useState([]);

  /* flood filters */
  const [floodTypesAll, setFloodTypesAll] = useState([]);         // all types from csv rows
  const [selectedFloodTypes, setSelectedFloodTypes] = useState([]);
  const [floodDateFrom, setFloodDateFrom] = useState("");         // ISO date (yyyy-mm-dd)
  const [floodDateTo, setFloodDateTo] = useState("");

  /* raw datasets (loaded here and shared with the Map) */
  const [planningData, setPlanningData] = useState(null); // geojson
  const [subzoneData, setSubzoneData] = useState(null);   // geojson
  const [roadData, setRoadData] = useState(null);         // geojson
  const [amenityData, setAmenityData] = useState(null);   // geojson (all amenities)
  const [floodData, setFloodData] = useState(null);       // geojson (all floods)

  /* for insights panel derived from CSV rows */
  const [floodRows, setFloodRows] = useState([]);
  const [floodLoading, setFloodLoading] = useState(false);
  const [floodError, setFloodError] = useState(null);

  /* derived options */
  const planningOptions = useMemo(
    () => [...new Set(planningAreas)].sort((a, b) => a.localeCompare(b)),
    [planningAreas]
  );

  /* ---------- load ALL files here ---------- */
  useEffect(() => {
    let cancelled = false;

    const loadAll = async () => {
      try {
        setFloodLoading(true);
        setFloodError(null);

        const [
          planningRes,
          subzoneRes,
          roadRes,
          amenityCsvRes,
          floodCsvRes,
        ] = await Promise.all([
          fetch("/map/planning_area.geojson"),
          fetch("/map/subzone_area.geojson"),
          fetch("/map/road_network.geojson"),
          fetch("/map/amenities_3layers.csv"),
          fetch("/map/floodsv2.csv"),
        ]);

        if (!planningRes.ok) throw new Error(`Failed planning_area.geojson (${planningRes.status})`);
        if (!subzoneRes.ok) throw new Error(`Failed subzone_area.geojson (${subzoneRes.status})`);
        if (!roadRes.ok) throw new Error(`Failed road_network.geojson (${roadRes.status})`);
        if (!amenityCsvRes.ok) throw new Error(`Failed amenities_3layers.csv (${amenityCsvRes.status})`);
        if (!floodCsvRes.ok) throw new Error(`Failed floodsv2.csv (${floodCsvRes.status})`);

        const [planningJson, subzoneJson, roadJson, amenityCsvText, floodCsvText] =
          await Promise.all([
            planningRes.json(),
            subzoneRes.json(),
            roadRes.json(),
            amenityCsvRes.text(),
            floodCsvRes.text(),
          ]);

        // amenities -> GeoJSON
        const amenRows = parseCsv(amenityCsvText);
        const amenGeo = amenitiesCsvToGeoJSON(amenRows);

        // floods -> GeoJSON + rows for insights
        const floodRowsObjects = parseCsv(floodCsvText);
        const floodGeo = floodsCsvToGeoJSON(floodRowsObjects);

        if (cancelled) return;

        // datasets
        setPlanningData(planningJson);
        setSubzoneData(subzoneJson);
        setRoadData(roadJson);
        setAmenityData(amenGeo);
        setFloodData(floodGeo);
        setFloodRows(floodRowsObjects);

        // planning options
        const paNames = Array.from(
          new Set((planningJson?.features ?? [])
            .map((f) => f?.properties?.PLN_AREA_N?.trim())
            .filter(Boolean))
        ).sort();
        setPlanningAreas(paNames);

        // amenity options
        const uniqAmenCats = Array.from(
          new Set((amenGeo?.features ?? [])
            .map((f) => String(f?.properties?.amenity_category ?? "").trim())
            .filter(Boolean))
        ).sort();
        setAmenityCategories(uniqAmenCats);

        const uniqAmenTypes = Array.from(
          new Set((amenGeo?.features ?? [])
            .map((f) => String(f?.properties?.amenity_type ?? "").trim())
            .filter(Boolean))
        ).sort();
        setAmenityTypesAll(uniqAmenTypes);

        // flood types
        const uniqFloodTypes = Array.from(
          new Set(floodRowsObjects
            .map((r) => String(r.event ?? "").trim().toLowerCase())
            .filter(Boolean))
        ).sort();
        setFloodTypesAll(uniqFloodTypes);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setFloodError(err instanceof Error ? err.message : "Unable to load datasets.");
          setPlanningData(null);
          setSubzoneData(null);
          setRoadData(null);
          setAmenityData(null);
          setFloodData(null);
          setFloodRows([]);
          setPlanningAreas([]);
          setAmenityCategories([]);
          setAmenityTypesAll([]);
          setFloodTypesAll([]);
        }
      } finally {
        if (!cancelled) setFloodLoading(false);
      }
    };

    loadAll();
    return () => { cancelled = true; };
  }, []);

  /* ---------- insights computed from rows ---------- */
  const floodEvents = useMemo(() => floodRows.map(normaliseFloodRecord), [floodRows]);

  const filteredFloodEvents = useMemo(() => {
    // planning area filtering for insights
    const paAllowed = new Set(selectedPlanningAreas);
    const base = !paAllowed.size
      ? floodEvents
      : floodEvents.filter((e) => e.planningArea && paAllowed.has(e.planningArea));

    // flood type
    const typeAllowed = new Set((selectedFloodTypes || []).map(String));
    const byType = typeAllowed.size ? base.filter((e) => typeAllowed.has(String(e.floodType))) : base;

    // date range
    return byType.filter((e) => withinDate(e.eventDate, floodDateFrom, floodDateTo));
  }, [floodEvents, selectedPlanningAreas, selectedFloodTypes, floodDateFrom, floodDateTo]);

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

    // roads tally
    const roadTally = new Map();
    const roadSourceEvents = focusSubzoneName ? subzoneScopedEvents : filtered;
    roadSourceEvents.forEach((e) => {
      const id = e.roadId?.trim();
      const name = e.road || id || "Unknown";
      const key = id || name;
      if (!key) return;
      const entry = roadTally.get(key) || { id: id || null, name, count: 0 };
      entry.count += 1;
      if (!entry.name && name) entry.name = name;
      roadTally.set(key, entry);
    });
    const roadEntries = Array.from(roadTally.values()).sort((a, b) => b.count - a.count);
    const byRoad = roadEntries.map(({ name, count }) => ({ label: name, count }));
    const topRoads = roadEntries.filter((r) => r.name && r.name !== "Unknown").slice(0, 5)
      .map(({ name, count }) => ({ name, count }));

    const subzoneSource = focusSubzoneName ? subzoneScopedEvents : filtered;
    const topSubzones = aggregateCounts(subzoneSource, (e) => e.subzone)
      .filter((x) => x.label && x.label !== "Unknown")
      .slice(0, 5)
      .map(({ label, count }) => ({ name: label, count }));

    const { map: planningCountMap, max: maxPlanningCount } = countsToMap(byPlanningArea);
    const { map: overallPlanningCountMap, max: overallMaxPlanningCount } = countsToMap(overallPlanningCounts);
    const { map: subzoneCountMap, max: maxSubzoneCount } = countsToMap(bySubzone);
    const { map: roadCountMap, max: maxRoadCount } = countsToMap(roadEntries, (entry) => entry.id || entry.name);

    const totals = {
      events: filtered.length,
      subzoneEvents: subzoneScopedEvents.length,
      planningAreas: new Set(filtered.map((e) => e.planningArea).filter(Boolean)).size,
      subzones: new Set(filtered.map((e) => e.subzone).filter(Boolean)).size,
      roads: new Set(filtered.map((e) => (e.roadId || e.road)).filter(Boolean)).size,
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

  /* ---------- derived subzone options (respect planning area selection) ---------- */
  const subzoneOptions = useMemo(() => {
    const feats = subzoneData?.features ?? [];
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
    // dedupe by name
    const seen = new Set();
    return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
  }, [subzoneData, selectedPlanningAreas]);

  /* ---------- amenity type options depend on chosen categories ---------- */
  const amenityTypeOptionsScoped = useMemo(() => {
    if (!amenityData?.features?.length) return [];
    const cats = new Set(selectedAmenityCategories.map(String));
    const feats = amenityData.features;
    const raw = feats
      .filter((f) => {
        if (!cats.size) return true; // show all types if no cat selected
        const c = String(f?.properties?.amenity_category ?? "").trim();
        return c && cats.has(c);
      })
      .map((f) => String(f?.properties?.amenity_type ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set(raw)).sort();
  }, [amenityData, selectedAmenityCategories]);

  /* ---------- UI helpers ---------- */
  const triggerResize = useCallback(() => setResizeSignal((v) => v + 1), []);
  const handleToggleLeft  = useCallback(() => { setLeftOpen((o) => !o);  triggerResize(); }, [triggerResize]);
  const handleToggleRight = useCallback(() => { setRightOpen((o) => !o); triggerResize(); }, [triggerResize]);

  const handlePlanningAreaSelection = useCallback((areas) => setSelectedPlanningAreas(areas), []);
  const handleResetPlanningAreas = useCallback(() => setSelectedPlanningAreas([]), []);
  const handlePlanningAreaFromMap = useCallback((areaName) => {
    if (!areaName) return setSelectedPlanningAreas([]);
    setSelectedPlanningAreas((prev) => (prev.includes(areaName) ? prev.filter((n) => n !== areaName) : [areaName]));
  }, []);

  const handleSubzoneSelect = useCallback((feature) => {
    setSelectedSubzone(feature);
    if (feature && !rightOpen) { setRightOpen(true); triggerResize(); }
  }, [rightOpen, triggerResize]);

  // single-value subzone picker (from LeftPanel) -> find feature + auto-select planning area
  const handleSubzonePickByName = useCallback((subzoneName) => {
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
  }, [subzoneData]);

  const clearSubzoneSelection = useCallback(() => setSelectedSubzone(null), []);

  // keep subzone valid against selected planning areas
  useEffect(() => {
    if (!selectedPlanningAreas.length) return setSelectedSubzone(null);
    if (selectedSubzone?.properties?.PLN_AREA_N && !selectedPlanningAreas.includes(selectedSubzone.properties.PLN_AREA_N)) {
      setSelectedSubzone(null);
    }
  }, [selectedPlanningAreas, selectedSubzone]);

  const mapColumnClass = useMemo(() => {
    if (!leftOpen && !rightOpen) return "md:basis-full md:max-w-full";
    if (leftOpen && rightOpen)   return "md:basis-1/2 md:max-w-[50%]";
    return "md:basis-3/4 md:max-w-[75%]";
  }, [leftOpen, rightOpen]);

  /* ---------- render ---------- */
  return (
    <div className="flex min-h-screen flex-col gap-6 px-4 py-6 md:px-6 lg:px-10">
      <div className="flex flex-1 flex-col gap-6 md:flex-row">
        {/* left filters */}
        <aside className={cn("transition-all duration-300 ease-in-out", leftOpen ? "flex flex-col md:basis-1/4 md:max-w-[25%]" : "hidden")} aria-hidden={!leftOpen}>
          <div className={cn("flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-opacity duration-300",
            leftOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}>
            <LeftPanel
              /* planning area */
              options={planningOptions}
              selected={selectedPlanningAreas}
              onSelectionChange={handlePlanningAreaSelection}
              onResetSelection={handleResetPlanningAreas}

              /* subzone (scoped by planning selection) */
              subzoneOptions={subzoneOptions}
              selectedSubzone={selectedSubzone ? String(selectedSubzone?.properties?.SUBZONE_N || "") : ""}
              onSubzonePick={handleSubzonePickByName}

              /* amenities (categories always full list; types dynamic by selected categories) */
              amenityCategoriesOptions={amenityCategories}
              selectedAmenityCategories={selectedAmenityCategories}
              onAmenityCategoriesChange={setSelectedAmenityCategories}
              amenityTypesOptions={amenityTypeOptionsScoped}
              selectedAmenityTypes={selectedAmenityTypes}
              onAmenityTypesChange={setSelectedAmenityTypes}

              /* floods */
              floodTypeOptions={floodTypesAll}
              selectedFloodTypes={selectedFloodTypes}
              onFloodTypesChange={setSelectedFloodTypes}
              floodDateFrom={floodDateFrom}
              floodDateTo={floodDateTo}
              onFloodDateFromChange={setFloodDateFrom}
              onFloodDateToChange={setFloodDateTo}
            />
          </div>
        </aside>

        {/* map */}
        <div className={cn("relative flex min-h-[24rem] grow flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 ease-in-out", mapColumnClass)}>
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="secondary" className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium" onClick={handleToggleLeft}>
              <PanelLeft className="h-4 w-4" />
              <span>{leftOpen ? "Hide filters" : "Show filters"}</span>
            </Button>
            <Button type="button" variant="secondary" className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium" onClick={handleToggleRight}>
              <PanelRight className="h-4 w-4" />
              <span>{rightOpen ? "Hide info" : "Show info"}</span>
            </Button>
          </div>

          <div className="flex-1 min-h-0">
            {MapComponent && (
              <MapComponent
                resizeSignal={resizeSignal}
                selectedPlanningAreas={selectedPlanningAreas}
                selectedSubzone={selectedSubzone}
                onPlanningAreaToggle={handlePlanningAreaFromMap}
                onSubzoneSelect={handleSubzoneSelect}

                /* pass raw datasets + filter state to the map */
                planningData={planningData}
                subzoneData={subzoneData}
                roadData={roadData}
                amenityData={amenityData}
                floodData={floodData}

                selectedAmenityCategories={selectedAmenityCategories}
                selectedAmenityTypes={selectedAmenityTypes}
                onAmenityTypesChange={setSelectedAmenityTypes}
                selectedFloodTypes={selectedFloodTypes}
                onFloodTypesChange={setSelectedFloodTypes}
                floodDateFrom={floodDateFrom}
                floodDateTo={floodDateTo}

                /* discovered options (still handy for legends etc.) */
                amenityTypes={amenityCategories}
                floodTypes={floodTypesAll}

                /* optional if the map still wants to report back */
                onPlanningAreasLoaded={setPlanningAreas}

                /* insights */
                floodStats={floodInsights}
                /* 👇 NEW props for visibility toggles */
                showFloods={showFloods}
                setShowFloods={setShowFloods}
                showAmenities={showAmenities}
                setShowAmenities={setShowAmenities}
              />
            )}
          </div>
        </div>

        {/* right info */}
        <aside className={cn("transition-all duration-300 ease-in-out", rightOpen ? "flex flex-col md:basis-1/4 md:max-w-[25%]" : "hidden")} aria-hidden={!rightOpen}>
          <div className={cn("flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-opacity duration-300",
            rightOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0")}>
            <RightPanel
              feature={selectedSubzone}
              onClearSelection={() => clearSubzoneSelection()}
              stats={floodInsights}
              loading={floodLoading}
              error={floodError}
              selectedPlanningAreas={selectedPlanningAreas}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}







