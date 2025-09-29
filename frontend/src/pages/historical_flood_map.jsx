import DashboardLayout from "../components/pagecomponents/historicalMap/DashboardLayout";
import SingaporeHistoricalFloodMap from "../components/pagecomponents/historicalMap/SingaporeHistoricalFloodMap";

export default function HistoricalFloodMapPage() {
  return <DashboardLayout mapcomponent={SingaporeHistoricalFloodMap} />;
}
