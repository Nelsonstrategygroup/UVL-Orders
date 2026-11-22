import CountRecord from "./CountRecord";

export const metadata = { title: "Freezer count · Umpqua Valley Lamb" };

export default async function FreezerCountRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountRecord id={id} />;
}
