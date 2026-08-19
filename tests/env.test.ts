import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "fs";
import { loadEnv } from "../src/env.ts";

test("loadEnv overrides OpenAI keys from the project .env file", () => {
  const path = "tests/tmp.env";
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBase = process.env.OPENAI_BASE_URL;
  process.env.OPENAI_API_KEY = "wrong-key-from-shell";
  delete process.env.OPENAI_BASE_URL;
  writeFileSync(
    path,
    "OPENAI_API_KEY=litmus-test-key\nOPENAI_BASE_URL=https://example.test/v1\n",
  );
  try {
    loadEnv(path);
    assert.equal(process.env.OPENAI_API_KEY, "litmus-test-key");
    assert.equal(process.env.OPENAI_BASE_URL, "https://example.test/v1");
  } finally {
    unlinkSync(path);
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = previousBase;
  }
});
