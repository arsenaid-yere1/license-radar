"use client";
const key = "practice-invitation";
const event = "practice-invitation-change";
export function invitationContext() {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function subscribeInvitation(callback: () => void) {
  window.addEventListener(event, callback);
  return () => window.removeEventListener(event, callback);
}
export function clearInvitation() {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* Unavailable storage contains no readable context. */
  }
  window.dispatchEvent(new Event(event));
}
export function captureInvitation() {
  if (!window.location.hash) return;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    try {
      window.sessionStorage.setItem(key, token);
    } catch {
      return;
    }
    window.dispatchEvent(new Event(event));
  } else clearInvitation();
}
