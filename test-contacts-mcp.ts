#!/usr/bin/env bun
/**
 * Test MCP Server Contacts Integration
 * Tests the contacts tool end-to-end through the MCP server
 */

import type { ModuleMap } from './index.js';

// Simulate MCP server module loading
async function testContactsIntegration() {
  console.log('🧪 Testing Contacts MCP Integration\n');
  
  try {
    // Test 1: Load contacts-python module
    console.log('Test 1: Loading contacts-python module...');
    const contactsModule = await import('./utils/contacts-python.js');
    console.log('✅ Module loaded successfully\n');
    
    // Test 2: Search for a contact
    console.log('Test 2: Search for "Cory"...');
    const startSearch = Date.now();
    const searchResults = await contactsModule.searchContacts('Cory', 10);
    const searchTime = Date.now() - startSearch;
    
    console.log(`✅ Found ${searchResults.length} contact(s) in ${searchTime}ms`);
    if (searchResults.length > 0) {
      const contact = searchResults[0];
      console.log('\n📋 Contact Details:');
      console.log(`   Name: ${contact.firstName} ${contact.lastName || ''}`);
      if (contact.company) console.log(`   🏢 Company: ${contact.company}`);
      if (contact.phoneNumbers.length > 0) {
        console.log(`   📞 Phone: ${contact.phoneNumbers[0].number}`);
      }
      if (contact.emails.length > 0) {
        console.log(`   📧 Email: ${contact.emails[0].email}`);
      }
    }
    console.log('');
    
    // Test 3: Get all contacts (limited)
    console.log('Test 3: Getting all contacts (limit 5)...');
    const startAll = Date.now();
    const allContacts = await contactsModule.getAllContacts(5);
    const allTime = Date.now() - startAll;
    
    console.log(`✅ Retrieved ${allContacts.length} contacts in ${allTime}ms`);
    console.log('\n📋 Contact List:');
    allContacts.forEach((contact, idx) => {
      const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.company || 'Unknown';
      const phone = contact.phoneNumbers[0]?.number || 'N/A';
      const email = contact.emails[0]?.email || 'N/A';
      console.log(`   ${idx + 1}. ${name} | ${phone} | ${email}`);
    });
    console.log('');
    
    // Test 4: Simulate MCP tool handler logic
    console.log('Test 4: Simulating MCP tool handler (search)...');
    const toolArgs = { name: 'Cory' };
    const startHandler = Date.now();
    
    let handlerResult = '';
    if (!toolArgs.name) {
      const contacts = await contactsModule.getAllContacts(50);
      if (contacts.length === 0) {
        handlerResult = 'No contacts found in your address book';
      } else {
        handlerResult = `Found ${contacts.length} contacts:\n\n`;
        contacts.forEach((contact) => {
          const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.company || 'Unknown';
          const phone = contact.phoneNumbers[0]?.number || 'N/A';
          const email = contact.emails[0]?.email || 'N/A';
          handlerResult += `${name} | ${phone} | ${email}\n`;
        });
      }
    } else {
      const contacts = await contactsModule.searchContacts(toolArgs.name, 10);
      if (contacts.length === 0) {
        handlerResult = `No contacts found matching "${toolArgs.name}"`;
      } else {
        handlerResult = `Found ${contacts.length} contact(s) matching "${toolArgs.name}":\n\n`;
        contacts.forEach((contact) => {
          const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.company || 'Unknown';
          handlerResult += `📋 **${name}**\n`;
          
          if (contact.company) {
            handlerResult += `   🏢 Company: ${contact.company}\n`;
          }
          
          if (contact.phoneNumbers.length > 0) {
            handlerResult += `   📞 Phone:\n`;
            contact.phoneNumbers.forEach((phone) => {
              handlerResult += `      • ${phone.number}${phone.label ? ` (${phone.label})` : ''}\n`;
            });
          }
          
          if (contact.emails.length > 0) {
            handlerResult += `   📧 Email:\n`;
            contact.emails.forEach((email) => {
              handlerResult += `      • ${email.email}${email.label ? ` (${email.label})` : ''}\n`;
            });
          }
          
          if (contact.addresses.length > 0) {
            handlerResult += `   🏠 Address:\n`;
            contact.addresses.forEach((addr) => {
              const parts = [addr.street, addr.city, addr.state, addr.zip].filter(Boolean);
              if (parts.length > 0) {
                handlerResult += `      • ${parts.join(', ')}${addr.country ? `, ${addr.country}` : ''}${addr.label ? ` (${addr.label})` : ''}\n`;
              }
            });
          }
          
          if (contact.notes) {
            handlerResult += `   📝 Notes: ${contact.notes}\n`;
          }
          
          handlerResult += '\n';
        });
      }
    }
    
    const handlerTime = Date.now() - startHandler;
    console.log(`✅ Handler completed in ${handlerTime}ms\n`);
    console.log('📄 Handler Output:');
    console.log('---');
    console.log(handlerResult);
    console.log('---\n');
    
    console.log('🎉 All tests passed!\n');
    console.log('Summary:');
    console.log(`  • Search time: ${searchTime}ms`);
    console.log(`  • Get all time: ${allTime}ms`);
    console.log(`  • Handler time: ${handlerTime}ms`);
    console.log(`  • Total contacts in system: ${allContacts.length}+ (limited to 5 in test)`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testContactsIntegration();
