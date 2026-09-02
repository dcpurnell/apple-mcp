import { runAppleScript } from "run-applescript";
import { escapeAppleScript, getSecureTempFile } from "./applescript-escape";
import { validateEmail, validateText, validateSearchQuery, VALIDATION_LIMITS } from "./input-validation";

// Configuration
const CONFIG = {
	// Maximum emails to process (to avoid performance issues)
	MAX_EMAILS: 20,
	// Maximum content length for previews
	MAX_CONTENT_PREVIEW: 300,
	// Timeout for operations
	TIMEOUT_MS: 10000,
};

interface EmailMessage {
	subject: string;
	sender: string;
	dateSent: string;
	content: string;
	isRead: boolean;
	mailbox: string;
	// The raw RFC 822 Message-ID header value (no angle brackets), e.g.
	// "abc123@mail.example.com".
	messageId: string;
	// A "message://" URL that opens this exact email in Mail.app, e.g.
	// "message://%3cabc123@mail.example.com%3e". Empty string if the
	// message id could not be determined.
	messageUrl: string;
}

// Non-printable delimiters used to safely encode multi-field AppleScript
// results as a single string. These are extremely unlikely to appear in
// email subjects/senders/dates/content, unlike commas or braces, which
// naive parsing previously broke on (e.g. AppleScript dates contain commas).
const FIELD_SEPARATOR = "\u001F"; // ASCII Unit Separator
const RECORD_SEPARATOR = "\u001E"; // ASCII Record Separator

/**
 * Parse a FIELD_SEPARATOR/RECORD_SEPARATOR encoded string (produced by the
 * AppleScript snippets below) into EmailMessage objects.
 */
/**
 * Parse a RECORD_SEPARATOR-joined string (produced below) into a string[].
 * Note: `runAppleScript` (from the `run-applescript` package) always resolves
 * to a plain string - it never converts AppleScript lists into real JS
 * arrays - so any code doing `Array.isArray(result)` on its return value is
 * dead code that always falls through to the empty-array branch.
 */
