"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { X, Download, Search } from "lucide-react";
import { format_number, to_title_case } from "./shared";

export function RoadDetailsPanel({ road, onClose, amenityCounts, floodCounts, totalRoads, roadRank, getSLACategory, amenityEnabled = {}, floodEnabled = {}, allRoads = [], amenityItems = [], floodItems = [], onMarkerClick = null }) {
  // Search state - MUST be called before any conditional returns
  const [amenitySearch, setAmenitySearch] = useState("");
  const [floodSearch, setFloodSearch] = useState("");
  const [selectedAmenityIdx, setSelectedAmenityIdx] = useState(null);
  const [selectedFloodIdx, setSelectedFloodIdx] = useState(null);

  const p = road?.properties ?? {};

  // Helper function to calculate percentile rank for any metric
  const calculatePercentileRank = (value, metric) => {
    if (!allRoads.length || value === null || value === undefined) return null;

    // Get all values for this metric
    const values = allRoads.map(r => {
      const val = r.properties?.[metric];
      return val !== null && val !== undefined ? val : 0;
    });

    // Sort in descending order (highest first)
    values.sort((a, b) => b - a);

    // Find how many roads have a higher value
    const betterCount = values.filter(v => v > value).length;

    // Calculate percentile (what % of roads this road is better than)
    const percentile = Math.round(((allRoads.length - betterCount) / allRoads.length) * 100);

    return percentile;
  };

  // Calculate percentile ranks for all metrics - MUST be called before any conditional returns
  const importancePercentile = useMemo(() => road ? calculatePercentileRank(p.importance, 'importance') : null, [p.importance, allRoads, road]);
  const betweennessPercentile = useMemo(() => road ? calculatePercentileRank(p.betweenness_norm, 'betweenness_norm') : null, [p.betweenness_norm, allRoads, road]);
  const closenessPercentile = useMemo(() => road ? calculatePercentileRank(p.closeness_norm, 'closeness_norm') : null, [p.closeness_norm, allRoads, road]);
  const amenityPercentile = useMemo(() => road ? calculatePercentileRank(p.amenity_count_total, 'amenity_count_total') : null, [p.amenity_count_total, allRoads, road]);
  const floodPercentile = useMemo(() => road ? calculatePercentileRank(p.flood_count_total, 'flood_count_total') : null, [p.flood_count_total, allRoads, road]);

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
      onMarkerClick({ item, type: 'amenity' });
    }
  };

  const handleFloodClick = (item, idx) => {
    setSelectedFloodIdx(idx);
    setSelectedAmenityIdx(null);
    if (onMarkerClick) {
      onMarkerClick({ item, type: 'flood' });
    }
  };

  const amenityBreakdown = useMemo(() => {
    if (!amenityCounts) return [];
    // Handle Map objects and filter by enabled categories
    const entries = amenityCounts instanceof Map
      ? Array.from(amenityCounts.entries())
      : Object.entries(amenityCounts);
    return entries
      .filter(([category, count]) => count > 0 && amenityEnabled[category])
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [amenityCounts, amenityEnabled]);

  const floodBreakdown = useMemo(() => {
    if (!floodCounts) return [];
    // Handle Map objects and filter by enabled types
    const entries = floodCounts instanceof Map
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
    return amenityItems.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.category?.toLowerCase().includes(search)
    );
  }, [amenityItems, amenitySearch]);

  // Filtered floods based on search
  const filteredFloods = useMemo(() => {
    if (!floodSearch.trim()) return floodItems;
    const search = floodSearch.toLowerCase();
    return floodItems.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.type?.toLowerCase().includes(search) ||
      item.date?.toLowerCase().includes(search)
    );
  }, [floodItems, floodSearch]);

  // Export amenities to CSV
  const exportAmenities = () => {
    if (!filteredAmenities.length) return;
    const headers = ["Name", "Category", "Distance (m)"];
    const rows = filteredAmenities.map(item => [
      item.name || "",
      to_title_case(item.category || ""),
      item._distm?.toFixed(2) || ""
    ]);
    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `amenities_${p.name || "road"}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export floods to CSV
  const exportFloods = () => {
    if (!filteredFloods.length) return;
    const headers = ["Name", "Type", "Date", "Distance (m)"];
    const rows = filteredFloods.map(item => [
      item.name || "",
      to_title_case(item.type || ""),
      item.date || "",
      item._distm?.toFixed(2) || ""
    ]);
    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flood_events_${p.name || "road"}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Show prompt if no road selected - MUST come after all hooks
  if (!road) {
    return (
      <Card className="mb-4 border-2 border-dashed h-full flex flex-col">
        <CardHeader>
          <CardTitle className="text-lg">Road Details</CardTitle>
          <CardDescription>
            Click on a row in the table below or hover over a road on the map to view details
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="flex items-center justify-center py-8 text-center">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No road selected</p>
              <p className="text-xs text-muted-foreground">Select a road to view KPIs, amenity details, and flood information</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-3 border-2 border-primary h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">{p.name || "Unnamed Road"}</CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              RN ID: {p.RN_ID ?? "—"} {p.PLN_AREA_N ? `· ${p.PLN_AREA_N}` : ""}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Close road details">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-3 flex-1 overflow-y-auto">
        {/* Unified KPI Section */}
        <div className="rounded-lg border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-background p-3">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Key Performance Indicators</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Importance */}
            <div className="space-y-1">
              <div className="text-[9px] font-medium text-muted-foreground uppercase">Importance</div>
              {getPercentileLabel(importancePercentile) && (
                <div className="mb-1">
                  <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold">
                    {getPercentileLabel(importancePercentile)}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold text-primary">{format_number(p.importance, 2) ?? "—"}</div>
            </div>

            {/* Maintenance Category */}
            <div className="space-y-1">
              <div className="text-[9px] font-medium text-muted-foreground uppercase">Maintenance Category</div>
              <div className="text-sm font-bold text-green-600 dark:text-green-400 mt-5">{p.sla_priority || "—"}</div>
            </div>

            {/* Betweenness */}
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground uppercase">Betweenness</div>
              {getPercentileLabel(betweennessPercentile) && (
                <div className="mb-1">
                  <span className="px-1.5 py-0.5 rounded-full bg-muted-foreground text-background text-[8px] font-bold">
                    {getPercentileLabel(betweennessPercentile)}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold">{format_number(p.betweenness_norm, 4) ?? "—"}</div>
            </div>

            {/* Closeness */}
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground uppercase">Closeness</div>
              {getPercentileLabel(closenessPercentile) && (
                <div className="mb-1">
                  <span className="px-1.5 py-0.5 rounded-full bg-muted-foreground text-background text-[8px] font-bold">
                    {getPercentileLabel(closenessPercentile)}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold">{format_number(p.closeness_norm, 4) ?? "—"}</div>
            </div>

            {/* Amenities */}
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground uppercase">Amenities</div>
              {getPercentileLabel(amenityPercentile) && (
                <div className="mb-1">
                  <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white dark:bg-blue-400 dark:text-black text-[8px] font-bold">
                    {getPercentileLabel(amenityPercentile)}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{p.amenity_count_total || 0}</div>
            </div>

            {/* Flood Events */}
            <div className="space-y-1">
              <div className="text-[9px] text-muted-foreground uppercase">Flood Events</div>
              {getPercentileLabel(floodPercentile) && (
                <div className="mb-1">
                  <span className="px-1.5 py-0.5 rounded-full bg-orange-600 text-white dark:bg-orange-400 dark:text-black text-[8px] font-bold">
                    {getPercentileLabel(floodPercentile)}
                  </span>
                </div>
              )}
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{p.flood_count_total || 0}</div>
            </div>
          </div>
        </div>

        {/* Amenities and Flood Events Tabs */}
        <Card className="border">
          <CardHeader className="pb-1 pt-2 px-2">
            <CardTitle className="text-sm font-semibold">Nearby Infrastructure</CardTitle>
          </CardHeader>
          <Tabs defaultValue="amenities" className="w-full">
            <div className="border-b px-2 pt-0">
              <TabsList className="w-full grid grid-cols-2 h-8">
                <TabsTrigger value="amenities" className="text-[10px]">
                  Amenities ({filteredAmenities.length})
                </TabsTrigger>
                <TabsTrigger value="floods" className="text-[10px]">
                  Flood Events ({filteredFloods.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="amenities" className="px-2 py-2 mt-0">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search amenities..."
                  value={amenitySearch}
                  onChange={(e) => setAmenitySearch(e.target.value)}
                  className="pl-7 h-8 text-xs"
                />
              </div>

              {filteredAmenities.length > 0 ? (
                <ScrollArea className="h-64">
                  <div className="space-y-1 pr-3">
                    {filteredAmenities.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors ${
                          selectedAmenityIdx === idx ? 'border-2 border-primary bg-primary/10' : 'border border-transparent'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{item.name}</span>
                          <span className="text-[10px] text-muted-foreground">{to_title_case(item.category)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-medium">{item._distm?.toFixed(0)}m</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAmenityClick(item, idx)}
                            className="h-6 px-2 text-[10px] hover:bg-primary/10"
                          >
                            View on Map
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {amenitySearch ? "No amenities match your search" : "No amenities nearby"}
                </p>
              )}
            </TabsContent>

            <TabsContent value="floods" className="px-2 py-2 mt-0">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search flood events..."
                  value={floodSearch}
                  onChange={(e) => setFloodSearch(e.target.value)}
                  className="pl-7 h-8 text-xs"
                />
              </div>

              {filteredFloods.length > 0 ? (
                <ScrollArea className="h-64">
                  <div className="space-y-1 pr-3">
                    {filteredFloods.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors ${
                          selectedFloodIdx === idx ? 'border-2 border-primary bg-primary/10' : 'border border-transparent'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{item.name}</span>
                          <div className="flex gap-2 text-[10px] text-muted-foreground">
                            <span>{to_title_case(item.type)}</span>
                            {item.date && <span>• {item.date}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-medium">{item._distm?.toFixed(0)}m</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleFloodClick(item, idx)}
                            className="h-6 px-2 text-[10px] hover:bg-primary/10"
                          >
                            View on Map
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {floodSearch ? "No flood events match your search" : "No flood events recorded"}
                </p>
              )}
            </TabsContent>
          </Tabs>
        </Card>
      </CardContent>
    </Card>
  );
}
