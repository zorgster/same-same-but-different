import { COLORS, UI_FONT } from "../../styles/light-theme";

const SIZE = 520;
const CENTER = SIZE / 2;
const RADIUS = 175;

function polar(index, count, value, min, max) {
  const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
  const frac = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return [CENTER + Math.cos(angle) * RADIUS * frac, CENTER + Math.sin(angle) * RADIUS * frac];
}

const toPath = (points) => points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z";

// series: [{ key, label, values, color, dash, width, fill, showPoints }]
export default function RadarChart({ questions, series, min, max, step = 0.5 }) {
  const n = questions.length;
  const rings = [];
  if (max > min && step > 0) {
    for (let v = min + step; v <= max + 1e-9; v += step) rings.push(v);
  }

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ width: "100%", maxWidth: 520, fontFamily: UI_FONT }} role="img" aria-label="Radar chart of questionnaire responses">
      {rings.map((v) => (
        <g key={v}>
          <path d={toPath(questions.map((_, i) => polar(i, n, v, min, max)))} fill="none" stroke={COLORS.border} strokeWidth={1} />
          <text x={CENTER + 3} y={CENTER - ((v - min) / (max - min)) * RADIUS - 2} fontSize={9} fill={COLORS.muted}>{v}</text>
        </g>
      ))}
      {questions.map((q, i) => {
        const [x, y] = polar(i, n, max, min, max);
        const [lx, ly] = polar(i, n, max + (max - min) * 0.12, min, max);
        const anchor = Math.abs(lx - CENTER) < 8 ? "middle" : lx > CENTER ? "start" : "end";
        return (
          <g key={i}>
            <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke={COLORS.border} />
            <text x={lx} y={ly} fontSize={12} fill={COLORS.text} textAnchor={anchor} dominantBaseline="middle">{q}</text>
          </g>
        );
      })}
      {series.map((s) => {
        // Missing answers sit at the axis minimum so the polygon stays closed.
        const pts = s.values.map((v, i) => polar(i, n, v ?? min, min, max));
        return (
          <g key={s.key}>
            <path d={toPath(pts)} fill={s.fill ? s.color + "22" : "none"} stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" />
            {s.showPoints && pts.map(([x, y], i) => s.values[i] != null && (
              <circle key={i} cx={x} cy={y} r={3} fill={s.color}><title>{`${s.label} — ${questions[i]}: ${s.values[i]}`}</title></circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
