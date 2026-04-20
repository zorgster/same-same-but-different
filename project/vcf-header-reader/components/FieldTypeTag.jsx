export default function FieldTypeTag({ value }) {
  const colorMap = {
    Integer: ["#e6f1fb", "#0c447c"],
    Float: ["#e1f5ee", "#085041"],
    String: ["#faece7", "#993c1d"],
    Flag: ["#faeeda", "#854f0b"],
    Character: ["#fbeaf0", "#72243e"],
  };

  const [bg, fg] = colorMap[value] || ["#f1efe8", "#5f5e5a"];

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color: fg,
      }}
    >
      {value || "-"}
    </span>
  );
}
