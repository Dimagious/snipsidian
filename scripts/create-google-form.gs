/**
 * Google Apps Script для автоматического создания Google Form
 * для подачи пакетов Snipsidian
 */

function createSnipsidianPackageForm() {
  // Создаем новую форму
  const form = FormApp.create('Snipsidian Community Package Submission');
  
  // Устанавливаем описание
  form.setDescription('Submit your snippet packages to the Snipsidian community. This form will help us review and approve your package for inclusion in the community repository.');
  
  // Настраиваем форму
  form.setConfirmationMessage('Thank you for submitting your package! We\'ll review it and get back to you within 1-2 weeks.');
  form.setShowLinkToRespondAgain(true);
  form.setProgressBar(true);
  form.setCollectEmail(true);
  form.setLimitOneResponsePerUser(true);
  
  // Секция 1: Package Information
  form.addSectionHeaderItem()
    .setTitle('Package Information')
    .setHelpText('Basic information about your package');
  
  // Package Name (Required)
  const nameItem = form.addTextItem();
  nameItem.setTitle('Package Name *')
    .setHelpText('Enter a short, descriptive name for your package (3-50 characters)')
    .setRequired(true);
  
  // Package Version (Required)
  const versionItem = form.addTextItem();
  versionItem.setTitle('Package Version *')
    .setHelpText('Enter the semantic version (e.g., 1.0.0, 2.1.3)')
    .setRequired(true);
  
  // Package Author (Required)
  const authorItem = form.addTextItem();
  authorItem.setTitle('Package Author *')
    .setHelpText('Enter your name or username (3-50 characters)')
    .setRequired(true);
  
  // Package Description (Required)
  const descItem = form.addParagraphTextItem();
  descItem.setTitle('Package Description *')
    .setHelpText('Briefly describe what your package does (10-200 characters)')
    .setRequired(true);
  
  // Секция 2: Package Details
  form.addSectionHeaderItem()
    .setTitle('Package Details')
    .setHelpText('Additional information about your package');
  
  // Package Category (Optional)
  const categoryItem = form.addListItem();
  categoryItem.setTitle('Package Category')
    .setHelpText('Choose the most appropriate category for your package')
    .setRequired(false);
  categoryItem.setChoices([
    categoryItem.createChoice('markdown'),
    categoryItem.createChoice('programming'),
    categoryItem.createChoice('academic'),
    categoryItem.createChoice('productivity'),
    categoryItem.createChoice('language'),
    categoryItem.createChoice('medical'),
    categoryItem.createChoice('legal'),
    categoryItem.createChoice('other')
  ]);
  
  // Package Tags (Optional)
  const tagsItem = form.addTextItem();
  tagsItem.setTitle('Package Tags')
    .setHelpText('Enter tags separated by commas (e.g., git, commands, shortcuts)')
    .setRequired(false);
  
  // Package License (Optional)
  const licenseItem = form.addTextItem();
  licenseItem.setTitle('Package License')
    .setHelpText('Enter the license type (e.g., MIT, GPL, Apache)')
    .setRequired(false);
  
  // Package Homepage (Optional)
  const homepageItem = form.addTextItem();
  homepageItem.setTitle('Package Homepage URL')
    .setHelpText('Link to your package homepage or repository')
    .setRequired(false);
  
  // Package Readme (Optional)
  const readmeItem = form.addParagraphTextItem();
  readmeItem.setTitle('Package Readme')
    .setHelpText('Extended description with examples and usage tips')
    .setRequired(false);
  
  // Секция 3: Package Content
  form.addSectionHeaderItem()
    .setTitle('Package Content')
    .setHelpText('The actual package content');
  
  // Package YAML (Required)
  const yamlItem = form.addParagraphTextItem();
  yamlItem.setTitle('Package YAML Content *')
    .setHelpText('Paste your complete package YAML here. This should include all package metadata and snippets.')
    .setRequired(true);
  
  // Секция 4: Contact Information
  form.addSectionHeaderItem()
    .setTitle('Contact Information')
    .setHelpText('Your contact details (optional)');
  
  // Your Name (Optional)
  const submitterNameItem = form.addTextItem();
  submitterNameItem.setTitle('Your Name')
    .setHelpText('Your contact name (optional)')
    .setRequired(false);
  
  // Your Email (Optional)
  const submitterEmailItem = form.addTextItem();
  submitterEmailItem.setTitle('Your Email')
    .setHelpText('Your contact email (optional)')
    .setRequired(false);
  
  // Секция 5: System Information (Auto-filled)
  form.addSectionHeaderItem()
    .setTitle('System Information (Auto-filled)')
    .setHelpText('This information is automatically filled by the plugin');
  
  // Plugin Version
  const pluginVersionItem = form.addTextItem();
  pluginVersionItem.setTitle('Plugin Version')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Obsidian Version
  const obsidianVersionItem = form.addTextItem();
  obsidianVersionItem.setTitle('Obsidian Version')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Platform
  const platformItem = form.addTextItem();
  platformItem.setTitle('Platform')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Operating System
  const osItem = form.addTextItem();
  osItem.setTitle('Operating System')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Locale
  const localeItem = form.addTextItem();
  localeItem.setTitle('Locale')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Theme
  const themeItem = form.addTextItem();
  themeItem.setTitle('Theme')
    .setHelpText('Automatically filled by the plugin')
    .setRequired(false);
  
  // Получаем URL формы
  const formUrl = form.getPublishedUrl();
  console.log('Form created successfully!');
  console.log('Form URL:', formUrl);
  console.log('Form ID:', form.getId());
  
  // Создаем Google Sheet для ответов
  const sheet = SpreadsheetApp.create('Snipsidian Package Submissions');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());
  
  console.log('Spreadsheet created:', sheet.getUrl());
  
  return {
    formUrl: formUrl,
    formId: form.getId(),
    sheetUrl: sheet.getUrl()
  };
}

