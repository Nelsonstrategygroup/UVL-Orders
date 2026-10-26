// The paper packing copy (change request 10/26/26): the backup for when the
// internet is down. One row per product per customer, one blank per box with
// its label number above it, then Total lbs. Boxes not worked out (no box
// size) get empty "Label #" blanks. Blanks are sized to write in with gloves
// on. The "Type in from paper" screen lays out the same rows.

import type { BoxSetup } from "@/lib/calc/boxes";
import { fmt } from "@/lib/calc/num";
import type { SheetBlank, SheetRow } from "@/lib/calc/packSheet";
import type { PackLine } from "@/lib/calc/packing";
import { weekName } from "@/lib/dates";
import { orderSheet, packLines, sheetLabels, type PackingData, type PackOrder } from "@/lib/db/packing";
import { qtyText } from "@/lib/orders";

/** Standing notes and this week's order notes, so Chris sees them while packing. */
export function PackNotes({ o }: { o: PackOrder }) {
  if (!o.standingNotes && !o.orderNotes) return null;
  return (
    <div className="mt-1 grid gap-0.5 text-[.95rem] font-normal">
      {o.orderNotes && (
        <div>
          <b>This week:</b> {o.orderNotes}
        </div>
      )}
      {o.standingNotes && (
        <div className="whitespace-pre-wrap">
          <b>Always:</b> {o.standingNotes}
        </div>
      )}
    </div>
  );
}

/** What's printed above a blank: its label number, or a line to write one on. */
export function blankLabel(b: SheetBlank): string {
  if (b.planned) return b.labelNo != null ? `Label ${b.labelNo}` : `Box ${b.slot}`;
  return "Label #";
}

/** The product's words on the left: name, what was ordered, how many boxes. */
export function rowWords(row: SheetRow, line: PackLine | undefined): string {
  if (!line) return "Not on the order";
  const amount = qtyText(line.ordered, line.unit);
  return row.known ? `${amount} · ${row.boxCount} box${row.boxCount === 1 ? "" : "es"}` : amount;
}

export function PaperSheet({ data, boxes, preview = false }: { data: PackingData; boxes: BoxSetup; preview?: boolean }) {
  const labels = sheetLabels(data, boxes);
  const name = (pid: string) => data.products.get(pid)?.name ?? pid;
  return (
    <div className={preview ? "pksheet preview" : "print-only pksheet"}>
      <h1>
        Packing list, {weekName(data.week)}
        {data.invNumber ? ` · INV ${data.invNumber}` : ""}
      </h1>
      <p className="pk-how">
        Write each box&apos;s weight under its label number. On a blank marked &ldquo;Label #&rdquo;, write the label number
        too.
      </p>
      {data.orders.map((o) => {
        const lines = new Map(packLines(o, data.products));
        return (
          <section key={o.id} className="pk-cust">
            <div className="pk-head">
              <b>{o.customerName}</b>
              {o.group && (
                <span>
                  {o.group}
                  {o.spot ? `, ${o.spot}` : ""}
                </span>
              )}
              <span className="flex-1" />
              <span className="pk-fill">
                Pallet <i />
              </span>
              <span className="pk-fill">
                Initials <i />
              </span>
            </div>
            <PackNotes o={o} />
            {orderSheet(o, data, labels).map((row) => {
              const line = lines.get(row.productId);
              return (
                <div key={row.productId} className="pk-row">
                  <div className="pk-prod">
                    <span className="pk-ck" aria-hidden="true">
                      ☐
                    </span>
                    <div>
                      <b>{name(row.productId)}</b>
                      <div>{rowWords(row, line)}</div>
                      {!row.known && <div className="pk-unknown">box count unknown</div>}
                      <div className="pk-nf">Not filled {line?.shorted ? "☒" : "☐"}</div>
                    </div>
                  </div>
                  <div className="pk-blanks">
                    {row.blanks.map((b) => (
                      <div key={b.slot} className="pk-cell">
                        <div className="pk-lab">
                          {blankLabel(b)}
                          {!b.planned && b.labelNo != null ? ` ${b.labelNo}` : ""}
                        </div>
                        <div className="pk-box">{b.weight ? fmt(b.weight.weight) : ""}</div>
                      </div>
                    ))}
                    <div className="pk-cell pk-total">
                      <div className="pk-lab">Total lbs</div>
                      <div className="pk-box">{row.total > 0 ? fmt(row.total) : ""}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
