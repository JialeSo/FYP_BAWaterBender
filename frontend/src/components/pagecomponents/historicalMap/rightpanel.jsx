export default function RightPanel({ data }) {
  return (
    <div className="panel panel-right">
      <div className="panel-head">
        <h2 className="panel-title">information</h2>
        <p className="panel-sub">details of the selected planning area will appear here.</p>
      </div>

      <div className="panel-body">
        {!data ? (
          <div className="panel-empty">no feature selected yet.</div>
        ) : (
          <div className="props-grid">
            <div className="prop-row">
              <span className="prop-key">name</span>
              <span className="prop-val">{data.PLN_AREA_N || "(unknown)"}</span>
            </div>

            {Object.entries(data).map(([k, v]) => (
              <div key={k} className="prop-row">
                <span className="prop-key">{k}</span>
                <span className="prop-val">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel-showcase">
        <div className="panel-title-sm">showcase</div>
        <div className="panel-sub">use this space for metrics or mini-charts.</div>
      </div>
    </div>
  )
}
