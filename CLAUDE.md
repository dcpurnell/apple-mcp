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
- Must be installed for the interpreter the bridge resolves to; see
  *Python Interpreter Resolution* below

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
- Must be installed for the interpreter the bridge resolves to; see
  *Python Interpreter Resolution* below

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

**MCP handler rules (index.ts):**

- **Only `content` reaches the client.** Sibling keys on the tool result
  (`reminders`, `lists`, ...) are invisible to Claude, so every operation must
  render its results into the text block. Returning just a count made
  getIncomplete useless for morning-reflection/daily-shutdown.
- **`listById` accepts `listName` as well as `listId`**: `list` is the only
  operation that hands out ids, so requiring an id made the path unreachable.
  A name resolves exact-case-insensitive first, then unique substring.
- **`props` is accepted and ignored**: every property is always returned.
- **`search` matches list titles too**, not only reminder names and notes -
  otherwise searching "Top 3" returns nothing while the list holds four items.
- `list` reports per-list counts derived from `getAllReminders`, which caps at
  500; the text says so when the cap is hit rather than under-reporting silently.

### Mail Implementation (AppleScript, delimited output)

- **Deduplicate on Message-ID**: Gmail exposes one message under INBOX,
  All Mail, Important and every label. Without dedup a single email is emitted
  once per label and consumes the caller's limit.
- **Never use top-level `mailboxes`**: it returns only mailboxes that belong to
  no account (Outbox, Deleted Messages, ...), never an account's Inbox. Iterate
  `every mailbox of account` instead. The `mailboxes` operation did exactly
  this and reported 3 mailboxes on a machine with 656.
- **`every mailbox of account` is flat, and leaf names repeat**: it already
  contains nested mailboxes, but each reports only its leaf `name` - this Mac
  has two "Projects" and three "Wellness" - so the list alone cannot say where
  a mailbox sits. `name of (container of (every mailbox of acct))` is a second
  bulk read giving every parent (`missing value` for a top-level one); the two
  together identify roots and branches, and the tree is then walked by path.
  Children are requested only from mailboxes that are somebody's parent: one
  Apple event per branch, ~0.6s for all 656, against ~14s for a per-mailbox
  walk of a single account.
- **Mail addresses a nested mailbox by path**: `mailbox "Inbox/Elon Groups/Raving Fan" of account "X"`
  resolves; `first mailbox whose name is "Inbox/Elon Groups/Raving Fan"` does
  not, because `name` is the leaf. Search resolves a mailbox by path first and
  falls back to the leaf-name lookup, so "Archive" keeps working.
- **`mailboxes` names round-trip into `mailbox`**: the listing emits
  `Account / Path/To/Folder`, and search accepts that, an account-qualified
  path, a bare path, or a bare leaf name. The account list is only consulted
  to disambiguate the unseparated `Account/Path` form.
- **A repeat loop binds a reference, not the item**: `repeat with x in list`
  makes `x is missing value` false for a missing-value element. Dereference
  with `contents of x` first - this silently dropped the account-less
  mailboxes from the listing.
- **Unread queries check `unread count` first**: it is a cheap property, and on
  a multi-account setup the vast majority of mailboxes hold nothing
  (680 mailboxes, 2 with unread here). ~30s to ~7s.
- **Search matches subject *and* sender; body is opt-in**: subject-only
  matching silently missed the commonest query there is - a person's name,
  which lives in `sender` and usually nowhere in the subject - and returned
  zero, which reads as "no such mail". `sender` is an indexed header property
  and costs nothing; `content` is not (~165ms per message, measured at 0.5s
  vs 8.5s over the same inboxes), so body matching is behind `includeBody`
  and must stay off by default, especially with `mailbox: "Archive"`.
