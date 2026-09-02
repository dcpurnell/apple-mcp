# apple-mcp Development Guidelines

## Commands

- `bun run dev` - Start the development server
- No specific test or lint commands defined in package.json

## Architecture

### Calendar Implementation (Python EventKit Bridge)

The calendar module uses Python EventKit instead of AppleScript for performance:

- **Old AppleScript approach**: 30+ second timeouts on date-filtered queries
- **New Python EventKit approach**: ~238ms for 21-day window queries (126x faster)

**File structure:**

- `calendar-eventkit.py`: Python bridge using native macOS EventKit framework
- `utils/calendar-python.ts`: TypeScript wrapper that calls Python script via execFile
- `utils/calendar.ts`: Original AppleScript implementation (deprecated, kept for reference)

**Dependencies:**

- `pyobjc-framework-EventKit`: Python package for native EventKit access
- Installed via: `pip3 install pyobjc-framework-EventKit`

**Default calendars** (configurable in index.ts):

- Personal
- Work
- Family
- Holidays

(Customize these with your own calendar names from the Calendar app sidebar)

**Features:**

- `getCalendarList()`: All calendars with their type
- `getEvents(calendarNames?, daysBack, daysForward, limit)`: Date-windowed query
- `searchEvents(searchText, calendarNames?, daysBack, daysForward, limit)`
- `createEvent(calendarName, title, start, end, location?, notes?, isAllDay?)`:
  an empty `calendarName` uses the Mac's default calendar
- `openEvent(eventId)` / `deleteEvent(eventId)`
- Access is requested explicitly. A NotDetermined status must call
  `requestFullAccessToEventsWithCompletion_`; merely issuing a query does not
  prompt, and every read then returns empty while appearing to succeed.

**Date range defaults:**

- `daysBack`: 7 days
- `daysForward`: 14 days
- Total: 21-day window (perfect for weekly reviews)

### Contacts Implementation (Python Contacts Framework)

The contacts module uses Python Contacts framework for fast queries and full contact details:

- **Performance**: ~1 second per query (search or list all)
- **Capabilities**: Find contacts by name, phone, email, or company with full details

**File structure:**

- `contacts-framework.py`: Python bridge using native macOS Contacts framework
- `utils/contacts-python.ts`: TypeScript wrapper that calls Python script via execFile
- `utils/contacts.ts`: Original AppleScript implementation (deprecated, kept for reference)

**Dependencies:**

- `pyobjc-framework-Contacts`: Python package for native Contacts framework access
- Installed via: `pip3 install pyobjc-framework-Contacts`

**Features:**

- `getAllContacts(limit)`: Fetch all contacts with optional limit
- `searchContacts(searchTerm, limit)`: Search by name, phone, email, company
- Returns full contact objects: phone numbers, emails, addresses, notes
- Rich formatting in MCP handler with emoji icons (📋📞📧🏠)

### Reminders Implementation (Python EventKit Bridge)

The reminders module uses Python EventKit instead of AppleScript, for the same
reason as Calendar:

- **Old AppleScript approach**: 45-120s per operation, so every call exceeded its
  15s timeout and returned an empty array. It also never parsed results, because
  `run-applescript` returns a string rather than a record.
- **New Python EventKit approach**: ~250ms per operation

**File structure:**

- `reminders-eventkit.py`: Python bridge using the native macOS EventKit framework
- `utils/reminders-python.ts`: TypeScript wrapper that calls the script via execFile
- `utils/reminders.ts`: Original AppleScript implementation (deprecated, kept for reference)

**Dependencies:**

- `pyobjc-framework-EventKit` (shared with Calendar)
- Installed via: `pip3 install pyobjc-framework-EventKit`

**Features:**

- `getAllLists()`: All reminder lists with their IDs
- `getAllReminders(listName?)`: All reminders, optionally scoped to one list
- `getIncompleteReminders(listName, includeCompleted?)`: Weekly-review query
- `searchReminders(searchText)`: Match against reminder names and notes
- `createReminder(name, listName?, notes?, dueDate?)`: Due dates are honored;
  omitting `listName` uses the Mac's default list
- `createList(name)` / `deleteReminder(id)`: Used by the integration tests
- Errors propagate instead of being swallowed into an empty array, so a failure
  is distinguishable from "nothing to do"

## Code Style

### TypeScript Configuration

- Target: ESNext
- Module: ESNext
- Strict mode enabled
- Bundler module resolution

### Formatting & Structure

- Use 2-space indentation (based on existing code)
- Keep lines under 100 characters
- Use explicit type annotations for function parameters and returns

### Naming Conventions

- PascalCase for types, interfaces and Tool constants (e.g., `CONTACTS_TOOL`)
- camelCase for variables and functions
- Use descriptive names that reflect purpose

### Imports

- Use ESM import syntax with `.js` extensions
- Organize imports: external packages first, then internal modules

### Error Handling

- Use try/catch blocks around applescript execution and external operations
- Return both success status and detailed error messages
- Check for required parameters before operations

### Type Safety

- Define strong types for all function parameters
- Use type guard functions for validating incoming arguments
- Provide detailed TypeScript interfaces for complex objects

### MCP Tool Structure

- Follow established pattern for creating tool definitions
- Include detailed descriptions and proper input schema
- Organize related functionality into separate utility modules

## Performance Considerations

### Calendar Queries

- Use Python EventKit for date-filtered queries (fast)
- Avoid AppleScript date filtering on calendars with thousands of events
- Default to querying specific calendars instead of ALL calendars
- Limit result count to avoid excessive data transfer

### Reminders

- Use Python EventKit for all queries (~250ms); never AppleScript
- Scope to a specific list where possible instead of querying every list
- Results are capped at 500 reminders per call

### Contacts

- Use Python Contacts framework for fast searches (~1 second)
- Query returns full contact details in single call (phone, email, address, notes)
- Set reasonable limits (default 10 for search, 50 for list all) to avoid excessive data transfer
- Search by any field: name, phone, email, company
