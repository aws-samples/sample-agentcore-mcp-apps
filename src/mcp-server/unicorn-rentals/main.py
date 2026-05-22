"""Unicorn Rental MCP Server.

A thin MCP protocol layer that delegates business logic to the Unicorn Service Lambda.
This demonstrates separation of concerns: MCP protocol handling vs. business logic.

The MCP server:
- Handles JSON-RPC/MCP protocol (tool definitions, resources, structured output)
- Resolves customer identity from ChatGPT context
- Invokes the Unicorn Service Lambda for actual business operations

The Unicorn Service Lambda:
- Implements pure business logic (list, book, view, return)
- Accesses DynamoDB directly
- Knows nothing about MCP

Tools:
- list_unicorns: List available unicorns, optionally filtered by type.
- book_unicorn: Book a unicorn for a customer.
- view_bookings: View active rental for a customer.
- return_unicorn: Return a booked unicorn and calculate rental cost.

Resources:
- ui://widget/unicorn-list.html
- ui://widget/booking-confirmation.html
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import boto3
import mcp.types as types
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.server import Context
from pydantic import Field
from starlette.middleware.cors import CORSMiddleware

WIDGET_DIR = Path(__file__).resolve().parent / "widgets"
PORT = int(os.environ.get("PORT", "8000"))

UNICORN_SERVICE_FUNCTION = os.environ.get("UNICORN_SERVICE_FUNCTION", "unicorn-mcp-service")

MIME_TYPE = "text/html;profile=mcp-app"
WIDGET_DOMAIN = "https://anycompany-unicorn-rentals.example.com"

# --- Lambda client for invoking the service ---

lambda_client = boto3.client("lambda")


def invoke_service(action: str, params: dict) -> dict:
    """Invoke the Unicorn Service Lambda and return the parsed response."""
    payload = json.dumps({"action": action, "params": params})
    response = lambda_client.invoke(
        FunctionName=UNICORN_SERVICE_FUNCTION,
        InvocationType="RequestResponse",
        Payload=payload.encode("utf-8"),
    )
    response_payload = json.loads(response["Payload"].read().decode("utf-8"))

    # The Lambda returns {"statusCode": ..., "body": "..."}
    if "body" in response_payload:
        return json.loads(response_payload["body"])
    return response_payload


# --- Widget loading ---


def load_widget(name: str) -> str:
    """Load a widget HTML file from the widgets directory."""
    widget_path = WIDGET_DIR / name
    if widget_path.exists():
        return widget_path.read_text(encoding="utf-8")
    return f"<html><body>Widget {name} not found</body></html>"


# --- MCP Server ---

mcp = FastMCP(
    name="unicorn-rentals",
    stateless_http=True,
    host="0.0.0.0",
    port=PORT,
)

# --- Resources (widget templates) ---

WIDGET_UI_META = {
    "ui": {
        "domain": WIDGET_DOMAIN,
        "csp": {
            "resourceDomains": ["https://*.cloudfront.net"],
        },
    },
}


@mcp.resource(
    "ui://widget/unicorn-list.html",
    name="unicorn-list-widget",
    description="Unicorn list widget template",
    mime_type=MIME_TYPE,
    meta=WIDGET_UI_META,
)
async def unicorn_list_widget() -> str:
    return load_widget("unicorn-list.html")


@mcp.resource(
    "ui://widget/booking-confirmation.html",
    name="booking-widget",
    description="Booking confirmation widget template",
    mime_type=MIME_TYPE,
    meta=WIDGET_UI_META,
)
async def booking_confirmation_widget() -> str:
    return load_widget("booking-confirmation.html")


# --- Tool metadata helpers ---


def _ui_meta(resource_uri: str) -> dict:
    """Build _meta dict pointing to the widget resource URI."""
    return {
        "openai/outputTemplate": resource_uri,
    }


def _resolve_customer_id(customer_id: str, ctx: Context) -> str:
    """Resolve customer ID from explicit param or ChatGPT context."""
    if customer_id:
        return customer_id
    if ctx:
        try:
            meta = ctx.request_context.meta
            if meta:
                return (meta.model_extra or {}).get("openai/subject", "")
        except (ValueError, AttributeError):
            pass
    return ""


# --- Tools ---


@mcp.tool(
    name="list_unicorns",
    description="List available unicorns for rental. Filter by type: Classic, Rainbow, or Winged.",
    meta={"ui": {"resourceUri": "ui://widget/unicorn-list.html"}},
)
async def list_unicorns(
    unicorn_type: str = Field(
        default="all",
        description="Filter by unicorn type: Classic, Rainbow, or Winged. Use 'all' for no filter.",
    ),
) -> types.CallToolResult:
    """List available unicorns for rental. Filter by type: Classic, Rainbow, or Winged."""
    result = invoke_service("list_unicorns", {"unicorn_type": unicorn_type})

    if not result.get("success"):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("error", "Unknown error"))],
            isError=True,
        )

    data = result["data"]
    return types.CallToolResult(
        content=[
            types.TextContent(type="text", text=f"Found {data['total']} unicorns.")
        ],
        structuredContent=data,
        _meta=_ui_meta("ui://widget/unicorn-list.html"),
        isError=False,
    )


@mcp.tool(
    name="book_unicorn",
    description="Book a unicorn for rental. Requires unicorn ID. The logged-in user is automatically identified — no need to provide a customer ID.",
    meta={"ui": {"resourceUri": "ui://widget/booking-confirmation.html"}},
)
async def book_unicorn(
    unicorn_id: str = Field(..., description="The ID of the unicorn to book."),
    customer_id: str = Field(
        default="",
        description="Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically.",
    ),
    ctx: Context = None,
) -> types.CallToolResult:
    """Book a unicorn for rental. Requires unicorn ID. Uses the logged-in user's ID as customer identity."""
    resolved_customer_id = _resolve_customer_id(customer_id, ctx)

    result = invoke_service("book_unicorn", {
        "unicorn_id": unicorn_id,
        "customer_id": resolved_customer_id,
    })

    if not result.get("success"):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("error", "Unknown error"))],
            isError=True,
        )

    data = result["data"]
    return types.CallToolResult(
        content=[
            types.TextContent(
                type="text",
                text=f"Booked! {data['unicorn_name']} for customer {data['customer_id']}. Booking ID: {data['booking_id']}",
            )
        ],
        structuredContent=data,
        _meta=_ui_meta("ui://widget/booking-confirmation.html"),
        isError=False,
    )


