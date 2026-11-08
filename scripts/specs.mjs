// Builds the OpenAPI documents of the two example services for each step of the change cycle.
//
// Steps (state.json holds the last applied one):
//   1  add an optional field to the watched endpoint's response   (non-breaking)
//   2  remove that field                                           (breaking)
//   3  remove the watched endpoint                                 (breaking)
//   4  restore the watched endpoint (this is the base document)    (non-breaking)

export const SERVICES = ["catalog", "orders"];

export const WATCHED = {
  catalog: { method: "get", path: "/products/{id}", schema: "ProductDetail", field: "warrantyMonths" },
  orders: { method: "get", path: "/orders/{id}", schema: "OrderDetail", field: "giftNote" },
};

const FIELDS = {
  catalog: { type: "integer", minimum: 0, description: "Warranty length in months." },
  orders: { type: "string", maxLength: 280, description: "Message printed on the packing slip." },
};

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const idParam = (description) => ({ name: "id", in: "path", required: true, description, schema: { type: "string" } });
const notFound = { description: "Not found" };

// Shared with orders, which keeps its own copy (no external refs).
const PRODUCT = {
  type: "object",
  required: ["id", "name", "price"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    price: ref("Money"),
    categoryId: { type: "string" },
  },
};

const MONEY = {
  type: "object",
  required: ["amount", "currency"],
  properties: {
    amount: { type: "string", description: "Decimal amount, e.g. \"19.90\"." },
    currency: { type: "string", description: "ISO 4217 code, e.g. \"EUR\"." },
  },
};

const BASE = {
  catalog: {
    openapi: "3.1.0",
    info: { title: "Catalog API", version: "1.0.0", description: "Products and categories. Example service for Graphwake (URL source)." },
    servers: [{ url: "https://api.example.com/catalog" }],
    paths: {
      "/products": {
        get: {
          operationId: "listProducts",
          summary: "List products",
          parameters: [{ name: "categoryId", in: "query", schema: { type: "string" } }],
          responses: { 200: json({ type: "array", items: ref("Product") }) },
        },
      },
      "/products/{id}": {
        get: {
          operationId: "getProduct",
          summary: "Get a product",
          parameters: [idParam("Product id")],
          responses: { 200: json(ref("ProductDetail")), 404: notFound },
        },
      },
      "/categories": {
        get: {
          operationId: "listCategories",
          summary: "List categories",
          responses: { 200: json({ type: "array", items: ref("Category") }) },
        },
      },
      "/categories/{id}": {
        get: {
          operationId: "getCategory",
          summary: "Get a category",
          parameters: [idParam("Category id")],
          responses: { 200: json(ref("Category")), 404: notFound },
        },
      },
    },
    components: {
      schemas: {
        Money: MONEY,
        Product: PRODUCT,
        ProductDetail: {
          type: "object",
          required: ["id", "name", "price", "stock"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            price: ref("Money"),
            category: ref("Category"),
            stock: { type: "integer", minimum: 0 },
          },
        },
        Category: {
          type: "object",
          required: ["id", "name"],
          properties: { id: { type: "string" }, name: { type: "string" } },
        },
      },
    },
  },
  orders: {
    openapi: "3.1.0",
    info: { title: "Orders API", version: "1.0.0", description: "Orders that use products from the Catalog API. Example service for Graphwake (CI source)." },
    servers: [{ url: "https://api.example.com/orders" }],
    paths: {
      "/orders": {
        get: {
          operationId: "listOrders",
          summary: "List orders",
          parameters: [{ name: "status", in: "query", schema: ref("OrderStatus") }],
          responses: { 200: json({ type: "array", items: ref("Order") }) },
        },
        post: {
          operationId: "createOrder",
          summary: "Create an order",
          requestBody: { required: true, content: { "application/json": { schema: ref("NewOrder") } } },
          responses: { 201: json(ref("Order"), "Created") },
        },
      },
      "/orders/{id}": {
        get: {
          operationId: "getOrder",
          summary: "Get an order",
          parameters: [idParam("Order id")],
          responses: { 200: json(ref("OrderDetail")), 404: notFound },
        },
      },
      "/orders/{id}/cancel": {
        post: {
          operationId: "cancelOrder",
          summary: "Cancel an order",
          parameters: [idParam("Order id")],
          responses: { 200: json(ref("Order")), 404: notFound, 409: { description: "Already shipped" } },
        },
      },
    },
    components: {
      schemas: {
        Money: MONEY,
        Product: PRODUCT,
        OrderStatus: { type: "string", enum: ["pending", "paid", "shipped", "cancelled"] },
        OrderLine: {
          type: "object",
          required: ["product", "quantity"],
          properties: { product: ref("Product"), quantity: { type: "integer", minimum: 1 } },
        },
        NewOrder: {
          type: "object",
          required: ["customerId", "lines"],
          properties: {
            customerId: { type: "string" },
            lines: { type: "array", minItems: 1, items: ref("OrderLine") },
          },
        },
        Order: {
          type: "object",
          required: ["id", "status", "total"],
          properties: { id: { type: "string" }, status: ref("OrderStatus"), total: ref("Money") },
        },
        OrderDetail: {
          type: "object",
          required: ["id", "customerId", "status", "lines", "total"],
          properties: {
            id: { type: "string" },
            customerId: { type: "string" },
            status: ref("OrderStatus"),
            lines: { type: "array", items: ref("OrderLine") },
            total: ref("Money"),
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
};

function check(service, step) {
  if (!SERVICES.includes(service)) throw new Error(`unknown service: ${service}`);
  if (!Number.isInteger(step) || step < 1 || step > 4) throw new Error(`unknown step: ${step}`);
}

export function specFor(service, step) {
  check(service, step);
  const spec = structuredClone(BASE[service]);
  const w = WATCHED[service];
  if (step === 1) {
    spec.components.schemas[w.schema].properties[w.field] = structuredClone(FIELDS[service]);
  } else if (step === 3) {
    delete spec.paths[w.path][w.method];
    if (Object.keys(spec.paths[w.path]).length === 0) delete spec.paths[w.path];
    delete spec.components.schemas[w.schema];
  }
  return spec;
}

export function describeStep(service, step) {
  check(service, step);
  const w = WATCHED[service];
  const endpoint = `${w.method.toUpperCase()} ${w.path}`;
  return {
    1: `${service}: add optional field ${w.schema}.${w.field} (non-breaking)`,
    2: `${service}: remove field ${w.schema}.${w.field} (breaking)`,
    3: `${service}: remove ${endpoint} (breaking)`,
    4: `${service}: restore ${endpoint} (non-breaking)`,
  }[step];
}
