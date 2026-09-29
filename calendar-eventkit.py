#!/usr/bin/env python3
"""
Calendar EventKit Bridge for apple-mcp
Uses native macOS EventKit framework (much faster than AppleScript for date queries)
Requires: pip3 install pyobjc-framework-EventKit
"""

import sys
import json
import threading
from datetime import datetime, timedelta
import EventKit
from Foundation import NSDate

# EKAuthorizationStatus values. macOS 14 added FullAccess (3) / WriteOnly (4);
# the legacy Authorized constant is also 3, so one check covers both.
STATUS_NOT_DETERMINED = 0
STATUS_RESTRICTED = 1
STATUS_DENIED = 2
STATUS_FULL_ACCESS = 3
STATUS_WRITE_ONLY = 4

DENIED_MESSAGE = (
    "Calendar access denied. Grant permission in "
    "System Settings > Privacy & Security > Calendars"
)


class AccessDenied(Exception):
    pass


def ensure_access(store, timeout=30.0):
    """
    Ensure we hold read access to Calendars, prompting once if needed.

    A NotDetermined status must actually request access; simply issuing a query
    does not trigger the prompt, and every read then returns empty while
    appearing to succeed.
    """
    status = EventKit.EKEventStore.authorizationStatusForEntityType_(
        EventKit.EKEntityTypeEvent
    )

    if status == STATUS_FULL_ACCESS:
        return
    if status == STATUS_WRITE_ONLY:
        raise AccessDenied(
            "Only write-only Calendar access is granted, which cannot read events. "
            "Grant full access in System Settings > Privacy & Security > Calendars"
        )
    if status in (STATUS_RESTRICTED, STATUS_DENIED):
        raise AccessDenied(DENIED_MESSAGE)

    granted = {}
    done = threading.Event()

    def completion(ok, err):
        granted["ok"] = bool(ok)
        done.set()

    if hasattr(store, "requestFullAccessToEventsWithCompletion_"):
        store.requestFullAccessToEventsWithCompletion_(completion)
    else:
        store.requestAccessToEntityType_completion_(
            EventKit.EKEntityTypeEvent, completion
        )

    if not done.wait(timeout):
        raise AccessDenied("Timed out waiting for the Calendar permission prompt")
    if not granted.get("ok"):
        raise AccessDenied(DENIED_MESSAGE)

def get_calendars(store, calendar_names=None):
    """Get all calendars or filter by names"""
    all_calendars = store.calendarsForEntityType_(EventKit.EKEntityTypeEvent)
    
    if calendar_names:
        return [c for c in all_calendars if c.title() in calendar_names]
    return list(all_calendars)

def query_events(store, calendar_names, start_dt, end_dt):
    """
    Every event occurrence overlapping [start_dt, end_dt), sorted by start.

    The bounds are absolute datetimes and go straight into the EventKit
    predicate. They used to travel as day offsets from "now", which could only
    describe a window containing now: a future fromDate clamped to the present
    and toDate was rounded up by as much as a day.

    Overlap is deliberate: an event that starts before start_dt but is still
    running inside the window is included (an overnight or multi-day event
    belongs on that day's agenda). It is checked explicitly rather than left to
    the predicate's own semantics. Recurring events arrive expanded, one
    occurrence each, sharing an eventIdentifier.
    """
    target_calendars = get_calendars(store, calendar_names)
    if not target_calendars:
        return []

    start_ts = start_dt.timestamp()
    end_ts = end_dt.timestamp()
    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        to_nsdate(start_dt), to_nsdate(end_dt), target_calendars
    )

    matches = []
    for event in store.eventsMatchingPredicate_(predicate) or []:
        event_start = event.startDate().timeIntervalSince1970()
        event_end = event.endDate().timeIntervalSince1970()
        # A zero-length event exactly at start_dt still counts as inside
        if event_start < end_ts and (event_end > start_ts or event_start >= start_ts):
            matches.append((event_start, event_end, event))

    # eventsMatchingPredicate_ has no defined order; sort before any limit so
    # the limit keeps the earliest events rather than an arbitrary subset.
    matches.sort(key=lambda m: (m[0], m[1]))
    return [m[2] for m in matches]


def get_events(store, start_dt, end_dt, calendar_names=None, limit=100):
    """Events overlapping the window, earliest first, plus the uncapped total."""
    events = query_events(store, calendar_names, start_dt, end_dt)
    return [serialize_event(e) for e in events[:limit]], len(events)


def search_events(store, search_text, start_dt, end_dt, calendar_names=None, limit=50):
    """Search the whole window by title, location, or notes; then apply the limit."""
    needle = search_text.lower()
    matches = []
    for event in query_events(store, calendar_names, start_dt, end_dt):
        haystack = ' '.join([
            event.title() or '', event.location() or '', event.notes() or ''
        ]).lower()
        if needle in haystack:
            matches.append(event)
    return [serialize_event(e) for e in matches[:limit]], len(matches)


def parse_window(argv, first):
    """Read calendar names, from, to and limit from argv starting at first."""
    if len(argv) < first + 3:
        raise ValueError('Expected arguments: calendar_names from_iso to_iso [limit]')
    calendar_names = argv[first].split(',') if argv[first] else None
    start_dt = parse_iso(argv[first + 1], 'from date')
    end_dt = parse_iso(argv[first + 2], 'to date')
    if end_dt <= start_dt:
        raise ValueError(f'to date {argv[first + 2]} is not after from date {argv[first + 1]}')
    return calendar_names, start_dt, end_dt


def parse_iso(value, field):
    """Parse an ISO-8601 string into a naive local datetime."""
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(
            f'Invalid {field} "{value}"; expected an ISO-8601 date string'
        )
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def to_nsdate(dt):
    return NSDate.dateWithTimeIntervalSince1970_(dt.timestamp())


