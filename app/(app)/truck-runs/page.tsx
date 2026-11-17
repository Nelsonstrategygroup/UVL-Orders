import { Suspense } from "react";
import TruckRunsScreen from "./TruckRunsScreen";

export const metadata = { title: "Truck runs · Umpqua Valley Lamb" };

// Truck runs (Lucas, 11/16/26): whoever can see Truck runs (the page guard
// checks the area; the database checks it again).
export default function TruckRunsPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <TruckRunsScreen />
    </Suspense>
  );
}
