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
- Doug Purnell
- Goals
- Family
- F3 Greensboro Events
- purnellbbq@gmail.com
- Holidays in United States

**Date range defaults:**
- `daysBack`: 7 days
- `daysForward`: 14 days
- Total: 21-day window (perfect for weekly reviews)

### Reminders Optimization
Reminders module was optimized to query incomplete items only:
- `getIncompleteReminders(listName)`: Query specific list for incomplete items
- Users should archive/delete completed items for best performance
- 31 seconds to query all 13 lists with incomplete items

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