"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format_date, to_title_case } from "./shared";

export function FloodListPanel({ floods, selectedFloodId, onSelectFlood }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("date"); // "date" | "type" | "planning_area" | "location" | "severity"
  const [sortDir, setSortDir] = useState("desc"); // "asc" | "desc"

  // Keeps search responsive on large lists
  const dq = useDeferredValue(q);

  // Lightweight projection: features -> row objects
  const rows = useMemo(() => {
    if (!Array.isArray(floods)) return [];
    return floods.map((f, idx) => {
      const p = (f && f.properties) || {};
      const id = p.id ?? p.event_id ?? p.flood_id ?? idx;
      return {
        id,
        name: p.name || p.location || "Unnamed Event",
        type: p.flood_type || p.event || p.type || "unknown",
        date: p.event_date_iso || p.event_date || p.date || p.dt || "",
        planning_area: p.origin_planning_area || p.planning_area || p.PLN_AREA_N || "",
        subzone: p.origin_subzone || p.subzone || p.SUBZONE_N || "",
        location: p.location || p.address || p.origin_road || p.start_street_name || "",
        severity: p.severity || p.severity_level || "",
        lat: p.origin_lat || p.latitude || p.lat,
        lng: p.origin_lng || p.longitude || p.lng,
      };
    });
  }, [floods]);

  // Filter (name/type/location/area). Using deferred query for UX smoothness.
  const filtered = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = `${r.name} ${r.type} ${r.location} ${r.planning_area} ${r.subzone}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, dq]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va = a[sortKey] ?? "";
      let vb = b[sortKey] ?? "";

      // Special handling for dates
      if (sortKey === "date") {
        va = va ? new Date(va).getTime() : 0;
        vb = vb ? new Date(vb).getTime() : 0;
      }

      // Convert to strings for comparison
      const diff = String(va).localeCompare(String(vb));
      return sortDir === "asc" ? diff : -diff;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    }
  };

  const handleSelect = useCallback(
    (id) => {
      if (onSelectFlood) onSelectFlood(id);
    },
    [onSelectFlood]
  );

  return (
    <div className="h-full flex flex-col bg-card border rounded-2xl shadow-sm">
      {/* Header / Search */}
      <div className="p-4 border-b">
        <h2 className="text-base font-semibold mb-3">Flood Events</h2>
        <Input
          placeholder="Search by type, location, area..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground mt-2">
          {sorted.length.toLocaleString()} events
        </p>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="min-w-[880px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <ThSort
                  text="Date"
                  active={sortKey === "date"}
                  dir={sortDir}
                  onClick={() => toggleSort("date")}
                />
                <ThSort
                  text="Type"
                  active={sortKey === "type"}
                  dir={sortDir}
                  onClick={() => toggleSort("type")}
                />
                <ThSort
                  text="Planning Area"
                  active={sortKey === "planning_area"}
                  dir={sortDir}
                  onClick={() => toggleSort("planning_area")}
                />
                <Th text="Subzone" />
                <ThSort
                  text="Location"
                  active={sortKey === "location"}
                  dir={sortDir}
                  onClick={() => toggleSort("location")}
                />
                <ThSort
                  text="Severity"
                  active={sortKey === "severity"}
                  dir={sortDir}
                  onClick={() => toggleSort("severity")}
                />
                <Th text="Coordinates" />
              </tr>
            </thead>

            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No flood events.
                  </td>
                </tr>
              ) : (
                sorted.map((r, i) => {
                  const selected = r.id === selectedFloodId;
                  return (
                    <tr
                      key={r.id ?? i}
                      onClick={() => handleSelect(r.id)}
                      className={`border-t hover:bg-muted/60 cursor-pointer ${selected ? "bg-primary/10" : ""}`}
                    >
                      <td className="px-4 py-2">{format_date(r.date)}</td>
                      <td className="px-4 py-2">{to_title_case(r.type)}</td>
                      <td className="px-4 py-2">{r.planning_area || "—"}</td>
                      <td className="px-4 py-2">{r.subzone || "—"}</td>
                      <td className="px-4 py-2">{r.location || "—"}</td>
                      <td className="px-4 py-2">{to_title_case(r.severity) || "—"}</td>
                      <td className="px-4 py-2 text-xs">
                        {r.lat && r.lng ? `${Number(r.lat).toFixed(4)}, ${Number(r.lng).toFixed(4)}` : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </ScrollArea>
    </div>
  );
}

/* ---------- tiny header helpers ---------- */
function Th({ text }) {
  return <th className="px-4 py-3 select-none whitespace-nowrap">{text}</th>;
}

function ThSort({ text, active, dir, onClick }) {
  return (
    <th
      className="px-4 py-3 cursor-pointer select-none whitespace-nowrap"
      onClick={onClick}
      title="Click to sort"
    >
      <div className="flex items-center gap-1.5">
        <span>{text}</span>
        {active ? <span className="text-[10px]">{dir === "desc" ? "↓" : "↑"}</span> : null}
      </div>
    </th>
  );
}
