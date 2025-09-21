import { useState, useCallback } from "react"
import LeftPanel from "./LeftPanel"
import RightPanel from "./RightPanel"

// dashboardlayout doesn't import the map directly.
// pages/historicalmap.jsx passes the map component via the "mapcomponent" prop.
export default function DashboardLayout({ mapcomponent: MapComponent }) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [resizeSignal, setResizeSignal] = useState(0)
  const [selectedProps, setSelectedProps] = useState(null)

  const handleTransitionEnd = useCallback(() => {
    // ping the map to call map.resize()
    setResizeSignal((n) => n + 1)
  }, [])

  return (
    <div className="dashboard-root">
      {/* toggles */}
      <div className="dash-controls">
        <button className="dash-btn" onClick={() => setLeftOpen((v) => !v)}>
          {leftOpen ? "hide filters" : "show filters"}
        </button>
        <button className="dash-btn" onClick={() => setRightOpen((v) => !v)}>
          {rightOpen ? "hide info" : "show info"}
        </button>
      </div>

      <div className="dash-row">
        {/* left 25% */}
        <div
          className={`dash-left ${leftOpen ? "open" : "closed"}`}
          onTransitionEnd={handleTransitionEnd}
        >
          <LeftPanel />
        </div>

        {/* center auto */}
        <div
          className="dash-center"
          onTransitionEnd={handleTransitionEnd}
        >
          <MapComponent
            resizeSignal={resizeSignal}
            onAreaClick={setSelectedProps}
          />
        </div>

        {/* right 25% */}
        <div
          className={`dash-right ${rightOpen ? "open" : "closed"}`}
          onTransitionEnd={handleTransitionEnd}
        >
          <RightPanel data={selectedProps} />
        </div>
      </div>
    </div>
  )
}
