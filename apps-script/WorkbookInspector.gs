const IFS_INSPECTION_LIMITS = Object.freeze({
  HEADER_ROWS: 8,
  COLUMNS: 120,
  VALIDATION_ROWS: 250
});

const IFS_HEADER_HINTS = Object.freeze({
  codename: ['codename', 'agent name', 'agent', '特工名', '代号'],
  participation: ['participation', 'attendance', 'check in', 'checked in', '到场', '参与'],
  dataConfirmed: ['data confirmed', 'data confirmation', 'verified', 'verification', '数据确认', '数据核验'],
  startStats: ['start stats', 'starting stats', 'initial stats', 'start ap', '活动前', '开始数据'],
  endStats: ['end stats', 'ending stats', 'final stats', 'end ap', '活动后', '结束数据']
});

/**
 * 输出工作簿结构，不读取完整参与者数据。
 * 默认只查看每个 Sheet 前 8 行、前 120 列，并扫描有限范围的数据验证。
 * @return {Object}
 */
function inspectWorkbookStructure() {
  const spreadsheet = getWorkbook_();
  const report = {
    inspectedAt: new Date().toISOString(),
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: sanitizeDiagnosticValue_(spreadsheet.getName()),
    spreadsheetTimezone: spreadsheet.getSpreadsheetTimeZone(),
    sheets: spreadsheet.getSheets().map(inspectSheetStructure_)
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object}
 */
function inspectSheetStructure_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const scannedRows = Math.min(
    Math.max(lastRow, 1),
    IFS_INSPECTION_LIMITS.HEADER_ROWS
  );
  const scannedColumns = Math.min(
    Math.max(lastColumn, 1),
    IFS_INSPECTION_LIMITS.COLUMNS
  );
  const values = sheet.getRange(1, 1, scannedRows, scannedColumns).getDisplayValues();
  const leadingRows = [];

  values.forEach(function(row, rowIndex) {
    const cells = [];
    row.forEach(function(value, columnIndex) {
      const safeValue = sanitizeDiagnosticValue_(value);
      if (safeValue) {
        cells.push({
          column: columnIndex + 1,
          a1Column: columnNumberToLetters_(columnIndex + 1),
          value: safeValue
        });
      }
    });
    if (cells.length > 0) {
      leadingRows.push({ row: rowIndex + 1, nonEmptyCells: cells });
    }
  });

  const candidateColumns = detectCandidateColumns_(values);
  const checkboxColumns = inspectCheckboxColumns_(sheet, lastRow, lastColumn);
  const protections = inspectProtections_(sheet);

  return {
    name: sheet.getName(),
    gid: sheet.getSheetId(),
    maxRows: sheet.getMaxRows(),
    maxColumns: sheet.getMaxColumns(),
    lastRow: lastRow,
    lastColumn: lastColumn,
    hidden: sheet.isSheetHidden(),
    frozenRows: sheet.getFrozenRows(),
    leadingRows: leadingRows,
    candidateColumns: candidateColumns,
    checkboxColumns: checkboxColumns,
    protections: protections
  };
}

/**
 * 候选识别只用于提示配置，绝不能直接作为写入依据。
 * @param {string[][]} values
 * @return {Object[]}
 */
function detectCandidateColumns_(values) {
  const results = [];
  values.forEach(function(row, rowIndex) {
    row.forEach(function(value, columnIndex) {
      const normalized = normalizeHeader_(value);
      if (!normalized) return;

      Object.keys(IFS_HEADER_HINTS).forEach(function(kind) {
        const matched = IFS_HEADER_HINTS[kind].some(function(hint) {
          const normalizedHint = normalizeHeader_(hint);
          return normalized === normalizedHint || normalized.indexOf(normalizedHint) >= 0;
        });
        if (matched) {
          results.push({
            kind: kind,
            row: rowIndex + 1,
            column: columnIndex + 1,
            a1Column: columnNumberToLetters_(columnIndex + 1),
            displayedHeader: sanitizeDiagnosticValue_(value),
            confidence: normalized === normalizeHeader_(IFS_HEADER_HINTS[kind][0]) ? 'high' : 'candidate'
          });
        }
      });
    });
  });
  return results;
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} lastRow
 * @param {number} lastColumn
 * @return {Object[]}
 */
function inspectCheckboxColumns_(sheet, lastRow, lastColumn) {
  if (lastRow < 1 || lastColumn < 1) return [];

  const rowCount = Math.min(lastRow, IFS_INSPECTION_LIMITS.VALIDATION_ROWS);
  const columnCount = Math.min(lastColumn, IFS_INSPECTION_LIMITS.COLUMNS);
  const validations = sheet.getRange(1, 1, rowCount, columnCount).getDataValidations();
  const columns = {};

  validations.forEach(function(row, rowIndex) {
    row.forEach(function(rule, columnIndex) {
      if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CHECKBOX) return;
      const column = columnIndex + 1;
      if (!columns[column]) {
        columns[column] = {
          column: column,
          a1Column: columnNumberToLetters_(column),
          firstCheckboxRow: rowIndex + 1,
          checkboxCountInScan: 0,
          criteriaValues: []
        };
      }
      columns[column].checkboxCountInScan += 1;
      if (columns[column].criteriaValues.length === 0) {
        columns[column].criteriaValues = rule.getCriteriaValues().map(sanitizeDiagnosticValue_);
      }
    });
  });

  return Object.keys(columns).map(function(column) { return columns[column]; });
}

/**
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Object}
 */
function inspectProtections_(sheet) {
  const sheetProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const rangeProtections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  return {
    sheet: sheetProtections.map(function(protection) {
      return {
        description: sanitizeDiagnosticValue_(protection.getDescription()),
        canCurrentUserEdit: protection.canEdit(),
        warningOnly: protection.isWarningOnly()
      };
    }),
    ranges: rangeProtections.slice(0, 50).map(function(protection) {
      return {
        a1Notation: protection.getRange().getA1Notation(),
        description: sanitizeDiagnosticValue_(protection.getDescription()),
        canCurrentUserEdit: protection.canEdit(),
        warningOnly: protection.isWarningOnly()
      };
    }),
    rangeProtectionCount: rangeProtections.length
  };
}

