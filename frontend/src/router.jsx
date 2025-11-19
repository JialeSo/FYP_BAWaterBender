// src/router.jsx
import { Routes, Route, Navigate } from "react-router-dom"

import Home from "./pages/home"
import DashboardMap from "./pages/dashboard_map"
import FloodEvents from "./pages/floodevents"
import SingaporeHistoricalFloodMap from "./pages/historicalFloodMap"
import RoadCentrality from "./pages/roadcentrality"
import Simulation from "./pages/simulation"
import UploadData from "./pages/uploadPage"

export default function AppRouter() {
  return (
    <Routes>
      {/* redirect root to /home */}
      <Route path="/" element={<Navigate to="/home" replace />} />

      {/* pages */}
      <Route path="/home" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/historical-flood-map" element={<SingaporeHistoricalFloodMap />} />
      <Route path="/road-centrality" element={<RoadCentrality />} />
      <Route path="/simulation" element={<Simulation />} />
      <Route path="/uploaddata" element={<UploadData />} />
      {/* 404 fallback */}
      <Route path="*" element={<div className="p-6">404 not found</div>} />
    </Routes>
  )
}
