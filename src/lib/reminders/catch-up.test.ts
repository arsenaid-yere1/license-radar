import { expect, it } from "vitest";
import { emailPayloadSchema } from "./messages";
it("CU13 ordinary payload remains compatible and truthful; CU12 fixed catch-up subject is permitted", () => {
  const payload = {
    from: "reminders@example.test",
    to: ["fixture@example.test"],
    reply_to: "support@example.test",
    text: "Sign in.",
    html: "<p>Sign in.</p>",
    tags: [
      {
        name: "reminder_attempt",
        value: "10000000-0000-4000-8000-000000000001",
      },
    ],
  };
  for (const subject of [
    "Credential renewal reminder: 60 days",
    "Credential renewal catch-up reminder",
  ])
    expect(emailPayloadSchema.safeParse({ ...payload, subject }).success).toBe(
      true,
    );
  expect(
    emailPayloadSchema.safeParse({ ...payload, subject: "Arbitrary message" })
      .success,
  ).toBe(false);
});
