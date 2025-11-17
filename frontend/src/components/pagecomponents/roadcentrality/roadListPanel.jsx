"use client";

import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format_number } from "./shared";

export function RoadListPanel({ roads, selectedRoadId, onSelectRoad }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("importance"); // "importance" | "sla_priority" | "amenity_count_total" | "flood_count_total" | "betweenness_norm" | "closeness_norm"
  const [sortDir, setSortDir] = useState("desc");       // "asc" | "desc"

  // Keeps search responsive on large lists
  const dq = useDeferredValue(q);

  // Lightweight projection: features -> row objects
  const rows = useMemo(() => {
    if (!Array.isArray(roads)) return [];
    return roads.map((f) => {
      const p = (f && f.properties) || {};
      const id = p.RN_ID ?? "";
      return {
        id,
        name: p.name || "Unnamed Road",
        area: p.PLN_AREA_N || "",
        importance: Number(p.importance) || 0,
        sla_priority: Number(p.sla_priority) || 0,
        amenity_count_total: Number(p.amenity_count_total) || 0,
        flood_count_total: Number(p.flood_count_total) || 0,
        betweenness_norm: Number(p.betweenness_norm) || 0,
        closeness_norm: Number(p.closeness_norm) || 0,
      };
    });
  }, [roads]);

  // Filter (name/area/id). Using deferred query for UX smoothness.
  const filtered = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const hay = `${r.name} ${r.area} ${String(r.id)}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, dq]);

  // Sort (numeric-smart)
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortKey] ?? 0;
      const vb = b[sortKey] ?? 0;
      const diff = Number(va) - Number(vb);
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
      if (onSelectRoad) onSelectRoad(id);
    },
    [onSelectRoad]
  );

  return (
    <div className="h-full flex flex-col bg-card border rounded-2xl shadow-sm">
      {/* Header / Search */}
      <div className="p-4 border-b">
        <h2 className="text-base font-semibold mb-3">Road Segments</h2>
        <Input
          placeholder="Search by name, area, or ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground mt-2">
          {sorted.length.toLocaleString()} roads
        </p>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="min-w-[880px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <Th text="Name" />
                <Th text="ID" />
                <Th text="Area" />
                <ThSort
                  text="Importance"
                  active={sortKey === "importance"}
                  dir={sortDir}
                  onClick={() => toggleSort("importance")}
                />
                <ThSort
                  text="Maint. Cat."
                  active={sortKey === "sla_priority"}
                  dir={sortDir}
                  onClick={() => toggleSort("sla_priority")}
                />
                <ThSort
                  text="Amenities"
                  active={sortKey === "amenity_count_total"}
                  dir={sortDir}
                  onClick={() => toggleSort("amenity_count_total")}
                />
                <ThSort
                  text="Floods"
                  active={sortKey === "flood_count_total"}
                  dir={sortDir}
                  onClick={() => toggleSort("flood_count_total")}
                />
                <ThSort
                  text="Betweenness"
                  active={sortKey === "betweenness_norm"}
                  dir={sortDir}
                  onClick={() => toggleSort("betweenness_norm")}
                />
                <ThSort
                  text="Closeness"
                  active={sortKey === "closeness_norm"}
                  dir={sortDir}
                  onClick={() => toggleSort("closeness_norm")}
                />
              </tr>
            </thead>

            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                    No roads.
                  </td>
                </tr>
              ) : (
                sorted.map((r, i) => {
                  const selected = r.id === selectedRoadId;
                  return (
                    <tr
                      key={r.id ?? i}
                      onClick={() => handleSelect(r.id)}
                      className={`border-t hover:bg-muted/60 cursor-pointer ${selected ? "bg-primary/10" : ""}`}
                    >
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2">{r.id ?? "—"}</td>
                      <td className="px-4 py-2">{r.area || "—"}</td>
                      <td className="px-4 py-2 font-medium">{format_number(r.importance, 2) ?? "—"}</td>
                      <td className="px-4 py-2">{format_number(r.sla_priority, 2) ?? "—"}</td>
                      <td className="px-4 py-2">{r.amenity_count_total}</td>
                      <td className="px-4 py-2">{r.flood_count_total}</td>
                      <td className="px-4 py-2">{format_number(r.betweenness_norm, 4) ?? "—"}</td>
                      <td className="px-4 py-2">{format_number(r.closeness_norm, 4) ?? "—"}</td>
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
