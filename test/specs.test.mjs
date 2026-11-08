import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, WATCHED, specFor, describeStep } from "../scripts/specs.mjs";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

const EXPECTED_ENDPOINTS = {
  catalog: ["GET /categories", "GET /categories/{id}", "GET /products", "GET /products/{id}"],
  orders: ["GET /orders", "GET /orders/{id}", "POST /orders", "POST /orders/{id}/cancel"],
};

function endpoints(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const m of Object.keys(item)) if (METHODS.includes(m)) out.push(`${m.toUpperCase()} ${path}`);
  }
  return out.sort();
}

function refs(node, at = [], out = []) {
  if (Array.isArray(node)) node.forEach((v, i) => refs(v, [...at, i], out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref") out.push({ ref: v, at });
      else refs(v, [...at, k], out);
    }
  }
  return out;
}

function resolve(doc, ref) {
  return ref
    .slice(2)
    .split("/")
    .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((n, key) => (n == null ? undefined : n[key]), doc);
}

const prevOf = (step) => ((step + 2) % 4) + 1;

test("SERVICES lists both services", () => {
  assert.deepEqual(SERVICES, ["catalog", "orders"]);
});

for (const s of ["catalog", "orders"]) {
  const W = WATCHED[s];

  test(`${s}: base has four endpoints`, () => {
    assert.deepEqual(endpoints(specFor(s, 4)), EXPECTED_ENDPOINTS[s]);
  });

  test(`${s}: step 1 adds only the optional field`, () => {
    const spec = specFor(s, 1);
    const schema = spec.components.schemas[W.schema];
    assert.ok(schema.properties[W.field], "field present");
    assert.ok(!(schema.required ?? []).includes(W.field), "field optional");
    delete schema.properties[W.field];
    assert.deepEqual(spec, specFor(s, 4));
  });

  test(`${s}: step 2 equals base`, () => {
    assert.deepEqual(specFor(s, 2), specFor(s, 4));
  });

  test(`${s}: step 3 removes only the watched endpoint`, () => {
    const spec = specFor(s, 3);
    assert.equal(spec.paths[W.path]?.[W.method], undefined);
    assert.deepEqual(
      endpoints(spec),
      EXPECTED_ENDPOINTS[s].filter((e) => e !== `${W.method.toUpperCase()} ${W.path}`),
    );
  });

  test(`${s}: every transition changes the spec`, () => {
    for (let step = 1; step <= 4; step++) {
      assert.notEqual(JSON.stringify(specFor(s, prevOf(step))), JSON.stringify(specFor(s, step)), `step ${step}`);
    }
  });

  test(`${s}: all refs resolve at every step`, () => {
    for (let step = 1; step <= 4; step++) {
      const spec = specFor(s, step);
      for (const { ref } of refs(spec)) {
        assert.ok(ref.startsWith("#/"), `internal ref ${ref}`);
        assert.notEqual(resolve(spec, ref), undefined, `step ${step}: ${ref} resolves`);
      }
    }
  });

  test(`${s}: watched schema is used only by the watched endpoint`, () => {
    const spec = specFor(s, 4);
    const target = `#/components/schemas/${W.schema}`;
    const users = refs(spec).filter((r) => r.ref === target);
    assert.ok(users.length > 0);
    for (const { at } of users) assert.deepEqual(at.slice(0, 3), ["paths", W.path, W.method]);
  });

  test(`${s}: specFor returns a fresh object`, () => {
    const a = specFor(s, 4);
    a.paths = {};
    assert.notDeepEqual(specFor(s, 4).paths, {});
  });

  test(`${s}: describeStep names the change`, () => {
    assert.equal(describeStep(s, 1), `${s}: add optional field ${W.schema}.${W.field} (non-breaking)`);
    assert.equal(describeStep(s, 2), `${s}: remove field ${W.schema}.${W.field} (breaking)`);
    assert.equal(describeStep(s, 3), `${s}: remove ${W.method.toUpperCase()} ${W.path} (breaking)`);
    assert.equal(describeStep(s, 4), `${s}: restore ${W.method.toUpperCase()} ${W.path} (non-breaking)`);
  });
}

test("orders carries the same Product as catalog", () => {
  assert.deepEqual(specFor("orders", 4).components.schemas.Product, specFor("catalog", 4).components.schemas.Product);
});

test("POST /orders references Product through its line items", () => {
  const spec = specFor("orders", 4);
  const seen = new Set();
  const reaches = (node) => {
    for (const { ref } of refs(node)) {
      if (ref === "#/components/schemas/Product") return true;
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (reaches(resolve(spec, ref))) return true;
    }
    return false;
  };
  assert.ok(reaches(spec.paths["/orders"].post));
});

test("specFor rejects unknown service or step", () => {
  assert.throws(() => specFor("billing", 1));
  assert.throws(() => specFor("catalog", 5));
  assert.throws(() => specFor("catalog", 0));
});
