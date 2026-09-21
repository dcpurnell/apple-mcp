#!/usr/bin/env python3
"""
Reminders EventKit Bridge for apple-mcp
Uses native macOS EventKit framework (much faster than AppleScript, which takes
45-120s per operation against the Reminders app).
Requires: pip3 install pyobjc-framework-EventKit
"""

import sys
import json
import threading
from datetime import datetime

import EventKit
from Foundation import NSCalendar, NSDateComponents

# EKAuthorizationStatus values. macOS 14 added FullAccess (3) / WriteOnly (4);
# the legacy Authorized constant is also 3, so a single check covers both.
STATUS_NOT_DETERMINED = 0
STATUS_RESTRICTED = 1
STATUS_DENIED = 2
STATUS_FULL_ACCESS = 3

DEFAULT_FETCH_TIMEOUT = 20.0
MAX_REMINDERS = 500


class AccessDenied(Exception):
    pass


def ensure_access(store, timeout=30.0):
    """Ensure we hold read/write access to Reminders, prompting once if needed."""
    status = EventKit.EKEventStore.authorizationStatusForEntityType_(
        EventKit.EKEntityTypeReminder
    )

    if status == STATUS_FULL_ACCESS:
        return
    if status in (STATUS_RESTRICTED, STATUS_DENIED):
        raise AccessDenied(
            "Reminders access denied. Grant permission in "
            "System Settings > Privacy & Security > Reminders"
        )

    granted = {}
    done = threading.Event()

    def completion(ok, err):
        granted["ok"] = bool(ok)
        done.set()

    if hasattr(store, "requestFullAccessToRemindersWithCompletion_"):
        store.requestFullAccessToRemindersWithCompletion_(completion)
    else:
        store.requestAccessToEntityType_completion_(
            EventKit.EKEntityTypeReminder, completion
        )

    if not done.wait(timeout):
        raise AccessDenied("Timed out waiting for the Reminders permission prompt")
    if not granted.get("ok"):
        raise AccessDenied(
            "Reminders access denied. Grant permission in "
            "System Settings > Privacy & Security > Reminders"
        )


def fetch_reminders(store, predicate, timeout=DEFAULT_FETCH_TIMEOUT):
    """fetchRemindersMatchingPredicate is async; block until its completion fires."""
    result = {}
    done = threading.Event()

    def completion(reminders):
        result["reminders"] = reminders
        done.set()

    store.fetchRemindersMatchingPredicate_completion_(predicate, completion)

    if not done.wait(timeout):
        raise RuntimeError(f"Timed out fetching reminders after {timeout}s")

    return list(result.get("reminders") or [])


def get_lists(store, list_names=None):
    """Return reminder lists (EKCalendar), optionally filtered by exact name."""
    all_lists = store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)
    if list_names:
        wanted = {n.lower() for n in list_names}
        return [c for c in all_lists if c.title().lower() in wanted]
    return list(all_lists)


def find_list(store, name):
    """Resolve a list by exact name first, then unique case-insensitive substring."""
    all_lists = store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)

    for cal in all_lists:
        if cal.title() == name:
            return cal

    lowered = name.lower()
    exact_ci = [c for c in all_lists if c.title().lower() == lowered]
    if exact_ci:
        return exact_ci[0]

    partial = [c for c in all_lists if lowered in c.title().lower()]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        names = ", ".join(sorted(c.title() for c in partial))
        raise ValueError(
            f'List name "{name}" is ambiguous; it matches: {names}'
        )
    return None


def has_exact_list(store, name):
    """True when a list is titled exactly `name` (case-insensitive)."""
    lowered = name.lower()
    return any(
        c.title().lower() == lowered
        for c in store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)
    )


def find_list_by_id(store, list_id):
    for cal in store.calendarsForEntityType_(EventKit.EKEntityTypeReminder):
        if cal.calendarIdentifier() == list_id:
            return cal
    return None


def nsdate_to_iso(nsdate):
    if nsdate is None:
        return None
    try:
        return datetime.fromtimestamp(nsdate.timeIntervalSince1970()).isoformat()
    except Exception:
        return None


def due_date_to_iso(reminder):
    comps = reminder.dueDateComponents()
    if comps is None:
        return None
    date = NSCalendar.currentCalendar().dateFromComponents_(comps)
    return nsdate_to_iso(date)


