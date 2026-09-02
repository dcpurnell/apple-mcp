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

    it("should honor the date range window", async () => {
      const daysBack = 3;
      const daysForward = 3;
      const events = await calendarModule.getEvents(
        undefined,
        daysBack,
        daysForward,
        100,
      );

      expect(Array.isArray(events)).toBe(true);

      // Allow a day of slack for all-day events and timezone edges
      const lowerBound = Date.now() - (daysBack + 1) * 24 * 60 * 60 * 1000;
      const upperBound = Date.now() + (daysForward + 1) * 24 * 60 * 60 * 1000;

      for (const event of events) {
        const start = new Date(event.startDate).getTime();
        expect(start).toBeGreaterThanOrEqual(lowerBound);
        expect(start).toBeLessThanOrEqual(upperBound);
      }
      console.log(`✅ All ${events.length} events fall inside the ±3 day window`);
    }, 20000);
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
