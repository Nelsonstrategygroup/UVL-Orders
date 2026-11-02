import { Suspense } from "react";
import CrossDockScreen from "./CrossDockScreen";

export const metadata = { title: "Cross dock sheets · Umpqua Valley Lamb" };

export default function CrossDockPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <CrossDockScreen />
    </Suspense>
  );
}
