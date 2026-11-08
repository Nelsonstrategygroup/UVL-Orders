"use client";

// This week: where extras go to "Only if extra" lines (11/8/26), next to
// Freezer and Grind. Each line with what it will get, and "Extras to share"
// when lines compete for the same part: Kathy splits what's there. Until she
// does, they fill in the shared customer order ("Kathy to decide").

import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { compareCustomerIds, displayName } from "@/lib/calc/customers";
import { amountText, type ExtraLine, type ExtrasResult } from "@/lib/calc/extras";
import { saveExtraChoices } from "@/lib/db/save";

export default function ExtrasPanel({
  week,
  lines,
  result,
  everyoneAnswered,
  onSaved,
}: {
  week: string;
  lines: ExtraLine[];
  result: ExtrasResult;
  everyoneAnswered: boolean;
  onSaved: () => void;
}) {
  const { catalog, customers } = useStaffData();
  const ordersCan = useCan("orders").change;
  const weekCan = useCan("week").change;
  const canSplit = ordersCan || weekCan;
  if (!catalog || !customers) return null;
  const name = (id: string) => {
    const c = customers.byId.get(id);
    return c ? displayName(c, customers.byId) : "Unknown customer";
  };
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const sorted = [...lines].sort((a, b) => compareCustomerIds(customers.byId)(a.customerId, b.customerId) || a.productId.localeCompare(b.productId));
  const open = result.contests.filter((c) => !c.decided);

  return (
    <div className="note mt-3">
      <b>Only if extra:</b> these lines get what&apos;s left after every other order and Le Trim.
      <ul className="m-0 mt-1 grid list-none gap-1 p-0">
        {sorted.map((l) => {
          const f = result.fills.get(l.key);
          const p = catalog.productById.get(l.productId);
          const got = f?.fill ?? 0;
          return (
            <li key={l.key}>
              {name(l.customerId)}: {got >= l.asked ? amountText(got, p) : `wants ${amountText(l.asked, p)}, ${got} available`}
              {f?.toDecide && <span className="tag extra ml-1">Kathy to decide</span>}
              {f?.estimated && <span className="tag ml-1">estimated</span>}
              {f?.locked && <span className="tag ml-1">packing started</span>}
            </li>
          );
        })}
      </ul>
      {result.contests.map((c) => (
        <Share
          key={c.partId}
          week={week}
          contest={c}
          lines={c.keys.map((k) => byKey.get(k)!).filter(Boolean)}
          result={result}
          name={name}
          canSplit={canSplit}
          highlight={!c.decided && everyoneAnswered}
          onSaved={onSaved}
        />
      ))}
      {open.length > 0 && !everyoneAnswered && (
        <p className="small muted mt-1 mb-0">Split them once everyone has answered for the week.</p>
      )}
    </div>
  );
}

function Share({
  week,
  contest,
  lines,
  result,
  name,
  canSplit,
  highlight,
  onSaved,
}: {
  week: string;
  contest: ExtrasResult["contests"][number];
  lines: ExtraLine[];
  result: ExtrasResult;
  name: (id: string) => string;
  canSplit: boolean;
  highlight: boolean;
  onSaved: () => void;
}) {
  const { catalog } = useStaffData();
  const toast = useToast();
  const [shares, setShares] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Spare in the lines' own terms when they all want the same product ("50 packs Front Shanks").
  const one = lines.length && lines.every((l) => l.productId === lines[0].productId) ? catalog?.productById.get(lines[0].productId) : undefined;
  const per = one?.uses.find((u) => u.part_id === contest.partId)?.qty ?? 0;
  const spareText = one && per > 0 ? amountText(Math.floor(contest.available / per + 1e-9), one) : String(Math.round(contest.available * 100) / 100);
  const value = (l: ExtraLine) => shares[l.key] ?? String(l.chosen ?? result.fills.get(l.key)?.fill ?? 0);

  const save = async () => {
    const choices = lines.map((l) => {
      const v = Number(value(l));
      return { order_id: l.orderId, product_id: l.productId, qty: Number.isFinite(v) && v >= 0 ? Math.min(v, l.asked) : 0 };
    });
    setBusy(true);
    const err = await saveExtraChoices(getDb(), week, choices);
    setBusy(false);
    toast(err ? `Couldn't save: ${err}` : "Split saved");
    if (!err) {
      setShares({});
      onSaved();
    }
  };

  return (
    <section className={`panel mt-2 ${highlight ? "border-2 border-amber-500" : ""}`}>
      <p className="m-0">
        <b>Extras to share: {contest.partName}</b> · {spareText} spare
        {contest.decided ? <span className="small muted"> · split by you</span> : <span className="tag extra ml-1">Kathy to decide</span>}
      </p>
      <p className="small muted mt-1 mb-1">
        {contest.decided
          ? "Each gets what you chose. Change it any time."
          : "Not enough for everyone. Until you split it, they fill in the usual customer order."}
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {lines.map((l) => {
          const p = catalog?.productById.get(l.productId);
          return (
            <li key={l.key} className="flex flex-wrap items-center gap-2">
              <span className="min-w-[12rem]">
                {name(l.customerId)} wants {amountText(l.asked, p)}
              </span>
              {canSplit ? (
                <label className="flex items-center gap-1">
                  <span className="small">gets</span>
                  <input
                    className="field w-20!"
                    inputMode="decimal"
                    value={value(l)}
                    onChange={(e) => setShares((s) => ({ ...s, [l.key]: e.target.value }))}
                    aria-label={`${name(l.customerId)} gets`}
                  />
                </label>
              ) : (
                <span>gets {result.fills.get(l.key)?.fill ?? 0}</span>
              )}
            </li>
          );
        })}
      </ul>
      {canSplit && (
        <button type="button" className="btn mt-2" disabled={busy} onClick={() => void save()}>
          Save the split
        </button>
      )}
    </section>
  );
}
