"use client";

import Link from "next/link";
import { useActionState } from "react";
import { RESET_SENT_MESSAGE } from "@/lib/auth/password";
import { requestPasswordReset, type ResetState } from "../actions";

export default function ForgotForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(requestPasswordReset, {});

  if (state.sent)
    return (
      <div>
        <p className="note" role="status">
          {RESET_SENT_MESSAGE}
        </p>
        <p className="muted">The link works once, for one hour. If nothing comes in a few minutes, check the spam folder.</p>
        <Link href="/login" className="bigbtn mt-4! text-center">
          Back to log in
        </Link>
      </div>
    );

  return (
    <form action={action} noValidate>
      <label className="lbl big" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        className="field big"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={state.email}
        autoFocus
        required
      />
      {state.error && (
        <p className="note bad mt-4" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="bigbtn mt-5!" disabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
      <p className="mt-4 text-center">
        <Link href="/login" className="text-forest underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
