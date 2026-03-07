import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

// Configuration
const CONFIG = {
  TIMEOUT_MS: 15000,
  MAX_CONTACTS: 1000,
};

// Path to the Python Contacts bridge script
const PYTHON_SCRIPT = path.join(process.cwd(), "contacts-framework.py");

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
  findContactByName
};
