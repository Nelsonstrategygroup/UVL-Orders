import { Suspense } from "react";
import PrintAllScreen from "./PrintAllScreen";

export const metadata = { title: "Invoices to print · Umpqua Valley Lamb" };

export default function PrintAllPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <PrintAllScreen />
    </Suspense>
  );
}
