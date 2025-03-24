'use client';

import React, { useTransition } from 'react';
import { reserveItem, unreserveItem } from '../actions'; 
import { InventoryItem, Reservation } from '@/types/shared';

/**
 * Checks if the item is reserved *today* by *anyone*.
 */
function isReservedToday(item: InventoryItem): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // ignoring time portion

  return item.reservations?.some((res: Reservation) => {
    const fromDate = new Date(res.from);
    const toDate = new Date(res.to);
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);
    return today >= fromDate && today <= toDate;
  }) ?? false;
}

/**
 * Checks if the item is reserved *today* specifically by the given user.
 */
function isReservedTodayByUser(item: InventoryItem, userId: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return item.reservations?.some((res: Reservation) => {
    if (res.user.id !== userId) return false; // must match this user
    const fromDate = new Date(res.from);
    const toDate = new Date(res.to);
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);
    return today >= fromDate && today <= toDate;
  }) ?? false;
}

export default function SunbedItem({
  siteId,
  item,
  userId,
}: {
  siteId: string;
  item: InventoryItem;
  userId: string; // the current user's ID
}) {

  // Is the item reserved by *anyone*?
  const reservedByAnyone = isReservedToday(item);

  // Is the item reserved specifically by the currently logged in user?
  const reservedByMe = isReservedTodayByUser(item, userId);

  // For visual feedback if an action is in progress
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      // If it's reserved by me, unreserve it.
      if (reservedByMe) {
        await unreserveItem(siteId, item.id);
      }
      // If it's NOT reserved by me (either not reserved or reserved by someone else),
      // we attempt to reserve it.
      else {
        await reserveItem(siteId, item.id);
      }
    });
  };

  // We'll color the item based on whether anyone's using it
  // (and optionally show a different color if reserved by someone else)
  let boxColor = 'bg-green-200'; // default: available
  if (reservedByAnyone) {
    boxColor = reservedByMe ? 'bg-red-200' : 'bg-gray-200'; 
    // e.g. if reserved by me => red, if reserved by someone else => yellow
  }

  return (
    <button
      disabled={(!reservedByMe && reservedByAnyone) || isPending}
      onClick={handleToggle}
      className={`p-4 ${boxColor} border rounded flex items-center justify-center`}
    >
      {isPending ? 'Saving...' : item.number}
    </button>
  );
}
