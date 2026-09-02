import { runAppleScript } from "run-applescript";
import { escapeAppleScript, getSecureTempFile } from "./applescript-escape";
import { validateText, validateSearchQuery, VALIDATION_LIMITS } from "./input-validation";

// Configuration
const CONFIG = {
	// Maximum notes to process (to avoid performance issues)
	MAX_NOTES: 50,
	// Maximum content length for previews
	MAX_CONTENT_PREVIEW: 200,
	// Timeout for operations
	TIMEOUT_MS: 8000,
};

// Delimiters used to serialize AppleScript records as flat text.
// `runAppleScript` always resolves to a plain string - it never converts an
// AppleScript list of records into JS objects - so records must be joined into
// a delimited string and split here instead.
const FIELD_SEPARATOR = String.fromCharCode(31);
const RECORD_SEPARATOR = String.fromCharCode(30);

/**
 * AppleScript handlers shared by the read scripts below. Defined outside the
 * `tell` block and invoked with `my`, so dates come back as ISO-8601 local
 * wall-clock strings rather than unparseable AppleScript date descriptions.
 */
const DATE_HELPERS = `
on pad2(n)
    set s to (n as integer) as string
    if (length of s) < 2 then set s to "0" & s
    return s
end pad2

on isoOf(d)
    try
        return ((year of d) as string) & "-" & pad2((month of d) as integer) & "-" & pad2(day of d) & "T" & pad2(hours of d) & ":" & pad2(minutes of d) & ":" & pad2(seconds of d)
    on error
        return ""
    end try
end isoOf
`;

/**
 * AppleScript fragment that collects notes from `specifier` into `noteParts`.
 *
 * Properties are read as whole lists (`name of <specifier>`) rather than one
 * note at a time. Each list is a single Apple event, so this runs in well
 * under a second where a per-note loop takes seconds per fifty notes.
 */
function collectNotesSnippet(specifier: string, folderExpr: string): string {
	return `
    -- "name of {}" is an error, so an empty match set must be skipped outright
    if (count of (${specifier})) > 0 then
    set nameList to name of (${specifier})
    set textList to plaintext of (${specifier})
    set createdList to creation date of (${specifier})
    set modifiedList to modification date of (${specifier})
    set folderNameValue to ${folderExpr}

    set batchTotal to count of nameList

    repeat with i from 1 to batchTotal
        if noteCount >= maxNotes then exit repeat

        try
            set noteName to (item i of nameList) as string
            set noteContent to (item i of textList) as string

            if (length of noteContent) > ${CONFIG.MAX_CONTENT_PREVIEW} then
                set noteContent to (characters 1 thru ${CONFIG.MAX_CONTENT_PREVIEW} of noteContent) as string
                set noteContent to noteContent & "..."
            end if

            set createdValue to my isoOf(item i of createdList)
            set modifiedValue to my isoOf(item i of modifiedList)

            set end of noteParts to (noteName & FS & noteContent & FS & folderNameValue & FS & createdValue & FS & modifiedValue)
            set noteCount to noteCount + 1
        on error
            -- Skip problematic notes
        end try
    end repeat
    end if`;
}

type Note = {
	name: string;
	content: string;
	folderName?: string;
	creationDate?: Date;
	modificationDate?: Date;
};

/**
 * Parse a FIELD_SEPARATOR/RECORD_SEPARATOR encoded string into Note objects.
 */
function parseNotes(raw: string | undefined | null): Note[] {
	if (!raw) return [];

	return raw
		.split(RECORD_SEPARATOR)
		.filter((record) => record.trim().length > 0)
		.map((record) => {
			const [name, content, folderName, created, modified] =
				record.split(FIELD_SEPARATOR);

			const toDate = (value?: string): Date | undefined => {
				if (!value) return undefined;
				const parsed = new Date(value);
				return Number.isNaN(parsed.getTime()) ? undefined : parsed;
			};

			return {
				name: name || "Untitled Note",
				content: content || "",
				folderName: folderName || undefined,
				creationDate: toDate(created),
				modificationDate: toDate(modified),
			};
		});
}

