# 📦 Creating Snippet Packages

Learn how to create, organize, and share snippet packages with the Snipsy community.

---

## 🎯 What is a Snippet Package?

A **snippet package** is a collection of related snippets that can be easily installed and shared. Packages are perfect for:
- **Thematic collections** (e.g., "Academic Writing", "Programming")
- **Workflow-specific snippets** (e.g., "Meeting Notes", "Code Reviews")
- **Language-specific content** (e.g., "Spanish Phrases", "Medical Terms")
- **Tool integrations** (e.g., "Git Commands", "Docker Shortcuts")

---

## 📋 Package Format Specification

### Basic Structure
```yaml
# Package metadata
name: "Your Package Name"
version: "1.0.0"
author: "your-username"
description: "Brief description of what this package does"
category: "productivity"  # See categories below
tags: ["tag1", "tag2", "tag3"]
license: "MIT"
homepage: "https://github.com/username/package-name"

# Snippets
snippets:
  - trigger: ":example"
    replace: "This is an example replacement"
    description: "Optional description of what this snippet does"
```

### Required Fields
- **name**: Package name (keep it short and descriptive)
- **version**: Semantic version (e.g., "1.0.0")
- **author**: Your username or real name
- **description**: Brief description (1-2 sentences)
- **snippets**: Array of snippet objects

### Optional Fields
- **category**: Package category (see categories below)
- **tags**: Array of tags for discovery
- **license**: License type (MIT, GPL, etc.)
- **homepage**: Link to package homepage
- **readme**: Extended description

---

## 🏷️ Package Categories

Choose the most appropriate category for your package:

| Category | Description | Examples |
|----------|-------------|----------|
| **markdown** | Markdown formatting and structure | Headers, lists, tables, links |
| **programming** | Code snippets and development | Functions, classes, imports |
| **academic** | Academic writing and research | Citations, references, formulas |
| **business** | Business and professional use | Email templates, reports, presentations |
| **creative** | Creative writing and content | Story templates, character sheets |
| **productivity** | General productivity tools | Todo lists, reminders, shortcuts |
| **language** | Language learning and translation | Phrases, vocabulary, grammar |
| **other** | Everything else | Custom workflows, personal use |

---

## ✍️ Creating Your First Package

### Step 1: Plan Your Package
1. **Choose a theme** - What problem does your package solve?
2. **Define your audience** - Who will use these snippets?
3. **List your snippets** - What triggers and replacements do you need?

### Step 2: Write the YAML
```yaml
name: "Academic Writing"
version: "1.0.0"
author: "jane-doe"
description: "Snippets for academic writing, citations, and research"
category: "academic"
tags: ["writing", "research", "citations", "academic"]
license: "MIT"

snippets:
  - trigger: ":cite"
    replace: "[@author2023]"
    description: "Insert citation placeholder"
  
  - trigger: ":ref"
    replace: "See Figure \\ref{fig:example}"
    description: "Reference to figure"
  
  - trigger: ":eq"
    replace: "\\begin{equation}\\n\\label{eq:example}\\n\\end{equation}"
    description: "LaTeX equation environment"
  
  - trigger: ":abstract"
    replace: "\\begin{abstract}\\nCURSOR_PLACEHOLDER\\n\\end{abstract}"
    description: "Abstract section"
```

### Step 3: Test Your Package
1. **Copy the YAML** to your clipboard
2. **Go to Snipsy Settings → Community Packages**
3. **Scroll to "Submit New Package"** section
4. **Paste YAML** in the text area
5. **Click "Validate Package"** to check for errors
6. **Test your snippets** by installing them locally
7. **Refine** based on your testing

---

## 🎨 Best Practices

### 1. Naming Conventions
- **Triggers**: Use descriptive, memorable names
  - ✅ Good: `:email`, `:phone`, `:meeting-notes`
  - ❌ Avoid: `:e`, `:p`, `:mn` (too cryptic)

### 2. Replacement Content
- **Be specific**: Include all necessary formatting
- **Use placeholders**: `CURSOR_PLACEHOLDER` for cursor positioning
- **Test thoroughly**: Make sure expansions work as expected

### 3. Package Organization
- **Logical grouping**: Group related snippets together
- **Consistent naming**: Use similar trigger patterns
- **Clear descriptions**: Help users understand each snippet

### 4. Documentation
- **README**: Include usage examples and tips
- **Descriptions**: Add descriptions to complex snippets
- **Examples**: Show how snippets work in practice

---

## 📝 Advanced Snippet Features

### Cursor Placement
Use `CURSOR_PLACEHOLDER` to position the cursor after expansion:

```yaml
- trigger: ":email"
  replace: "Dear CURSOR_PLACEHOLDER,\\n\\nBest regards,\\nYour Name"
  description: "Email template with cursor in greeting"
```

### Multi-line Content
Use `\\n` for line breaks:

