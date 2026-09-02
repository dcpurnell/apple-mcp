import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { validateText, validateSearchQuery } from './input-validation';

const execFileAsync = promisify(execFile);

// Configuration
const CONFIG = {
  TIMEOUT_MS: 30000, // Python EventKit is fast, but leave room
  MAX_EVENTS: 100,
  DEFAULT_DAYS_BACK: 7,
  DEFAULT_DAYS_FORWARD: 14,
};

// Path to the Python EventKit bridge script
// Use import.meta.url to get reliable path regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "..", "calendar-eventkit.py");

// Define types for calendar events
interface CalendarEvent {
  id: string;
  title: string;
  location: string | null;
  notes: string | null;
  startDate: string;
  endDate: string;
  calendarName: string;
  isAllDay: boolean;
  url: string | null;
}

interface PythonEventKitResponse {
  events?: Array<{
    title: string;
    startDate: string;
    endDate: string;
    calendar: string;
    location: string;
    notes: string;
    isAllDay: boolean;
    eventIdentifier: string;
  }>;
  event?: {
    title: string;
    startDate: string;
    endDate: string;
    calendar: string;
    location: string;
    notes: string;
    isAllDay: boolean;
    eventIdentifier: string;
  };
  calendars?: Array<{ name: string; type: number }>;
  deleted?: boolean;
  count?: number;
  error?: string;
  accessDenied?: boolean;
}

/**
 * Execute Python EventKit script with timeout
 */
async function executePythonScript(
  command: string,
  args: string[] = []
): Promise<PythonEventKitResponse> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "python3",
      [PYTHON_SCRIPT, command, ...args],
      { timeout: CONFIG.TIMEOUT_MS }
    );

    if (stderr && !stderr.includes("Warning")) {
      console.warn(`Python script stderr: ${stderr}`);
    }

    return JSON.parse(stdout);
  } catch (error: any) {
    // The bridge exits non-zero on failure but still prints a JSON error body,
    // so prefer that over execFile's generic "Command failed" message.
    if (error && typeof error.stdout === "string" && error.stdout.trim()) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        // fall through to the generic error below
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Python EventKit error: ${message}`);
    return { error: message };
  }
}

/**
 * Request Calendar app access
 */
export async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
  try {
    const result = await executePythonScript("list_calendars");
    
    if (result.error) {
      return {
        hasAccess: false,
        message: result.accessDenied
          ? result.error
          : `Calendar access check failed: ${result.error}`
      };
    }

    return {
      hasAccess: true,
      message: "Calendar access granted"
    };
  } catch (error) {
    return {
      hasAccess: false,
      message: `Failed to check calendar access: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Get list of available calendars
 */
export async function getCalendarList(): Promise<Array<{ name: string; type: string }>> {
  const result = await executePythonScript("list_calendars");
  
  if (result.error || !result.calendars) {
    throw new Error(result.error || "Failed to fetch calendar list");
  }

  // Map calendar types (1=local, 2=CalDAV, 3=subscribed, 4=birthday)
  const typeMap: Record<number, string> = {
    1: "local",
    2: "caldav",
    3: "subscribed",
    4: "birthday"
  };

  return result.calendars.map(cal => ({
    name: cal.name,
    type: typeMap[cal.type] || "unknown"
  }));
}

/**
 * Get calendar events with date range and calendar filtering
 */
export async function getEvents(
  calendarNames?: string[],
  daysBack: number = CONFIG.DEFAULT_DAYS_BACK,
  daysForward: number = CONFIG.DEFAULT_DAYS_FORWARD,
  limit: number = CONFIG.MAX_EVENTS
): Promise<CalendarEvent[]> {
  const calendarsArg = calendarNames ? calendarNames.join(",") : "";
  const args = [
    calendarsArg,
    String(daysBack),
    String(daysForward),
    String(Math.min(limit, CONFIG.MAX_EVENTS))
  ];

  const result = await executePythonScript("get_events", args);
  
  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.events) {
    return [];
  }

  // Convert Python format to our CalendarEvent format
  return result.events.map(event => ({
    id: event.eventIdentifier,
    title: event.title,
    location: event.location || null,
    notes: event.notes || null,
    startDate: event.startDate,
    endDate: event.endDate,
    calendarName: event.calendar,
    isAllDay: event.isAllDay,
    url: null // EventKit doesn't expose URLs easily
  }));
}

