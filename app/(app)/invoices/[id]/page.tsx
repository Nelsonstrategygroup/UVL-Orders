import { notFound } from "next/navigation";
import InvoiceScreen from "./InvoiceScreen";

export const metadata = { title: "Invoice · Umpqua Valley Lamb" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  return <InvoiceScreen id={id} />;
}
