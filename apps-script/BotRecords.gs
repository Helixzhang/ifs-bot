const IFS_BOT_RECORD_HEADERS = Object.freeze([
  'record_id',
  'event_id',
  'codename',
  'normalized_codename',
  'faction',
  'response_sheet',
  'response_row',
  'score_sheet',
  'last_known_score_row',
  'telegram_chat_id',
  'telegram_message_id',
  'start_stats_received',
  'end_stats_received',
  'attendance_state',
  'data_confirmed_state',
  'submission_count',
  'last_submission_hash',
  'sync_state',
  'created_at',
  'updated_at',
  'last_action_by',
  'last_action_at',
  'last_error'
]);

/**
 * 创建或补齐 Bot Records 隐藏页；不会删除已有列或数据。
 * @return {Object}
 */
function createBotRecordsSheet() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('无法获取 Script Lock，稍后重试 createBotRecordsSheet()。');
  }

  try {
    const spreadsheet = getWorkbook_();
    const properties = getRawConfiguration_();
    const sheetName = String(properties.BOT_RECORDS_SHEET_NAME || 'Bot Records').trim();
    let sheet = spreadsheet.getSheetByName(sheetName);
    const created = !sheet;

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    const existingWidth = Math.max(sheet.getLastColumn(), 1);
    const existingHeaders = sheet.getRange(1, 1, 1, existingWidth).getDisplayValues()[0]
      .map(function(value) { return String(value).trim(); });
    const missingHeaders = IFS_BOT_RECORD_HEADERS.filter(function(header) {
      return existingHeaders.indexOf(header) < 0;
    });

    if (created || existingHeaders.every(function(value) { return !value; })) {
      sheet.getRange(1, 1, 1, IFS_BOT_RECORD_HEADERS.length).setValues([IFS_BOT_RECORD_HEADERS]);
    } else if (missingHeaders.length > 0) {
      sheet.getRange(1, existingHeaders.length + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }

    const finalWidth = Math.max(sheet.getLastColumn(), IFS_BOT_RECORD_HEADERS.length);
    sheet.getRange(1, 1, 1, finalWidth)
      .setFontWeight('bold')
      .setBackground('#d9ead3');
    sheet.setFrozenRows(1);
    sheet.hideSheet();

    const result = {
      created: created,
      sheetName: sheetName,
      gid: sheet.getSheetId(),
      addedHeaders: created ? IFS_BOT_RECORD_HEADERS : missingHeaders,
      hidden: sheet.isSheetHidden()
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

