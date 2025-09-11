# 📦 Community Packages

This directory contains community-created snippet packages for Snipsy.

## 📁 Directory Structure

```
community-packages/
├── approved/          # Approved and ready-to-use packages
├── pending/           # Packages awaiting moderation
├── rejected/          # Rejected packages (for reference)
├── templates/         # Package templates for creators
└── README.md         # This file
```

## 🎯 Package Status

### ✅ Approved
Packages in the `approved/` directory are:
- **Quality tested** - All snippets work correctly
- **Content reviewed** - Appropriate and useful content
- **Format validated** - Proper YAML structure
- **Ready for use** - Available in Snipsy's package catalog

### ⏳ Pending
Packages in the `pending/` directory are:
- **Awaiting review** - Submitted but not yet approved
- **Under evaluation** - Being tested and validated
- **Not available** - Not yet in the public catalog

### ❌ Rejected
Packages in the `rejected/` directory are:
- **Quality issues** - Snippets don't work correctly
- **Content problems** - Inappropriate or harmful content
- **Format errors** - Invalid YAML or structure
- **Not suitable** - Don't meet community standards

## 📋 Submission Process

### 1. Create Your Package
- Use templates from `templates/` directory
- Follow the [Package Creation Guide](../../docs/wiki/Package-Creation.md)
- Test all snippets thoroughly

### 2. Submit for Review
- Create a pull request with your package
- Place package in `pending/` directory
- Include description and testing notes

### 3. Community Review
- Packages are reviewed for quality and appropriateness
- Community feedback is welcome
- Approved packages move to `approved/` directory

## 🎨 Package Templates

### Basic Template
- **File**: `templates/basic.yml`
- **Use for**: General purpose packages
- **Includes**: Basic structure and examples

### Programming Template
- **File**: `templates/programming.yml`
- **Use for**: Code snippets and development tools
- **Includes**: Function, class, and import templates

### Academic Template
- **File**: `templates/academic.yml`
- **Use for**: Academic writing and research
- **Includes**: Citations, equations, and references

## 🔧 Package Format

All packages must follow the format specified in the [API Reference](../../docs/wiki/API-Reference.md):

```yaml
name: "Package Name"
version: "1.0.0"
author: "author-name"
description: "Package description"
category: "category"
tags: ["tag1", "tag2"]
license: "MIT"
homepage: "https://github.com/username/package"

snippets:
  - trigger: ":example"
    replace: "Replacement text"
    description: "Snippet description"
    keywords: ["keyword1", "keyword2"]
```

## 📊 Quality Standards

### Content Requirements
- **Original work** - Don't copy without permission
- **Appropriate content** - No offensive or harmful material
- **Clear purpose** - Solve a real problem
- **Well-tested** - All snippets work correctly

### Technical Standards
- **Valid YAML** - Follow format specification
- **Proper formatting** - Clean, readable structure
- **Clear naming** - Descriptive triggers and names
- **Good documentation** - Include descriptions and examples

### Community Standards
- **Respectful content** - Appropriate for all users
- **Clear licensing** - Specify usage rights
- **Regular maintenance** - Keep packages updated
- **Responsive to feedback** - Address issues and suggestions

## 🚀 Getting Started

1. **Choose a template** from `templates/` directory
2. **Customize the content** for your use case
3. **Test thoroughly** to ensure all snippets work
4. **Submit for review** via pull request
5. **Wait for approval** and community feedback

## 📞 Support

- **Documentation**: [Package Creation Guide](../../docs/wiki/Package-Creation.md)
- **API Reference**: [Technical Documentation](../../docs/wiki/API-Reference.md)
- **Community Guidelines**: [Contribution Rules](../../docs/wiki/Community-Guidelines.md)
- **Issues**: [GitHub Issues](https://github.com/Dimagious/snipsidian/issues)

---

**Happy creating!** 🎉

*Last updated: September 2025*
