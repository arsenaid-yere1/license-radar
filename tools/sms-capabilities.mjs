import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const privileged = "src/lib/sms/privileged-repository.ts";
const allowed = new Set([
  "claimSend",
  "claimCheck",
  "recordSend",
  "recordCheck",
  "applyOptOut",
  "smsStorageConfigured",
  "reminderStorageConfigured",
  "drainReminderAccounts",
  "reconcileReminderJobs",
  "claimReminderJob",
  "beginReminderSubmission",
  "recordReminderSubmission",
  "expireReminderSubmissions",
  "findReminderBinding",
  "applyReminderEvent",
  "startReminderRun",
  "finishReminderRun",
]);
export function assertSmsCapabilities(files) {
  const parsed = new Map(
    [...files].map(([name, source]) => [
      name,
      ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true),
    ]),
  );
  const edges = new Map();
  for (const [name, file] of parsed) {
    const source = files.get(name);
    if (
      /user_metadata|NEXT_PUBLIC_[A-Z_]*(?:SECRET|TOKEN|AUTH_TOKEN|API_KEY|SERVICE_ROLE)/.test(
        source,
      )
    )
      throw new Error(`SMS public secret/authority: ${name}`);
    if (
      /SUPABASE_(?:SECRET_KEY|SERVICE_ROLE_KEY)/.test(source) &&
      name !== privileged
    )
      throw new Error(`SMS secret outside privileged boundary: ${name}`);
    const imports = [];
    for (const statement of file.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const clause = statement.importClause;
        const typeOnly =
          clause?.isTypeOnly ||
          (clause?.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            !clause.name &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly));
        if (!typeOnly) imports.push(statement.moduleSpecifier.text);
      }
      if (
        ts.isExportDeclaration(statement) &&
        !statement.isTypeOnly &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
        imports.push(statement.moduleSpecifier.text);
    }
    edges.set(name, imports);
    if (name === privileged) {
      if (!imports.includes("server-only"))
        throw new Error("SMS privileged marker missing");
      for (const statement of file.statements) {
        if (
          statement.modifiers?.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword,
          )
        ) {
          if (
            !ts.isFunctionDeclaration(statement) ||
            !statement.name ||
            !allowed.has(statement.name.text)
          )
            throw new Error("SMS raw/generic privileged export");
        }
        if (
          ts.isExportDeclaration(statement) ||
          ts.isExportAssignment(statement)
        )
          throw new Error("SMS raw/generic privileged export");
      }
    }
  }
  if (!parsed.has(privileged))
    throw new Error("SMS privileged boundary missing");
  function visit(name, seen) {
    if (seen.has(name)) return;
    seen.add(name);
    const source = files.get(name);
    if (/^["']use server["'];/m.test(source)) return;
    for (const reference of edges.get(name)) {
      if (reference === "server-only")
        throw new Error(`SMS client reaches server capability: ${name}`);
      const base = reference.startsWith("@/")
        ? "src/" + reference.slice(2)
        : reference.startsWith(".")
          ? path.posix.normalize(
              path.posix.join(path.posix.dirname(name), reference),
            )
          : null;
      if (base) {
        const target = [
          base,
          base + ".ts",
          base + ".tsx",
          base + "/index.ts",
          base + "/index.tsx",
        ].find((p) => parsed.has(p));
        if (target) visit(target, seen);
        else if (!base.endsWith(".css"))
          throw new Error(`SMS unresolved client import: ${base}`);
      }
    }
  }
  for (const [name, source] of files)
    if (/^["']use client["'];/m.test(source)) visit(name, new Set());
}
export function applicationSources() {
  const files = new Map();
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (/\.tsx?$/.test(name) && !name.includes(".test."))
        files.set(name, readFileSync(name, "utf8"));
    }
  }
  walk("src");
  return files;
}
