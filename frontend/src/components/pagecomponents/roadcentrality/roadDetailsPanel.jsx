"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Download, Search, MapPin } from "lucide-react";
import { format_number, to_title_case } from "./shared";

/* small wrapper – same style language as FloodEventDetails */
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

export function RoadDetailsPanel({
  road,
  onClose,
  amenityCounts,
  floodCounts,
  totalRoads,
  roadRank,
  getSLACategory,
  amenityEnabled = {},
  floodEnabled = {},
  allRoads = [],
  amenityItems = [],
  floodItems = [],
  onMarkerClick = null,
}) {
  // Search state
  const [amenitySearch, setAmenitySearch] = useState("");
  const [floodSearch, setFloodSearch] = useState("");
  const [selectedAmenityIdx, setSelectedAmenityIdx] = useState(null);
  const [selectedFloodIdx, setSelectedFloodIdx] = useState(null);

  const p = road?.properties ?? {};

  // Helper function to calculate percentile rank for any metric
  const calculatePercentileRank = (value, metric) => {
    if (!allRoads.length || value === null || value === undefined) return null;

    const values = allRoads.map((r) => {
      const val = r.properties?.[metric];
      return val !== null && val !== undefined ? val : 0;
    });

    values.sort((a, b) => b - a);

    const betterCount = values.filter((v) => v > value).length;
    const percentile = Math.round(
      ((allRoads.length - betterCount) / allRoads.length) * 100
    );

    return percentile;
  };

  // Percentiles
  const importancePercentile = useMemo(
    () => (road ? calculatePercentileRank(p.importance, "importance") : null),
    [p.importance, allRoads, road]
  );
  const betweennessPercentile = useMemo(
    () =>
      road
        ? calculatePercentileRank(p.betweenness_norm, "betweenness_norm")
        : null,
    [p.betweenness_norm, allRoads, road]
  );
  const closenessPercentile = useMemo(
    () =>
      road ? calculatePercentileRank(p.closeness_norm, "closeness_norm") : null,
    [p.closeness_norm, allRoads, road]
  );
  const amenityPercentile = useMemo(
    () =>
      road
        ? calculatePercentileRank(p.amenity_count_total, "amenity_count_total")
        : null,
    [p.amenity_count_total, allRoads, road]
  );
  const floodPercentile = useMemo(
    () =>
      road
        ? calculatePercentileRank(p.flood_count_total, "flood_count_total")
        : null,
    [p.flood_count_total, allRoads, road]
  );

  const getPercentileLabel = (percentile) => {
    if (!percentile) return null;
    if (percentile <= 5) return "Top 5%";
    if (percentile <= 10) return "Top 10%";
    if (percentile <= 25) return "Top 25%";
    return `Top ${percentile}%`;
  };

  const slaCategory = getSLACategory ? getSLACategory(p.importance) : null;

  // Handle clicking on an amenity/flood item - notify parent to show marker
  const handleAmenityClick = (item, idx) => {
    setSelectedAmenityIdx(idx);
    setSelectedFloodIdx(null);
    if (onMarkerClick) {
      onMarkerClick({ item, type: "amenity" });
    }
  };

  const handleFloodClick = (item, idx) => {
    setSelectedFloodIdx(idx);
    setSelectedAmenityIdx(null);
    if (onMarkerClick) {
      onMarkerClick({ item, type: "flood" });
    }
  };

  const amenityBreakdown = useMemo(() => {
    if (!amenityCounts) return [];
    const entries =
      amenityCounts instanceof Map
        ? Array.from(amenityCounts.entries())
        : Object.entries(amenityCounts);
    return entries
      .filter(([category, count]) => count > 0 && amenityEnabled[category])
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [amenityCounts, amenityEnabled]);

  const floodBreakdown = useMemo(() => {
    if (!floodCounts) return [];
    const entries =
      floodCounts instanceof Map
        ? Array.from(floodCounts.entries())
        : Object.entries(floodCounts);
    return entries
      .filter(([type, count]) => count > 0 && floodEnabled[type])
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [floodCounts, floodEnabled]);

  // Filtered amenities based on search
  const filteredAmenities = useMemo(() => {
    if (!amenitySearch.trim()) return amenityItems;
    const search = amenitySearch.toLowerCase();
    return amenityItems.filter(
      (item) =>
        item.name?.toLowerCase().includes(search) ||
        item.category?.toLowerCase().includes(search)
    );
  }, [amenityItems, amenitySearch]);

  // Filtered floods based on search
  const filteredFloods = useMemo(() => {
    if (!floodSearch.trim()) return floodItems;
    const search = floodSearch.toLowerCase();
    return floodItems.filter(
      (item) =>
        item.name?.toLowerCase().includes(search) ||
        item.type?.toLowerCase().includes(search) ||
        item.date?.toLowerCase().includes(search)
    );
  }, [floodItems, floodSearch]);

  // Export amenities to CSV
  const exportAmenities = () => {
    if (!filteredAmenities.length) return;
    const headers = ["Name", "Category", "Distance (m)"];
    const rows = filteredAmenities.map((item) => [
      item.name || "",
      to_title_case(item.category || ""),
      item._distm?.toFixed(2) || "",
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amenities_${p.name || "road"}_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export floods to CSV
  const exportFloods = () => {
    if (!filteredFloods.length) return;
    const headers = ["Name", "Type", "Date", "Distance (m)"];
    const rows = filteredFloods.map((item) => [
      item.name || "",
      to_title_case(item.type || ""),
      item.date || "",
      item._distm?.toFixed(2) || "",
    ]);
    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flood_events_${p.name || "road"}_${
      new Date().toISOString().split("T")[0]
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // empty state – same feel as FloodEventDetails
  if (!road) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2">
          <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No road selected</p>
          <p className="text-xs text-muted-foreground">
            Click on a road in the table or map to view details
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1" style={{ height: "calc(36rem - 0px)" }}>
        <div className="p-3 space-y-3">
          {/* header – same layout as FloodEventDetails */}
          <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
            <div>
              <h3 className="text-sm font-semibold">
                {p.name || "Unnamed Road"}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                RN ID: {p.RN_ID ?? "—"}
                {p.PLN_AREA_N ? ` · ${p.PLN_AREA_N}` : ""}
              </p>
              {typeof roadRank === "number" && typeof totalRoads === "number" && (
                <p className="text-[11px] text-muted-foreground">
                  Rank: {roadRank} of {totalRoads}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-7 w-7 p-0 rounded-full hover:bg-destructive/10 hover:text-destructive-foreground"
              aria-label="Close road details"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* metrics – same card style as flood metrics, 2 rows x 3 cols */}
          <div className="grid grid-cols-3 gap-2 p-0">
            {/* Importance */}
            <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Importance
                </span>
                {getPercentileLabel(importancePercentile) && (
                  <span className="inline-flex items-center rounded-full bg-primary/25 px-2 py-0.5 text-[11px] font-medium">
                    {getPercentileLabel(importancePercentile)}
                  </span>
                )}
              </div>
              <div className="text-xl font-semibold leading-tight text-primary">
                {p.importance != null ? format_number(p.importance, 2) : "—"}
              </div>
            </div>

            {/* Maintenance category */}
            <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Maintenance Category
                </span>
              </div>
              <div className="text-xl font-semibold leading-tight">
                {(p.sla_priority || slaCategory || "").toString()}
              </div>
            </div>

            {/* Betweenness */}
            <div className="rounded-2xl border border-slate-500/40 bg-gradient-to-br from-slate-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Betweenness
                </span>
                {getPercentileLabel(betweennessPercentile) && (
                  <span className="inline-flex items-center rounded-full bg-slate-500/25 px-2 py-0.5 text-[11px] font-medium text-slate-100">
                    {getPercentileLabel(betweennessPercentile)}
                  </span>
                )}
              </div>
              <div className="text-xl font-semibold leading-tight">
                {p.betweenness_norm != null
                  ? format_number(p.betweenness_norm, 4)
                  : "—"}
              </div>
            </div>

            {/* Closeness */}
            <div className="rounded-2xl border border-sky-500/40 bg-gradient-to-br from-sky-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Closeness
                </span>
                {getPercentileLabel(closenessPercentile) && (
                  <span className="inline-flex items-center rounded-full bg-sky-500/25 px-2 py-0.5 text-[11px] font-medium text-sky-100">
                    {getPercentileLabel(closenessPercentile)}
                  </span>
                )}
              </div>
              <div className="text-xl font-semibold leading-tight">
                {p.closeness_norm != null
                  ? format_number(p.closeness_norm, 4)
                  : "—"}
              </div>
            </div>

            {/* Amenities */}
            <div className="rounded-2xl border border-orange-500/40 bg-gradient-to-br from-orange-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Amenities
                </span>
                {getPercentileLabel(amenityPercentile) && (
                  <span className="inline-flex items-center rounded-full bg-orange-500/25 px-2 py-0.5 text-[11px] font-medium text-orange-100">
                    {getPercentileLabel(amenityPercentile)}
                  </span>
                )}
              </div>
              <div className="text-xl font-semibold text-orange-400 leading-tight">
                {p.amenity_count_total || 0}
              </div>
              {amenityBreakdown.length > 0}
            </div>

            {/* Flood events */}
            <div className="rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/15 via-background/40 to-background px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Flood Events
                </span>
                {getPercentileLabel(floodPercentile) && (
                  <span className="inline-flex items-center rounded-full bg-red-500/25 px-2 py-0.5 text-[11px] font-medium text-red-100">
                    {getPercentileLabel(floodPercentile)}
                  </span>
                )}
              </div>
              <div className="text-xl font-semibold text-red-400 leading-tight">
                {p.flood_count_total || 0}
              </div>
              {floodBreakdown.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  Dominant type: {to_title_case(floodBreakdown[0].type)} (
                  {floodBreakdown[0].count})
                </div>
              )}
            </div>
          </div>

          {/* nearby infra – same style as FloodEventDetails "Affected Infrastructure" */}
          <Panel title="Nearby Infrastructure">
            <Tabs defaultValue="amenities" className="w-full">
              <div className="border border-border/70 rounded-full p-0.5 mb-2 bg-muted/40">
                <TabsList className="w-full grid grid-cols-2 h-8 bg-transparent p-0">
                  <TabsTrigger
                    value="amenities"
                    className="text-xs rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Amenities ({filteredAmenities.length})
                  </TabsTrigger>
                  <TabsTrigger
                    value="floods"
                    className="text-xs rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Flood Events ({filteredFloods.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* amenities tab */}
              <TabsContent value="amenities" className="mt-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search amenities..."
                      value={amenitySearch}
                      onChange={(e) => setAmenitySearch(e.target.value)}
                      className="pl-8 h-8 text-xs rounded-lg"
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={exportAmenities}
                    className="h-8 w-8 rounded-lg"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>

                {filteredAmenities.length > 0 ? (
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-1.5 pr-1">
                      {filteredAmenities.map((item, idx) => {
                        const name = item.name || "Unnamed Amenity";
                        const category = item.category || "Unknown";
                        const distance = item._distm;
                        const isSelected = selectedAmenityIdx === idx;

                        return (
                          <div
                            key={`${name}-${idx}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleAmenityClick(item, idx)}
                            className={`flex items-center justify-between text-[11px] rounded-lg px-3 py-2 bg-muted/30 hover:bg-muted transition-colors cursor-pointer border ${
                              isSelected
                                ? "border-primary/60 bg-primary/10 shadow-sm"
                                : "border-transparent"
                            }`}
                          >
                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                              <span className="font-medium text-foreground truncate">
                                {name}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {to_title_case(category)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {distance != null && (
                                <span className="text-[11px] text-muted-foreground font-medium">
                                  {distance.toFixed(0)}m
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAmenityClick(item, idx);
                                }}
                                className="h-7 px-2 text-[11px] hover:bg-primary/10 ml-1 rounded-full"
                              >
                                View
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-xs text-muted-foreground py-3 text-center">
                    {amenitySearch.trim()
                      ? "No amenities match your search"
                      : "No amenities nearby"}
                  </p>
                )}
              </TabsContent>

              {/* floods tab */}
              <TabsContent value="floods" className="mt-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search flood events..."
                      value={floodSearch}
                      onChange={(e) => setFloodSearch(e.target.value)}
                      className="pl-8 h-8 text-xs rounded-lg"
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={exportFloods}
                    className="h-8 w-8 rounded-lg"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>

                {filteredFloods.length > 0 ? (
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-1.5 pr-1">
                      {filteredFloods.map((item, idx) => {
                        const name = item.name || "Unnamed Event";
                        const type = item.type || "Unknown";
                        const date = item.date || "";
                        const distance = item._distm;
                        const isSelected = selectedFloodIdx === idx;

                        return (
                          <div
                            key={`${name}-${idx}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleFloodClick(item, idx)}
                            className={`flex items-center justify-between text-[11px] rounded-lg px-3 py-2 bg-muted/30 hover:bg-muted transition-colors cursor-pointer border ${
                              isSelected
                                ? "border-primary/60 bg-primary/10 shadow-sm"
                                : "border-transparent"
                            }`}
                          >
                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                              <span className="font-medium text-foreground truncate">
                                {name}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span>{to_title_case(type)}</span>
                                {date && (
                                  <>
                                    <span className="opacity-50">•</span>
                                    <span>{date}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {distance != null && (
                                <span className="text-[11px] text-muted-foreground font-medium">
                                  {distance.toFixed(0)}m
                                </span>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFloodClick(item, idx);
                                }}
                                className="h-7 px-2 text-[11px] hover:bg-primary/10 ml-1 rounded-full"
                              >
                                View
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-xs text-muted-foreground py-3 text-center">
                    {floodSearch.trim()
                      ? "No flood events match your search"
                      : "No flood events recorded"}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </Panel>
        </div>
      </ScrollArea>
    </div>
  );
}
