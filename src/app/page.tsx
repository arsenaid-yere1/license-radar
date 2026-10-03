import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getCurrentPractice } from "@/lib/practice/repository";
export const dynamic = "force-dynamic";
export default async function Home() {
  const { client } = await requireUser();
  const result = await getCurrentPractice(client);
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  redirect(result.practice ? "/practice" : "/onboarding/practice");
}
