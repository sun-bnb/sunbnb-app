'use client'

import React from 'react'
import {
  Box,
  Grid,
  Paper,
  Typography,
  useTheme,
} from '@mui/material'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

export interface DashboardData {
  totalChairs: number
  reservationsToday: number
  revenueThisMonth: number
  revenueYearToDate: number,
  revenueHistory: { month: string, revenue: number, fees: number }[]
}

export default function DashboardView({ data }: { data: DashboardData}) {

  const theme = useTheme()
  const SafeResponsiveContainer = ResponsiveContainer as unknown as React.ComponentType<any>
  const SafeBarChart = BarChart as unknown as React.ComponentType<any>
  const SafeCartesianGrid = CartesianGrid as unknown as React.ComponentType<any>
  const SafeXAxis = XAxis as unknown as React.ComponentType<any>
  const SafeYAxis = YAxis as unknown as React.ComponentType<any>
  const SafeTooltip = Tooltip as unknown as React.ComponentType<any>
  const SafeLegend = Legend as unknown as React.ComponentType<any>
  const SafeBar = Bar as unknown as React.ComponentType<any>

  return (
    <Box p={4}>
      {/* Top metrics */}
      <Grid container spacing={3} alignItems="stretch">
        {/* Total Chairs */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper
            elevation={2}
            sx={{
              height: '100%',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h6" color="textSecondary">
              Total Chairs
            </Typography>
            <Typography variant="h3" fontWeight="bold">
              {data.totalChairs}
            </Typography>
          </Paper>
        </Grid>

        {/* Reservations Today */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper
            elevation={2}
            sx={{
              height: '100%',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h6" color="textSecondary">
              Reservations Today
            </Typography>
            <Typography variant="h3" fontWeight="bold">
              { data.reservationsToday }
            </Typography>
          </Paper>
        </Grid>

        {/* Revenue This Month */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper
            elevation={2}
            sx={{
              height: '100%',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h6" color="textSecondary">
              Revenue This Month
            </Typography>
            <Typography variant="h3" fontWeight="bold">
              {data.revenueThisMonth.toFixed(0)} €
            </Typography>
          </Paper>
        </Grid>

        {/* Revenue Year‐to‐Date */}
        <Grid item xs={12} sm={6} md={3}>
          <Paper
            elevation={2}
            sx={{
              height: '100%',
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography variant="h6" color="textSecondary">
              Revenue YTD
            </Typography>
            <Typography variant="h3" fontWeight="bold">
              {data.revenueYearToDate.toFixed(0)} €
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Spacer */}
      <Box mt={4} />

      {/* Revenue + Fees bar chart */}
      <Box height={350}>
        <Paper elevation={2} sx={{ width: '100%', height: '100%', p: 2 }}>
          <Typography variant="h6" gutterBottom>
            Revenue & Fees (Last 5 Months)
          </Typography>
          <SafeResponsiveContainer width="100%" height="85%">
            <SafeBarChart
              data={data.revenueHistory}
              margin={{ top: 10, right: 20, bottom: 20, left: 0 }}
            >
              <SafeCartesianGrid strokeDasharray="3 3" />
              <SafeXAxis dataKey="month" />
              <SafeYAxis />
              <SafeTooltip formatter={(value: number) => `€${value.toFixed(2)}`} />
              <SafeLegend verticalAlign="top" />
              <SafeBar
                dataKey="revenue"
                name="Revenue"
                fill={theme.palette.primary.main}
                barSize={30}
              />
              <SafeBar
                dataKey="fees"
                name="Fees"
                fill={theme.palette.error.main}
                barSize={30}
              />
            </SafeBarChart>
          </SafeResponsiveContainer>
        </Paper>
      </Box>
    </Box>
  )
}
