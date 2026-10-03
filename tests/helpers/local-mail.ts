import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(".env.test.json", "utf8"));
export async function mailFor(email: string) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const r = await fetch(`${config.MAILPIT_URL}/api/v1/messages`);
    if (!r.ok) throw new Error("Local mail unavailable");
    const data = await r.json();
    const item = data.messages.find((m: { To: { Address: string }[] }) =>
      m.To.some((t) => t.Address === email),
    );
    if (item) {
      const response = await fetch(
        `${config.MAILPIT_URL}/api/v1/message/${item.ID}`,
      );
      if (!response.ok) throw new Error("Local mail detail unavailable");
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No fixture code delivered");
}
export async function deliveredCode(email: string): Promise<string> {
  const mail = await mailFor(email);
  const code = (mail.Text ?? mail.HTML).match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error("No code in local mail");
  return code;
}
export async function mailCount(email: string): Promise<number> {
  const r = await fetch(`${config.MAILPIT_URL}/api/v1/messages`);
  const data = await r.json();
  return data.messages.filter((m: { To: { Address: string }[] }) =>
    m.To.some((t) => t.Address === email),
  ).length;
}
