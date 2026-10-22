import { notFound } from "next/navigation";
import { isReportKind, REPORTS } from "../../reports";
import ReportScreen from "./ReportScreen";

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return { title: `${isReportKind(kind) ? REPORTS[kind].title : "Report"} · Umpqua Valley Lamb` };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<{ customer?: string; from?: string; to?: string }>;
}) {
  const { kind } = await params;
  if (!isReportKind(kind)) notFound();
  const q = await searchParams;
  return <ReportScreen kind={kind} customer={q.customer ?? ""} from={q.from ?? ""} to={q.to ?? ""} />;
}
