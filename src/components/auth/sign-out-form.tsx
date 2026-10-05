"use client";
import { signOutAction } from "@/app/login/actions";
import { clearInvitation } from "./invitation-context";
export function SignOutForm() {
  return (
    <form action={signOutAction} onSubmit={clearInvitation}>
      <button className="secondary">Sign out</button>
    </form>
  );
}
