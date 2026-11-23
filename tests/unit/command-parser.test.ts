import { describe, it, expect } from "vitest";
import { parseCommand, CommandParseError } from "@/features/preview/utils/command-parser";

describe("parseCommand", () => {
  describe("Basic Commands and Whitespace Handling", () => {
    it("1. parses simple command: npm install", () => {
      const result = parseCommand("npm install");
      expect(result).toEqual({
        executable: "npm",
        args: ["install"],
      });
    });

    it("2. parses command with multiple arguments", () => {
      const result = parseCommand("npm run test -- --watch --coverage");
      expect(result).toEqual({
        executable: "npm",
        args: ["run", "test", "--", "--watch", "--coverage"],
      });
    });

    it("10. handles multiple consecutive whitespace characters", () => {
      const result = parseCommand("  npm    install   --save-dev  ");
      expect(result).toEqual({
        executable: "npm",
        args: ["install", "--save-dev"],
      });
    });

    it("11. handles leading and trailing whitespace cleanly", () => {
      const result = parseCommand("\t\n  node index.js  \n\t");
      expect(result).toEqual({
        executable: "node",
        args: ["index.js"],
      });
    });

    it("parses single executable without arguments", () => {
      const result = parseCommand("vite");
      expect(result).toEqual({
        executable: "vite",
        args: [],
      });
    });
  });

  describe("Quoted Arguments", () => {
    it("3. parses double-quoted argument containing spaces", () => {
      const result = parseCommand('pnpm --dir "my app" install');
      expect(result).toEqual({
        executable: "pnpm",
        args: ["--dir", "my app", "install"],
      });
    });

    it("4. parses single-quoted argument containing spaces", () => {
      const result = parseCommand("node scripts/start.js --name 'Nexus App'");
      expect(result).toEqual({
        executable: "node",
        args: ["scripts/start.js", "--name", "Nexus App"],
      });
    });

    it("8. parses empty double-quoted argument", () => {
      const result = parseCommand('node app.js ""');
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", ""],
      });
    });

    it("9. parses empty single-quoted argument", () => {
      const result = parseCommand("node app.js ''");
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", ""],
      });
    });

    it("parses consecutive empty quoted arguments", () => {
      const result = parseCommand("node app.js \"\" ''");
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", "", ""],
      });
    });

    it("parses quoted executable name", () => {
      const result = parseCommand('"my custom binary" arg1 arg2');
      expect(result).toEqual({
        executable: "my custom binary",
        args: ["arg1", "arg2"],
      });
    });
  });

  describe("Escaped Characters and Quotes", () => {
    it("5. parses escaped spaces outside quotes", () => {
      const result = parseCommand("node scripts/start.js --name Nexus\\ App");
      expect(result).toEqual({
        executable: "node",
        args: ["scripts/start.js", "--name", "Nexus App"],
      });
    });

    it("6. parses escaped double quotes inside double quotes", () => {
      const result = parseCommand('node app.js --message "Say \\"hello\\""');
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", "--message", 'Say "hello"'],
      });
    });

    it("7. parses escaped single quotes in unquoted input", () => {
      const result = parseCommand("node app.js --msg It\\'s\\ fine");
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", "--msg", "It's fine"],
      });
    });

    it("preserves escaped backslash inside double quotes", () => {
      const result = parseCommand('node app.js --path "C:\\\\Users\\\\nexus"');
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", "--path", "C:\\Users\\nexus"],
      });
    });
  });

  describe("Mixed Quoting and Grammar Features", () => {
    it("19. parses mixed quoted and unquoted portions of an argument", () => {
      const result = parseCommand('node app.js --dir="my cool dir"/build');
      expect(result).toEqual({
        executable: "node",
        args: ["app.js", "--dir=my cool dir/build"],
      });
    });

    it("parses combined single and double quotes within same token", () => {
      const result = parseCommand("echo 'Hello '\"World\"");
      expect(result).toEqual({
        executable: "echo",
        args: ["Hello World"],
      });
    });
  });

  describe("Security and Non-Expansion Constraints", () => {
    it("17. preserves literal $HOME and environment variables without expansion", () => {
      const result = parseCommand("node server.js --dir $HOME --port $PORT");
      expect(result).toEqual({
        executable: "node",
        args: ["server.js", "--dir", "$HOME", "--port", "$PORT"],
      });
    });

    it("18. preserves literal shell operators without execution or interpretation", () => {
      const result = parseCommand("echo hello && rm -rf / ; cat file | grep foo");
      expect(result).toEqual({
        executable: "echo",
        args: ["hello", "&&", "rm", "-rf", "/", ";", "cat", "file", "|", "grep", "foo"],
      });
    });

    it("preserves command substitution syntax as literal text", () => {
      const result = parseCommand("echo $(whoami) `id`");
      expect(result).toEqual({
        executable: "echo",
        args: ["$(whoami)", "`id`"],
      });
    });

    it("preserves glob wildcards as literal text", () => {
      const result = parseCommand("rm *.js src/**/*.ts");
      expect(result).toEqual({
        executable: "rm",
        args: ["*.js", "src/**/*.ts"],
      });
    });
  });

  describe("Error Handling for Malformed Commands", () => {
    it("12. throws CommandParseError for unclosed double quote", () => {
      expect(() => parseCommand('npm install "my package')).toThrow(CommandParseError);
      expect(() => parseCommand('npm install "my package')).toThrow(
        "Unclosed double quote in command"
      );
    });

    it("13. throws CommandParseError for unclosed single quote", () => {
      expect(() => parseCommand("node app.js 'unfinished")).toThrow(CommandParseError);
      expect(() => parseCommand("node app.js 'unfinished")).toThrow(
        "Unclosed single quote in command"
      );
    });

    it("14. throws CommandParseError for trailing escape character", () => {
      expect(() => parseCommand("node app.js \\")).toThrow(CommandParseError);
      expect(() => parseCommand("node app.js \\")).toThrow(
        "Trailing backslash at end of command"
      );
    });

    it("throws CommandParseError for trailing backslash in double quotes", () => {
      expect(() => parseCommand('node app.js "test\\')).toThrow(CommandParseError);
      expect(() => parseCommand('node app.js "test\\')).toThrow(
        "Trailing backslash in double-quoted string"
      );
    });

    it("15. throws CommandParseError for empty command", () => {
      expect(() => parseCommand("")).toThrow(CommandParseError);
      expect(() => parseCommand("")).toThrow("Command cannot be empty");
    });

    it("16. throws CommandParseError for whitespace-only command", () => {
      expect(() => parseCommand("    \t  \n  ")).toThrow(CommandParseError);
      expect(() => parseCommand("    \t  \n  ")).toThrow("Command cannot be empty");
    });

    it("throws CommandParseError when command contains no executable", () => {
      // Empty quotes without characters
      expect(() => parseCommand('""')).toThrow(CommandParseError);
      expect(() => parseCommand("''")).toThrow(CommandParseError);
    });
  });
});
