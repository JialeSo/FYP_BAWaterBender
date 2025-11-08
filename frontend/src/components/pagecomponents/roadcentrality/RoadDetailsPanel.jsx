"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X } from "lucide-react";
import { format_number, to_title_case } from "./shared";

export function RoadDetailsPanel({ road, onClose, amenityCounts, floodCounts }) {
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

  const amenityBreakdown = useMemo(() => {
    if (!amenityCounts) return [];
    return Object.entries(amenityCounts)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }, [amenityCounts]);

  const floodBreakdown = useMemo(() => {
    if (!floodCounts) return [];
    return Object.entries(floodCounts)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [floodCounts]);

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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Importance Score</div>
            <div className="text-lg font-bold">{format_number(p.importance, 2) ?? "—"}</div>
          </div>
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">SLA Priority</div>
            <div className="text-lg font-bold">{format_number(p.sla_priority, 2) ?? "—"}</div>
          </div>
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Betweenness</div>
            <div className="text-lg font-bold">{format_number(p.betweenness_norm, 4) ?? "—"}</div>
          </div>
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Closeness</div>
            <div className="text-lg font-bold">{format_number(p.closeness_norm, 4) ?? "—"}</div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Amenities ({p.amenity_count_total || 0})</h4>
            {amenityBreakdown.length > 0 ? (
              <ScrollArea className="h-32">
                <div className="space-y-1.5 pr-2">
                  {amenityBreakdown.map(({ category, count }) => (
                    <div key={category} className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/50">
                      <span>{to_title_case(category)}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-xs text-muted-foreground">No amenities nearby</p>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-2">Flood Events ({p.flood_count_total || 0})</h4>
            {floodBreakdown.length > 0 ? (
              <ScrollArea className="h-32">
                <div className="space-y-1.5 pr-2">
                  {floodBreakdown.map(({ type, count }) => (
                    <div key={type} className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/50">
                      <span>{to_title_case(type)}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="text-xs text-muted-foreground">No flood events recorded</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
