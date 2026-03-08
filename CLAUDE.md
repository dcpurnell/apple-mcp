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

### Reminders Optimization

Reminders module was optimized to query incomplete items only:

- `getIncompleteReminders(listName)`: Query specific list for incomplete items
- Users should archive/delete completed items for best performance
- 31 seconds to query all 13 lists with incomplete items

### Maps Implementation (Experimental UI Scripting)

**Problem**: Apple Maps has no native framework or robust API (unlike Calendar's EventKit or Contacts framework).

**Solution**: Uses JXA + System Events GUI scripting to read search results from Maps UI.

**How it works**:
1. Launch Maps app
2. Use ⌘L to focus search field
3. Type query via `SystemEvents.keystroke()`
4. Press Return and wait 3 seconds
5. Recursively walk UI element tree to find static text elements
6. Filter out common UI labels ("Search", "Directions", etc.)
7. Return location names found in UI

**File structure**:
- `utils/maps.ts`: JXA implementation using System Events for UI scripting

**Limitations**:
- **Fragile**: Depends on Maps UI structure, may break with macOS updates
- **Permissions**: Requires Accessibility permissions for System Events
- **Incomplete data**: Can only extract visible location names, not addresses or coordinates
- **Performance**: 3+ second delay to wait for results to load
- **Best effort**: May return empty or partial results depending on UI state

**Alternatives considered**:
- MapKit JS API: Requires $99/year Apple Developer account
- Geocoding services: OpenStreetMap Nominatim (free), Google Geocoding, etc.
- Native framework: Apple has not released a programmatic Maps framework

**Recommendation**: For production use, consider integrating a geocoding service instead of GUI scripting.

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

- Query incomplete items only when possible
- Encourage users to archive completed items
- Use list-specific queries instead of global searches

### Contacts

- Use Python Contacts framework for fast searches (~1 second)
- Query returns full contact details in single call (phone, email, address, notes)
- Set reasonable limits (default 10 for search, 50 for list all) to avoid excessive data transfer
- Search by any field: name, phone, email, company
