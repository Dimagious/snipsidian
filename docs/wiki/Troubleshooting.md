# 🐛 Troubleshooting Guide

Common issues and solutions for Snipsy.

---

## 🚨 Quick Fixes

### Plugin Not Working
**Problem:** Snipsy isn't expanding snippets at all.

**Solutions:**
1. **Check if enabled** - Go to Settings → Community plugins → Snipsy should be enabled
2. **Restart Obsidian** - Sometimes a restart resolves initialization issues
3. **Check console** - Open Developer Tools (Ctrl+Shift+I) and look for error messages
4. **Reinstall plugin** - Disable, then re-enable Snipsy

### Snippets Not Expanding
**Problem:** Some or all snippets aren't expanding when typed.

**Solutions:**
1. **Check trigger spelling** - Make sure the trigger is exactly right (case-sensitive)
2. **Add space or punctuation** - Try typing a space after the trigger
3. **Check context** - Snippets don't expand inside code blocks or YAML frontmatter
4. **Verify snippet exists** - Check if the snippet is in your settings

### Performance Issues
**Problem:** Snipsy is slow or causing lag.

**Solutions:**
1. **Reduce snippet count** - Remove unused snippets
2. **Organize folders** - Better organization improves search performance
3. **Clear search terms** - Don't leave search terms in the snippet picker
4. **Restart Obsidian** - Clear any memory issues

---

## 🔧 Common Issues

### Issue: Snippet Expands in Wrong Places

**Symptoms:**
- Snippets expand inside code blocks
- Snippets expand in YAML frontmatter
- Unwanted expansions in unexpected contexts

**Causes:**
- Markdown parsing issues
- Context detection problems
- Trigger conflicts

**Solutions:**
1. **Check markdown context** - Snipsy should not expand in:
   - Code blocks (`` ``` ``)
   - Inline code (`` ` ``)
   - YAML frontmatter
2. **Use more specific triggers** - Avoid very short triggers like `:e`
3. **Check for conflicts** - Make sure no two snippets have the same trigger

### Issue: Cursor Positioning Problems

**Symptoms:**
- Cursor ends up in wrong place after expansion
- Cursor doesn't move at all
- Cursor moves to unexpected location

**Causes:**
- Missing `CURSOR_PLACEHOLDER` in snippet
- Incorrect placeholder usage
- Markdown parsing issues

**Solutions:**
1. **Use CURSOR_PLACEHOLDER** - Place this exactly where you want the cursor
2. **Test thoroughly** - Try your snippets in different contexts
3. **Check YAML formatting** - Make sure placeholders are properly formatted

### Issue: Package Installation Fails

**Symptoms:**
- YAML import fails
- Package doesn't appear after installation
- Error messages during installation

**Causes:**
- Invalid YAML syntax
- Missing required fields
- Conflicting package names

**Solutions:**
1. **Validate YAML** - Use an online YAML validator
2. **Check package format** - Follow the [Package Creation Guide](Package-Creation)
3. **Check for conflicts** - Make sure package names don't conflict
4. **Try smaller packages** - Test with simple packages first

### Issue: Snippet Picker Not Working

**Symptoms:**
- Snippet picker doesn't open
- Search doesn't work
- No snippets appear in picker

**Causes:**
- Command not registered
- Search index issues
- UI rendering problems

**Solutions:**
1. **Check command registration** - Go to Settings → Hotkeys and search for "Snipsy"
2. **Restart Obsidian** - Clear any UI state issues
3. **Check snippet count** - Make sure you have snippets installed
4. **Try different search terms** - Test with simple searches

---

## 🔍 Debugging Steps

### Step 1: Check Plugin Status
1. Go to **Settings** → **Community plugins**
2. Verify Snipsy is **enabled**
3. Check if there are any error messages
4. Try disabling and re-enabling the plugin

### Step 2: Check Console for Errors
1. Open **Developer Tools** (Ctrl+Shift+I)
2. Go to **Console** tab
3. Look for error messages related to Snipsy
4. Take a screenshot of any errors for support

### Step 3: Verify Snippet Configuration
1. Go to **Settings** → **Snipsy** → **Snippets**
2. Check if your snippets are listed
3. Verify trigger and replacement text
4. Test snippets by typing them

### Step 4: Test in Different Contexts
1. Try snippets in a new note
2. Test in different file types
3. Check if snippets work in different vaults
4. Test with different trigger patterns

### Step 5: Check System Information
1. Note your **Obsidian version**
2. Check your **operating system**
3. Verify **plugin version**
4. Check if other plugins might be interfering

---

## 🛠️ Advanced Troubleshooting

### Performance Optimization

#### Large Snippet Collections
**Problem:** Performance degrades with many snippets.

**Solutions:**
- **Organize with folders** - Better organization improves search
- **Remove unused snippets** - Clean up old or unused snippets
- **Use package system** - Group related snippets into packages
- **Consider splitting** - Break large collections into smaller packages

#### Memory Usage
**Problem:** Snipsy uses too much memory.

