import { useCallback, useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import LeftPanel from "./LeftPanel"
import RightPanel from "./RightPanel"
import { PanelLeft, PanelRight } from "lucide-react"

function parseCsv(text) {
  const rows = []
  let field = ""
  let row = []
  let inQuotes = false

  const pushField = () => {
    row.push(field)
    field = ""
  }

  const pushRow = () => {
    if (row.length > 0 || field.length > 0) {
      rows.push(row)
    }
    row = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === "\"") {
        const peek = text[i + 1]
        if (peek === "\"") {
          field += "\""
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === "\"") {
      inQuotes = true
      continue
    }

    if (char === ",") {
      pushField()
      continue
    }

    if (char === "\r") {
      continue
    }

    if (char === "\n") {
      pushField()
      pushRow()
      continue
    }

    field += char
  }

  pushField()
  pushRow()

  return rows.filter((line) => line.length > 1 || (line.length === 1 && line[0].trim().length > 0))
}

const normaliseFloodRecord = (record) => {
  const planningArea = (record.start_planning_area || record.end_planning_area || "").trim()
  const subzone = (record.start_subzone || record.end_subzone || "").trim()
  const road = (record.start_street_name || record.end_street_name || record.parent_road || "").trim()
  const floodType = (record.event || "unknown").trim().toLowerCase() || "unknown"
  const eventDate = record.event_date ? new Date(record.event_date) : null
  const year = eventDate && Number.isFinite(eventDate.getFullYear()) ? eventDate.getFullYear() : null

  return {
    ...record,
    planningArea,
    subzone,
    road,
    floodType,
    eventDate,
    year,
  }
}

const aggregateCounts = (events, key) => {
  const tally = new Map()
  events.forEach((event) => {
    let raw = event[key]
    // convert to string only if it exists
    const label = raw != null ? String(raw).trim() : "Unknown"
    tally.set(label, (tally.get(label) || 0) + 1)
  })
  return Array.from(tally.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

export default function DashboardLayout({ mapcomponent: MapComponent }) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [resizeSignal, setResizeSignal] = useState(0)
  const [planningAreas, setPlanningAreas] = useState([])
  const [selectedPlanningAreas, setSelectedPlanningAreas] = useState([])
  const [selectedSubzone, setSelectedSubzone] = useState(null)
  const [floodRows, setFloodRows] = useState([])
  const [floodLoading, setFloodLoading] = useState(false)
  const [floodError, setFloodError] = useState(null)

  const sortedOptions = useMemo(() => [...new Set(planningAreas)].sort((a, b) => a.localeCompare(b)), [planningAreas])

  useEffect(() => {
    let cancelled = false

    const loadFloodData = async () => {
      try {
        setFloodLoading(true)
        setFloodError(null)
        const response = await fetch("/map/floodsv2.csv")
        if (!response.ok) {
          throw new Error(`Failed to fetch floodsv2.csv (status ${response.status})`)
        }
        const text = await response.text()
        const rows = parseCsv(text.trim())
        if (!rows.length) {
          if (!cancelled) setFloodRows([])
          return
        }
        const [headers, ...dataRows] = rows
        const normalisedHeaders = headers.map((header) => header.trim())
        const records = dataRows.map((columns) => {
          const record = {}
          normalisedHeaders.forEach((header, index) => {
            record[header] = (columns[index] ?? "").trim()
          })
          return record
        })
        if (!cancelled) {
          setFloodRows(records)
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setFloodError(err instanceof Error ? err.message : "Unable to load flood data.")
          setFloodRows([])
        }
      } finally {
        if (!cancelled) {
          setFloodLoading(false)
        }
      }
    }

    loadFloodData()

    return () => {
      cancelled = true
    }
  }, [])

  const floodEvents = useMemo(() => floodRows.map(normaliseFloodRecord), [floodRows])

  const filteredFloodEvents = useMemo(() => {
    if (!selectedPlanningAreas.length) {
      return floodEvents
    }
    const planningSet = new Set(selectedPlanningAreas)
    return floodEvents.filter((event) => planningSet.has(event.planningArea))
  }, [floodEvents, selectedPlanningAreas])

  const floodInsights = useMemo(() => {
    if (!floodEvents.length) {
      return {
        totals: {
          events: 0,
          subzoneEvents: 0,
          planningAreas: 0,
          subzones: 0,
          roads: 0,
          topType: null,
        },
        byPlanningArea: [],
        bySubzone: [],
        byRoad: [],
        byType: [],
        yearSeries: [],
        topRoads: [],
        topSubzones: [],
      }
    }

    const filtered = filteredFloodEvents
    const focusSubzoneName = selectedSubzone?.properties?.SUBZONE_N?.trim() || null
    const subzoneScopedEvents = focusSubzoneName
      ? filtered.filter((event) => event.subzone === focusSubzoneName)
      : filtered

    const byPlanningArea = aggregateCounts(filtered, "planningArea")
    const bySubzone = aggregateCounts(filtered, "subzone")
    const byRoad = aggregateCounts(filtered, "road")
    const byType = aggregateCounts(filtered, "floodType")
    const yearSeries = aggregateCounts(filtered.filter((event) => Number.isInteger(event.year)), "year")
      .map(({ label, count }) => ({ year: Number(label), count }))
      .sort((a, b) => a.year - b.year)

    const topRoads = byRoad
      .filter((entry) => entry.label !== "Unknown")
      .slice(0, 5)
      .map(({ label, count }) => ({ name: label, count }))

    const subzoneSource = focusSubzoneName ? subzoneScopedEvents : filtered
    const topSubzones = aggregateCounts(subzoneSource, "subzone")
      .filter((entry) => entry.label !== "Unknown")
      .slice(0, 5)
      .map(({ label, count }) => ({ name: label, count }))

    const totals = {
      events: filtered.length,
      subzoneEvents: subzoneScopedEvents.length,
      planningAreas: new Set(filtered.map((event) => event.planningArea).filter(Boolean)).size,
      subzones: new Set(filtered.map((event) => event.subzone).filter(Boolean)).size,
      roads: new Set(filtered.map((event) => event.road).filter(Boolean)).size,
      topType: byType[0]?.label ?? null,
    }

    return {
      totals,
      byPlanningArea,
      bySubzone,
      byRoad,
      byType,
      yearSeries,
      topRoads,
      topSubzones,
      focusSubzoneName,
    }
  }, [filteredFloodEvents, floodEvents, selectedSubzone])

  const triggerResize = useCallback(() => {
    setResizeSignal((value) => value + 1)
  }, [])

  const handleToggleLeft = useCallback(() => {
    setLeftOpen((open) => !open)
    triggerResize()
  }, [triggerResize])

  const handleToggleRight = useCallback(() => {
    setRightOpen((open) => !open)
    triggerResize()
  }, [triggerResize])

  const handlePlanningAreaSelection = useCallback((areas) => {
    setSelectedPlanningAreas(areas)
  }, [])

  const handleResetPlanningAreas = useCallback(() => {
    setSelectedPlanningAreas([])
  }, [])

  const handlePlanningAreaFromMap = useCallback((areaName) => {
    if (!areaName) return
    setSelectedPlanningAreas((prev) => {
      if (prev.length === 1 && prev[0] === areaName) {
        return []
      }
      return [areaName]
    })
  }, [])

  const handleSubzoneSelect = useCallback(
    (feature) => {
      setSelectedSubzone(feature)
      if (feature && !rightOpen) {
        setRightOpen(true)
        triggerResize()
      }
    },
    [rightOpen, triggerResize],
  )

  const clearSubzoneSelection = useCallback(() => {
    setSelectedSubzone(null)
  }, [])

  useEffect(() => {
    if (!selectedPlanningAreas.length) {
      setSelectedSubzone(null)
      return
    }

    if (selectedSubzone?.properties?.PLN_AREA_N && !selectedPlanningAreas.includes(selectedSubzone.properties.PLN_AREA_N)) {
      setSelectedSubzone(null)
    }
  }, [selectedPlanningAreas, selectedSubzone])

  return (
    <div className="flex min-h-screen flex-col gap-6 px-4 py-6 md:px-6 lg:px-10">
      <div className="flex flex-1 flex-col gap-6 md:flex-row">
        <aside
          className={cn(
            "transition-all duration-300 ease-in-out md:flex md:flex-col",
            leftOpen ? "md:basis-1/4 md:max-w-[25%]" : "md:basis-0 md:max-w-0",
          )}
          aria-hidden={!leftOpen}
        >
          <div
            className={cn(
              "flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-opacity duration-300",
              leftOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <LeftPanel
              options={sortedOptions}
              selected={selectedPlanningAreas}
              onSelectionChange={handlePlanningAreaSelection}
              onResetSelection={handleResetPlanningAreas}
            />
          </div>
        </aside>

        <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
              onClick={handleToggleLeft}
            >
              <PanelLeft className="h-4 w-4" />
              <span>{leftOpen ? "Hide filters" : "Show filters"}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
              onClick={handleToggleRight}
            >
              <PanelRight className="h-4 w-4" />
              <span>{rightOpen ? "Hide info" : "Show info"}</span>
            </Button>
          </div>

          {MapComponent && (
            <MapComponent
              resizeSignal={resizeSignal}
              selectedPlanningAreas={selectedPlanningAreas}
              selectedSubzone={selectedSubzone}
              onPlanningAreaToggle={handlePlanningAreaFromMap}
              onPlanningAreasLoaded={setPlanningAreas}
              onSubzoneSelect={handleSubzoneSelect}
            />
          )}
        </div>

        <aside
          className={cn(
            "transition-all duration-300 ease-in-out md:flex md:flex-col",
            rightOpen ? "md:basis-1/4 md:max-w-[25%]" : "md:basis-0 md:max-w-0",
          )}
          aria-hidden={!rightOpen}
        >
          <div
            className={cn(
              "flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-opacity duration-300",
              rightOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <RightPanel
              feature={selectedSubzone}
              onClearSelection={clearSubzoneSelection}
              stats={floodInsights}
              loading={floodLoading}
              error={floodError}
              selectedPlanningAreas={selectedPlanningAreas}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

