import React, { useMemo, useState } from "react";
import DataDropZone from "./data-drop-zone.jsx";

/**
 * Example dataset: array of rows (objects).
 * Some values are null to simulate missingness.
 */
const initialData = [
  { age: 25, income: 30000, subscribed: 1, region: "North" },
  { age: 32, income: 45000, subscribed: 0, region: "South" },
  { age: 40, income: null, subscribed: 1, region: "East" },
  { age: null, income: 52000, subscribed: 1, region: "North" },
  { age: 29, income: 38000, subscribed: null, region: "West" },
  { age: 35, income: null, subscribed: 0, region: "South" },
];

const isNumeric = (v) =>
  typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v);

function getColumnValues(data, col) {
  return data.map((row) => row[col]);
}

function summarizeColumn(data, col) {
  const values = getColumnValues(data, col);
  const nonMissing = values.filter((v) => v !== null && v !== undefined);

  const missingCount = values.length - nonMissing.length;
  const count = values.length;

  let mean = null;
  let median = null;
  let mode = null;

  if (nonMissing.length > 0) {
    // Mode (works for numeric or categorical)
    const freq = {};
    nonMissing.forEach((v) => {
      const key = String(v);
      freq[key] = (freq[key] || 0) + 1;
    });
    mode = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];

    // Numeric stats
    const numeric = nonMissing.filter(isNumeric);
    if (numeric.length > 0) {
      const sum = numeric.reduce((acc, v) => acc + v, 0);
      mean = sum / numeric.length;

      const sorted = [...numeric].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      median =
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
    }
  }

  return {
    count,
    missingCount,
    mean,
    median,
    mode,
  };
}

/**
 * Simple univariate imputation: mean / median / mode.
 */
function imputeUnivariate(data, targetCol, strategy, summary) {
  const fillValue =
    strategy === "mean"
      ? summary.mean
      : strategy === "median"
        ? summary.median
        : summary.mode;

  return data.map((row) => {
    if (row[targetCol] === null || row[targetCol] === undefined) {
      return { ...row, [targetCol]: fillValue };
    }
    return row;
  });
}

/**
 * Very simple "logistic-style" imputation for binary target:
 * - Assumes target is 0/1 or true/false.
 * - Uses selected predictor columns.
 * - For each missing row, finds rows with same predictor values and
 *   uses the majority class of the target among them.
 * - If no matching rows, falls back to global majority.
 *
 * This is NOT a full logistic regression, but it shows the idea of
 * using other columns to predict missing values.
 */
function imputeLogisticLike(data, targetCol, predictorCols) {
  const nonMissing = data.filter(
    (row) => row[targetCol] !== null && row[targetCol] !== undefined,
  );
  if (nonMissing.length === 0) return data;

  // Helper: normalize binary target to 0/1
  const toBinary = (v) => {
    if (v === true) return 1;
    if (v === false) return 0;
    if (v === "1" || v === 1) return 1;
    if (v === "0" || v === 0) return 0;
    return null;
  };

  // Global majority
  const globalCounts = { 0: 0, 1: 0 };
  nonMissing.forEach((row) => {
    const b = toBinary(row[targetCol]);
    if (b === 0 || b === 1) globalCounts[b] += 1;
  });
  const globalMajority = globalCounts[1] >= globalCounts[0] ? 1 : 0;

  // Build conditional frequency table keyed by predictor values
  const table = {};
  nonMissing.forEach((row) => {
    const key = predictorCols.map((c) => `${c}=${String(row[c])}`).join("|");
    const b = toBinary(row[targetCol]);
    if (b !== 0 && b !== 1) return;
    if (!table[key]) table[key] = { 0: 0, 1: 0 };
    table[key][b] += 1;
  });

  const predict = (row) => {
    const key = predictorCols.map((c) => `${c}=${String(row[c])}`).join("|");
    const counts = table[key];
    if (!counts) return globalMajority;
    return counts[1] >= counts[0] ? 1 : 0;
  };

  return data.map((row) => {
    if (row[targetCol] === null || row[targetCol] === undefined) {
      const pred = predict(row);
      return { ...row, [targetCol]: pred };
    }
    return row;
  });
}

