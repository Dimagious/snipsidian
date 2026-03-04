const { execSync } = require("child_process");
const fs = require("fs");

// Obsidian release archives must contain only top-level plugin assets.
let files = ["main.js", "manifest.json", "styles.css"].filter((f) => fs.existsSync(f));

if (!files.length) {
    console.error("[snipsidian] Nothing to pack. Build first.");
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const name = `snipsidian-${pkg.version}.zip`;

if (fs.existsSync(name)) {
    fs.unlinkSync(name);
}

// Use system 'zip' if available (macOS/Linux). On Windows with Git Bash — also ok.
try {
    execSync(`zip -9 -r ${name} ${files.join(" ")}`, { stdio: "inherit" });
    console.log(`[snipsidian] Created ${name}`);
} catch (e) {
    console.error("[snipsidian] Failed to create zip via system 'zip'. You can install 'zip' or use adm-zip.");
    process.exit(1);
}
