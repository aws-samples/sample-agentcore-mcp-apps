/**
 * Output schemas for MCP tools.
 * Required by ChatGPT App to understand the structured content format.
 */

export const outputSchemas = {
  list_unicorns: {
    type: "object" as const,
    properties: {
      unicorns: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            unicorn_id: { type: "string" as const },
            name: { type: "string" as const },
            type: { type: "string" as const },
            hourly_rate: { type: "number" as const },
            available: { type: "boolean" as const },
            description: { type: "string" as const },
          },
        },
      },
      total: { type: "integer" as const },
      filter: { type: "string" as const },
    },
    required: ["unicorns", "total", "filter"],
  },

  book_unicorn: {
    type: "object" as const,
    properties: {
      booking_id: { type: "string" as const },
      unicorn_id: { type: "string" as const },
      unicorn_name: { type: "string" as const },
      customer_id: { type: "string" as const },
      hourly_rate: { type: "number" as const },
      status: { type: "string" as const },
      booked_at: { type: "string" as const },
    },
    required: [
      "booking_id",
      "unicorn_id",
      "unicorn_name",
      "customer_id",
      "hourly_rate",
      "status",
      "booked_at",
    ],
  },

  view_bookings: {
    type: "object" as const,
    properties: {
      booking_id: { type: "string" as const },
      unicorn_name: { type: "string" as const },
      customer_id: { type: "string" as const },
      booked_at: { type: "string" as const },
      duration: { type: "string" as const },
      hourly_rate: { type: "number" as const },
      cost_incurred: { type: "number" as const },
      status: { type: "string" as const },
    },
    required: [
      "booking_id",
      "unicorn_name",
      "customer_id",
      "booked_at",
      "duration",
      "hourly_rate",
      "cost_incurred",
      "status",
    ],
  },

  return_unicorn: {
    type: "object" as const,
    properties: {
      booking_id: { type: "string" as const },
      unicorn_name: { type: "string" as const },
      customer_id: { type: "string" as const },
      booked_at: { type: "string" as const },
      returned_at: { type: "string" as const },
      duration: { type: "string" as const },
      hourly_rate: { type: "number" as const },
      total_cost: { type: "number" as const },
      status: { type: "string" as const },
    },
    required: [
      "booking_id",
      "unicorn_name",
      "customer_id",
      "booked_at",
      "returned_at",
      "duration",
      "hourly_rate",
      "total_cost",
      "status",
    ],
  },
};
