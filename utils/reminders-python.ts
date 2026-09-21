import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import { validateText, VALIDATION_LIMITS } from "./input-validation";
import { getEventKitPython } from "./python-interpreter";

const execFileAsync = promisify(execFile);

// Configuration
const CONFIG = {
	// EventKit answers in ~250ms; this only guards against a wedged bridge
	TIMEOUT_MS: 30000,
	// Maximum reminders to return
	MAX_REMINDERS: 500,
};

// Path to the Python EventKit bridge script
// Use import.meta.url to get a reliable path regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "..", "reminders-eventkit.py");

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
	listId?: string;
	completionDate?: string | null;
	creationDate?: string | null;
	modificationDate?: string | null;
	priority?: number;
}

interface PythonRemindersResponse {
	lists?: ReminderList[];
	reminders?: Reminder[];
	reminder?: Reminder;
	list?: ReminderList;
	deleted?: boolean;
	count?: number;
	hasAccess?: boolean;
	accessDenied?: boolean;
	error?: string;
}

/**
 * Execute the Python EventKit bridge.
 *
 * The bridge exits non-zero on failure but still prints a JSON error body, so
 * parse stdout before falling back to the raw process error.
 */
async function executePythonScript(
	command: string,
	args: string[] = [],
): Promise<PythonRemindersResponse> {
	try {
		const { stdout, stderr } = await execFileAsync(
			await getEventKitPython(),
			[PYTHON_SCRIPT, command, ...args],
			{ timeout: CONFIG.TIMEOUT_MS },
		);

		if (stderr && !stderr.includes("Warning")) {
			console.warn(`Python script stderr: ${stderr}`);
		}

		return JSON.parse(stdout);
	} catch (error: any) {
		if (error && typeof error.stdout === "string" && error.stdout.trim()) {
			try {
				return JSON.parse(error.stdout);
			} catch {
				// fall through to the generic error below
			}
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Reminders EventKit error: ${message}`);
		return { error: message };
	}
}

/**
 * Throw on an error response so callers surface real failures instead of
 * returning an empty list that looks like "nothing to do".
 */
function unwrap(result: PythonRemindersResponse): PythonRemindersResponse {
	if (result.error) {
		throw new Error(result.error);
	}
	return result;
}

/**
 * Check that Reminders access is granted
 */
async function requestRemindersAccess(): Promise<{ hasAccess: boolean; message: string }> {
	const result = await executePythonScript("check_access");

	if (result.error) {
		return { hasAccess: false, message: result.error };
	}

	return { hasAccess: true, message: "Reminders access is already granted." };
}

/**
 * Get all reminder lists
 */
async function getAllLists(): Promise<ReminderList[]> {
	const result = unwrap(await executePythonScript("list_lists"));
	return result.lists || [];
}

/**
 * Get reminders from a specific list, or from every list when omitted
 * @param listName Optional list name to filter by
 */
async function getAllReminders(listName?: string): Promise<Reminder[]> {
	const result = unwrap(
		await executePythonScript("get_reminders", [
			listName || "",
			"1", // include completed
			String(CONFIG.MAX_REMINDERS),
		]),
	);
	return result.reminders || [];
}

/**
 * Get incomplete reminders from a specific list (optimized for weekly reviews)
 * @param listName Name of the list to get reminders from
 * @param includeCompleted Whether to include completed items (default: false)
 */
async function getIncompleteReminders(
	listName: string,
	includeCompleted: boolean = false,
): Promise<Reminder[]> {
	const result = unwrap(
		await executePythonScript("get_reminders", [
			listName,
			includeCompleted ? "1" : "0",
			String(CONFIG.MAX_REMINDERS),
		]),
	);
	return result.reminders || [];
}

/**
 * Search for reminders by text in the name or notes
 * @param searchText Text to search for
 */
async function searchReminders(searchText: string): Promise<Reminder[]> {
	if (!searchText || searchText.trim() === "") {
		return [];
	}

	const result = unwrap(
		await executePythonScript("search", [
			searchText,
			"1", // include completed
			String(CONFIG.MAX_REMINDERS),
		]),
	);
	return result.reminders || [];
}

/**
 * Get reminders from a specific list by ID
 * @param listId ID of the list to get reminders from
 * @param props Unused; retained for API compatibility (all props are returned)
 */
async function getRemindersFromListById(
	listId: string,
	props?: string[],
): Promise<Reminder[]> {
	const result = unwrap(
		await executePythonScript("get_by_list_id", [
			listId,
			"1", // include completed
			String(CONFIG.MAX_REMINDERS),
		]),
	);
	return result.reminders || [];
}

/**
 * Create a new reminder
 * @param name Name of the reminder
 * @param listName List to add it to (defaults to the Mac's default list)
 * @param notes Optional notes
 * @param dueDate Optional due date (ISO string)
 */
async function createReminder(
	name: string,
	listName?: string,
	notes?: string,
	dueDate?: string,
): Promise<Reminder> {
	const nameValidation = validateText(name, "Reminder name", VALIDATION_LIMITS.MAX_TEXT_SHORT);
	if (!nameValidation.isValid) {
		throw new Error(nameValidation.error);
	}

	if (listName) {
		const listValidation = validateText(
			listName,
			"List name",
			VALIDATION_LIMITS.MAX_NAME_LENGTH,
			false,
		);
		if (!listValidation.isValid) {
			throw new Error(listValidation.error);
		}
	}

	if (notes) {
		const notesValidation = validateText(
			notes,
			"Notes",
			VALIDATION_LIMITS.MAX_TEXT_MEDIUM,
			false,
		);
		if (!notesValidation.isValid) {
			throw new Error(notesValidation.error);
		}
	}

	const payload = JSON.stringify({
		name,
		listName: listName || null,
		notes: notes || null,
		dueDate: dueDate || null,
	});

	const result = await executePythonScript("create", [payload]);

	if (result.error) {
		throw new Error(`Failed to create reminder: ${result.error}`);
	}
	if (!result.reminder) {
		throw new Error("Failed to create reminder: no reminder returned");
	}

	return result.reminder;
}

/**
 * Create a reminder list if it does not already exist
 * @param name Name of the list
 */
async function createList(name: string): Promise<ReminderList> {
	const validation = validateText(name, "List name", VALIDATION_LIMITS.MAX_NAME_LENGTH);
	if (!validation.isValid) {
		throw new Error(validation.error);
	}

	const result = await executePythonScript("create_list", [name]);

	if (result.error) {
		throw new Error(`Failed to create list: ${result.error}`);
	}
	if (!result.list) {
		throw new Error("Failed to create list: no list returned");
	}

	return result.list;
}

/**
 * Delete a reminder by id
 * @param reminderId Reminder identifier, as returned by any read operation
 * @returns true if a matching reminder was found and removed
 */
async function deleteReminder(reminderId: string): Promise<boolean> {
	if (!reminderId) {
		throw new Error("Reminder id is required");
	}

	const result = await executePythonScript("delete_reminder", [reminderId]);

	if (result.error) {
		throw new Error(`Failed to delete reminder: ${result.error}`);
	}

	return Boolean(result.deleted);
}

interface OpenReminderResult {
	success: boolean;
	message: string;
	reminder?: Reminder;
}

/**
 * Open the Reminders app, returning the first reminder matching the search
 * @param searchText Text to search for in reminder names or notes
 */
async function openReminder(searchText: string): Promise<OpenReminderResult> {
	try {
		const matchingReminders = await searchReminders(searchText);

		if (matchingReminders.length === 0) {
			return { success: false, message: "No matching reminders found" };
		}

		await execFileAsync("open", ["-a", "Reminders"], { timeout: 5000 });

		return {
			success: true,
			message: "Reminders app opened",
			reminder: matchingReminders[0],
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to open reminder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export default {
	getAllLists,
	getAllReminders,
	getIncompleteReminders,
	searchReminders,
	createReminder,
	createList,
	deleteReminder,
	openReminder,
	getRemindersFromListById,
	requestRemindersAccess,
};

export type { Reminder, ReminderList };
