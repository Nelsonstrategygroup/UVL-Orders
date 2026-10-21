import { redirect } from "next/navigation";

// Downloads is now Print and download (change request 10/21/26); old links still work.
export default function DownloadsPage() {
  redirect("/print");
}
