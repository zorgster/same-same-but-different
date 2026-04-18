import { useMemo, useState } from "react";
import * as XLSX from "xlsx";

const COLORS = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2a2d3e",
  accent: "#0ea5a3",
  accentDim: "#0ea5a322",
  red: "#e05c5c",
  green: "#4caf88",
  text: "#e8eaf0",
  muted: "#6b7080",
};

const styles = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: COLORS.text,
    padding: "32px 24px",
  },
  header: {
    marginBottom: 24,
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    margin: 0,
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 6,
  },
  card: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  fileInputWrap: {
    border: `2px dashed ${COLORS.border}`,
    borderRadius: 10,
    padding: "20px 14px",
    textAlign: "center",
    background: COLORS.accentDim,
  },
  button: (disabled) => ({
    border: "none",
    borderRadius: 8,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    color: disabled ? COLORS.muted : "#0f1117",
    background: disabled ? COLORS.border : COLORS.accent,
  }),
  headersWrap: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: 10,
    marginTop: 10,
  },
  headerItem: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: "8px 10px",
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontSize: 13,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: 10,
  },
  statCard: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: 12,
    background: "#151924",
  },
  statValue: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: COLORS.muted,
    marginTop: 6,
  },
  tableWrap: {
    maxHeight: 360,
    overflow: "auto",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    position: "sticky",
    top: 0,
    background: "#1f2431",
    color: COLORS.muted,
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${COLORS.border}`,
  },
};

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function hasLikelyMissingUkDomainDot(email) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) return false;

  const domain = email.slice(atIndex + 1).toLowerCase();
  // Common UK domain typo patterns where the dot before uk is missing.
  return /(acuk|couk|govuk|orguk|schuk)$/.test(domain);
}

function isValidEmail(value) {
  if (!EMAIL_REGEX.test(value)) return false;
  if (hasLikelyMissingUkDomainDot(value)) return false;
  return true;
}

function getDomain(email) {
  const atIndex = email.lastIndexOf("@");
  if (atIndex === -1) return "";
  return email.slice(atIndex + 1).toLowerCase();
}

function levenshteinDistance(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();

  const rows = x.length + 1;
  const cols = y.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

function isLikelyDomainTypo(domain, dominantDomain) {
  if (!domain || !dominantDomain) return false;
  if (domain === dominantDomain) return false;

  const distance = levenshteinDistance(domain, dominantDomain);
  const maxLen = Math.max(domain.length, dominantDomain.length);
  const normalized = maxLen === 0 ? 1 : distance / maxLen;

  // Keep this conservative to catch likely typos while avoiding noise.
  return distance <= 2 && normalized <= 0.2;
}

function getHeaderPriority(headerText) {
  const header = String(headerText || "").toLowerCase();
  if (/name/.test(header)) return 5;
  if (/(id|identifier|employee|student|staff|person|number|ref|uid)/.test(header)) return 4;
  if (/(class|group|team|code)/.test(header)) return 3;
  return 1;
}

function getRowIdentifierSummary(row, headers, selectedCols) {
  const candidates = headers
    .map((header, idx) => ({
      idx,
      header,
      priority: getHeaderPriority(header),
    }))
    .filter((item) => !selectedCols.includes(item.idx))
    .sort((a, b) => b.priority - a.priority || a.idx - b.idx);

  const parts = [];
  for (const candidate of candidates) {
    const value = String(row[candidate.idx] ?? "").trim();
    if (!value) continue;
    parts.push(`${candidate.header}: ${value}`);
    if (parts.length === 2) break;
  }

  if (parts.length > 0) return parts.join(" | ");

  // Fallback to any non-empty cell for basic row context.
  for (let idx = 0; idx < row.length; idx += 1) {
    if (selectedCols.includes(idx)) continue;
    const value = String(row[idx] ?? "").trim();
    if (value) return value;
  }

  return "No identifier data";
}

function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const bytes = new Uint8Array(event.target.result);
        const workbook = XLSX.read(bytes, { type: "array" });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        resolve(rows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export default function EmailValidatorApp() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [selectedCols, setSelectedCols] = useState([]);
  const [strictMode, setStrictMode] = useState(false);
  const [domainCheckMode, setDomainCheckMode] = useState(true);
  const [result, setResult] = useState(null);

  const headers = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return rows[0].map((value, idx) => String(value || `Column ${idx + 1}`));
  }, [rows]);

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const parsedRows = await parseSpreadsheet(file);
    setRows(parsedRows);
    setFileName(file.name);
    setSelectedCols([]);
    setResult(null);
  };

  const toggleCol = (idx) => {
    setResult(null);
    setSelectedCols((current) =>
      current.includes(idx) ? current.filter((value) => value !== idx) : [...current, idx]
    );
  };

  const validateEmails = () => {
    if (!rows || selectedCols.length === 0) return;

    const formatIssues = [];
    const domainIssues = [];
    let blankCount = 0;
    let validCount = 0;
    let checkedCount = 0;
    const candidates = [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];

      selectedCols.forEach((colIndex) => {
        const value = String(row[colIndex] ?? "").trim();
        const identifier = getRowIdentifierSummary(row, headers, selectedCols);

        if (value.length === 0) {
          blankCount += 1;
          if (strictMode) {
            formatIssues.push({
              rowNumber: rowIndex + 1,
              columnName: headers[colIndex] || `Column ${colIndex + 1}`,
              value: "(blank)",
              issueType: "Missing email",
              identifier,
            });
          }
          return;
        }

        checkedCount += 1;

        candidates.push({
          value,
          rowNumber: rowIndex + 1,
          columnName: headers[colIndex] || `Column ${colIndex + 1}`,
          identifier,
        });
      });
    }

    const domainFrequency = {};
    for (const item of candidates) {
      if (!isValidEmail(item.value)) continue;
      const domain = getDomain(item.value);
      if (!domain) continue;
      domainFrequency[domain] = (domainFrequency[domain] || 0) + 1;
    }

    const dominantDomain = Object.entries(domainFrequency)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    for (const item of candidates) {
      if (!isValidEmail(item.value)) {
        formatIssues.push({
          rowNumber: item.rowNumber,
          columnName: item.columnName,
          value: item.value,
          issueType: "Invalid format",
          identifier: item.identifier,
        });
        continue;
      }

      const domain = getDomain(item.value);
      if (domainCheckMode && dominantDomain && isLikelyDomainTypo(domain, dominantDomain)) {
        domainIssues.push({
          rowNumber: item.rowNumber,
          columnName: item.columnName,
          value: item.value,
          issueType: `Likely domain typo (expected ${dominantDomain})`,
          identifier: item.identifier,
        });
        continue;
      }

      validCount += 1;
    }

    setResult({
      checkedCount,
      validCount,
      blankCount,
      formatIssueCount: formatIssues.length,
      domainIssueCount: domainIssues.length,
      invalidCount: formatIssues.length + domainIssues.length,
      issues: [...formatIssues, ...domainIssues],
      dominantDomain,
    });
  };

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>Email Validator</h1>
        <p style={styles.subtitle}>
          Upload one spreadsheet, select email columns, and validate email formatting.
        </p>
      </div>

      <div style={styles.card}>
        <div style={styles.fileInputWrap}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFileChange} />
          <div style={{ marginTop: 8, fontSize: 12, color: COLORS.muted }}>
            {fileName || "No file selected"}
          </div>
        </div>
      </div>

      {headers.length > 0 && (
        <div style={styles.card}>
          <div style={{ fontSize: 13, marginBottom: 8, color: COLORS.muted }}>
            Select one or more columns that should contain only email addresses:
          </div>
          <div style={styles.headersWrap}>
            {headers.map((header, idx) => (
              <label key={idx} style={styles.headerItem}>
                <input
                  type="checkbox"
                  checked={selectedCols.includes(idx)}
                  onChange={() => toggleCol(idx)}
                />
                <span>{header}</span>
              </label>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ ...styles.headerItem, marginBottom: 10, maxWidth: 320 }}>
              <input
                type="checkbox"
                checked={strictMode}
                onChange={(event) => {
                  setStrictMode(event.target.checked);
                  setResult(null);
                }}
              />
              <span>
                Strict mode: treat blank email cells as invalid
              </span>
            </label>

            <label style={{ ...styles.headerItem, marginBottom: 10, maxWidth: 420 }}>
              <input
                type="checkbox"
                checked={domainCheckMode}
                onChange={(event) => {
                  setDomainCheckMode(event.target.checked);
                  setResult(null);
                }}
              />
              <span>
                Domain consistency check: flag domains that look like typos of the dominant domain
              </span>
            </label>

            <button
              style={styles.button(selectedCols.length === 0)}
              onClick={validateEmails}
              disabled={selectedCols.length === 0}
            >
              Validate selected columns
            </button>
          </div>
        </div>
      )}

      {result && (
        <>
          <div style={styles.card}>
            <div style={styles.stats}>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: COLORS.text }}>{result.checkedCount}</div>
                <div style={styles.statLabel}>Checked emails</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: COLORS.green }}>{result.validCount}</div>
                <div style={styles.statLabel}>Valid</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: COLORS.red }}>{result.formatIssueCount}</div>
                <div style={styles.statLabel}>Format errors</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: COLORS.red }}>{result.domainIssueCount}</div>
                <div style={styles.statLabel}>Domain typos</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statValue, color: COLORS.muted }}>{result.blankCount}</div>
                <div style={styles.statLabel}>Blank cells</div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: COLORS.muted }}>
              Strict mode is {strictMode ? "ON" : "OFF"}.
              {strictMode
                ? " Blank cells in selected columns are included in Invalid."
                : " Blank cells are counted separately and not treated as invalid."}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>
              Domain consistency check is {domainCheckMode ? "ON" : "OFF"}.
              {result.dominantDomain
                ? ` Dominant domain detected: ${result.dominantDomain}.`
                : " No dominant domain detected."}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>
              Format errors are checked first; domain consistency is a second pass for near-miss typos.
            </div>
          </div>

          <div style={styles.card}>
            <div style={{ marginBottom: 10, fontWeight: 700 }}>
              Invalid email values {result.invalidCount === 0 ? "(none found)" : ""}
            </div>

            {result.invalidCount > 0 ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Row</th>
                      <th style={styles.th}>Identifier</th>
                      <th style={styles.th}>Column</th>
                      <th style={styles.th}>Issue</th>
                      <th style={styles.th}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.map((issue, idx) => (
                      <tr key={idx}>
                        <td style={styles.td}>{issue.rowNumber}</td>
                        <td style={styles.td}>{issue.identifier}</td>
                        <td style={styles.td}>{issue.columnName}</td>
                        <td style={styles.td}>{issue.issueType}</td>
                        <td style={{ ...styles.td, color: COLORS.red }}>{issue.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.green, fontSize: 13 }}>
                All checked email values are correctly formed.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
