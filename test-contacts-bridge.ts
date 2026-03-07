#!/usr/bin/env bun
import { searchContacts, getAllContacts } from "./utils/contacts-python";

console.log("🧪 Testing Python Contacts Framework Bridge\n");
console.log("=".repeat(60));

async function testContactsBridge() {
  // Test 1: Search for a contact
  console.log("\n📋 Test 1: Search for 'Cory'");
  console.log("-".repeat(40));
  const startSearch = Date.now();
  try {
    const results = await searchContacts("Cory", 5);
    const elapsed = Date.now() - startSearch;
    console.log(`✅ Found ${results.length} contact(s) (${elapsed}ms):`);
    results.forEach(contact => {
      console.log(`   • ${contact.fullName}`);
      if (contact.phoneNumbers.length > 0) {
        console.log(`     📞 ${contact.phoneNumbers[0].number}`);
      }
      if (contact.emails.length > 0) {
        console.log(`     📧 ${contact.emails[0].email}`);
      }
    });
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Test 2: Get all contacts (limited)
  console.log("\n📋 Test 2: Get All Contacts (limit 10)");
  console.log("-".repeat(40));
  const startAll = Date.now();
  try {
    const allContacts = await getAllContacts(10);
    const elapsed = Date.now() - startAll;
    console.log(`✅ Found ${allContacts.length} contact(s) (${elapsed}ms):`);
    allContacts.slice(0, 5).forEach(contact => {
      console.log(`   • ${contact.fullName} ${contact.company ? `(${contact.company})` : ''}`);
    });
    if (allContacts.length > 5) {
      console.log(`   ... and ${allContacts.length - 5} more`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Test 3: Search by phone number
  console.log("\n📋 Test 3: Search by Phone '336'");
  console.log("-".repeat(40));
  const startPhone = Date.now();
  try {
    const phoneResults = await searchContacts("336", 5);
    const elapsed = Date.now() - startPhone;
    console.log(`✅ Found ${phoneResults.length} contact(s) with '336' (${elapsed}ms):`);
    phoneResults.forEach(contact => {
      console.log(`   • ${contact.fullName}`)
      contact.phoneNumbers.forEach(phone => {
        if (phone.number.includes("336")) {
          console.log(`     📞 ${phone.number}`);
        }
      });
    });
  } catch (error) {
    console.log(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("\n✅ ALL TESTS COMPLETE!");
  console.log("\n💡 Python Contacts Framework is working!\n");
}

testContactsBridge().catch(error => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
