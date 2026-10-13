/** @param {*} value @return {string} */
function normalizeCodename(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** @param {*} value @return {string} */
function normalizeHeader_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\/]+/g, ' ');
}

/** @param {*} value @return {number|null} */
function parsePositiveInteger_(value) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && Number.isSafeInteger(number) ? number : null;
}

/**
 * 仅供结构诊断日志使用；限制长度并去除换行。
 * @param {*} value
 * @return {string}
 */
function sanitizeDiagnosticValue_(value) {
  const text = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 80 ? text.slice(0, 77) + '...' : text;
}

/** @param {string} columnLetters @return {number} */
function columnLettersToNumber_(columnLetters) {
  return String(columnLetters).toUpperCase().split('').reduce(function(total, char) {
    return total * 26 + char.charCodeAt(0) - 64;
  }, 0);
}

/** @param {number} column @return {string} */
function columnNumberToLetters_(column) {
  let value = column;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

/**
 * 严格按规范化后的完整表头查找，不做模糊写入定位。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} headerName
 * @param {number} headerRow
 * @return {{column: number|null, matches: number[]}}
 */
function findColumnByHeader(sheet, headerName, headerRow) {
  const target = normalizeHeader_(headerName);
  if (!target || !headerRow) return { column: null, matches: [] };

  const width = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(headerRow, 1, 1, width).getDisplayValues()[0];
  const matches = [];
  headers.forEach(function(value, index) {
    if (normalizeHeader_(value) === target) matches.push(index + 1);
  });
  return { column: matches.length === 1 ? matches[0] : null, matches: matches };
}

/** @param {string} message @param {Object=} context */
function logInfo_(message, context) {
  console.log(JSON.stringify({
    level: 'INFO',
    message: message,
    context: context || {}
  }));
}

/** @param {string} message @param {Object=} context */
function logError_(message, context) {
  console.error(JSON.stringify({
    level: 'ERROR',
    message: message,
    context: context || {}
  }));
}

