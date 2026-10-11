import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { openKey, sealKey } from "../lib/ai/sealed-key.ts";

const secret = randomBytes(32);
const apiKey = "sk-test-0123456789abcdef";

test("a sealed key opens for its own organization", () => {
  assert.equal(openKey(sealKey(apiKey, "org_a", secret), "org_a", secret), apiKey);
});

test("the sealed form does not contain the key", () => {
  const sealed = sealKey(apiKey, "org_a", secret);
  assert.ok(!sealed.includes(apiKey));
  assert.ok(!sealed.includes("0123456789abcdef"));
});

test("a sealed key copied to another organization does not open", () => {
  assert.throws(() => openKey(sealKey(apiKey, "org_a", secret), "org_b", secret));
});

test("a different secret does not open it", () => {
  assert.throws(() => openKey(sealKey(apiKey, "org_a", secret), "org_a", randomBytes(32)));
});

test("a tampered key does not open", () => {
  const [version, iv, tag, body] = sealKey(apiKey, "org_a", secret).split(".");
  const flipped = Buffer.from(body, "base64");
  flipped[0] ^= 1;
  assert.throws(() => openKey([version, iv, tag, flipped.toString("base64")].join("."), "org_a", secret));
});
