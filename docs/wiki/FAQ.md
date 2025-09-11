# ❓ Frequently Asked Questions

Common questions and answers about Snipsy.

---

## 🚀 Getting Started

### Q: How do I install Snipsy?
**A:** The easiest way is through Obsidian's Community Plugins:
1. Open **Settings** → **Community plugins**
2. Click **Browse** and search for "Snipsy"
3. Click **Install** and **Enable**

For manual installation, download from [GitHub Releases](https://github.com/Dimagious/snipsidian/releases).

### Q: Do I need to restart Obsidian after installation?
**A:** No! Snipsy activates immediately after enabling. You can start using snippets right away.

### Q: Where are my snippets stored?
**A:** Snippets are stored in `.obsidian/plugins/snipsidian/data.json` in your vault. This file syncs with your vault across devices.

### Q: Will Snipsy work on mobile?
**A:** Yes! Snipsy works on Obsidian mobile apps. Your snippets sync automatically with your vault.

---

## 🎯 Using Snippets

### Q: How do I trigger snippet expansion?
**A:** Snippets expand when you type the trigger followed by:
- **Space** (`:todo `)
- **Enter** (`:todo` + Enter)
- **Punctuation** (`:todo.`, `:todo,`, `:todo!`)

### Q: Why isn't my snippet expanding?
**A:** Check these common issues:
- **Trigger spelling** - Make sure the trigger is exactly right
- **Context** - Snippets don't expand inside code blocks or YAML frontmatter
- **Spacing** - Try adding a space after the trigger
- **Case sensitivity** - Triggers are case-sensitive

### Q: Can I use snippets in code blocks?
**A:** No, and this is intentional! Snipsy is markdown-aware and won't expand inside:
- Code blocks (`` ``` ``)
- Inline code (`` ` ``)
- YAML frontmatter

This prevents unwanted expansions in your code.

### Q: How do I position the cursor after expansion?
**A:** Use `CURSOR_PLACEHOLDER` in your snippet replacement:
```
Trigger: :email
Replacement: Dear CURSOR_PLACEHOLDER,

Best regards,
Your Name
```

---

## 📦 Packages

### Q: What's the difference between built-in and community packages?
**A:** 
- **Built-in packages** come with Snipsy and are maintained by the development team
- **Community packages** are created by users and shared through the community

### Q: How do I install a community package?
**A:** 
1. Go to **Settings** → **Snipsy** → **Packages**
2. Choose a package from the dropdown
3. Click **Install**

### Q: Can I create my own packages?
**A:** Yes! See our [Package Creation Guide](Package-Creation) for detailed instructions.

### Q: How do I share my packages with others?
**A:** You can:
- Submit to the community catalog via GitHub
- Share YAML files directly
- Create a repository with your packages

---

## 🎮 Commands and Hotkeys

### Q: What commands does Snipsy provide?
**A:** Snipsy provides two main commands:
- **Insert Snippet…** - Opens the snippet picker
- **Open Snipy Settings** - Quick access to settings

### Q: How do I set up hotkeys?
**A:** 
1. Go to **Settings** → **Hotkeys** in Obsidian
2. Search for "Snipsy" or "Snipy"
3. Set your preferred hotkeys
4. Or use the "Set Hotkey" buttons in Snipsy settings

### Q: Can I have different hotkeys for different snippets?
**A:** Not directly, but you can use the snippet picker with a hotkey to quickly access all your snippets.

---

## 🔧 Settings and Configuration

### Q: How do I organize my snippets?
**A:** Use folders to group related snippets:
- Create folders in the Snippets tab
- Drag snippets between folders
- Use descriptive folder names (e.g., "Work", "Personal", "Coding")

### Q: Can I import snippets from other tools?
**A:** Yes! Snipsy supports:
- **Espanso YAML** - Paste directly into the Packages tab
- **JSON import** - Use the Import feature in settings
- **Manual creation** - Create snippets one by one

### Q: How do I backup my snippets?
**A:** 
1. Go to **Settings** → **Snipsy** → **Basic**
2. Click **Export** to download a JSON file
3. Keep this file safe - you can import it later

### Q: Can I sync snippets across devices?
**A:** Yes! Since snippets are stored in your vault, they sync automatically with Obsidian Sync, Git, or any other vault sync method.

---

## 🐛 Troubleshooting

### Q: Snipsy isn't working at all. What should I do?
**A:** Try these steps:
1. **Check if enabled** - Go to Settings → Community plugins
2. **Restart Obsidian** - Sometimes a restart helps
3. **Check console** - Look for error messages in Developer Tools
4. **Reinstall** - Disable, then re-enable the plugin

### Q: Some snippets work but others don't. Why?
**A:** This usually means:
- **Trigger conflicts** - Two snippets with the same trigger
- **Invalid characters** - Special characters in triggers
- **YAML formatting** - Incorrect YAML syntax in packages

### Q: Snippets expand in the wrong places. How do I fix this?
**A:** This is usually due to:
- **Context issues** - Snippets expanding in code blocks
- **Trigger conflicts** - Similar triggers interfering
- **Markdown parsing** - Obsidian's markdown processing

### Q: The snippet picker is slow. Can I speed it up?
**A:** Try these optimizations:
- **Reduce snippet count** - Remove unused snippets
- **Organize folders** - Better organization helps search
- **Clear search** - Don't leave search terms in the picker

---

## 🔄 Import and Export

### Q: How do I export my snippets?
**A:** 
1. Go to **Settings** → **Snipsy** → **Basic**
2. Click **Export** button
3. Save the JSON file to your computer

### Q: How do I import snippets from a backup?
**A:** 
1. Go to **Settings** → **Snipsy** → **Basic**
2. Click **Import** button
3. Select your JSON backup file
4. Choose merge or replace options

### Q: Can I merge snippets from multiple sources?
**A:** Yes! The import feature allows you to:
- **Merge** - Add new snippets to existing ones
- **Replace** - Replace all snippets with imported ones
- **Preview** - See what will be imported before confirming

---

## 🌐 Community and Sharing

### Q: How do I share my snippets with others?
**A:** You can:
- **Export and share** JSON files
- **Create packages** and submit to community
- **Share YAML** directly with other users
- **Publish packages** on GitHub or other platforms

### Q: Can I use snippets from other users?
**A:** Yes! You can:
- **Install community packages** from the catalog
- **Import YAML** from other users
- **Copy snippets** from shared JSON files
- **Browse community packages** for inspiration

### Q: How do I report bugs or suggest features?
**A:** Use the **Feedback tab** in Snipsy settings:
- **Report Bug** - Submit bug reports with auto-filled system info
- **Suggest Feature** - Share ideas for improvements
- **General Feedback** - Share your experience

---

## 🔒 Privacy and Security

### Q: Does Snipsy collect any data?
**A:** No! Snipsy is completely local:
- **No telemetry** - No usage data is collected
- **No internet** - All processing happens locally
- **Your data stays yours** - Snippets are stored in your vault

### Q: Are my snippets secure?
**A:** Yes! Your snippets are:
- **Stored locally** in your vault
- **Encrypted** if your vault is encrypted
- **Synced securely** with your vault sync method
- **Never sent** to external servers

### Q: Can I use Snipsy offline?
**A:** Yes! Snipsy works completely offline. You only need internet for:
- Installing the plugin
- Downloading community packages
- Updating the plugin

---

## 🎯 Advanced Usage

### Q: Can I create complex snippets with multiple lines?
**A:** Yes! Use `\\n` for line breaks:
```
Trigger: :meeting
Replacement: ## Meeting Notes\n\n**Date:** CURSOR_PLACEHOLDER\n**Attendees:** \n**Agenda:** \n\n### Discussion\n\n### Action Items\n- [ ]
```

### Q: Can I use special characters in snippets?
**A:** Yes, but you may need to escape them in YAML:
- **Quotes**: Use `\"` for double quotes
- **Backslashes**: Use `\\` for literal backslashes
- **Line breaks**: Use `\\n` for new lines

### Q: How many snippets can I have?
**A:** There's no hard limit, but performance may degrade with thousands of snippets. Most users find 100-500 snippets to be optimal.

### Q: Can I create snippets that work differently in different contexts?
**A:** Not currently, but this is a planned feature. For now, all snippets work the same way regardless of context.

---

## 🆘 Still Need Help?

### 📞 Contact Options
- **GitHub Issues** - [Report bugs or request features](https://github.com/Dimagious/snipsidian/issues)
- **Feedback Tab** - Use the built-in feedback system in Snipsy settings

### 📖 Additional Resources
- **[Getting Started Guide](Getting-Started)** - Complete setup guide
- **[Package Creation Guide](Package-Creation)** - Create your own packages
- **[Troubleshooting Guide](Troubleshooting)** - Technical issues and solutions
- **[Community Guidelines](Community-Guidelines)** - How to contribute

---

## 🎉 Pro Tips

### 💡 Best Practices
- **Use descriptive triggers** - `:email` is better than `:e`
- **Organize with folders** - Group related snippets together
- **Test thoroughly** - Make sure snippets work as expected
- **Backup regularly** - Export your snippets periodically
- **Share with community** - Help others by sharing great packages

### 🚀 Power User Tips
- **Use the snippet picker** - Great for discovering available snippets
- **Create package collections** - Group related snippets into packages
- **Leverage built-in packages** - Start with these before creating custom ones
- **Join the community** - Learn from other users and share your knowledge

---

**Happy expanding!** 🎯

*Last updated: September 2025*
