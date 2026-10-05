"use client";
import type { Role } from "@/lib/practice/access";
import { useActionState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  captureInvitation,
  clearInvitation,
  invitationContext,
  subscribeInvitation,
} from "./invitation-context";
import { EmailCodeForm } from "./email-code-form";
import { SignOutForm } from "./sign-out-form";
import { ResultMessage } from "@/components/team/result-message";
import { roleLabels } from "@/lib/team/schema";
export type JoinState = {
  status: string;
  message?: string;
  name?: string;
  role?: Role;
  expires_at?: string;
  practiceId?: string;
};
export type JoinAction = (
  state: JoinState,
  data: FormData,
) => Promise<JoinState>;
export function JoinForm({
  signedIn,
  email,
  action,
}: {
  signedIn: boolean;
  email?: string;
  action: JoinAction;
}) {
  const token = useSyncExternalStore(
    subscribeInvitation,
    invitationContext,
    () => "",
  );
  const [state, submit, pending] = useActionState<JoinState, FormData>(
    async (previous, data) => {
      data.set("token", invitationContext());
      return action(previous, data);
    },
    { status: "idle" },
  );
  const router = useRouter();
  useEffect(captureInvitation, []);
  useEffect(() => {
    if (state.practiceId) {
      clearInvitation();
      router.replace("/practice");
    }
  }, [state, router]);
  if (!signedIn) return <EmailCodeForm destination="/join" />;
  return (
    <div>
      <p className="hint">Signed in as {email}</p>
      <SignOutForm />
      {!token ? (
        <p>
          This invitation is unavailable. Ask an administrator for a new link.
        </p>
      ) : (
        <form action={submit}>
          {state.name && state.role && (
            <div className="preview">
              <h2>{state.name}</h2>
              <p>{roleLabels[state.role]}</p>
              <p className="hint">
                Expires {new Date(state.expires_at!).toUTCString()}
              </p>
            </div>
          )}
          <input
            type="hidden"
            name="intent"
            value={state.name ? "accept" : "preview"}
          />
          <ResultMessage state={state} />
          <button disabled={pending}>
            {pending
              ? "Working…"
              : state.name
                ? "Accept invitation"
                : "Review invitation"}
          </button>
        </form>
      )}
    </div>
  );
}