```yaml
- trigger: ":meeting"
  replace: "## Meeting Notes\\n\\n**Date:** CURSOR_PLACEHOLDER\\n**Attendees:** \\n**Agenda:** \\n\\n### Discussion\\n\\n### Action Items\\n- [ ] "
  description: "Meeting notes template"
```

### Special Characters
Escape special characters in YAML:

```yaml
- trigger: ":quote"
  replace: "> \"CURSOR_PLACEHOLDER\"\\n> — Author"
  description: "Blockquote with attribution"
```

---

## 🚀 Submitting to Community

### 1. Prepare Your Package
- **Test thoroughly** - Make sure all snippets work
- **Write documentation** - Include README and examples
- **Choose appropriate category** and tags
- **Follow naming conventions**

### 2. Submit via Google Form (Recommended)
1. **Go to Snipsy Settings → Community Packages**
2. **Scroll to "Submit New Package"** section
3. **Paste your YAML** in the text area
4. **Click "Validate Package"** to check for errors
5. **Click "Submit Package"** to open Google Form
6. **Fill in your contact information** (name, email)
7. **Submit the form** - your package will be reviewed

### 3. Community Review
- **Moderation**: Packages are reviewed for quality and appropriateness
- **Feedback**: Community members can suggest improvements
- **Approval**: Approved packages are added to the community catalog

---

## 📊 Package Examples

### Example 1: Programming Package
```yaml
name: "Python Functions"
version: "1.0.0"
author: "python-dev"
description: "Common Python function templates"
category: "programming"
tags: ["python", "functions", "coding"]

snippets:
  - trigger: ":def"
    replace: "def CURSOR_PLACEHOLDER():\\n    \"\"\"\\n    \\n    Returns:\\n        \\n    \"\"\"\\n    pass"
    description: "Python function template"
  
  - trigger: ":class"
    replace: "class CURSOR_PLACEHOLDER:\\n    \"\"\"\\n    \\n    \"\"\"\\n    \\n    def __init__(self):\\n        pass"
    description: "Python class template"
```

### Example 2: Business Package
```yaml
name: "Email Templates"
version: "1.0.0"
author: "business-user"
description: "Professional email templates"
category: "business"
tags: ["email", "business", "communication"]

snippets:
  - trigger: ":email-follow"
    replace: "Hi CURSOR_PLACEHOLDER,\\n\\nI wanted to follow up on our conversation from [date].\\n\\nBest regards,\\nYour Name"
    description: "Follow-up email template"
  
  - trigger: ":email-meeting"
    replace: "Hi CURSOR_PLACEHOLDER,\\n\\nI'd like to schedule a meeting to discuss [topic].\\n\\nWhen would be a good time for you?\\n\\nBest regards,\\nYour Name"
    description: "Meeting request email"
```

---

## 🛠️ Tools and Resources

### YAML Validators
- **Online YAML Validator**: [yamlchecker.com](https://yamlchecker.com)
- **VS Code Extension**: YAML Language Support
- **Command Line**: `yamllint` for validation

### Package Templates
- **Basic Package**: [template-basic.yml](templates/basic.yml)
- **Programming Package**: [template-programming.yml](templates/programming.yml)
- **Academic Package**: [template-academic.yml](templates/academic.yml)

### Community Resources
- **Package Gallery**: Browse existing packages for inspiration
- **Discord Community**: Get help and feedback
- **GitHub Discussions**: Share ideas and ask questions

---

## 🎯 Quality Guidelines

### Package Quality Checklist
- [ ] **Clear naming** - Triggers are descriptive and memorable
- [ ] **Working snippets** - All snippets expand correctly
- [ ] **Proper formatting** - YAML is valid and well-formatted
- [ ] **Good documentation** - Clear descriptions and examples
- [ ] **Appropriate category** - Package fits the chosen category
- [ ] **Useful tags** - Tags help with discovery
- [ ] **Tested thoroughly** - Package works in different contexts

### Content Guidelines
- **Appropriate content** - No offensive or harmful material
- **Original work** - Don't copy packages without permission
- **Clear licensing** - Specify license for your package
- **Regular updates** - Keep packages current and maintained

---

## 🆘 Need Help?

- **📖 Check the [FAQ](FAQ)** for common questions
- **🐛 Visit [Troubleshooting](Troubleshooting)** for technical issues
- **💬 Join our [Discord community](https://discord.gg/snipsy)** for real-time help
- **📧 Contact us** via [GitHub Issues](https://github.com/Dimagious/snipsidian/issues)

---

## 🎉 Ready to Create?

Now you have everything you need to create amazing snippet packages! 

**Next steps:**
1. **Plan your package** - What problem will it solve?
2. **Write your YAML** - Follow the format specification
3. **Test thoroughly** - Make sure everything works
4. **Submit to community** - Use Google Form for easy submission
5. **Share with others** - Help the community grow!

**Happy creating!** 🚀
