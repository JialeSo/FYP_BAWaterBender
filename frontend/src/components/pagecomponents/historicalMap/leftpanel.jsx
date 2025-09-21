export default function LeftPanel() {
  return (
    <div className="panel panel-left">
      <h2 className="panel-title">filters</h2>

      <div className="panel-group">
        <label className="panel-label">planning area</label>
        <select className="panel-input">
          <option value="all">all</option>
          {/* populate dynamically later */}
        </select>
      </div>

      <div className="panel-group">
        <label className="panel-label">year</label>
        <input type="range" min="2000" max="2025" defaultValue="2015" className="panel-range" />
        <div className="panel-hint">drag to filter by year (stub)</div>
      </div>

      <div className="panel-spacer" />
      <div className="panel-foot">tip: click a polygon on the map to see details on the right.</div>
    </div>
  )
}
