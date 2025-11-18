"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { X, MapPin, Calendar, AlertTriangle, Settings2, Target, Search } from "lucide-react";
import { format_date, to_title_case, SEVERITY_LEVELS } from "./shared";

// Visualization modes
const VIZ_MODES = [
  { value: "markers", label: "Markers (Points)" },
  { value: "heatmap", label: "Heatmap (Density)" },
  { value: "both", label: "Both" },
];

// Color metrics for flood events
const COLOR_METRICS = [
  { value: "type", label: "Flood Type" },
  { value: "severity", label: "Severity" },
  { value: "date", label: "Date (Recent)" },
];

export function FloodDetailsPanel({
  flood,
  onClose,
  nearbyRoadsByBand = {},
  nearbyAmenitiesByBand = {},
  onFocusFeature = null,
  // Map visualization controls
  vizMode = "markers",
  onVizModeChange = null,
  colorMetric = "type",
  onColorMetricChange = null,
}) {
  // Search state for filtering within tabs
  const [roadSearch, setRoadSearch] = useState("");
  const [amenitySearch, setAmenitySearch] = useState("");

  const p = flood?.properties ?? {};

  // Show prompt if no flood selected
  if (!flood) {
    return (
      <Card className="border-2 border-dashed h-full">
        <CardHeader>
          <CardTitle className="text-lg">Flood Event Details</CardTitle>
          <CardDescription>
            Click on a row in the table below or a marker on the map to view details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-center">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No flood event selected</p>
              <p className="text-xs text-muted-foreground">Select a flood event to view location, severity, and nearby infrastructure</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get severity color
  const severityColor = p.severity
    ? SEVERITY_LEVELS[p.severity.toLowerCase()]?.color || "#6b7280"
    : "#6b7280";

  const floodType = p.flood_type || p.event || p.type || "Unknown";
  const date = p.event_date_iso || p.event_date || p.date || p.dt || "";
  const location = p.location || p.address || p.origin_road || p.start_street_name || "—";
  const planningArea = p.origin_planning_area || p.planning_area || p.PLN_AREA_N || "—";
  const subzone = p.origin_subzone || p.subzone || p.SUBZONE_N || "—";
  const severity = p.severity || p.severity_level || "—";
  const description = p.description || p.details || "";
  const lat = p.origin_lat || p.latitude || p.lat;
  const lng = p.origin_lng || p.longitude || p.lng;

  // Flatten roads from all bands into single list
  const allRoads = useMemo(() => {
    const roads = [];
    if (nearbyRoadsByBand.inner) {
      roads.push(...nearbyRoadsByBand.inner);
    }
    if (nearbyRoadsByBand.outer) {
      roads.push(...nearbyRoadsByBand.outer);
    }
    return roads;
  }, [nearbyRoadsByBand]);

  // Flatten amenities from all bands into single list
  const allAmenities = useMemo(() => {
    const amenities = [];
    if (nearbyAmenitiesByBand.inner) {
      amenities.push(...nearbyAmenitiesByBand.inner);
    }
    if (nearbyAmenitiesByBand.outer) {
      amenities.push(...nearbyAmenitiesByBand.outer);
    }
    return amenities;
  }, [nearbyAmenitiesByBand]);

  // Filtered roads based on search
  const filteredRoads = useMemo(() => {
    if (!roadSearch.trim()) return allRoads;
    const search = roadSearch.toLowerCase();
    return allRoads.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.properties?.name?.toLowerCase().includes(search) ||
      item.properties?.RN_ID?.toString().includes(search) ||
      item._band?.toLowerCase().includes(search)
    );
  }, [allRoads, roadSearch]);

  // Filtered amenities based on search
  const filteredAmenities = useMemo(() => {
    if (!amenitySearch.trim()) return allAmenities;
    const search = amenitySearch.toLowerCase();
    return allAmenities.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.category?.toLowerCase().includes(search) ||
      item.properties?.amenity_name?.toLowerCase().includes(search) ||
      item._band?.toLowerCase().includes(search)
    );
  }, [allAmenities, amenitySearch]);

  // Calculate AR Impact Score (simplified for now - can be enhanced later)
  const arImpactScore = useMemo(() => {
    // Simple calculation: severity weight * (roads + amenities affected)
    const severityWeight = SEVERITY_LEVELS[severity?.toLowerCase()]?.value || 1;
    const totalAffected = allRoads.length + allAmenities.length;
    return (severityWeight * totalAffected).toFixed(0);
  }, [severity, allRoads, allAmenities]);

  return (
    <div className="h-full flex flex-col space-y-3">
      {/* Header with close button */}
      <Card className="border-2 border-primary">
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                {to_title_case(floodType)}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {format_date(date)} · {planningArea}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0" aria-label="Close flood details">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Scrollable content area */}
      <ScrollArea className="flex-1">
        <div className="space-y-3 pr-3">
          {/* (A) Top Section - Flood Event Details */}

          {/* AR Impact Score, Amenities Affected, Roads Affected - 3 cards in a row */}
          <div className="grid grid-cols-3 gap-2">
            <Card className="border-2">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardDescription className="text-[9px] uppercase font-medium">AR Impact Score</CardDescription>
                <CardTitle className="text-2xl font-bold text-primary">{arImpactScore}</CardTitle>
              </CardHeader>
            </Card>

            <Card className="border-2">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardDescription className="text-[9px] uppercase font-medium">Amenities Affected</CardDescription>
                <CardTitle className="text-2xl font-bold text-orange-600">{allAmenities.length}</CardTitle>
              </CardHeader>
            </Card>

            <Card className="border-2">
              <CardHeader className="pb-2 pt-3 px-3">
                <CardDescription className="text-[9px] uppercase font-medium">Roads Affected</CardDescription>
                <CardTitle className="text-2xl font-bold text-blue-600">{allRoads.length}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Event Information Grid */}
          <Card className="border-2">
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-sm font-semibold">Event Information</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Date */}
                <div className="space-y-1">
                  <div className="text-[9px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    Date
                  </div>
                  <div className="text-sm font-medium">{format_date(date)}</div>
                </div>

                {/* Severity */}
                <div className="space-y-1">
                  <div className="text-[9px] font-medium text-muted-foreground uppercase">Severity</div>
                  <div className="text-sm font-bold" style={{ color: severityColor }}>
                    {to_title_case(severity)}
                  </div>
                </div>

                {/* Location */}
                <div className="space-y-1 col-span-2">
                  <div className="text-[9px] font-medium text-muted-foreground uppercase flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Location
                  </div>
                  <div className="text-sm">{location}</div>
                </div>

                {/* Planning Area */}
                <div className="space-y-1">
                  <div className="text-[9px] font-medium text-muted-foreground uppercase">Planning Area</div>
                  <div className="text-sm">{planningArea}</div>
                </div>

                {/* Subzone */}
                <div className="space-y-1">
                  <div className="text-[9px] font-medium text-muted-foreground uppercase">Subzone</div>
                  <div className="text-sm">{subzone}</div>
                </div>

                {/* Coordinates */}
                {lat && lng && (
                  <div className="space-y-1 col-span-2">
                    <div className="text-[9px] font-medium text-muted-foreground uppercase">Coordinates</div>
                    <div className="text-xs font-mono">{Number(lat).toFixed(6)}, {Number(lng).toFixed(6)}</div>
                  </div>
                )}

                {/* Description */}
                {description && (
                  <div className="space-y-1 col-span-2">
                    <div className="text-[9px] font-medium text-muted-foreground uppercase">Description</div>
                    <div className="text-xs">{description}</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Map Settings - Optional Accordion */}
          <Accordion type="single" collapsible className="border rounded-lg">
            <AccordionItem value="map-settings" className="border-none">
              <AccordionTrigger className="px-3 py-2 hover:no-underline">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Map Settings
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 space-y-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Visualization Mode</Label>
                    <Select value={vizMode} onValueChange={onVizModeChange}>
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIZ_MODES.map((mode) => (
                          <SelectItem key={mode.value} value={mode.value}>
                            {mode.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground">Color By</Label>
                    <Select value={colorMetric} onValueChange={onColorMetricChange}>
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COLOR_METRICS.map((metric) => (
                          <SelectItem key={metric.value} value={metric.value}>
                            {metric.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* (B) Bottom Section - Tabs */}
          <Card className="border-2">
            <Tabs defaultValue="roads" className="w-full">
              <div className="border-b px-3 pt-3">
                <TabsList className="w-full grid grid-cols-2">
                  <TabsTrigger value="roads">
                    Affected Roads ({allRoads.length})
                  </TabsTrigger>
                  <TabsTrigger value="amenities">
                    Affected Amenities ({allAmenities.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Affected Roads Tab */}
              <TabsContent value="roads" className="px-3 pb-3 space-y-2 mt-3">
                {/* Search bar */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search roads..."
                    value={roadSearch}
                    onChange={(e) => setRoadSearch(e.target.value)}
                    className="pl-7 h-8 text-xs"
                  />
                </div>

                {filteredRoads.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-1 pr-3">
                      {filteredRoads.map((road, idx) => {
                        const roadName = road.name || road.properties?.name || "Unnamed Road";
                        const roadId = road.properties?.RN_ID || road.id || "";
                        const distance = road._distm;
                        const band = road._band || "unknown";

                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors border border-transparent"
                          >
                            <div className="flex flex-col gap-0.5 flex-1">
                              <span className="font-medium text-foreground">{roadName}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">ID: {roadId}</span>
                                {distance && (
                                  <span className="text-[10px] text-muted-foreground font-medium">{distance.toFixed(0)}m</span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  band === 'inner'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                }`}>
                                  {band}
                                </span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onFocusFeature && onFocusFeature({ item: road, type: 'road' })}
                              className="h-7 px-2 text-[10px] hover:bg-primary/10 ml-2"
                            >
                              <Target className="h-3 w-3 mr-1" />
                              Focus
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    {roadSearch ? "No roads match your search" : "No affected roads"}
                  </p>
                )}
              </TabsContent>

              {/* Affected Amenities Tab */}
              <TabsContent value="amenities" className="px-3 pb-3 space-y-2 mt-3">
                {/* Search bar */}
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <Input
                    placeholder="Search amenities..."
                    value={amenitySearch}
                    onChange={(e) => setAmenitySearch(e.target.value)}
                    className="pl-7 h-8 text-xs"
                  />
                </div>

                {filteredAmenities.length > 0 ? (
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-1 pr-3">
                      {filteredAmenities.map((amenity, idx) => {
                        const amenityName = amenity.name || amenity.properties?.amenity_name || "Unnamed Amenity";
                        const category = amenity.category || amenity.properties?.amenity_category || "Unknown";
                        const distance = amenity._distm;
                        const band = amenity._band || "unknown";

                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors border border-transparent"
                          >
                            <div className="flex flex-col gap-0.5 flex-1">
                              <span className="font-medium text-foreground">{amenityName}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground">{to_title_case(category)}</span>
                                {distance && (
                                  <span className="text-[10px] text-muted-foreground font-medium">{distance.toFixed(0)}m</span>
                                )}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  band === 'inner'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                }`}>
                                  {band}
                                </span>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onFocusFeature && onFocusFeature({ item: amenity, type: 'amenity' })}
                              className="h-7 px-2 text-[10px] hover:bg-primary/10 ml-2"
                            >
                              <Target className="h-3 w-3 mr-1" />
                              Focus
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    {amenitySearch ? "No amenities match your search" : "No affected amenities"}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
