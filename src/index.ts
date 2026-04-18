#!/usr/bin/env node

import { serveCommand } from "./cli/serve.js";
import { migrateCommand } from "./cli/migrate.js";
import { validateCommand } from "./cli/validate.js";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(name);
}

async function main(): Promise<void> {
  const configFile = getFlag("--config") ?? getFlag("-c");

  switch (command) {
    case "serve":
    case undefined: {
      await serveCommand(configFile);
      break;
    }

    case "migrate": {
      const direction = (args[1] ?? "up") as "up" | "down" | "status";
      if (!["up", "down", "status"].includes(direction)) {
        console.error(`Unknown migrate direction: ${direction}. Use: up, down, status`);
        process.exit(1);
      }
      const steps = hasFlag("--steps") ? parseInt(getFlag("--steps") ?? "1") : 1;
      await migrateCommand(direction, configFile, steps);
      break;
    }

    case "validate": {
      await validateCommand(configFile);
      break;
    }

    case "--help":
    case "-h":
    case "help": {
      console.log(`
Agentic Service — Business logic without code.

USAGE
  agentic-service [command] [options]

COMMANDS
  serve      Start the HTTP server (default)
  migrate    Run database migrations
             agentic-service migrate up|down|status [--steps N]
  validate   Validate spec files
  help       Show this help

OPTIONS
  --config, -c <file>   Path to config.yaml (default: ./config.yaml)

EXAMPLES
  agentic-service serve --config ./config.yaml
  agentic-service migrate up --config ./config.yaml
  agentic-service validate --config ./config.yaml
`);
      break;
    }

    default: {
      console.error(`Unknown command: ${command}`);
      console.error(`Run 'agentic-service help' for usage.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