function parseDelimitedList(raw: string | undefined | null): string[] {
	if (!raw) return [];
	return raw
		.split(RECORD_SEPARATOR)
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/**
 * Build a "message://" URL that opens a specific email in Mail.app, given
 * its raw Message-ID header value (no angle brackets). Mail.app expects the
 * Message-ID wrapped in URL-encoded angle brackets: %3c...%3e.
 */
function buildMessageUrl(messageId: string): string {
	if (!messageId) return "";
	return `message://%3c${messageId}%3e`;
}

function parseDelimitedEmails(raw: string | undefined | null): EmailMessage[] {
	if (!raw) return [];

	return raw
		.split(RECORD_SEPARATOR)
		.filter((record) => record.trim().length > 0)
		.map((record) => {
			const [subject, sender, dateSent, content, isReadStr, mailbox, messageId] =
				record.split(FIELD_SEPARATOR);
			return {
				subject: subject || "No subject",
				sender: sender || "Unknown sender",
				dateSent: dateSent || "",
				content: content || "[Content not available]",
				isRead: isReadStr === "true",
				mailbox: mailbox || "Unknown",
				messageId: messageId || "",
				messageUrl: buildMessageUrl(messageId || ""),
			};
		});
}

/**
 * AppleScript handlers that render a date as an ISO-8601 local wall-clock
 * string. AppleScript's default coercion produces "Tuesday, September 1, 2026
 * at 2:10:41 PM", which `new Date()` cannot parse, making the returned
 * dateSent unusable to callers.
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
 * Build an AppleScript snippet that populates `targetMailboxes` with either
 * every mailbox (when no account filter is given) or only the mailboxes
 * belonging to the named accounts.
 */
function buildAccountFilterClause(
	accountNames?: string[],
	inboxOnly = false,
): string {
	// Collecting every mailbox is fine when the caller can cheaply skip most of
	// them (getUnreadMails checks `unread count` first). For a content search
	// there is no such shortcut: scanning one account's ~85 mailboxes takes
	// roughly 18 minutes, because Gmail keeps the full archive in "All Mail"
	// and every label re-exposes it. Search therefore looks at inboxes only.
	const collect = (acctExpr: string) =>
		inboxOnly
			? `        try
            set end of targetMailboxes to (first mailbox of ${acctExpr} whose name is "INBOX")
        on error
            try
                set end of targetMailboxes to (first mailbox of ${acctExpr} whose name is "Inbox")
            end try
        end try`
			: `        try
            repeat with mb in (every mailbox of ${acctExpr})
                set end of targetMailboxes to mb
            end repeat
        end try`;

	if (!accountNames || accountNames.length === 0) {
		// `mailboxes` at the top level is only the handful of mailboxes that do
		// not belong to an account (Outbox, Deleted Messages, ...) - it never
		// includes any account's Inbox, so an unfiltered query found nothing.
		return `    repeat with currentAccount in accounts
${collect("currentAccount")}
    end repeat`;
	}

	const quotedNames = accountNames
		.map((name) => `"${escapeAppleScript(name)}"`)
		.join(", ");

	return `    repeat with acctName in {${quotedNames}}
        try
            set targetAccount to first account whose name is acctName
${collect("targetAccount")}
        on error
            -- Account not found, skip
        end try
    end repeat`;
}

/**
 * Check if Mail app is accessible
 */
async function checkMailAccess(): Promise<boolean> {
	try {
		const script = `
tell application "Mail"
    return name
end tell`;

		await runAppleScript(script);
		return true;
	} catch (error) {
		console.error(
			`Cannot access Mail app: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Request Mail app access and provide instructions if not available
 */
async function requestMailAccess(): Promise<{ hasAccess: boolean; message: string }> {
	try {
		// First check if we already have access
		const hasAccess = await checkMailAccess();
		if (hasAccess) {
			return {
				hasAccess: true,
				message: "Mail access is already granted."
			};
		}

		// If no access, provide clear instructions
		return {
			hasAccess: false,
			message: "Mail access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Mail'\n3. Make sure Mail app is running and configured with at least one account\n4. Restart your terminal and try again"
		};
	} catch (error) {
		return {
			hasAccess: false,
			message: `Error checking Mail access: ${error instanceof Error ? error.message : String(error)}`
		};
	}
}

/**
 * Get unread emails from Mail app (limited for performance)
 * @param limit - Maximum number of emails to return  
 * @param accountNames - Optional array of account names to filter (not yet implemented in AppleScript)
 */
async function getUnreadMails(limit = 10, accountNames?: string[]): Promise<EmailMessage[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const maxEmails = Math.min(limit, CONFIG.MAX_EMAILS);
		const accountFilterClause = buildAccountFilterClause(accountNames);

		const script = `${DATE_HELPERS}
tell application "Mail"
    set FS to (character id 31)
    set RS to (character id 30)
    set emailParts to {}
    set emailCount to 0
    -- Gmail exposes one message under several labels (INBOX, All Mail,
    -- Important, ...). Without this, one email is emitted repeatedly and
    -- consumes the caller's limit.
    set seenIds to {}
    set targetMailboxes to {}

${accountFilterClause}

    repeat with currentMailbox in targetMailboxes
        if emailCount >= ${maxEmails} then exit repeat

        try
            -- "unread count" is a cheap property; checking it first skips the
            -- expensive message query on the vast majority of mailboxes (on a
            -- typical multi-account setup, hundreds of mailboxes hold none)
            set mailboxUnread to 0
            try
                set mailboxUnread to unread count of currentMailbox
            end try

            if mailboxUnread > 0 then
            set mailboxName to name of currentMailbox

            -- Filter to unread messages directly in AppleScript (much faster
            -- than fetching every message and checking read status in a loop)
            set unreadMessages to (messages of currentMailbox whose read status is false)
            set umCount to count of unreadMessages

            if umCount > 0 then
                set idxLimit to umCount
                if idxLimit > (${maxEmails} - emailCount) then set idxLimit to (${maxEmails} - emailCount)

                repeat with j from 1 to idxLimit
                    try
                        set currentMsg to item j of unreadMessages
                        set emailSubject to subject of currentMsg
                        set emailSender to sender of currentMsg
                        set emailDate to my isoOf(date sent of currentMsg)

                        set emailMessageId to ""
                        try
                            set emailMessageId to message id of currentMsg
                        on error
                            set emailMessageId to ""
                        end try

                        -- Get content with length limit
                        set emailContent to ""
                        try
                            set fullContent to content of currentMsg
                            if (length of fullContent) > ${CONFIG.MAX_CONTENT_PREVIEW} then
                                set emailContent to (text 1 thru ${CONFIG.MAX_CONTENT_PREVIEW} of fullContent) & "..."
                            else
                                set emailContent to fullContent
                            end if
                        on error
                            set emailContent to "[Content not available]"
                        end try

                        set isDuplicate to false
                        if emailMessageId is not "" then
                            if seenIds contains emailMessageId then
                                set isDuplicate to true
                            else
                                set end of seenIds to emailMessageId
                            end if
                        end if

                        if not isDuplicate then
                            set end of emailParts to (emailSubject & FS & emailSender & FS & emailDate & FS & emailContent & FS & "false" & FS & mailboxName & FS & emailMessageId)
                            set emailCount to emailCount + 1
                        end if
                    on error
                        -- Skip problematic messages
                    end try
                end repeat
            end if
            end if
        on error
            -- Skip problematic mailboxes
        end try
    end repeat

    set AppleScript's text item delimiters to RS
    set resultText to emailParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseDelimitedEmails(result);
	} catch (error) {
		console.error(
			`Error getting unread emails: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Search for emails by search term
 * @param searchTerm - Text to search for in email subjects
 * @param limit - Maximum number of emails to return
 * @param accountNames - Optional array of account names to filter (not yet implemented in AppleScript)
 */
async function searchMails(
	searchTerm: string,
	limit = 10,
	accountNames?: string[],
): Promise<EmailMessage[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Validate search term
		const searchValidation = validateSearchQuery(searchTerm);
		if (!searchValidation.isValid) {
			throw new Error(searchValidation.error);
		}

		const maxEmails = Math.min(limit, CONFIG.MAX_EMAILS);
		const cleanSearchTerm = searchTerm.toLowerCase();
		const escapedSearchTerm = escapeAppleScript(cleanSearchTerm);
		const accountFilterClause = buildAccountFilterClause(accountNames, true);

		const script = `${DATE_HELPERS}
tell application "Mail"
    set FS to (character id 31)
    set RS to (character id 30)
    set emailParts to {}
    set emailCount to 0
    -- Gmail exposes one message under several labels (INBOX, All Mail,
    -- Important, ...). Without this, one email is emitted repeatedly and
    -- consumes the caller's limit.
    set seenIds to {}
    set searchTerm to "${escapedSearchTerm}"
    set targetMailboxes to {}

${accountFilterClause}

    repeat with currentMailbox in targetMailboxes
        if emailCount >= ${maxEmails} then exit repeat

        try
            set mailboxName to name of currentMailbox

            -- Filter matching messages directly in AppleScript (much faster
            -- than fetching every message and checking the subject in a loop)
            set matchingMessages to (messages of currentMailbox whose subject contains searchTerm)
            set mmCount to count of matchingMessages

            if mmCount > 0 then
                set idxLimit to mmCount
                if idxLimit > (${maxEmails} - emailCount) then set idxLimit to (${maxEmails} - emailCount)

                repeat with j from 1 to idxLimit
                    try
                        set currentMsg to item j of matchingMessages
                        set emailSubject to subject of currentMsg
                        set emailSender to sender of currentMsg
                        set emailDate to my isoOf(date sent of currentMsg)
                        set emailRead to (read status of currentMsg) as string

                        set emailMessageId to ""
                        try
                            set emailMessageId to message id of currentMsg
                        on error
                            set emailMessageId to ""
                        end try

                        -- Get content with length limit
                        set emailContent to ""
                        try
                            set fullContent to content of currentMsg
                            if (length of fullContent) > ${CONFIG.MAX_CONTENT_PREVIEW} then
                                set emailContent to (text 1 thru ${CONFIG.MAX_CONTENT_PREVIEW} of fullContent) & "..."
                            else
                                set emailContent to fullContent
                            end if
                        on error
                            set emailContent to "[Content not available]"
                        end try

                        set isDuplicate to false
                        if emailMessageId is not "" then
                            if seenIds contains emailMessageId then
                                set isDuplicate to true
                            else
                                set end of seenIds to emailMessageId
                            end if
                        end if

                        if not isDuplicate then
                            set end of emailParts to (emailSubject & FS & emailSender & FS & emailDate & FS & emailContent & FS & emailRead & FS & mailboxName & FS & emailMessageId)
                            set emailCount to emailCount + 1
                        end if
                    on error
                        -- Skip problematic messages
                    end try
                end repeat
            end if
        on error
            -- Skip problematic mailboxes
        end try
    end repeat

    set AppleScript's text item delimiters to RS
    set resultText to emailParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseDelimitedEmails(result);
	} catch (error) {
		console.error(
			`Error searching emails: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Send an email
 */
async function sendMail(
	to: string,
	subject: string,
	body: string,
	cc?: string,
	bcc?: string,
): Promise<string | undefined> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		// Validate inputs
		const toValidation = validateEmail(to);
		if (!toValidation.isValid) {
			throw new Error(`Invalid recipient email: ${toValidation.error}`);
		}

		if (cc) {
			const ccValidation = validateEmail(cc);
			if (!ccValidation.isValid) {
				throw new Error(`Invalid CC email: ${ccValidation.error}`);
			}
		}

		if (bcc) {
			const bccValidation = validateEmail(bcc);
			if (!bccValidation.isValid) {
				throw new Error(`Invalid BCC email: ${bccValidation.error}`);
			}
		}

		const subjectValidation = validateText(subject, "Subject", VALIDATION_LIMITS.MAX_TEXT_SHORT);
		if (!subjectValidation.isValid) {
			throw new Error(subjectValidation.error);
		}

		const bodyValidation = validateText(body, "Email body", VALIDATION_LIMITS.MAX_TEXT_LONG);
		if (!bodyValidation.isValid) {
			throw new Error(bodyValidation.error);
		}

		// Use secure file-based approach for email body
		const tmpFile = getSecureTempFile("email-body", ".txt");
		const fs = require("fs");

		// Write content to temporary file
		fs.writeFileSync(tmpFile, body.trim(), "utf8");

		const escapedSubject = escapeAppleScript(subject);
		const escapedTo = escapeAppleScript(to);
		const escapedCc = cc ? escapeAppleScript(cc) : "";
		const escapedBcc = bcc ? escapeAppleScript(bcc) : "";

		const script = `
tell application "Mail"
    activate

    -- Read email body from file to preserve formatting
    set emailBody to read file POSIX file "${tmpFile}" as «class utf8»

    -- Create new message
    set newMessage to make new outgoing message with properties {subject:"${escapedSubject}", content:emailBody, visible:true}

    tell newMessage
        make new to recipient with properties {address:"${escapedTo}"}
        ${cc ? `make new cc recipient with properties {address:"${escapedCc}"}` : ""}
        ${bcc ? `make new bcc recipient with properties {address:"${escapedBcc}"}` : ""}
    end tell

    send newMessage
    return "SUCCESS"
end tell`;

		const result = (await runAppleScript(script)) as string;

		// Clean up temporary file
		try {
			fs.unlinkSync(tmpFile);
		} catch (e) {
			// Ignore cleanup errors
		}

		if (result === "SUCCESS") {
			return `Email sent to ${to} with subject "${subject}"`;
		} else {
			throw new Error("Failed to send email");
		}
	} catch (error) {
		console.error(
			`Error sending email: ${error instanceof Error ? error.message : String(error)}`,
		);
		throw new Error(
			`Error sending email: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Get list of mailboxes (simplified for performance)
 */
async function getMailboxes(): Promise<string[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Mail"
    set RS to (character id 30)
    try
        set boxNames to name of every mailbox
        set AppleScript's text item delimiters to RS
        set resultText to boxNames as string
        set AppleScript's text item delimiters to ""
        return resultText
    on error
        return ""
    end try
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseDelimitedList(result);
	} catch (error) {
		console.error(
			`Error getting mailboxes: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Get list of email accounts (simplified for performance)
 */
async function getAccounts(): Promise<string[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const script = `
tell application "Mail"
    set RS to (character id 30)
    try
        set acctNames to name of every account
        set AppleScript's text item delimiters to RS
        set resultText to acctNames as string
        set AppleScript's text item delimiters to ""
        return resultText
    on error
        return ""
    end try
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseDelimitedList(result);
	} catch (error) {
		console.error(
			`Error getting accounts: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Get mailboxes for a specific account
 */
async function getMailboxesForAccount(accountName: string): Promise<string[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		if (!accountName || !accountName.trim()) {
			return [];
		}

		const escapedAccountName = escapeAppleScript(accountName);

		const script = `
tell application "Mail"
    set RS to (character id 30)
    set boxList to {}

    try
        -- Find the account
        set targetAccount to first account whose name is "${escapedAccountName}"
        set accountMailboxes to mailboxes of targetAccount

        repeat with i from 1 to (count of accountMailboxes)
            try
                set currentMailbox to item i of accountMailboxes
                set mailboxName to name of currentMailbox
                set end of boxList to mailboxName
            on error
                -- Skip problematic mailboxes
            end try
        end repeat
    on error
        -- Account not found or other error
        return ""
    end try

    set AppleScript's text item delimiters to RS
    set resultText to boxList as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const result = (await runAppleScript(script)) as string;
		return parseDelimitedList(result);
	} catch (error) {
		console.error(
			`Error getting mailboxes for account: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}
}

/**
 * Get latest emails from a specific account
 */
async function getLatestMails(
	account: string,
	limit = 5,
): Promise<EmailMessage[]> {
	try {
		const accessResult = await requestMailAccess();
		if (!accessResult.hasAccess) {
			throw new Error(accessResult.message);
		}

		const escapedAccount = escapeAppleScript(account);

		const script = `${DATE_HELPERS}
tell application "Mail"
    set FS to (character id 31)
    set RS to (character id 30)
    set emailParts to {}
    set emailCount to 0
    -- Gmail exposes one message under several labels (INBOX, All Mail,
    -- Important, ...). Without this, one email is emitted repeatedly and
    -- consumes the caller's limit.
    set seenIds to {}
    try
        set targetAccount to first account whose name is "${escapedAccount}"
        set acctMailboxes to every mailbox of targetAccount

        -- Prioritize the Inbox first so "latest" reflects what the user
        -- actually sees in their inbox, rather than whatever mailbox happens
        -- to be first in the account's mailbox list (e.g. Gmail accounts
        -- often list "All Mail"/"Important" before "INBOX").
        set orderedMailboxes to {}
        set inboxMailboxes to {}
        repeat with mb in acctMailboxes
            if (name of mb is "INBOX") or (name of mb is "Inbox") then
                set end of inboxMailboxes to mb
            else
                set end of orderedMailboxes to mb
            end if
        end repeat
        set orderedMailboxes to inboxMailboxes & orderedMailboxes

        repeat with mb in orderedMailboxes
            if emailCount >= ${limit} then exit repeat
            try
                set mailboxName to name of mb
                set msgCount to count of messages of mb
                if msgCount > 0 then
                    set idxLimit to msgCount
                    if idxLimit > (${limit} - emailCount) then set idxLimit to (${limit} - emailCount)

                    -- Messages are already newest-first. Access by index
                    -- directly (rather than materializing the full message
                    -- list) to avoid timeouts on very large mailboxes.
                    repeat with i from 1 to idxLimit
                        try
                            set currentMsg to message i of mb
                            set emailSubject to subject of currentMsg
                            set emailSender to sender of currentMsg
                            set emailDate to my isoOf(date sent of currentMsg)
                            set emailRead to (read status of currentMsg) as string

                            set emailMessageId to ""
                            try
                                set emailMessageId to message id of currentMsg
                            on error
                                set emailMessageId to ""
                            end try

                            set emailContent to ""
                            try
                                set fullContent to content of currentMsg
                                if (length of fullContent) > 500 then
                                    set emailContent to (text 1 thru 500 of fullContent) & "..."
                                else
                                    set emailContent to fullContent
                                end if
                            on error
                                set emailContent to "[Content not available]"
                            end try

                            set isDuplicate to false
                            if emailMessageId is not "" then
                                if seenIds contains emailMessageId then
                                    set isDuplicate to true
                                else
                                    set end of seenIds to emailMessageId
                                end if
                            end if

                            if not isDuplicate then
                                set end of emailParts to (emailSubject & FS & emailSender & FS & emailDate & FS & emailContent & FS & emailRead & FS & mailboxName & FS & emailMessageId)
                                set emailCount to emailCount + 1
                            end if
                        on error
                            -- Skip problematic messages
                        end try
                    end repeat
                end if
            on error
                -- Skip problematic mailboxes
            end try
        end repeat
    on error errMsg
        return "ERROR:" & errMsg
    end try

    set AppleScript's text item delimiters to RS
    set resultText to emailParts as string
    set AppleScript's text item delimiters to ""
    return resultText
end tell`;

		const asResult = (await runAppleScript(script)) as string;

		if (asResult && asResult.startsWith("ERROR:")) {
			throw new Error(asResult);
		}

		return parseDelimitedEmails(asResult).map((email) => ({
			...email,
			mailbox: `${account} - ${email.mailbox}`,
		}));
	} catch (error) {
		console.error("Error getting latest emails:", error);
		return [];
	}
}

export default {
	getUnreadMails,
	searchMails,
	sendMail,
	getMailboxes,
	getAccounts,
	getMailboxesForAccount,
	getLatestMails,
	requestMailAccess,
};
