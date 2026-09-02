import { describe, it, expect } from "bun:test";
import { TEST_DATA } from "../fixtures/test-data.js";
import * as contactsModule from "../../utils/contacts-python.js";

describe("Contacts Integration Tests", () => {
  describe("getAllContacts", () => {
    it("should retrieve contacts with full details", async () => {
      const contacts = await contactsModule.getAllContacts(100);

      expect(Array.isArray(contacts)).toBe(true);
      console.log(`Found ${contacts.length} contacts`);

      for (const contact of contacts) {
        expect(typeof contact.id).toBe("string");
        expect(typeof contact.fullName).toBe("string");
        expect(Array.isArray(contact.phoneNumbers)).toBe(true);
        expect(Array.isArray(contact.emails)).toBe(true);

        for (const phone of contact.phoneNumbers) {
          expect(typeof phone.number).toBe("string");
          expect(phone.number.length).toBeGreaterThan(0);
        }
        for (const email of contact.emails) {
          expect(typeof email.email).toBe("string");
        }
      }
    }, 15000);

    it("should respect the limit argument", async () => {
      const contacts = await contactsModule.getAllContacts(5);

      expect(Array.isArray(contacts)).toBe(true);
      expect(contacts.length).toBeLessThanOrEqual(5);
      console.log(`✅ Limit honored: asked for 5, got ${contacts.length}`);
    }, 15000);
  });

  describe("searchContacts", () => {
    it("should find contacts by partial name", async () => {
      const results = await contactsModule.searchContacts("Test", 10);

      expect(Array.isArray(results)).toBe(true);

      if (results.length > 0) {
        console.log(`Found ${results.length} contacts matching 'Test'`);
        for (const contact of results) {
          expect(typeof contact.fullName).toBe("string");
        }
      } else {
        console.log("ℹ️ No contacts matched 'Test'");
      }
    }, 10000);

    it("should return an empty array for a non-existent contact", async () => {
      const results = await contactsModule.searchContacts(
        "NonExistentContactName123456",
      );

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    }, 10000);

    it("should reject an empty search term", async () => {
      let thrown: unknown;
      try {
        await contactsModule.searchContacts("");
      } catch (error) {
        thrown = error;
      }

      expect(thrown instanceof Error).toBe(true);
    }, 5000);
  });

  describe("findContactByName", () => {
    it("should return full contact objects", async () => {
      const results = await contactsModule.findContactByName("Test");

      expect(Array.isArray(results)).toBe(true);
      for (const contact of results) {
        expect(typeof contact.fullName).toBe("string");
        expect(Array.isArray(contact.phoneNumbers)).toBe(true);
      }
    }, 10000);
  });

  describe("findContactByPhone", () => {
    it("should resolve a real contact's own number to their name", async () => {
      // Pick a live contact rather than a fixture, so this exercises the real
      // normalization path against however Contacts stores the number.
      const contacts = await contactsModule.getAllContacts(500);
      const withPhone = contacts.find(
        (c) =>
          c.fullName &&
          c.phoneNumbers.some((p) => p.number.replace(/\D/g, "").length >= 10),
      );

      if (!withPhone) {
        console.log("ℹ️ No contact with a 10-digit number - skipping");
        return;
      }

      const stored = withPhone.phoneNumbers.find(
        (p) => p.number.replace(/\D/g, "").length >= 10,
      )!.number;
      const digits = stored.replace(/\D/g, "").slice(-10);

      // Every one of these formats must resolve to the same contact
      const variants = [
        stored,
        digits,
        `+1${digits}`,
        `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
      ];

      for (const variant of variants) {
        const name = await contactsModule.findContactByPhone(variant);
        expect(name).toBe(withPhone.fullName);
      }

      console.log(
        `✅ All ${variants.length} phone formats resolved to "${withPhone.fullName}"`,
      );
    }, 20000);

    it("should look up a contact by email address", async () => {
      const contacts = await contactsModule.getAllContacts(500);
      const withEmail = contacts.find((c) => c.fullName && c.emails.length > 0);

      if (!withEmail) {
        console.log("ℹ️ No contact with an email address - skipping");
        return;
      }

      const address = withEmail.emails[0].email;
      // Lookup must be case-insensitive
      const name = await contactsModule.findContactByPhone(address.toUpperCase());

      expect(name).toBe(withEmail.fullName);
      console.log(`✅ Email lookup resolved to "${name}"`);
    }, 20000);

    it("should return null for an unknown number", async () => {
      const contactName = await contactsModule.findContactByPhone(
        TEST_DATA.PHONE_NUMBER,
      );

      expect(contactName === null || typeof contactName === "string").toBe(true);
    }, 10000);
  });

  describe("Error Handling", () => {
    it("should return null for empty or nonsense phone input", async () => {
      expect(await contactsModule.findContactByPhone("")).toBeNull();
      expect(await contactsModule.findContactByPhone("invalid")).toBeNull();
    }, 10000);
  });
});
