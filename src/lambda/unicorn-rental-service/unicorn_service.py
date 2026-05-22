"""Unicorn Rental Service Lambda.

A pure business-logic service that handles unicorn rental operations.
This Lambda knows nothing about MCP — it accepts JSON requests and returns JSON responses.

Supported actions:
- list_unicorns: List available unicorns, optionally filtered by type.
- book_unicorn: Book a unicorn for a customer.
- view_bookings: View active rental for a customer.
- return_unicorn: Return a booked unicorn and calculate rental cost.

Request format:
{
    "action": "list_unicorns",
    "params": { "unicorn_type": "all" }
}

Response format:
{
    "success": true,
    "data": { ... }
}
or
{
    "success": false,
    "error": "Error message"
}
"""

import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Attr

UNICORNS_TABLE = os.environ.get("UNICORNS_TABLE", "unicorn-mcp-unicorns")
BOOKINGS_TABLE = os.environ.get("BOOKINGS_TABLE", "unicorn-mcp-bookings")

dynamodb = boto3.resource("dynamodb")
unicorns_table = dynamodb.Table(UNICORNS_TABLE)
bookings_table = dynamodb.Table(BOOKINGS_TABLE)


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj == int(obj) else float(obj)
        return super().default(obj)


def _decimal_to_native(obj):
    """Recursively convert DynamoDB Decimal values to float/int."""
    if isinstance(obj, list):
        return [_decimal_to_native(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: _decimal_to_native(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    return obj


def list_unicorns(params: dict) -> dict:
    """List available unicorns, optionally filtered by type."""
    unicorn_type = (params.get("unicorn_type") or "all").lower()

    if unicorn_type == "all":
        response = unicorns_table.scan()
    else:
        response = unicorns_table.scan(
            FilterExpression=Attr("type").eq(params.get("unicorn_type", ""))
        )

    results = _decimal_to_native(response.get("Items", []))
    return {
        "success": True,
        "data": {
            "unicorns": results,
            "total": len(results),
            "filter": params.get("unicorn_type", "all"),
        },
    }


def book_unicorn(params: dict) -> dict:
    """Book a unicorn for a customer."""
    unicorn_id = params.get("unicorn_id")
    customer_id = params.get("customer_id")

    if not unicorn_id:
        return {"success": False, "error": "unicorn_id is required."}
    if not customer_id:
        return {"success": False, "error": "Unable to identify customer. Please provide a customer_id."}

    # Check if customer already has an active booking
    existing = bookings_table.scan(
        FilterExpression=Attr("customer_id").eq(customer_id) & Attr("status").eq("booked")
    )
    if existing.get("Items"):
        return {"success": False, "error": "Customer already has a unicorn on hire. Return it before booking another."}

    # Fetch unicorn
    response = unicorns_table.get_item(Key={"unicorn_id": unicorn_id})
    unicorn = response.get("Item")
    if not unicorn:
        return {"success": False, "error": "Unicorn not found."}

    unicorn = _decimal_to_native(unicorn)
    if not unicorn["available"]:
        return {"success": False, "error": "Unicorn is not available for booking."}

    booking_id = f"BK-{uuid.uuid4().hex[:8].upper()}"
    booked_at = datetime.now(timezone.utc).isoformat()

    # Mark unicorn as unavailable
    unicorns_table.update_item(
        Key={"unicorn_id": unicorn_id},
        UpdateExpression="SET available = :val",
        ExpressionAttributeValues={":val": False},
    )

    booking = {
        "booking_id": booking_id,
        "unicorn_id": unicorn_id,
        "customer_id": customer_id,
        "hourly_rate": Decimal(str(unicorn["hourly_rate"])),
        "status": "booked",
        "booked_at": booked_at,
    }
    bookings_table.put_item(Item=booking)

    booking_response = _decimal_to_native(booking)
    booking_response["unicorn_name"] = unicorn["name"]

    return {"success": True, "data": booking_response}


def view_bookings(params: dict) -> dict:
    """View the customer's active unicorn rental with duration and running cost."""
    customer_id = params.get("customer_id")

    if not customer_id:
        return {"success": False, "error": "Unable to identify customer. Please provide a customer_id."}

    active = bookings_table.scan(
        FilterExpression=Attr("customer_id").eq(customer_id) & Attr("status").eq("booked")
    )
    items = active.get("Items", [])
    if not items:
        return {"success": True, "data": None, "message": "No active rentals found for this customer."}

    booking = _decimal_to_native(items[0])
    unicorn_id = booking["unicorn_id"]

    # Fetch unicorn details
    unicorn_resp = unicorns_table.get_item(Key={"unicorn_id": unicorn_id})
    unicorn = _decimal_to_native(unicorn_resp.get("Item", {}))
    unicorn_name = unicorn.get("name", unicorn_id)

    # Calculate duration and running cost
    now = datetime.now(timezone.utc)
    booked_at = datetime.fromisoformat(booking["booked_at"])
    duration_seconds = (now - booked_at).total_seconds()
    duration_hours = duration_seconds / 3600
    total_minutes = int(duration_seconds // 60)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    duration_display = f"{hours}h {minutes}m"
    cost_so_far = round(duration_hours * booking["hourly_rate"], 2)

    return {
        "success": True,
        "data": {
            "booking_id": booking["booking_id"],
            "unicorn_id": unicorn_id,
            "unicorn_name": unicorn_name,
            "customer_id": customer_id,
            "booked_at": booking["booked_at"],
            "duration": duration_display,
            "hourly_rate": booking["hourly_rate"],
            "cost_incurred": cost_so_far,
            "status": "booked",
        },
    }


def return_unicorn(params: dict) -> dict:
    """Return a booked unicorn. Calculates total rental cost based on duration."""
    customer_id = params.get("customer_id")

    if not customer_id:
        return {"success": False, "error": "Unable to identify customer. Please provide a customer_id."}

    # Find the active booking for this customer
    active = bookings_table.scan(
        FilterExpression=Attr("customer_id").eq(customer_id) & Attr("status").eq("booked")
    )
    items = active.get("Items", [])
    if not items:
        return {"success": True, "data": None, "message": "No unicorns currently hired by this customer."}

    booking = _decimal_to_native(items[0])
    booking_id = booking["booking_id"]

    returned_at = datetime.now(timezone.utc)
    booked_at = datetime.fromisoformat(booking["booked_at"])
    duration_seconds = (returned_at - booked_at).total_seconds()
    duration_hours = duration_seconds / 3600
    total_cost = round(duration_hours * booking["hourly_rate"], 2)

    # Format duration as "Xh Ym"
    total_minutes = int(duration_seconds // 60)
    hours = total_minutes // 60
    minutes = total_minutes % 60
    duration_display = f"{hours}h {minutes}m"

    returned_at_iso = returned_at.isoformat()

    # Update booking record
    bookings_table.update_item(
        Key={"booking_id": booking_id},
        UpdateExpression="SET #s = :status, returned_at = :returned_at, total_cost = :cost, duration_hours = :dur",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":status": "returned",
            ":returned_at": returned_at_iso,
            ":cost": Decimal(str(total_cost)),
            ":dur": Decimal(str(round(duration_hours, 4))),
        },
    )

    # Mark unicorn as available again
    unicorns_table.update_item(
        Key={"unicorn_id": booking["unicorn_id"]},
        UpdateExpression="SET available = :val",
        ExpressionAttributeValues={":val": True},
    )

    return {
        "success": True,
        "data": {
            "booking_id": booking_id,
            "unicorn_id": booking["unicorn_id"],
            "customer_id": booking["customer_id"],
            "booked_at": booking["booked_at"],
            "returned_at": returned_at_iso,
            "duration": duration_display,
            "hourly_rate": booking["hourly_rate"],
            "total_cost": total_cost,
            "status": "returned",
        },
    }


# Action dispatcher
ACTIONS = {
    "list_unicorns": list_unicorns,
    "book_unicorn": book_unicorn,
    "view_bookings": view_bookings,
    "return_unicorn": return_unicorn,
}


def lambda_handler(event, context):
    """Lambda entry point. Expects JSON with 'action' and 'params' fields."""
    # Support both direct invocation and API Gateway proxy format
    if isinstance(event, str):
        event = json.loads(event)

    if "body" in event:
        body = event["body"]
        if isinstance(body, str):
            body = json.loads(body)
        event = body

    action = event.get("action")
    params = event.get("params", {})

    if not action:
        return {
            "statusCode": 400,
            "body": json.dumps({"success": False, "error": "Missing 'action' field."}),
        }

    handler = ACTIONS.get(action)
    if not handler:
        return {
            "statusCode": 400,
            "body": json.dumps({"success": False, "error": f"Unknown action: {action}"}),
        }

    try:
        result = handler(params)
        return {
            "statusCode": 200,
            "body": json.dumps(result, cls=DecimalEncoder),
        }
    except Exception as e:
        print(f"Error handling action '{action}': {e}")
        return {
            "statusCode": 500,
            "body": json.dumps({"success": False, "error": f"Internal error: {str(e)}"}),
        }
