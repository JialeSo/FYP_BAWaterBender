// src/components/pagecomponents/floodevents/FloodTable.jsx
"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { clamp } from "./utils";
import { useMemo } from "react";

export default function FloodTable({
  // Data
  paged,
  sorted,
  filtered,
  page_safe,
  total_pages,
  visible_cols,

  // Handlers
  set_page,
  set_visible_cols,
  export_csv,
  set_selected,
  focus_select,
  clear_selection,

  // State
  selected,
  sort_col,
  sort_asc,
  set_sort_col,
  set_sort_asc,

  // Filter props
  MultiSelectFilter,
  pending_q,
  set_pending_q,
  event_type_options,
  pending_event_types_filter,
  set_pending_event_types_filter,
  pa_options,
  pending_pa_filter,
  set_pending_pa_filter,
  pending_from_str,
  set_pending_from_str,
  pending_to_str,
  set_pending_to_str,
  pending_roads_total_min,
  set_pending_roads_total_min,
  pending_roads_total_max,
  set_pending_roads_total_max,
  pending_ring_total_min,
  set_pending_ring_total_min,
  pending_ring_total_max,
  set_pending_ring_total_max,
  pending_ar_impact_min,
  set_pending_ar_impact_min,
  pending_ar_impact_max,
  set_pending_ar_impact_max,
  applyTableFilters,
  clearAllTableFilters,
  hasUnappliedFilterChanges,
}) {
  // Table columns configuration
  const columns = [
    // Basic event information
    { key: "id", label: "ID", type: "string" },
    { key: "event_date", label: "Event Date", type: "string" },
    { key: "event", label: "Event Type", type: "string", render: (v) => v?.replace("_", " ") },
    { key: "planning_area", label: "Planning Area", type: "string" },
    { key: "location", label: "Location", type: "string", render: (v, row) => {
      const name = v || "Unnamed";
      const roadId = row._props?.origin_rn_id || row._props?.start_rn_id;
      return roadId ? `${name} (ID: ${roadId})` : name;
    }},
    { key: "parent_road", label: "Road", type: "string", render: (v, row) => {
      const name = v || "Unnamed";
      const roadId = row._props?.origin_rn_id || row._props?.start_rn_id;
      return roadId ? `${name} (ID: ${roadId})` : name;
    }},

    // Primary metrics (shown by default)
    { key: "roads_total", label: "Roads Affected", type: "number" },
    { key: "ring_total", label: "Amenities Affected", type: "number" },
    { key: "betweenness_norm", label: "Betweenness Norm", type: "number" },
    { key: "closeness_norm", label: "Closeness Norm", type: "number" },
    { key: "ar_impact", label: "AR Impact", type: "number" },

    // Detailed breakdowns (optional, hidden by default)
    { key: "roads_inner", label: "Roads (Inner)", type: "number", optional: true },
    { key: "roads_outer", label: "Roads (Outer)", type: "number", optional: true },
    { key: "ring_inner", label: "Amenities (Inner)", type: "number", optional: true },
    { key: "ring_outer", label: "Amenities (Outer)", type: "number", optional: true },
    { key: "impact_inner", label: "Weighted Impact (Inner)", type: "number", optional: true },
    { key: "impact_outer", label: "Weighted Impact (Outer)", type: "number", optional: true },
    { key: "impact_total", label: "Weighted Impact Total", type: "number", optional: true },
    { key: "centrality", label: "Weighted Centrality", type: "number", optional: true },

    // Additional metadata (optional)
    { key: "start_postal_code", label: "Postal Code", type: "string", optional: true },
    { key: "start_lat", label: "Start Latitude", type: "number", optional: true },
    { key: "start_lng", label: "Start Longitude", type: "number", optional: true },
  ];

  // Calculate dynamic max values from filtered data
  const metricRanges = useMemo(() => {
    if (!filtered || filtered.length === 0) {
      return {
        roads_total_max: 100,
        ring_total_max: 100,
        ar_impact_max: 1,
      };
    }
    return {
      roads_total_max: Math.max(...filtered.map(r => r.roads_total || 0), 1),
      ring_total_max: Math.max(...filtered.map(r => r.ring_total || 0), 1),
      ar_impact_max: Math.max(...filtered.map(r => r.ar_impact || 0), 0.001),
    };
  }, [filtered]);

  // Sort icon helper - shows current sort direction for a column
  const sort_icon = (key) => {
    const normalizedKey = key === "dt" ? "event_date" : key;
    if (sort_col !== normalizedKey) {
      return <ArrowUpDown className="h-3 w-3" />;
    }
    return sort_asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Toggle sort on column click
  const toggle_sort = (key) => {
    const normalizedKey = key === "dt" ? "event_date" : key;
    if (sort_col === normalizedKey) {
      // Toggle direction
      set_sort_asc(!sort_asc);
    } else {
      // New column, default to ascending
      set_sort_col(normalizedKey);
      set_sort_asc(true);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card shadow-sm p-6">
      {/* Table Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">All Flood Events</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All flood events in Singapore, click on any to visualise it on the map
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                choose columns
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[360px] max-h-[80vh] p-0">
              <div className="p-2 flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wide">columns</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                      const allKeys = {};
                      columns.forEach(c => allKeys[c.key] = true);
                      set_visible_cols(allKeys);
                    }}>
                      all
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => {
                      const noneKeys = {};
                      columns.forEach(c => noneKeys[c.key] = false);
                      set_visible_cols(noneKeys);
                    }}>
                      none
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => set_visible_cols({
                      id: true, event_date: true, event: true, planning_area: true, location: true, parent_road: true,
                      roads_total: true, ring_total: true, betweenness_norm: true, closeness_norm: true, ar_impact: true,
                      roads_inner: false, roads_outer: false, ring_inner: false, ring_outer: false,
                      impact_inner: false, impact_outer: false, impact_total: false,
                      start_postal_code: false, start_lat: false, start_lng: false,
                    })}>
                      reset
                    </Button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 pr-2">
                  <div className="space-y-1 pb-2">
                    {columns.map((c) => {
                      const active = visible_cols[c.key];
                      return (
                        <label key={c.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer">
                          <span className="text-sm truncate mr-2">{c.label}</span>
                          <input
                            type="checkbox"
                            className="accent-primary shrink-0"
                            checked={active}
                            onChange={() => {
                              set_visible_cols((prev) => ({ ...prev, [c.key]: !active }));
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="secondary" size="sm" onClick={export_csv}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Table Filters Accordion */}
      <Accordion type="single" collapsible className="mb-4">
        <AccordionItem value="table-filters" className="rounded-xl border bg-card shadow-sm">
          <AccordionTrigger className="px-4 py-3 hover:no-underline">
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold">Table Filters</span>
              {hasUnappliedFilterChanges && (
                <span className="px-2 py-1 rounded-md text-xs font-bold text-orange-700 bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300">
                  • Unapplied Changes
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4 pt-2">
            {/* Event Filters Card */}
            <div className="rounded-lg border bg-muted/20 p-3 mb-3">
              <Label className="text-sm font-medium mb-3 block">Event Filters</Label>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="flood-search">Search</Label>
                  <Input
                    id="flood-search"
                    value={pending_q}
                    onChange={(e) => set_pending_q(e.target.value)}
                    placeholder="Search by ID, location or road"
                    className="w-full"
                  />
                </div>
                {MultiSelectFilter && (
                  <>
                    <MultiSelectFilter
                      id="event-type"
                      label="Event Type"
                      options={event_type_options.filter(opt => opt !== "all")}
                      values={pending_event_types_filter}
                      onChange={set_pending_event_types_filter}
                      placeholder="All Event Types"
                    />
                    <MultiSelectFilter
                      id="planning-area"
                      label="Planning Area"
                      options={pa_options}
                      values={pending_pa_filter}
                      onChange={set_pending_pa_filter}
                      placeholder="All Planning Areas"
                    />
                  </>
                )}
              </div>
            </div>

            {/* Date Range Filter */}
            <div className="rounded-lg border bg-muted/20 p-3 mb-3">
              <Label className="text-sm font-medium mb-3 block">Date Range</Label>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="date-from">From Date</Label>
                  <Input
                    id="date-from"
                    type="date"
                    value={pending_from_str}
                    onChange={(e) => set_pending_from_str(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date-to">To Date</Label>
                  <Input
                    id="date-to"
                    type="date"
                    value={pending_to_str}
                    onChange={(e) => set_pending_to_str(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            {/* Metric Range Filters with Sliders */}
            <div className="rounded-lg border bg-muted/20 p-3 mb-3">
              <Label className="text-sm font-medium mb-3 block">Metric Ranges</Label>
              <div className="grid gap-4 md:grid-cols-3">
                {/* Roads Affected Slider */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Roads Affected</Label>
                    <span className="text-xs text-muted-foreground">
                      {Number(pending_roads_total_min) || 0} - {Number(pending_roads_total_max) || metricRanges.roads_total_max} (Max: {metricRanges.roads_total_max})
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={metricRanges.roads_total_max}
                    step={1}
                    value={[
                      Number(pending_roads_total_min) || 0,
                      Number(pending_roads_total_max) || metricRanges.roads_total_max
                    ]}
                    onValueChange={(values) => {
                      set_pending_roads_total_min(String(values[0]));
                      set_pending_roads_total_max(String(values[1]));
                    }}
                  />
                </div>

                {/* Amenities Affected Slider */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Amenities Affected</Label>
                    <span className="text-xs text-muted-foreground">
                      {Number(pending_ring_total_min) || 0} - {Number(pending_ring_total_max) || metricRanges.ring_total_max} (Max: {metricRanges.ring_total_max})
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={metricRanges.ring_total_max}
                    step={1}
                    value={[
                      Number(pending_ring_total_min) || 0,
                      Number(pending_ring_total_max) || metricRanges.ring_total_max
                    ]}
                    onValueChange={(values) => {
                      set_pending_ring_total_min(String(values[0]));
                      set_pending_ring_total_max(String(values[1]));
                    }}
                  />
                </div>

                {/* AR Impact Slider */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">AR Impact</Label>
                    <span className="text-xs text-muted-foreground">
                      {(Number(pending_ar_impact_min) || 0).toFixed(2)} - {(Number(pending_ar_impact_max) || metricRanges.ar_impact_max).toFixed(2)} (Max: {metricRanges.ar_impact_max.toFixed(2)})
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={metricRanges.ar_impact_max}
                    step={0.01}
                    value={[
                      Number(pending_ar_impact_min) || 0,
                      Number(pending_ar_impact_max) || metricRanges.ar_impact_max
                    ]}
                    onValueChange={(values) => {
                      set_pending_ar_impact_min(String(values[0]));
                      set_pending_ar_impact_max(String(values[1]));
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllTableFilters}
              >
                Reset All Filters
              </Button>
              <Button
                size="sm"
                onClick={applyTableFilters}
                disabled={!hasUnappliedFilterChanges}
              >
                Apply Filters
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Table controls - Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <span className="text-sm text-muted-foreground">
          Page {page_safe} of {total_pages} ({filtered.length} events)
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => set_page((p) => clamp(p - 1, 1, total_pages))}
            disabled={page_safe <= 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => set_page((p) => clamp(p + 1, 1, total_pages))}
            disabled={page_safe >= total_pages}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.filter(c => visible_cols[c.key]).map((c) => {
                const k = c.key === "event_date" ? "dt" : c.key;
                return (
                  <th key={c.key} className="px-4 py-3 cursor-pointer select-none" onClick={() => toggle_sort(k)} title="click to sort">
                    <div className="flex items-center gap-2">
                      <span>{c.label}</span>
                      <span className="text-xs">{sort_icon(k)}</span>
                    </div>
                  </th>
                );
              })}
              <th className="px-4 py-3">action</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => {
              const active = String(selected ?? "") === String(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => {
                    set_selected(prev => {
                      const next = String(prev) === String(r.id) ? null : r.id;
                      if (next) {
                        focus_select(next);
                        // Scroll to top to show the map
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      } else {
                        clear_selection();
                      }
                      return next;
                    });
                  }}
                  className={`border-t cursor-pointer hover:bg-muted/60 transition-colors ${active ? "bg-primary/10 border-l-4 border-l-primary" : ""}`}
                >
                  {columns.filter(c => visible_cols[c.key]).map((c) => (
                    <td key={c.key} className="px-4 py-2">
                      {c.render ? c.render(r[c.key], r) : (r[c.key] ?? "N/A")}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        set_selected(prev => {
                          const next = String(prev) === String(r.id) ? null : r.id;
                          if (next) {
                            focus_select(next);
                            // Scroll to top to show the map
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          } else {
                            clear_selection();
                          }
                          return next;
                        });
                      }}
                      className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                    >
                      {active ? "hide" : "view on map"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr>
                <td colSpan={columns.filter(c => visible_cols[c.key]).length + 1} className="px-4 py-6 text-center text-muted-foreground">
                  no rows match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
        <span className="text-sm text-muted-foreground">
          Page {page_safe} of {total_pages} ({filtered.length} events)
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => set_page((p) => clamp(p - 1, 1, total_pages))}
            disabled={page_safe <= 1}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => set_page((p) => clamp(p + 1, 1, total_pages))}
            disabled={page_safe >= total_pages}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
