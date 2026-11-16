const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { bg: v('bg'), panel: v('panel'), raised: v('raised'), line: v('line'), fg: v('fg'), dim: v('dim'), accent: v('accent'), warn: v('warn'), bad: v('bad'), good: v('good'), claude: v('claude') }, fontSize: { xxs: '10px' } } },
};
