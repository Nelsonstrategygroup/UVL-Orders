import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current-user";
import SetupScreen from "../SetupScreen";
import { isSetupSlug, SETUP_SECTIONS } from "../sections";

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = SETUP_SECTIONS.find((x) => x.slug === section);
  return { title: `${s ? s.title : "Setup"} · Setup · Umpqua Valley Lamb` };
}

export default async function SetupSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isSetupSlug(section)) notFound();
  const user = await requireUser();
  return <SetupScreen canEdit={user.role === "admin"} section={section} />;
}
