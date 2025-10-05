  import { useEffect, useMemo, useRef, useState } from "react";
  import mapboxgl from "mapbox-gl";
  import "mapbox-gl/dist/mapbox-gl.css";

  import {
    buildMatchFilter,
    computeFeatureBounds,
    mergeBounds,
    buildChoroplethExpression,
    buildLineWidthExpression,
    aggregateAmenityStats,
  } from "../../../utils/map/helpers";

  import {
    buildFloodHoverHtml,
    buildHoverMarkupPlanning,
    buildHoverMarkupSubzone,
    buildAmenityHoverHtml,
    buildHoverMarkupRoad,
  } from "../../../utils/map/htmlBuilders";

  /* ===== mapbox base config ===== */
  const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
  const MAPBOX_STYLE = "mapbox://styles/mapbox/streets-v12";
  const DEFAULT_CENTER = [103.8198, 1.3521];
  const DEFAULT_ZOOM = 11;

  mapboxgl.accessToken = MAPBOX_TOKEN;
  if (typeof mapboxgl.setTelemetryEnabled === "function") mapboxgl.setTelemetryEnabled(false);

  /* ===== ids ===== */
  const PLANNING_SOURCE_ID = "planning-area";
  const PLANNING_FILL_LAYER_ID = "planning-area-fill";
  const PLANNING_OUTLINE_LAYER_ID = "planning-area-outline";
  const PLANNING_HIGHLIGHT_LAYER_ID = "planning-area-highlight";
  const SUBZONE_SOURCE_ID = "subzone-area";
  const SUBZONE_FILL_LAYER_ID = "subzone-fill";
  const SUBZONE_OUTLINE_LAYER_ID = "subzone-outline";
  const SUBZONE_HIGHLIGHT_LAYER_ID = "subzone-highlight";
  const ROAD_SOURCE_ID = "road-network";
  const ROAD_LAYER_ID = "road-network-line";
  const AMENITY_SOURCE_ID = "amenities";
  const AMENITY_ICON_LAYER_ID = "amenities-icons";
  const FLOOD_SOURCE_ID = "flood-events";
  const FLOOD_LAYER_ID = "flood-events-layer";

  /* hover outlines */
  const PA_HOVER_OUTLINE_ID = "planning-area-hover-outline";
  const PA_HOVER_OUTLINE_INNER_ID = "planning-area-hover-outline-inner";
  const SZ_HOVER_OUTLINE_ID = "subzone-hover-outline";

  /* filters / styling constants */
  const EMPTY_PLANNING_FILTER = ["==", ["get", "PLN_AREA_N"], "__none__"];
  const EMPTY_PA_FILTER = ["==", ["get", "PA_ID"], "__none__"];
  const EMPTY_SUBZONE_HIGHLIGHT = ["==", ["get", "SZ_ID"], "__none__"];

  const PLANNING_COLORS = ["#e0f2fe", "#bae6fd", "#93c5fd", "#60a5fa", "#3b82f6", "#1d4ed8"];
  const SUBZONE_COLORS = ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626"];
  const DEFAULT_PLANNING_COLOR = "#e2e8f0";
  const DEFAULT_SUBZONE_COLOR = "rgba(37, 99, 235, 0.18)";
  const DEFAULT_ROAD_WIDTH = 1.2;
  const HOVER_FILL_COLOR = "#fef08a";

  /* amenity icon helpers */
  const slugify = (s) =>
    s.toString().trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  const amenityIconId = (cat) => `amen_${slugify(cat)}`;
  const amenityIconUrl = (cat) => `/map/markers/${slugify(cat)}.png`;
  const AMENITY_ICON_DEFAULT_ID = "amen_default";
  const AMENITY_ICON_DEFAULT_URL = "/map/markers/default.png";

  /* wrap map.loadImage in a promise */
  const loadImageAsync = (map, url) =>
    new Promise((resolve, reject) => {
      map.loadImage(url, (err, img) => {
        if (err) reject(err);
        else resolve(img);
      });
    });

  /* compute flood counts from FC for choropleths/hover */
  const computeFloodCounts = (floodFc) => {
    const by_pa = {};
    const by_sz = {};
    for (const ft of floodFc?.features ?? []) {
      const p = ft.properties || {};
      const pa = (p.planning_area || p.PLAN_AREA || p.planning || "").toString().trim();
      const sz = (p.subzone || p.SUBZONE_N || "").toString().trim();
      if (pa) by_pa[pa] = (by_pa[pa] ?? 0) + 1;
      if (sz) by_sz[sz] = (by_sz[sz] ?? 0) + 1;
    }
    return { by_pa, by_sz };
  };

  const computeFloodBreakdowns = (floodFc) => {
    const byPa = {};
    const bySz = {};
    for (const ft of floodFc?.features ?? []) {
      const p = ft.properties || {};
      const pa = (p.planning_area || p.PLAN_AREA || p.planning || "").toString().trim();
      const sz = (p.subzone || p.SUBZONE_N || "").toString().trim();
      const ev = (p.event || "").toString().trim() || "unspecified";
      if (pa) {
        byPa[pa] = byPa[pa] || { total: 0, by_category: {} };
        byPa[pa].total += 1;
        byPa[pa].by_category[ev] = (byPa[pa].by_category[ev] ?? 0) + 1;
      }
      if (sz) {
        bySz[sz] = bySz[sz] || { total: 0, by_category: {} };
        bySz[sz].total += 1;
        bySz[sz].by_category[ev] = (bySz[sz].by_category[ev] ?? 0) + 1;
      }
    }
    return { byPa, bySz };
  };

  const normaliseString = (value) => (value ?? "").toString().trim();
  const getPlanningArea = (props) =>
    normaliseString(
      props?.planning_area ??
        props?.PLN_AREA_N ??
        props?.planning ??
        props?.start_planning_area ??
        props?.end_planning_area ??
        ""
    );
  const getFloodType = (props) => normaliseString(props?.event ?? props?.flood_type ?? "").toLowerCase();
  const getEventDate = (props) => normaliseString(props?.event_date ?? props?.date ?? "");
  const isWithinDateRange = (value, fromDate, toDate) => {
    if (!fromDate && !toDate) return true;
    if (!value) return false;
    const candidate = new Date(value);
    if (Number.isNaN(candidate.getTime())) return false;
    if (fromDate && candidate < fromDate) return false;
    if (toDate && candidate > toDate) return false;
    return true;
  };

  function SingaporeHistoricalFloodMap({
    /* parent-driven sizing */
    resizeSignal,

    /* selections */
    selectedPlanningAreas = [],
    selectedSubzone,
    onPlanningAreaToggle,
    onPlanningAreasLoaded,
    onSubzoneSelect,

    /* datasets: now passed from parent (no fetching here) */
    planningData,
    subzoneData,
    roadData,
    amenityData,
    floodData,

    /* options derived in parent */
    amenityTypes = [],
    floodTypes = [],

    /* filter state from parent */
    selectedAmenityCategories = [],
    selectedAmenityTypes = [],
    onAmenityTypesChange,
    selectedFloodTypes = [],
    onFloodTypesChange,
    floodDateFrom = "",
    floodDateTo = "",

    /* derived insights for road width etc */
    floodStats = {},
  }) {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const popupRef = useRef(null);
    const hoverPopupRef = useRef(null);
    const hasLoadedRef = useRef(false);

    /* lookups */
    const planningAreaFeatureRef = useRef({});
    const planningAreaIdRef = useRef({});
    const paIdToNameRef = useRef({});
    const amenityStatsByPARef = useRef({});
    const amenityStatsBySZRef = useRef({});
    const hoveredPlanningIdRef = useRef(null);
    const hoveredSubzoneIdRef = useRef(null);
    const subzoneToPARef = useRef(new Map());
    const lastHadSelectionRef = useRef(false);

    /* flood aggregates */
    const floodByPaOverallRef = useRef({});
    const floodByPaRef = useRef({});
    const floodBySzRef = useRef({});
    const floodCatsByPARef = useRef({});
    const floodCatsBySZRef = useRef({});

    const [error, setError] = useState(null);

    /* local ui */
    const [activeSubzoneName, setActiveSubzoneName] = useState(null);
    const [viewMode, setViewMode] = useState("planning"); // 'planning' | 'subzone'
    const [colorMetric, setColorMetric] = useState("floods"); // 'floods' | 'amenities'
    const [panelOpen, setPanelOpen] = useState(true);
    const [showFloods, setShowFloods] = useState(true);
    const [showAmenities, setShowAmenities] = useState(false);
    const [visibleFloodCount, setVisibleFloodCount] = useState(0);

    const amenityCategoryFilter = useMemo(
      () => (selectedAmenityCategories || []).map((v) => normaliseString(v)).filter(Boolean),
      [selectedAmenityCategories]
    );
    const amenityCategoryFilterSet = useMemo(() => new Set(amenityCategoryFilter), [amenityCategoryFilter]);
    const amenityTypeFilter = useMemo(
      () => (selectedAmenityTypes || []).map((v) => normaliseString(v)).filter(Boolean),
      [selectedAmenityTypes]
    );
    const amenityTypeFilterSet = useMemo(() => new Set(amenityTypeFilter), [amenityTypeFilter]);

    const floodTypeFilter = useMemo(
      () => (selectedFloodTypes || []).map((v) => normaliseString(v)).filter(Boolean),
      [selectedFloodTypes]
    );
    const floodTypeFilterSet = useMemo(() => new Set(floodTypeFilter), [floodTypeFilter]);
    const floodTypeFilterLowerList = useMemo(
      () => floodTypeFilter.map((v) => v.toLowerCase()),
      [floodTypeFilter]
    );

    const handleFloodTypesSelectAll = () => onFloodTypesChange?.(floodTypes);
    const handleFloodTypesClear = () => onFloodTypesChange?.([]);

    const handleFloodTypeToggle = (type, shouldEnable) => {
      if (!onFloodTypesChange) return;
      const normalized = normaliseString(type);
      if (!normalized) return;
      const next = new Set((selectedFloodTypes || []).map((v) => normaliseString(v)).filter(Boolean));
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      const ordered = floodTypes.filter((v) => next.has(normaliseString(v)));
      onFloodTypesChange(ordered);
    };

    const handleAmenityTypesSelectAll = () => onAmenityTypesChange?.(amenityTypes);
    const handleAmenityTypesClear = () => onAmenityTypesChange?.([]);

    const handleAmenityTypeToggle = (type, shouldEnable) => {
      if (!onAmenityTypesChange) return;
      const normalized = normaliseString(type);
      if (!normalized) return;
      const next = new Set((selectedAmenityTypes || []).map((v) => normaliseString(v)).filter(Boolean));
      if (shouldEnable) next.add(normalized);
      else next.delete(normalized);
      const ordered = amenityTypes.filter((v) => next.has(normaliseString(v)));
      onAmenityTypesChange(ordered);
    };

    const hasSelection = selectedPlanningAreas?.length > 0;
    const { roadCountMap = {}, maxRoadCount = 0 } = floodStats ?? {};

    /* popup css once */
    useEffect(() => {
      const id = "map-hover-popup-style";
      if (document.getElementById(id)) return;
      const style = document.createElement("style");
      style.id = id;
      style.innerHTML = `
        .map-hover-popup .mapboxgl-popup-content {
          background: #0b1220; color: #e2e8f0;
          border: 1px solid rgba(148,163,184,0.3);
          border-radius: 10px; padding: 10px 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }
        .map-hover-popup .mapboxgl-popup-tip { border-top-color: #0b1220 !important; border-bottom-color: #0b1220 !important; }
        .map-hover-popup .section-title { font-weight: 700; color: #fff; margin-bottom: 4px; }
        .map-hover-popup .kv { color:#cbd5e1 }
        .map-hover-popup .kv strong { color:#fff }
      `;
      document.head.appendChild(style);
    }, []);

    const showHoverPopup = (map, lngLat, html) => {
      if (!hoverPopupRef.current) {
        hoverPopupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          closeOnMove: false,
          offset: [0, -12],
          className: "map-hover-popup",
        });
      }
      hoverPopupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
    };
    const showClickPopup = (map, lngLat, html) => {
      if (!popupRef.current) {
        popupRef.current = new mapboxgl.Popup({
          closeButton: true,
          closeOnClick: true,
          offset: [0, -12],
          className: "map-hover-popup",
        });
      }
      popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map);
    };

    const recomputeVisibleFloods = () => {
      const map = mapRef.current;
      if (!map || !hasLoadedRef.current || !map.getLayer(FLOOD_LAYER_ID) || !showFloods) {
        setVisibleFloodCount(0);
        return;
      }
      const features = map.queryRenderedFeatures({ layers: [FLOOD_LAYER_ID] }) || [];
      setVisibleFloodCount(features.length);
    };

    const loadAmenityIcons = async (map, categories) => {
      if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
        try {
          const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
          map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
        } catch {}
      }
      await Promise.allSettled(
        categories.map(async (cat) => {
          const id = amenityIconId(cat);
          if (map.hasImage(id)) return;
          try {
            const img = await loadImageAsync(map, amenityIconUrl(cat));
            map.addImage(id, img, { pixelRatio: 2 });
          } catch {}
        })
      );
      map.on("styleimagemissing", async (e) => {
        const id = e?.id || "";
        if (!id.startsWith("amen_") || map.hasImage(id)) return;
        try {
          const img = await loadImageAsync(map, `/map/markers/${id.replace(/^amen_/, "")}.png`);
          map.addImage(id, img, { pixelRatio: 2 });
          map.triggerRepaint();
        } catch {
          if (AMENITY_ICON_DEFAULT_URL && !map.hasImage(AMENITY_ICON_DEFAULT_ID)) {
            try {
              const defImg = await loadImageAsync(map, AMENITY_ICON_DEFAULT_URL);
              map.addImage(AMENITY_ICON_DEFAULT_ID, defImg, { pixelRatio: 2 });
              map.triggerRepaint();
            } catch {}
          }
        }
      });
    };

    const buildAmenityIconExpression = (cats) => {
      const expr = ["match", ["to-string", ["get", "amenity_category"]]];
      for (const c of cats) expr.push(c, amenityIconId(c));
      expr.push(AMENITY_ICON_DEFAULT_ID); // fallback
      return expr;
    };


    /* --------- map init (no fetching) ---------- */
    useEffect(() => {
      if (mapRef.current) return;
      if (!mapboxgl.supported()) {
        setError("webgl is not supported in this browser or device.");
        return;
      }

      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: MAPBOX_STYLE,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

      const handleBackgroundClick = (event) => {
        const features = map.queryRenderedFeatures(event.point, {
          layers: [PLANNING_FILL_LAYER_ID, SUBZONE_FILL_LAYER_ID],
        });
        if (!features.length) {
          onPlanningAreaToggle?.(null);
          setViewMode("planning");
          setActiveSubzoneName(null);
        }
      };

      const handleLoad = async () => {
        try {
          /* guard: we need parent data to be ready */
          if (!planningData || !subzoneData || !roadData || !amenityData || !floodData) {
            setError("datasets not ready yet.");
            return;
          }

          /* amenity aggregates for hover + “amenities count” metric */
          const { byPA, bySZ } = aggregateAmenityStats(amenityData);
          amenityStatsByPARef.current = byPA;
          amenityStatsBySZRef.current = bySZ;

          /* collect planning areas + id map */
          const paNames = [];
          const featureMap = {};
          const idMap = {};
          for (const feature of planningData.features ?? []) {
            const name = feature?.properties?.PLN_AREA_N?.trim();
            if (!name) continue;
            paNames.push(name);
            featureMap[name] = feature;
            const paId = feature?.properties?.PA_ID;
            if (paId != null) idMap[name] = String(paId);
          }
          planningAreaFeatureRef.current = featureMap;
          planningAreaIdRef.current = idMap;
          paIdToNameRef.current = Object.fromEntries(Object.entries(idMap).map(([k, v]) => [v, k]));
          if (paNames.length) onPlanningAreasLoaded?.(paNames);

          /* subzone -> PA map */
          const szToPA = new Map();
          for (const f of subzoneData.features ?? []) {
            const sz = (f?.properties?.SUBZONE_N ?? "").toString().trim();
            const pa = (f?.properties?.PLN_AREA_N ?? "").toString().trim();
            if (!sz || !pa) continue;
            if (!szToPA.has(sz)) szToPA.set(sz, new Set());
            szToPA.get(sz).add(pa);
          }
          subzoneToPARef.current = szToPA;

          /* flood counts & breakdowns for choropleths/hover */
          const { by_pa, by_sz } = computeFloodCounts(floodData);
          floodByPaOverallRef.current = by_pa;
          floodByPaRef.current = by_pa; // same totals; we scope later if needed
          floodBySzRef.current = by_sz;

          const { byPa: floodCatsPa, bySz: floodCatsSz } = computeFloodBreakdowns(floodData);
          floodCatsByPARef.current = floodCatsPa;
          floodCatsBySZRef.current = floodCatsSz;

          /* sources */
          map.addSource(PLANNING_SOURCE_ID, { type: "geojson", data: planningData, generateId: true });
          map.addSource(SUBZONE_SOURCE_ID, { type: "geojson", data: subzoneData, generateId: true });
          map.addSource(ROAD_SOURCE_ID, { type: "geojson", data: roadData });
          map.addSource(AMENITY_SOURCE_ID, { type: "geojson", data: amenityData, generateId: true });
          map.addSource(FLOOD_SOURCE_ID, { type: "geojson", data: floodData, generateId: true });

          /* base layers */
          map.addLayer({
            id: PLANNING_FILL_LAYER_ID,
            type: "fill",
            source: PLANNING_SOURCE_ID,
            paint: { "fill-color": DEFAULT_PLANNING_COLOR, "fill-opacity": 0.75 },
          });
          map.addLayer({
            id: PLANNING_OUTLINE_LAYER_ID,
            type: "line",
            source: PLANNING_SOURCE_ID,
            paint: { "line-color": "#1d4ed8", "line-width": 1.25, "line-opacity": 0.4 },
          });
          map.addLayer({
            id: PLANNING_HIGHLIGHT_LAYER_ID,
            type: "line",
            source: PLANNING_SOURCE_ID,
            paint: { "line-color": "#f97316", "line-width": 3, "line-opacity": 0.9 },
            filter: EMPTY_PLANNING_FILTER,
          });

          map.addLayer({
            id: SUBZONE_FILL_LAYER_ID,
            type: "fill",
            source: SUBZONE_SOURCE_ID,
            layout: { visibility: "none" },
            paint: { "fill-color": DEFAULT_SUBZONE_COLOR, "fill-opacity": 0.55 },
          });
          map.addLayer({
            id: SUBZONE_OUTLINE_LAYER_ID,
            type: "line",
            source: SUBZONE_SOURCE_ID,
            layout: { visibility: "none" },
            paint: { "line-color": "#1d4ed8", "line-width": 0.8, "line-opacity": 0.7 },
          });
          map.addLayer({
            id: SUBZONE_HIGHLIGHT_LAYER_ID,
            type: "line",
            source: SUBZONE_SOURCE_ID,
            layout: { visibility: "none" },
            paint: { "line-color": "#fbbf24", "line-width": 3, "line-opacity": 0.9 },
            filter: EMPTY_SUBZONE_HIGHLIGHT,
          });

          map.addLayer({
            id: ROAD_LAYER_ID,
            type: "line",
            source: ROAD_SOURCE_ID,
            layout: { visibility: "none" },
            paint: { "line-color": "#f97316", "line-width": DEFAULT_ROAD_WIDTH, "line-opacity": 0.85 },
            filter: EMPTY_PA_FILTER,
          });

          /* amenities as SYMBOL icons (hidden by default) */
          const derivedAmenityCats =
            (amenityTypes && amenityTypes.length)
              ? amenityTypes
              : Array.from(new Set(
                  (amenityData.features ?? [])
                    .map(f => (f.properties?.amenity_category ?? "").toString().trim())
                    .filter(Boolean)
                )).sort();

          await loadAmenityIcons(map, derivedAmenityCats);

          map.addLayer({
            id: AMENITY_ICON_LAYER_ID,
            type: "symbol",
            source: AMENITY_SOURCE_ID,
            layout: {
              visibility: "visible",
              "icon-image": buildAmenityIconExpression(derivedAmenityCats),
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-anchor": "bottom",
              // If your PNGs are 256×256 and you want 32×32 on map:
              "icon-size": 0.125,
            },
          });

          /* flood markers */
          map.addLayer({
            id: FLOOD_LAYER_ID,
            type: "circle",
            source: FLOOD_SOURCE_ID,
            layout: { visibility: "visible" },
            paint: {
              "circle-color": "#38bdf8",
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 5, 16, 7],
              "circle-stroke-width": 1.2,
              "circle-stroke-color": "#ffffff",
              "circle-opacity": 0.95,
            },
          });

          /* hover outlines */
          map.addLayer({
            id: PA_HOVER_OUTLINE_ID,
            type: "line",
            source: PLANNING_SOURCE_ID,
            paint: {
              "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
              "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 5, 0],
              "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
            },
          });
          map.addLayer({
            id: PA_HOVER_OUTLINE_INNER_ID,
            type: "line",
            source: PLANNING_SOURCE_ID,
            paint: {
              "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#60a5fa", "rgba(0,0,0,0)"],
              "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 0],
              "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
            },
          });
          map.addLayer({
            id: SZ_HOVER_OUTLINE_ID,
            type: "line",
            source: SUBZONE_SOURCE_ID,
            layout: { visibility: "none" },
            paint: {
              "line-color": ["case", ["boolean", ["feature-state", "hover"], false], "#ffffff", "rgba(0,0,0,0)"],
              "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 4, 0],
              "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.9, 0],
            },
          });

          /* cursors */
          map.on("mouseenter", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
          map.on("mouseenter", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
          map.on("mouseenter", AMENITY_ICON_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", AMENITY_ICON_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
          map.on("mouseenter", ROAD_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", ROAD_LAYER_ID, () => (map.getCanvas().style.cursor = ""));
          map.on("mouseenter", FLOOD_LAYER_ID, () => (map.getCanvas().style.cursor = "pointer"));
          map.on("mouseleave", FLOOD_LAYER_ID, () => (map.getCanvas().style.cursor = ""));

          /* clicks */
          map.on("click", PLANNING_FILL_LAYER_ID, (event) => {
            const feature = event.features?.[0];
            const name = feature?.properties?.PLN_AREA_N?.trim();
            if (!name) return;
            const bounds = computeFeatureBounds(feature.geometry);
            if (bounds) map.fitBounds(bounds, { padding: 48, duration: 800, maxZoom: 13 });
            onPlanningAreaToggle?.(name);
            setViewMode("subzone");
            setActiveSubzoneName(null);
            setShowAmenities(true);
          });

          map.on("click", SUBZONE_FILL_LAYER_ID, (event) => {
            const feature = event.features?.[0];
            if (!feature) return;
            const properties = feature?.properties ? { ...feature.properties } : null;
            if (!properties) return;
            const payload = {
              properties,
              lngLat: [event.lngLat.lng, event.lngLat.lat],
              id: properties.SZ_ID ?? feature?.id ?? null,
            };
            map.flyTo({
              center: event.lngLat,
              zoom: Math.max(map.getZoom(), 12),
              essential: true,
              speed: 0.9,
              curve: 1.2,
            });
            onSubzoneSelect?.(payload);
            setActiveSubzoneName((properties.SUBZONE_N ?? "").toString().trim());
            setShowAmenities(true);
          });

          map.on("click", handleBackgroundClick);

          /* hovers */
          map.on("mousemove", PLANNING_FILL_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const id = f.id;
            if (hoveredPlanningIdRef.current !== null && hoveredPlanningIdRef.current !== id) {
              map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
            }
            hoveredPlanningIdRef.current = id;
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id }, { hover: true });
            + showHoverPopup(map, e.lngLat, buildHoverMarkupPlanning(
            f.properties,
            // Use filtered map so "total" reflects current filters
            floodByPaRef.current,
            // Keep filtered here as well for any “scoped/selected” section
            floodByPaRef.current,
            amenityStatsByPARef,
            floodCatsByPARef
          ));
          });
          map.on("mouseleave", PLANNING_FILL_LAYER_ID, () => {
            if (hoveredPlanningIdRef.current !== null) {
              map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
              hoveredPlanningIdRef.current = null;
            }
            if (hoverPopupRef.current) {
              hoverPopupRef.current.remove();
              hoverPopupRef.current = null;
            }
          });

          map.on("mousemove", SUBZONE_FILL_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const id = f.id;
            if (hoveredSubzoneIdRef.current !== null && hoveredSubzoneIdRef.current !== id) {
              map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
            }
            hoveredSubzoneIdRef.current = id;
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id }, { hover: true });
            showHoverPopup(
              map,
              e.lngLat,
              buildHoverMarkupSubzone(f.properties, floodBySzRef.current, amenityStatsBySZRef, floodCatsBySZRef)
            );
          });
          map.on("mouseleave", SUBZONE_FILL_LAYER_ID, () => {
            if (hoveredSubzoneIdRef.current !== null) {
              map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
              hoveredSubzoneIdRef.current = null;
            }
            if (hoverPopupRef.current) {
              hoverPopupRef.current.remove();
              hoverPopupRef.current = null;
            }
          });

          map.on("mousemove", AMENITY_ICON_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const html = buildAmenityHoverHtml(f.properties);
            const activeAmenityFilters = amenityCategoryFilter.length ? amenityCategoryFilter : amenityTypeFilter;
            const extras = `
              <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25)">
                <div style="font-size:11px; color:#94a3b8">
                  active amenity filters: <span style="color:#e2e8f0">${
                    activeAmenityFilters.length ? activeAmenityFilters.join(", ") : "none"
                  }</span>
                </div>
              </div>`;
            showHoverPopup(map, e.lngLat, html + extras);
          });
          map.on("mouseleave", AMENITY_ICON_LAYER_ID, () => {
            if (hoverPopupRef.current) {
              hoverPopupRef.current.remove();
              hoverPopupRef.current = null;
            }
          });

          map.on("mousemove", ROAD_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            showHoverPopup(map, e.lngLat, buildHoverMarkupRoad(f.properties, roadCountMap, paIdToNameRef, amenityStatsByPARef));
          });
          map.on("mouseleave", ROAD_LAYER_ID, () => {
            if (hoverPopupRef.current) {
              hoverPopupRef.current.remove();
              hoverPopupRef.current = null;
            }
          });

          map.on("mousemove", FLOOD_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const html = buildFloodHoverHtml(f.properties);
            const activeFloodTypes = floodTypeFilter.length ? floodTypeFilter : [];
            const extras = `
              <div style="margin-top:8px; padding-top:6px; border-top:1px solid rgba(148,163,184,0.25)">
                <div style="font-size:11px; color:#94a3b8">
                  active flood types: <span style="color:#e2e8f0">${
                    activeFloodTypes.length ? activeFloodTypes.join(", ") : "none"
                  }</span>
                </div>
              </div>`;
            showHoverPopup(map, e.lngLat, html + extras);
          });
          map.on("mouseleave", FLOOD_LAYER_ID, () => {
            if (hoverPopupRef.current) {
              hoverPopupRef.current.remove();
              hoverPopupRef.current = null;
            }
          });
          map.on("click", FLOOD_LAYER_ID, (e) => {
            const f = e.features?.[0];
            if (!f) return;
            showClickPopup(map, e.lngLat, buildFloodHoverHtml(f.properties));
          });

          map.on("moveend", recomputeVisibleFloods);
          map.on("idle", recomputeVisibleFloods);

          setError(null);
          hasLoadedRef.current = true;
        } catch (err) {
          console.error(err);
          setError("unable to initialise map.");
        }
      };

      map.on("load", handleLoad);
      map.on("error", (evt) => {
        console.error("mapbox gl error:", evt?.error);
        setError("the map failed to load. check your token or network connection.");
      });

      return () => {
        map.off("load", handleLoad);
        map.off("click", handleBackgroundClick);
        try {
          if (hoveredPlanningIdRef.current !== null)
            map.setFeatureState({ source: PLANNING_SOURCE_ID, id: hoveredPlanningIdRef.current }, { hover: false });
          if (hoveredSubzoneIdRef.current !== null)
            map.setFeatureState({ source: SUBZONE_SOURCE_ID, id: hoveredSubzoneIdRef.current }, { hover: false });
        } catch {}
        if (hoverPopupRef.current) {
          hoverPopupRef.current.remove();
          hoverPopupRef.current = null;
        }
        if (popupRef.current) {
          popupRef.current.remove();
          popupRef.current = null;
        }
        hasLoadedRef.current = false;
        try {
          if (map && map.remove) map.remove();
        } catch {}
        mapRef.current = null;
      };
    }, [
      planningData,
      subzoneData,
      roadData,
      amenityData,
      floodData,
      amenityTypes,
      floodTypes,
      onPlanningAreaToggle,
      onPlanningAreasLoaded,
      onSubzoneSelect,
    ]);

    /* amenity aggregates update when filters change */
    useEffect(() => {
      if (!amenityData) return;
      const categorySet = new Set(amenityCategoryFilter);
      const typeSet = new Set(amenityTypeFilter);
      const features =
        (amenityData.features || []).filter((feature) => {
          const props = feature?.properties || {};
          if (categorySet.size) {
            const category = normaliseString(props?.amenity_category);
            if (!categorySet.has(category)) return false;
          }
          if (typeSet.size) {
            const type = normaliseString(props?.amenity_type);
            if (!typeSet.has(type)) return false;
          }
          return true;
        }) || [];
      const filtered = { type: "FeatureCollection", features };
      const { byPA, bySZ } = aggregateAmenityStats(filtered);
      amenityStatsByPARef.current = byPA;
      amenityStatsBySZRef.current = bySZ;
    }, [amenityData, amenityCategoryFilter, amenityTypeFilter]);

    /* flood aggregates update when filters change */
    useEffect(() => {
      if (!floodData) return;
      const planningSet = new Set((selectedPlanningAreas || []).map((name) => normaliseString(name)));
      const typeSet = new Set(floodTypeFilterLowerList);
      const fromDateRaw = floodDateFrom ? new Date(floodDateFrom) : null;
      const toDateRaw = floodDateTo ? new Date(floodDateTo) : null;
      const fromDate = fromDateRaw && !Number.isNaN(fromDateRaw.getTime()) ? fromDateRaw : null;
      const toDate = toDateRaw && !Number.isNaN(toDateRaw.getTime()) ? toDateRaw : null;

      const features = (floodData.features || []).filter((feature) => {
        const props = feature?.properties || {};
        if (planningSet.size) {
          const planningArea = getPlanningArea(props);
          if (!planningSet.has(planningArea)) return false;
        }
        if (typeSet.size) {
          const type = getFloodType(props);
          if (!typeSet.has(type)) return false;
        }
        if ((fromDate || toDate) && !isWithinDateRange(getEventDate(props), fromDate, toDate)) {
          return false;
        }
        return true;
      });

      const filteredFc = { type: "FeatureCollection", features };
      const { by_pa, by_sz } = computeFloodCounts(filteredFc);
      floodByPaRef.current = by_pa;
      floodBySzRef.current = by_sz;

      const { byPa, bySz } = computeFloodBreakdowns(filteredFc);
      floodCatsByPARef.current = byPa;
      floodCatsBySZRef.current = bySz;
    }, [floodData, selectedPlanningAreas, floodTypeFilterLowerList, floodDateFrom, floodDateTo]);

    /* layer filters & visibility toggles */
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !hasLoadedRef.current) return;
      if (
        !map.getLayer(SUBZONE_FILL_LAYER_ID) ||
        !map.getLayer(ROAD_LAYER_ID) ||
        !map.getLayer(PLANNING_HIGHLIGHT_LAYER_ID)
      ) {
        return;
      }

      const hasSelectionLocal = selectedPlanningAreas?.length > 0;

      const subzoneFilterExpr = buildMatchFilter("PLN_AREA_N", selectedPlanningAreas);
      map.setFilter(SUBZONE_FILL_LAYER_ID, subzoneFilterExpr);
      map.setFilter(SUBZONE_OUTLINE_LAYER_ID, subzoneFilterExpr);
      map.setFilter(PLANNING_HIGHLIGHT_LAYER_ID, hasSelectionLocal ? subzoneFilterExpr : EMPTY_PLANNING_FILTER);

      const paIds = (selectedPlanningAreas || []).map((name) => planningAreaIdRef.current[name]).filter(Boolean);
      map.setFilter(ROAD_LAYER_ID, buildMatchFilter("PA_ID", paIds));
      map.setLayoutProperty(ROAD_LAYER_ID, "visibility", hasSelectionLocal && paIds.length > 0 ? "visible" : "none");

      const subzoneVisible = viewMode === "subzone" && hasSelectionLocal ? "visible" : "none";
      map.setLayoutProperty(SUBZONE_FILL_LAYER_ID, "visibility", subzoneVisible);
      map.setLayoutProperty(SUBZONE_OUTLINE_LAYER_ID, "visibility", subzoneVisible);
      map.setLayoutProperty(SUBZONE_HIGHLIGHT_LAYER_ID, "visibility", subzoneVisible);
      if (map.getLayer(SZ_HOVER_OUTLINE_ID)) {
        map.setLayoutProperty(SZ_HOVER_OUTLINE_ID, "visibility", subzoneVisible);
      }

      if (map.getLayer(AMENITY_ICON_LAYER_ID)) {
      const subzoneName =
        (selectedSubzone?.properties?.SUBZONE_N ?? "").toString().trim() || (activeSubzoneName ?? "");
        const hasSubzone = Boolean(subzoneName);
        const hasPA = hasSelectionLocal;

        const amenityClauses = ["all"];
        if (hasSelectionLocal) {
          amenityClauses.push(buildMatchFilter("planning_area", selectedPlanningAreas));
        }
        if (subzoneName) {
          amenityClauses.push(["==", ["to-string", ["coalesce", ["get", "subzone"], ""]], subzoneName]);
        }
        if (amenityCategoryFilter.length) {
          amenityClauses.push([
            "in",
            ["to-string", ["coalesce", ["get", "amenity_category"], ""]],
            ["literal", amenityCategoryFilter],
          ]);
        }
        if (amenityTypeFilter.length) {
          amenityClauses.push([
            "in",
            ["to-string", ["coalesce", ["get", "amenity_type"], ""]],
            ["literal", amenityTypeFilter],
          ]);
        }
        map.setFilter(AMENITY_ICON_LAYER_ID, amenityClauses);
        map.setLayoutProperty(
          AMENITY_ICON_LAYER_ID,
          "visibility",
          showAmenities && (hasSubzone || hasPA) ? "visible" : "none"
        );
      }

      if (map.getLayer(FLOOD_LAYER_ID)) {
        const floodClauses = ["all"];
        if (hasSelectionLocal) {
          floodClauses.push(buildMatchFilter("planning_area", selectedPlanningAreas));
        }
        if (floodTypeFilterLowerList.length) {
          floodClauses.push([
            "in",
            ["downcase", ["to-string", ["coalesce", ["get", "event"], ["get", "flood_type"], ""]]],
          ["literal", floodTypeFilterLowerList],
          ]);
        }
        if (floodDateFrom || floodDateTo) {
          const buildDateExpr = () => ["to-string", ["coalesce", ["get", "event_date"], ["get", "date"], ""]];
          floodClauses.push(["!=", buildDateExpr(), ""]);
          if (floodDateFrom) floodClauses.push([">=", buildDateExpr(), floodDateFrom]);
          if (floodDateTo) floodClauses.push(["<=", buildDateExpr(), floodDateTo]);
        }
        map.setFilter(FLOOD_LAYER_ID, floodClauses);
        map.setLayoutProperty(FLOOD_LAYER_ID, "visibility", showFloods ? "visible" : "none");
      }

      const onceIdle = () => recomputeVisibleFloods();
      map.once("idle", onceIdle);

      if (!hasSelectionLocal && lastHadSelectionRef.current) {
        setViewMode("planning");
        setShowAmenities(true);
        setActiveSubzoneName(null);
        if (hoverPopupRef.current) {
          hoverPopupRef.current.remove();
          hoverPopupRef.current = null;
        }
        map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 800 });
      }
      lastHadSelectionRef.current = hasSelectionLocal;

      if (hasSelectionLocal) {
        let combinedBounds = null;
        for (const areaName of selectedPlanningAreas) {
          const feature = planningAreaFeatureRef.current[areaName];
          if (!feature) continue;
          const bounds = computeFeatureBounds(feature.geometry);
          combinedBounds = mergeBounds(combinedBounds, bounds);
        }
        if (combinedBounds) map.fitBounds(combinedBounds, { padding: 48, duration: 800, maxZoom: 13 });
      }

      return () => {
        try {
          map.off("idle", onceIdle);
        } catch {}
      };
    }, [
      selectedPlanningAreas,
      selectedSubzone,
      activeSubzoneName,
      viewMode,
      showAmenities,
      showFloods,
      amenityCategoryFilter,
      amenityTypeFilter,
      floodTypeFilterLowerList,
      floodDateFrom,
      floodDateTo,
      floodStats,
    ]);

    useEffect(() => {
      recomputeVisibleFloods();
    }, [resizeSignal]);

    /* choropleths & road width */
    const getPlanningColoring = () => {
      if (colorMetric === "amenities") {
        const mapm = amenityStatsByPARef.current || {};
        const countMap = Object.fromEntries(Object.entries(mapm).map(([k, v]) => [k, v.total || 0]));
        const maxCount = Math.max(1, ...Object.values(countMap), 1);
        return { countMap, maxCount };
      }
      const countMap = hasSelection ? floodByPaRef.current || {} : floodByPaOverallRef.current || {};
      const vals = Object.values(countMap || {});
      const maxCount = vals.length ? Math.max(...vals, 1) : 1;
      return { countMap, maxCount };
    };

    const getSubzoneColoring = () => {
      if (colorMetric === "amenities") {
        const base = Object.fromEntries(
          Object.entries(amenityStatsBySZRef.current || {}).map(([k, v]) => [k, v.total || 0])
        );
        const vals = Object.values(base);
        return { countMap: base, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
      }
      const base_map = floodBySzRef.current || {};
      if (!selectedPlanningAreas?.length) {
        const vals = Object.values(base_map);
        return { countMap: base_map, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
      }
      const scoped = {};
      for (const [sz, val] of Object.entries(base_map)) {
        const pa_set = subzoneToPARef.current.get(sz);
        if (!pa_set) continue;
        for (const pa of pa_set) {
          if (selectedPlanningAreas.includes(pa)) {
            scoped[sz] = (scoped[sz] ?? 0) + Number(val || 0);
            break;
          }
        }
      }
      const vals = Object.values(scoped);
      return { countMap: scoped, maxCount: vals.length ? Math.max(...vals, 1) : 1 };
    };

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !hasLoadedRef.current || !map.getLayer(PLANNING_FILL_LAYER_ID)) return;

      // planning choropleth
      const { countMap: paCounts, maxCount: paMax } = getPlanningColoring();
      const planningExpr = buildChoroplethExpression(
        "PLN_AREA_N",
        paCounts,
        paMax,
        PLANNING_COLORS,
        DEFAULT_PLANNING_COLOR
      );
      map.setPaintProperty(PLANNING_FILL_LAYER_ID, "fill-color", [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        HOVER_FILL_COLOR,
        planningExpr,
      ]);
      map.setPaintProperty(
        PLANNING_FILL_LAYER_ID,
        "fill-opacity",
        viewMode === "subzone"
          ? 0.15
          : ["case", ["boolean", ["feature-state", "hover"], false], 0.95, 0.75]
      );

      // subzone choropleth
      if (map.getLayer(SUBZONE_FILL_LAYER_ID)) {
        if (viewMode === "subzone" && selectedPlanningAreas.length > 0) {
          const { countMap: szCounts, maxCount: szMax } = getSubzoneColoring();
          const subzoneExpr = buildChoroplethExpression(
            "SUBZONE_N",
            szCounts,
            szMax,
            SUBZONE_COLORS,
            DEFAULT_SUBZONE_COLOR
          );
          map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-color", [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            HOVER_FILL_COLOR,
            subzoneExpr,
          ]);
          map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-opacity", [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.9,
            0.6,
          ]);
        } else {
          map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-color", DEFAULT_SUBZONE_COLOR);
          map.setPaintProperty(SUBZONE_FILL_LAYER_ID, "fill-opacity", 0.0);
        }
      }

      // roads width
      if (map.getLayer(ROAD_LAYER_ID)) {
        const roadWidthExpression =
          selectedPlanningAreas.length > 0
            ? buildLineWidthExpression(
                ["coalesce", ["get", "RN_ID"], ["get", "RD_NAME"]],
                roadCountMap ?? {},
                maxRoadCount ?? 0,
                1.2,
                6,
                DEFAULT_ROAD_WIDTH
              )
            : DEFAULT_ROAD_WIDTH;
        map.setPaintProperty(ROAD_LAYER_ID, "line-width", roadWidthExpression);
      }
    }, [
      selectedPlanningAreas,
      viewMode,
      colorMetric,
      floodStats,
      // force rebuild when filters that feed the refs change
      amenityCategoryFilter,
      amenityTypeFilter,
      floodTypeFilterLowerList,
      floodDateFrom,
      floodDateTo,
    ]);

    /* legend */
    const legendTitle =
      viewMode === "subzone"
        ? colorMetric === "amenities"
          ? "subzone amenities (count)"
          : "subzone flood choropleth"
        : colorMetric === "amenities"
        ? "planning area amenities (count)"
        : "planning area flood choropleth";

    const legendMax = (() => {
      if (viewMode === "subzone") {
        const { maxCount } = getSubzoneColoring();
        return maxCount || 0;
      }
      const { maxCount } = getPlanningColoring();
      return maxCount || 0;
    })();

    return (
      <div className="relative h-full min-h-[24rem] w-full">
        <div ref={mapContainerRef} className="absolute inset-0 map-container" />

        {/* collapse/expand fab */}
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="absolute right-3 top-3 sm:right-4 sm:top-4 z-10 rounded-full bg-slate-900/90 border border-white/10 px-3 py-1.5 text-xs text-slate-200 shadow-lg hover:bg-slate-800"
          aria-label={panelOpen ? "collapse controls" : "expand controls"}
        >
          {panelOpen ? "hide controls" : "show controls"}
        </button>

        {/* small built-in controls */}
        {panelOpen && (
          <div className="pointer-events-none absolute right-3 top-12 sm:right-4 sm:top-14 flex flex-col items-end gap-3">
            <div className="pointer-events-auto rounded-xl bg-slate-900/90 border border-white/10 shadow-lg p-3 text-xs text-slate-200 w-[300px]">
              <div className="font-semibold text-slate-100 mb-2">display</div>

              <label className="block mb-2">
                <span className="text-slate-300">color by</span>
                <select
                  className="mt-1 w-full rounded bg-slate-800 border border-slate-600 p-1.5"
                  value={colorMetric}
                  onChange={(e) => setColorMetric(e.target.value)}
                >
                  <option value="floods">flood events</option>
                  <option value="amenities">amenities (count)</option>
                </select>
              </label>

              <label className="inline-flex items-center gap-2 mt-1">
                <input type="checkbox" checked={showFloods} onChange={(e) => setShowFloods(e.target.checked)} />
                <span>
                  show flood markers{" "}
                  {showFloods ? <span className="text-slate-400">({visibleFloodCount} shown)</span> : null}
                </span>
              </label>

              {showFloods ? (
                <div className="mt-2">
                  <div className="mb-1 text-[11px] text-slate-300">flood types (from “event”)</div>
                  <div className="flex gap-2 mb-2">
                    <button
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                      onClick={handleFloodTypesSelectAll}
                      type="button"
                      disabled={!onFloodTypesChange}
                    >
                      select all
                    </button>
                    <button
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                      onClick={handleFloodTypesClear}
                      type="button"
                      disabled={!onFloodTypesChange}
                    >
                      clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-auto pr-1 space-y-1">
                    {floodTypes.map((t) => {
                      const normalized = normaliseString(t);
                      const checked = floodTypeFilterSet.has(normalized);
                      return (
                        <label key={t} className="flex items-center gap-2 text-[11px]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => handleFloodTypeToggle(t, e.target.checked)}
                          />
                          <span className="truncate">{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <label className="inline-flex items-center gap-2 mt-3">
                <input type="checkbox" checked={showAmenities} onChange={(e) => setShowAmenities(e.target.checked)} />
                <span>
                  show amenities{" "}
                  {(selectedSubzone?.properties?.SUBZONE_N || activeSubzoneName)
                    ? " (subzone)"
                    : hasSelection
                    ? " (planning area)"
                    : " (all)"}
                </span>
              </label>

              {showAmenities ? (
                <div className="mt-2">
                  <div className="mb-1 text-[11px] text-slate-300">amenity types</div>
                  <div className="flex gap-2 mb-2">
                    <button
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                      onClick={handleAmenityTypesSelectAll}
                      type="button"
                      disabled={!onAmenityTypesChange}
                    >
                      select all
                    </button>
                    <button
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px]"
                      onClick={handleAmenityTypesClear}
                      type="button"
                      disabled={!onAmenityTypesChange}
                    >
                      clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-auto pr-1 space-y-1">
                    {amenityTypes.map((t) => {
                      const normalized = normaliseString(t);
                      const checked = amenityTypeFilterSet.has(normalized);
                      return (
                        <label key={t} className="flex items-center gap-2 text-[11px]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => handleAmenityTypeToggle(t, e.target.checked)}
                          />
                          <span className="truncate">{t}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {viewMode === "planning" && (
                <div className="mt-2 text-[11px] text-slate-400">click a planning area to drill into subzones.</div>
              )}
            </div>
          </div>
        )}

        {/* legend */}
        <div className="pointer-events-none absolute left-3 bottom-3 sm:left-4 sm:bottom-4">
          <div className="pointer-events-auto rounded-xl bg-slate-900/90 border border-white/10 shadow-lg p-3 text-xs text-slate-200 min-w-[220px]">
            <div className="font-semibold text-slate-100">{legendTitle}</div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex h-2 flex-1 overflow-hidden rounded">
                {(viewMode === "subzone" ? SUBZONE_COLORS : PLANNING_COLORS).map((c, i) => (
                  <span key={i} style={{ backgroundColor: c }} className="h-full flex-1" />
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-300">0</span>
                <span className="text-slate-500">/</span>
                <span className="text-slate-100 font-semibold">{legendMax}</span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full border border-white"
                style={{ backgroundColor: "#38bdf8" }}
              />
              <span className="text-slate-300">flood event</span>
            </div>

            {selectedPlanningAreas?.length > 0 && (
              <div className="mt-2 text-[11px] text-slate-400">
                filtering to:{" "}
                <span className="ml-1 font-medium text-slate-200">
                  {selectedPlanningAreas.join(", ")}
                </span>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="absolute inset-0 grid place-items-center bg-slate-900/70 p-6 text-white">
            <div className="w-full max-w-sm rounded-xl bg-slate-900/90 p-5 text-center shadow-xl">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-200">map unavailable</p>
              <p className="mt-2 text-sm text-slate-100">{error}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  export default SingaporeHistoricalFloodMap;
