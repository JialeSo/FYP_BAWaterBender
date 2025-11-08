"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download } from "lucide-react";
import { PAGE_SIZE, format_cell, to_title_case } from "./shared";

export function CentralityTable({
  rows,
  totalRows,
  currentPage,
  totalPages,
  onPageChange,
  allColumnDefs,
  defaultKeys = ["RN_ID", "name", "PLN_AREA_N", "importance", "sla_priority", "flood_count_total", "amenity_count_total", "betweenness_norm", "closeness_norm"],
  onRowClick,
}) {
  const [tableQ, setTableQ] = useState("");
  const [sortKey, setSortKey] = useState("importance");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedCols, setSelectedCols] = useState(defaultKeys);

  const columnMap = useMemo(() => {
    const m = Object.create(null);
    for (const c of allColumnDefs) m[c.key] = c;
    return m;
  }, [allColumnDefs]);

  const visibleColumns = useMemo(
    () => selectedCols.map((k) => columnMap[k]).filter(Boolean),
    [selectedCols, columnMap],
  );

  const start = totalRows === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const end = totalRows === 0 ? 0 : Math.min(totalRows, currentPage * PAGE_SIZE);

  const filteredRows = useMemo(() => {
    const q = tableQ.trim().toLowerCase();
    if (!q) return rows;
    const keysForSearch = Object.keys(columnMap);
    return rows.filter((f) => {
      const p = f?.properties || {};
      for (const k of keysForSearch) {
        const v = p[k];
        if (v === null || v === undefined) continue;
        const s = String(v).toLowerCase();
        if (s.includes(q)) return true;
      }
      return false;
    });
  }, [rows, tableQ, columnMap]);

  const sortedRows = useMemo(() => {
    const arr = [...filteredRows];
    arr.sort((a, b) => {
      const pa = a?.properties || {};
      const pb = b?.properties || {};
      const va = pa[sortKey];
      const vb = pb[sortKey];
      const na = Number(va);
      const nb = Number(vb);
      const bothNum = Number.isFinite(na) && Number.isFinite(nb);
      let cmp = 0;
      if (bothNum) cmp = na - nb;
      else cmp = String(va ?? "").localeCompare(String(vb ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredRows, sortKey, sortDir]);

  const pageRows = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return sortedRows.slice(startIndex, startIndex + PAGE_SIZE);
  }, [sortedRows, currentPage]);

  const toggleSort = (key) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("desc");
    } else {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    }
  };

  const allColumnLabels = useMemo(() => allColumnDefs.map((c) => c.key), [allColumnDefs]);

  const exportCsv = () => {
    const header = visibleColumns.map((c) => c.label || to_title_case(c.key));
    const lines = [header.join(",")];

    for (const f of sortedRows) {
      const p = f?.properties || {};
      const row = visibleColumns.map((c) => {
        let v = p[c.key];
        if (c.format && typeof v === "number") {
          const out = c.format(v);
          if (out !== null && out !== undefined) v = out;
        }
        if (v === null || v === undefined) v = "";
        const str = String(v).replace(/"/g, '""');
        return `"${str}"`;
      });
      lines.push(row.join(","));
    }

    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "centrality_export.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            showing {start.toLocaleString()} to {end.toLocaleString()} of {totalRows.toLocaleString()} segments
          </span>
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
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(allColumnLabels)}>
                      all
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols([])}>
                      none
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setSelectedCols(defaultKeys)}>
                      reset
                    </Button>
                  </div>
                </div>
                <div className="overflow-y-auto flex-1 min-h-0 pr-2">
                  <div className="space-y-1 pb-2">
                    {allColumnDefs.map((c) => {
                      const active = selectedCols.includes(c.key);
                      return (
                        <label key={c.key} className="flex items-center justify-between rounded px-2 py-1 hover:bg-muted cursor-pointer">
                          <span className="text-sm truncate mr-2">{c.label || to_title_case(c.key)}</span>
                          <input
                            type="checkbox"
                            className="accent-primary shrink-0"
                            checked={active}
                            onChange={() => {
                              setSelectedCols((prev) => (active ? prev.filter((k) => k !== c.key) : [...prev, c.key]));
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

          <Input value={tableQ} onChange={(e) => setTableQ(e.target.value)} placeholder="filter table..." className="w-56" />

          <Button onClick={exportCsv} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            export csv
          </Button>
        </div>
      </div>

      {totalRows > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
            previous
          </Button>
          <span className="text-xs text-muted-foreground">
            page {currentPage} / {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
            next
          </Button>
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {visibleColumns.map((col) => {
                const isSort = col.key === sortKey;
                return (
                  <th key={col.key} className="px-4 py-3 cursor-pointer select-none" onClick={() => toggleSort(col.key)} title="click to sort">
                    <div className="flex items-center gap-2">
                      <span>{col.label || to_title_case(col.key)}</span>
                      {isSort && <span className="text-xs">{sortDir === "desc" ? "↓" : "↑"}</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="px-4 py-6 text-center text-muted-foreground">
                  no segments.
                </td>
              </tr>
            ) : (
              pageRows.map((f, i) => {
                const p = f?.properties ?? {};
                const key = p.RN_ID ?? p.osmid ?? i;
                return (
                  <tr
                    key={key}
                    className="border-t hover:bg-muted/60 cursor-pointer transition-colors"
                    onClick={() => onRowClick && onRowClick(p.RN_ID)}
                    title="Click to view on map"
                  >
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-4 py-2">
                        {format_cell(p[col.key], col)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalRows > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t pt-4">
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>
            previous
          </Button>
          <span className="text-xs text-muted-foreground">
            page {currentPage} / {totalPages}
          </span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>
            next
          </Button>
        </div>
      )}
    </div>
  );
}
