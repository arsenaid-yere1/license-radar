import { Webhook } from "svix";
export async function emailFixture(
  path: "state" | "mode",
  input: { to: string; mode?: string },
) {
  const response = await fetch(`http://127.0.0.1:55326/test/${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer local-fixture-only-e4-s2",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Email fixture unavailable");
  return response.json();
}
export function signedEmailEvent(
  value: unknown,
  id = `evt_${crypto.randomUUID()}`,
) {
  const body = JSON.stringify(value),
    when = new Date(),
    secret =
      "whsec_" +
      Buffer.from("fixture-signing-secret-e4-s2-only!").toString("base64");
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "svix-id": id,
      "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
      "svix-signature": new Webhook(secret).sign(id, when, body),
    },
  };
}
