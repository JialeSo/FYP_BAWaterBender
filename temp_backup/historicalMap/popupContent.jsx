// components/map/PopupContent.jsx
import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

/* ---------- helpers ---------- */

// Clean a category key for display
const pretty = (s = "") =>
  String(s)
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Map { key: count } -> [{ name, count }] (sorted desc, maxBars) */
function mapToSeries(countMap = {}, maxBars = 12) {
  const arr = Object.entries(countMap)
    .map(([name, count]) => ({ name: pretty(name), count: Number(count) || 0 }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);
  return arr.slice(0, maxBars);
}

function SectionCard({ title, accent = "#38bdf8", children }) {
  return (
    <div
      style={{
        background:
          "linear-gradient(180deg, rgba(148,163,184,.18), rgba(15,23,42,.4))",
        border: `1px solid ${accent}`,
        borderRadius: 10,
        padding: 10,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 20px rgba(0,0,0,.25)",
        marginTop: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".5rem",
          marginBottom: 6,
          color: "#e2e8f0",
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: accent,
          }}
        />
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

/** Key-value row; first row can be a big title line */
function KV({ label, value, big = false }) {
  if (big) {
    return (
      <div style={{ marginBottom: 6 }}>
        <div
          style={{
            color: "#94a3b8",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: ".02em",
          }}
        >
          {label}
        </div>
        <div
          style={{
            color: "#e2e8f0",
            fontWeight: 800,
            fontSize: 16,
            lineHeight: "22px",
          }}
        >
          {value}
        </div>
      </div>
    );
  }
  return (
    <div style={{ color: "#cbd5e1", fontSize: 12, lineHeight: "18px" }}>
      {label}: <strong style={{ color: "#fff" }}>{value}</strong>
    </div>
  );
}

function SmallBarChart({ data, height, barColor = "#60a5fa" }) {
  if (!data || !data.length) {
    return <div style={{ color: "#94a3b8", fontSize: 12 }}>no data available</div>;
  }

  // auto-height so each bar gets room
  const autoH = Math.max(44 + data.length * 22, 120);
  const h = height ?? autoH;

  return (
    <div style={{ width: "100%", height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal stroke="#334155" strokeDasharray="3 3" />
          {/* value axis (x) */}
          <XAxis
            type="number"
            tick={{ fill: "#cbd5e1", fontSize: 10 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={{ stroke: "#475569" }}
            allowDecimals={false}
          />
          {/* category axis (y) */}
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "#cbd5e1", fontSize: 10 }}
            axisLine={{ stroke: "#475569" }}
            tickLine={{ stroke: "#475569" }}
            width={128} // adjust if names are long
          />
          <Tooltip
            cursor={{ fill: "rgba(148,163,184,0.12)" }}
            wrapperStyle={{ fontSize: 12 }}
            contentStyle={{
              background: "#0b1220",
              border: "1px solid rgba(148,163,184,0.35)",
              borderRadius: 8,
              color: "#e2e8f0",
            }}
            labelStyle={{ color: "#fff" }}
          />
          <Bar dataKey="count" fill={barColor} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- main component ---------- */

/**
 * Props:
 *  - header: [{label, value}]   (first item renders as big title automatically)
 *  - floods: { total: number, byCategory: { [name]: count } }
 *  - amenities: { total: number, byCategory: { [name]: count } }
 *  - mode: "planning" | "subzone" | "road" | "event" | "amenity"
 */
export default function PopupContent({
  header = [],
  floods = { total: 0, byCategory: {} },
  amenities = { total: 0, byCategory: {} },
  mode = "planning",
}) {
  const accents = {
    planning: { floods: "#38bdf8", amenities: "#10b981" },
    subzone: { floods: "#38bdf8", amenities: "#10b981" },
    road: { floods: "#38bdf8", amenities: "#10b981" },
    event: { floods: "#38bdf8", amenities: "#10b981" },
    amenity: { floods: "#38bdf8", amenities: "#10b981" },
  };

  const floodSeries = mapToSeries(floods.byCategory, 12);
  const amenSeries = mapToSeries(amenities.byCategory, 12);

  return (
    <div
      className="recharts-popup"
      style={{
        color: "#e2e8f0",
        fontSize: 12,
        lineHeight: "18px",
        width: 360,
        maxWidth: "82vw",
      }}
    >
      {/* header */}
      <div style={{ marginBottom: 6 }}>
        {header.map((kv, i) => (
          <KV
            key={`${kv.label}-${i}`}
            label={kv.label}
            value={kv.value}
            big={i === 0}
          />
        ))}
      </div>

      {/* floods */}
      <SectionCard title="No. of floods — by type" accent={accents[mode].floods}>
        <KV label="total" value={floods.total} />
        <div style={{ marginTop: 6 }}>
          <SmallBarChart data={floodSeries} barColor={accents[mode].floods} />
        </div>
      </SectionCard>

      {/* amenities */}
      <SectionCard title="No. of amenities — by category" accent={accents[mode].amenities}>
        <KV label="total" value={amenities.total} />
        <div style={{ marginTop: 6 }}>
          <SmallBarChart data={amenSeries} barColor={accents[mode].amenities} />
        </div>
      </SectionCard>
    </div>
  );
}
