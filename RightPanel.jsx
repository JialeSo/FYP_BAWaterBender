import { Button } from "@/components/ui/button"

const HIDDEN_KEYS = new Set(["PLN_AREA_N", "SUBZONE_N"])

const formatEntries = (properties) => {
  if (!properties) return []
  return Object.entries(properties)
    .filter(([key]) => !HIDDEN_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      label: key
        .split("_")
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join(" "),
      value: Array.isArray(value) ? value.join(", ") : value ?? "-",
    }))
}

export default function RightPanel({ feature, onClearSelection }) {
  const properties = feature?.properties ?? null
  const entries = formatEntries(properties)
  const subzoneName = properties?.SUBZONE_N ?? "No subzone selected"
  const areaName = properties?.PLN_AREA_N ?? "-"

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Information</h2>
        <p className="text-sm text-muted-foreground">Details for the currently selected subzone.</p>
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Subzone</p>
        <p className="text-xl font-semibold text-foreground">{subzoneName}</p>
        <p className="text-xs text-muted-foreground">Planning area: {areaName}</p>
      </div>

      {!properties ? (
        <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          Select a subzone on the map to view its properties.
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <dl className="space-y-3 text-sm">
              {entries.map((entry) => (
                <div key={entry.key} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-b-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{entry.label}</dt>
                  <dd className="text-right text-sm text-foreground">{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 self-start"
            onClick={() => onClearSelection?.()}
          >
            Clear selection
          </Button>
        </>
      )}

      <div className="mt-auto rounded-lg border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
        Add flood metrics or charts here to highlight historical events for the selected area.
      </div>
    </div>
  )
}
