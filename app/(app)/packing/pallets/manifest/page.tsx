import { Suspense } from "react";
import ManifestScreen from "./ManifestScreen";

export const metadata = { title: "Pallet manifest · Umpqua Valley Lamb" };

export default function ManifestPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <ManifestScreen />
    </Suspense>
  );
}
