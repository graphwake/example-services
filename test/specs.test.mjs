import { test } from "node:test";
import assert from "node:assert/strict";
import { SERVICES, FILES, WATCHED, DEPRECATED, specFor, describeStep, schemasOf } from "../scripts/specs.mjs";
import { render } from "../scripts/mutate.mjs";

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options", "trace"];

const EXPECTED_ENDPOINTS = {
  catalog: ["GET /categories", "GET /categories/{id}", "GET /products", "GET /products/{id}"],
  orders: ["GET /orders", "GET /orders/{id}", "POST /orders", "POST /orders/{id}/cancel"],
  inventory: ["GET /items", "GET /items/{sku}", "POST /items", "PUT /items/{sku}/stock"],
  shipping: ["GET /shipments", "GET /shipments/{id}", "GET /shipments/{id}/tracking", "POST /shipments"],
};

const SWAGGER2 = ["inventory", "shipping"];
const schemaPrefix = (spec) => (spec.swagger ? "#/definitions/" : "#/components/schemas/");

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

test("SERVICES lists all four services", () => {
  assert.deepEqual(SERVICES, ["catalog", "orders", "inventory", "shipping"]);
});

for (const s of SERVICES) {
  const W = WATCHED[s];

  test(`${s}: base has four endpoints`, () => {
    assert.deepEqual(endpoints(specFor(s, 4)), EXPECTED_ENDPOINTS[s]);
  });

  test(`${s}: step 1 adds only the optional field`, () => {
    const spec = specFor(s, 1);
    const schema = schemasOf(spec)[W.schema];
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
    assert.equal(schemasOf(spec)[W.schema], undefined, "watched schema removed with it");
    const rest = specFor(s, 4);
    delete rest.paths[W.path][W.method];
    if (Object.keys(rest.paths[W.path]).length === 0) delete rest.paths[W.path];
    delete schemasOf(rest)[W.schema];
    assert.deepEqual(spec, rest, "nothing else changes");
  });

  test(`${s}: step 4 restores the watched endpoint from step 3`, () => {
    const base = specFor(s, 4);
    assert.ok(base.paths[W.path][W.method]);
    assert.ok(schemasOf(base)[W.schema]);
    assert.deepEqual(specFor(s, 4), specFor(s, 2));
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
        assert.ok(ref.startsWith(schemaPrefix(spec)), `step ${step}: ref ${ref} points into the document's schemas`);
        assert.notEqual(resolve(spec, ref), undefined, `step ${step}: ${ref} resolves`);
      }
    }
  });

  test(`${s}: watched schema is used only by the watched endpoint`, () => {
    const spec = specFor(s, 4);
    const target = schemaPrefix(spec) + W.schema;
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

for (const s of SWAGGER2) {
  test(`${s}: is Swagger 2.0 at every step`, () => {
    for (let step = 1; step <= 4; step++) {
      const spec = specFor(s, step);
      assert.equal(spec.swagger, "2.0");
      assert.equal(spec.openapi, undefined);
      assert.equal(spec.components, undefined);
      assert.equal(spec.servers, undefined);
      assert.match(spec.basePath, /^\/[a-z]/);
      for (const item of Object.values(spec.paths)) {
        for (const op of Object.values(item)) {
          assert.equal(op.requestBody, undefined);
          for (const p of op.parameters ?? []) {
            if (p.in === "body") assert.ok(p.schema, `${p.name}: body parameter has a schema`);
            else assert.equal(typeof p.type, "string", `${p.name}: non-body parameter has a type`);
          }
          for (const r of Object.values(op.responses)) assert.equal(r.content, undefined);
        }
      }
    }
  });
}

test("inventory is Swashbuckle-shaped JSON with host, basePath and schemes", () => {
  assert.equal(FILES.inventory, "swagger.json");
  const spec = specFor("inventory", 4);
  assert.equal(spec.host, "api.example.com");
  assert.equal(spec.basePath, "/inventory");
  assert.deepEqual(spec.schemes, ["https"]);
  assert.deepEqual(spec.consumes, ["application/json"]);
  assert.deepEqual(spec.produces, ["application/json"]);
  assert.match(render("inventory", 4), /^\{\n  "swagger": "2\.0",\n/);
});

test("shipping is swag-shaped YAML: unquoted version first, basePath, no host, produces per operation", () => {
  assert.equal(FILES.shipping, "swagger.yaml");
  const spec = specFor("shipping", 4);
  assert.equal(spec.host, undefined);
  assert.equal(spec.basePath, "/shipping/v1");
  for (const item of Object.values(spec.paths)) {
    for (const op of Object.values(item)) assert.deepEqual(op.produces, ["application/json"]);
  }
  assert.ok(Object.keys(spec.definitions).every((n) => /^[a-z]+\.[A-Z]\w+$/.test(n)), "definitions named package.Type");
  for (let step = 1; step <= 4; step++) {
    const text = render("shipping", step);
    assert.ok(text.startsWith("swagger: 2.0\n"), `step ${step}: starts with the unquoted version`);
    assert.doesNotMatch(text, /^host:/m);
    assert.doesNotMatch(text, /^openapi:/m);
    assert.match(text, /^basePath: \/shipping\/v1$/m);
    assert.doesNotMatch(text, /^\{/);
  }
});

test("shipping YAML reads back as the generated document at every step", () => {
  for (let step = 1; step <= 4; step++) {
    const parsed = parseYaml(render("shipping", step));
    assert.equal(parsed.swagger, 2, "version is a YAML number");
    parsed.swagger = "2.0";
    assert.deepEqual(parsed, JSON.parse(JSON.stringify(specFor("shipping", step))), `step ${step}`);
  }
});

// Reads the block-style YAML subset that render() writes: nested maps, sequences at the parent key's indent,
// single-quoted or plain scalars, [] and {}.
function parseYaml(text) {
  const lines = text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => ({ ind: l.length - l.trimStart().length, t: l.trimStart() }));
  let i = 0;
  const unquote = (v) => v.slice(1, -1).replaceAll("''", "'");
  const KEY = /^('(?:[^']|'')*'|[^:' ][^:]*):(?: (.*))?$/;
  const value = (v) => {
    if (v.startsWith("'")) return unquote(v);
    if (v === "[]") return [];
    if (v === "{}") return {};
    if (v === "true" || v === "false") return v === "true";
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  };
  const isItem = (l) => l.t.startsWith("- ");
  function map(ind) {
    const o = {};
    while (i < lines.length && lines[i].ind === ind && !isItem(lines[i])) {
      const m = lines[i].t.match(KEY);
      assert.ok(m, `line ${i + 1}: ${lines[i].t}`);
      i++;
      const k = m[1].startsWith("'") ? unquote(m[1]) : m[1];
      if (m[2] !== undefined) o[k] = value(m[2]);
      else if (i < lines.length && lines[i].ind === ind && isItem(lines[i])) o[k] = seq(ind);
      else {
        assert.ok(i < lines.length && lines[i].ind > ind, `line ${i}: ${k} has a nested block`);
        o[k] = map(lines[i].ind);
      }
    }
    return o;
  }
  function seq(ind) {
    const a = [];
    while (i < lines.length && lines[i].ind === ind && isItem(lines[i])) {
      const rest = lines[i].t.slice(2);
      if (KEY.test(rest)) {
        lines[i] = { ind: ind + 2, t: rest };
        a.push(map(ind + 2));
      } else {
        i++;
        a.push(value(rest));
      }
    }
    return a;
  }
  const doc = map(0);
  assert.equal(i, lines.length, "whole document read");
  return doc;
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

test("catalog's deprecated endpoint stays deprecated, with the same sunset date, at every step", () => {
  assert.notEqual(`${DEPRECATED.method} ${DEPRECATED.path}`, `${WATCHED.catalog.method} ${WATCHED.catalog.path}`);
  for (let step = 1; step <= 4; step++) {
    const op = specFor(DEPRECATED.service, step).paths[DEPRECATED.path][DEPRECATED.method];
    assert.equal(op.deprecated, true, `step ${step}`);
    assert.equal(op["x-sunset"], DEPRECATED.sunset, `step ${step}`);
    assert.match(op["x-sunset"], /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("no other operation is deprecated", () => {
  for (const s of SERVICES) {
    for (let step = 1; step <= 4; step++) {
      for (const [path, item] of Object.entries(specFor(s, step).paths)) {
        for (const [method, op] of Object.entries(item)) {
          if (s === DEPRECATED.service && path === DEPRECATED.path && method === DEPRECATED.method) continue;
          assert.equal(op.deprecated, undefined, `${s} step ${step}: ${method} ${path}`);
          assert.equal(op["x-sunset"], undefined, `${s} step ${step}: ${method} ${path}`);
        }
      }
    }
  }
});

test("specFor rejects unknown service or step", () => {
  assert.throws(() => specFor("billing", 1));
  assert.throws(() => specFor("shipping", 5));
  assert.throws(() => specFor("catalog", 5));
  assert.throws(() => specFor("catalog", 0));
});
