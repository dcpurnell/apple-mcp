import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
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
const PYTHON_SCRIPT = path.join(process.cwd(), "calendar-eventkit.py");

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
  calendars?: Array<{ name: string; type: number }>;
  count?: number;
  error?: string;
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
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Python EventKit error: ${error.message}`);
      return { error: error.message };
    }
    return { error: String(error) };
  }
}

/**
 * Request Calendar app access
 */
export async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
  try {
    const result = await executePythonScript("list_calendars");
    
    if (result.error) {
      if (result.error.includes("access denied") || result.error.includes("permission")) {
        return {
          hasAccess: false,
          message: "Calendar access denied. Please grant permission in System Settings > Privacy & Security > Calendars"
        };
      }
      return {
        hasAccess: false,
        message: `Calendar access check failed: ${result.error}`
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
 * Create a new calendar event (requires AppleScript fallback for now)
 * Note: EventKit requires more complex permissions for event creation
 */
export async function createEvent(
  calendarName: string,
  title: string,
  startDate: Date,
  endDate: Date,
  location?: string,
  notes?: string
): Promise<{ success: boolean; message: string }> {
  // For now, return an error - we can implement this later if needed
  return {
    success: false,
    message: "Event creation not yet implemented in Python EventKit bridge. Use Calendar app directly for now."
  };
}

/**
 * Open an event in the Calendar app (requires AppleScript)
 */
export async function openEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  // EventKit event identifiers are not the same as Calendar app URLs
  return {
    success: false,
    message: "Opening events not yet implemented. Use Calendar app directly."
  };
}

export type { CalendarEvent };
