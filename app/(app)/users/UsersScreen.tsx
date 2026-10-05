"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import Sheet from "@/components/Sheet";
import { ROLE_INFO, ROLES, type Role } from "@/lib/auth/roles";
import { formatDateTime } from "@/lib/format";
import {
  addUser,
  renameUser,
  setUserActive,
  setUserPassword,
  setUserRole,
  type ActionResult,
} from "./actions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
};

export default function UsersScreen({ users, myId }: { users: UserRow[]; myId: string }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeEdit = useCallback(() => setEditingId(null), []);
  const editing = users.find((u) => u.id === editingId) ?? null;

  return (
    <>
      <button type="button" className="bigbtn mt-0! mb-4" onClick={() => setAdding(true)}>
        Add a person
      </button>

      <div className="grid gap-2">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => setEditingId(u.id)}
            className={`flex w-full items-center justify-between gap-3 rounded-[10px] border border-line bg-paper p-3 text-left ${u.active ? "" : "opacity-70"}`}
          >
            <span className="min-w-0">
              <span className="block truncate text-[1.05rem] font-semibold">
                {u.name || u.email}
                {u.id === myId && <span className="muted font-normal"> (you)</span>}
              </span>
              <span className="block truncate text-[.85rem] text-ink-soft">{u.email}</span>
              <span className="block text-[.8rem] text-ink-soft">
                {u.lastLoginAt ? `Last logged in ${formatDateTime(u.lastLoginAt)}` : "Has not logged in yet"}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className={`tag ${u.role === "admin" ? "sets" : u.role === "packing" ? "extra" : "even"}`}>
                {ROLE_INFO[u.role].label}
              </span>
              {!u.active && <span className="tag short">Turned off</span>}
              <span className="text-[.85rem] text-forest underline">Change</span>
            </span>
          </button>
        ))}
        {users.length === 0 && <p className="panel empty">No one yet.</p>}
      </div>

      {adding && (
        <Sheet title="Add a person" onClose={closeAdd}>
          <AddUserForm onDone={closeAdd} />
        </Sheet>
      )}
      {editing && (
        <Sheet title={editing.name || editing.email} onClose={closeEdit}>
          <EditUser user={editing} isMe={editing.id === myId} onDone={closeEdit} />
        </Sheet>
      )}
    </>
  );
}

function PasswordInput({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        name={name}
        type={show ? "text" : "password"}
        className="field big"
        autoComplete="new-password"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      />
      <button
        type="button"
        className="btn ghost min-w-[5.5rem] shrink-0"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

function RoleChoice({ value, onChange, disabled }: { value: Role | null; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2" role="group" aria-label="What they do">
      {ROLES.map((r) => (
        <button
          key={r}
          type="button"
          className="bigchoice"
          aria-pressed={value === r}
          onClick={() => onChange(r)}
          disabled={disabled}
        >
          <b>{ROLE_INFO[r].label}</b>
          {ROLE_INFO[r].sub}
        </button>
      ))}
    </div>
  );
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "note mt-3" : "note bad mt-3"} role={result.ok ? "status" : "alert"}>
      {result.message}
    </p>
  );
}

function AddUserForm({ onDone }: { onDone: () => void }) {
  const [result, action, pending] = useActionState(addUser, null);
  const [role, setRole] = useState<Role | null>(null);

  if (result?.ok) {
    return (
      <div>
        <Result result={result} />
        <p className="muted">Give them their email and password in person or by phone.</p>
        <button type="button" className="bigbtn" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  return (
    <form action={action}>
      <label className="lbl big" htmlFor="add-name">
        Name
      </label>
      <input id="add-name" name="name" className="field big" autoComplete="off" autoFocus />

      <label className="lbl big" htmlFor="add-email">
        Email
      </label>
      <input
        id="add-email"
        name="email"
        type="email"
        className="field big"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />

      <label className="lbl big" htmlFor="add-password">
        Password
      </label>
      <PasswordInput id="add-password" name="password" />
      <p className="muted small mt-1">At least 8 characters.</p>

      <p className="lbl big">What do they do?</p>
      <RoleChoice value={role} onChange={setRole} />
      <input type="hidden" name="role" value={role ?? ""} />

      <Result result={result} />
      <button type="submit" className="bigbtn mt-4!" disabled={pending}>
        {pending ? "Adding..." : "Add this person"}
      </button>
    </form>
  );
}

function EditUser({ user, isMe, onDone }: { user: UserRow; isMe: boolean; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [name, setName] = useState(user.name);
  const [password, setPassword] = useState("");

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) after?.();
    });

  return (
    <div>
      <p className="muted mt-0">{user.email}</p>

      <section className="border-t border-line py-3">
        <label className="lbl big mt-0!" htmlFor="edit-name">
          Name
        </label>
        <div className="flex gap-2">
          <input id="edit-name" className="field big" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className="btn shrink-0"
            disabled={pending || name.trim() === user.name}
            onClick={() => run(() => renameUser(user.id, name))}
          >
            Save
          </button>
        </div>
      </section>

      <section className="border-t border-line py-3">
        <p className="lbl big mt-0!">What do they do?</p>
        {isMe ? (
          <p className="muted">
            You are {ROLE_INFO[user.role].label.toLowerCase()}. Another admin can change your role.
          </p>
        ) : (
          <RoleChoice
            value={user.role}
            disabled={pending}
            onChange={(r) => {
              if (r !== user.role) run(() => setUserRole(user.id, r));
            }}
          />
        )}
      </section>

      <section className="border-t border-line py-3">
        <label className="lbl big mt-0!" htmlFor="edit-password">
          Set a new password
        </label>
        <PasswordInput id="edit-password" value={password} onChange={setPassword} />
        <button
          type="button"
          className="btn mt-2"
          disabled={pending || password.length === 0}
          onClick={() => run(() => setUserPassword(user.id, password), () => setPassword(""))}
        >
          Save new password
        </button>
      </section>

      {!isMe && (
        <section className="border-t border-line py-3">
          {user.active ? (
            <>
              <p className="muted mt-0">Turning off a login logs them out and stops them logging in. You can turn it back on.</p>
              <button
                type="button"
                className="btn danger"
                disabled={pending}
                onClick={() => run(() => setUserActive(user.id, false))}
              >
                Turn off this login
              </button>
            </>
          ) : (
            <>
              <p className="muted mt-0">This login is turned off.</p>
              <button type="button" className="btn" disabled={pending} onClick={() => run(() => setUserActive(user.id, true))}>
                Turn it back on
              </button>
            </>
          )}
        </section>
      )}

      <Result result={result} />
      <div className="mt-3 flex justify-end">
        <button type="button" className="btn ghost" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
