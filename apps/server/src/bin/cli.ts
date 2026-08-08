#!/usr/bin/env node
import { run } from "../cli";

process.exitCode = await run(
  process.argv.slice(2),
  (line) => process.stdout.write(line),
  (line) => process.stderr.write(line),
);
