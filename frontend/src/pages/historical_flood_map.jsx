import DashboardLayout from "../components/pagecomponents/historicalMap/dashboardLayout";
import SingaporeHistoricalFloodMap from "../components/pagecomponents/historicalMap/singaporeHistoricalFloodMap";

export default function HistoricalFloodMapPage() {
  return (
    <div className="h-screen overflow-hidden">
      <DashboardLayout mapcomponent={SingaporeHistoricalFloodMap} />
    </div>
  );
}
