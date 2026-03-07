#!/usr/bin/env python3
"""
Calendar EventKit Bridge for apple-mcp
Uses native macOS EventKit framework (much faster than AppleScript for date queries)
Requires: pip3 install pyobjc-framework-EventKit
"""

import sys
import json
from datetime import datetime, timedelta
import EventKit
from Foundation import NSDate

def request_calendar_access(store):
    """Request calendar access (synchronous check)"""
    # Check current authorization status
    status = EventKit.EKEventStore.authorizationStatusForEntityType_(EventKit.EKEntityTypeEvent)
    
    if status == EventKit.EKAuthorizationStatusAuthorized:
        return True
    elif status == EventKit.EKAuthorizationStatusDenied or status == EventKit.EKAuthorizationStatusRestricted:
        return False
    else:
        # Not determined - need to request
        # Note: This is async, but we'll return True and let first query handle permission
        return True

def get_calendars(store, calendar_names=None):
    """Get all calendars or filter by names"""
    all_calendars = store.calendarsForEntityType_(EventKit.EKEntityTypeEvent)
    
    if calendar_names:
        return [c for c in all_calendars if c.title() in calendar_names]
    return list(all_calendars)

def get_events(store, calendar_names=None, days_back=7, days_forward=14, limit=100):
    """
    Query calendar events using native EventKit
    
    Args:
        store: EKEventStore instance
        calendar_names: List of calendar names to query (None = all calendars)
        days_back: Number of days in the past to query
        days_forward: Number of days in the future to query
        limit: Maximum number of events to return
    
    Returns:
        List of event dictionaries
    """
    # Get target calendars
    target_calendars = get_calendars(store, calendar_names)
    
    if not target_calendars:
        return []
    
    # Date range
    start_date = NSDate.dateWithTimeIntervalSinceNow_(-days_back * 24 * 60 * 60)
    end_date = NSDate.dateWithTimeIntervalSinceNow_(days_forward * 24 * 60 * 60)
    
    # Create predicate (this is FAST even with thousands of events)
    predicate = store.predicateForEventsWithStartDate_endDate_calendars_(
        start_date, end_date, target_calendars
    )
    
    # Fetch events
    events = store.eventsMatchingPredicate_(predicate)
    
    # Convert to dictionaries
    results = []
    for event in events[:limit]:
        results.append({
            'title': event.title() or 'Untitled',
            'startDate': event.startDate().description(),
            'endDate': event.endDate().description(),
            'calendar': event.calendar().title(),
            'location': event.location() or '',
            'notes': event.notes() or '',
            'isAllDay': event.isAllDay(),
            'eventIdentifier': event.eventIdentifier()
        })
    
    return results

def search_events(store, search_text, calendar_names=None, days_back=30, days_forward=30, limit=50):
    """Search events by text in title, location, or notes"""
    all_events = get_events(store, calendar_names, days_back, days_forward, limit * 2)
    
    search_lower = search_text.lower()
    matches = []
    
    for event in all_events:
        if (search_lower in event['title'].lower() or
            search_lower in event['location'].lower() or
            search_lower in event['notes'].lower()):
            matches.append(event)
            if len(matches) >= limit:
                break
    
    return matches

def main():
    """CLI interface for testing"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python3 calendar-eventkit.py <command> [args...]',
            'commands': {
                'list_calendars': 'List all available calendars',
                'get_events': 'Get events (args: calendar_names days_back days_forward limit)',
                'search_events': 'Search events (args: search_text calendar_names days_back days_forward limit)'
            }
        }))
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Initialize store
    store = EventKit.EKEventStore.alloc().init()
    
    # Check access
    if not request_calendar_access(store):
        print(json.dumps({'error': 'Calendar access denied. Grant permission in System Settings > Privacy & Security > Calendars'}))
        sys.exit(1)
    
    try:
        if command == 'list_calendars':
            calendars = get_calendars(store)
            result = {
                'calendars': [{'name': c.title(), 'type': c.type()} for c in calendars],
                'count': len(calendars)
            }
            print(json.dumps(result))
        
        elif command == 'get_events':
            calendar_names = sys.argv[2].split(',') if len(sys.argv) > 2 and sys.argv[2] else None
            days_back = int(sys.argv[3]) if len(sys.argv) > 3 else 7
            days_forward = int(sys.argv[4]) if len(sys.argv) > 4 else 14
            limit = int(sys.argv[5]) if len(sys.argv) > 5 else 100
            
            events = get_events(store, calendar_names, days_back, days_forward, limit)
            print(json.dumps({
                'events': events,
                'count': len(events),
                'calendars': calendar_names or 'all',
                'dateRange': f'{days_back} days back, {days_forward} days forward'
            }))
        
        elif command == 'search_events':
            if len(sys.argv) < 3:
                print(json.dumps({'error': 'search_events requires search_text argument'}))
                sys.exit(1)
            
            search_text = sys.argv[2]
            calendar_names = sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else None
            days_back = int(sys.argv[4]) if len(sys.argv) > 4 else 30
            days_forward = int(sys.argv[5]) if len(sys.argv) > 5 else 30
            limit = int(sys.argv[6]) if len(sys.argv) > 6 else 50
            
            events = search_events(store, search_text, calendar_names, days_back, days_forward, limit)
            print(json.dumps({
                'events': events,
                'count': len(events),
                'searchText': search_text
            }))
        
        else:
            print(json.dumps({'error': f'Unknown command: {command}'}))
            sys.exit(1)
    
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
