import { useState } from "react"
export default function DashboardMap() {
  const [selectedFeature, setSelectedFeature] = useState(null)

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Dashboard Map</h1>
    </div>
  )
}
