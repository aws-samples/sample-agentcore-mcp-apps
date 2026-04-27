"""AnyCompany Unicorn Rental MCP Server on AgentCore Runtime.

Uses low-level MCP server API to return structuredContent and _meta
as top-level fields in tool results (required for ChatGPT Apps widgets).
"""

import json
import uuid
import os
from datetime import datetime

from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

WIDGET_BASE_URL = os.environ.get("WIDGET_BASE_URL", "http://localhost:8080")

mcp = FastMCP(
    "anycompany-unicorn-rental",
    stateless_http=True,
    host="0.0.0.0",
    port=8000,
)

UNICORNS = [
    {"unicorn_id": "uc-001", "name": "Stardust", "type": "Classic", "description": "A gentle, silver-maned unicorn perfect for beginners.", "hourly_rate": 75.00, "image_url": f"{WIDGET_BASE_URL}/images/stardust.png", "available": True},
    {"unicorn_id": "uc-002", "name": "Moonbeam", "type": "Classic", "description": "An elegant white unicorn with a pearlescent horn.", "hourly_rate": 85.00, "image_url": f"{WIDGET_BASE_URL}/images/moonbeam.png", "available": True},
    {"unicorn_id": "uc-003", "name": "Prism", "type": "Rainbow", "description": "A dazzling rainbow-maned unicorn that shimmers in sunlight.", "hourly_rate": 120.00, "image_url": f"{WIDGET_BASE_URL}/images/prism.png", "available": True},
    {"unicorn_id": "uc-004", "name": "Aurora", "type": "Rainbow", "description": "A majestic unicorn with aurora-colored flowing mane.", "hourly_rate": 130.00, "image_url": f"{WIDGET_BASE_URL}/images/aurora.png", "available": False},
    {"unicorn_id": "uc-005", "name": "Zephyr", "type": "Winged", "description": "A rare winged unicorn capable of short flights.", "hourly_rate": 200.00, "image_url": f"{WIDGET_BASE_URL}/images/zephyr.png", "available": True},
    {"unicorn_id": "uc-006", "name": "Tempest", "type": "Winged", "description": "A powerful winged unicorn with storm-grey coat.", "hourly_rate": 250.00, "image_url": f"{WIDGET_BASE_URL}/images/tempest.png", "available": True},
]

BOOKINGS = {}


def _tool_result(structured_content: dict, text: str, meta: dict) -> list[TextContent]:
    """Return tool result with structuredContent and _meta embedded in text content.

    ChatGPT Apps expect structuredContent (data for widgets) and _meta
    (with openai/outputTemplate pointing to the widget HTML URL).
    """
    full_response = {
        "structuredContent": structured_content,
        "_meta": meta,
    }
    return [TextContent(type="text", text=json.dumps(full_response, indent=2))]


@mcp.tool()
def list_unicorns(unicorn_type: str = "all") -> list[TextContent]:
    """List available unicorns for rental. Filter by type: Classic, Rainbow, or Winged."""
    results = UNICORNS if unicorn_type.lower() == "all" else [u for u in UNICORNS if u["type"].lower() == unicorn_type.lower()]
    return _tool_result(
        structured_content={"unicorns": results, "total": len(results), "filter": unicorn_type},
        text=f"Found {len(results)} unicorns.",
        meta={"openai/outputTemplate": f"{WIDGET_BASE_URL}/unicorn-list.html"},
    )


@mcp.tool()
def check_availability(unicorn_id: str, date: str, duration_hours: int = 1) -> list[TextContent]:
    """Check if a unicorn is available for rental on a given date. Max 24 hours."""
    unicorn = next((u for u in UNICORNS if u["unicorn_id"] == unicorn_id), None)
    if not unicorn:
        return [TextContent(type="text", text="Unicorn not found.")]
    if duration_hours > 24:
        return [TextContent(type="text", text="Maximum rental period is 24 hours.")]
    total_cost = unicorn["hourly_rate"] * duration_hours
    return _tool_result(
        structured_content={"unicorn": unicorn, "date": date, "duration_hours": duration_hours, "available": unicorn["available"], "total_cost": total_cost},
        text=f"{'Available' if unicorn['available'] else 'Not available'}: {unicorn['name']} - ${total_cost:.2f}",
        meta={"openai/outputTemplate": f"{WIDGET_BASE_URL}/availability.html"},
    )


@mcp.tool()
def book_unicorn(unicorn_id: str, customer_name: str, date: str, duration_hours: int = 1) -> list[TextContent]:
    """Book a unicorn for rental. Requires unicorn ID, customer name, date, and duration (max 24h)."""
    unicorn = next((u for u in UNICORNS if u["unicorn_id"] == unicorn_id), None)
    if not unicorn:
        return [TextContent(type="text", text="Unicorn not found.")]
    if duration_hours > 24 or not unicorn["available"]:
        return [TextContent(type="text", text="Cannot book - unavailable or exceeds 24h limit.")]
    booking_id = f"BK-{uuid.uuid4().hex[:8].upper()}"
    total_cost = unicorn["hourly_rate"] * duration_hours
    booking = {"booking_id": booking_id, "unicorn": unicorn, "customer_name": customer_name, "date": date, "duration_hours": duration_hours, "total_cost": total_cost, "status": "confirmed", "booked_at": datetime.utcnow().isoformat()}
    BOOKINGS[booking_id] = booking
    return _tool_result(
        structured_content=booking,
        text=f"Booked! {unicorn['name']} for {customer_name}, ${total_cost:.2f}. ID: {booking_id}",
        meta={"openai/outputTemplate": f"{WIDGET_BASE_URL}/booking-confirmation.html"},
    )


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