def parse_iso(value):
    """Parse an ISO-8601 string into a naive local datetime."""
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f'Invalid due date "{value}"; expected an ISO-8601 date string')
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def iso_to_components(value):
    dt = parse_iso(value)
    comps = NSDateComponents.alloc().init()
    comps.setYear_(dt.year)
    comps.setMonth_(dt.month)
    comps.setDay_(dt.day)
    comps.setHour_(dt.hour)
    comps.setMinute_(dt.minute)
    comps.setSecond_(dt.second)
    return comps


def serialize(reminder):
    return {
        "id": reminder.calendarItemIdentifier(),
        "name": reminder.title() or "Untitled",
        "body": reminder.notes() or "",
        "completed": bool(reminder.isCompleted()),
        "dueDate": due_date_to_iso(reminder),
        "completionDate": nsdate_to_iso(reminder.completionDate()),
        "creationDate": nsdate_to_iso(reminder.creationDate()),
        "modificationDate": nsdate_to_iso(reminder.lastModifiedDate()),
        "listName": reminder.calendar().title(),
        "listId": reminder.calendar().calendarIdentifier(),
        "priority": int(reminder.priority() or 0),
    }


def collect(store, calendars, include_completed, limit):
    """Fetch reminders for the given lists, newest-relevant first, capped at limit."""
    if not calendars:
        return []

    predicate = store.predicateForRemindersInCalendars_(calendars)
    reminders = fetch_reminders(store, predicate)

    if not include_completed:
        reminders = [r for r in reminders if not r.isCompleted()]

    return [serialize(r) for r in reminders[:limit]]


def create_reminder(store, payload):
    name = (payload.get("name") or "").strip()
    if not name:
        raise ValueError("Reminder name is required")

    list_name = payload.get("listName")
    if list_name:
        calendar = find_list(store, list_name)
        if calendar is None:
            available = ", ".join(
                c.title() for c in store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)
            )
            raise ValueError(
                f'List "{list_name}" not found. Available lists: {available}'
            )
    else:
        calendar = store.defaultCalendarForNewReminders()
        if calendar is None:
            raise ValueError("No default Reminders list is configured on this Mac")

    reminder = EventKit.EKReminder.reminderWithEventStore_(store)
    reminder.setTitle_(name)
    reminder.setCalendar_(calendar)

    notes = payload.get("notes")
    if notes:
        reminder.setNotes_(notes)

    due_date = payload.get("dueDate")
    if due_date:
        reminder.setDueDateComponents_(iso_to_components(due_date))

    priority = payload.get("priority")
    if priority is not None:
        reminder.setPriority_(int(priority))

    ok, err = store.saveReminder_commit_error_(reminder, True, None)
    if not ok:
        message = err.localizedDescription() if err is not None else "unknown error"
        raise RuntimeError(f"Failed to save reminder: {message}")

    return serialize(reminder)


def ensure_list(store, name):
    """Return the list named `name`, creating it in the default source if absent."""
    existing = find_list(store, name)
    if existing is not None:
        return existing

    calendar = EventKit.EKCalendar.calendarForEntityType_eventStore_(
        EventKit.EKEntityTypeReminder, store
    )
    calendar.setTitle_(name)

    source = None
    default_list = store.defaultCalendarForNewReminders()
    if default_list is not None:
        source = default_list.source()
    if source is None:
        for candidate in store.sources():
            if candidate.sourceType() in (
                EventKit.EKSourceTypeCalDAV,
                EventKit.EKSourceTypeLocal,
            ):
                source = candidate
                break
    if source is None:
        raise RuntimeError("No writable Reminders source available")

    calendar.setSource_(source)

    ok, err = store.saveCalendar_commit_error_(calendar, True, None)
    if not ok:
        message = err.localizedDescription() if err is not None else "unknown error"
        raise RuntimeError(f"Failed to create list: {message}")

    return calendar


def delete_reminder(store, reminder_id):
    predicate = store.predicateForRemindersInCalendars_(
        store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)
    )
    for reminder in fetch_reminders(store, predicate):
        if reminder.calendarItemIdentifier() == reminder_id:
            ok, err = store.removeReminder_commit_error_(reminder, True, None)
            if not ok:
                message = err.localizedDescription() if err is not None else "unknown error"
                raise RuntimeError(f"Failed to delete reminder: {message}")
            return True
    return False


