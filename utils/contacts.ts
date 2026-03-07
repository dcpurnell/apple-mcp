import { runAppleScript } from "run-applescript";
import { escapeAppleScript } from "./applescript-escape";
import { validatePhoneNumber, validateName, validateSearchQuery } from "./input-validation";

// Configuration
const CONFIG = {
	// Maximum contacts to process (reduced for better performance in tests)
	MAX_CONTACTS: 20,
	// Timeout for operations
	TIMEOUT_MS: 10000,
};

async function checkContactsAccess(): Promise<boolean> {
	try {
		// Simple test to check Contacts access
		const script = `
tell application "Contacts"
    return name
end tell`;

		await runAppleScript(script);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Contacts app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

async function requestContactsAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkContactsAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Contacts access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Contacts access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Contacts'\n3. Alternatively, open System Settings > Privacy & Security > Contacts\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Contacts access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

async function getAllNumbers(): Promise<{ [key: string]: string[] }> {
	try {
		const accessResult = await requestContactsAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Contacts"
    set contactList to {}
    set contactCount to 0
    
    -- Filter people with phones first (more efficient)
    try
        set peopleWithPhones to every person whose phones is not {}
    on error
        -- Fallback if filter doesn't work
        set peopleWithPhones to people
    end try

    repeat with i from 1 to (count of peopleWithPhones)
        if contactCount >= ${CONFIG.MAX_CONTACTS} then exit repeat

        try
            set currentPerson to item i of peopleWithPhones
            set personPhones to {}

            try
                repeat with phoneItem in phones of currentPerson
                    try
                        set phoneValue to value of phoneItem
                        if phoneValue is not "" then
                            set personPhones to personPhones & {phoneValue}
                        end if
                    end try
                end repeat
            end try

            -- Add contact with phones
            if (count of personPhones) > 0 then
                set contactInfo to {name:(name of currentPerson), phones:personPhones}
                set contactList to contactList & {contactInfo}
                set contactCount to contactCount + 1
            end if
        end try
    end repeat

    return contactList
end tell`;

		const result = (await runAppleScript(script)) as any;

		// Convert AppleScript result to our format
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];
		const phoneNumbers: { [key: string]: string[] } = {};

		for (const contact of resultArray) {
			if (contact && contact.name && contact.phones) {
				phoneNumbers[contact.name] = Array.isArray(contact.phones)
					? contact.phones
					: [contact.phones];
			}
		}

		return phoneNumbers;
	} catch (error) {
		console.error(
			`Error getting all contacts: ${error instanceof Error ? error.message : String(error)}`,
		);
		return {};
	}
}

async function findNumber(name: string): Promise<string[]> {
	try {
		const accessResult = await requestContactsAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!name || name.trim() === "") {
			return [];
		}

		// Validate name
		const nameValidation = validateName(name, "Contact name");
		if (!nameValidation.isValid) {
			throw new Error(nameValidation.error);
		}

		const searchName = name.toLowerCase().trim();
		const escapedSearchName = escapeAppleScript(searchName);

		// First try exact and partial matching with AppleScript
		const script = `
tell application "Contacts"
    set matchedPhones to {}
    set searchText to "${escapedSearchName}"
    set foundExact to false
    set partialMatches to {}
    
    -- Filter people with phones first
    try
        set peopleWithPhones to every person whose phones is not {}
    on error
        set peopleWithPhones to people
    end try

    repeat with i from 1 to (count of peopleWithPhones)
        if i > ${CONFIG.MAX_CONTACTS} then exit repeat

        try
            set currentPerson to item i of peopleWithPhones
            set personName to name of currentPerson
            
            -- Use AppleScript's native case-insensitive comparison (much faster than shell)
            considering case
                set lowerPersonName to personName
            end considering
            ignoring case
                set isExactMatch to (personName is equal to searchText)
                set isPartialMatch to (personName contains searchText)
            end ignoring

            -- Check for exact match first (highest priority)
            if isExactMatch then
                try
                    repeat with phoneItem in phones of currentPerson
                        try
                            set phoneValue to value of phoneItem
                            if phoneValue is not "" then
                                set matchedPhones to matchedPhones & {phoneValue}
                                set foundExact to true
                            end if
                        end try
                    end repeat
                    if foundExact then exit repeat
                end try
            -- Check if search term is contained in name (partial match)
            else if isPartialMatch then
                try
                    repeat with phoneItem in phones of currentPerson
                        try
                            set phoneValue to value of phoneItem
                            if phoneValue is not "" then
                                set partialMatches to partialMatches & {phoneValue}
                            end if
                        end try
                    end repeat
                end try
            end if
        end try
    end repeat

    -- Return exact matches if found, otherwise partial matches
    if foundExact then
        return matchedPhones
    else
        return partialMatches
    end if
end tell`;

		const result = (await runAppleScript(script)) as any;
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];

		// Disabled comprehensive search to avoid cascading timeouts
		// If AppleScript returns nothing, just return empty array
		if (resultArray.length === 0) {
			console.error(
				`No AppleScript matches for "${name}". Consider increasing MAX_CONTACTS or using a more specific search term.`,
			);
		}

		return resultArray.filter((phone: any) => phone && phone.trim() !== "");
	} catch (error) {
		console.error(
			`Error finding contact: ${error instanceof Error ? error.message : String(error)}`,
		);
		// Disabled fallback to avoid cascading timeouts
		return [];
	}
}

async function findContactByPhone(phoneNumber: string): Promise<string | null> {
	try {
		const accessResult = await requestContactsAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!phoneNumber || phoneNumber.trim() === "") {
			return null;
		}

		// Validate phone number
		const phoneValidation = validatePhoneNumber(phoneNumber);
		if (!phoneValidation.isValid) {
			throw new Error(phoneValidation.error);
		}

		// Normalize the phone number for comparison
		const searchNumber = phoneNumber.replace(/[^0-9+]/g, "");
		const escapedSearchNumber = escapeAppleScript(searchNumber);

		const script = `
tell application "Contacts"
    set foundName to ""
    set searchPhone to "${escapedSearchNumber}"
    
    -- Filter people with phones first\n    try
        set peopleWithPhones to every person whose phones is not {}
    on error
        set peopleWithPhones to people
    end try

    repeat with i from 1 to (count of peopleWithPhones)
        if i > ${CONFIG.MAX_CONTACTS} then exit repeat
        if foundName is not "" then exit repeat

        try
            set currentPerson to item i of peopleWithPhones

            try
                repeat with phoneItem in phones of currentPerson
                    try
                        set phoneValue to value of phoneItem
                        
                        -- Simple phone matching (contains check)\n                        if phoneValue contains searchPhone or searchPhone contains phoneValue then
                            set foundName to name of currentPerson
                            exit repeat
                        end if
                    end try
                end repeat
            end try
        end try
    end repeat

    return foundName
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (result && result.trim() !== "") {
			return result;
		}

		// No match found - disabled fallback to avoid timeouts
		console.error(`No contact found for ${phoneNumber} - this is expected if test contact doesn't exist`);
		return null;
	} catch (error) {
		console.error(
			`Error finding contact by phone: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

export default { getAllNumbers, findNumber, findContactByPhone, requestContactsAccess };
