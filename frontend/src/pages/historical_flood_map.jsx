import DashboardLayout from "../components/pagecomponents/historicalMap/DashboardLayout";
import SingaporeHistoricalFloodMap from "../components/pagecomponents/historicalMap/SingaporeHistoricalFloodMap";

export default function HistoricalFloodMapPage() {
  return (
    <div className="h-screen overflow-hidden">
      <DashboardLayout mapcomponent={SingaporeHistoricalFloodMap} />
    </div>
  );
}
