import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function FloodEventDetails({
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
}) {
  const [amenity_sort, set_amenity_sort] = useState("all"); // "all", "inner", "outer"
  const [road_sort, set_road_sort] = useState("all"); // "all", "inner", "outer"

  if (!selected || !selected_stats) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="text-center space-y-2">
          <MapPin className="h-8 w-8 mx-auto text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">No flood event selected</p>
          <p className="text-[10px] text-muted-foreground">Click on a row in the table below to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ScrollArea className="flex-1" style={{ height: 'calc(36rem - 0px)' }}>
        <div className="p-3 space-y-1.5">
          {/* Header with Close Button */}
          <div className="flex items-center justify-between pb-1.5 border-b">
            <div>
              <h3 className="text-sm font-semibold">Flood Event Details</h3>
              <p className="text-xs text-muted-foreground">
                {selected_props ? (selected_props.start_planning_area || "—") : "—"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Three Metric Cards */}
          <div className="grid grid-cols-3 gap-1">
            {/* AR Impact Score */}
            <Card className="border border-primary/20 bg-primary/5">
              <CardHeader className="pb-0.5 pt-1.5 px-1.5">
                <CardDescription className="text-[8px] uppercase font-medium">AR Impact</CardDescription>
                <CardTitle className="text-base font-bold">
                  {selected_stats.scores?.ar_impact?.toFixed(3) ?? 'N/A'}
                </CardTitle>
              </CardHeader>
            </Card>

            {/* Amenities Affected */}
            <Card className="border">
              <CardHeader className="pb-0.5 pt-1.5 px-1.5">
                <CardDescription className="text-[8px] uppercase font-medium">Amenities</CardDescription>
                <CardTitle className="text-base font-bold text-orange-600">
                  {selected_stats.counts?.total ?? 0}
                </CardTitle>
              </CardHeader>
            </Card>

            {/* Roads Affected */}
            <Card className="border">
              <CardHeader className="pb-0.5 pt-1.5 px-1.5">
                <CardDescription className="text-[8px] uppercase font-medium">Roads</CardDescription>
                <CardTitle className="text-base font-bold text-blue-600">
                  {selected_stats.roads_counts?.total ?? 0}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Event Information Grid */}
          <Card className="border">
            <CardHeader className="pb-0.5 pt-1.5 px-1.5">
              <CardTitle className="text-[10px] font-semibold">Event Information</CardTitle>
            </CardHeader>
            <CardContent className="px-1.5 pb-1.5">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div>
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Event ID</div>
                  <div className="font-mono text-[10px]">{selected_props?.id ?? 'N/A'}</div>
                </div>
                <div>
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Event Type</div>
                  <div className="text-[10px]">{to_title_case(selected_props?.event ?? 'Unknown')}</div>
                </div>
                <div>
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Date</div>
                  <div className="text-[10px]">{selected_props?.event_date ?? 'N/A'}</div>
                </div>
                <div>
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Planning Area</div>
                  <div className="text-[10px]">{selected_props?.start_planning_area ?? 'N/A'}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Location</div>
                  <div className="text-[10px] truncate" title={selected_props?.location}>
                    {selected_props?.location ?? 'N/A'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Main Road</div>
                  <div className="text-[10px] truncate" title={selected_props?.parent_road}>
                    {selected_props?.parent_road ?? 'N/A'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[8px] text-muted-foreground mb-0.5 uppercase">Coordinates</div>
                  <div className="font-mono text-[9px]">
                    {Number.isFinite(Number(selected_props?.start_lat))
                      ? Number(selected_props.start_lat).toFixed(5)
                      : 'N/A'}
                    ,{' '}
                    {Number.isFinite(Number(selected_props?.start_lng))
                      ? Number(selected_props.start_lng).toFixed(5)
                      : 'N/A'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tabs with Amenities and Roads Lists */}
          <Card className="border">
            <CardHeader className="pb-1 pt-1.5 px-2">
              <CardTitle className="text-xs font-semibold">Affected Infrastructure</CardTitle>
            </CardHeader>
            <Tabs defaultValue="amenities" onValueChange={(val) => set_panel_tab(val)} className="w-full">
              <div className="border-b px-2 pt-0">
                <TabsList className="w-full grid grid-cols-2 h-8">
                  <TabsTrigger value="amenities" className="text-[10px]">
                    Amenities ({selected_stats.counts?.total ?? 0})
                  </TabsTrigger>
                  <TabsTrigger value="roads" className="text-[10px]">
                    Roads ({selected_stats.roads_counts?.total ?? 0})
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Amenities Tab */}
              <TabsContent value="amenities" className="px-2 pb-2 space-y-1 mt-2">
                {(() => {
                  const center = selected_stats.center;
                  if (!center) {
                    return <p className="text-xs text-muted-foreground py-3 text-center">No location data</p>;
                  }

                  // Query amenities in both rings, only if bands are enabled
                  const innerAmenities = inner_enabled
                    ? query_amenities(center[0], center[1], r_inner).map(a => ({ ...a, band: 'inner' }))
                    : [];
                  const outerAmenities = outer_enabled
                    ? query_amenities(center[0], center[1], r_outer)
                        .filter(a => a._distm > r_inner)
                        .map(a => ({ ...a, band: 'outer' }))
                    : [];
                  const allAmenities = [...innerAmenities, ...outerAmenities];

                  // Filter by search
                  let filteredAmenities = amenity_search_term.trim()
                    ? allAmenities.filter(a =>
                        (a.name || "").toLowerCase().includes(amenity_search_term.toLowerCase()) ||
                        (a.category || "").toLowerCase().includes(amenity_search_term.toLowerCase())
                      )
                    : allAmenities;

                  // Filter by band
                  if (amenity_sort !== "all") {
                    filteredAmenities = filteredAmenities.filter(a => a.band === amenity_sort);
                  }

                  return (
                    <>
                      {/* Search and Sort Controls */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                          <Input
                            placeholder="Search amenities..."
                            value={amenity_search_term}
                            onChange={(e) => set_amenity_search_term(e.target.value)}
                            className="pl-7 h-7 text-xs"
                          />
                        </div>
                        <Select value={amenity_sort} onValueChange={set_amenity_sort}>
                          <SelectTrigger className="w-24 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" className="text-xs">All</SelectItem>
                            <SelectItem value="inner" className="text-xs">Inner</SelectItem>
                            <SelectItem value="outer" className="text-xs">Outer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredAmenities.length > 0 ? (
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1 pr-2">
                            {filteredAmenities.map((amenity, idx) => {
                              const amenityName = amenity.name || "Unnamed Amenity";
                              const category = amenity.category || "Unknown";
                              const distance = amenity._distm;
                              const band = amenity.band || "unknown";

                              return (
                                <div
                                  key={`${amenity.id}-${idx}`}
                                  className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/30 hover:bg-muted transition-colors"
                                >
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-medium text-foreground truncate text-[10px]">
                                      {amenityName}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] text-muted-foreground">
                                        {to_title_case(category)}
                                      </span>
                                      {distance && (
                                        <span className="text-[9px] text-muted-foreground font-medium">
                                          {distance.toFixed(0)}m
                                        </span>
                                      )}
                                      <span
                                        className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                                          band === 'inner'
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                        }`}
                                      >
                                        {band}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const map = map_ref.current;
                                      if (!map) return;
                                      map.flyTo({
                                        center: [amenity.lng, amenity.lat],
                                        zoom: 17,
                                        essential: true,
                                      });
                                    }}
                                    className="h-6 px-1.5 text-[9px] hover:bg-primary/10 ml-1 shrink-0"
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
                          {amenity_search_term.trim() || amenity_sort !== "all" ? "No amenities match your filters" : "No affected amenities"}
                        </p>
                      )}
                    </>
                  );
                })()}
              </TabsContent>

              {/* Roads Tab */}
              <TabsContent value="roads" className="px-2 pb-2 space-y-1 mt-2">
                {(() => {
                  // Flatten roads from both bands, only if bands are enabled
                  const allRoads = [];
                  if (inner_enabled) {
                    (roads_nearby_state.inner || []).forEach(r => allRoads.push({ ...r, band: 'inner' }));
                  }
                  if (outer_enabled) {
                    (roads_nearby_state.outer || []).forEach(r => allRoads.push({ ...r, band: 'outer' }));
                  }

                  // Filter by search
                  let filteredRoads = road_search_term.trim()
                    ? allRoads.filter(r =>
                        (r.name || "").toLowerCase().includes(road_search_term.toLowerCase()) ||
                        String(r.rn_id || r.RN_ID || "").includes(road_search_term)
                      )
                    : allRoads;

                  // Filter by band
                  if (road_sort !== "all") {
                    filteredRoads = filteredRoads.filter(r => r.band === road_sort);
                  }

                  return (
                    <>
                      {/* Search and Sort Controls */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                          <Input
                            placeholder="Search roads..."
                            value={road_search_term}
                            onChange={(e) => set_road_search_term(e.target.value)}
                            className="pl-7 h-7 text-xs"
                          />
                        </div>
                        <Select value={road_sort} onValueChange={set_road_sort}>
                          <SelectTrigger className="w-24 h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all" className="text-xs">All</SelectItem>
                            <SelectItem value="inner" className="text-xs">Inner</SelectItem>
                            <SelectItem value="outer" className="text-xs">Outer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {filteredRoads.length > 0 ? (
                        <ScrollArea className="h-[200px]">
                          <div className="space-y-1 pr-2">
                            {filteredRoads.map((road, idx) => {
                              const roadName = road.name || "Unnamed Road";
                              const roadId = road.rn_id || road.RN_ID || "";
                              const distance = road.d || road._distm;
                              const band = road.band || "unknown";

                              return (
                                <div
                                  key={`${roadId}-${idx}`}
                                  className="flex items-center justify-between text-xs rounded px-2 py-1.5 bg-muted/30 hover:bg-muted transition-colors"
                                >
                                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                    <span className="font-medium text-foreground truncate text-[10px]">
                                      {roadName}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] text-muted-foreground font-mono">
                                        ID: {roadId}
                                      </span>
                                      {distance && (
                                        <span className="text-[9px] text-muted-foreground font-medium">
                                          {distance}m
                                        </span>
                                      )}
                                      <span
                                        className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                                          band === 'inner'
                                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                                        }`}
                                      >
                                        {band}
                                      </span>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      const map = map_ref.current;
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
                                      } catch {}
                                    }}
                                    className="h-6 px-1.5 text-[9px] hover:bg-primary/10 ml-1 shrink-0"
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
                          {road_search_term.trim() || road_sort !== "all" ? "No roads match your filters" : "No affected roads"}
                        </p>
                      )}
                    </>
                  );
                })()}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
