"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { X } from "lucide-react";
import { format_number, to_title_case } from "./shared";

export function RoadDetailsPanel({ road, onClose, amenityCounts, floodCounts, totalRoads, roadRank, getSLACategory, amenityEnabled = {}, floodEnabled = {}, allRoads = [], amenityItems = [], floodItems = [], onMarkerClick = null }) {
  // Show prompt if no road selected
  if (!road) {
    return (
      <Card className="mb-4 border-2 border-dashed">
        <CardHeader>
          <CardTitle className="text-lg">Road Details</CardTitle>
          <CardDescription>
            Click on a row in the table below or hover over a road on the map to view details
          </CardDescription>
        </CardHeader>
        <CardContent>
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

  const p = road.properties ?? {};

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

  // Calculate percentile ranks for all metrics
  const importancePercentile = useMemo(() => calculatePercentileRank(p.importance, 'importance'), [p.importance, allRoads]);
  const betweennessPercentile = useMemo(() => calculatePercentileRank(p.betweenness_norm, 'betweenness_norm'), [p.betweenness_norm, allRoads]);
  const closenessPercentile = useMemo(() => calculatePercentileRank(p.closeness_norm, 'closeness_norm'), [p.closeness_norm, allRoads]);
  const amenityPercentile = useMemo(() => calculatePercentileRank(p.amenity_count_total, 'amenity_count_total'), [p.amenity_count_total, allRoads]);
  const floodPercentile = useMemo(() => calculatePercentileRank(p.flood_count_total, 'flood_count_total'), [p.flood_count_total, allRoads]);

  const getPercentileLabel = (percentile) => {
    if (!percentile) return null;
    if (percentile <= 5) return "Top 5%";
    if (percentile <= 10) return "Top 10%";
    if (percentile <= 25) return "Top 25%";
    return `Top ${percentile}%`;
  };

  const slaCategory = getSLACategory ? getSLACategory(p.importance) : null;

  // Handle clicking on an amenity/flood item - notify parent to show marker
  const handleAmenityClick = (item) => {
    if (onMarkerClick) {
      onMarkerClick({ item, type: 'amenity' });
    }
  };

  const handleFloodClick = (item) => {
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

  return (
    <Card className="mb-4 border-2 border-primary">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{p.name || "Unnamed Road"}</CardTitle>
            <CardDescription className="mt-1">
              RN ID: {p.RN_ID ?? "—"} {p.PLN_AREA_N ? `· ${p.PLN_AREA_N}` : ""}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0" aria-label="Close road details">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 6 KPI Cards in one row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Importance */}
          <div className="rounded-lg border-2 border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5 p-2">
            <div className="text-[9px] font-medium text-muted-foreground uppercase mb-0.5">Importance</div>
            {getPercentileLabel(importancePercentile) && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[8px] font-bold">
                  {getPercentileLabel(importancePercentile)}
                </span>
              </div>
            )}
            <div className="text-lg font-bold text-primary">{format_number(p.importance, 2) ?? "—"}</div>
          </div>

          {/* SLA Category */}
          <div className="rounded-lg border bg-muted/50 p-2">
            <div className="text-[9px] font-medium text-muted-foreground uppercase mb-0.5">SLA Category</div>
            <div className="text-xs font-bold text-green-600 dark:text-green-400 mt-4">{p.sla_priority || "—"}</div>
          </div>

          {/* Betweenness */}
          <div className="rounded-lg border bg-muted/50 p-2">
            <div className="text-[9px] text-muted-foreground mb-0.5">Betweenness</div>
            {getPercentileLabel(betweennessPercentile) && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-muted-foreground text-background text-[8px] font-bold">
                  {getPercentileLabel(betweennessPercentile)}
                </span>
              </div>
            )}
            <div className="text-lg font-bold">{format_number(p.betweenness_norm, 4) ?? "—"}</div>
          </div>

          {/* Closeness */}
          <div className="rounded-lg border bg-muted/50 p-2">
            <div className="text-[9px] text-muted-foreground mb-0.5">Closeness</div>
            {getPercentileLabel(closenessPercentile) && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-muted-foreground text-background text-[8px] font-bold">
                  {getPercentileLabel(closenessPercentile)}
                </span>
              </div>
            )}
            <div className="text-lg font-bold">{format_number(p.closeness_norm, 4) ?? "—"}</div>
          </div>

          {/* Amenities */}
          <div className="rounded-lg border bg-muted/50 p-2">
            <div className="text-[9px] text-muted-foreground mb-0.5">Amenities</div>
            {getPercentileLabel(amenityPercentile) && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-white dark:bg-blue-400 dark:text-black text-[8px] font-bold">
                  {getPercentileLabel(amenityPercentile)}
                </span>
              </div>
            )}
            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{p.amenity_count_total || 0}</div>
          </div>

          {/* Flood Events */}
          <div className="rounded-lg border bg-muted/50 p-2">
            <div className="text-[9px] text-muted-foreground mb-0.5">Flood Events</div>
            {getPercentileLabel(floodPercentile) && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-orange-600 text-white dark:bg-orange-400 dark:text-black text-[8px] font-bold">
                  {getPercentileLabel(floodPercentile)}
                </span>
              </div>
            )}
            <div className="text-lg font-bold text-orange-600 dark:text-orange-400">{p.flood_count_total || 0}</div>
          </div>
        </div>

        {/* Accordions for Amenities and Flood Events */}
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="amenities">
            <AccordionTrigger className="text-sm font-semibold">
              Amenities ({amenityItems.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              {amenityItems.length > 0 ? (
                <ScrollArea className="h-56">
                  <div className="space-y-1.5 pr-3">
                    {amenityItems.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleAmenityClick(item)}
                        className="flex items-center justify-between text-xs rounded px-3 py-2.5 bg-muted/50 hover:bg-blue-100 dark:hover:bg-blue-900/30 cursor-pointer transition-colors border border-transparent hover:border-blue-300 dark:hover:border-blue-700"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{item.name}</span>
                          <span className="text-[10px] text-muted-foreground">{to_title_case(item.category)}</span>
                        </div>
                        <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold">View on map</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No amenities nearby</p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="floods">
            <AccordionTrigger className="text-sm font-semibold">
              Flood Events ({floodItems.length})
            </AccordionTrigger>
            <AccordionContent className="space-y-2 pt-2">
              {floodItems.length > 0 ? (
                <ScrollArea className="h-56">
                  <div className="space-y-2 pr-3">
                    {floodItems.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleFloodClick(item)}
                        className="flex items-center justify-between text-xs rounded px-3 py-2.5 bg-muted/50 hover:bg-orange-100 dark:hover:bg-orange-900/30 cursor-pointer transition-colors border border-transparent hover:border-orange-300 dark:hover:border-orange-700"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-foreground">{item.name}</span>
                          <div className="flex gap-2 text-[10px] text-muted-foreground">
                            <span>{to_title_case(item.type)}</span>
                            {item.date && <span>• {item.date}</span>}
                          </div>
                        </div>
                        <span className="text-[10px] text-orange-600 dark:text-orange-400 font-semibold">View on map</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No flood events recorded</p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
