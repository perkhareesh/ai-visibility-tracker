"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const C = { brand: "#3346c2", official: "#1d7a50", third: "#a66300", rival: "#6e6589", grid: "#e3e6eb", text: "#5a6472" };

export function TrendChart({ data }: { data: Array<{ label: string; mentionRate: number | null; citationRate: number | null; recommendationRate: number | null }> }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.text }} tickLine={false} axisLine={{ stroke: C.grid }} />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: C.text }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => (v == null ? "No data" : `${v}%`)} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {/* connectNulls=false: a run with no data leaves a gap instead of a fake zero */}
          <Line type="monotone" dataKey="mentionRate" name="Mention rate" stroke={C.brand} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          <Line type="monotone" dataKey="citationRate" name="Official citation rate" stroke={C.official} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
          <Line type="monotone" dataKey="recommendationRate" name="Recommendation rate" stroke={C.third} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EntityBars({ data }: { data: Array<{ name: string; rate: number | null; tracked: boolean }> }) {
  const rows = data.map((d) => ({ ...d, value: d.rate ?? 0, brand: d.tracked ? d.rate ?? 0 : null, rival: d.tracked ? null : d.rate ?? 0 }));
  return (
    <div className="w-full" style={{ height: Math.max(120, rows.length * 38 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: C.text }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: "#18202b" }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v) => `${v}%`} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Bar dataKey="brand" name="Tracked brand" stackId="a" fill={C.brand} radius={[0, 3, 3, 0]} barSize={18} />
          <Bar dataKey="rival" name="Competitor" stackId="a" fill={C.rival} radius={[0, 3, 3, 0]} barSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
