// src/router.jsx
import { Routes, Route, Navigate } from "react-router-dom"

import Home from "./pages/home"
import Dashboard from "./pages/dashboard"

export default function AppRouter() {
  return (
    <Routes>
      {/* redirect root to /home */}
      <Route path="/" element={<Navigate to="/home" replace />} />

      {/* pages */}
      <Route path="/home" element={<Home />} />
      <Route path="/dashboard" element={<Dashboard />} />

      {/* 404 fallback */}
      <Route path="*" element={<div className="p-6">404 not found</div>} />
    </Routes>
  )
}
