#!/usr/bin/env python3
"""
Contacts Framework Bridge for apple-mcp
Uses native macOS Contacts framework (much faster than AppleScript)
Requires: pip3 install pyobjc-framework-Contacts
"""

import sys
import json
import Contacts
from Foundation import NSPredicate

def request_contacts_access(store):
    """Check contacts access (synchronous)"""
    status = Contacts.CNContactStore.authorizationStatusForEntityType_(
        Contacts.CNEntityTypeContacts
    )
    
    if status == Contacts.CNAuthorizationStatusAuthorized:
        return True
    elif status == Contacts.CNAuthorizationStatusDenied or status == Contacts.CNAuthorizationStatusRestricted:
        return False
    else:
        # Not determined - request will happen on first query
        return True

def get_all_contacts(store, limit=1000):
    """
    Fetch all contacts with key information
    
    Args:
        store: CNContactStore instance
        limit: Maximum number of contacts to return
    
    Returns:
        List of contact dictionaries
    """
    try:
        # Define which contact properties to fetch
        keys = [
            Contacts.CNContactGivenNameKey,
            Contacts.CNContactFamilyNameKey,
            Contacts.CNContactMiddleNameKey,
            Contacts.CNContactNicknameKey,
            Contacts.CNContactOrganizationNameKey,
            Contacts.CNContactJobTitleKey,
            Contacts.CNContactPhoneNumbersKey,
            Contacts.CNContactEmailAddressesKey,
            Contacts.CNContactPostalAddressesKey,
            Contacts.CNContactBirthdayKey,
            Contacts.CNContactNoteKey,
            Contacts.CNContactIdentifierKey
        ]
        
        # Create fetch request
        fetch_request = Contacts.CNContactFetchRequest.alloc().initWithKeysToFetch_(keys)
        
        contacts = []
        
        def process_contact(contact, stop_ptr):
            """Callback for each contact"""
            if len(contacts) >= limit:
                return  # Just return, don't try to modify stop
            
            # Extract phone numbers
            phone_numbers = []
            for phone in contact.phoneNumbers():
                phone_numbers.append({
                    'label': str(phone.label() or 'other'),
                    'number': str(phone.value().stringValue())
                })
            
            # Extract email addresses
            emails = []
            for email in contact.emailAddresses():
                emails.append({
                    'label': str(email.label() or 'other'),
                    'email': str(email.value())
                })
            
            # Extract postal addresses
            addresses = []
            for addr in contact.postalAddresses():
                postal_addr = addr.value()
                addresses.append({
                    'label': str(addr.label() or 'other'),
                    'street': str(postal_addr.street() or ''),
                    'city': str(postal_addr.city() or ''),
                    'state': str(postal_addr.state() or ''),
                    'postalCode': str(postal_addr.postalCode() or ''),
                    'country': str(postal_addr.country() or '')
                })
            
            # Build contact dictionary
            contact_dict = {
                'id': str(contact.identifier()),
                'firstName': str(contact.givenName() or ''),
                'lastName': str(contact.familyName() or ''),
                'middleName': str(contact.middleName() or ''),
                'nickname': str(contact.nickname() or ''),
                'company': str(contact.organizationName() or ''),
                'jobTitle': str(contact.jobTitle() or ''),
                'phoneNumbers': phone_numbers,
                'emails': emails,
                'addresses': addresses,
                'notes': str(contact.note() or '')
            }
            
            # Build display name
            full_name_parts = [
                contact_dict['firstName'],
                contact_dict['middleName'],
                contact_dict['lastName']
            ]
            contact_dict['fullName'] = ' '.join([p for p in full_name_parts if p]).strip()
            
            if not contact_dict['fullName'] and contact_dict['company']:
                contact_dict['fullName'] = contact_dict['company']
            
            if contact_dict['fullName']:  # Only add contacts with names
                contacts.append(contact_dict)
        
        # Execute fetch
        success = store.enumerateContactsWithFetchRequest_error_usingBlock_(
            fetch_request, None, process_contact
        )
        
        # Limit results
        return contacts[:limit]
        
    except Exception as e:
        raise Exception(f"Error fetching contacts: {str(e)}")

