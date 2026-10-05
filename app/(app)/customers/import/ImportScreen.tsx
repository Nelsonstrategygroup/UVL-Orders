"use client";

// "Import customers from a spreadsheet" (SPEC 5.9): upload a CSV, preview
// the rows, then import. Customers already in the list are skipped.

import Link from "next/link";
import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { importPayload, IMPORT_COLUMNS, planImport, templateCsv, type ImportPlan } from "@/lib/import/customers";

export default function ImportScreen() {
  const { customers, reloadCustomers } = useStaffData();
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const blob = new Blob([templateCsv()], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "customers.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setPlan(null);
      setError("That is an Excel file. In Excel, choose File, Save As, and pick “CSV” as the type. Then choose the new file here.");
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    const existing = (customers?.list ?? []).map((c) => ({
      name: c.name,
      parentName: c.parent_customer_id ? (customers?.byId.get(c.parent_customer_id)?.name ?? null) : null,
    }));
    setPlan(planImport(text, existing));
  }

  async function runImport() {
    if (!plan) return;
    setBusy(true);
    const { data, error: err } = await getDb().rpc("import_customers", { p_rows: importPayload(plan) });
    setBusy(false);
    if (err) {
      setError(`Nothing was imported: ${err.message}`);
      return;
    }
    const r = data as { created: number; skipped: number; parents_created: number };
    await reloadCustomers();
    const parts = [`Added ${r.created} customer${r.created === 1 ? "" : "s"}`];
    if (r.parents_created) parts.push(`${r.parents_created} new parent${r.parents_created === 1 ? "" : "s"}`);
    if (r.skipped) parts.push(`skipped ${r.skipped} already in the list`);
    setResult(parts.join(", ") + ".");
    setPlan(null);
    toast("Import finished");
  }

  const newCount = plan?.customers.filter((c) => c.status === "new").length ?? 0;
  const skipCount = (plan?.customers.length ?? 0) - newCount;

  return (
    <div className="max-w-[900px]">
      <Link href="/customers" className="copy text-[.9rem]">
        ‹ All customers
      </Link>
      <h2 className="mt-2 mb-1">Import customers from a spreadsheet</h2>
      <p className="muted mt-0">
        The spreadsheet needs these columns, in any order, with the names in the first row:{" "}
        <span className="font-mono text-[.85rem]">{IMPORT_COLUMNS.join(", ")}</span>.
      </p>
      <ul className="muted mt-0 pl-5 text-[.95rem]">
        <li>Only “name” is required.</li>
        <li>For a store location, put the chain&apos;s name in “parent”, for example PCC Community Markets.</li>
        <li>For a second contact, add another row with the same name.</li>
        <li>Customers already in the list are skipped, never changed.</li>
      </ul>

      <div className="panel mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn ghost" onClick={downloadTemplate}>
          Download a blank spreadsheet
        </button>
        <label className="btn">
          Choose the spreadsheet (CSV)
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {fileName && <span className="small muted">{fileName}</span>}
      </div>

      {error && <p className="note bad mt-3">{error}</p>}
      {result && (
        <p className="note mt-3">
          {result}{" "}
          <Link href="/customers" className="copy text-[.9rem]">
            See the customer list
          </Link>
        </p>
      )}

      {plan && (
        <section className="mt-4">
          {plan.errors.map((e) => (
            <p key={e} className="note bad">
              {e}
            </p>
          ))}
          {plan.customers.length > 0 && (
            <>
              <p className="mb-2">
                <b>{newCount}</b> new customer{newCount === 1 ? "" : "s"}
                {skipCount > 0 && <>, {skipCount} already in the list</>}
                {plan.newParents.length > 0 && <>. Also adds {plan.newParents.join(", ")} as a parent</>}.
              </p>
              <div className="gridwrap max-h-[55vh]!">
                <table className="simple">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Call day</th>
                      <th>Contacts</th>
                      <th>What happens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.customers.map((c) => (
                      <tr key={`${c.parent}|${c.name}`}>
                        <td>
                          {c.parent ? `${c.parent}: ` : ""}
                          <b>{c.name}</b>
                          {c.warnings.map((w) => (
                            <div key={w} className="small text-barn">
                              {w}
                            </div>
                          ))}
                        </td>
                        <td>{c.type}</td>
                        <td>{c.call_day ?? ""}</td>
                        <td className="small">
                          {c.contacts.map((k, i) => (
                            <div key={i}>{[k.name, k.role, k.phone, k.email].filter(Boolean).join(", ")}</div>
                          ))}
                        </td>
                        <td>{c.status === "new" ? "Added" : <span className="muted">Already in the list, skipped</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="bigbtn"
                disabled={busy || newCount === 0 || plan.errors.length > 0}
                onClick={() => void runImport()}
              >
                {busy ? "Importing..." : newCount ? `Import ${newCount} customer${newCount === 1 ? "" : "s"}` : "Nothing new to import"}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
