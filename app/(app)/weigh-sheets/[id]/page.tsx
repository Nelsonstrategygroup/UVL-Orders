import { redirect } from "next/navigation";

// Weigh sheets are Carcass weights now (Lucas, 11/17/26); old links still work.
export default async function OldWeighSheet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/carcass-weights/${id}`);
}
