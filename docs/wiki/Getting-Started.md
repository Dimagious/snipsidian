# 🎯 Getting Started with Snipsy

Welcome to Snipsy! This guide will help you get up and running with text expansion in Obsidian.

---

## 📥 Installation

### Method 1: Community Plugins (Recommended)
1. Open **Settings** in Obsidian (`Ctrl/Cmd + ,`)
2. Go to **Community plugins**
3. Click **Browse** and search for **"Snipsy"**
4. Click **Install** and then **Enable**

### Method 2: Manual Installation
1. Download the latest release from [GitHub](https://github.com/Dimagious/snipsidian/releases)
2. Extract the ZIP file to your vault's `.obsidian/plugins/` folder
3. Restart Obsidian and enable the plugin in **Settings → Community plugins**

---

## ⚙️ Basic Configuration

### 1. Open Snipsy Settings
- Go to **Settings → Snipsy** in Obsidian
- You'll see four tabs: **Basic**, **Packages**, **Snippets**, and **Feedback**

### 2. Set Up Commands
In the **Basic** tab, you can configure hotkeys for:
- **Insert Snippet…** - Opens the snippet picker
- **Open Snipy Settings** - Quick access to settings

### 3. Install Your First Package
1. Go to the **Packages** tab
2. Choose a package from the dropdown (e.g., "Markdown basics (builtin)")
3. Click **Install**
4. Your snippets are now ready to use!

### 4. Browse Community Packages
1. Go to the **Community Packages** tab
2. Browse available packages from the community
3. Use the search bar to find specific packages
4. Click **Install** next to any package you want
5. Packages will show **"✓ Installed"** when already installed

---

## 🎮 Your First Snippets

### Built-in Snippets
Snipsy comes with several built-in packages:

| Package | Description | Example |
|---------|-------------|---------|
| **Markdown Basics** | Essential formatting | `:bold` → `**text**` |
| **Obsidian Callouts** | Callout blocks | `:note` → `> [!note]` |
| **Emoji (lite)** | Popular emojis | `:smile` → 😄 |
| **Task States** | Todo management | `:todo` → `- [ ]` |
| **Unicode Arrows** | Directional symbols | `:arrow` → → |
| **Math Symbols** | Mathematical notation | `:times` → × |

### Try It Out!
1. Open any note in Obsidian
2. Type `:todo` followed by a space
3. Watch it expand to `- [ ]`
4. Try other triggers like `:smile`, `:note`, `:bold`

---

## 🎯 Using the Snippet Picker

The **Snippet Picker** is a powerful tool for finding and inserting snippets:

### Opening the Picker
- **Command Palette**: `Ctrl/Cmd + P` → "Insert Snippet…"
- **Hotkey**: Set a custom hotkey in settings
- **Settings**: Use the "Set Hotkey" button in Basic tab

### Using the Picker
1. **Search**: Type to search by trigger or replacement text
2. **Navigate**: Use arrow keys to move through results
3. **Preview**: See snippet content with placeholder highlighting
4. **Insert**: Press Enter to insert the selected snippet

---

## 📦 Managing Snippets

### Creating Your Own Snippets
1. Go to **Settings → Snipsy → Snippets**
2. Click **"Add New Snippet"**
3. Fill in:
   - **Trigger**: The text that will expand (e.g., `:email`)
   - **Replacement**: What it expands to (e.g., `your@email.com`)
   - **Folder**: Organize snippets in folders
4. Click **Save**

### Organizing Snippets
- **Folders**: Group related snippets together
- **Bulk Operations**: Select multiple snippets for batch editing
- **Search**: Find snippets quickly with the search bar
- **Move**: Drag snippets between folders

### Import/Export
- **Export**: Backup your snippets as JSON
- **Import**: Restore snippets from backup
- **Sync**: Snippets sync with your vault across devices

### Community Package Management
- **Browse Packages**: Discover packages created by the community
- **Search & Filter**: Find packages by name, description, or tags
- **Install Packages**: One-click installation with conflict resolution
- **Package Details**: View package information, snippets, and installation status
- **Auto-updates**: Packages stay up-to-date with community improvements

---

## 🔧 Advanced Features

### Expansion Triggers
Snippets expand when you type:
- **Space** after a trigger
- **Enter** after a trigger
- **Punctuation** after a trigger (`.`, `,`, `!`, `?`, etc.)

### Smart Detection
Snipsy is **markdown-aware** and won't expand inside:
- Code blocks (`` ``` ``)
- Inline code (`` ` ``)
- YAML frontmatter

### Cursor Placement
- **CURSOR_PLACEHOLDER**: Place cursor at this position after expansion
- **Smart positioning**: Automatic cursor placement for common patterns

---

## 📦 Submit Your Own Package

Want to share your snippet collection with the community? Here's how:

### Creating a Package
1. Go to the **Community Packages** tab
2. Scroll down to **"Submit New Package"**
3. Paste your package YAML in the text area
4. Click **"Validate Package"** to check for errors
5. Click **"Submit Package"** to submit via Google Form

### Package Format
Your package should include:
- **name**: Package name
- **author**: Your name
- **version**: Package version (e.g., "1.0.0")
- **description**: What your package does
- **snippets**: Your snippet collection

### Example Package
```yaml
name: "My Awesome Snippets"
author: "Your Name"
version: "1.0.0"
description: "A collection of useful snippets for productivity"
snippets:
  ":email": "your@email.com"
  ":phone": "+1-555-0123"
  ":signature": "Best regards,\nYour Name"
```

### Espanso Package Import
You can also import packages from [Espanso Hub](https://hub.espanso.org/):
1. Go to **"Install Espanso Package"** section
2. Copy YAML from any Espanso package
3. Paste it in the text area
4. Click **"Install Espanso Package"**

## 💬 Feedback Tab

The **Feedback** tab provides easy ways to:
- **Suggest Features**: Share ideas for improvements
- **Report Bugs**: Submit bug reports with auto-filled system info
- **General Feedback**: Share your experience
- **Access Support**: Links to documentation and community

---

## 🎯 Tips and Tricks

### 1. Use Descriptive Triggers
- ✅ Good: `:email`, `:phone`, `:address`
- ❌ Avoid: `:e`, `:p`, `:a` (too short, might conflict)

### 2. Organize with Folders
- Create folders for different purposes: `work`, `personal`, `coding`
- Use consistent naming conventions

### 3. Leverage Built-in Packages
- Start with built-in packages before creating custom ones
- They're tested, well-organized, and cover common use cases

### 4. Use the Snippet Picker
- Great for discovering available snippets
- Perfect when you can't remember the exact trigger
- Shows previews to help you choose the right snippet

### 5. Explore Community Packages
- Browse community packages for inspiration
- Install packages that match your workflow
- Submit your own packages to help others

### 6. Backup Your Snippets
- Export your snippets regularly
- Keep backups in a safe place
- Test your backups by importing them

---

## 🆘 Need Help?

- **📖 Check the [FAQ](FAQ)** for common questions
- **🐛 Visit [Troubleshooting](Troubleshooting)** for technical issues
- **💬 Use the Feedback tab** in Snipsy settings
- **📧 Contact me** via [GitHub Issues](https://github.com/Dimagious/snipsidian/issues)

---

**Happy expanding!** 🚀