export default function DataImputationApp() {
  const [data, setData] = useState(initialData);
  const [targetCol, setTargetCol] = useState("income");
  const [strategy, setStrategy] = useState("mean"); // mean | median | mode | logistic
  const [predictorCols, setPredictorCols] = useState(["age", "income"]);
  const [previewData, setPreviewData] = useState(initialData);

  const columns = useMemo(
    () => (data.length > 0 ? Object.keys(data[0]) : []),
    [data],
  );

  const summaries = useMemo(() => {
    const s = {};
    columns.forEach((col) => {
      s[col] = summarizeColumn(data, col);
    });
    return s;
  }, [data, columns]);

  const handleApply = () => {
    const summary = summaries[targetCol];
    let newData = data;

    if (strategy === "mean" || strategy === "median" || strategy === "mode") {
      newData = imputeUnivariate(data, targetCol, strategy, summary);
    } else if (strategy === "logistic") {
      newData = imputeLogisticLike(data, targetCol, predictorCols);
    }

    setData(newData);
    setPreviewData(newData);
  };

  const handlePreview = () => {
    const summary = summaries[targetCol];
    let newData = data;

    if (strategy === "mean" || strategy === "median" || strategy === "mode") {
      newData = imputeUnivariate(data, targetCol, strategy, summary);
    } else if (strategy === "logistic") {
      newData = imputeLogisticLike(data, targetCol, predictorCols);
    }

    setPreviewData(newData);
  };

  const togglePredictor = (col) => {
    setPredictorCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>Column Summarisation & Missing Value Imputation</h1>

      <DataDropZone onDataLoaded={(parsed) => setData(parsed)} />

      <section style={{ marginBottom: 24 }}>
        <h2>Column summaries</h2>
        <table
          border="1"
          cellPadding="4"
          style={{ borderCollapse: "collapse", marginBottom: 12 }}
        >
          <thead>
            <tr>
              <th>Column</th>
              <th>Count</th>
              <th>Missing</th>
              <th>Mean</th>
              <th>Median</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => {
              const s = summaries[col];
              return (
                <tr key={col}>
                  <td>{col}</td>
                  <td>{s.count}</td>
                  <td>{s.missingCount}</td>
                  <td>{s.mean !== null ? s.mean.toFixed(2) : "-"}</td>
                  <td>{s.median !== null ? s.median.toFixed(2) : "-"}</td>
                  <td>{s.mode !== null ? String(s.mode) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ maxWidth: 600 }}>
          For numeric columns, you can impute missing values with mean or
          median. For categorical or binary columns, mode or a predictive model
          (e.g. logistic regression) is more appropriate.
        </p>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Imputation controls</h2>

        <div style={{ marginBottom: 12 }}>
          <label>
            <strong>Target column with missing values: </strong>
            <select
              value={targetCol}
              onChange={(e) => setTargetCol(e.target.value)}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ marginBottom: 12 }}>
          <strong>Imputation strategy: </strong>
          <label style={{ marginRight: 8 }}>
            <input
              type="radio"
              value="mean"
              checked={strategy === "mean"}
              onChange={(e) => setStrategy(e.target.value)}
            />
            Mean
          </label>
          <label style={{ marginRight: 8 }}>
            <input
              type="radio"
              value="median"
              checked={strategy === "median"}
              onChange={(e) => setStrategy(e.target.value)}
            />
            Median
          </label>
          <label style={{ marginRight: 8 }}>
            <input
              type="radio"
              value="mode"
              checked={strategy === "mode"}
              onChange={(e) => setStrategy(e.target.value)}
            />
            Mode
          </label>
          <label>
            <input
              type="radio"
              value="logistic"
              checked={strategy === "logistic"}
              onChange={(e) => setStrategy(e.target.value)}
            />
            Logistic-style (use other columns, binary target)
          </label>
        </div>

        {strategy === "logistic" && (
          <div style={{ marginBottom: 12 }}>
            <strong>Predictor columns to use:</strong>
            <div>
              {columns
                .filter((c) => c !== targetCol)
                .map((col) => (
                  <label key={col} style={{ marginRight: 8 }}>
                    <input
                      type="checkbox"
                      checked={predictorCols.includes(col)}
                      onChange={() => togglePredictor(col)}
                    />
                    {col}
                  </label>
                ))}
            </div>
            <p style={{ maxWidth: 600, fontSize: 14 }}>
              This demo uses a simple frequency-based predictor. In a real
              system, you’d train a logistic regression model on the non-missing
              rows using these predictors, then use it to infer the missing
              values.
            </p>
          </div>
        )}

        <button onClick={handlePreview} style={{ marginRight: 8 }}>
          Preview imputed data
        </button>
        <button onClick={handleApply}>Apply to dataset</button>
      </section>

      <section>
        <h2>Data preview (after chosen imputation)</h2>
        <table
          border="1"
          cellPadding="4"
          style={{ borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewData.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col}>
                    {row[col] === null || row[col] === undefined
                      ? "NULL"
                      : String(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