@mcp.tool(
    name="view_bookings",
    description="View the unicorn currently being rented by the customer. Shows duration and cost incurred so far.",
)
async def view_bookings(
    customer_id: str = Field(
        default="",
        description="Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically.",
    ),
    ctx: Context = None,
) -> types.CallToolResult:
    """View the customer's active unicorn rental with duration and running cost."""
    resolved_customer_id = _resolve_customer_id(customer_id, ctx)

    result = invoke_service("view_bookings", {"customer_id": resolved_customer_id})

    if not result.get("success"):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("error", "Unknown error"))],
            isError=True,
        )

    if result.get("data") is None:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("message", "No active rentals found."))],
            isError=False,
        )

    data = result["data"]
    return types.CallToolResult(
        content=[
            types.TextContent(
                type="text",
                text=f"Active rental: {data['unicorn_name']} (Booking {data['booking_id']}), {data['duration']}, ${data['cost_incurred']:.2f} incurred so far.",
            )
        ],
        structuredContent=data,
        isError=False,
    )


@mcp.tool(
    name="return_unicorn",
    description="Return a booked unicorn. The logged-in user is automatically identified. Calculates total rental cost based on duration and hourly rate.",
)
async def return_unicorn(
    customer_id: str = Field(
        default="",
        description="Optional customer ID. If omitted, the logged-in ChatGPT user's ID is used automatically.",
    ),
    ctx: Context = None,
) -> types.CallToolResult:
    """Return a booked unicorn. Uses the logged-in user's ID to find the active booking."""
    resolved_customer_id = _resolve_customer_id(customer_id, ctx)

    result = invoke_service("return_unicorn", {"customer_id": resolved_customer_id})

    if not result.get("success"):
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("error", "Unknown error"))],
            isError=True,
        )

    if result.get("data") is None:
        return types.CallToolResult(
            content=[types.TextContent(type="text", text=result.get("message", "No unicorns currently hired."))],
            isError=False,
        )

    data = result["data"]
    return types.CallToolResult(
        content=[
            types.TextContent(
                type="text",
                text=(
                    f"Returned! Booking {data['booking_id']}: "
                    f"{data['duration']} × ${data['hourly_rate']}/hr = ${data['total_cost']:.2f}"
                ),
            )
        ],
        structuredContent=data,
        isError=False,
    )


# --- Output Schemas (required by ChatGPT App) ---

_OUTPUT_SCHEMAS = {
    "list_unicorns": {
        "type": "object",
        "properties": {
            "unicorns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "unicorn_id": {"type": "string"},
                        "name": {"type": "string"},
                        "type": {"type": "string"},
                        "hourly_rate": {"type": "number"},
                        "available": {"type": "boolean"},
                        "description": {"type": "string"},
                    },
                },
            },
            "total": {"type": "integer"},
            "filter": {"type": "string"},
        },
        "required": ["unicorns", "total", "filter"],
    },
    "book_unicorn": {
        "type": "object",
        "properties": {
            "booking_id": {"type": "string"},
            "unicorn_id": {"type": "string"},
            "unicorn_name": {"type": "string"},
            "customer_id": {"type": "string"},
            "hourly_rate": {"type": "number"},
            "status": {"type": "string"},
            "booked_at": {"type": "string"},
        },
        "required": ["booking_id", "unicorn_id", "unicorn_name", "customer_id", "hourly_rate", "status", "booked_at"],
    },
    "return_unicorn": {
        "type": "object",
        "properties": {
            "booking_id": {"type": "string"},
            "unicorn_id": {"type": "string"},
            "customer_id": {"type": "string"},
            "booked_at": {"type": "string"},
            "returned_at": {"type": "string"},
            "duration": {"type": "string"},
            "hourly_rate": {"type": "number"},
            "total_cost": {"type": "number"},
            "status": {"type": "string"},
        },
        "required": ["booking_id", "unicorn_id", "customer_id", "booked_at", "returned_at", "duration", "hourly_rate", "total_cost", "status"],
    },
    "view_bookings": {
        "type": "object",
        "properties": {
            "booking_id": {"type": "string"},
            "unicorn_id": {"type": "string"},
            "unicorn_name": {"type": "string"},
            "customer_id": {"type": "string"},
            "booked_at": {"type": "string"},
            "duration": {"type": "string"},
            "hourly_rate": {"type": "number"},
            "cost_incurred": {"type": "number"},
            "status": {"type": "string"},
        },
        "required": ["booking_id", "unicorn_id", "unicorn_name", "customer_id", "booked_at", "duration", "hourly_rate", "cost_incurred", "status"],
    },
}

for tool_name, schema in _OUTPUT_SCHEMAS.items():
    _tool = mcp._tool_manager._tools.get(tool_name)
    if _tool:
        _tool.__dict__["output_schema"] = schema


if __name__ == "__main__":
    app = mcp.streamable_http_app()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
