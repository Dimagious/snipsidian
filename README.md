# Snipsy

[![CI](https://img.shields.io/github/actions/workflow/status/Dimagious/snipsidian/ci.yml?branch=main&label=ci)](https://github.com/Dimagious/snipsidian/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/Dimagious/snipsidian/branch/main/graph/badge.svg)](https://codecov.io/gh/Dimagious/snipsidian)
[![Release](https://img.shields.io/github/v/release/Dimagious/snipsidian)](https://github.com/Dimagious/snipsidian/releases)
![Obsidian ≥ 1.5.0](https://img.shields.io/badge/obsidian-%E2%89%A5%201.5.0-7c3aed)
![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6)
![Vitest](https://img.shields.io/badge/tests-vitest-6b46c1)
![esbuild](https://img.shields.io/badge/bundler-esbuild-fbbf24)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-☕-ff813f?logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/dimagious)

> **Snipsy** is a powerful text expansion plugin for Obsidian that brings **hotstrings** and **snippet management** to your note-taking workflow. Transform your typing with intelligent text expansion, organized snippet libraries, and seamless integration with your favorite markdown editor.

---

## 🎯 What is Snipsy?

Snipsy transforms your Obsidian experience by allowing you to create **text shortcuts** that expand into full content. Type `:todo` and watch it instantly become `- [ ]`. Type `:warn` and get a beautiful warning callout block. Organize your snippets, install curated packages, and supercharge your markdown workflow — all without leaving Obsidian.

![Snipsy demo](docs/screens/demo.gif)

---

## ✨ Key Features

### 🚀 **Smart Text Expansion**
- **Instant expansion** after space, Enter, or punctuation
- **Markdown-aware** - no expansion inside code blocks or YAML frontmatter
- **Word boundary detection** to prevent false positives
- **Cursor positioning** - smart placement after expansion

### 🎯 **Snippet Picker Command** *(New in v0.8.0)*
- **Quick access** via Command Palette: `Insert Snippet…`
- **Real-time search** by trigger or replacement text
- **Live preview** with placeholder highlighting
- **Keyboard navigation** for accessibility
- **Smart cursor placement** and tabstop detection

### ⚙️ **Command Palette Integration** *(New in v0.8.0)*
- **Insert Snippet** - Open snippet picker for quick insertion
- **Open Snipy Settings** - Direct access to plugin settings
- **Hotkey configuration** - Set custom shortcuts for both commands

### 🗂️ **Advanced Snippet Management**
- **Organized folders** - Group snippets by category or project
- **Bulk operations** - Multi-select with checkboxes for batch editing
- **Move & reorganize** - Drag snippets between folders or create new groups
- **Search & filter** - Find snippets quickly with real-time search
- **Expand/collapse** - Collapsed groups by default for cleaner interface

### 📦 **Package Manager**
- **Curated catalog** - Install from built-in, Obsidian-optimized packages
- **Espanso compatibility** - Paste any YAML from [Espanso Hub](https://hub.espanso.org/)
- **Conflict resolution** - Preview and resolve conflicts before installation
- **One-click install** - Streamlined package installation process

### 🔄 **Import & Export**
- **JSON export** - Backup your snippets as JSON files
- **JSON import** - Restore snippets from backup files
- **Cross-device sync** - Snippets sync with your vault across devices
- **Default restoration** - Add missing default snippets anytime

---

## 📚 Built-in Snippet Packages

Snipsy comes with a comprehensive collection of ready-to-use snippets:

| Package | Description | Examples |
|---------|-------------|----------|
| **🎭 Emoji (lite)** | Popular emojis for quick access | `:smile` → 😀, `:heart` → ❤️, `:fire` → 🔥 |
| **✅ Task States** | Todo list management | `:todo` → `- [ ]`, `:done` → `- [x]`, `:doing` → `- [/]` |
| **📝 Markdown Basics** | Essential markdown formatting | `:bold` → `**text**`, `:italic` → `_text_`, `:code` → `` `code` `` |
| **📊 Markdown Tables** | Quick table scaffolding | `:table` → 3×3 table template |
| **➡️ Unicode Arrows** | Directional symbols | `:arrow` → →, `:left` → ←, `:up` → ↑ |
| **🔢 Math Symbols** | Mathematical notation | `:plus` → ±, `:times` → ×, `:leq` → ≤, `:geq` → ≥ |
| **📋 Obsidian Callouts** | Callout blocks | `:note` → `> [!note]`, `:warning` → `> [!warning]` |

> 💡 **Need more?** Install any [Espanso-compatible package](https://hub.espanso.org/search) by pasting YAML directly into Snipsy.

---

## 🚀 Quick Start

### 1. Installation
1. Open **Settings → Community plugins** in Obsidian
2. Search for **"Snipsy"** and install
3. Enable the plugin

### 2. First Steps
1. Go to **Settings → Snipsy** to open the plugin settings
2. Try the **Snippet Picker** command from the Command Palette (`Ctrl/Cmd + P`)
3. Install a package from the **Packages** tab
4. Start typing triggers in your notes!

### 3. Create Your First Snippet
1. Go to **Settings → Snipsy → Snippets**
2. Click **"Add New Snippet"**
3. Set trigger (e.g., `:email`) and replacement (e.g., `your@email.com`)
4. Save and test in your notes!

---

## 🎮 Commands & Hotkeys

Snipsy provides two main commands accessible via the Command Palette:

| Command | Description | Default Hotkey |
|---------|-------------|----------------|
| **Insert Snippet…** | Open snippet picker for quick insertion | *Not set* |
| **Open Snipy Settings** | Direct access to plugin settings | *Not set* |

### Setting Up Hotkeys
1. Go to **Settings → Hotkeys** in Obsidian
2. Search for **"Snipsy"** or **"Snipy"**
3. Set your preferred hotkeys for both commands
4. Or use the **"Set Hotkey"** buttons in Snipsy settings

---

## 📐 How Text Expansion Works

### Expansion Triggers
Snipsy expands snippets when you type:
- **Space** after a trigger
- **Enter** after a trigger  
- **Punctuation** after a trigger (`.`, `,`, `!`, `?`, etc.)

### Smart Detection
- **Word boundaries** - Prevents false positives
- **Markdown awareness** - No expansion inside:
  - Code blocks (`` ``` ``)
  - Inline code (`` ` ``)
  - YAML frontmatter
- **Context sensitivity** - Respects your writing context

### Example Usage
```
Type: "I need to :todo buy groceries"
Result: "I need to - [ ] buy groceries"

Type: "Remember: :note important meeting"
Result: "Remember: > [!note] important meeting"
```

---

## 🗄️ Data Storage & Sync

### File Location
Your snippets are stored in:
```
.obsidian/plugins/snipsidian/data.json
```

### Sync Behavior
- **Automatic sync** with your Obsidian vault
- **Cross-device compatibility** - snippets work on all devices
- **Version control friendly** - JSON format is human-readable
- **Backup included** - Export/import functionality for safety

### Data Structure
```json
{
  "snippets": {
    "user:hello": "Hello World!",
    "user:email": "your@email.com",
    "builtin-emoji:smile": "😀"
  },
  "ui": {
    "groupOpen": {
      "user": false,
      "builtin-emoji": true
    }
  }
}
```

---

## 🎨 User Interface

### Settings Tabs
- **Basic** - Commands, export/import, help & resources
- **Packages** - Install from catalog or paste YAML
- **Snippets** - Manage your snippet library

### Visual Design
- **Unified green theme** across all sections
- **Professional appearance** without distracting icons
- **Collapsed groups** by default for cleaner interface
- **Responsive design** that works on all screen sizes

---

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm or yarn
- Obsidian vault for testing

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Dimagious/snipsidian.git
   cd snipsidian
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up vault path** (one-time setup):
   ```bash
   # macOS/Linux
   echo 'export VAULT_PLUGIN="<path-to-vault>/.obsidian/plugins/snipsidian"' >> ~/.zshrc
   source ~/.zshrc
   
   # Windows
   setx VAULT_PLUGIN "<path-to-vault>\.obsidian\plugins\snipsidian"
   ```

4. **Build and test:**
   ```bash
   npm run build:vault    # Build into your vault
   npm run dev:vault      # Watch mode for development
   npm test               # Run test suite
   ```

### Development Commands
```bash
npm run build           # Build main.js in repo root
npm run build:vault     # Build directly into vault
npm run dev:vault       # Watch mode for development
npm test                # Run tests with coverage
npm run coverage        # Generate coverage report
npm run release:check   # Pre-release validation
npm run release:zip     # Create release package
```

### Testing
- **119 tests** with **91.89% coverage**
- **Vitest** test runner with **jsdom** environment
- **TypeScript** strict mode enabled
- **CI/CD** with GitHub Actions

---

## 📸 Screenshots

### Settings Interface
![Settings Interface](docs/screens/settings.png)

### Snippet Management
| Snippets Manager | Selection Mode |
|------------------|----------------|
| ![Snippets](docs/screens/snippets.png) | ![Selection](docs/screens/selection-mode.png) |

### Package Installation
![Package Installation](docs/screens/espanso-demo.gif)

---

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Bug Reports
- Use the [GitHub Issues](https://github.com/Dimagious/snipsidian/issues) page
- Include steps to reproduce and expected behavior
- Attach relevant screenshots or error messages

### Feature Requests
- Open an issue first to discuss the feature
- Provide use cases and examples
- Consider backward compatibility

### Pull Requests
- Keep changes small and focused
- Add tests for new functionality
- Update documentation as needed
- Follow the existing code style

### Development Guidelines
- **TypeScript** - Use strict typing
- **Testing** - Maintain high test coverage
- **Documentation** - Update README and CHANGELOG
- **Performance** - Consider bundle size impact

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **Espanso** - For the inspiration and YAML compatibility
- **Obsidian** - For the amazing plugin ecosystem
- **Community** - For feedback, bug reports, and feature suggestions

---

## 📊 Project Stats

- **Test Coverage**: 91.89%
- **Bundle Size**: ~76.6kb
- **TypeScript**: Strict mode enabled
- **Tests**: 119 passing tests
- **Dependencies**: Minimal and well-maintained

---

## 💖 Support

If you find Snipsy helpful, consider:

- ⭐ **Starring** the repository
- 🐛 **Reporting** bugs or suggesting features
- ☕ **Buying me a coffee** to support development
- 📢 **Sharing** with the Obsidian community

---

**Made with ❤️ for the Obsidian community**