import { randomBytes } from "crypto";

/**
 * Safely escape a string for use in AppleScript
 * This prevents AppleScript injection attacks by escaping all special characters
 * 
 * @param input - The string to escape
 * @returns The safely escaped string
 */
export function escapeAppleScript(input: string): string {
	if (typeof input !== "string") {
		return "";
	}

	return input
		.replace(/\\/g, "\\\\")  // Escape backslashes first (must be first!)
		.replace(/"/g, '\\"')     // Escape double quotes
		.replace(/\n/g, "\\n")    // Escape newlines
		.replace(/\r/g, "\\r")    // Escape carriage returns
		.replace(/\t/g, "\\t");   // Escape tabs
}

/**
 * Generate a secure temporary file path using cryptographically random bytes
 * 
 * @param prefix - Optional prefix for the filename
 * @param extension - Optional file extension (default: .txt)
 * @returns A secure temporary file path
 */
export function getSecureTempFile(prefix = "temp", extension = ".txt"): string {
	const randomSuffix = randomBytes(16).toString("hex");
	return `/tmp/${prefix}-${randomSuffix}${extension}`;
}
