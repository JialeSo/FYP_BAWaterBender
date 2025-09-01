export default function SelectedRoad({ data }) {
  if (!data) {
    return <div className="italic text-muted">Click a road on the map to see details.</div>
  }

  return (
    <div className="p-4 border rounded bg-white shadow w-full md:max-w-md">
      <h2 className="font-semibold mb-3 text-lg">Selected Road Segment</h2>
      <ul className="text-sm space-y-1">
        {Object.entries(data.properties).map(([key, value]) => (
          <li key={key}>
            <strong>{key}:</strong> {value}
          </li>
        ))}
      </ul>
    </div>
  )
}
