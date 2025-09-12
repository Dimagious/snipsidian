# CSS Modules Structure

This project uses a modular CSS architecture for better organization and maintainability of styles.

## 📁 Structure

```
src/styles/
├── main.css              # Main file with imports of all modules
├── variables.css         # CSS variables and constants
├── base.css             # Base styles and reset
├── layout.css           # Layout and structure styles
├── components/          # Reusable components
│   ├── buttons.css      # Button styles
│   ├── forms.css        # Form and input styles
│   └── modals.css       # Modal window styles
└── sections/            # Styles for specific sections
    └── community.css    # Community Tab styles
```

## 🎯 Organization Principles

### 1. **Variables** (`variables.css`)
- CSS variables for colors, sizes, spacing
- Centralized design system management
- Easy theme and style modifications

### 2. **Base** (`base.css`)
- Base styles for all elements
- Style reset and common rules
- Utility classes

### 3. **Layout** (`layout.css`)
- Layout and structure styles
- Grid and Flexbox systems
- Responsive breakpoints

### 4. **Components** (`components/`)
- Reusable UI components
- Buttons, forms, modal windows
- Independent modules

### 5. **Sections** (`sections/`)
- Styles for specific pages/sections
- Community Tab, Settings, etc.
- Specific logic

## 🔨 Build Process

CSS modules are automatically compiled into a single `styles.css` file when running:

```bash
npm run build:css    # CSS only
npm run build        # Full build (CSS + JS)
```

## 🎨 CSS Variables

All colors, sizes, and spacing are defined as variables:

```css
:root {
  --color-green: #4CAF50;
  --spacing-md: 12px;
  --border-radius: 6px;
  --transition-normal: 0.2s ease;
}
```
