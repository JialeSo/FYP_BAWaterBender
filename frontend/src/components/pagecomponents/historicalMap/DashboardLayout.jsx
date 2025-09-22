import { useCallback, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import LeftPanel from "./LeftPanel"
import RightPanel from "./RightPanel"
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"

const INITIAL_FILTERS = {
  planningArea: "all",
  searchTerm: "",
}

export default function DashboardLayout({ mapcomponent: MapComponent }) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [resizeSignal, setResizeSignal] = useState(0)
  const [filters, setFilters] = useState(() => ({ ...INITIAL_FILTERS }))
  const [planningAreas, setPlanningAreas] = useState([])
  const [selectedFeature, setSelectedFeature] = useState(null)

  const planningAreaOptions = useMemo(() => {
    if (!planningAreas.length) return []
    return [...new Set(planningAreas)].sort((a, b) => a.localeCompare(b))
  }, [planningAreas])

  const triggerResize = useCallback(() => {
    setResizeSignal((value) => value + 1)
  }, [])

  const toggleLeft = useCallback(() => {
    setLeftOpen((open) => !open)
    triggerResize()
  }, [triggerResize])

  const toggleRight = useCallback(() => {
    setRightOpen((open) => !open)
    triggerResize()
  }, [triggerResize])

  const handleFiltersChange = useCallback((partial) => {
    setFilters((prev) => ({
      planningArea: partial.planningArea ?? prev.planningArea ?? "all",
      searchTerm: partial.searchTerm ?? prev.searchTerm ?? "",
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters({ ...INITIAL_FILTERS })
  }, [])

  const handleFeatureSelect = useCallback(
    (feature) => {
      setSelectedFeature(feature)
      if (feature && !rightOpen) {
        setRightOpen(true)
        triggerResize()
      }
    },
    [rightOpen, triggerResize],
  )

  const clearSelection = useCallback(() => {
    setSelectedFeature(null)
  }, [])

  return (
    <div className="flex min-h-screen flex-col gap-6 px-4 py-6 md:px-6 lg:px-10">
      <div className="flex flex-1 flex-col gap-6 md:flex-row">
        <aside
          className={cn(
            "transition-all duration-300 ease-in-out md:flex md:flex-col",
            leftOpen ? "md:basis-1/4 md:max-w-[25%]" : "md:basis-0 md:max-w-0",
            leftOpen ? "opacity-100" : "opacity-0 md:pointer-events-none",
          )}
        >
          {leftOpen && (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <LeftPanel
                options={planningAreaOptions}
                filters={filters}
                onFiltersChange={handleFiltersChange}
                onResetFilters={resetFilters}
              />
            </div>
          )}
        </aside>

        <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="pointer-events-none absolute left-4 top-4 z-10 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto"
              onClick={toggleLeft}
              title={leftOpen ? "Hide filters" : "Show filters"}
            >
              {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
              <span className="sr-only">Toggle filters panel</span>
            </Button>
          </div>

          <div className="pointer-events-none absolute right-4 top-4 z-10 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="pointer-events-auto"
              onClick={toggleRight}
              title={rightOpen ? "Hide info" : "Show info"}
            >
              {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              <span className="sr-only">Toggle info panel</span>
            </Button>
          </div>

          {MapComponent && (
            <MapComponent
              resizeSignal={resizeSignal}
              filters={filters}
              selectedFeature={selectedFeature}
              onFeatureSelect={handleFeatureSelect}
              onPlanningAreasLoaded={setPlanningAreas}
            />
          )}
        </div>

        <aside
          className={cn(
            "transition-all duration-300 ease-in-out md:flex md:flex-col",
            rightOpen ? "md:basis-1/4 md:max-w-[25%]" : "md:basis-0 md:max-w-0",
            rightOpen ? "opacity-100" : "opacity-0 md:pointer-events-none",
          )}
        >
          {rightOpen && (
            <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <RightPanel data={selectedFeature?.properties ?? null} onClearSelection={clearSelection} />
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
