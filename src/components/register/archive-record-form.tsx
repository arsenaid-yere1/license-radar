"use client";
import { RecordChangeForm, type RecordFormProps } from "./edit-record-form";
export function ArchiveRecordForm(props: RecordFormProps) {
  return <RecordChangeForm {...props} intent="archive" />;
}
