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

export default function Dashboard() {
  const theme = useTheme()

  // Placeholder data for metrics
  const totalChairs = 120
  const todaysReservations = 37
  const revenueThisMonth = 8425.5
  const revenueYearToDate = 54200.75

  // Placeholder revenue + fees data for last 5 months
  const revenueData = [
    { month: 'Jan', revenue: 7200, fees: 360 },
    { month: 'Feb', revenue: 8100, fees: 405 },
    { month: 'Mar', revenue: 6500, fees: 325 },
    { month: 'Apr', revenue: 9000, fees: 450 },
    { month: 'May', revenue: revenueThisMonth, fees: revenueThisMonth * 0.05 },
  ]

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
              {totalChairs}
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
              {todaysReservations}
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
              {revenueThisMonth.toFixed(0)} €
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
              {revenueYearToDate.toFixed(0)} €
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
          <ResponsiveContainer width="100%" height="85%">
            <BarChart
              data={revenueData}
              margin={{ top: 10, right: 20, bottom: 20, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: number) => `€${value.toFixed(2)}`} />
              <Legend verticalAlign="top" />
              <Bar
                dataKey="revenue"
                name="Revenue"
                fill={theme.palette.primary.main}
                barSize={30}
              />
              <Bar
                dataKey="fees"
                name="Fees"
                fill={theme.palette.error.main}
                barSize={30}
              />
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      </Box>
    </Box>
  )
}
