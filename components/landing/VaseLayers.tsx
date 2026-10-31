// The original sculpture, generated on the server instead of appending 1,104 DOM nodes on mount.
function ring(t: number, inset = 0) {
  const y = 393 - t * 315;
  const width = 66 + 25 * Math.sin(t * Math.PI) + 28 * Math.exp(-(((t - .68) / .24) ** 2)) - 18 * Math.exp(-(((t - .9) / .12) ** 2)) - inset;
  return Array.from({ length: 12 }, (_, j) => {
    const angle = j / 12 * Math.PI * 2 + t * 1.15;
    return [210 + Math.cos(angle) * width, y + Math.sin(angle) * width * .37];
  });
}
export default function VaseLayers() {
  return <g id="vaseLayers">
    {Array.from({ length: 92 }, (_, i) => {
      const t = i / 92, lower = ring(t), upper = ring((i + 1) / 92);
      return Array.from({ length: 12 }, (_, j) => {
        const next = (j + 1) % 12;
        const light = Math.round(48 + 13 * Math.cos((j + .5) / 12 * Math.PI * 2 + t * 1.15 - 4));
        return <polygon key={`${i}-${j}`} points={[lower[j], lower[next], upper[next], upper[j]].map(p => p.join(",")).join(" ")} fill={`hsl(${254 + Math.round(t * 6)} 92% ${light}%)`} stroke={`hsl(253 88% ${light - 4}%)`} strokeWidth=".45" />;
      });
    })}
    <polygon points={ring(1, 11).map(p => p.join(",")).join(" ")} fill="#211052" />
    <path d={"M" + ring(1).map(p => p.join(",")).join("L") + "ZM" + ring(1, 10).reverse().map(p => p.join(",")).join("L") + "Z"} fill="url(#vaseTop)" fillRule="evenodd" />
  </g>;
}
