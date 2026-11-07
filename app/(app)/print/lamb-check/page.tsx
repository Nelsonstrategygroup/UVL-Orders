import LambCheckScreen from "./LambCheckScreen";

export const metadata = { title: "Lamb count check · Umpqua Valley Lamb" };

export default async function LambCheckPage({ searchParams }: { searchParams: Promise<{ print?: string }> }) {
  const q = await searchParams;
  return <LambCheckScreen print={q.print === "1"} />;
}
