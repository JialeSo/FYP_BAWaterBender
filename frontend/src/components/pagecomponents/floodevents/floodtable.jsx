import { useMemo } from "react";
import { useMapData } from "@/context/MapDataContext";

function cell(v) { return v ?? ""; }

export default function FloodTable({ selectedId = null, onSelect = () => {} }) {
  const { floodsFC } = useMapData();

  const rows = useMemo(() => {
    const fc = floodsFC || { type: "FeatureCollection", features: [] };
    return (fc.features || []).map((f) => ({
      id: String(f.properties?.id ?? f.id ?? ""),
      event_date: cell(f.properties?.event_date),
      event: cell(f.properties?.event),
      location: cell(f.properties?.location),
      start_lat: f.geometry?.coordinates?.[1],
      start_lng: f.geometry?.coordinates?.[0],
      text: cell(f.properties?.text),
    }));
  }, [floodsFC]);

  return (
    <div className="w-full overflow-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">id</th>
            <th className="px-3 py-2 font-medium">date</th>
            <th className="px-3 py-2 font-medium">type</th>
            <th className="px-3 py-2 font-medium">location</th>
            <th className="px-3 py-2 font-medium">lat</th>
            <th className="px-3 py-2 font-medium">lng</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const active = String(selectedId ?? "") === String(r.id);
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`cursor-pointer border-t hover:bg-muted/40 ${active ? "bg-amber-50" : ""}`}
              >
                <td className="px-3 py-2 whitespace-nowrap font-medium">{r.id}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.event_date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.event}</td>
                <td className="px-3 py-2">{r.location}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {typeof r.start_lat === "number" ? r.start_lat.toFixed(6) : ""}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {typeof r.start_lng === "number" ? r.start_lng.toFixed(6) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
