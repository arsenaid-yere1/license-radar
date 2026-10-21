import { recordNumberLabels } from "@/lib/register/numbers";
import type { Credential } from "@/lib/register/schema";

export function RecordNumber({ record }: { record: Credential }) {
  return (
    <p style={{ overflowWrap: "anywhere" }}>
      {recordNumberLabels[record.type]}: {record.record_number ?? "Not entered"}
    </p>
  );
}
