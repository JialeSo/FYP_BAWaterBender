// src/router.jsx
import { Routes, Route, Navigate } from "react-router-dom"

import Home from "./pages/home"
import DashboardMap from "./pages/dashboard_map"
import FloodEvents from "./pages/floodevents"
import SingaporeHistoricalFloodMap from "./pages/historicalFloodMap"
import RoadCentrality from "./pages/roadcentrality"
import Simulation from "./pages/simulation"

export default function AppRouter() {
  return (
    <Routes>
      {/* redirect root to /home */}
      <Route path="/" element={<Navigate to="/home" replace />} />

      {/* pages */}
      <Route path="/home" element={<Home />} />
      <Route path="/dashboard-map" element={<DashboardMap />} />
      <Route path="/flood-events" element={<FloodEvents />} />
      <Route path="/historical-flood-map" element={<SingaporeHistoricalFloodMap />} />
      <Route path="/road-centrality" element={<RoadCentrality />} />
      <Route path="/simulation" element={<Simulation />} />
      
      {/* 404 fallback */}
      <Route path="*" element={<div className="p-6">404 not found</div>} />
    </Routes>
  )
}
