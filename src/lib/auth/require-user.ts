import { authenticationRequired } from "./operations";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export async function requireUser() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error && !authenticationRequired(error.status))
    throw new Error("We could not complete this request. Try again.");
  if (!data.user) redirect("/login");
  return { client, user: data.user };
}
