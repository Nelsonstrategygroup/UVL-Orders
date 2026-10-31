// The one header every printout uses (Lucas, 10/31/26): "INV# 3001" large and
// bold at the top left, the first thing the eye lands on, then the report's
// name and its week. A week with no invoice number prints "INV# ______" to
// write in. It also puts "INV# 3001, page 2 of 3" at the foot of every printed
// page, so a loose page still shows its week. New printouts use this too.

import { invLabel } from "@/lib/weekInv";

/** A CSS string: "INV# 3001, page ". */
const cssString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** "INV# 3001, page X of Y" at the bottom of every printed page (browsers that draw page margins: Chrome, Edge). */
export function PageFooter({ label }: { label: string }) {
  return (
    <style>{`@media print { @page { @bottom-center { content: ${cssString(`${label}, page `)} counter(page) " of " counter(pages); font: 600 9pt Arial, Helvetica, sans-serif; color: #000; } } }`}</style>
  );
}

export default function PrintHeader({
  inv,
  label,
  title,
  when,
  footer = true,
  className = "",
}: {
  /** The week's invoice number ("3001"), or null for a blank to write in. */
  inv?: string | number | null;
  /** Instead of inv: the label as worked out ("INV# 2998 to 3002" for a date range; "" for a page not about any week). */
  label?: string;
  /** The report's name. */
  title: React.ReactNode;
  /** The week ("Packing Mon Nov 2") or what it covers. */
  when?: React.ReactNode;
  /** The page footer (once per printout; a page with several headers sets it on one). */
  footer?: boolean;
  className?: string;
}) {
  const text = label ?? invLabel(inv);
  return (
    <header className={`ph ${className}`}>
      {text && <div className="ph-inv">{text}</div>}
      <div className="ph-what">
        <div className="ph-title">{title}</div>
        {when && <div className="ph-when">{when}</div>}
      </div>
      {footer && text && <PageFooter label={text} />}
    </header>
  );
}
