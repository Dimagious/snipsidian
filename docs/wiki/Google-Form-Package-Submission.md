# 📝 Google Form Package Submission

Learn how to submit snippet packages through Google Forms as an alternative to GitHub Issues.

---

## 🎯 Overview

Google Form submission provides an easy, user-friendly way to submit packages without requiring GitHub knowledge. This method is perfect for users who prefer a simple form interface over technical GitHub workflows.

---

## 🚀 How to Submit via Google Form

### Method 1: From the Plugin Interface

1. **Open the Community Tab** in Snipsidian settings
2. **Scroll to the "Submit Package" section**
3. **Click "Submit via Google Form"** button
4. **Complete the form** with your package details
5. **Submit** - your package will be reviewed by the community

### Method 2: Direct Form Access

You can also access the Google Form directly at:
[Package Submission Form](https://docs.google.com/forms/d/e/1FAIpQLSdXXXXXXXXXXXXXXX/viewform)

---

## 📋 Form Fields

The Google Form includes the following fields:

### Required Fields
- **Package Name**: Short, descriptive name for your package
- **Package Version**: Semantic version (e.g., "1.0.0")
- **Package Author**: Your name or username
- **Package Description**: Brief description of what the package does
- **Package YAML**: Complete YAML content of your package

### Optional Fields
- **Package Category**: Choose from predefined categories
- **Package Tags**: Comma-separated tags for discoverability
- **Package License**: License type (MIT, GPL, etc.)
- **Package Homepage**: Link to package homepage or repository
- **Package Readme**: Extended description with examples
- **Your Name**: Your contact name (optional)
- **Your Email**: Your contact email (optional)

### Auto-filled Fields
The following system information is automatically filled:
- Plugin version
- Obsidian version
- Platform (Windows/Mac/Linux)
- Operating system details
- Locale settings
- Theme preference

---

## 📦 Package Format

Your package YAML should follow this structure:

```yaml
# Package metadata
name: "Your Package Name"
version: "1.0.0"
author: "your-username"
description: "Brief description of what this package does"
category: "productivity"  # Optional
tags: ["tag1", "tag2", "tag3"]  # Optional
license: "MIT"  # Optional
homepage: "https://github.com/username/package-name"  # Optional

# Snippets
snippets:
  - trigger: ":example"
    replace: "This is an example replacement"
    description: "Optional description of what this snippet does"
  - trigger: ":another"
    replace: "Another example"
    description: "Another snippet description"
```

### Required Fields
- **name**: Package name (3-50 characters)
- **version**: Semantic version (e.g., "1.0.0")
- **author**: Author name or username (3-50 characters)
- **description**: Brief description (10-200 characters)
- **snippets**: Array of snippet objects (at least 1 required)

### Snippet Structure
Each snippet must have:
- **trigger**: The text that will expand (1-50 characters)
- **replace**: What the trigger expands to (1-10000 characters)
- **description**: Optional description of the snippet

---

## 🔄 Submission Process

### 1. Validation
Before submission, your package is automatically validated for:
- Required fields presence
- YAML format correctness
- Snippet structure validity
- Naming conventions

### 2. Review Process
After submission:
1. **Automatic Review**: System checks for basic issues
2. **Community Review**: Community members review the package
3. **Approval**: Approved packages are added to the community repository
4. **Notification**: You'll be notified of the review outcome

### 3. Timeline
- **Initial Review**: Within 24-48 hours
- **Community Review**: 3-7 days
- **Final Decision**: 1-2 weeks

---

## ✅ Best Practices

### Package Creation
- **Keep names descriptive** but concise
- **Use semantic versioning** (e.g., 1.0.0, 1.1.0, 2.0.0)
- **Write clear descriptions** that explain the package purpose
- **Choose appropriate categories** for better organization
- **Add relevant tags** for discoverability

### Snippet Design
- **Use consistent triggers** (e.g., all start with ":")
- **Make triggers memorable** and easy to type
- **Write helpful descriptions** for each snippet
- **Test all snippets** before submission
- **Avoid conflicts** with existing packages

### Content Guidelines
- **Keep content appropriate** and professional
- **Ensure snippets are useful** to the community
- **Avoid duplicate functionality** with existing packages
- **Follow naming conventions** for consistency

---
## 🛠️ Troubleshooting

### Common Issues

**"Invalid YAML format"**
- Check your YAML syntax
- Ensure proper indentation (use spaces, not tabs)
- Validate your YAML with an online validator

**"Missing required fields"**
- Ensure all required fields are present
- Check field names match exactly
- Verify field values are not empty

**"Snippet validation failed"**
- Check that all snippets have trigger and replace fields
- Ensure triggers are unique within your package
- Verify replace text is not empty

**"Form submission failed"**
- Check your internet connection
- Try refreshing the page
- Contact support if the issue persists

### Getting Help

If you encounter issues:
1. **Check this documentation** for common solutions
2. **Use the feedback form** to report bugs
3. **Join the community** for support
4. **Contact maintainers** for urgent issues

---

## 📞 Support

For questions or issues with Google Form submission:

- **Documentation**: Check this guide and other wiki pages
- **Community**: Join discussions in the community repository
- **Feedback**: Use the feedback form in the plugin
- **Issues**: Report bugs through GitHub Issues

---

## 🔗 Related Links

- [Package Creation Guide](./Package-Creation.md)
- [Community Guidelines](./Community-Guidelines.md)
- [API Reference](./API-Reference.md)
- [FAQ](./FAQ.md)
- [GitHub Repository](https://github.com/Dimagious/snipsidian)

---

*Last updated: [Current Date]*
*Version: 1.0.0*
