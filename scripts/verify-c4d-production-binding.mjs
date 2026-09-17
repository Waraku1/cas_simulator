import { readFileSync } from "node:fs";

const EXPECTED_BINDING = "ACCOUNTS";
const EXPECTED_DATABASE_NAME = "cas-simulator-accounts";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function field(body, key) {
  const match = body.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  return match?.[1] ?? null;
}

function d1Bindings(source) {
  const array = source.match(/"d1_databases"\s*:\s*\[([\s\S]*?)\]\s*(?:,|})/);
  if (!array) return [];

  return [...array[1].matchAll(/\{([\s\S]*?)\}/g)].map((match) => ({
    binding: field(match[1], "binding"),
    databaseName: field(match[1], "database_name"),
    databaseId: field(match[1], "database_id"),
  }));
}

function validateBinding(source, required) {
  const accounts = d1Bindings(source).filter((entry) => entry.binding === EXPECTED_BINDING);

  if (accounts.length === 0) {
    if (required) {
      throw new Error(`Missing required ${EXPECTED_BINDING} D1 binding.`);
    }
    return { status: "ABSENT_PRE_PROVISION" };
  }

  if (accounts.length !== 1) {
    throw new Error(`Expected exactly one ${EXPECTED_BINDING} D1 binding, found ${accounts.length}.`);
  }

  const [entry] = accounts;
  if (entry.databaseName !== EXPECTED_DATABASE_NAME) {
    throw new Error(`Unexpected ${EXPECTED_BINDING} database_name: ${entry.databaseName ?? "<missing>"}.`);
  }
  if (!entry.databaseId || !UUID_PATTERN.test(entry.databaseId) || entry.databaseId === ZERO_UUID) {
    throw new Error(`${EXPECTED_BINDING} database_id must be a real non-placeholder D1 UUID.`);
  }

  return { status: "PASS", databaseName: entry.databaseName, databaseId: entry.databaseId };
}

function expectFailure(label, callback) {
  try {
    callback();
  } catch {
    console.log(`PASS self-test rejects ${label}`);
    return;
  }
  throw new Error(`Self-test unexpectedly accepted ${label}.`);
}

if (process.env.C4D_BINDING_SELF_TEST === "1") {
  const valid = `{
    "d1_databases": [{
      "binding": "ACCOUNTS",
      "database_name": "cas-simulator-accounts",
      "database_id": "123e4567-e89b-42d3-a456-426614174000"
    }]
  }`;
  const placeholder = valid.replace("123e4567-e89b-42d3-a456-426614174000", "00000000-0000-0000-0000-000000000000");
  const wrongName = valid.replace("cas-simulator-accounts", "wrong-database");
  const duplicate = valid.replace("]", `,{
      "binding": "ACCOUNTS",
      "database_name": "cas-simulator-accounts",
      "database_id": "223e4567-e89b-42d3-a456-426614174000"
    }]`);

  validateBinding(valid, true);
  expectFailure("missing required binding", () => validateBinding("{}", true));
  expectFailure("placeholder database ID", () => validateBinding(placeholder, true));
  expectFailure("wrong database name", () => validateBinding(wrongName, true));
  expectFailure("duplicate ACCOUNTS bindings", () => validateBinding(duplicate, true));
  console.log("C4D production binding validator self-test PASS");
}

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const required = process.env.C4D_BINDING_REQUIRED === "1";
const result = validateBinding(source, required);

if (result.status === "PASS") {
  console.log(`C4D_PRODUCTION_BINDING=PASS database_name=${result.databaseName} database_id=${result.databaseId}`);
} else {
  console.log("C4D_PRODUCTION_BINDING=ABSENT_PRE_PROVISION");
}
