import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. The organization ID is bound in as associated data, so a sealed
// key copied onto another organization's row fails to open rather than
// spending the first organization's money.
const VERSION = "v1";

export function sealKey(apiKey: string, organizationId: string, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  cipher.setAAD(Buffer.from(organizationId, "utf8"));
  const body = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body].map((part) => typeof part === "string" ? part : part.toString("base64")).join(".");
}

export function openKey(sealed: string, organizationId: string, secret: Buffer): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Not a sealed key.");
  const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(organizationId, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