**Solutions:**
- **Restart Obsidian** - Clear memory leaks
- **Reduce snippet count** - Remove unnecessary snippets
- **Check for duplicates** - Remove duplicate snippets
- **Optimize replacements** - Keep replacement text concise

### Compatibility Issues

#### Plugin Conflicts
**Problem:** Snipsy conflicts with other plugins.

**Solutions:**
- **Disable other plugins** - Test with only Snipsy enabled
- **Check plugin order** - Some plugins need to load in specific order
- **Update plugins** - Make sure all plugins are up to date
- **Contact plugin authors** - Report conflicts to relevant developers

#### Theme Issues
**Problem:** Snipsy UI doesn't look right with certain themes.

**Solutions:**
- **Try default theme** - Test with Obsidian's default theme
- **Check theme compatibility** - Some themes may need updates
- **Report to theme author** - Let theme developers know about issues
- **Use theme overrides** - Add custom CSS if needed

### Data Issues

#### Snippet Data Corruption
**Problem:** Snippets are missing or corrupted.

**Solutions:**
- **Check data file** - Look at `.obsidian/plugins/snipsidian/data.json`
- **Restore from backup** - Use your exported JSON backup
- **Reinstall packages** - Reinstall any corrupted packages
- **Reset to defaults** - Use "Add missing defaults" button

#### Sync Issues
**Problem:** Snippets don't sync across devices.

**Solutions:**
- **Check sync method** - Verify your vault sync is working
- **Force sync** - Manually trigger vault sync
- **Check file permissions** - Make sure data.json is synced
- **Test with simple snippets** - Verify sync works with basic snippets

---

## 📊 Diagnostic Information

### System Information to Collect
When reporting issues, include:

```
Obsidian Version: [version]
Snipsy Version: [version]
Operating System: [OS and version]
Vault Size: [number of files]
Snippet Count: [number of snippets]
Other Plugins: [list of enabled plugins]
```

### Log Files
1. **Console logs** - From Developer Tools
2. **Plugin logs** - Check for Snipsy-specific messages
3. **Error messages** - Screenshots of any error dialogs
4. **Data file** - Contents of data.json (remove sensitive information)

### Performance Metrics
- **Snippet count** - Total number of snippets
- **Package count** - Number of installed packages
- **Vault size** - Number of files in vault
- **Memory usage** - Obsidian's memory consumption
- **Startup time** - Time for Snipsy to initialize

---

## 🆘 Getting Help

### Before Asking for Help
1. **Check this guide** - Many issues are covered here
2. **Search existing issues** - Check GitHub issues for similar problems
3. **Try basic troubleshooting** - Follow the debugging steps above
4. **Collect information** - Gather system info and error messages

### How to Report Issues
1. **Use the Feedback tab** - Built-in feedback system in Snipsy settings
2. **Create GitHub issue** - For technical problems

### What to Include in Reports
- **Clear description** of the problem
- **Steps to reproduce** the issue
- **Expected vs actual behavior**
- **System information** (see above)
- **Error messages** and screenshots
- **What you've already tried**

---

## 🔧 Recovery Procedures

### Complete Reset
If nothing else works:

1. **Export snippets** - Save your current snippets
2. **Disable plugin** - Turn off Snipsy
3. **Delete data file** - Remove `.obsidian/plugins/snipsidian/data.json`
4. **Restart Obsidian** - Clear all plugin state
5. **Re-enable plugin** - Turn Snipsy back on
6. **Import snippets** - Restore from your backup

### Partial Reset
For specific issues:

1. **Remove problematic snippets** - Delete specific snippets causing issues
2. **Reinstall packages** - Remove and reinstall packages
3. **Clear search cache** - Reset snippet picker state
4. **Restart Obsidian** - Clear temporary state

### Data Recovery
If you lose snippets:

1. **Check backups** - Look for exported JSON files
2. **Check version control** - If using Git, check previous commits
3. **Check sync** - Look for data.json in sync history
4. **Recreate manually** - Recreate important snippets from memory

---

## 🎯 Prevention Tips

### Regular Maintenance
- **Export snippets** regularly
- **Remove unused snippets** periodically
- **Update packages** when new versions are available
- **Test after updates** to ensure everything works

### Best Practices
- **Use descriptive triggers** - Avoid conflicts and confusion
- **Organize with folders** - Keep snippets well-organized
- **Test thoroughly** - Verify snippets work before relying on them
- **Keep backups** - Always have a recent backup of your snippets

### Monitoring
- **Watch for errors** - Check console for warning messages
- **Monitor performance** - Notice if Obsidian becomes slower
- **Check updates** - Keep Snipsy and other plugins updated
- **Report issues** - Help improve Snipsy by reporting problems

---

## 🎉 Still Need Help?

If you've tried everything and still need help:

- **📧 Contact us** via [GitHub Issues](https://github.com/Dimagious/snipsidian/issues)
- **📖 Check the [FAQ](FAQ)** for more common questions

**We're here to help!** 🚀

---

*Last updated: September 2025*
