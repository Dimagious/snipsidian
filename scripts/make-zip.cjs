const { execSync } = require("child_process");
const fs = require("fs");

let files = ["main.js", "manifest.json", "styles.css"];

if (fs.existsSync("docs/screens")) {
    files.push("docs/screens");
}

files = files.filter(f => fs.existsSync(f));

if (!files.length) {
    console.error("[snipsidian] Nothing to pack. Build first.");
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const name = `snipsidian-${pkg.version}.zip`;

// Use system 'zip' if available (macOS/Linux). On Windows with Git Bash — also ok.
try {
    execSync(`zip -9 -r ${name} ${files.join(" ")}`, { stdio: "inherit" });
    console.log(`[snipsidian] Created ${name}`);
} catch (e) {
    console.error("[snipsidian] Failed to create zip via system 'zip'. You can install 'zip' or use adm-zip.");
    process.exit(1);
}
