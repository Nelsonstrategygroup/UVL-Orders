import { Suspense } from "react";
import PalletLabelsScreen from "./PalletLabelsScreen";

export const metadata = { title: "Pallet labels · Umpqua Valley Lamb" };

export default function PalletLabelsPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <PalletLabelsScreen />
    </Suspense>
  );
}
