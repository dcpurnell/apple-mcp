import { describe, it, expect, afterAll } from "bun:test";
import { TEST_DATA } from "../fixtures/test-data.js";
import { assertValidDate } from "../helpers/test-utils.js";
import * as calendarModule from "../../utils/calendar-python.js";

describe("Calendar Integration Tests", () => {
  describe("requestCalendarAccess", () => {
    it("should report calendar access", async () => {
      const result = await calendarModule.requestCalendarAccess();

      expect(typeof result.hasAccess).toBe("boolean");
      expect(typeof result.message).toBe("string");
      console.log(`Calendar access: ${result.hasAccess} (${result.message})`);
    }, 15000);
  });

  describe("getCalendarList", () => {
    it("should retrieve the available calendars", async () => {
      const calendars = await calendarModule.getCalendarList();

      expect(Array.isArray(calendars)).toBe(true);
      console.log(`Found ${calendars.length} calendars`);

      if (calendars.length === 0) {
        // Everything downstream passes vacuously in this state, so say so loudly.
        console.warn(
          "⚠️ No calendars returned. calendar-eventkit.py reports access as " +
            "granted when EventKit status is NotDetermined without actually " +
            "requesting it, so the rest of this suite is not exercising anything.",
        );
      }

      for (const calendar of calendars) {
        expect(typeof calendar.name).toBe("string");
        expect(typeof calendar.type).toBe("string");
        console.log(`  - "${calendar.name}" (${calendar.type})`);
      }
    }, 15000);
  });

  describe("getEvents", () => {
    it("should retrieve events in the default window", async () => {
      const events = await calendarModule.getEvents();

      expect(Array.isArray(events)).toBe(true);
      console.log(`Found ${events.length} events in the default 21-day window`);

      for (const event of events) {
        expect(typeof event.title).toBe("string");
        expect(typeof event.calendarName).toBe("string");
        assertValidDate(event.startDate);
        assertValidDate(event.endDate);
      }

      for (const event of events.slice(0, 5)) {
        console.log(`  - "${event.title}" (${event.calendarName})`);
      }
    }, 20000);

    it("should limit event count correctly", async () => {
      const limit = 3;
      const events = await calendarModule.getEvents(undefined, 7, 14, limit);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeLessThanOrEqual(limit);
      console.log(`Requested ${limit} events, got ${events.length}`);
    }, 15000);

    it("should return events only from the requested calendars", async () => {
      const calendars = await calendarModule.getCalendarList();

      if (calendars.length === 0) {
        console.log("ℹ️ No calendars available - skipping");
        return;
      }

      const target = calendars[0].name;
      const events = await calendarModule.getEvents([target], 30, 30, 50);

      expect(Array.isArray(events)).toBe(true);
      for (const event of events) {
        expect(event.calendarName).toBe(target);
      }
      console.log(`✅ ${events.length} events, all from "${target}"`);
    }, 20000);

  });

  // Regression: fromDate/toDate used to be converted to day offsets from now,
  // so a future window was dragged back to start at now and its end rounded up
  // by as much as a day - wrong data that looked well-formed. These windows sit
  // well away from today so a bound anchored to now cannot pass by accident.
  describe("absolute date windows", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const createdIds: string[] = [];

    // A single local day, `offset` days from today
    const dayWindow = (offset: number) => {
      const from = new Date();
      from.setDate(from.getDate() + offset);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setHours(23, 59, 0, 0);
      return { from, to };
    };

    const at = (base: Date, hours: number) => new Date(base.getTime() + hours * 60 * 60 * 1000);

    const expectInside = (
      events: { title: string; startDate: string; endDate: string }[],
      range: { from: Date; to: Date },
    ) => {
      for (const event of events) {
        const start = new Date(event.startDate).getTime();
        const end = new Date(event.endDate).getTime();
        // Overlap semantics: starts before the window closes, ends after it opens
        if (!(start < range.to.getTime() && end > range.from.getTime())) {
          throw new Error(
            `"${event.title}" (${event.startDate} - ${event.endDate}) is outside ` +
              `${range.from.toISOString()} - ${range.to.toISOString()}`,
          );
        }
      }
    };

    afterAll(async () => {
      for (const id of createdIds) {
        try {
          await calendarModule.deleteEvent(id);
        } catch (error) {
          console.warn(`Could not delete test event ${id}:`, error);
        }
      }
    });

    it("keeps a future single-day window inside both bounds", async () => {
      const range = dayWindow(16);
      const tag = `Range Test ${Date.now()}`;
      const make = async (label: string, start: Date, end: Date) => {
        const result = await calendarModule.createEvent("", `${tag} ${label}`, start, end);
        expect(result.success).toBe(true);
        createdIds.push(result.event!.id);
      };

      await make("inside", at(range.from, 10), at(range.from, 11));
      await make("overlap", at(range.from, -2), at(range.from, 1)); // 10pm the night before
      await make("before", at(range.from, -4), at(range.from, -3)); // ends before window
      await make("after", at(range.from, 24.5), at(range.from, 25.5)); // 12:30am next day

      const query = await calendarModule.getEventsInRange(undefined, range, 100);
      expectInside(query.events, range);

      const titles = query.events.map((e) => e.title);
      expect(titles).toContain(`${tag} inside`);
      expect(titles).toContain(`${tag} overlap`); // deliberate: overlapping events count
      expect(titles).not.toContain(`${tag} before`);
      expect(titles).not.toContain(`${tag} after`);

      // Sorted before the limit: limit 1 must keep the earliest, the overlap event
      const first = await calendarModule.getEventsInRange(undefined, range, 1);
      expect(first.events.map((e) => e.title)).toEqual([`${tag} overlap`]);
      expect(first.total).toBe(query.total);

      // Search goes through the same window
      const found = await calendarModule.searchEventsInRange(tag, undefined, range, 10);
      expectInside(found.events, range);
      expect(found.events.map((e) => e.title).sort()).toEqual(
        [`${tag} inside`, `${tag} overlap`].sort(),
      );
      console.log(`✅ ${query.events.length} events, all inside ${range.from.toDateString()}`);
    }, 60000);

    it("keeps a past single-day window inside both bounds", async () => {
      const range = dayWindow(-16);
      const query = await calendarModule.getEventsInRange(undefined, range, 100);
      expectInside(query.events, range);
      console.log(`✅ ${query.events.length} events, all inside ${range.from.toDateString()}`);
    }, 20000);

    it("expands recurring events once per occurrence", async () => {
      // Monday to Saturday midnight, three weeks out
      const from = new Date();
      from.setDate(from.getDate() + 21 + ((8 - from.getDay()) % 7));
      from.setHours(0, 0, 0, 0);
      const range = { from, to: new Date(from.getTime() + 5 * DAY) };

      const found = await calendarModule.searchEventsInRange(
        "Daily Shutdown", undefined, range, 50,
      );
      const hits = found.events.filter((e) => e.title === "Daily Shutdown");
      if (hits.length === 0) {
        console.log("ℹ️ No recurring \"Daily Shutdown\" event on this Mac - skipping");
        return;
      }

      expectInside(hits, range);
      const days = hits.map((e) => new Date(e.startDate).toDateString());
      expect(new Set(days).size).toBe(5);
      expect(hits.length).toBe(5);
      expect(new Set(hits.map((e) => e.id)).size).toBe(1);
      console.log(`✅ Daily Shutdown on ${days.join(", ")}; one event id`);
    }, 20000);

    it("anchors a single bound to the other bound, not to now", () => {
      const from = new Date(Date.now() + 40 * DAY);
      const onlyFrom = calendarModule.resolveDateRange(from.toISOString());
      expect(onlyFrom.from.getTime()).toBe(from.getTime());
      expect(onlyFrom.to.getTime()).toBe(from.getTime() + 21 * DAY);

      const onlyTo = calendarModule.resolveDateRange(undefined, from.toISOString());
      expect(onlyTo.to.getTime()).toBe(from.getTime());
      expect(onlyTo.from.getTime()).toBe(from.getTime() - 21 * DAY);
    });

    it("rejects an inverted or unparseable window", () => {
      expect(() =>
        calendarModule.resolveDateRange("2026-10-02T00:00:00", "2026-10-01T00:00:00"),
      ).toThrow();
      expect(() => calendarModule.resolveDateRange("not a date", undefined)).toThrow();
    });
  });

  describe("searchEvents", () => {
    it("should search events by text", async () => {
      const results = await calendarModule.searchEvents("meeting", undefined, 30, 30, 10);

      expect(Array.isArray(results)).toBe(true);
      console.log(`Found ${results.length} events matching "meeting"`);

      for (const event of results) {
        const haystack = [event.title, event.location ?? "", event.notes ?? ""]
          .join(" ")
          .toLowerCase();
        expect(haystack).toContain("meeting");
      }
    }, 20000);

    it("should handle search with no results", async () => {
      const results = await calendarModule.searchEvents("VeryUniqueEventTitle12345");

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
      console.log("✅ Handled search with no results correctly");
    }, 15000);

    it("should reject an empty search text", async () => {
      let thrown: unknown;
      try {
        await calendarModule.searchEvents("");
      } catch (error) {
        thrown = error;
      }

      expect(thrown instanceof Error).toBe(true);
      console.log("✅ Empty search text correctly rejected");
    }, 10000);
  });

  describe("createEvent", () => {
    // Events are created in a fixture calendar and removed in afterAll.
    const createdIds: string[] = [];

    afterAll(async () => {
      for (const id of createdIds) {
        try {
          await calendarModule.deleteEvent(id);
        } catch (error) {
          console.warn(`Could not delete test event ${id}:`, error);
        }
      }
      console.log(`Cleaned up ${createdIds.length} test event(s)`);
    });

    it("should create an event and read it back", async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(14, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const title = `${TEST_DATA.CALENDAR.testEvent.title} ${Date.now()}`;
      const result = await calendarModule.createEvent(
        "",
        title,
        start,
        end,
        TEST_DATA.CALENDAR.testEvent.location,
        TEST_DATA.CALENDAR.testEvent.notes,
      );

      expect(result.success).toBe(true);
      expect(result.event).toBeTruthy();
      expect(result.event!.title).toBe(title);
      expect(result.event!.location).toBe(TEST_DATA.CALENDAR.testEvent.location);
      expect(result.event!.id.length).toBeGreaterThan(0);

      createdIds.push(result.event!.id);
      console.log(`✅ Created "${title}" in "${result.event!.calendarName}"`);

      // The event must be findable by search, not just returned by create
      const found = await calendarModule.searchEvents(title, undefined, 1, 3, 10);
      expect(found.some((e) => e.title === title)).toBe(true);
      console.log("✅ Created event is retrievable via searchEvents");
    }, 20000);

    it("should create an all-day event", async () => {
      const start = new Date();
      start.setDate(start.getDate() + 2);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

      const title = `All Day Test Event ${Date.now()}`;
      const result = await calendarModule.createEvent(
        "",
        title,
        start,
        end,
        undefined,
        undefined,
        true,
      );

      expect(result.success).toBe(true);
      expect(result.event!.isAllDay).toBe(true);

      createdIds.push(result.event!.id);
      console.log(`✅ Created all-day event: "${title}"`);
    }, 20000);

    it("should reject an end date before the start date", async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(15, 0, 0, 0);
      const end = new Date(start.getTime() - 60 * 60 * 1000);

      const result = await calendarModule.createEvent("", "Invalid Range", start, end);

      expect(result.success).toBe(false);
      expect(result.message).toContain("after its start date");
      console.log("✅ Invalid time range correctly rejected");
    }, 15000);

    it("should reject an empty title", async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const result = await calendarModule.createEvent("", "", start, end);

      expect(result.success).toBe(false);
      console.log("✅ Empty title correctly rejected");
    }, 15000);

    it("should reject an unknown calendar", async () => {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      const result = await calendarModule.createEvent(
        "NoSuchCalendar12345",
        "Unknown Calendar Test",
        start,
        end,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("NoSuchCalendar12345");
      console.log("✅ Unknown calendar correctly rejected");
    }, 15000);
  });

  describe("openEvent", () => {
    it("should report an unknown event id", async () => {
      const result = await calendarModule.openEvent("non-existent-event-id-12345");

      expect(result.success).toBe(false);
      expect(typeof result.message).toBe("string");
      console.log(`✅ Unknown event id reported: ${result.message}`);
    }, 15000);

    it("should require an event id", async () => {
      const result = await calendarModule.openEvent("");

      expect(result.success).toBe(false);
      console.log("✅ Empty event id correctly rejected");
    }, 10000);
  });
});