/**
 * Search calendar events by text
 */
export async function searchEvents(
  searchText: string,
  calendarNames?: string[],
  daysBack: number = 30,
  daysForward: number = 30,
  limit: number = 50
): Promise<CalendarEvent[]> {
  // Validate search text
  const validation = validateSearchQuery(searchText);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  const calendarsArg = calendarNames ? calendarNames.join(",") : "";
  const args = [
    searchText,
    calendarsArg,
    String(daysBack),
    String(daysForward),
    String(limit)
  ];

  const result = await executePythonScript("search_events", args);
  
  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.events) {
    return [];
  }

  // Convert Python format to our CalendarEvent format
  return result.events.map(event => ({
    id: event.eventIdentifier,
    title: event.title,
    location: event.location || null,
    notes: event.notes || null,
    startDate: event.startDate,
    endDate: event.endDate,
    calendarName: event.calendar,
    isAllDay: event.isAllDay,
    url: null
  }));
}

/**
 * Create a new calendar event
 * @param calendarName Calendar to create it in; empty uses the default calendar
 * @param title Event title
 * @param startDate Event start
 * @param endDate Event end (must be after start)
 * @param location Optional location
 * @param notes Optional notes
 * @param isAllDay Whether the event covers the whole day
 */
export async function createEvent(
  calendarName: string,
  title: string,
  startDate: Date,
  endDate: Date,
  location?: string,
  notes?: string,
  isAllDay: boolean = false
): Promise<{ success: boolean; message: string; event?: CalendarEvent }> {
  const titleValidation = validateText(title, "Event title", 500);
  if (!titleValidation.isValid) {
    return { success: false, message: titleValidation.error! };
  }

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { success: false, message: "Invalid start or end date" };
  }

  const payload = JSON.stringify({
    title,
    calendarName: calendarName || null,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    location: location || null,
    notes: notes || null,
    isAllDay,
  });

  const result = await executePythonScript("create_event", [payload]);

  if (result.error || !result.event) {
    return {
      success: false,
      message: result.error || "Failed to create event",
    };
  }

  const event = result.event;
  return {
    success: true,
    message: `Created event "${event.title}" in calendar "${event.calendar}".`,
    event: {
      id: event.eventIdentifier,
      title: event.title,
      location: event.location || null,
      notes: event.notes || null,
      startDate: event.startDate,
      endDate: event.endDate,
      calendarName: event.calendar,
      isAllDay: event.isAllDay,
      url: null,
    },
  };
}

/**
 * Delete a calendar event by id
 * @param eventId EventKit event identifier
 * @returns true if a matching event was found and removed
 */
export async function deleteEvent(eventId: string): Promise<boolean> {
  if (!eventId) {
    throw new Error("Event ID is required");
  }

  const result = await executePythonScript("delete_event", [eventId]);

  if (result.error) {
    throw new Error(`Failed to delete event: ${result.error}`);
  }

  return Boolean(result.deleted);
}

/**
 * Open an event in the Calendar app
 * @param eventId EventKit event identifier, as returned by getEvents/searchEvents
 */
export async function openEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  if (!eventId) {
    return { success: false, message: "Event ID is required" };
  }

  // Confirm the event exists before handing the id to the Calendar app, so an
  // unknown id reports a real error instead of silently opening nothing.
  const result = await executePythonScript("get_event", [eventId]);

  if (result.error || !result.event) {
    return {
      success: false,
      message: result.error || `No event with id "${eventId}"`,
    };
  }

  try {
    await execFileAsync("open", [`ical://ekevent/${eventId}?method=show&options=more`], {
      timeout: 5000,
    });
    return {
      success: true,
      message: `Opened "${result.event.title}" in Calendar.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to open event: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export type { CalendarEvent };
