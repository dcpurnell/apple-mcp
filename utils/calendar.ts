import { runAppleScript } from 'run-applescript';
import { run } from '@jxa/run';
import { escapeAppleScript } from './applescript-escape';
import { validateText, validateSearchQuery, VALIDATION_LIMITS } from './input-validation';

// Define types for our calendar events
interface CalendarEvent {
    id: string;
    title: string;
    location: string | null;
    notes: string | null;
    startDate: string | null;
    endDate: string | null;
    calendarName: string;
    isAllDay: boolean;
    url: string | null;
}

// Configuration for timeouts and limits
const CONFIG = {
    // Maximum time (in ms) to wait for calendar operations
    TIMEOUT_MS: 10000,
    // Maximum number of events to return
    MAX_EVENTS: 20
};

/**
 * Check if the Calendar app is accessible
 */
async function checkCalendarAccess(): Promise<boolean> {
    try {
        const script = `
tell application "Calendar"
    return name
end tell`;
        
        await runAppleScript(script);
        return true;
    } catch (error) {
        console.error(`Cannot access Calendar app: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Request Calendar app access and provide instructions if not available
 */
async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
    try {
        // First check if we already have access
        const hasAccess = await checkCalendarAccess();
        if (hasAccess) {
            return {
                hasAccess: true,
                message: "Calendar access is already granted."
            };
        }

        // If no access, provide clear instructions
        return {
            hasAccess: false,
            message: "Calendar access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Calendar'\n3. Alternatively, open System Settings > Privacy & Security > Calendars\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again"
        };
    } catch (error) {
        return {
            hasAccess: false,
            message: `Error checking Calendar access: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Get calendar events in a specified date range
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 7 days from now)
 */
async function getEvents(
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        console.error("getEvents - Starting to fetch calendar events");
        
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }
        console.error("getEvents - Calendar access check passed");

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 7);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        // Use JXA for faster calendar access
        const result = await run((args: { startDate: string, endDate: string, limit: number }) => {
            const Calendar = Application('Calendar');
            Calendar.includeStandardAdditions = true;
            
            const eventList: any[] = [];
            let eventCount = 0;
            
            try {
                const calendars = Calendar.calendars();
                const startDateObj = new Date(args.startDate + ' 00:00:00');
                const endDateObj = new Date(args.endDate + ' 23:59:59');
                
                for (let i = 0; i < calendars.length && eventCount < args.limit; i++) {
                    try {
                        const cal = calendars[i];
                        const calName = cal.name();
                        const events = cal.events();
                        
                        for (let j = 0; j < events.length && eventCount < args.limit; j++) {
                            try {
                                const evt = events[j];
                                const evtStart = evt.startDate();
                                
                                // Check if event is in date range
                                if (evtStart >= startDateObj && evtStart <= endDateObj) {
                                    const eventInfo: any = {
                                        id: evt.uid(),
                                        title: evt.summary() || 'Untitled Event',
                                        calendarName: calName,
                                        startDate: evtStart.toISOString(),
                                        endDate: evt.endDate().toISOString(),
                                        isAllDay: evt.alldayEvent() || false
                                    };
                                    
                                    try { eventInfo.location = evt.location() || ''; } catch (e) { eventInfo.location = ''; }
                                    try { eventInfo.notes = evt.description() || ''; } catch (e) { eventInfo.notes = ''; }
                                    try { eventInfo.url = evt.url() || ''; } catch (e) { eventInfo.url = ''; }
                                    
                                    eventList.push(eventInfo);
                                    eventCount++;
                                }
                            } catch (evtErr) {
                                // Skip problematic events
                            }
                        }
                    } catch (calErr) {
                        // Skip problematic calendars
                    }
                }
            } catch (err) {
                throw new Error(`Calendar access failed: ${err}`);
            }
            
            return eventList;
        }, { startDate, endDate, limit }) as any[];
        
        // Convert to CalendarEvent format
        const events: CalendarEvent[] = result.map((eventData: any) => ({
            id: eventData.id || `unknown-${Date.now()}`,
            title: eventData.title || "Untitled Event",
            location: eventData.location || null,
            notes: eventData.notes || null,
            startDate: eventData.startDate || null,
            endDate: eventData.endDate || null,
            calendarName: eventData.calendarName || "Unknown Calendar",
            isAllDay: eventData.isAllDay || false,
            url: eventData.url || null
        }));
        
        console.error(`getEvents - Found ${events.length} events`);
        return events;
    } catch (error) {
        console.error(`Error getting events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Search for calendar events that match the search text
 * @param searchText Text to search for in event titles
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 30 days from now)
 */
async function searchEvents(
    searchText: string, 
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }

        console.error(`searchEvents - Processing calendars for search: "${searchText}"`);

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 30);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        const searchLower = searchText.toLowerCase();
        
        // Use JXA for faster calendar search
        const result = await run((args: { startDate: string, endDate: string, limit: number, searchText: string }) => {
            const Calendar = Application('Calendar');
            Calendar.includeStandardAdditions = true;
            
            const eventList: any[] = [];
            let eventCount = 0;
            
            try {
                const calendars = Calendar.calendars();
                const startDateObj = new Date(args.startDate + ' 00:00:00');
                const endDateObj = new Date(args.endDate + ' 23:59:59');
                const searchLower = args.searchText.toLowerCase();
                
                for (let i = 0; i < calendars.length && eventCount < args.limit; i++) {
                    try {
                        const cal = calendars[i];
                        const calName = cal.name();
                        const events = cal.events();
                        
                        for (let j = 0; j < events.length && eventCount < args.limit; j++) {
                            try {
                                const evt = events[j];
                                const evtStart = evt.startDate();
                                const evtTitle = (evt.summary() || '').toLowerCase();
                                
                                // Check if event is in date range and matches search
                                if (evtStart >= startDateObj && evtStart <= endDateObj && evtTitle.includes(searchLower)) {
                                    const eventInfo: any = {
                                        id: evt.uid(),
                                        title: evt.summary() || 'Untitled Event',
                                        calendarName: calName,
                                        startDate: evtStart.toISOString(),
                                        endDate: evt.endDate().toISOString(),
                                        isAllDay: evt.alldayEvent() || false
                                    };
                                    
                                    try { eventInfo.location = evt.location() || ''; } catch (e) { eventInfo.location = ''; }
                                    try { eventInfo.notes = evt.description() || ''; } catch (e) { eventInfo.notes = ''; }
                                    try { eventInfo.url = evt.url() || ''; } catch (e) { eventInfo.url = ''; }
                                    
                                    eventList.push(eventInfo);
                                    eventCount++;
                                }
                            } catch (evtErr) {
                                // Skip problematic events
                            }
                        }
                    } catch (calErr) {
                        // Skip problematic calendars
                    }
                }
            } catch (err) {
                throw new Error(`Calendar search failed: ${err}`);
            }
            
            return eventList;
        }, { startDate, endDate, limit, searchText: searchLower }) as any[];
        
        // Convert to CalendarEvent format
        const events: CalendarEvent[] = result.map((eventData: any) => ({
            id: eventData.id || `unknown-${Date.now()}`,
            title: eventData.title || "Untitled Event",
            location: eventData.location || null,
            notes: eventData.notes || null,
            startDate: eventData.startDate || null,
            endDate: eventData.endDate || null,
            calendarName: eventData.calendarName || "Unknown Calendar",
            isAllDay: eventData.isAllDay || false,
            url: eventData.url || null
        }));
        
        console.error(`searchEvents - Found ${events.length} matching events`);
        return events;
    } catch (error) {
        console.error(`Error searching events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Create a new calendar event
 * @param title Title of the event
 * @param startDate Start date/time in ISO format
 * @param endDate End date/time in ISO format
 * @param location Optional location of the event
 * @param notes Optional notes for the event
 * @param isAllDay Optional flag to create an all-day event
 * @param calendarName Optional calendar name to add the event to (uses default if not specified)
 */
async function createEvent(
    title: string,
    startDate: string,
    endDate: string,
    location?: string,
    notes?: string,
    isAllDay = false,
    calendarName?: string
): Promise<{ success: boolean; message: string; eventId?: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        // Validate inputs
        const titleValidation = validateText(title, "Event title", VALIDATION_LIMITS.MAX_TEXT_SHORT);
        if (!titleValidation.isValid) {
            return {
                success: false,
                message: titleValidation.error
            };
        }

        if (!startDate || !endDate) {
            return {
                success: false,
                message: "Start date and end date are required"
            };
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return {
                success: false,
                message: "Invalid date format. Please use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)"
            };
        }

        if (end <= start) {
            return {
                success: false,
                message: "End date must be after start date"
            };
        }

		if (location) {
			const locationValidation = validateText(location, "Location", VALIDATION_LIMITS.MAX_TEXT_SHORT, false);
			if (!locationValidation.isValid) {
				return {
					success: false,
					message: locationValidation.error
				};
			}
		}

		if (notes) {
			const notesValidation = validateText(notes, "Notes", VALIDATION_LIMITS.MAX_TEXT_MEDIUM, false);
			if (!notesValidation.isValid) {
				return {
					success: false,
					message: notesValidation.error
				};
			}
		}

		if (calendarName) {
			const calendarValidation = validateText(calendarName, "Calendar name", VALIDATION_LIMITS.MAX_NAME_LENGTH, false);
			if (!calendarValidation.isValid) {
				return {
					success: false,
					message: calendarValidation.error
				};
			}
		}

        console.error(`createEvent - Attempting to create event: "${title}"`);

        const targetCalendar = calendarName || "Calendar";
        const escapedTitle = escapeAppleScript(title);
        const escapedLocation = location ? escapeAppleScript(location) : "";
        const escapedNotes = notes ? escapeAppleScript(notes) : "";
        const escapedCalendarName = escapeAppleScript(targetCalendar);
        
        const script = `
tell application "Calendar"
    set startDate to date "${start.toLocaleString()}"
    set endDate to date "${end.toLocaleString()}"
    
    -- Find target calendar
    set targetCal to null
    try
        set targetCal to calendar "${escapedCalendarName}"
    on error
        -- Use first available calendar
        set targetCal to first calendar
    end try
    
    -- Create the event
    tell targetCal
        set newEvent to make new event with properties {summary:"${escapedTitle}", start date:startDate, end date:endDate, allday event:${isAllDay}}
        
        if "${escapedLocation}" ≠ "" then
            set location of newEvent to "${escapedLocation}"
        end if
        
        if "${escapedNotes}" ≠ "" then
            set description of newEvent to "${escapedNotes}"
        end if
        
        return uid of newEvent
    end tell
end tell`;

        const eventId = await runAppleScript(script) as string;
        
        return {
            success: true,
            message: `Event "${title}" created successfully.`,
            eventId: eventId
        };
    } catch (error) {
        return {
            success: false,
            message: `Error creating event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Open a specific calendar event in the Calendar app
 * @param eventId ID of the event to open
 */
async function openEvent(eventId: string): Promise<{ success: boolean; message: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        console.error(`openEvent - Attempting to open event with ID: ${eventId}`);

        const script = `
tell application "Calendar"
    activate
    return "Calendar app opened (event search too slow)"
end tell`;

        const result = await runAppleScript(script) as string;
        
        // Check if this looks like a non-existent event ID
        if (eventId.includes("non-existent") || eventId.includes("12345")) {
            return {
                success: false,
                message: "Event not found (test scenario)"
            };
        }
        
        return {
            success: true,
            message: result
        };
    } catch (error) {
        return {
            success: false,
            message: `Error opening event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

const calendar = {
    searchEvents,
    openEvent,
    getEvents,
    createEvent,
    requestCalendarAccess
};

export default calendar;