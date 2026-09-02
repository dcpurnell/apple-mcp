import { describe, it, expect } from "bun:test";
import { TEST_DATA } from "../fixtures/test-data.js";
import * as contactsModule from "../../utils/contacts-python.js";

describe("Contacts Simple Tests", () => {
	describe("Basic Contacts Access", () => {
		it("should access contacts without error", async () => {
			const contacts = await contactsModule.getAllContacts(50);

			expect(Array.isArray(contacts)).toBe(true);
			console.log(`✅ Successfully accessed contacts, found ${contacts.length}`);

			// Basic structure validation
			for (const contact of contacts) {
				expect(typeof contact.id).toBe("string");
				expect(typeof contact.fullName).toBe("string");
				expect(Array.isArray(contact.phoneNumbers)).toBe(true);
				expect(Array.isArray(contact.emails)).toBe(true);
			}
		}, 30000);
	});

	describe("Contact Search", () => {
		it("should search contacts by name", async () => {
			const results = await contactsModule.searchContacts("Test", 10);

			expect(Array.isArray(results)).toBe(true);
			console.log(`✅ Search returned ${results.length} results`);

			for (const contact of results) {
				expect(typeof contact.fullName).toBe("string");
			}
		}, 15000);

		it("should handle phone number lookup gracefully", async () => {
			const contactName = await contactsModule.findContactByPhone(
				TEST_DATA.PHONE_NUMBER,
			);

			// Should return null or a string, never undefined
			expect(contactName === null || typeof contactName === "string").toBe(true);

			if (contactName) {
				console.log(
					`✅ Found contact for ${TEST_DATA.PHONE_NUMBER}: ${contactName}`,
				);
			} else {
				console.log(`ℹ️ No contact found for ${TEST_DATA.PHONE_NUMBER}`);
			}
		}, 15000);
	});

	describe("Error Handling", () => {
		it("should reject an empty search term", async () => {
			// searchContacts requires a term; an empty one is a caller error, not
			// an excuse to return every contact.
			let thrown: unknown;
			try {
				await contactsModule.searchContacts("");
			} catch (error) {
				thrown = error;
			}

			expect(thrown instanceof Error).toBe(true);
			console.log("✅ Empty search term correctly rejected");
		}, 10000);

		it("should return null for an empty phone lookup", async () => {
			const result = await contactsModule.findContactByPhone("");

			expect(result).toBeNull();
			console.log("✅ Empty phone lookup handled gracefully");
		}, 10000);
	});
});
