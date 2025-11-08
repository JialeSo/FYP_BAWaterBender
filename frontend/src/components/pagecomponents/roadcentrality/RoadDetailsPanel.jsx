"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { X } from "lucide-react";
import { format_number, to_title_case } from "./shared";

export function RoadDetailsPanel({ road, onClose, amenityCounts, floodCounts, totalRoads, roadRank, getSLACategory, amenityEnabled = {}, floodEnabled = {} }) {
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

  // Calculate percentile rank
  const percentile = useMemo(() => {
    if (!totalRoads || !roadRank) return null;
    return Math.round((roadRank / totalRoads) * 100);
  }, [totalRoads, roadRank]);

  const percentileLabel = useMemo(() => {
    if (!percentile) return null;
    if (percentile <= 5) return "Top 5%";
    if (percentile <= 10) return "Top 10%";
    if (percentile <= 25) return "Top 25%";
    return `Top ${percentile}%`;
  }, [percentile]);

  const slaCategory = getSLACategory ? getSLACategory(p.importance) : null;

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

      <CardContent className="space-y-4">
        {/* 6 KPI Cards in one row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Importance */}
          <div className="rounded-lg border-2 border-primary/50 bg-gradient-to-br from-primary/10 to-primary/5 p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Importance</div>
            {percentileLabel && (
              <div className="mb-1">
                <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] font-bold">
                  {percentileLabel}
                </span>
              </div>
            )}
            <div className="text-xl font-bold text-primary">{format_number(p.importance, 2) ?? "—"}</div>
          </div>

          {/* SLA Category */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-[10px] font-medium text-muted-foreground uppercase mb-1">SLA Category</div>
            <div className="text-sm font-bold text-green-600 dark:text-green-400 mt-2">{p.sla_priority || "—"}</div>
          </div>

          {/* Betweenness */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Betweenness</div>
            {percentileLabel && <div className="h-3 mb-1"></div>}
            <div className="text-xl font-bold">{format_number(p.betweenness_norm, 4) ?? "—"}</div>
          </div>

          {/* Closeness */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Closeness</div>
            {percentileLabel && <div className="h-3 mb-1"></div>}
            <div className="text-xl font-bold">{format_number(p.closeness_norm, 4) ?? "—"}</div>
          </div>

          {/* Amenities */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Amenities</div>
            {percentileLabel && <div className="h-3 mb-1"></div>}
            <div className="text-xl font-bold text-blue-600 dark:text-blue-400">{p.amenity_count_total || 0}</div>
          </div>

          {/* Flood Events */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-[10px] text-muted-foreground mb-1">Flood Events</div>
            {percentileLabel && <div className="h-3 mb-1"></div>}
            <div className="text-xl font-bold text-orange-600 dark:text-orange-400">{p.flood_count_total || 0}</div>
          </div>
        </div>

        {/* Accordions for Amenities and Flood Events */}
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="amenities">
            <AccordionTrigger className="text-sm font-semibold">
              Amenities ({p.amenity_count_total || 0})
            </AccordionTrigger>
            <AccordionContent>
              {amenityBreakdown.length > 0 ? (
                <ScrollArea className="h-48">
                  <div className="space-y-1.5 pr-2">
                    {amenityBreakdown.map(({ category, count }) => (
                      <div
                        key={category}
                        className="flex items-center justify-between text-xs rounded px-3 py-2 bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <span className="font-medium">{to_title_case(category)}</span>
                        <span className="font-semibold text-blue-600 dark:text-blue-400">{count} items</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No amenities nearby</p>
              )}
              <p className="text-xs text-muted-foreground mt-3 italic">
                Note: Individual amenity item details require backend data integration
              </p>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="floods">
            <AccordionTrigger className="text-sm font-semibold">
              Flood Events ({p.flood_count_total || 0})
            </AccordionTrigger>
            <AccordionContent>
              {floodBreakdown.length > 0 ? (
                <ScrollArea className="h-48">
                  <div className="space-y-1.5 pr-2">
                    {floodBreakdown.map(({ type, count }) => (
                      <div
                        key={type}
                        className="flex items-center justify-between text-xs rounded px-3 py-2 bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <span className="font-medium">{to_title_case(type)}</span>
                        <span className="font-semibold text-orange-600 dark:text-orange-400">{count} events</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-4">No flood events recorded</p>
              )}
              <p className="text-xs text-muted-foreground mt-3 italic">
                Note: Individual flood event details require backend data integration
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