type CreateNoteResult = {
	success: boolean;
	note?: Note;
	message?: string;
	folderName?: string;
	usedDefaultFolder?: boolean;
};

/**
 * Check if Notes app is accessible
 */
async function checkNotesAccess(): Promise<boolean> {
	try {
		const script = `
tell application "Notes"
    return name
end tell`;

		await runAppleScript(script);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Notes app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Notes app access and provide instructions if not available
 */
async function requestNotesAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkNotesAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Notes access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Notes access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Notes'\n3. Restart your terminal and try again\n4. If the option is not available, run this command again to trigger the permission dialog"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Notes access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

/**
 * Get all notes from Notes app (limited for performance)
 * @param limit Maximum notes to return
 */
async function getAllNotes(limit: number = CONFIG.MAX_NOTES): Promise<Note[]> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const maxNotes = Math.min(limit, CONFIG.MAX_NOTES);

		const script = `${DATE_HELPERS}
tell application "Notes"
    set FS to (character id 31)
    set RS to (character id 30)
    set noteParts to {}
    set noteCount to 0
    set maxNotes to ${maxNotes}

    -- Walk folders so each note carries its folder name; a note's container
    -- cannot be read in bulk, but there are only a handful of folders
    repeat with currentFolder in folders
        if noteCount >= maxNotes then exit repeat

        try
${collectNotesSnippet("notes of currentFolder", "(name of currentFolder) as string")}
        on error
            -- Skip inaccessible folders
        end try
    end repeat

    set AppleScript's text item delimiters to RS
    set resultText to noteParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseNotes(result);
	} catch (error) {
		console.error(
			`Error getting all notes: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Find notes by search text, matching the note name or its content
 * @param searchText Text to search for
 * @param limit Maximum notes to return
 */
async function findNote(
	searchText: string,
	limit: number = CONFIG.MAX_NOTES,
): Promise<Note[]> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!searchText || searchText.trim() === "") {
			return [];
		}

		const searchValidation = validateSearchQuery(searchText);
		if (!searchValidation.isValid) {
			throw new Error(searchValidation.error);
		}

		const maxNotes = Math.min(limit, CONFIG.MAX_NOTES);
		// AppleScript's `contains` is already case-insensitive
		const escapedSearchTerm = escapeAppleScript(searchText.trim());

		const script = `${DATE_HELPERS}
tell application "Notes"
    set FS to (character id 31)
    set RS to (character id 30)
    set noteParts to {}
    set noteCount to 0
    set maxNotes to ${maxNotes}
    set searchTerm to "${escapedSearchTerm}"

    -- Filter in AppleScript rather than reading every note's text in a loop.
    -- Filtering per folder (rather than across all notes at once) keeps each
    -- result's folder name available. The filter is written inline on purpose:
    -- bulk property access works on a specifier, but not on a variable holding
    -- the resulting list of refs.
    repeat with currentFolder in folders
        if noteCount >= maxNotes then exit repeat

        try
${collectNotesSnippet("notes of currentFolder whose name contains searchTerm or plaintext contains searchTerm", "(name of currentFolder) as string")}
        on error
            -- Skip inaccessible folders
        end try
    end repeat

    set AppleScript's text item delimiters to RS
    set resultText to noteParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseNotes(result);
	} catch (error) {
		console.error(
			`Error finding notes: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Create a new note
 */
async function createNote(
	title: string,
	body: string,
	folderName: string = "Claude",
): Promise<CreateNoteResult> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			return {
				success: false,
				message: accessResult.message,
			};
		}

		// Validate inputs
		const titleValidation = validateText(title, "Note title", VALIDATION_LIMITS.MAX_TEXT_SHORT);
		if (!titleValidation.isValid) {
			return {
				success: false,
				message: titleValidation.error,
			};
		}

		const bodyValidation = validateText(body, "Note body", VALIDATION_LIMITS.MAX_TEXT_LONG);
		if (!bodyValidation.isValid) {
			return {
				success: false,
				message: bodyValidation.error,
			};
		}

		const folderValidation = validateText(folderName, "Folder name", VALIDATION_LIMITS.MAX_NAME_LENGTH, false);
		if (!folderValidation.isValid) {
			return {
				success: false,
				message: folderValidation.error,
			};
		}

		// Keep the body as-is to preserve original formatting
		// Notes.app handles markdown and formatting natively
		const formattedBody = body.trim();

		// Use secure file-based approach for complex content
		const tmpFile = getSecureTempFile("note-content", ".txt");
		const fs = require("fs");

		// Write content to temporary file to avoid AppleScript escaping issues
		fs.writeFileSync(tmpFile, formattedBody, "utf8");

		const escapedTitle = escapeAppleScript(title.trim());
		const escapedFolderName = escapeAppleScript(folderName);

		const script = `
tell application "Notes"
    set targetFolder to null
    set folderFound to false
    set actualFolderName to "${escapedFolderName}"

    -- Try to find the specified folder
    try
        set allFolders to folders
        repeat with currentFolder in allFolders
            if name of currentFolder is "${escapedFolderName}" then
                set targetFolder to currentFolder
                set folderFound to true
                exit repeat
            end if
        end repeat
    on error
        -- Folders might not be accessible
    end try

    -- If folder not found and it's a test folder, try to create it
    if not folderFound and ("${escapedFolderName}" is "Claude" or "${escapedFolderName}" is "Test-Claude") then
        try
            make new folder with properties {name:"${escapedFolderName}"}
            -- Try to find it again
            set allFolders to folders
            repeat with currentFolder in allFolders
                if name of currentFolder is "${escapedFolderName}" then
                    set targetFolder to currentFolder
                    set folderFound to true
                    set actualFolderName to "${escapedFolderName}"
                    exit repeat
                end if
            end repeat
        on error
            -- Folder creation failed, use default
            set actualFolderName to "Notes"
        end try
    end if

    -- Read content from file to preserve formatting
    set noteContent to read file POSIX file "${tmpFile}" as «class utf8»

    -- Create the note with proper content
    if folderFound and targetFolder is not null then
        -- Create note in specified folder
        make new note at targetFolder with properties {name:"${escapedTitle}", body:noteContent}
        return "SUCCESS:" & actualFolderName & ":false"
    else
        -- Create note in default location
        make new note with properties {name:"${escapedTitle}", body:noteContent}
        return "SUCCESS:Notes:true"
    end if
end tell`;

		const result = (await runAppleScript(script)) as string;

		// Clean up temporary file
		try {
			fs.unlinkSync(tmpFile);
		} catch (e) {
			// Ignore cleanup errors
		}

		// Parse the result string format: "SUCCESS:folderName:usedDefault"
		if (result && typeof result === "string" && result.startsWith("SUCCESS:")) {
			const parts = result.split(":");
			const folderName = parts[1] || "Notes";
			const usedDefaultFolder = parts[2] === "true";

			return {
				success: true,
				note: {
					name: title,
					content: formattedBody,
				},
				folderName: folderName,
				usedDefaultFolder: usedDefaultFolder,
			};
		} else {
			return {
				success: false,
				message: `Failed to create note: ${result || "No result from AppleScript"}`,
			};
		}
	} catch (error) {
		return {
			success: false,
			message: `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get notes from a specific folder
 * @param folderName Name of the folder
 * @param limit Maximum notes to return
 */
async function getNotesFromFolder(
	folderName: string,
	limit: number = CONFIG.MAX_NOTES,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	try {
		const accessResult = await requestNotesAccess();
		if (!accessResult.hasAccess) {
			return {
				success: false,
				message: accessResult.message,
			};
		}

		const folderValidation = validateText(
			folderName,
			"Folder name",
			VALIDATION_LIMITS.MAX_NAME_LENGTH,
		);
		if (!folderValidation.isValid) {
			return { success: false, message: folderValidation.error };
		}

		const maxNotes = Math.min(limit, CONFIG.MAX_NOTES);
		const escapedFolderName = escapeAppleScript(folderName);

		const script = `${DATE_HELPERS}
tell application "Notes"
    set FS to (character id 31)
    set RS to (character id 30)
    set noteParts to {}
    set noteCount to 0
    set maxNotes to ${maxNotes}
    set folderFound to false

    repeat with currentFolder in folders
        if (name of currentFolder) is "${escapedFolderName}" then
            set folderFound to true

            try
${collectNotesSnippet("notes of currentFolder", "(name of currentFolder) as string")}
            on error
                -- Skip inaccessible folder contents
            end try

            exit repeat
        end if
    end repeat

    if not folderFound then
        return "ERROR:Folder not found"
    end if

    set AppleScript's text item delimiters to RS
    set resultText to noteParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;

		if (typeof result === "string" && result.startsWith("ERROR:")) {
			return {
				success: false,
				message: `${result.replace("ERROR:", "")}: "${folderName}"`,
			};
		}

		return {
			success: true,
			notes: parseNotes(result),
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to get notes from folder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get the most recently modified notes from a specific folder
 * @param folderName Name of the folder
 * @param limit Maximum notes to return
 */
async function getRecentNotesFromFolder(
	folderName: string,
	limit: number = 5,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	try {
		const result = await getNotesFromFolder(folderName);

		if (!result.success || !result.notes) {
			return result;
		}

		// Notes.app does not return notes in a guaranteed order, so sort
		// explicitly rather than assuming the folder order is recency
		const sorted = [...result.notes].sort((a, b) => {
			const aTime = a.modificationDate?.getTime() ?? 0;
			const bTime = b.modificationDate?.getTime() ?? 0;
			return bTime - aTime;
		});

		return {
			success: true,
			notes: sorted.slice(0, limit),
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to get recent notes from folder: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Get notes from a folder whose modification date falls within a range
 * @param folderName Name of the folder
 * @param fromDate Inclusive lower bound (ISO string)
 * @param toDate Inclusive upper bound (ISO string)
 * @param limit Maximum notes to return
 *
 * Note: the folder read is capped at CONFIG.MAX_NOTES before filtering, so a
 * range over a large folder may not reach its oldest notes.
 */
async function getNotesByDateRange(
	folderName: string,
	fromDate?: string,
	toDate?: string,
	limit: number = 20,
): Promise<{ success: boolean; notes?: Note[]; message?: string }> {
	try {
		const parseBound = (value: string | undefined, label: string): number | null => {
			if (!value) return null;
			const parsed = new Date(value);
			if (Number.isNaN(parsed.getTime())) {
				throw new Error(`Invalid ${label} "${value}"; expected an ISO-8601 date string`);
			}
			return parsed.getTime();
		};

		const from = parseBound(fromDate, "fromDate");
		const to = parseBound(toDate, "toDate");

		if (from !== null && to !== null && to < from) {
			return { success: false, message: "toDate must be on or after fromDate" };
		}

		const result = await getNotesFromFolder(folderName);

		if (!result.success || !result.notes) {
			return result;
		}

		const filtered = result.notes.filter((note) => {
			// A note with no readable date cannot be placed in the range
			const time = note.modificationDate?.getTime();
			if (time === undefined) return false;
			if (from !== null && time < from) return false;
			if (to !== null && time > to) return false;
			return true;
		});

		return {
			success: true,
			notes: filtered.slice(0, limit),
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to get notes by date range: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export default {
	getAllNotes,
	findNote,
	createNote,
	getNotesFromFolder,
	getRecentNotesFromFolder,
	getNotesByDateRange,
	requestNotesAccess,
};