def find_calendar(store, name):
    """Resolve a writable calendar by exact title, then case-insensitive."""
    calendars = [
        c for c in store.calendarsForEntityType_(EventKit.EKEntityTypeEvent)
        if c.allowsContentModifications()
    ]

    for cal in calendars:
        if cal.title() == name:
            return cal
    lowered = name.lower()
    for cal in calendars:
        if cal.title().lower() == lowered:
            return cal
    return None


def serialize_event(event):
    return {
        'title': event.title() or 'Untitled',
        'startDate': event.startDate().description(),
        'endDate': event.endDate().description(),
        'calendar': event.calendar().title(),
        'location': event.location() or '',
        'notes': event.notes() or '',
        'isAllDay': bool(event.isAllDay()),
        'eventIdentifier': event.eventIdentifier(),
    }


def create_event(store, payload):
    title = (payload.get('title') or '').strip()
    if not title:
        raise ValueError('Event title is required')

    start = parse_iso(payload.get('startDate'), 'start date')
    end = parse_iso(payload.get('endDate'), 'end date')
    if end <= start:
        raise ValueError('Event end date must be after its start date')

    calendar_name = payload.get('calendarName')
    if calendar_name:
        calendar = find_calendar(store, calendar_name)
        if calendar is None:
            writable = ', '.join(
                c.title()
                for c in store.calendarsForEntityType_(EventKit.EKEntityTypeEvent)
                if c.allowsContentModifications()
            )
            raise ValueError(
                f'Calendar "{calendar_name}" not found or is read-only. '
                f'Writable calendars: {writable}'
            )
    else:
        calendar = store.defaultCalendarForNewEvents()
        if calendar is None:
            raise ValueError('No default calendar is configured on this Mac')

    event = EventKit.EKEvent.eventWithEventStore_(store)
    event.setTitle_(title)
    event.setCalendar_(calendar)
    event.setStartDate_(to_nsdate(start))
    event.setEndDate_(to_nsdate(end))

    if payload.get('location'):
        event.setLocation_(payload['location'])
    if payload.get('notes'):
        event.setNotes_(payload['notes'])
    if payload.get('isAllDay'):
        event.setAllDay_(True)

    ok, err = store.saveEvent_span_error_(event, EventKit.EKSpanThisEvent, None)
    if not ok:
        message = err.localizedDescription() if err is not None else 'unknown error'
        raise RuntimeError(f'Failed to save event: {message}')

    return serialize_event(event)


def get_event(store, event_id):
    event = store.eventWithIdentifier_(event_id)
    return serialize_event(event) if event is not None else None


def delete_event(store, event_id):
    event = store.eventWithIdentifier_(event_id)
    if event is None:
        return False
    ok, err = store.removeEvent_span_error_(event, EventKit.EKSpanThisEvent, None)
    if not ok:
        message = err.localizedDescription() if err is not None else 'unknown error'
        raise RuntimeError(f'Failed to delete event: {message}')
    return True


def main():
    """CLI interface for testing"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python3 calendar-eventkit.py <command> [args...]',
            'commands': {
                'list_calendars': 'List all available calendars',
                'get_events': 'Get events (args: calendar_names from_iso to_iso limit)',
                'search_events': 'Search events (args: search_text calendar_names from_iso to_iso limit)',
                'create_event': 'Create an event (args: json_payload)',
                'get_event': 'Fetch one event by identifier (args: event_id)',
                'delete_event': 'Delete an event by identifier (args: event_id)'
            }
        }))
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Initialize store
    store = EventKit.EKEventStore.alloc().init()
    
    try:
        ensure_access(store)

        if command == 'list_calendars':
            calendars = get_calendars(store)
            result = {
                'calendars': [{'name': c.title(), 'type': c.type()} for c in calendars],
                'count': len(calendars)
            }
            print(json.dumps(result))
        
        elif command == 'get_events':
            calendar_names, start_dt, end_dt = parse_window(sys.argv, 2)
            limit = int(sys.argv[5]) if len(sys.argv) > 5 else 100

            events, total = get_events(store, start_dt, end_dt, calendar_names, limit)
            print(json.dumps({
                'events': events,
                'count': len(events),
                'total': total,
                'calendars': calendar_names or 'all',
            }))

        elif command == 'search_events':
            if len(sys.argv) < 3 or not sys.argv[2]:
                raise ValueError('search_events requires search_text argument')

            search_text = sys.argv[2]
            calendar_names, start_dt, end_dt = parse_window(sys.argv, 3)
            limit = int(sys.argv[6]) if len(sys.argv) > 6 else 50

            events, total = search_events(
                store, search_text, start_dt, end_dt, calendar_names, limit
            )
            print(json.dumps({
                'events': events,
                'count': len(events),
                'total': total,
                'searchText': search_text
            }))

        elif command == 'create_event':
            payload = json.loads(sys.argv[2] if len(sys.argv) > 2 else '{}')
            print(json.dumps({'event': create_event(store, payload)}))

        elif command == 'delete_event':
            if len(sys.argv) < 3 or not sys.argv[2]:
                raise ValueError('delete_event requires an event id')
            print(json.dumps({'deleted': delete_event(store, sys.argv[2])}))

        elif command == 'get_event':
            if len(sys.argv) < 3 or not sys.argv[2]:
                raise ValueError('get_event requires an event id')
            event = get_event(store, sys.argv[2])
            if event is None:
                raise ValueError(f'No event with id "{sys.argv[2]}"')
            print(json.dumps({'event': event}))

        else:
            print(json.dumps({'error': f'Unknown command: {command}'}))
            sys.exit(1)
    
    except AccessDenied as e:
        print(json.dumps({'error': str(e), 'accessDenied': True}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