- **A Message-ID term is matched exactly, then falls back**: a term shaped
  like a Message-ID (one token containing `@`, with `<>` or a `message://`
  wrapper stripped) is first run against `message id`, which is an indexed
  lookup. A bare email address has that same shape, so a miss falls through
  to the subject/sender search rather than returning the empty set.
- **An empty search result says what was searched**: the MCP handler appends
  which fields and which mailboxes were covered. Otherwise a miss caused by
  narrow scope is indistinguishable from mail that is not there - the same
  failure the Reminders rules guard against.
- **Search defaults to inboxes, and widens on request**: scanning one account's
  mailboxes for a subject match takes ~18 minutes, because an archive mailbox
  holds everything and labels re-expose it. Search covers each account's INBOX
  (~0.5s) unless the caller names mailboxes:
  `searchMails(term, limit, accounts, ["Archive"])`, or `mailbox: "Archive"`
  through the MCP tool (~0.7s). Naming a mailbox that exists on no account is
  reported as an error rather than returning zero results.
- **Dates are emitted as ISO-8601** via the `isoOf` handler. AppleScript's
  default coercion yields "Tuesday, September 1, 2026 at 2:10:41 PM", which
  `new Date()` cannot parse.

### Notes Implementation (AppleScript, bulk property access)

Notes has no public framework equivalent, so it stays on AppleScript - but it
must not read records or per-note properties:

- **Records do not survive**: `run-applescript` resolves to a plain string, so
  a returned AppleScript record list collapses. Scripts emit
  FIELD_SEPARATOR/RECORD_SEPARATOR delimited text (`character id 31`/`30`),
  parsed by `parseNotes`. Same pattern as `utils/mail.ts`.
- **Bulk property access**: read whole lists (`name of (notes of folder)`),
  never one note at a time. Each list is a single Apple event.
  getAllNotes went from ~16s to ~330ms; findNote from ~35s to ~1s.
- **Filter in AppleScript**: `notes whose name contains X or plaintext contains X`
  instead of reading every note's text and comparing in a loop.

Two AppleScript quirks worth remembering:

- Bulk access works on a *specifier* (`notes of currentFolder`) but not on a
  variable holding the resulting list of refs, so filters are written inline.
- `name of {}` is an error, so an empty match set must be skipped explicitly.
- `name of (container of note)` fails to coerce; bind the container first.

### Python Interpreter Resolution (shared by the three Python bridges)

`utils/python-interpreter.ts` resolves which interpreter runs the bridge
scripts. The bridges previously invoked a bare `python3` through `execFile`,
which resolves via PATH:

- **pyobjc is per-interpreter, not system-wide.** Here it exists only in
  `/Library/Frameworks/Python.framework/Versions/3.12`; `/usr/bin/python3` and
  `/opt/homebrew/bin/python3` both raise `No module named 'objc'`. So whenever
  the server started from a context with a different PATH (launchd, a GUI MCP
  client, an activated venv), Calendar, Reminders and Contacts failed together
  while Mail/Notes/Messages kept working.
- **Resolution order**: `APPLE_MCP_PYTHON` if set, then the newest
  `/Library/Frameworks/Python.framework/Versions/*/bin/python3`, then
  `/opt/homebrew`, `/usr/local`, `/usr/bin`, and finally bare `python3`.
- **Candidates are verified, not assumed**: each is probed with
  `python3 -c "import objc, EventKit"` (or `Contacts`) and the first that
  succeeds wins. Newest-first alone is not enough - 3.13 is installed here and
  lacks pyobjc, so the probe is what selects 3.12.
- **`APPLE_MCP_PYTHON` is strict**: if it is set but cannot import, that is an
  error naming the interpreter, never a silent fallback to another one.
- Resolution is cached per module set as a promise, so concurrent callers share
  one probe (~190ms once, then free). A *failed* resolution is not cached, so
  installing the dependency takes effect without restarting the server.
- A resolution failure propagates as a thrown error, matching the Reminders rule
  that a failure stays distinguishable from "nothing to do".

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
