'use client'

import { createKeyValueSlice } from '../../createKeyValueSlice'

const sitesSlice = createKeyValueSlice('sites')

export const { setValue } = sitesSlice.actions
export default sitesSlice.reducer