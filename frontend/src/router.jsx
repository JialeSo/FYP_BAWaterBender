// src/router.jsx
import { Routes, Route, Navigate } from "react-router-dom"

import Home from "./pages/home"
import FloodEvents from "./pages/floodevents"
import SingaporeHistoricalFloodMap from "./pages/historicalFloodMap"
import RoadCentrality from "./pages/roadcentrality"
import Simulation from "./pages/simulation"
import UploadData from "./pages/uploadpage"

export default function AppRouter() {
  return (
    <Routes>
      {/* redirect root to /home */}
      <Route path="/" element={<Navigate to="/home" replace />} />

      {/* pages */}
      <Route path="/home" element={<Home />} />
      <Route path="/floodEvents" element={<FloodEvents />} />
      <Route path="/historicalFloodMap" element={<SingaporeHistoricalFloodMap />} />
      <Route path="/roadCentrality" element={<RoadCentrality />} />
      <Route path="/simulation" element={<Simulation />} />
      <Route path="/uploadData" element={<UploadData />} />
      {/* 404 fallback */}
      <Route path="*" element={<div className="p-6">404 not found</div>} />
    </Routes>
  )
}
