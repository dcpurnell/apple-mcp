/**
 * Input validation utilities for security and data integrity
 */

// Configuration for validation limits
export const VALIDATION_LIMITS = {
	MAX_EMAIL_LENGTH: 254, // RFC 5321
	MAX_PHONE_LENGTH: 20,
	MAX_TEXT_SHORT: 500, // For titles, subjects, etc.
	MAX_TEXT_MEDIUM: 2000, // For notes, descriptions
	MAX_TEXT_LONG: 10000, // For email bodies, long notes
	MAX_URL_LENGTH: 2048,
	MAX_NAME_LENGTH: 200,
};

export interface ValidationResult {
	isValid: boolean;
	error?: string;
	sanitized?: string;
}

/**
 * Validate email address format
 */
export function validateEmail(email: string): ValidationResult {
	if (!email || typeof email !== "string") {
		return { isValid: false, error: "Email is required" };
	}

	const trimmed = email.trim();

	if (trimmed.length === 0) {
		return { isValid: false, error: "Email cannot be empty" };
	}

	if (trimmed.length > VALIDATION_LIMITS.MAX_EMAIL_LENGTH) {
		return {
			isValid: false,
			error: `Email exceeds maximum length of ${VALIDATION_LIMITS.MAX_EMAIL_LENGTH} characters`,
		};
	}

	// RFC 5322 compliant email regex (simplified but robust)
	const emailRegex = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

	if (!emailRegex.test(trimmed)) {
		return { isValid: false, error: "Invalid email format" };
	}

	return { isValid: true, sanitized: trimmed };
}

/**
 * Validate phone number format
 * Accepts various formats: +1234567890, (123) 456-7890, 123-456-7890, etc.
 */
export function validatePhoneNumber(phone: string): ValidationResult {
	if (!phone || typeof phone !== "string") {
		return { isValid: false, error: "Phone number is required" };
	}

	const trimmed = phone.trim();

	if (trimmed.length === 0) {
		return { isValid: false, error: "Phone number cannot be empty" };
	}

	if (trimmed.length > VALIDATION_LIMITS.MAX_PHONE_LENGTH) {
		return {
			isValid: false,
			error: `Phone number exceeds maximum length of ${VALIDATION_LIMITS.MAX_PHONE_LENGTH} characters`,
		};
	}

	// Remove all non-digit characters except +
	const digitsOnly = trimmed.replace(/[^0-9+]/g, "");

	// Check if we have a reasonable number of digits (7-15 is standard range)
	const digitCount = digitsOnly.replace(/\+/g, "").length;
	if (digitCount < 7 || digitCount > 15) {
		return {
			isValid: false,
			error: "Phone number must contain between 7 and 15 digits",
		};
	}

	// Ensure + only appears at the start
	if (digitsOnly.includes("+") && !digitsOnly.startsWith("+")) {
		return {
			isValid: false,
			error: "'+' can only appear at the beginning of phone number",
		};
	}

	// Ensure only one + sign
	if ((digitsOnly.match(/\+/g) || []).length > 1) {
		return { isValid: false, error: "Phone number can only contain one '+' sign" };
	}

	return { isValid: true, sanitized: trimmed };
}

/**
 * Validate text with length limit
 */
export function validateText(
	text: string,
	fieldName: string,
	maxLength: number,
	required = true,
): ValidationResult {
	if (!text || typeof text !== "string") {
		if (required) {
			return { isValid: false, error: `${fieldName} is required` };
		}
		return { isValid: true, sanitized: "" };
	}

	const trimmed = text.trim();

	if (required && trimmed.length === 0) {
		return { isValid: false, error: `${fieldName} cannot be empty` };
	}

	if (trimmed.length > maxLength) {
		return {
			isValid: false,
			error: `${fieldName} exceeds maximum length of ${maxLength} characters`,
		};
	}

	return { isValid: true, sanitized: trimmed };
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): ValidationResult {
	if (!url || typeof url !== "string") {
		return { isValid: false, error: "URL is required" };
	}

	const trimmed = url.trim();

	if (trimmed.length === 0) {
		return { isValid: false, error: "URL cannot be empty" };
	}

	if (trimmed.length > VALIDATION_LIMITS.MAX_URL_LENGTH) {
		return {
			isValid: false,
			error: `URL exceeds maximum length of ${VALIDATION_LIMITS.MAX_URL_LENGTH} characters`,
		};
	}

	// Check for valid URL format (http, https, or protocol-relative)
	try {
		const urlObj = new URL(trimmed);
		if (!["http:", "https:"].includes(urlObj.protocol)) {
			return { isValid: false, error: "URL must use http or https protocol" };
		}
		return { isValid: true, sanitized: trimmed };
	} catch {
		return { isValid: false, error: "Invalid URL format" };
	}
}

/**
 * Validate name (for contacts, folders, etc.)
 */
export function validateName(name: string, fieldName = "Name"): ValidationResult {
	return validateText(name, fieldName, VALIDATION_LIMITS.MAX_NAME_LENGTH, true);
}

/**
 * Sanitize and validate a search query
 */
export function validateSearchQuery(query: string): ValidationResult {
	if (!query || typeof query !== "string") {
		return { isValid: false, error: "Search query is required" };
	}

	const trimmed = query.trim();

	if (trimmed.length === 0) {
		return { isValid: false, error: "Search query cannot be empty" };
	}

	if (trimmed.length > VALIDATION_LIMITS.MAX_TEXT_MEDIUM) {
		return {
			isValid: false,
			error: `Search query exceeds maximum length of ${VALIDATION_LIMITS.MAX_TEXT_MEDIUM} characters`,
		};
	}

	return { isValid: true, sanitized: trimmed };
}
