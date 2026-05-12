import React, { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload } from "lucide-react";
import { COLORS } from "../styles/light-theme";

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes, unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Universal file drop zone.
 *
 * Props:
 *   onFilesSelected(files: File[])  called with the accepted File array
 *   accept     react-dropzone accept map, e.g. { "text/csv": [".csv"] }
 *   label      text shown in the idle drop area
 *   multiple   allow multiple files (default false)
 *   selectedFiles  File[] to display below the zone (controlled by parent)
 *   fileInfo   [{ label, value }] extra rows shown after filename/size
 */
export default function DropZone({
  onFilesSelected,
  accept = {},
  label = "Drop a file here, or click to select",
  multiple = false,
  selectedFiles = [],
  fileInfo = [],
}) {
  const onDrop = useCallback(
    (accepted) => {
      if (!accepted.length) return;
      onFilesSelected(multiple ? accepted : [accepted[0]]);
    },
    [onFilesSelected, multiple],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, multiple });

  const files = (Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles]).filter(Boolean);

  return (
    <div>
      <div {...getRootProps()} style={zoneStyle(isDragActive)}>
        <input {...getInputProps()} />
        <Upload size={16} color={isDragActive ? COLORS.accent : COLORS.muted} strokeWidth={2} />
        <span style={{ fontSize: 13, color: isDragActive ? COLORS.accent : COLORS.muted }}>
          {isDragActive ? "Release to drop…" : label}
        </span>
      </div>

      {files.length > 0 && (
        <div style={infoPanel}>
          {files.map((f, i) => (
            <div
              key={i}
              style={i > 0 ? { ...fileRow, borderTop: `1px solid ${COLORS.border}`, marginTop: 6, paddingTop: 6 } : fileRow}
            >
              <InfoLine label="File" value={f.name} />
              <InfoLine label="Size" value={formatFileSize(f.size)} />
              {f.webkitRelativePath && <InfoLine label="Path" value={f.webkitRelativePath} />}
            </div>
          ))}
          {fileInfo.map(({ label, value }) => (
            <InfoLine key={label} label={label} value={value ?? "—"} />
          ))}
        </div>
      )}
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, color: COLORS.text }}>
      <strong style={{ color: COLORS.muted }}>{label}:</strong> {value}
    </div>
  );
}

const zoneStyle = (active) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "18px 24px",
  border: `2px dashed ${active ? COLORS.accent : COLORS.border}`,
  borderRadius: 8,
  background: active ? COLORS.accentSoft : COLORS.surface,
  cursor: "pointer",
  transition: "border-color 0.15s, background 0.15s",
  userSelect: "none",
});

const infoPanel = {
  marginTop: 8,
  padding: "8px 12px",
  borderRadius: 6,
  border: `1px solid ${COLORS.border}`,
  background: COLORS.bg,
};

const fileRow = { lineHeight: 1.6 };