def main():
    if len(sys.argv) < 2:
        print(json.dumps({
            "error": "Usage: python3 reminders-eventkit.py <command> [args...]",
            "commands": {
                "check_access": "Verify Reminders permission",
                "list_lists": "List all reminder lists",
                "get_reminders": "Get reminders (args: list_names_csv include_completed limit)",
                "get_by_list_id": "Get reminders for one list (args: list_id include_completed limit)",
                "search": "Search reminders (args: search_text include_completed limit)",
                "create": "Create a reminder (args: json_payload)",
                "create_list": "Create a reminder list if missing (args: name)",
                "delete_reminder": "Delete a reminder by id (args: reminder_id)",
            },
        }))
        sys.exit(1)

    command = sys.argv[1]
    store = EventKit.EKEventStore.alloc().init()

    def arg(index, default=""):
        return sys.argv[index] if len(sys.argv) > index else default

    def int_arg(index, default):
        raw = arg(index, "")
        return int(raw) if raw else default

    def bool_arg(index):
        return arg(index, "").lower() in ("1", "true", "yes")

    try:
        ensure_access(store)

        if command == "check_access":
            print(json.dumps({"hasAccess": True}))

        elif command == "list_lists":
            lists = get_lists(store)
            print(json.dumps({
                "lists": [
                    {"name": c.title(), "id": c.calendarIdentifier()} for c in lists
                ],
                "count": len(lists),
            }))

        elif command == "get_reminders":
            raw_names = arg(2)
            if raw_names and has_exact_list(store, raw_names):
                names = [raw_names]
            else:
                names = [n.strip() for n in raw_names.split(",") if n.strip()] or None
            include_completed = bool_arg(3)
            limit = int_arg(4, MAX_REMINDERS)

            if names:
                calendars = []
                for name in names:
                    found = find_list(store, name)
                    if found is None:
                        available = ", ".join(
                            c.title()
                            for c in store.calendarsForEntityType_(EventKit.EKEntityTypeReminder)
                        )
                        raise ValueError(
                            f'List "{name}" not found. Available lists: {available}'
                        )
                    calendars.append(found)
            else:
                calendars = get_lists(store)

            reminders = collect(store, calendars, include_completed, limit)
            print(json.dumps({"reminders": reminders, "count": len(reminders)}))

        elif command == "get_by_list_id":
            list_id = arg(2)
            if not list_id:
                raise ValueError("get_by_list_id requires a list id")
            calendar = find_list_by_id(store, list_id)
            if calendar is None:
                raise ValueError(f'No reminder list with id "{list_id}"')

            reminders = collect(store, [calendar], bool_arg(3), int_arg(4, MAX_REMINDERS))
            print(json.dumps({"reminders": reminders, "count": len(reminders)}))

        elif command == "search":
            search_text = arg(2)
            if not search_text.strip():
                raise ValueError("search requires non-empty search text")

            include_completed = bool_arg(3)
            limit = int_arg(4, MAX_REMINDERS)

            everything = collect(store, get_lists(store), include_completed, MAX_REMINDERS)
            needle = search_text.lower()
            # Match the list title too: without it, searching for a list ("Top 3")
            # returns nothing even though the list exists, and there is no other
            # way to reach a list's contents by name.
            direct = [
                r for r in everything
                if needle in r["name"].lower() or needle in r["body"].lower()
            ]
            seen = {r["id"] for r in direct}
            by_list = [
                r for r in everything
                if needle in r["listName"].lower() and r["id"] not in seen
            ]
            matches = (direct + by_list)[:limit]
            print(json.dumps({
                "reminders": matches,
                "count": len(matches),
                "searchText": search_text,
            }))

        elif command == "create_list":
            name = arg(2)
            if not name.strip():
                raise ValueError("create_list requires a list name")
            calendar = ensure_list(store, name)
            print(json.dumps({
                "list": {"name": calendar.title(), "id": calendar.calendarIdentifier()}
            }))

        elif command == "delete_reminder":
            reminder_id = arg(2)
            if not reminder_id:
                raise ValueError("delete_reminder requires a reminder id")
            print(json.dumps({"deleted": delete_reminder(store, reminder_id)}))

        elif command == "create":
            payload = json.loads(arg(2) or "{}")
            print(json.dumps({"reminder": create_reminder(store, payload)}))

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except AccessDenied as exc:
        print(json.dumps({"error": str(exc), "accessDenied": True}))
        sys.exit(1)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
