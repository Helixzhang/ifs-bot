/**
 * 校验阶段一配置。此函数只读，不会测试写入单元格。
 * 返回 ok=false 时，后续正式写入代码必须拒绝执行。
 * @return {Object}
 */
function validateConfiguration() {
  const config = getRawConfiguration_();
  const spreadsheet = getWorkbook_();
  const errors = [];
  const warnings = [];
  const resolved = {};

  if (!String(config.EVENT_ID || '').trim()) errors.push('缺少 EVENT_ID。');
  if (!String(config.SCORE_SHEET_NAME || '').trim()) errors.push('缺少 SCORE_SHEET_NAME。');
  if (!parsePositiveInteger_(config.SCORE_HEADER_ROW)) errors.push('SCORE_HEADER_ROW 必须是正整数。');
  if (!String(config.RESPONSE_SHEET_NAME || '').trim()) warnings.push('尚未设置 RESPONSE_SHEET_NAME。');
  if (!parsePositiveInteger_(config.RESPONSE_HEADER_ROW)) warnings.push('尚未设置有效的 RESPONSE_HEADER_ROW。');
  if (!String(config.REVIEW_LOCATION || '').trim()) warnings.push('尚未设置 REVIEW_LOCATION，无法关联官方审核进度。');

  const botRecordsName = String(config.BOT_RECORDS_SHEET_NAME || 'Bot Records').trim();
  const botRecordsSheet = spreadsheet.getSheetByName(botRecordsName);
  if (!botRecordsSheet) errors.push('缺少 ' + botRecordsName + '，请先运行 createBotRecordsSheet()。');

  const scoreSheet = spreadsheet.getSheetByName(String(config.SCORE_SHEET_NAME || '').trim());
  if (!scoreSheet) {
    errors.push('找不到正式计分板 Sheet：' + String(config.SCORE_SHEET_NAME || '(未配置)'));
  } else {
    const headerRow = parsePositiveInteger_(config.SCORE_HEADER_ROW);
    if (headerRow && headerRow <= scoreSheet.getMaxRows()) {
      resolved.codename = resolveConfiguredColumn_(scoreSheet, headerRow, {
        label: 'Codename',
        header: config.SCORE_CODENAME_HEADER,
        override: config.SCORE_CODENAME_COLUMN
      }, errors);
      resolved.attendance = resolveConfiguredColumn_(scoreSheet, headerRow, {
        label: 'Attendance',
        header: config.SCORE_ATTENDANCE_HEADER,
        override: config.SCORE_ATTENDANCE_COLUMN
      }, errors);
      resolved.dataConfirmed = resolveConfiguredColumn_(scoreSheet, headerRow, {
        label: 'Data Confirmed',
        header: config.SCORE_DATA_CONFIRMED_HEADER,
        override: config.SCORE_DATA_CONFIRMED_COLUMN
      }, errors);

      ['attendance', 'dataConfirmed'].forEach(function(key) {
        const info = resolved[key];
        if (!info || !info.column) return;
        const checkbox = inspectConfiguredCheckboxColumn_(scoreSheet, headerRow, info.column);
        info.checkbox = checkbox;
        if (!checkbox.detected) {
          errors.push(info.label + ' 列未在扫描范围内检测到 checkbox 数据验证。');
        }
      });

      const protections = inspectProtections_(scoreSheet);
      const blockedSheetProtection = protections.sheet.some(function(item) {
        return !item.canCurrentUserEdit && !item.warningOnly;
      });
      if (blockedSheetProtection) {
        errors.push('当前执行用户不能编辑正式计分板的受保护 Sheet。');
      }
      resolved.protections = protections;
    } else if (headerRow) {
      errors.push('SCORE_HEADER_ROW 超出 Sheet 最大行数。');
    }
  }

  const responseName = String(config.RESPONSE_SHEET_NAME || '').trim();
  if (responseName && !spreadsheet.getSheetByName(responseName)) {
    errors.push('找不到表单响应 Sheet：' + responseName);
  }

  const report = {
    ok: errors.length === 0,
    spreadsheetId: spreadsheet.getId(),
    eventId: String(config.EVENT_ID || '').trim(),
    errors: errors,
    warnings: warnings,
    resolved: resolved
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * 固定列号优先；未配置时才按准确表头查找。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} headerRow
 * @param {{label:string, header:*, override:*}} definition
 * @param {string[]} errors
 * @return {Object|null}
 */
function resolveConfiguredColumn_(sheet, headerRow, definition, errors) {
  const overrideText = String(definition.override == null ? '' : definition.override).trim();
  if (overrideText) {
    const override = parsePositiveInteger_(overrideText);
    if (!override || override > sheet.getMaxColumns()) {
      errors.push(definition.label + ' 固定列号无效或超出范围。');
      return null;
    }
    return {
      label: definition.label,
      source: 'override',
      column: override,
      a1Column: columnNumberToLetters_(override),
      displayedHeader: sanitizeDiagnosticValue_(sheet.getRange(headerRow, override).getDisplayValue())
    };
  }

  const header = String(definition.header || '').trim();
  if (!header) {
    errors.push(definition.label + ' 未配置表头名称或固定列号。');
    return null;
  }

  const found = findColumnByHeader(sheet, header, headerRow);
  if (found.matches.length === 0) {
    errors.push(definition.label + ' 表头未找到：' + header);
    return null;
  }
  if (found.matches.length > 1) {
    errors.push(definition.label + ' 表头重复，匹配列：' + found.matches.join(', '));
    return null;
  }
  return {
    label: definition.label,
    source: 'header',
    column: found.column,
    a1Column: columnNumberToLetters_(found.column),
    displayedHeader: sanitizeDiagnosticValue_(sheet.getRange(headerRow, found.column).getDisplayValue())
  };
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} headerRow
 * @param {number} column
 * @return {Object}
 */
function inspectConfiguredCheckboxColumn_(sheet, headerRow, column) {
  const availableRows = Math.max(sheet.getLastRow() - headerRow, 0);
  const scanRows = Math.min(availableRows, IFS_INSPECTION_LIMITS.VALIDATION_ROWS);
  if (scanRows < 1) return { detected: false, reason: '表头下方没有可扫描数据行。' };

  const rules = sheet.getRange(headerRow + 1, column, scanRows, 1).getDataValidations();
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index][0];
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
      return {
        detected: true,
        sampleRow: headerRow + 1 + index,
        criteriaValues: rule.getCriteriaValues().map(sanitizeDiagnosticValue_)
      };
    }
  }
  return { detected: false, scannedRows: scanRows };
}

