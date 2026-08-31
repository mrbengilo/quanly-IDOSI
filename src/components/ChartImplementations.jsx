import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { money } from '../utils'

const chartColors = { revenue: '#07883f', expense: '#f27018', profit: '#1476f2', hours: '#13a04c' }

export function FinancialChart({ data, type = 'line', keys = ['revenue', 'expense', 'profit'], height = 260, hideLegend = false }) {
  const common = {
    data,
    margin: { top: 8, right: 12, left: -18, bottom: 0 },
  }
  const content = keys.map((key) =>
    type === 'bar' ? (
      <Bar key={key} dataKey={key} fill={chartColors[key] || '#07883f'} radius={[5, 5, 0, 0]} />
    ) : type === 'area' ? (
      <Area
        key={key}
        type="monotone"
        dataKey={key}
        stroke={chartColors[key] || '#07883f'}
        fill={chartColors[key] || '#07883f'}
        fillOpacity={0.1}
        strokeWidth={2.3}
      />
    ) : (
      <Line
        key={key}
        type="monotone"
        dataKey={key}
        stroke={chartColors[key] || '#07883f'}
        strokeWidth={2.4}
        dot={{ r: 3 }}
        activeDot={{ r: 5 }}
      />
    ),
  )
  const axis = (
    <>
      <CartesianGrid stroke="#e9eeeb" strokeDasharray="2 2" vertical={false} />
      <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
      <YAxis tickLine={false} axisLine={false} fontSize={11} />
      <Tooltip formatter={(value) => [`${value} triệu`, '']} contentStyle={{ borderRadius: 10, borderColor: '#dfe7e2' }} />
      {!hideLegend && <Legend iconType="circle" />}
    </>
  )
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart {...common}>{axis}{content}</BarChart>
        ) : type === 'area' ? (
          <AreaChart {...common}>{axis}{content}</AreaChart>
        ) : (
          <LineChart {...common}>{axis}{content}</LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export function DonutChart({ data, center, subcenter, height = 250 }) {
  const colors = ['#07883f', '#0fb278', '#f28b16', '#1976ed', '#6f48e8', '#ef4444']
  return (
    <div className="donut-wrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="60%" outerRadius="88%" paddingAngle={1}>
            {data.map((entry, index) => <Cell key={entry.name} fill={entry.color || colors[index % colors.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => money(value)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center"><strong>{center}</strong><span>{subcenter}</span></div>
    </div>
  )
}
