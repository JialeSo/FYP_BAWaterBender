import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, BarChart3, LineChart as LineChartIcon, Loader2 } from "lucide-react"
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
} from "recharts"

const formatNumber = (value) => value?.toLocaleString?.("en-SG", { maximumFractionDigits: 0 }) ?? "0"

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
            <li key={item.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-foreground">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <span className="line-clamp-1">{item.label}</span>
              </span>
              <span className="font-medium text-muted-foreground">{formatNumber(item.count)}</span>
            </li>
          ))}
        </ol>
      )}
    </CardContent>
  </Card>
)

const determineContextLabel = (selectedPlanningAreas) => {
  if (selectedPlanningAreas?.length > 1) {
    return `${selectedPlanningAreas.length} planning areas selected`
  }
  if (selectedPlanningAreas?.length === 1) {
    return selectedPlanningAreas[0]
  }
  return "All planning areas"
}

export default function RightPanel({
  feature,
  stats,
  loading,
  error,
  onClearSelection,
  selectedPlanningAreas = [],
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">Loading flood analytics…</span>
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

  const safeStats = stats ?? {
    totals: { events: 0, subzoneEvents: 0, planningAreas: 0, subzones: 0, roads: 0, topType: null },
    byPlanningArea: [],
    byType: [],
    yearSeries: [],
    topRoads: [],
    topSubzones: [],
    focusSubzoneName: null
  }

  const { totals, byPlanningArea, byType, yearSeries, topRoads, topSubzones } = safeStats

  const planningList = selectedPlanningAreas.length
    ? byPlanningArea.filter((item) => selectedPlanningAreas.includes(item.label))
    : byPlanningArea.slice(0, 5)

  const typeList = byType.slice(0, 5)

  const planningContext = determineContextLabel(selectedPlanningAreas)

  const subzoneName = feature?.properties?.SUBZONE_N ?? safeStats.focusSubzoneName ?? "No subzone selected"
  const planningAreaName = feature?.properties?.PLN_AREA_N ?? planningContext

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-sm text-muted-foreground">Selected Subzone</CardTitle>
              <div className="mt-1 text-xl font-semibold text-foreground">{subzoneName}</div>
              <CardDescription>{planningAreaName}</CardDescription>
            </div>
            {feature ? (
              <Button variant="outline" size="sm" onClick={() => onClearSelection?.()}>
                Clear selection
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Flood events in scope</span>
            <span className="font-medium text-foreground">{formatNumber(totals.subzoneEvents || totals.events)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Affected roads</span>
            <span className="font-medium text-foreground">{formatNumber(totals.roads)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Most common flood type</span>
            <span className="font-medium text-foreground capitalize">{totals.topType ?? "Unknown"}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard title="Flood events" value={formatNumber(totals.events)} subtitle={planningContext} />
        <MetricCard title="Impacted subzones" value={formatNumber(totals.subzones)} subtitle="Within the selected scope" />
        <MetricCard title="Impacted roads" value={formatNumber(totals.roads)} subtitle="Unique road segments" />
      </div>

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
          {yearSeries.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearSeries}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} />
                <XAxis dataKey="year" stroke="currentColor" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="currentColor" fontSize={12} tickLine={false} axisLine={false} width={40} />
                <Tooltip formatter={(value) => formatNumber(value)} cursor={{ stroke: "hsl(var(--primary))", strokeOpacity: 0.5 }} />
                <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No timeline data available.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-semibold text-muted-foreground">Top impacted subzones</CardTitle>
              <CardDescription>Measured by number of recorded flood events</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-56">
          {topSubzones.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topSubzones.map(({ name, count }) => ({ name, count }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} horizontal={false} />
                <XAxis type="number" stroke="currentColor" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" stroke="currentColor" fontSize={12} tickLine={false} axisLine={false} width={120} />
                <Tooltip formatter={(value) => formatNumber(value)} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 4, 4]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No subzone data available.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankedList
          title="Planning areas"
          items={planningList.map((entry) => ({ label: entry.label, count: entry.count }))}
          emptyLabel="No planning-area level data available."
        />
        <RankedList
          title="Road segments"
          items={topRoads.map((entry) => ({ label: entry.name, count: entry.count }))}
          emptyLabel="No road-level data available."
        />
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Flood types</CardTitle>
          <CardDescription>Most common events within the current selection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!typeList.length ? (
            <p className="text-sm text-muted-foreground">No flood-type distribution available.</p>
          ) : (
            typeList.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between text-sm">
                <span className="capitalize text-foreground">{entry.label}</span>
                <span className="font-medium text-muted-foreground">{formatNumber(entry.count)}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

