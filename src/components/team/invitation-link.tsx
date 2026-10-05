"use client";
import { useId, useState, useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function InvitationLink({
  token,
  expiresAt,
}: {
  token: string;
  expiresAt: string;
}) {
  const origin = useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
  const id = useId();
  const [copy, setCopy] = useState("");
  const link = `${origin}/join#token=${token}`;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("Link copied.");
    } catch {
      setCopy("Select the link and copy it using your keyboard.");
    }
  }
  return (
    <div className="invitation-link">
      <label htmlFor={id}>Invitation link</label>
      <input
        id={id}
        value={link}
        readOnly
        onFocus={(event) => event.target.select()}
      />
      <button type="button" className="secondary" onClick={copyLink}>
        Copy link
      </button>
      <p className="hint">
        Expires {new Date(expiresAt).toUTCString()}. Share this link with your
        staff member.
      </p>
      <p role="status" className="hint">
        {copy}
      </p>
    </div>
  );
}
