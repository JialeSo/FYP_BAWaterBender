// RightPanel.jsx
import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, BarChart3, LineChart as LineChartIcon, Loader2, ListOrdered } from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts"

const formatNumber = (v) => v?.toLocaleString?.("en-SG", { maximumFractionDigits: 0 }) ?? "0"

const chartTooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--card-foreground)",
}
const chartLabelStyle = { color: "var(--muted-foreground)" }

const MetricCard = ({ title, value, subtitle }) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
      {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
    </CardContent>
  </Card>
)

/** Ranked list that optionally shows a subLabel under the main label */
const RankedList = ({ title, items, emptyLabel }) => (
  <Card>
    <CardHeader className="pb-4">
      <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {!items?.length ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {items.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-foreground">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  {item.subLabel ? (
                    <span className="block truncate text-xs text-muted-foreground/80">{item.subLabel}</span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 font-medium text-muted-foreground">{formatNumber(item.count)}</span>
            </li>
          ))}
        </ol>
      )}
    </CardContent>
  </Card>
)

const determineContextLabel = (selectedPAs) => {
  if (selectedPAs?.length > 1) return `${selectedPAs.length} planning areas selected`
  if (selectedPAs?.length === 1) return selectedPAs[0]
  return "All planning areas"
}

export default function RightPanel({
  feature,                  // subzone feature if drilled
  stats,                    // flood insights from DashboardLayout
  amenityStats,             // amenity insights (optional)
  loading,
  error,
  onClearSelection,         // kept (unused in UI)
  selectedPlanningAreas = [],
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading analytics…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        <div className="flex max-w-xs flex-col items-center gap-3">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p>{error}</p>
        </div>
      </div>
    )
  }

  // Toggle: 'floods' | 'amenities'
  const [mode, setMode] = useState("floods")
  const isFloods = mode === "floods"

  // Safe shapes
  const safeFlood = stats ?? {
    totals: { events: 0, subzoneEvents: 0, planningAreas: 0, subzones: 0, roads: 0, topType: null },
    byPlanningArea: [],
    bySubzone: [],
    byType: [],
    yearSeries: [],
    topRoads: [],
    topSubzones: [],
    focusSubzoneName: null,
    planningCountMap: {},
    overallPlanningCountMap: {},
  }
  const safeAmen = amenityStats ?? {
    totals: { amenities: 0, planningAreas: 0, subzones: 0, categories: 0, types: 0, topCategory: null, topType: null },
    byPlanningArea: [],
    bySubzone: [],
    byCategory: [],
    byType: [],
    topSubzones: [],
    topTypes: [],
    topRoads: [],
    planningCountMap: {},
    overallPlanningCountMap: {},
  }

  // View states (based on *selection* not just clicks)
  const planningAreaName = selectedPlanningAreas[0] || null
  const isSubzoneDetail = Boolean(feature?.properties?.SUBZONE_N || safeFlood.focusSubzoneName)
  const isPlanningAreaFocus = !isSubzoneDetail && selectedPlanningAreas.length === 1
  // OUT view when 0 or >1 PAs
  const isOutView = !isSubzoneDetail && !isPlanningAreaFocus

  const planningContext = determineContextLabel(selectedPlanningAreas)

  // Footer planning list source (respect selection)
  const planningList = useMemo(() => {
    const src = isFloods ? safeFlood.byPlanningArea : safeAmen.byPlanningArea
    if (!Array.isArray(src)) return []
    return selectedPlanningAreas.length
      ? src.filter((item) => selectedPlanningAreas.includes(item.label))
      : src
  }, [isFloods, safeFlood.byPlanningArea, safeAmen.byPlanningArea, selectedPlanningAreas])

  /* ---------------- Flood helpers ---------------- */
  const floodYearSeries  = safeFlood.yearSeries || []
  const floodTopSubzones = safeFlood.topSubzones || []

  // Flood types list — same look as subzone chart
  const floodTypesList = useMemo(() => {
    const rows = (safeFlood.byType || []).map(({ label, count }) => ({ name: label, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [safeFlood.byType])

  // nation-wide PA breakdown (include zeros)
  const allPAKeys = Object.keys(safeFlood.overallPlanningCountMap || {})
  const currentPAMap = safeFlood.planningCountMap || {}
  const floodsByPAAll = allPAKeys.map((name) => ({ name, count: currentPAMap[name] ?? 0 }))
    .sort((a, b) => b.count - a.count)

  // subzone breakdown within selected PA
  const floodsBySubzoneInPA = useMemo(() => {
    const rows = (safeFlood.bySubzone || []).map(({ label, count }) => ({ name: label, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [safeFlood.bySubzone])

  // roads list (top 10) with PA/Subzone under label
  const topRoadsFlood = (safeFlood.topRoads || []).slice(0, 10).map((r) => {
    const pa = r.planningArea || planningAreaName || "—"
    const sub = r.subzone || (feature?.properties?.SUBZONE_N ?? safeFlood.focusSubzoneName) || null
    const subLabel = sub ? `${sub} • ${pa}` : pa
    return { label: r.name, subLabel, count: r.count }
  })

  // subzone footer list with PA shown
  const subzoneFooterListFlood = useMemo(() => {
    const rows = (safeFlood.bySubzone || []).map(({ label, count, planningArea }) => ({
      label,
      subLabel: planningArea || planningAreaName || "—",
      count,
    }))
    return rows.sort((a, b) => b.count - a.count).slice(0, 10)
  }, [safeFlood.bySubzone, planningAreaName])

  /* ---------------- Amenities helpers (mirrors floods) ---------------- */
  // amen categories & types as scrollable vertical charts
  const amenCategoriesList = useMemo(() => {
    const rows = (safeAmen.byCategory || []).map(({ label, count }) => ({ name: label, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [safeAmen.byCategory])

  const amenTypesList = useMemo(() => {
    const rows = (safeAmen.topTypes?.length ? safeAmen.topTypes : safeAmen.byType || [])
      .map(({ label, name, count }) => ({ name: label ?? name, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [safeAmen.topTypes, safeAmen.byType])

  // nation-wide PA breakdown (include zeros if overall map provided)
  const allPAKeysAmen = Object.keys(safeAmen.overallPlanningCountMap || {})
  const currentPAMapAmen = safeAmen.planningCountMap || {}
  const amenitiesByPAAll = (allPAKeysAmen.length
    ? allPAKeysAmen.map((name) => ({ name, count: currentPAMapAmen[name] ?? 0 }))
    : (safeAmen.byPlanningArea || []).map(({ label, count }) => ({ name: label, count })))
    .sort((a, b) => b.count - a.count)

  // subzone breakdown within selected PA
  const amenitiesBySubzoneInPA = useMemo(() => {
    const rows = (safeAmen.bySubzone || []).map(({ label, count }) => ({ name: label, count }))
    return rows.sort((a, b) => b.count - a.count)
  }, [safeAmen.bySubzone])

  // roads list (top 10) with PA/Subzone under label
  const topRoadsAmen = (safeAmen.topRoads || []).slice(0, 10).map((r) => {
    const pa = r.planningArea || planningAreaName || "—"
    const sub = r.subzone || (feature?.properties?.SUBZONE_N ?? null)
    const subLabel = sub ? `${sub} • ${pa}` : pa
    return { label: r.name, subLabel, count: r.count }
  })

  // subzone footer list with PA shown
  const subzoneFooterListAmen = useMemo(() => {
    const rows = (safeAmen.bySubzone || []).map(({ label, count, planningArea }) => ({
      label,
      subLabel: planningArea || planningAreaName || "—",
      count,
    }))
    return rows.sort((a, b) => b.count - a.count).slice(0, 10)
  }, [safeAmen.bySubzone, planningAreaName])

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-6">
      {/* Mode toggle */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm font-semibold text-muted-foreground">Analytics mode</CardTitle>
              <CardDescription>Switch between Floods and Amenities</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant={isFloods ? "default" : "outline"} size="sm" onClick={() => setMode("floods")}>
                Floods
              </Button>
              <Button variant={!isFloods ? "default" : "outline"} size="sm" onClick={() => setMode("amenities")}>
                Amenities
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-3">
        {isFloods ? (
          <>
            <MetricCard title="Flood events"       value={formatNumber(safeFlood.totals.events)}   subtitle={planningContext} />
            <MetricCard title="Impacted subzones"  value={formatNumber(safeFlood.totals.subzones)} subtitle="Within selection" />
            <MetricCard title="Impacted roads"     value={formatNumber(safeFlood.totals.roads)}    subtitle="Unique segments" />
          </>
        ) : (
          <>
            <MetricCard title="Amenities"          value={formatNumber(safeAmen.totals.amenities)} subtitle={planningContext} />
            <MetricCard title="Amenity categories" value={formatNumber(safeAmen.totals.categories)} subtitle="Distinct categories" />
            <MetricCard title="Amenity types"      value={formatNumber(safeAmen.totals.types)}      subtitle="Distinct types" />
          </>
        )}
      </div>

      {/* ===== FLOODS ===== */}
      {isFloods ? (
        <>
          {/* Over time */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <LineChartIcon className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Flood events over time</CardTitle>
                  <CardDescription>Yearly counts within the current selection</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="h-56">
              {floodYearSeries.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={floodYearSeries}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                    <XAxis dataKey="year" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={40} />
                    <Tooltip formatter={(v) => formatNumber(v)} cursor={{ stroke: "var(--primary)", strokeOpacity: 0.5 }} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                    <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }}>
                      <LabelList dataKey="count" position="top" formatter={(v) => formatNumber(v)} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No timeline data available.</div>
              )}
            </CardContent>
          </Card>

          {/* Flood types — same look as subzone */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Flood types</CardTitle>
                  <CardDescription>Scroll to see all flood types</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="h-56">
              <div className="h-56 overflow-y-auto pr-2">
                <div style={{ height: Math.max((floodTypesList?.length || 0) * 28, 224) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={floodTypesList} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                      <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={170} tickMargin={6} />
                      <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                        <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Out / PA focus / Subzone detail */}
          {isOutView && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-muted-foreground">Floods by planning area</CardTitle>
                    <CardDescription>Scroll to see all areas</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-56">
                <div className="h-56 overflow-y-auto pr-2">
                  <div style={{ height: Math.max(floodsByPAAll.length * 28, 224) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={floodsByPAAll} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                        <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={170} tickMargin={6} />
                        <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                          <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isPlanningAreaFocus && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-muted-foreground">
                      Floods by subzone{planningAreaName ? ` – ${planningAreaName}` : ""}
                    </CardTitle>
                    <CardDescription>Scroll to see all subzones</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-56">
                <div className="h-56 overflow-y-auto pr-2">
                  <div style={{ height: Math.max(floodsBySubzoneInPA.length * 28, 224) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={floodsBySubzoneInPA} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                        <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={180} tickMargin={6} />
                        <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                          <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isSubzoneDetail && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-sm font-semibold text-muted-foreground">Top impacted subzones</CardTitle>
                    <CardDescription>By recorded flood events</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-56">
                {floodTopSubzones.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={floodTopSubzones} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                      <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={170} />
                      <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No subzone data available.</div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        /* ===== AMENITIES (mirrors floods) ===== */
        <>
          {/* Categories (scrollable) */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Amenities by category</CardTitle>
                  <CardDescription>Scroll to see all categories</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="h-56">
              <div className="h-56 overflow-y-auto pr-2">
                <div style={{ height: Math.max((amenCategoriesList?.length || 0) * 28, 224) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={amenCategoriesList} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                      <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={170} tickMargin={6} />
                      <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                        <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Types (scrollable) */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground">Top amenity types</CardTitle>
                  <CardDescription>Scroll to see all types</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="h-56">
              <div className="h-56 overflow-y-auto pr-2">
                <div style={{ height: Math.max((amenTypesList?.length || 0) * 28, 224) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={amenTypesList} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                      <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={180} tickMargin={6} />
                      <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                      <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                        <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Out / PA focus views for amenities */}
          {isOutView && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-muted-foreground">Amenities by planning area</CardTitle>
                    <CardDescription>Scroll to see all areas</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-56">
                <div className="h-56 overflow-y-auto pr-2">
                  <div style={{ height: Math.max(amenitiesByPAAll.length * 28, 224) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={amenitiesByPAAll} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                        <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={170} tickMargin={6} />
                        <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                          <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isPlanningAreaFocus && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-muted-foreground">
                      Amenities by subzone{planningAreaName ? ` – ${planningAreaName}` : ""}
                    </CardTitle>
                    <CardDescription>Scroll to see all subzones</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="h-56">
                <div className="h-56 overflow-y-auto pr-2">
                  <div style={{ height: Math.max(amenitiesBySubzoneInPA.length * 28, 224) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={amenitiesBySubzoneInPA} layout="vertical" margin={{ left: 8, right: 28, top: 8, bottom: 8 }} barCategoryGap={8}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                        <XAxis type="number" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} width={180} tickMargin={6} />
                        <Tooltip formatter={(v) => formatNumber(v)} contentStyle={chartTooltipStyle} labelStyle={chartLabelStyle} />
                        <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 4, 4]} barSize={18}>
                          <LabelList dataKey="count" position="right" formatter={(v) => formatNumber(v)} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Footer lists — mode aware, top 10, show PA under subzones and roads */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankedList
          title={
            isFloods
              ? (isPlanningAreaFocus || isSubzoneDetail ? "Subzones" : "Planning areas")
              : (isPlanningAreaFocus || isSubzoneDetail ? "Subzones (amenities)" : "Planning areas")
          }
          items={
            isFloods
              ? (isPlanningAreaFocus || isSubzoneDetail
                  ? subzoneFooterListFlood
                  : (planningList || []).slice(0, 10).map(({ label, count }) => ({ label, count })))
              : (isPlanningAreaFocus || isSubzoneDetail
                  ? subzoneFooterListAmen
                  : (planningList || []).slice(0, 10).map(({ label, count }) => ({ label, count })))
          }
          emptyLabel={
            isFloods
              ? (isPlanningAreaFocus || isSubzoneDetail
                  ? "No subzone-level data available."
                  : "No planning-area level data available.")
              : (isPlanningAreaFocus || isSubzoneDetail
                  ? "No subzone-level amenity data available."
                  : "No planning-area level amenity data available.")
          }
        />

        {isFloods ? (
          <RankedList
            title={
              isSubzoneDetail
                ? "Road segments (selected subzone)"
                : isPlanningAreaFocus
                ? "Road segments (selected planning area)"
                : "Road segments"
            }
            items={topRoadsFlood}
            emptyLabel={
              isSubzoneDetail
                ? "No road-level data for the selected subzone."
                : isPlanningAreaFocus
                ? "No road-level data for the selected planning area."
                : "No road-level data available."
            }
          />
        ) : (
          <RankedList
            title={
              isSubzoneDetail
                ? "Road segments (selected subzone)"
                : isPlanningAreaFocus
                ? "Road segments (selected planning area)"
                : "Road segments (amenities)"
            }
            items={topRoadsAmen}
            emptyLabel="No road-level amenity data available."
          />
        )}
      </div>
    </div>
  )
}
