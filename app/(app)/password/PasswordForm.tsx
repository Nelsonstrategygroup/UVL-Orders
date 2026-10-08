"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { MIN_PASSWORD } from "@/lib/auth/password";
import { changeMyPassword, type PasswordState } from "./actions";

function Field({ id, label, autoComplete, show }: { id: string; label: string; autoComplete: string; show: boolean }) {
  return (
    <>
      <label className="lbl big" htmlFor={id}>
        {label}
      </label>
      <input id={id} name={id} type={show ? "text" : "password"} className="field big" autoComplete={autoComplete} required />
    </>
  );
}

export default function PasswordForm({ askCurrent, home }: { askCurrent: boolean; home: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changeMyPassword, {});
  const [show, setShow] = useState(false);

  if (state.ok)
    return (
      <div className="panel mt-3">
        <p className="note mt-0" role="status">
          Your new password is saved. Use it next time you log in.
        </p>
        <Link href={home} className="bigbtn text-center">
          Done
        </Link>
      </div>
    );

  return (
    <form action={action} className="panel mt-3" noValidate>
      {askCurrent && <Field id="current" label="Current password" autoComplete="current-password" show={show} />}
      <Field id="password" label="New password" autoComplete="new-password" show={show} />
      <p className="small muted mt-1 mb-0">At least {MIN_PASSWORD} characters.</p>
      <Field id="again" label="New password again" autoComplete="new-password" show={show} />

      <label className="mt-3 flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show passwords
      </label>

      {state.error && (
        <p className="note bad mt-3" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="bigbtn mt-4!" disabled={pending}>
        {pending ? "Saving..." : "Save new password"}
      </button>
      {askCurrent && (
        <p className="small muted mt-3 mb-0">
          Forgot your current password? Log out and tap <b>Forgot password?</b> on the login page.
        </p>
      )}
    </form>
  );
}
