"""Comprehensive unit tests for the AnyCompany Unicorn Rental MCP Server."""

import json
import pytest

from mcp.types import TextContent

from mcp_server import (
    BOOKINGS,
    UNICORNS,
    _tool_result,
    book_unicorn,
    check_availability,
    list_unicorns,
)


# ---------------------------------------------------------------------------
# Helper to parse the JSON payload embedded in a TextContent result
# ---------------------------------------------------------------------------

def _parse_result(result: list[TextContent]) -> dict:
    """Parse the JSON body from the first TextContent item."""
    assert len(result) == 1
    assert isinstance(result[0], TextContent)
    return json.loads(result[0].text)


# ===========================================================================
# _tool_result helper
# ===========================================================================

class TestToolResult:
    def test_returns_text_content_list(self):
        result = _tool_result({"key": "value"}, "some text", {"m": 1})
        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], TextContent)
        assert result[0].type == "text"

    def test_contains_structured_content_and_meta(self):
        sc = {"unicorns": []}
        meta = {"openai/outputTemplate": "http://example.com/widget.html"}
        result = _tool_result(sc, "hello", meta)
        payload = json.loads(result[0].text)
        assert "structuredContent" in payload
        assert "_meta" in payload
        assert payload["structuredContent"] == sc
        assert payload["_meta"] == meta


# ===========================================================================
# list_unicorns
# ===========================================================================

class TestListUnicorns:
    def test_returns_all_six_unicorns_when_type_is_all(self):
        result = list_unicorns("all")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 6
        assert len(payload["structuredContent"]["unicorns"]) == 6

    def test_default_parameter_returns_all(self):
        result = list_unicorns()
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 6

    def test_filter_classic_returns_two(self):
        result = list_unicorns("Classic")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 2
        for u in payload["structuredContent"]["unicorns"]:
            assert u["type"] == "Classic"

    def test_filter_rainbow_returns_two(self):
        result = list_unicorns("Rainbow")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 2
        for u in payload["structuredContent"]["unicorns"]:
            assert u["type"] == "Rainbow"

    def test_filter_winged_returns_two(self):
        result = list_unicorns("Winged")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 2
        for u in payload["structuredContent"]["unicorns"]:
            assert u["type"] == "Winged"

    def test_filter_is_case_insensitive(self):
        result = list_unicorns("classic")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 2

    def test_returns_structured_content_format(self):
        result = list_unicorns("all")
        payload = _parse_result(result)
        sc = payload["structuredContent"]
        assert "unicorns" in sc
        assert "total" in sc
        assert "filter" in sc
        assert sc["filter"] == "all"

    def test_returns_meta_with_output_template_url(self):
        result = list_unicorns("all")
        payload = _parse_result(result)
        meta = payload["_meta"]
        assert "openai/outputTemplate" in meta
        assert meta["openai/outputTemplate"].endswith("/unicorn-list.html")

    def test_unknown_type_returns_zero(self):
        result = list_unicorns("Dragon")
        payload = _parse_result(result)
        assert payload["structuredContent"]["total"] == 0
        assert payload["structuredContent"]["unicorns"] == []


# ===========================================================================
# check_availability
# ===========================================================================

class TestCheckAvailability:
    def test_valid_unicorn_returns_availability(self):
        result = check_availability("uc-001", "2026-05-01", 2)
        payload = _parse_result(result)
        sc = payload["structuredContent"]
        assert sc["unicorn"]["unicorn_id"] == "uc-001"
        assert sc["date"] == "2026-05-01"
        assert sc["duration_hours"] == 2
        assert sc["available"] is True

    def test_returns_not_found_for_invalid_id(self):
        result = check_availability("uc-999", "2026-05-01", 1)
        assert len(result) == 1
        assert result[0].text == "Unicorn not found."

    def test_rejects_duration_over_24_hours(self):
        result = check_availability("uc-001", "2026-05-01", 25)
        assert len(result) == 1
        assert result[0].text == "Maximum rental period is 24 hours."

    def test_calculates_total_cost_correctly(self):
        # uc-001 Stardust has hourly_rate 75.00
        result = check_availability("uc-001", "2026-05-01", 3)
        payload = _parse_result(result)
        assert payload["structuredContent"]["total_cost"] == 75.00 * 3

    def test_unavailable_unicorn_shows_not_available(self):
        # uc-004 Aurora is unavailable
        result = check_availability("uc-004", "2026-05-01", 1)
        payload = _parse_result(result)
        assert payload["structuredContent"]["available"] is False

    def test_returns_meta_with_availability_url(self):
        result = check_availability("uc-001", "2026-05-01", 1)
        payload = _parse_result(result)
        assert payload["_meta"]["openai/outputTemplate"].endswith("/availability.html")

    def test_exactly_24_hours_is_allowed(self):
        result = check_availability("uc-001", "2026-05-01", 24)
        payload = _parse_result(result)
        assert payload["structuredContent"]["duration_hours"] == 24


# ===========================================================================
# book_unicorn
# ===========================================================================

class TestBookUnicorn:
    def setup_method(self):
        """Clear bookings before each test."""
        BOOKINGS.clear()

    def test_creates_booking_successfully(self):
        result = book_unicorn("uc-001", "Alice", "2026-05-01", 2)
        payload = _parse_result(result)
        sc = payload["structuredContent"]
        assert sc["status"] == "confirmed"
        assert sc["customer_name"] == "Alice"
        assert sc["unicorn"]["unicorn_id"] == "uc-001"
        assert sc["duration_hours"] == 2
        assert sc["booking_id"].startswith("BK-")

    def test_booking_stored_in_bookings_dict(self):
        book_unicorn("uc-001", "Bob", "2026-05-01", 1)
        assert len(BOOKINGS) == 1
        booking = list(BOOKINGS.values())[0]
        assert booking["customer_name"] == "Bob"

    def test_returns_not_found_for_invalid_id(self):
        result = book_unicorn("uc-999", "Alice", "2026-05-01", 1)
        assert len(result) == 1
        assert result[0].text == "Unicorn not found."

    def test_rejects_unavailable_unicorn(self):
        # uc-004 Aurora has available=False
        result = book_unicorn("uc-004", "Alice", "2026-05-01", 1)
        assert len(result) == 1
        assert "Cannot book" in result[0].text

    def test_rejects_duration_over_24_hours(self):
        result = book_unicorn("uc-001", "Alice", "2026-05-01", 25)
        assert len(result) == 1
        assert "Cannot book" in result[0].text

    def test_calculates_total_cost(self):
        # uc-005 Zephyr: hourly_rate 200.00
        result = book_unicorn("uc-005", "Alice", "2026-05-01", 3)
        payload = _parse_result(result)
        assert payload["structuredContent"]["total_cost"] == 200.00 * 3

    def test_returns_meta_with_booking_confirmation_url(self):
        result = book_unicorn("uc-001", "Alice", "2026-05-01", 1)
        payload = _parse_result(result)
        assert payload["_meta"]["openai/outputTemplate"].endswith("/booking-confirmation.html")

    def test_booking_id_is_unique(self):
        book_unicorn("uc-001", "Alice", "2026-05-01", 1)
        book_unicorn("uc-002", "Bob", "2026-05-02", 1)
        ids = list(BOOKINGS.keys())
        assert len(ids) == 2
        assert ids[0] != ids[1]
