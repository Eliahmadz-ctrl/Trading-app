// ─── Circular 0–8 score ring ─────────────────────────────────────────────────
interface Props {
  score: number;
  max?: number;
  size?: number;
  tone: 'bull' | 'bear' | 'muted';
}

export default function ScoreRing({ score, max = 8, size = 132, tone }: Props) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / max));
  const dash = c * frac;

  const palette =
    tone === 'bull'
      ? { from: '#34d399', to: '#10b981', track: 'rgba(52,211,153,0.10)', text: '#34d399' }
      : tone === 'bear'
        ? { from: '#fb7185', to: '#f43f5e', track: 'rgba(251,113,133,0.10)', text: '#fb7185' }
        : { from: '#475569', to: '#334155', track: 'rgba(148,163,184,0.08)', text: '#94a3b8' };

  const id = `ring-${tone}`;
  const half = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-ring" role="img" aria-label={`Signal score ${score} of ${max}`}>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
      </defs>
      <circle cx={half} cy={half} r={r} stroke={palette.track} strokeWidth={stroke} fill="none" />
      <circle
        cx={half} cy={half} r={r}
        stroke={`url(#${id})`}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${half} ${half})`}
        className="score-ring-arc"
      />
      <text x={half} y={half - 4} textAnchor="middle" dominantBaseline="middle" className="score-ring-number" fill={palette.text}>
        {score}
      </text>
      <text x={half} y={half + 17} textAnchor="middle" dominantBaseline="middle" className="score-ring-max" fill="#8194b8">
        / {max}
      </text>
    </svg>
  );
}