def search_contacts(store, search_term, limit=50):
    """
    Search contacts by name, email, phone, or company
    
    Args:
        store: CNContactStore instance
        search_term: Text to search for
        limit: Maximum results
    
    Returns:
        List of matching contact dictionaries
    """
    try:
        # Get all contacts and filter (Contacts framework doesn't have great search predicates)
        all_contacts = get_all_contacts(store, limit=2000)
        
        search_lower = search_term.lower()
        matches = []
        
        for contact in all_contacts:
            # Search in name fields
            if (search_lower in contact['fullName'].lower() or
                search_lower in contact['firstName'].lower() or
                search_lower in contact['lastName'].lower() or
                search_lower in contact['nickname'].lower() or
                search_lower in contact['company'].lower()):
                matches.append(contact)
                if len(matches) >= limit:
                    break
                continue
            
            # Search in phone numbers
            for phone in contact['phoneNumbers']:
                if search_lower in phone['number'].lower():
                    matches.append(contact)
                    if len(matches) >= limit:
                        break
                    break
            
            if len(matches) >= limit:
                break
            
            # Search in emails
            for email in contact['emails']:
                if search_lower in email['email'].lower():
                    matches.append(contact)
                    if len(matches) >= limit:
                        break
                    break
            
            if len(matches) >= limit:
                break
        
        return matches
        
    except Exception as e:
        raise Exception(f"Error searching contacts: {str(e)}")

def get_contact_by_id(store, contact_id):
    """Get a specific contact by ID"""
    try:
        keys = [
            Contacts.CNContactGivenNameKey,
            Contacts.CNContactFamilyNameKey,
            Contacts.CNContactMiddleNameKey,
            Contacts.CNContactNicknameKey,
            Contacts.CNContactOrganizationNameKey,
            Contacts.CNContactJobTitleKey,
            Contacts.CNContactPhoneNumbersKey,
            Contacts.CNContactEmailAddressesKey,
            Contacts.CNContactPostalAddressesKey,
            Contacts.CNContactBirthdayKey,
            Contacts.CNContactNoteKey,
            Contacts.CNContactIdentifierKey
        ]
        
        contact = store.unifiedContactWithIdentifier_keysToFetch_error_(
            contact_id, keys, None
        )[0]
        
        if contact:
            # Convert to dictionary (simplified version of get_all_contacts logic)
            return {
                'id': str(contact.identifier()),
                'firstName': str(contact.givenName() or ''),
                'lastName': str(contact.familyName() or ''),
                'fullName': f"{contact.givenName() or ''} {contact.familyName() or ''}".strip()
            }
        
        return None
        
    except Exception as e:
        raise Exception(f"Error fetching contact: {str(e)}")

def main():
    """CLI interface"""
    if len(sys.argv) < 2:
        print(json.dumps({
            'error': 'Usage: python3 contacts-framework.py <command> [args...]',
            'commands': {
                'list_all': 'List all contacts (optional: limit)',
                'search': 'Search contacts (args: search_term limit)'
            }
        }))
        sys.exit(1)
    
    command = sys.argv[1]
    
    # Initialize store
    store = Contacts.CNContactStore.alloc().init()
    
    # Check access
    if not request_contacts_access(store):
        print(json.dumps({
            'error': 'Contacts access denied. Grant permission in System Settings > Privacy & Security > Contacts'
        }))
        sys.exit(1)
    
    try:
        if command == 'list_all':
            limit = int(sys.argv[2]) if len(sys.argv) > 2 else 1000
            contacts = get_all_contacts(store, limit)
            print(json.dumps({
                'contacts': contacts,
                'count': len(contacts)
            }))
        
        elif command == 'search':
            if len(sys.argv) < 3:
                print(json.dumps({'error': 'search requires search_term argument'}))
                sys.exit(1)
            
            search_term = sys.argv[2]
            limit = int(sys.argv[3]) if len(sys.argv) > 3 else 50
            
            contacts = search_contacts(store, search_term, limit)
            print(json.dumps({
                'contacts': contacts,
                'count': len(contacts),
                'searchTerm': search_term
            }))
        
        else:
            print(json.dumps({'error': f'Unknown command: {command}'}))
            sys.exit(1)
    
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
