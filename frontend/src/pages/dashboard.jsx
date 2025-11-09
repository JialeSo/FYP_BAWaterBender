import { useState } from "react"
import Mapbox from "../components/pagecomponents/dashboard/mapbox"
import SelectedRoad from "../components/pagecomponents/dashboard/selected"

export default function Dashboard() {
  const [selectedFeature, setSelectedFeature] = useState(null)

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Dashboard Page</h1>

      {/* 📍 Map component with selection handler */}
      <Mapbox onSelectFeature={setSelectedFeature} />

      {/* 📋 Display selected road info */}
      <SelectedRoad data={selectedFeature} />
    </div>
  )
}
