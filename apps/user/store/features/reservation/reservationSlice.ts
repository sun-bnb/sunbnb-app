'use client'

import { createKeyValueSlice } from '../../createKeyValueSlice'

const reservationSlice = createKeyValueSlice('reservation')

export const { setValue } = reservationSlice.actions
export default reservationSlice.reducer