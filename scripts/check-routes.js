#!/usr/bin/env node
// Sanity-checks data/routes.js. Plain Node, no dependencies.
//   node scripts/check-routes.js           errors fail (exit 1), warnings don't
//   node scripts/check-routes.js --strict  warnings fail too
//   node scripts/check-routes.js path/to/routes.js  check another file
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const FILE = fileArg ? path.resolve(fileArg) : path.join(__dirname, "..", "data", "routes.js");
const NAME = path.relative(process.cwd(), FILE);
const TYPES = ["loop", "out-and-back", "point-to-point"];
const WATER = ["reliable", "limited", "none"];
const STATES = ["OR", "WA"];
const STRINGS = ["id", "name", "area", "region", "start", "quip", "badge", "stop", "surface", "waterNote"];
const NUMBERS = ["miles", "gain", "gravel", "difficulty", "tire"];
const LOOP_CLOSE_MI = 0.5; // a loop's last point should land this close to its first
const DIST_TOLERANCE = 0.25; // warn when drawn miles are >25% off stated miles
const GAIN_TOLERANCE = 0.4; // profile has few samples, so allow more slack on climbing

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(FILE, "utf8"), sandbox, { filename: FILE });
const routes = sandbox.window.PNW_ROUTES;

const errors = [];
const warnings = [];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.trim() !== "";

function miles([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(a));
}
const pct = (n) => `${Math.round(n * 100)}%`;
const fmt = (n) => Math.round(n).toLocaleString("en-US");

if (!Array.isArray(routes) || !routes.length) {
  console.error(`✗ ${NAME} did not set a non-empty window.PNW_ROUTES array`);
  process.exit(1);
}

const seen = new Set();
routes.forEach((r, i) => {
  const id = isStr(r && r.id) ? r.id : `#${i}`;
  const err = (msg) => errors.push(`${id}: ${msg}`);
  const warn = (msg) => warnings.push(`${id}: ${msg}`);

  if (seen.has(id)) err("duplicate id");
  seen.add(id);

  STRINGS.forEach((k) => { if (!isStr(r[k])) err(`missing or empty "${k}"`); });
  NUMBERS.forEach((k) => { if (!isNum(r[k]) || r[k] < 0) err(`"${k}" must be a non-negative number`); });
  if (!TYPES.includes(r.type)) err(`"type" must be one of ${TYPES.join(", ")} (got ${JSON.stringify(r.type)})`);
  if (!STATES.includes(r.state)) err(`"state" must be one of ${STATES.join(", ")}`);
  if (!WATER.includes(r.water)) err(`"water" must be one of ${WATER.join(", ")}`);
  if (isNum(r.gravel) && r.gravel > 100) err(`"gravel" is a percent, got ${r.gravel}`);
  if (isNum(r.difficulty) && (r.difficulty < 1 || r.difficulty > 5 || !Number.isInteger(r.difficulty))) err(`"difficulty" must be an integer 1–5`);
  if (r.pass !== null && !isStr(r.pass)) err(`"pass" must be a string or null`);
  if (!r.drive || !isNum(r.drive.pdx) || !isNum(r.drive.sea)) err(`"drive" needs numeric pdx and sea hours`);
  ["highlights", "cautions"].forEach((k) => {
    if (!Array.isArray(r[k]) || !r[k].length || !r[k].every(isStr)) err(`"${k}" must be a non-empty list of strings`);
  });

  const m = r.months;
  if (!Array.isArray(m) || !m.length || !m.every((v) => Number.isInteger(v) && v >= 1 && v <= 12)) {
    err(`"months" must be a non-empty list of month numbers 1–12`);
  } else if (m.some((v, j) => j > 0 && v <= m[j - 1])) {
    err(`"months" must be sorted ascending with no repeats (got ${m.join(", ")})`);
  }

  const p = r.path;
  const pathOk = Array.isArray(p) && p.length >= 2 && p.every((pt) =>
    Array.isArray(pt) && pt.length === 2 && isNum(pt[0]) && isNum(pt[1]) &&
    pt[0] >= 41 && pt[0] <= 49.5 && pt[1] >= -125 && pt[1] <= -116);
  if (!pathOk) err(`"path" must be 2+ [lat, lng] points inside Oregon/Washington`);

  const prof = r.profile;
  const profOk = Array.isArray(prof) && prof.length >= 2 && prof.every(isNum);
  if (!profOk) err(`"profile" must be 2+ elevation numbers in feet`);

  if (pathOk && TYPES.includes(r.type)) {
    const gap = miles(p[0], p[p.length - 1]);
    if (r.type === "loop" && gap > LOOP_CLOSE_MI) err(`type is loop but path ends ${gap.toFixed(1)} mi from its start`);
    if (r.type !== "loop" && gap <= LOOP_CLOSE_MI) err(`type is ${r.type} but path closes like a loop`);

    let drawn = 0;
    for (let j = 1; j < p.length; j++) drawn += miles(p[j - 1], p[j]);
    if (r.type === "out-and-back") drawn *= 2; // drawn one way, ridden both
    if (isNum(r.miles) && r.miles > 0 && Math.abs(drawn - r.miles) / r.miles > DIST_TOLERANCE) {
      warn(`drawn line is ~${Math.round(drawn)} mi vs ${r.miles} mi stated (${pct(drawn / r.miles)})`);
    }
  }

  if (profOk && isNum(r.gain) && r.gain > 0) {
    let climb = 0;
    for (let j = 1; j < prof.length; j++) climb += Math.max(0, prof[j] - prof[j - 1]);
    if (Math.abs(climb - r.gain) / r.gain > GAIN_TOLERANCE) {
      warn(`profile climbs ~${fmt(climb)} ft vs ${fmt(r.gain)} ft stated (${pct(climb / r.gain)})`);
    }
  }
});

console.log(`Checked ${routes.length} routes in ${NAME}`);
errors.forEach((e) => console.log(`  ✗ ${e}`));
warnings.forEach((w) => console.log(`  ! ${w}`));
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
if (warnings.length && !errors.length) {
  console.log("Warnings flag sketch geometry or profiles that don't match the stated numbers. Riders see the stated numbers.");
}
const strict = process.argv.includes("--strict");
process.exit(errors.length || (strict && warnings.length) ? 1 : 0);
