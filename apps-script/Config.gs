/**
 * 阶段一配置入口。
 * 所有值保存在 Script Properties；这里仅定义属性名和安全默认值。
 */
const IFS_PROPERTY_KEYS = Object.freeze({
  EVENT_ID: 'EVENT_ID',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  TIMEZONE: 'TIMEZONE',
  BOT_RECORDS_SHEET_NAME: 'BOT_RECORDS_SHEET_NAME',

  SCORE_SHEET_NAME: 'SCORE_SHEET_NAME',
  SCORE_HEADER_ROW: 'SCORE_HEADER_ROW',
  RESPONSE_SHEET_NAME: 'RESPONSE_SHEET_NAME',
  RESPONSE_HEADER_ROW: 'RESPONSE_HEADER_ROW',

  SCORE_CODENAME_HEADER: 'SCORE_CODENAME_HEADER',
  SCORE_ATTENDANCE_HEADER: 'SCORE_ATTENDANCE_HEADER',
  SCORE_DATA_CONFIRMED_HEADER: 'SCORE_DATA_CONFIRMED_HEADER',
  SCORE_CODENAME_COLUMN: 'SCORE_CODENAME_COLUMN',
  SCORE_ATTENDANCE_COLUMN: 'SCORE_ATTENDANCE_COLUMN',
  SCORE_DATA_CONFIRMED_COLUMN: 'SCORE_DATA_CONFIRMED_COLUMN',

  ATTENDANCE_CHECKED_VALUE: 'ATTENDANCE_CHECKED_VALUE',
  ATTENDANCE_UNCHECKED_VALUE: 'ATTENDANCE_UNCHECKED_VALUE',
  DATA_CHECKED_VALUE: 'DATA_CHECKED_VALUE',
  DATA_UNCHECKED_VALUE: 'DATA_UNCHECKED_VALUE',

  REVIEW_LOCATION: 'REVIEW_LOCATION',
  REVIEW_BOARD_URL: 'REVIEW_BOARD_URL',

  WORKER_BASE_URL: 'WORKER_BASE_URL',
  WORKER_SHARED_SECRET: 'WORKER_SHARED_SECRET'
});

/**
 * 写入非敏感默认值，不覆盖已存在的配置。
 * 敏感值只保留占位符，禁止提交真实密钥。
 */
function setupProperties() {
  const properties = PropertiesService.getScriptProperties();
  const current = properties.getProperties();
  const defaults = {
    TIMEZONE: 'Asia/Singapore',
    BOT_RECORDS_SHEET_NAME: 'Bot Records',
    SCORE_HEADER_ROW: '',
    RESPONSE_HEADER_ROW: '',
    SCORE_CODENAME_HEADER: '',
    SCORE_ATTENDANCE_HEADER: '',
    SCORE_DATA_CONFIRMED_HEADER: '',
    SCORE_CODENAME_COLUMN: '',
    SCORE_ATTENDANCE_COLUMN: '',
    SCORE_DATA_CONFIRMED_COLUMN: '',
    ATTENDANCE_CHECKED_VALUE: 'true',
    ATTENDANCE_UNCHECKED_VALUE: 'false',
    DATA_CHECKED_VALUE: 'true',
    DATA_UNCHECKED_VALUE: 'false',
    WORKER_SHARED_SECRET: 'REPLACE_IN_SCRIPT_PROPERTIES'
  };

  const missing = {};
  Object.keys(defaults).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      missing[key] = defaults[key];
    }
  });

  if (Object.keys(missing).length > 0) {
    properties.setProperties(missing, false);
  }

  console.log(JSON.stringify({
    action: 'setupProperties',
    initializedKeys: Object.keys(missing),
    note: '请在项目设置的 Script Properties 中填写真实值。'
  }, null, 2));
}

/** @return {GoogleAppsScript.Spreadsheet.Spreadsheet} */
function getWorkbook_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = String(properties.getProperty(IFS_PROPERTY_KEYS.SPREADSHEET_ID) || '').trim();
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('无法取得绑定工作簿；请设置 SPREADSHEET_ID。');
  }
  return spreadsheet;
}

/** @return {Object<string, string>} */
function getRawConfiguration_() {
  return PropertiesService.getScriptProperties().getProperties();
}

