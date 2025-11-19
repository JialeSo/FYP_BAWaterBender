import { useEffect, useRef } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

export default function Mapbox({ onSelectFeature }) {
  const mapContainer = useRef(null)
  const map = useRef(null)

  useEffect(() => {
    if (map.current) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [103.8198, 1.3521], // Singapore
      zoom: 11,
    })

    map.current.on("load", () => {
      fetch("/map/road_network.geojson")
        .then((res) => res.json())
        .then((data) => {
          map.current.addSource("road-network", {
            type: "geojson",
            data: data,
          })

          map.current.addLayer({
            id: "road-network-layer",
            type: "line",
            source: "road-network",
            paint: {
              "line-color": "#ff5500",
              "line-width": 2,
            },
          })

          map.current.on("click", "road-network-layer", (e) => {
            const coordinates = e.lngLat
            const feature = e.features?.[0]
            const props = feature?.properties || {}

            const content = Object.keys(props).length
              ? `<div style="font-size:14px;">
                   <strong>Road Segment</strong><br/>
                   ${Object.entries(props)
                     .map(([k, v]) => `<strong>${k}</strong>: ${v}`)
                     .join("<br/>")}
                 </div>`
              : `<div style="font-size:14px;">
                   <strong>Road Segment</strong><br/>
                   No additional properties available.
                 </div>`

            new mapboxgl.Popup()
              .setLngLat(coordinates)
              .setHTML(content)
              .addTo(map.current)

            // Send clicked feature back to parent
            if (onSelectFeature && typeof onSelectFeature === "function") {
              onSelectFeature({
                coordinates,
                properties: props,
                geometry: feature?.geometry,
              })
            }
          })

          map.current.on("mouseenter", "road-network-layer", () => {
            map.current.getCanvas().style.cursor = "pointer"
          })

          map.current.on("mouseleave", "road-network-layer", () => {
            map.current.getCanvas().style.cursor = ""
          })
        })
        .catch((err) => {
          console.error("Error loading road network GeoJSON:", err)
        })
    })

    return () => map.current?.remove()
  }, [])

  return (
    <div className="w-full h-[500px] rounded-md overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />
    </div>
  )
}
