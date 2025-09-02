const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const man = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

if (pkg.version !== man.version) {
    console.error(`[version] package.json (${pkg.version}) != manifest.json (${man.version})`);
    process.exit(1);
}
console.log(`[version] OK: ${pkg.version}`);
