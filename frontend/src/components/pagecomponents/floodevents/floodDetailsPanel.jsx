"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { X, Search, MapPin, Calendar, AlertTriangle } from "lucide-react";
import { format_date, to_title_case, SEVERITY_LEVELS } from "./shared";

export function FloodDetailsPanel({
  flood,
  onClose,
  nearbyRoads = [],
  nearbyAmenities = [],
  onViewOnMap = null
}) {
  // Search state - MUST be called before any conditional returns
  const [roadSearch, setRoadSearch] = useState("");
  const [amenitySearch, setAmenitySearch] = useState("");
  const [selectedRoadIdx, setSelectedRoadIdx] = useState(null);
  const [selectedAmenityIdx, setSelectedAmenityIdx] = useState(null);

  const p = flood?.properties ?? {};

  // Handle clicking on a road/amenity item - notify parent to show on map
  const handleRoadClick = (item, idx) => {
    setSelectedRoadIdx(idx);
    setSelectedAmenityIdx(null);
    if (onViewOnMap) {
      onViewOnMap({ item, type: 'road' });
    }
  };

  const handleAmenityClick = (item, idx) => {
    setSelectedAmenityIdx(idx);
    setSelectedRoadIdx(null);
    if (onViewOnMap) {
      onViewOnMap({ item, type: 'amenity' });
    }
  };

  // Filtered roads based on search
  const filteredRoads = useMemo(() => {
    if (!roadSearch.trim()) return nearbyRoads;
    const search = roadSearch.toLowerCase();
    return nearbyRoads.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.properties?.name?.toLowerCase().includes(search) ||
      item.properties?.RN_ID?.toString().includes(search)
    );
  }, [nearbyRoads, roadSearch]);

  // Filtered amenities based on search
  const filteredAmenities = useMemo(() => {
    if (!amenitySearch.trim()) return nearbyAmenities;
    const search = amenitySearch.toLowerCase();
    return nearbyAmenities.filter(item =>
      item.name?.toLowerCase().includes(search) ||
      item.category?.toLowerCase().includes(search) ||
      item.properties?.amenity_name?.toLowerCase().includes(search)
    );
  }, [nearbyAmenities, amenitySearch]);

  // Show prompt if no flood selected - MUST come after all hooks
  if (!flood) {
    return (
      <Card className="mb-4 border-2 border-dashed">
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

  return (
    <Card className="mb-3 border-2 border-primary">
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

      <CardContent className="space-y-3 px-4 pb-3">
        {/* Event Details Section */}
        <div className="rounded-lg border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-background p-3">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Event Details</h3>
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
        </div>

        {/* Nearby Roads and Amenities Accordions */}
        <Accordion type="multiple" className="space-y-2">
          {/* Nearby Roads Section */}
          <AccordionItem value="roads" className="border rounded-lg bg-background">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <span className="text-sm font-semibold">
                Nearby Roads ({filteredRoads.length})
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-2">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  placeholder="Search roads..."
                  value={roadSearch}
                  onChange={(e) => setRoadSearch(e.target.value)}
                  className="pl-7 h-8 text-xs"
                />
              </div>

              {filteredRoads.length > 0 ? (
                <ScrollArea className="h-64">
                  <div className="space-y-1 pr-3">
                    {filteredRoads.map((item, idx) => {
                      const roadName = item.name || item.properties?.name || "Unnamed Road";
                      const roadId = item.properties?.RN_ID || item.id || "";
                      const distance = item._distm || item.distance;

                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors ${
                            selectedRoadIdx === idx ? 'border-2 border-primary bg-primary/10' : 'border border-transparent'
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{roadName}</span>
                            <span className="text-[10px] text-muted-foreground">ID: {roadId}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {distance && (
                              <span className="text-[10px] text-muted-foreground font-medium">{distance.toFixed(0)}m</span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRoadClick(item, idx)}
                              className="h-6 px-2 text-[10px] hover:bg-primary/10"
                            >
                              View on Map
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {roadSearch ? "No roads match your search" : "No nearby roads"}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Nearby Amenities Section */}
          <AccordionItem value="amenities" className="border rounded-lg bg-background">
            <AccordionTrigger className="px-3 py-2 hover:no-underline">
              <span className="text-sm font-semibold">
                Nearby Amenities ({filteredAmenities.length})
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-2">
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
                    {filteredAmenities.map((item, idx) => {
                      const amenityName = item.name || item.properties?.amenity_name || "Unnamed Amenity";
                      const category = item.category || item.properties?.amenity_category || "";
                      const distance = item._distm || item.distance;

                      return (
                        <div
                          key={idx}
                          className={`flex items-center justify-between text-xs rounded px-2 py-2 bg-muted/30 hover:bg-muted transition-colors ${
                            selectedAmenityIdx === idx ? 'border-2 border-primary bg-primary/10' : 'border border-transparent'
                          }`}
                        >
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-foreground">{amenityName}</span>
                            <span className="text-[10px] text-muted-foreground">{to_title_case(category)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {distance && (
                              <span className="text-[10px] text-muted-foreground font-medium">{distance.toFixed(0)}m</span>
                            )}
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
                      );
                    })}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  {amenitySearch ? "No amenities match your search" : "No nearby amenities"}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