/**
 * Функция для получения Entry ID всех полей формы
 */
function getFormEntryIds() {
  const formId = 'YOUR_FORM_ID_HERE'; // Замените на ID вашей формы
  const form = FormApp.openById(formId);
  const items = form.getItems();
  
  const entryIds = {};
  
  items.forEach(item => {
    const title = item.getTitle();
    const id = item.getId();
    console.log(`${title}: ${id}`);
    entryIds[title] = id;
  });
  
  return entryIds;
}

/**
 * Функция для обновления Entry ID в коде
 */
function updateEntryIdsInCode() {
  const entryIds = getFormEntryIds();
  
  // Создаем объект для копирования в код
  const codeObject = `export const packageFormEntryIdMap = {
  PACKAGE_NAME:     "${entryIds['Package Name *']}",
  PACKAGE_VERSION:  "${entryIds['Package Version *']}",
  PACKAGE_AUTHOR:   "${entryIds['Package Author *']}",
  PACKAGE_DESC:     "${entryIds['Package Description *']}",
  PACKAGE_CATEGORY: "${entryIds['Package Category']}",
  PACKAGE_TAGS:     "${entryIds['Package Tags']}",
  PACKAGE_LICENSE:  "${entryIds['Package License']}",
  PACKAGE_HOMEPAGE: "${entryIds['Package Homepage URL']}",
  PACKAGE_README:   "${entryIds['Package Readme']}",
  PACKAGE_YAML:     "${entryIds['Package YAML Content *']}",
  SUBMITTER_EMAIL:  "${entryIds['Your Email']}",
  SUBMITTER_NAME:   "${entryIds['Your Name']}",
  META_PLUGIN:      "${entryIds['Plugin Version']}",
  META_OBSIDIAN:    "${entryIds['Obsidian Version']}",
  META_PLATFORM:    "${entryIds['Platform']}",
  META_OS:          "${entryIds['Operating System']}",
  META_LOCALE:      "${entryIds['Locale']}",
  META_THEME:       "${entryIds['Theme']}",
} as const;`;
  
  console.log('Copy this to your code:');
  console.log(codeObject);
  
  return codeObject;
}
