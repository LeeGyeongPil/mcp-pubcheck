#!/usr/bin/env node
import { runCli } from "./main.js";

const code = await runCli(process.argv.slice(2), process.env, {
  out: (s) => process.stdout.write(s + "\n"),
  err: (s) => process.stderr.write(s + "\n"),
  isTTY: process.stdout.isTTY === true,
});
process.exitCode = code;
