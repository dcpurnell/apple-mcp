import { runAppleScript } from "run-applescript";
import { escapeAppleScript } from "./applescript-escape";
import { validateText, validateSearchQuery, VALIDATION_LIMITS } from "./input-validation";

// Configuration
const CONFIG = {
	// Maximum reminders to process (to avoid performance issues)
	MAX_REMINDERS: 5, // Very aggressive limit for performance
	// Maximum lists to process
	MAX_LISTS: 2, // Very aggressive limit for performance
	// Timeout for operations (in milliseconds)
	TIMEOUT_MS: 20000, // Increased timeout for slow operations
	// Maximum reminders per list to scan
	MAX_PER_LIST: 2, // Very aggressive limit for performance
};

/**
 * Run AppleScript with a timeout to prevent hangs
 */
async function runAppleScriptWithTimeout(script: string, timeoutMs: number = CONFIG.TIMEOUT_MS): Promise<any> {
	return Promise.race([
		runAppleScript(script),
		new Promise((_, reject) => 
			setTimeout(() => reject(new Error('AppleScript operation timed out')), timeoutMs)
		)
	]);
}

// Define types for our reminders
interface ReminderList {
	name: string;
	id: string;
}

interface Reminder {
	name: string;
	id: string;
	body: string;
	completed: boolean;
	dueDate: string | null;
	listName: string;
	completionDate?: string | null;
	creationDate?: string | null;
	modificationDate?: string | null;
	remindMeDate?: string | null;
	priority?: number;
}

/**
 * Check if Reminders app is accessible
 */
