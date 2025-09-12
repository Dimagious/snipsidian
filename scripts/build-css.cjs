#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Простой CSS bundler для сборки модулей в один файл
 */
function buildCSS() {
  const cssDir = path.join(__dirname, '../src/styles');
  const outputFile = path.join(__dirname, '../styles.css');
  
  console.log('🔨 Building CSS modules...');
  
  // Читаем главный CSS файл
  const mainCSS = fs.readFileSync(path.join(cssDir, 'main.css'), 'utf8');
  
  // Обрабатываем @import директивы
  const processedCSS = processImports(mainCSS, cssDir);
  
  // Записываем результат
  fs.writeFileSync(outputFile, processedCSS);
  
  console.log('✅ CSS modules built successfully!');
  console.log(`📁 Output: ${outputFile}`);
  
  // Показываем статистику
  const lines = processedCSS.split('\n').length;
  console.log(`📊 Total lines: ${lines}`);
}

/**
 * Обрабатывает @import директивы и вставляет содержимое файлов
 */
function processImports(css, baseDir) {
  return css.replace(/@import\s+['"]([^'"]+)['"];?/g, (match, importPath) => {
    const fullPath = path.resolve(baseDir, importPath);
    
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️  CSS file not found: ${fullPath}`);
      return match;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    console.log(`📦 Including: ${importPath}`);
    
    // Рекурсивно обрабатываем импорты в подключаемом файле
    return processImports(content, path.dirname(fullPath));
  });
}

// Запускаем сборку
if (require.main === module) {
  buildCSS();
}

module.exports = { buildCSS };
