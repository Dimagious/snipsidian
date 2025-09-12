# 🔧 API Reference

Technical documentation for Snipsy developers and advanced users.

---

## 📋 Package Format Specification

### Complete Package Schema
```yaml
# Package metadata
name: string                    # Required: Package name
version: string                 # Required: Semantic version (e.g., "1.0.0")
author: string                  # Required: Author name or username
description: string             # Required: Brief description (1-2 sentences)
category: string                # Optional: Package category (see categories below)
tags: string[]                  # Optional: Array of tags for discovery
license: string                 # Optional: License type (MIT, GPL, etc.)
homepage: string                # Optional: Link to package homepage
readme: string                  # Optional: Extended description

# Snippets array
snippets:
  - trigger: string             # Required: Trigger text
    replace: string             # Required: Replacement text
    description: string         # Optional: Description of snippet
    keywords: string[]          # Optional: Keywords for search
```

### Field Descriptions

#### Required Fields
- **name**: Package name (keep it short and descriptive, 3-50 characters)
- **version**: Semantic version following [SemVer](https://semver.org/) (e.g., "1.0.0", "2.1.3")
- **author**: Author name or username (3-50 characters)
- **description**: Brief description of package purpose (10-200 characters)
- **snippets**: Array of snippet objects (at least 1 snippet required)

#### Optional Fields
- **category**: One of the predefined categories (see categories below)
- **tags**: Array of tags for discovery (2-10 tags recommended)
- **license**: License type (MIT, GPL, Apache, etc.)
- **homepage**: URL to package homepage or repository
- **readme**: Extended description with examples and usage tips

#### Snippet Fields
- **trigger**: The text that will expand (1-50 characters, case-sensitive)
- **replace**: What the trigger expands to (1-10000 characters)
- **description**: Optional description of what the snippet does
- **keywords**: Optional array of keywords for search functionality

---

## 🏷️ Package Categories

### Valid Categories
```typescript
type PackageCategory = 
  | "markdown"      // Markdown formatting and structure
  | "programming"   // Code snippets and development
  | "academic"      // Academic writing and research
  | "business"      // Business and professional use
  | "creative"      // Creative writing and content
  | "productivity"  // General productivity tools
  | "language"      // Language learning and translation
  | "other";        // Everything else
```

### Category Descriptions
- **markdown**: Headers, lists, tables, links, formatting
- **programming**: Functions, classes, imports, code templates
- **academic**: Citations, references, formulas, research tools
- **business**: Email templates, reports, presentations, meetings
- **creative**: Story templates, character sheets, writing prompts
- **productivity**: Todo lists, reminders, shortcuts, workflows
- **language**: Phrases, vocabulary, grammar, translation
- **other**: Custom workflows, personal use, miscellaneous

---

## 🎯 Snippet Format

### Basic Snippet
```yaml
- trigger: ":email"
  replace: "your@email.com"
  description: "Insert email address"
```

### Advanced Snippet with Cursor Placement
```yaml
- trigger: ":meeting"
  replace: "## Meeting Notes\n\n**Date:** CURSOR_PLACEHOLDER\n**Attendees:** \n**Agenda:** \n\n### Discussion\n\n### Action Items\n- [ ] "
  description: "Meeting notes template with cursor in date field"
```

### Multi-line Snippet
```yaml
- trigger: ":codeblock"
  replace: "```\nCURSOR_PLACEHOLDER\n```"
  description: "Code block with cursor inside"
```

### Snippet with Keywords
```yaml
- trigger: ":todo"
  replace: "- [ ] CURSOR_PLACEHOLDER"
  description: "Todo item"
  keywords: ["task", "checklist", "item", "todo"]
```

---

## 🔤 Special Characters and Escaping

### YAML Escaping
When writing YAML, you may need to escape special characters:

```yaml
# Quotes
- trigger: ":quote"
  replace: "> \"CURSOR_PLACEHOLDER\"\n> — Author"

# Backslashes
- trigger: ":path"
  replace: "C:\\Users\\CURSOR_PLACEHOLDER\\Documents"

# Line breaks
- trigger: ":multiline"
  replace: "Line 1\nLine 2\nLine 3"

# Special YAML characters
- trigger: ":yaml"
  replace: "key: value\nlist:\n  - item1\n  - item2"
```

### Cursor Placement
Use `CURSOR_PLACEHOLDER` to position the cursor after expansion:

```yaml
# Single cursor placement
- trigger: ":email"
  replace: "Dear CURSOR_PLACEHOLDER,\n\nBest regards,\nYour Name"

# Multiple cursor placements (only first one is used)
- trigger: ":template"
  replace: "Name: CURSOR_PLACEHOLDER\nEmail: CURSOR_PLACEHOLDER\nPhone: CURSOR_PLACEHOLDER"
```

---

## 📦 Package Examples

### Example 1: Basic Package
```yaml
name: "Email Templates"
version: "1.0.0"
author: "jane-doe"
description: "Professional email templates for business communication"
category: "business"
tags: ["email", "business", "communication", "templates"]
license: "MIT"

snippets:
  - trigger: ":email-follow"
    replace: "Hi CURSOR_PLACEHOLDER,\n\nI wanted to follow up on our conversation from [date].\n\nBest regards,\nYour Name"
    description: "Follow-up email template"
    keywords: ["follow", "up", "email", "business"]
  
  - trigger: ":email-meeting"
    replace: "Hi CURSOR_PLACEHOLDER,\n\nI'd like to schedule a meeting to discuss [topic].\n\nWhen would be a good time for you?\n\nBest regards,\nYour Name"
    description: "Meeting request email"
    keywords: ["meeting", "schedule", "request", "email"]
```

### Example 2: Programming Package
```yaml
name: "Python Functions"
version: "1.0.0"
author: "python-dev"
description: "Common Python function templates and patterns"
category: "programming"
tags: ["python", "functions", "coding", "development"]
license: "MIT"
homepage: "https://github.com/python-dev/python-snippets"

snippets:
  - trigger: ":def"
    replace: "def CURSOR_PLACEHOLDER():\n    \"\"\"\n    \n    Returns:\n        \n    \"\"\"\n    pass"
    description: "Python function template with docstring"
    keywords: ["function", "def", "python", "docstring"]
  
  - trigger: ":class"
    replace: "class CURSOR_PLACEHOLDER:\n    \"\"\"\n    \n    \"\"\"\n    \n    def __init__(self):\n        pass"
    description: "Python class template"
    keywords: ["class", "python", "init", "constructor"]
```

### Example 3: Academic Package
```yaml
name: "Academic Writing"
version: "1.0.0"
author: "academic-writer"
description: "Snippets for academic writing, citations, and research"
category: "academic"
tags: ["academic", "writing", "research", "citations", "latex"]
license: "MIT"

snippets:
  - trigger: ":cite"
    replace: "[@author2023]"
    description: "Insert citation placeholder"
    keywords: ["citation", "reference", "academic", "research"]
  
  - trigger: ":ref"
    replace: "See Figure \\ref{fig:example}"
    description: "Reference to figure"
    keywords: ["reference", "figure", "latex", "academic"]
  
  - trigger: ":eq"
    replace: "\\begin{equation}\n\\label{eq:example}\nCURSOR_PLACEHOLDER\n\\end{equation}"
    description: "LaTeX equation environment"
    keywords: ["equation", "latex", "math", "academic"]
```

---

## 🔍 Validation Rules

### Package Validation
- **name**: 3-50 characters, alphanumeric and spaces only
- **version**: Valid semantic version (e.g., "1.0.0")
- **author**: 3-50 characters, alphanumeric and spaces only
- **description**: 10-200 characters
- **category**: Must be one of the valid categories
- **tags**: 2-10 tags, each 2-20 characters
- **snippets**: At least 1 snippet required

### Snippet Validation
- **trigger**: 1-50 characters, no special characters except `:`, `-`, `_`
- **replace**: 1-10000 characters
- **description**: Optional, 5-200 characters if provided
- **keywords**: Optional, 2-10 keywords, each 2-20 characters

### YAML Validation
- **Valid YAML syntax** - Must parse correctly
- **Proper indentation** - Use 2 spaces for indentation
- **No duplicate keys** - Each key must be unique
- **Proper escaping** - Special characters must be escaped

---

## 🛠️ Development Tools

### YAML Validators
- **Online**: [yamlchecker.com](https://yamlchecker.com)
- **VS Code**: YAML Language Support extension
- **Command Line**: `yamllint` for validation
- **Node.js**: `js-yaml` library for programmatic validation

### Package Testing
```bash
# Validate YAML syntax
yamllint your-package.yml

# Test package in Snipsy
# 1. Copy YAML to clipboard
# 2. Go to Snipsy Settings → Packages
# 3. Paste YAML and click Install
# 4. Test all snippets
```

### Package Submission

#### Method 1: Google Form (Recommended)
1. **Go to Snipsy Settings → Community Packages**
2. **Scroll to "Submit New Package"** section
3. **Paste your YAML** in the text area
4. **Click "Validate Package"** to check for errors
5. **Click "Submit Package"** to open Google Form
6. **Fill in contact information** and submit

#### Method 2: GitHub (Alternative)
```bash
# Fork the repository
git clone https://github.com/Dimagious/snipsidian-community.git

# Create package file
cp templates/basic.yml community-packages/your-package.yml

# Edit package content
# Test thoroughly
# Submit pull request
```

---

## 📊 Package Statistics

### Recommended Package Sizes
- **Small packages**: 5-15 snippets
- **Medium packages**: 15-50 snippets
- **Large packages**: 50-200 snippets
- **Maximum recommended**: 200 snippets per package

### Performance Considerations
- **Package size**: Larger packages take longer to load
- **Snippet count**: More snippets = slower search
- **Trigger length**: Shorter triggers = faster matching
- **Replacement size**: Larger replacements = more memory usage

### Best Practices
- **Logical grouping**: Group related snippets together
- **Consistent naming**: Use similar trigger patterns
- **Clear descriptions**: Help users understand each snippet
- **Regular updates**: Keep packages current and maintained

---

## 🔗 Integration Guidelines

### Obsidian Integration
- **Vault compatibility**: Packages work with any Obsidian vault
- **Sync support**: Packages sync with vault sync methods
- **Backup included**: Packages are included in vault backups
- **Version control**: Packages work with Git and other VCS

### Community Integration
- **Google Form**: Submit packages via Google Forms (recommended)
- **GitHub**: Submit packages via pull requests (alternative)
- **Documentation**: Include usage examples and tips

### Third-party Integration
- **Espanso compatibility**: Import Espanso YAML packages
- **VS Code**: Export VS Code snippets to Snipsy format
- **TextExpander**: Convert TextExpander snippets
- **Custom tools**: Use API for programmatic package creation

---

## 🆘 Support and Resources

### Documentation
- **[Getting Started Guide](Getting-Started)** - Complete setup guide
- **[Package Creation Guide](Package-Creation)** - Step-by-step package creation
- **[Community Guidelines](Community-Guidelines)** - How to contribute
- **[FAQ](FAQ)** - Common questions and answers

### Community
- **GitHub Issues** - [Report bugs or request features](https://github.com/Dimagious/snipsidian/issues)
- **Package Gallery** - Browse community packages

### Tools and Resources
- **Package Templates** - [Download templates](templates/)
- **YAML Validators** - [Online validation tools](https://yamlchecker.com)
- **Package Examples** - [Browse example packages](examples/)
- **Development Tools** - [VS Code extensions and tools](tools/)

---

## 🎯 Advanced Topics

### Custom Package Formats
While Snipsy uses YAML, you can create packages in other formats:

```json
{
  "name": "JSON Package",
  "version": "1.0.0",
  "author": "json-user",
  "description": "Package in JSON format",
  "snippets": [
    {
      "trigger": ":json",
      "replace": "{\n  \"key\": \"CURSOR_PLACEHOLDER\"\n}",
      "description": "JSON object template"
    }
  ]
}
```

### Programmatic Package Creation
```javascript
// Create package programmatically
const package = {
  name: "Generated Package",
  version: "1.0.0",
  author: "script-user",
  description: "Package created by script",
  snippets: [
    {
      trigger: ":generated",
      replace: "This was generated by a script",
      description: "Generated snippet"
    }
  ]
};

// Convert to YAML
const yaml = require('js-yaml');
const yamlString = yaml.dump(package);
```

### Package Automation
```bash
# Automated package testing
#!/bin/bash
for file in packages/*.yml; do
  echo "Testing $file"
  yamllint "$file" || exit 1
  # Add more validation here
done
echo "All packages validated successfully"
```

---

**Happy developing!** 🚀

*Last updated: January 2025*
