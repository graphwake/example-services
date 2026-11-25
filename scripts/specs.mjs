// Builds the API documents of the four example services for each step of the change cycle.
// catalog and orders are OpenAPI 3.1. inventory and shipping are Swagger 2.0, in the shapes .NET Swashbuckle (JSON) and
// Go swag (YAML) emit, so they use `definitions` and `#/definitions/` refs instead of `components`.
//
// Steps (state.json holds the last applied one):
//   1  add an optional field to the watched endpoint's response   (non-breaking)
//   2  remove that field                                           (breaking)
//   3  remove the watched endpoint                                 (breaking)
//   4  restore the watched endpoint (this is the base document)    (non-breaking)

export const SERVICES = ["catalog", "orders", "inventory", "shipping"];

// The file each service's document is written to, under services/<name>/. The extension picks JSON or YAML.
export const FILES = {
  catalog: "openapi.json",
  orders: "openapi.json",
  inventory: "swagger.json",
  shipping: "swagger.yaml",
};

export const WATCHED = {
  catalog: { method: "get", path: "/products/{id}", schema: "ProductDetail", field: "warrantyMonths" },
  orders: { method: "get", path: "/orders/{id}", schema: "OrderDetail", field: "giftNote" },
  inventory: { method: "get", path: "/items/{sku}", schema: "ItemDetail", field: "binLocation" },
  shipping: { method: "get", path: "/shipments/{id}", schema: "models.ShipmentDetail", field: "carrierNote" },
};

// A fixed endpoint that stays deprecated through the whole cycle.
export const DEPRECATED = { service: "catalog", method: "get", path: "/categories/{id}", sunset: "2026-12-01" };

const FIELDS = {
  catalog: { type: "integer", minimum: 0, description: "Warranty length in months." },
  orders: { type: "string", maxLength: 280, description: "Message printed on the packing slip." },
  inventory: { type: "string", description: "Shelf position in the warehouse, for example A-12-3." },
  shipping: { type: "string", description: "Free-text note from the carrier", example: "Leave at the front desk" },
};

