'use client'

import Link from 'next/link'

import { useFormState, useFormStatus } from 'react-dom'
import React, { ReactElement, useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Item from './Item'

import { InventoryItem, Reservation, SiteProps } from '@/types/shared'

function parseSunbedNumber(num: number) {
  const str = String(num); // e.g. "234"
  const parcel = parseInt(str[0]!, 10);   // 2
  const row = parseInt(str[1]!, 10);      // 3
  const position = parseInt(str[2]!, 10); // 4
  return { parcel, row, position };
}

function isReservedToday(item: InventoryItem): boolean {
  const today = new Date();
  
  // If ignoring time, we can "zero out" the hours, minutes, seconds:
  // (Optional)
  today.setHours(0, 0, 0, 0);

  // Check each reservation
  return item.reservations?.some((res: Reservation) => {
    const fromDate = new Date(res.from);
    const toDate = new Date(res.to);

    // Zero out their times if ignoring time components
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);

    // If today's date is between from and to (inclusive), 
    // the item is reserved
    return today >= fromDate && today <= toDate;
  }) ?? false;
}

export default function Management({ site, userId, apiKey }: { site: SiteProps; userId: string; apiKey: string }) {
  
  const { inventoryItems = [] } = site;

  // 1. Build a nested structure: parcels -> rows -> positions
  //    For example:
  //    grouped[parcel][row][position] = item
  const grouped = inventoryItems.reduce((acc, item) => {
    const { parcel, row, position } = parseSunbedNumber(item.number);
    if (!acc[parcel]) {
      acc[parcel] = {};
    }
    if (!acc[parcel][row]) {
      acc[parcel][row] = {};
    }
    acc[parcel][row][position] = item;
    return acc;
  }, {} as Record<number, Record<number, Record<number, InventoryItem>>>);

  return (
    <div className="container mx-auto mt-6">
      {Object.entries(grouped).map(([parcel, rows]) => (
        <div key={parcel} className="mb-8">
          <h2 className="text-lg font-bold mb-2">Parcel {parcel}</h2>

          {Object.entries(rows).map(([row, positions]) => (
            <div key={row} className="flex flex-row space-x-2 mb-2">
              {Object.entries(positions).map(([position, item]) => {
                return (
                  <Item key={item.id} siteId={site.id!} userId={userId} item={item} />
                );
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}