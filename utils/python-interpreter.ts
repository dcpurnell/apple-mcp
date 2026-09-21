import { execFile } from "child_process";
import { promisify } from "util";
import { readdirSync } from "fs";

const execFileAsync = promisify(execFile);

// How long a probe may take. Importing a pyobjc framework is a cold-start
// dylib load, so allow more than the trivial `-c "pass"` would need.
const PROBE_TIMEOUT_MS = 10000;

const FRAMEWORK_VERSIONS_DIR = "/Library/Frameworks/Python.framework/Versions";

/**
 * Candidate interpreters, in the order they are probed.
 *
 * The bridges used to invoke a bare "python3", which resolves through PATH. On
 * this machine only the Python.framework build carries pyobjc, so whenever the
 * server started from a context with a different PATH (launchd, a GUI MCP
 * client, an activated venv) Calendar, Reminders and Contacts all failed at
 * once with "No module named 'objc'". Absolute paths remove that coupling.
 *
 * "python3" stays last so a machine that only has pyobjc on PATH still works.
 */
function candidateInterpreters(): string[] {
  const candidates: string[] = [];

  // Prefer the newest python.org framework build, which is where pyobjc wheels
  // normally land. Read the directory rather than hardcoding a version so a
  // Python upgrade does not silently strand the bridges.
  try {
    const versions = readdirSync(FRAMEWORK_VERSIONS_DIR)
      .filter((name) => /^\d+\.\d+$/.test(name))
      .sort((a, b) => {
        const [aMajor, aMinor] = a.split(".").map(Number);
        const [bMajor, bMinor] = b.split(".").map(Number);
        return bMajor - aMajor || bMinor - aMinor;
      });
    for (const version of versions) {
      candidates.push(`${FRAMEWORK_VERSIONS_DIR}/${version}/bin/python3`);
    }
  } catch {
    // Framework directory absent; fall through to the fixed locations.
  }

  candidates.push("/opt/homebrew/bin/python3");
  candidates.push("/usr/local/bin/python3");
  candidates.push("/usr/bin/python3");
  candidates.push("python3");

  return candidates;
}

/**
 * True if `interpreter` can import every module in `modules`.
 */
async function canImport(
  interpreter: string,
  modules: string[]
): Promise<boolean> {
  try {
    await execFileAsync(
      interpreter,
      ["-c", `import ${modules.join(", ")}`],
      { timeout: PROBE_TIMEOUT_MS }
    );
    return true;
  } catch {
    return false;
  }
}

// Keyed by the required module list. The promise itself is cached so that
// concurrent callers share one probe instead of each spawning their own.
const resolutionCache = new Map<string, Promise<string>>();

async function resolve(modules: string[]): Promise<string> {
  const override = process.env.APPLE_MCP_PYTHON?.trim();

  // An explicit override is honored strictly: if it cannot import what the
  // bridge needs, say so instead of silently using a different interpreter.
  if (override) {
    if (await canImport(override, modules)) {
      return override;
    }
    throw new Error(
      `APPLE_MCP_PYTHON is set to "${override}", but it cannot import ` +
        `${modules.join(", ")}. Install the bridge dependencies for that ` +
        `interpreter ("${override}" -m pip install pyobjc-framework-EventKit ` +
        `pyobjc-framework-Contacts), or unset APPLE_MCP_PYTHON to auto-detect.`
    );
  }

  const tried: string[] = [];
  for (const candidate of candidateInterpreters()) {
    tried.push(candidate);
    if (await canImport(candidate, modules)) {
      return candidate;
    }
  }

  throw new Error(
    `No Python interpreter found that can import ${modules.join(", ")}. ` +
      `Tried: ${tried.join(", ")}. Install with ` +
      `"pip3 install pyobjc-framework-EventKit pyobjc-framework-Contacts", ` +
      `or set APPLE_MCP_PYTHON to the interpreter that has them.`
  );
}

/**
 * Absolute path to an interpreter that can import the given pyobjc modules.
 *
 * Resolved once per module set and cached. A failed resolution is not cached,
 * so installing the dependency takes effect without a server restart.
 */
export function getPythonInterpreter(modules: string[]): Promise<string> {
  const key = modules.join(",");
  const cached = resolutionCache.get(key);
  if (cached) {
    return cached;
  }

  const pending = resolve(modules).catch((error) => {
    resolutionCache.delete(key);
    throw error;
  });
  resolutionCache.set(key, pending);
  return pending;
}

/** Interpreter for the EventKit bridges (Calendar, Reminders). */
export function getEventKitPython(): Promise<string> {
  return getPythonInterpreter(["objc", "EventKit"]);
}

/** Interpreter for the Contacts bridge. */
export function getContactsPython(): Promise<string> {
  return getPythonInterpreter(["objc", "Contacts"]);
}
