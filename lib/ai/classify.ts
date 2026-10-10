import "server-only";

import { cachedTask } from "@/lib/ai/client";
import { MODEL_ASSIGNABLE_ROLES, isModelAssignableRole, type ModelAssignableRole } from "@/lib/taxonomy.mts";

export interface ClassifyInput {
  path: string;
  sha256: string;
  imports: string[];
  // Read from disk while the analysis still has the checkout; pinned by sha256.
  excerpt: string;
}

// "none" leaves the file unidentified. Absent beats approximate.
export type Classification = { role: ModelAssignableRole | "none" };

const EXCERPT_LINES = 120;
const EXCERPT_CHARS = 6000;

export function excerptOf(source: string): string {
  return source.split("\n").slice(0, EXCERPT_LINES).join("\n").slice(0, EXCERPT_CHARS);
}

function isClassification(value: unknown): value is Classification {
  if (typeof value !== "object" || value === null) return false;
  const { role } = value as Record<string, unknown>;
  return typeof role === "string" && (role === "none" || isModelAssignableRole(role));
}

export const classifyFile = cachedTask<ClassifyInput, Classification>({
  name: "classify-file",
  version: 1,
  keyOf: ({ path, sha256, imports }) => ({ path, sha256, imports }),
  async prepare(input) {
    return {
      read(text) {
        const parsed: unknown = JSON.parse(text);
        if (!isClassification(parsed)) throw new Error(`The model answered outside the permitted roles: ${text}`);
        return parsed;
      },
      request: {
        maxTokens: 4000,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["role"],
          properties: { role: { type: "string", enum: [...MODEL_ASSIGNABLE_ROLES, "none"] } },
        },
        system: [
          "You label one source file of a TypeScript or JavaScript repository with the role it plays.",
          "service: business logic or an integration with an outside system.",
          "repository: data access, the code that reads and writes storage.",
          "model: data shapes, types or schemas describing domain records.",
          "utility: small general-purpose helpers.",
          "config: configuration, constants, environment or build setup.",
          "component: a UI component.",
          "hook: a React hook.",
          "none: it is none of these clearly. Prefer none to a guess.",
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Path: ${input.path}`,
              `Repository files it imports: ${input.imports.length > 0 ? input.imports.join(", ") : "(none)"}`,
              "First lines:", "<source>", input.excerpt, "</source>",
            ].join("\n"),
          },
        ],
      },
    };
  },
  isOutput: isClassification,
});
