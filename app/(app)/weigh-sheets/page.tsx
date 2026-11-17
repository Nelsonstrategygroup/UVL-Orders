import { redirect } from "next/navigation";

// Weigh sheets are Carcass weights now (Lucas, 11/17/26); old links still work.
export default function OldWeighSheets() {
  redirect("/carcass-weights");
}
