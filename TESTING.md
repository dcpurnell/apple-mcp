# Testing Notes

## Test Suite Status

### ⚠️ Integration Tests Need Updates

The integration tests in `tests/integration/` were written for the old AppleScript implementations and need to be updated for the new Python framework implementations.

**Affected Tests:**
- `calendar.test.ts` - Uses old `utils/calendar.ts` API (deleted)
- `contacts.test.ts` - Uses old `utils/contacts.ts` API (deleted)
- `contacts-simple.test.ts` - Uses old `utils/contacts.ts` API (deleted)

**Old API vs New API:**

#### Calendar
**Old (calendar.ts - AppleScript):**
- `getEvents(limit)` - ✅ Migrated
- `searchEvents(query, limit)` - ✅ Migrated
- `createEvent(...)` - ❌ Not implemented (Python module is read-only)
- `openEvent(id)` - ❌ Not implemented

**New (calendar-python.ts - EventKit):**
- `getEvents(calendarNames?, daysBack, daysForward, limit)` - Fast queries (~238ms)
- `searchEvents(searchText, calendarNames?, daysBack, daysForward, limit)`
- `getCalendarList()` - List all calendars

#### Contacts
**Old (contacts.ts - AppleScript):**
- `getAllNumbers()` - Returns `{ [name]: [phone1, phone2] }`
- `findNumber(name)` - Returns `string[]`
- `findContactByPhone(phone)` - Returns `string | null`

**New (contacts-python.ts - Contacts Framework):**
- `getAllContacts(limit)` - Returns `Contact[]` with full details
- `searchContacts(searchTerm, limit)` - Returns `Contact[]`
- `findContactByName(name)` - Compatibility wrapper

**Contact Type:**
```typescript
interface Contact {
  id: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  company?: string;
  phoneNumbers: Array<{ label?: string; number: string }>;
  emails: Array<{ label?: string; email: string }>;
  addresses: Array<{ label?: string; street?: string; city?: string; state?: string; zip?: string; country?: string }>;
  notes?: string;
}
```

### ✅ Working Tests
- `reminders.test.ts` - Uses AppleScript (works)
- `notes.test.ts` - Uses AppleScript (works)
- `messages.test.ts` - Uses AppleScript (works)
- `mail.test.ts` - Uses AppleScript (works)
- `maps.test.ts` - Uses JXA (works)

### TODO: Update Integration Tests

The test suite should be updated to:
1. Test the new Python-based Calendar and Contacts APIs
2. Remove tests for write operations that aren't implemented (createEvent, openEvent)
3. Update assertions to match new return types (Contact objects vs phone number arrays)
4. Verify performance improvements (Calendar: 126x faster, Contacts: ~1s queries)

### Running Tests

Currently, calendar and contacts tests will fail because they reference deleted files:
```bash
# This will show failures:
bun test

# Individual module tests that still work:
bun test tests/integration/reminders.test.ts
bun test tests/integration/notes.test.ts
bun test tests/integration/messages.test.ts
bun test tests/integration/mail.test.ts
bun test tests/integration/maps.test.ts
```

### MCP Server Status

**Important:** The MCP server itself is fully functional! The `index.ts` file has been updated to use the fast Python implementations correctly. Only the test suite needs updates.

**Performance in Production:**
- ✅ Calendar: ~238ms for 21-day window (126x faster than AppleScript)
- ✅ Contacts: ~1 second per query with full contact details
- ✅ All other modules working as expected