async function checkRemindersAccess(): Promise<boolean> {
	try {
		const script = `
tell application "Reminders"
    return name
end tell`;

		await runAppleScriptWithTimeout(script, 2000); // Short timeout for access check
		return true;
	} catch (error) {
		console.error(
			`Cannot access Reminders app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Reminders app access and provide instructions if not available
 */
async function requestRemindersAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkRemindersAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Reminders access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Reminders access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Reminders'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Reminders access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

/**
 * Get all reminder lists (limited for performance)
 * @returns Array of reminder lists with their names and IDs
 */
async function getAllLists(): Promise<ReminderList[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Reminders"
    set listArray to {}
    set listCount to 0
    
    try
        set allLists to lists
        
        -- Process limited number of lists for performance
        repeat with i from 1 to (count of allLists)
            if listCount >= ${CONFIG.MAX_LISTS} then exit repeat
            
            try
                set currentList to item i of allLists
                set listInfo to {|name|:(name of currentList), id:(id of currentList)}
                set listArray to listArray & {listInfo}
                set listCount to listCount + 1
            end try
        end repeat
    end try
    
    return listArray
end tell`;

		const result = await runAppleScriptWithTimeout(script, CONFIG.TIMEOUT_MS);

		// Convert AppleScript result to our format
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];

		return resultArray.map((listData: any) => ({
			name: listData.name || "Untitled List",
			id: listData.id || "unknown-id",
		}));
	} catch (error) {
		console.error(
			`Error getting reminder lists: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Get all reminders from a specific list or all lists
 * @param listName Optional list name to filter by
 * @returns Array of reminders
 */
async function getAllReminders(listName?: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Simplified approach: process limited lists and reminders
		const script = `
tell application "Reminders"
    set reminderArray to {}
    set reminderCount to 0
    set listsProcessed to 0
    
    try
        set targetLists to lists
        
        -- Process limited lists and reminders for performance
        repeat with i from 1 to (count of targetLists)
            if listsProcessed >= ${CONFIG.MAX_LISTS} then exit repeat
            if reminderCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
            
            try
                set currentList to item i of targetLists
                set currentListName to name of currentList
                set allReminders to reminders of currentList
                set reminderCountInList to 0
                
                repeat with j from 1 to (count of allReminders)
                    if reminderCount >= ${CONFIG.MAX_REMINDERS} then exit repeat
                    if reminderCountInList >= ${CONFIG.MAX_PER_LIST} then exit repeat
                    
                    try
                        set currentReminder to item j of allReminders
                        
                        -- Get due date if exists
                        set reminderDueDate to missing value
                        try
                            set reminderDueDate to due date of currentReminder
                        end try
                        
                        set reminderInfo to {¬
                            |name|:(name of currentReminder), ¬
                            id:(id of currentReminder), ¬
                            body:(body of currentReminder), ¬
                            completed:(completed of currentReminder), ¬
                            listName:currentListName¬
                        }
                        
                        if reminderDueDate is not missing value then
                            set reminderInfo to reminderInfo & {dueDate:(reminderDueDate as string)}
                        else
                            set reminderInfo to reminderInfo & {dueDate:missing value}
                        end if
                        
                        set reminderArray to reminderArray & {reminderInfo}
                        set reminderCount to reminderCount + 1
                        set reminderCountInList to reminderCountInList + 1
                    end try
                end repeat
                
                set listsProcessed to listsProcessed + 1
            end try
        end repeat
    end try
    
    return reminderArray
end tell`;

		const result = await runAppleScriptWithTimeout(script, CONFIG.TIMEOUT_MS);

		// Convert AppleScript result to our format
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];

		let reminders = resultArray.map((reminderData: any) => ({
			name: reminderData.name || "Untitled",
			id: reminderData.id || "unknown-id",
			body: reminderData.body || "",
			completed: reminderData.completed || false,
			dueDate: reminderData.dueDate && reminderData.dueDate !== "missing value" ? reminderData.dueDate : null,
			listName: reminderData.listName || "Unknown List",
		}));

		// Filter by list name in JavaScript (case-insensitive) to avoid AppleScript hangs
		if (listName) {
			const searchName = listName.toLowerCase();
			reminders = reminders.filter(reminder => 
				reminder.listName.toLowerCase() === searchName
			);
		}

		return reminders;
	} catch (error) {
		console.error(
			`Error getting reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Search for reminders by text
 * @param searchText Text to search for in reminder names or notes
 * @returns Array of matching reminders
 */
async function searchReminders(searchText: string): Promise<Reminder[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!searchText || searchText.trim() === "") {
			return [];
		}

		// Get all reminders then filter them in JavaScript for better performance
		const allReminders = await getAllReminders();
		const searchLower = searchText.toLowerCase();

		return allReminders.filter(reminder => 
			reminder.name.toLowerCase().includes(searchLower) ||
			reminder.body.toLowerCase().includes(searchLower)
		);
	} catch (error) {
		console.error(
			`Error searching reminders: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Create a new reminder (simplified for performance)
 * @param name Name of the reminder
 * @param listName Name of the list to add the reminder to (creates if doesn't exist)
 * @param notes Optional notes for the reminder
 * @param dueDate Optional due date for the reminder (ISO string)
 * @returns The created reminder
 */
async function createReminder(
	name: string,
	listName: string = "Reminders",
	notes?: string,
	dueDate?: string,
): Promise<Reminder> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Validate inputs
		const nameValidation = validateText(name, "Reminder name", VALIDATION_LIMITS.MAX_TEXT_SHORT);
		if (!nameValidation.isValid) {
			throw new Error(nameValidation.error);
		}

		const listValidation = validateText(listName, "List name", VALIDATION_LIMITS.MAX_NAME_LENGTH, false);
		if (!listValidation.isValid) {
			throw new Error(listValidation.error);
		}

		if (notes) {
			const notesValidation = validateText(notes, "Notes", VALIDATION_LIMITS.MAX_TEXT_MEDIUM, false);
			if (!notesValidation.isValid) {
				throw new Error(notesValidation.error);
			}
		}

		const cleanName = escapeAppleScript(name);
		const cleanListName = escapeAppleScript(listName);
		const cleanNotes = notes ? escapeAppleScript(notes) : "";

		const script = `
tell application "Reminders"
    try
        -- Use first available list for performance
        set allLists to lists
        if (count of allLists) > 0 then
            set targetList to first item of allLists
            
            -- Create reminder with name only (simplest/fastest)
            set newReminder to make new reminder at end of reminders of targetList with properties {name:"${cleanName}"}
            return "SUCCESS:" & (name of targetList)
        else
            return "ERROR:No lists available"
        end if
    on error errorMessage
        return "ERROR:" & errorMessage
    end try
end tell`;

		const result = await runAppleScriptWithTimeout(script, CONFIG.TIMEOUT_MS) as string;

		if (result && result.startsWith("SUCCESS:")) {
			const actualListName = result.replace("SUCCESS:", "");

			return {
				name: name,
				id: "created-reminder-id",
				body: notes || "",
				completed: false,
				dueDate: dueDate || null,
				listName: actualListName,
			};
		} else {
			throw new Error(`Failed to create reminder: ${result}`);
		}
	} catch (error) {
		throw new Error(
			`Failed to create reminder: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

interface OpenReminderResult {
	success: boolean;
	message: string;
	reminder?: Reminder;
}

/**
 * Open the Reminders app and show a specific reminder (simplified)
 * @param searchText Text to search for in reminder names or notes
 * @returns Result of the operation
 */
async function openReminder(searchText: string): Promise<OpenReminderResult> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			return { success: false, message: accessResult.message };
		}

		// First search for the reminder
		const matchingReminders = await searchReminders(searchText);

		if (matchingReminders.length === 0) {
			return { success: false, message: "No matching reminders found" };
		}

		// Open the Reminders app
		const script = `
tell application "Reminders"
    activate
    return "SUCCESS"
end tell`;

		const result = await runAppleScriptWithTimeout(script, 3000) as string; // Short timeout for activation

		if (result === "SUCCESS") {
			return {
				success: true,
				message: "Reminders app opened",
				reminder: matchingReminders[0],
			};
		} else {
			return { success: false, message: "Failed to open Reminders app" };
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to open reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get reminders from a specific list by ID
 * @param listId ID of the list to get reminders from
 * @param props Array of properties to include (optional)
 * @returns Array of reminders with requested properties
 */
async function getRemindersFromListById(
	listId: string,
	props?: string[],
): Promise<any[]> {
	try {
		const accessResult = await requestRemindersAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const cleanListId = escapeAppleScript(listId);

		const script = `
tell application "Reminders"
    set reminderArray to {}
    set reminderCount to 0
    
    try
        -- Find list by ID
        set targetList to first list whose id is "${cleanListId}"
        set currentListName to name of targetList
        set allReminders to reminders of targetList
        
        repeat with i from 1 to (count of allReminders)
            if reminderCount >= ${CONFIG.MAX_PER_LIST} then exit repeat
            
            try
                set currentReminder to item i of allReminders
                
                -- Get due date if exists
                set reminderDueDate to missing value
                try
                    set reminderDueDate to due date of currentReminder
                end try
                
                -- Get completion date if completed
                set completionDateValue to missing value
                set isCompleted to completed of currentReminder
                if isCompleted then
                    try
                        set completionDateValue to completion date of currentReminder
                    end try
                end if
                
                -- Get priority
                set priorityValue to 0
                try
                    set priorityValue to priority of currentReminder
                end try
                
                set reminderInfo to {\u00ac
                    |name|:(name of currentReminder), \u00ac
                    id:(id of currentReminder), \u00ac
                    body:(body of currentReminder), \u00ac
                    completed:isCompleted, \u00ac
                    listName:currentListName, \u00ac
                    priority:priorityValue\u00ac
                }
                
                if reminderDueDate is not missing value then
                    set reminderInfo to reminderInfo & {dueDate:(reminderDueDate as string)}
                else
                    set reminderInfo to reminderInfo & {dueDate:missing value}
                end if
                
                if completionDateValue is not missing value then
                    set reminderInfo to reminderInfo & {completionDate:(completionDateValue as string)}
                else
                    set reminderInfo to reminderInfo & {completionDate:missing value}
                end if
                
                set reminderArray to reminderArray & {reminderInfo}
                set reminderCount to reminderCount + 1
            end try
        end repeat
        
        return reminderArray
    on error
        return {}
    end try
end tell`;

		const result = await runAppleScriptWithTimeout(script, CONFIG.TIMEOUT_MS);

		// Convert AppleScript result to our format
		const resultArray = Array.isArray(result) ? result : result ? [result] : [];

		return resultArray.map((reminderData: any) => {
			const baseReminder: any = {
				name: reminderData.name || "Untitled",
				id: reminderData.id || "unknown-id",
				body: reminderData.body || "",
				completed: reminderData.completed || false,
				listName: reminderData.listName || "Unknown List",
			};

			// Add optional properties based on what was requested or what's available
			if (reminderData.dueDate && reminderData.dueDate !== "missing value") {
				baseReminder.dueDate = reminderData.dueDate;
			} else {
				baseReminder.dueDate = null;
			}

			if (reminderData.completionDate && reminderData.completionDate !== "missing value") {
				baseReminder.completionDate = reminderData.completionDate;
			}

			if (reminderData.priority !== undefined) {
				baseReminder.priority = reminderData.priority;
			}

			return baseReminder;
		});
	} catch (error) {
		console.error(
			`Error getting reminders from list by ID: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

export default {
	getAllLists,
	getAllReminders,
	searchReminders,
	createReminder,
	openReminder,
	getRemindersFromListById,
	requestRemindersAccess,
};
