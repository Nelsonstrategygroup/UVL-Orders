"use client";

// Weekly P&L entries (Lucas, 11/17/26): what's entered by hand for the week,
// moved off the summary page. Adjustments and one-off lines (void, not
// delete), other income and expense entries, each listed with the add forms
// below. A closed week lists them without the forms.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useWeek, WeekBar } from "@/components/Week";
import { isISODate, weekName } from "@/lib/dates";
import { AdjustmentsPanel } from "../Adjustments";
import { Entries } from "../EntryForms";
import { usePnlWeek } from "../usePnlWeek";

export default function EntriesScreen() {
  const { week, setWeek } = useWeek();
  const asked = useSearchParams().get("week");
  useEffect(() => {
    if (asked && isISODate(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const w = usePnlWeek(week);
  const head = (
    <div className="noprint">
      <WeekBar />
    </div>
  );
  if (w.error) return <>{head}<p className="note bad">Couldn&apos;t load the entries: {w.error}</p></>;
  if (!w.ready) return <>{head}<p className="small muted">Loading...</p></>;
  const { data, setup, p, refresh, status } = w;
  const closed = !!status.closed;

  return (
    <div className="max-w-[900px]">
      {head}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={`/pnl`} className="btn ghost">
          &larr; Weekly P&amp;L
        </Link>
        <h2 className="m-0">Entries · {weekName(week)}</h2>
      </div>
      <p className="small muted mt-1">
        What&apos;s entered by hand for this week: corrections (adjustments, with a reason), one-off lines, other income and
        expenses. Every entry counts toward the week that contains its date.
      </p>
      {closed && <p className="note">This week is closed. Reopen it on the Weekly P&amp;L to change anything.</p>}
      <AdjustmentsPanel week={week} p={p} categories={setup.categories} refresh={refresh} closed={closed} />
      <Entries
        week={week}
        income={data.income}
        expenses={data.expenses}
        files={data.expenseFiles}
        categories={setup.categories}
        refresh={refresh}
        readOnly={closed}
      />
    </div>
  );
}
