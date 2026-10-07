import type { MaintenanceState, RegisterState } from "./schema";
export function registerInput(form: FormData) {
  const input: Record<string, unknown> = {};
  const coverage: string[] = [];
  for (const [key, value] of form) {
    if (key.startsWith("$ACTION_")) continue;
    if (typeof value !== "string") return null;
    if (key === "coveredClinicianIds") coverage.push(value);
    else {
      if (key in input) return null;
      input[key] = value;
    }
  }
  if (coverage.length) input.coveredClinicianIds = coverage;
  return input;
}
export function registerMessage(
  status: RegisterState["status"],
  clinician = false,
) {
  switch (status) {
    case "success":
      return clinician ? "Clinician saved." : "Record saved.";
    case "invalid":
      return "Check the highlighted fields.";
    case "invalid-reference":
      return "An owner or covered clinician is unavailable. Reload and review your selection.";
    case "request-conflict":
      return "This save request was already used. Reload and review the saved register.";
    case "forbidden":
      return "You do not have permission to add register records.";
    default:
      return "We could not confirm this save. Retry this save before changing it.";
  }
}

export const maintenanceFormInput = registerInput;

export function maintenanceMessage(
  status: MaintenanceState["status"],
  archive = false,
) {
  if (["invalid", "invalid-reference", "request-conflict"].includes(status))
    return registerMessage(status as RegisterState["status"]);
  switch (status) {
    case "success":
      return archive ? "Record archived." : "Changes saved.";
    case "conflict":
      return "This record changed. Compare your draft with the saved values.";
    case "archived":
      return "This record is archived. Reload the register to review its history.";
    case "not-found":
      return "This record is unavailable. Reload the register.";
    case "forbidden":
      return "You do not have permission to change register records.";
    default:
      return "We could not confirm this save. Retry this save before leaving this page.";
  }
}
