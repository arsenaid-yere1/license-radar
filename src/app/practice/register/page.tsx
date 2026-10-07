import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getPracticeAccess } from "@/lib/practice/access";
import { getMaintenanceRegister } from "@/lib/register/repository";
import { RegisterPanel } from "@/components/register/register-panel";
import { Shell } from "@/components/shell";
import { SignOutForm } from "@/components/auth/sign-out-form";
import { maintenanceAction, registerAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function PracticeRegister({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const archivedView = (await searchParams)?.view === "archived";
  const { client } = await requireUser();
  const access = await getPracticeAccess(client);
  if (access.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  if (!access.access) redirect("/onboarding/practice");
  const result = await getMaintenanceRegister(
    client,
    access.access.practice.id,
    archivedView,
  );
  if (result.status !== "success")
    throw new Error("We could not complete this request. Try again.");
  return (
    <Shell action={<SignOutForm />}>
      <div className="register-heading">
        <Link className="text-link" href="/practice">
          Practice settings
        </Link>
        <span className="eyebrow">
          {access.access.practice.name} / Renewal register
        </span>
        <h1>Your renewal register.</h1>
        <p className="lede">
          The people and records you track, together in one place.
        </p>
        <RegisterPanel
          register={result.register}
          canEdit={access.access.role !== "viewer"}
          action={registerAction}
          maintenanceAction={maintenanceAction}
          readKey={randomUUID()}
          archivedView={archivedView}
          clinicianKey={randomUUID()}
          credentialKey={randomUUID()}
        />
      </div>
    </Shell>
  );
}
