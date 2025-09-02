const fs = require("fs");

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const man = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

const from = man.version;
const to = pkg.version;

if (from === to) {
    console.log(`[snipsidian] manifest.json is already in sync (${to})`);
    process.exit(0);
}

man.version = to;
fs.writeFileSync("manifest.json", JSON.stringify(man, null, 2) + "\n", "utf8");
console.log(`[snipsidian] manifest.json version updated: ${from} → ${to}`);
