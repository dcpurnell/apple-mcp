# 🍎 Apple MCP - Performance Edition ⚡

> **Automation powerhouse for macOS** - Control your Apple apps with AI, 126x faster than before!

**This is an enhanced fork** of the original [apple-mcp by supermemory](https://github.com/supermemoryai/apple-mcp) with major performance improvements:

- 🚀 **126x faster Calendar** - Python EventKit (~238ms vs 30+ seconds)
- ⚡ **Fast Contacts** - Python Contacts framework (~1 second with full details)
- 📊 **Optimized Reminders** - Query incomplete items only
- 🔧 **Native macOS frameworks** - Better reliability and speed

**Original project:** Check out [supermemory MCP](https://mcp.supermemory.ai) and the [original apple-mcp](https://github.com/supermemoryai/apple-mcp)

**This fork:** <https://github.com/dcpurnell/apple-mcp>



## What Can This Thing Do?

**Basically everything you wish your Mac could do automatically (but never bothered to set up):**

### 💬 **Messages** - Because who has time to text manually?

- Send messages to anyone in your contacts (even that person you've been avoiding)
- Read your messages (finally catch up on those group chats)
- Schedule messages for later (be that organized person you pretend to be)

### 📝 **Notes** - Your brain's external hard drive

- Create notes faster than you can forget why you needed them
- Search through that digital mess you call "organized notes"
- Actually find that brilliant idea you wrote down 3 months ago

### 👥 **Contacts** - Your personal network, digitized ⚡ Python Contacts Framework

- Find anyone in your contacts without scrolling forever
- Get full contact details instantly: phone, email, address, notes
- Search by name, phone, email, or company (~1 second queries)
- Actually use that contact database you've been building for years

### 📧 **Mail** - Email like a pro (or at least pretend to)

- Send emails with attachments, CC, BCC - the whole professional shebang
- Search through your email chaos with surgical precision
- Schedule emails for later (because 3 AM ideas shouldn't be sent at 3 AM)
- Check unread counts (prepare for existential dread)

### ⏰ **Reminders** - For humans with human memory

- Create reminders with due dates (finally remember to do things)
- Search through your reminder graveyard
- List everything you've been putting off
- Open specific reminders (face your procrastination)

### 📅 **Calendar** - Time management for the chronically late (⚡ **Python EventKit - 126x faster!**)

- Create events faster than you can double-book yourself
- Search for that meeting you're definitely forgetting about
- List upcoming events (spoiler: you're probably late to something)
- Open calendar events directly (skip the app hunting)
- **Filter by specific calendars** (focus on what matters)
- **Default 21-day window** (7 days back, 14 forward - perfect for weekly reviews)
- **Lightning fast queries** (~238ms vs 30+ seconds with AppleScript)

### 🗺️ **Maps** - ⚠️ Currently Disabled

**Status:** Disabled due to Apple Maps API limitations.

**Why?** Unlike Calendar (EventKit) and Contacts (Contacts framework), Apple Maps has no native programmatic API. The previous JXA/AppleScript implementation was unreliable and returned empty results because `selectedLocation()` methods are not supported consistently.

**Future Plans:** Considering integration with alternative geocoding services (OpenStreetMap Nominatim, etc.) or waiting for Apple to provide a proper Maps framework.

## 🎭 The Magic of Chaining Commands

Here's where it gets spicy. You can literally say:

_"Read my conference notes, find contacts for the people I met, and send them a thank you message"_

And it just... **works**. Like actual magic, but with more code.

## 🚀 Installation (The Easy Way)

### Option 1: Smithery (For the Sophisticated)

```bash
npx -y install-mcp apple-mcp --client claude
```

For Cursor users (we see you):

```bash
npx -y install-mcp apple-mcp --client cursor
```

### Option 2: Manual Setup (For the Brave)

<details>
<summary>Click if you're feeling adventurous</summary>

First, get bun (if you don't have it already):

```bash
brew install oven-sh/bun/bun
```

Then add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apple-mcp": {
      "command": "bunx",
      "args": ["--no-cache", "apple-mcp@latest"]
    }
  }
}
```

**📦 Calendar & Contacts Features Require Python Frameworks**

For fast calendar and contact queries, install the Python frameworks:

```bash
pip3 install pyobjc-framework-EventKit pyobjc-framework-Contacts
```

This enables:

- ⚡ **Calendar**: Lightning-fast operations (~238ms vs 30+ seconds with AppleScript)
- ⚡ **Contacts**: Fast contact searches with full details (~1 second per query)

Without these frameworks, calendar and contact features will still work but may be significantly slower.

</details>

## ⚙️ Configuration (Customize Your Defaults)

The server uses a **local configuration file** that's gitignored, so your personal details never get committed.

### 🔧 Quick Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/dcpurnell/apple-mcp.git
   cd apple-mcp
   ```

2. Copy the example config and customize it:
   ```bash
   cp config.local.example.ts config.local.ts
   ```

3. Edit `config.local.ts` with your personal calendar and email account names:
   ```typescript
   export const DEFAULT_CALENDARS = [
     "Personal",      // Your calendar names from Calendar.app
     "Work",
     "Family",
     "Holidays"
   ];

   export const DEFAULT_MAILBOXES = [
     "you@gmail.com",        // Your email accounts from Mail.app
     "work@company.com",
     "personal@icloud.com"
   ];
   ```

4. Install and run:
   ```bash
   bun install
   bun run index.ts
   ```

**Your `config.local.ts` is gitignored** - it will never be committed or pushed to GitHub. Safe to customize!

### 📅 Finding Your Calendar Names

Open Calendar.app and look at the sidebar. Use the exact names you see there (case-sensitive).

### 📧 Finding Your Email Account Names

Open Mail.app and go to **Mail > Settings > Accounts**. Use the account names exactly as shown.

## 🎬 See It In Action

Here's a step-by-step video walkthrough: <https://x.com/DhravyaShah/status/1892694077679763671>

(Yes, it's actually as cool as it sounds)

## 🎯 Example Commands That'll Blow Your Mind

```
"Send a message to mom saying I'll be late for dinner"
```

```
"Find all my AI research notes and email them to sarah@company.com"
```

```
"Create a reminder to call the dentist tomorrow at 2pm"
```

```
"Show me my calendar for next week and create an event for coffee with Alex on Friday"
```

```
"Find the nearest pizza place and save it to my favorites"
```

## 🛠️ Local Development (For the Tinkerers)

```bash
git clone https://github.com/dcpurnell/apple-mcp.git
cd apple-mcp
bun install

# Install Python dependencies for fast Calendar & Contacts
pip3 install pyobjc-framework-EventKit pyobjc-framework-Contacts

bun run index.ts
```

Now go forth and automate your digital life! 🚀

---

### 🙏 Credits

**Original Project:** [apple-mcp by supermemory](https://github.com/supermemoryai/apple-mcp) - Made with ❤️ by [Dhravya](https://github.com/Dhravya) and the supermemory team (and honestly, claude code)

**Performance Fork:** Enhanced by [Doug Purnell](https://github.com/dcpurnell) with Python native frameworks for 126x faster operations

**Major Improvements:**
- Python EventKit for Calendar (126x speedup)
- Python Contacts framework (~1s queries vs slow AppleScript)
- Optimized Reminders queries
- Native macOS framework integration
