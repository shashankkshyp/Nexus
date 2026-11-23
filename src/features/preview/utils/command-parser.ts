/**
 * Command-line parsing utility for WebContainer process execution.
 *
 * Implements a lightweight, state-machine-based command tokenizer that converts
 * shell-style command strings into an executable and argument array.
 *
 * Supported features:
 * - Basic whitespace-separated commands (e.g. `npm install`)
 * - Double-quoted arguments with spaces (e.g. `pnpm --dir "my app" install`)
 * - Single-quoted arguments with spaces (e.g. `node script.js --name 'Nexus App'`)
 * - Escaped spaces outside or inside quotes (e.g. `node app.js --name Nexus\ App`)
 * - Escaped quotes (e.g. `node app.js --message "Say \"hello\""`)
 * - Empty quoted arguments (e.g. `node app.js "" ''` -> `["app.js", "", ""]`)
 * - Mixed quoted/unquoted tokens (e.g. `--prefix="foo bar"` -> `"--prefix=foo bar"`)
 * - Multiple consecutive and leading/trailing whitespace handling
 *
 * Explicitly UNSUPPORTED / NOT IMPLEMENTED (Security & Design Constraints):
 * - Environment-variable expansion (`$VAR`, `$HOME`, etc.)
 * - Command substitution (`$(...)`, backticks)
 * - Globbing / pathname expansion (`*`, `?`)
 * - Shell operators and redirection (`|`, `>`, `&&`, `||`, `;`)
 * - Shell execution via `/bin/sh`, `bash`, or `cmd`
 * All special shell characters are treated as literal text.
 */

export interface ParsedCommand {
  executable: string;
  args: string[];
}

export class CommandParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandParseError";
  }
}

/**
 * Parses a command string into an executable and arguments array.
 *
 * @param command - The raw command string to parse.
 * @returns {ParsedCommand} The executable and list of arguments.
 * @throws {CommandParseError} If quotes are unmatched, trailing escape is present,
 *                             or command is empty/contains no executable.
 */
export function parseCommand(command: string): ParsedCommand {
  if (!command || typeof command !== "string" || command.trim().length === 0) {
    throw new CommandParseError("Command cannot be empty");
  }

  const tokens: string[] = [];
  let currentToken = "";
  let inToken = false; // Tracks if we are currently building a token (needed for empty quotes like "")
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let isEscaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (isEscaped) {
      // In escape state: treat the current character as literal
      currentToken += char;
      inToken = true;
      isEscaped = false;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        currentToken += char;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      } else if (char === "\\") {
        // Lookahead to check if the next character is an escapable char in double quotes
        // Or handle backslash escaping: in double quotes, backslash escapes `"` or `\` or others
        if (i + 1 < command.length) {
          const nextChar = command[i + 1];
          if (nextChar === '"' || nextChar === '\\' || nextChar === '$' || nextChar === '`') {
            currentToken += nextChar;
            i++; // skip next char
          } else {
            // In standard shell, backslash retains literal value if not followed by escapable chars,
            // but for predictable developer-friendly escaping, treat `\char` as `char` or literal `\char`.
            // Let's treat `\x` as literal `\x` if not `"` or `\`.
            currentToken += "\\" + nextChar;
            i++;
          }
        } else {
          throw new CommandParseError("Trailing backslash in double-quoted string");
        }
      } else {
        currentToken += char;
      }
      continue;
    }

    // Normal / unquoted state
    if (char === "\\") {
      inToken = true;
      if (i + 1 < command.length) {
        isEscaped = true;
      } else {
        throw new CommandParseError("Trailing backslash at end of command");
      }
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      inToken = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      inToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(currentToken);
        currentToken = "";
        inToken = false;
      }
      continue;
    }

    // Regular character
    currentToken += char;
    inToken = true;
  }

  if (isEscaped) {
    throw new CommandParseError("Trailing backslash at end of command");
  }

  if (inSingleQuote) {
    throw new CommandParseError("Unclosed single quote in command");
  }

  if (inDoubleQuote) {
    throw new CommandParseError("Unclosed double quote in command");
  }

  if (inToken) {
    tokens.push(currentToken);
  }

  if (tokens.length === 0) {
    throw new CommandParseError("Command contains no executable");
  }

  const [executable, ...args] = tokens;

  if (!executable || executable.trim().length === 0) {
    throw new CommandParseError("Command contains no executable");
  }

  return {
    executable,
    args,
  };
}
