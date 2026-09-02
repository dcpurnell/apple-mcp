import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

// Configuration
const CONFIG = {
  TIMEOUT_MS: 15000,
  MAX_CONTACTS: 1000,
};

// Path to the Python Contacts bridge script
// Use import.meta.url to get reliable path regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = path.join(__dirname, "..", "contacts-framework.py");

// Define types for contacts
interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  nickname: string;
  company: string;
  jobTitle: string;
  fullName: string;
  phoneNumbers: Array<{
    label: string;
    number: string;
  }>;
  emails: Array<{
    label: string;
    email: string;
  }>;
  addresses: Array<{
    label: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  }>;
  notes: string;
}

interface PythonContactsResponse {
  contacts?: Contact[];
  count?: number;
  searchTerm?: string;
  error?: string;
}

/**
 * Execute Python Contacts script with timeout
 */
async function executePythonScript(
  command: string,
  args: string[] = []
): Promise<PythonContactsResponse> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "python3",
      [PYTHON_SCRIPT, command, ...args],
      { timeout: CONFIG.TIMEOUT_MS }
    );

    if (stderr && !stderr.includes("Warning")) {
      console.warn(`Python script stderr: ${stderr}`);
    }

    return JSON.parse(stdout);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Python Contacts error: ${error.message}`);
      return { error: error.message };
    }
    return { error: String(error) };
  }
}

/**
 * Get all contacts
 */
export async function getAllContacts(limit: number = 1000): Promise<Contact[]> {
  const result = await executePythonScript("list_all", [String(Math.min(limit, CONFIG.MAX_CONTACTS))]);
  
  if (result.error) {
    throw new Error(result.error);
  }

  return result.contacts || [];
}

/**
 * Search contacts by name, phone, email, or company
 */
export async function searchContacts(searchTerm: string, limit: number = 50): Promise<Contact[]> {
  if (!searchTerm || searchTerm.trim().length === 0) {
    throw new Error("Search term is required");
  }

  const result = await executePythonScript("search", [searchTerm.trim(), String(limit)]);
  
  if (result.error) {
    throw new Error(result.error);
  }

  return result.contacts || [];
}

/**
 * Build a lookup index from phone/email to display name.
 *
 * Cached because getAllContacts costs ~1s and callers resolve names per
 * message, which would otherwise spawn one python process per message.
 */
let handleIndex: Map<string, string> | null = null;
let handleIndexAt = 0;
const HANDLE_INDEX_TTL_MS = 60_000;

/**
 * Reduce a phone number to comparable digits.
 *
 * Contacts stores numbers as "(336) 555-1234" while Messages reports
 * "+13365551234", so compare on the last 10 digits.
 */
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function getHandleIndex(): Promise<Map<string, string>> {
  const now = Date.now();
  if (handleIndex && now - handleIndexAt < HANDLE_INDEX_TTL_MS) {
    return handleIndex;
  }

  const index = new Map<string, string>();
  const contacts = await getAllContacts(CONFIG.MAX_CONTACTS);

  for (const contact of contacts) {
    const displayName = contact.fullName || contact.company;
    if (!displayName) continue;

    for (const phone of contact.phoneNumbers) {
      const key = normalizePhone(phone.number);
      if (key && !index.has(key)) index.set(key, displayName);
    }
    for (const email of contact.emails) {
      const key = email.email.trim().toLowerCase();
      if (key && !index.has(key)) index.set(key, displayName);
    }
  }

  handleIndex = index;
  handleIndexAt = now;
  return index;
}

/**
 * Find a contact's display name by phone number or email address
 * @param handle A phone number or email address, as reported by Messages
 * @returns The contact's display name, or null when no contact matches
 */
export async function findContactByPhone(handle: string): Promise<string | null> {
  if (!handle || typeof handle !== "string") {
    return null;
  }

  try {
    const index = await getHandleIndex();
    const key = handle.includes("@")
      ? handle.trim().toLowerCase()
      : normalizePhone(handle);

    return key ? index.get(key) ?? null : null;
  } catch (error) {
    // A name lookup must never break the operation that requested it
    console.error(
      `Could not resolve contact for "${handle}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Find contacts by name (wrapper around searchContacts for compatibility)
 */
export async function findContactByName(name: string): Promise<Contact[]> {
  return searchContacts(name, 50);
}

export type { Contact };

// Default export for compatibility
export default {
  getAllContacts,
  searchContacts,
  findContactByName,
  findContactByPhone
};
