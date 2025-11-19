import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin, Search, X } from "lucide-react";
import * as turf from "@turf/turf";
import { to_title_case } from "./utils";
import { useState } from "react";

/* expects percentile as 0–1 (e.g. 0.92 = 92nd percentile → TOP 8%) */
function topPercentLabel(p) {
  if (p == null || Number.isNaN(p)) return "No rank";
  const percentile = Math.max(0, Math.min(1, Number(p)));
  const top = Math.max(1, Math.round(100 - percentile * 100));
  return `TOP ${top}%`;
}

  function getRoadKey(r) {
  return (
    r.rn_id?.toString() ||
    r.RN_ID?.toString() ||
    r.id?.toString() ||
    `${r.name}-${r.lat}-${r.lng}` // fallback
  );
}


// tiny panel – our own div, very small padding
function Panel({ title, children, className = "" }) {
  return (
    <section
      className={`rounded-2xl border border-border/70 bg-background/80 px-3 py-2 space-y-2 ${className}`}
    >
      {title && (
        <header className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">{title}</h4>
        </header>
      )}
      {children}
    </section>
  );
}

export default function FloodEventDetails({
  selected,
  selected_props,
  selected_stats,
  panel_tab,
  set_panel_tab,
  amenity_search_term,
  set_amenity_search_term,
  road_search_term,
  set_road_search_term,
  inner_enabled,
  outer_enabled,
  r_inner,
  r_outer,
  query_amenities,
  roads_nearby_state,
  map_ref,
  onClose,
  focused_amenity,
  set_focused_amenity,
  focused_road,
  set_focused_road,
}) {
  const [amenity_sort, set_amenity_sort] = useState("all");
  const [road_sort, set_road_sort] = useState("all");
  const [selectedRoadKey, setSelectedRoadKey] = useState(null);

  const handleAmenityClick = (amenity) => {
    if (!amenity) return;
    set_focused_amenity?.(amenity);

    const map = map_ref?.current;
    if (!map) return;

    map.flyTo({
      center: [amenity.lng, amenity.lat],
      zoom: 17,
      essential: true,
    });
  };

  const handleRoadClick = (road) => {
    if (!road) return;
    set_focused_road?.(road);
    setSelectedRoadKey(getRoadKey(road));

    const map = map_ref?.current;
    if (!map || !road.geometry) return;

    try {
      const bb = turf.bbox({
        type: "Feature",
        geometry: road.geometry,
        properties: {},
      });
      map.fitBounds(
        [
          [bb[0], bb[1]],
          [bb[2], bb[3]],
        ],
        { padding: 60, duration: 500 }
      );
    } catch (e) {
      // silent
    }
  };

  // NEW: local selection state for row highlight
  const [selectedAmenityRow, setSelectedAmenityRow] = useState(null);
  const [selectedRoadRow, setSelectedRoadRow] = useState(null);

  if (!selected || !selected_stats) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2">
          <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No flood event selected
          </p>
          <p className="text-xs text-muted-foreground">
            Click on a row in the table below to view details
          </p>
        </div>
      </div>
    );
  }

  const arImpactScore = selected_stats.scores?.ar_impact ?? null;
  const amenitiesTotal = selected_stats.counts?.total ?? 0;
  const amenitiesInner = selected_stats.counts?.inner ?? 0;
  const amenitiesOuter = selected_stats.counts?.outer ?? 0;
  const roadsTotal = selected_stats.roads_counts?.total ?? 0;
  const roadsInner = selected_stats.roads_counts?.inner ?? 0;
  const roadsOuter = selected_stats.roads_counts?.outer ?? 0;

  // 0–1 percentiles (adjust keys if needed)
  const arImpactPct = selected_stats.percentiles?.ar_impact ?? null;
  const amenitiesPct = selected_stats.percentiles?.amenities ?? null;
  const roadsPct = selected_stats.percentiles?.roads ?? null;

  const arImpactLabel = topPercentLabel(arImpactPct);
  const amenitiesLabel = topPercentLabel(amenitiesPct);
  const roadsLabel = topPercentLabel(roadsPct);



  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1" style={{ height: "calc(36rem - 0px)" }}>
        <div className="p-3 space-y-3">
          {/* header */}
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div>
              <h3 className="text-sm font-semibold">Flood Event Details</h3>
              <p className="text-[11px] text-muted-foreground">
                {selected_props?.start_planning_area || "—"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 p-0 rounded-full hover:bg-destructive/10 hover:text-destructive-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* metrics row */}
          <div className="grid grid-cols-3 gap-2 p-0">
            {/* AR impact */}
            <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  AR Impact
                </span>
                <span className="inline-flex items-center rounded-full bg-primary/25 px-2 py-0.5 text-[11px] font-medium">
                  {arImpactLabel}
                </span>
              </div>
              <div className="text-xl font-semibold leading-tight">
                {arImpactScore != null ? arImpactScore.toFixed(3) : "N/A"}
              </div>
              {arImpactScore != null && (
                <div className="mt-0.5 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(arImpactScore * 100, 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* amenities */}
            <div className="rounded-2xl border border-orange-500/40 bg-gradient-to-br from-orange-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Amenities
                </span>
                <span className="inline-flex items-center rounded-full bg-orange-500/25 px-2 py-0.5 text-[11px] font-medium text-orange-100">
                  {amenitiesLabel}
                </span>
              </div>
              <div className="text-xl font-semibold text-orange-400 leading-tight">
                {amenitiesTotal}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Inner: {amenitiesInner}</span>
                <span className="opacity-50">•</span>
                <span>Outer: {amenitiesOuter}</span>
              </div>
            </div>

            {/* roads */}
            <div className="rounded-2xl border border-blue-500/40 bg-gradient-to-br from-blue-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Roads
                </span>
                <span className="inline-flex items-center rounded-full bg-blue-500/25 px-2 py-0.5 text-[11px] font-medium text-blue-100">
                  {roadsLabel}
                </span>
              </div>
              <div className="text-xl font-semibold text-blue-400 leading-tight">
                {roadsTotal}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>Inner: {roadsInner}</span>
                <span className="opacity-50">•</span>
                <span>Outer: {roadsOuter}</span>
              </div>
            </div>
          </div>

          {/* event info */}
          <Panel title="Event Information">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-[13px]">
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Event ID
                </div>
                <div className="font-mono text-sm">
                  {selected_props?.id ?? "N/A"}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Event Type
                </div>
                <div>{to_title_case(selected_props?.event ?? "Unknown")}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Date
                </div>
                <div>{selected_props?.event_date ?? "N/A"}</div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Planning Area
                </div>
                <div>{selected_props?.start_planning_area ?? "N/A"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Location
                </div>
                <div className="truncate" title={selected_props?.location}>
                  {selected_props?.location ?? "N/A"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Main Road
                </div>
                <div className="truncate" title={selected_props?.parent_road}>
                  {selected_props?.parent_road ?? "N/A"}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[11px] text-muted-foreground mb-0.5 uppercase">
                  Coordinates
                </div>
                <div className="font-mono text-sm">
                  {Number.isFinite(Number(selected_props?.start_lat))
                    ? Number(selected_props.start_lat).toFixed(5)
                    : "N/A"}
                  {", "}
                  {Number.isFinite(Number(selected_props?.start_lng))
                    ? Number(selected_props.start_lng).toFixed(5)
                    : "N/A"}
                </div>
              </div>
            </div>
          </Panel>

          {/* affected infra */}
          <Panel title="Affected Infrastructure">
            <Tabs
              value={panel_tab || "amenities"}
              onValueChange={set_panel_tab}
              className="w-full"
            >
              <div className="border border-border/70 rounded-full p-0.5 mb-2 bg-muted/40">
                <TabsList className="w-full grid grid-cols-2 h-8 bg-transparent p-0">
                  <TabsTrigger
                    value="amenities"
                    className="text-xs rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Amenities ({amenitiesTotal})
                  </TabsTrigger>
                  <TabsTrigger
                    value="roads"
                    className="text-xs rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Roads ({roadsTotal})
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* amenities tab */}
              <TabsContent value="amenities" className="mt-0 space-y-1.5">
                {(() => {
                  const center = selected_stats.center;
                  if (!center) {
                    return (
                      <p className="text-xs text-muted-foreground py-3 text-center">
                        No location data
                      </p>
                    );
                  }

                  const innerAmenities = inner_enabled
                    ? query_amenities(center[0], center[1], r_inner).map(
                        (a) => ({ ...a, band: "inner" })
                      )
                    : [];
                  const outerAmenities = outer_enabled
                    ? query_amenities(center[0], center[1], r_outer)
                        .filter((a) => a._distm > r_inner)
                        .map((a) => ({ ...a, band: "outer" }))
                    : [];
                  const allAmenities = [...innerAmenities, ...outerAmenities];

                  let filteredAmenities = amenity_search_term.trim()
                    ? allAmenities.filter(
                        (a) =>
                          (a.name || "")
                            .toLowerCase()
                            .includes(amenity_search_term.toLowerCase()) ||
                          (a.category || "")
                            .toLowerCase()
                            .includes(amenity_search_term.toLowerCase())
                      )
                    : allAmenities;

                  if (amenity_sort !== "all") {
                    filteredAmenities = filteredAmenities.filter(
                      (a) => a.band === amenity_sort
                    );
                  }

                  return (
                    <>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search amenities..."
                            value={amenity_search_term}
                            onChange={(e) =>
                              set_amenity_search_term(e.target.value)
                            }
                            className="pl-8 h-8 text-xs rounded-lg"
                          />
                        </div>
                        <Select
                          value={amenity_sort}
                          onValueChange={set_amenity_sort}
                        >
                          <SelectTrigger className="w-28 h-8 text-xs rounded-lg">
                            <SelectValue placeholder="Band" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" className="text-xs">
                              All
                            </SelectItem>
                            <SelectItem value="inner" className="text-xs">
                              Inner
                            </SelectItem>
                            <SelectItem value="outer" className="text-xs">
                              Outer
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredAmenities.length > 0 ? (
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1.5 pr-1">
                            {filteredAmenities.map((amenity, idx) => {
                              const amenityName = amenity.name || "Unnamed Amenity";
                              const category = amenity.category || "Unknown";
                              const distance = amenity._distm;
                              const band = amenity.band || "unknown";

                              const isFocused =
                                focused_amenity &&
                                (focused_amenity.id === amenity.id);

                              return (
                                <div
                                  key={`${amenity.id}-${idx}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleAmenityClick(amenity)}
                                  className={`flex items-center justify-between text-[11px] rounded-lg px-3 py-2 bg-muted/30 hover:bg-muted transition-colors cursor-pointer border ${
                                    isFocused
                                      ? "border-primary/60 bg-primary/10 shadow-sm"
                                      : "border-transparent"
                                  }`}
                                >
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-medium text-foreground truncate">
                                      {amenityName}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-muted-foreground">
                                        {to_title_case(category)}
                                      </span>
                                      {distance && (
                                        <span className="text-[11px] text-muted-foreground font-medium">
                                          {distance.toFixed(0)}m
                                        </span>
                                      )}
                                      <span
                                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                          band === "inner"
                                            ? "bg-blue-500/20 text-blue-200"
                                            : "bg-slate-500/20 text-slate-200"
                                        }`}
                                      >
                                        {band}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAmenityClick(amenity);
                                    }}
                                    className="h-7 px-2 text-[11px] hover:bg-primary/10 ml-1 shrink-0 rounded-full"
                                  >
                                    Focus
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      ) : (
                        <p className="text-xs text-muted-foreground py-3 text-center">
                          {amenity_search_term.trim() ||
                          amenity_sort !== "all"
                            ? "No amenities match your filters"
                            : "No affected amenities"}
                        </p>
                      )}
                    </>
                  );
                })()}
              </TabsContent>

              {/* roads tab */}
              <TabsContent value="roads" className="mt-0 space-y-1.5">
                {(() => {
                  const allRoads = [];
                  if (inner_enabled) {
                    (roads_nearby_state.inner || []).forEach((r) =>
                      allRoads.push({ ...r, band: "inner" })
                    );
                  }
                  if (outer_enabled) {
                    (roads_nearby_state.outer || []).forEach((r) =>
                      allRoads.push({ ...r, band: "outer" })
                    );
                  }

                  let filteredRoads = road_search_term.trim()
                    ? allRoads.filter(
                        (r) =>
                          (r.name || "")
                            .toLowerCase()
                            .includes(road_search_term.toLowerCase()) ||
                          String(r.rn_id || r.RN_ID || "").includes(
                            road_search_term
                          )
                      )
                    : allRoads;

                  if (road_sort !== "all") {
                    filteredRoads = filteredRoads.filter(
                      (r) => r.band === road_sort
                    );
                  }

                  return (
                    <>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search roads..."
                            value={road_search_term}
                            onChange={(e) =>
                              set_road_search_term(e.target.value)
                            }
                            className="pl-8 h-8 text-xs rounded-lg"
                          />
                        </div>
                        <Select
                          value={road_sort}
                          onValueChange={set_road_sort}
                        >
                          <SelectTrigger className="w-28 h-8 text-xs rounded-lg">
                            <SelectValue placeholder="Band" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" className="text-xs">
                              All
                            </SelectItem>
                            <SelectItem value="inner" className="text-xs">
                              Inner
                            </SelectItem>
                            <SelectItem value="outer" className="text-xs">
                              Outer
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredRoads.length > 0 ? (
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1.5 pr-1">
                            {filteredRoads.map((road, idx) => {
                              const roadName = road.name || "Unnamed Road";
                              const roadId = road.rn_id || road.RN_ID || "";
                              const distance = road.d || road._distm;
                              const band = road.band || "unknown";

                              const isFocused = selectedRoadKey === getRoadKey(road);


                              return (
                                <div
                                  key={`${roadId}-${idx}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleRoadClick(road)}
                                  className={`flex items-center justify-between text-[11px] rounded-lg px-3 py-2 bg-muted/30 hover:bg-muted transition-colors cursor-pointer border ${
                                    isFocused
                                      ? "border-primary/60 bg-primary/10 shadow-sm"
                                      : "border-transparent"
                                  }`}
                                >
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-medium text-foreground truncate">
                                      {roadName}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[11px] text-muted-foreground font-mono">
                                        ID: {roadId}
                                      </span>
                                      {distance && (
                                        <span className="text-[11px] text-muted-foreground font-medium">
                                          {distance}m
                                        </span>
                                      )}
                                      <span
                                        className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                                          band === "inner"
                                            ? "bg-blue-500/20 text-blue-200"
                                            : "bg-slate-500/20 text-slate-200"
                                        }`}
                                      >
                                        {band}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRoadClick(road);
                                    }}
                                    className="h-7 px-2 text-[11px] hover:bg-primary/10 ml-1 shrink-0 rounded-full"
                                  >
                                    Focus
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      ) : (
                        <p className="text-xs text-muted-foreground py-3 text-center">
                          {road_search_term.trim() || road_sort !== "all"
                            ? "No roads match your filters"
                            : "No affected roads"}
                        </p>
                      )}
                    </>
                  );
                })()}
              </TabsContent>
            </Tabs>
          </Panel>
        </div>
      </ScrollArea>
    </div>
  );
}