// The schemas of a document: `components.schemas` in OpenAPI 3, `definitions` in Swagger 2.0.
export const schemasOf = (spec) => (spec.swagger ? spec.definitions : spec.components.schemas);

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const idParam = (description) => ({ name: "id", in: "path", required: true, description, schema: { type: "string" } });
const notFound = { description: "Not found" };
const dref = (name) => ({ $ref: `#/definitions/${name}` });
const skuParam = { name: "sku", in: "path", required: true, type: "string" };

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
      // Deprecated at every step, with a fixed sunset date: the Graphwake team's watch on its deprecation and sunset
      // notices (the reminders before the date, then a weekly message while it stays in the spec).
      "/categories/{id}": {
        get: {
          operationId: "getCategory",
          summary: "Get a category",
          deprecated: true,
          "x-sunset": DEPRECATED.sunset,
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
  // Swagger 2.0 JSON as older .NET Swashbuckle emits it: host, basePath and schemes, global consumes/produces,
  // body parameters with a schema, typed path parameters.
  inventory: {
    swagger: "2.0",
    info: { version: "v1", title: "Inventory API", description: "Stock levels per item. Example service for Graphwake (CI source, Swagger 2.0)." },
    host: "api.example.com",
    basePath: "/inventory",
    schemes: ["https"],
    consumes: ["application/json"],
    produces: ["application/json"],
    paths: {
      "/items": {
        get: {
          tags: ["Items"],
          summary: "List items",
          operationId: "Items_List",
          parameters: [{ name: "warehouseId", in: "query", required: false, type: "string" }],
          responses: { 200: { description: "Success", schema: { type: "array", items: dref("Item") } } },
        },
        post: {
          tags: ["Items"],
          summary: "Create an item",
          operationId: "Items_Create",
          parameters: [{ name: "item", in: "body", required: true, schema: dref("NewItem") }],
          responses: { 201: { description: "Created", schema: dref("Item") }, 400: { description: "Bad Request" } },
        },
      },
      "/items/{sku}": {
        get: {
          tags: ["Items"],
          summary: "Get an item",
          operationId: "Items_GetBySku",
          parameters: [skuParam],
          responses: { 200: { description: "Success", schema: dref("ItemDetail") }, 404: { description: "Not Found" } },
        },
      },
      "/items/{sku}/stock": {
        put: {
          tags: ["Items"],
          summary: "Set the stock of an item",
          operationId: "Items_UpdateStock",
          parameters: [skuParam, { name: "update", in: "body", required: true, schema: dref("StockUpdate") }],
          responses: { 200: { description: "Success", schema: dref("Item") }, 404: { description: "Not Found" } },
        },
      },
    },
    definitions: {
      Item: {
        type: "object",
        required: ["sku", "name", "quantityOnHand"],
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          quantityOnHand: { format: "int32", type: "integer" },
        },
      },
      NewItem: {
        type: "object",
        required: ["sku", "name"],
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          warehouseId: { type: "string" },
        },
      },
      ItemDetail: {
        type: "object",
        required: ["sku", "name", "quantityOnHand", "warehouseId"],
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          quantityOnHand: { format: "int32", type: "integer" },
          reorderLevel: { format: "int32", type: "integer" },
          warehouseId: { type: "string" },
          updatedAt: { format: "date-time", type: "string" },
        },
      },
      StockUpdate: {
        type: "object",
        required: ["quantityOnHand"],
        properties: { quantityOnHand: { format: "int32", minimum: 0, type: "integer" } },
      },
    },
  },
  // Swagger 2.0 YAML as Go swag emits it: basePath with no host (so the server is relative), produces per operation,
  // definitions named <package>.<Type>.
  shipping: {
    swagger: "2.0",
    info: {
      description: "Shipments and their tracking events. Example service for Graphwake (URL source, Swagger 2.0).",
      title: "Shipping API",
      contact: {},
      version: "1.0",
    },
    basePath: "/shipping/v1",
    paths: {
      "/shipments": {
        get: {
          description: "List shipments, newest first",
          produces: ["application/json"],
          tags: ["shipments"],
          summary: "List shipments",
          parameters: [{ type: "string", description: "Filter by status", name: "status", in: "query" }],
          responses: { 200: { description: "OK", schema: { type: "array", items: dref("models.Shipment") } } },
        },
        post: {
          description: "Create a shipment for an order",
          consumes: ["application/json"],
          produces: ["application/json"],
          tags: ["shipments"],
          summary: "Create a shipment",
          parameters: [{ description: "Shipment to create", name: "shipment", in: "body", required: true, schema: dref("models.NewShipment") }],
          responses: {
            201: { description: "Created", schema: dref("models.Shipment") },
            400: { description: "Bad Request", schema: dref("httputil.HTTPError") },
          },
        },
      },
      "/shipments/{id}": {
        get: {
          description: "Get a shipment by id",
          produces: ["application/json"],
          tags: ["shipments"],
          summary: "Get a shipment",
          parameters: [{ type: "string", description: "Shipment id", name: "id", in: "path", required: true }],
          responses: {
            200: { description: "OK", schema: dref("models.ShipmentDetail") },
            404: { description: "Not Found", schema: dref("httputil.HTTPError") },
          },
        },
      },
      "/shipments/{id}/tracking": {
        get: {
          description: "Tracking events of a shipment, oldest first",
          produces: ["application/json"],
          tags: ["shipments"],
          summary: "Get tracking events",
          parameters: [{ type: "string", description: "Shipment id", name: "id", in: "path", required: true }],
          responses: {
            200: { description: "OK", schema: { type: "array", items: dref("models.TrackingEvent") } },
            404: { description: "Not Found", schema: dref("httputil.HTTPError") },
          },
        },
      },
    },
    definitions: {
      "httputil.HTTPError": {
        type: "object",
        properties: {
          code: { type: "integer", example: 400 },
          message: { type: "string", example: "status bad request" },
        },
      },
      "models.NewShipment": {
        type: "object",
        required: ["orderId", "carrier"],
        properties: { carrier: { type: "string", example: "dhl" }, orderId: { type: "string" } },
      },
      "models.Shipment": {
        type: "object",
        properties: { id: { type: "string" }, orderId: { type: "string" }, status: dref("models.ShipmentStatus") },
      },
      "models.ShipmentDetail": {
        type: "object",
        properties: {
          carrier: { type: "string" },
          events: { type: "array", items: dref("models.TrackingEvent") },
          id: { type: "string" },
          orderId: { type: "string" },
          shippedAt: { type: "string" },
          status: dref("models.ShipmentStatus"),
        },
      },
      "models.ShipmentStatus": { type: "string", enum: ["created", "in_transit", "delivered"] },
      "models.TrackingEvent": {
        type: "object",
        properties: { at: { type: "string" }, location: { type: "string" }, status: { type: "string" } },
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
    schemasOf(spec)[w.schema].properties[w.field] = structuredClone(FIELDS[service]);
  } else if (step === 3) {
    delete spec.paths[w.path][w.method];
    if (Object.keys(spec.paths[w.path]).length === 0) delete spec.paths[w.path];
    delete schemasOf(spec)[w.schema];
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
