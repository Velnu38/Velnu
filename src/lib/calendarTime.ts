import { DateTime } from "luxon";
export function localInstant(value: string, zone: string) {
  const date = DateTime.fromISO(value, { zone });
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value)
    throw new Error("That time does not exist in the selected time zone.");
  if (date.getPossibleOffsets().length > 1)
    throw new Error(
      "That time occurs twice when daylight saving time ends. Choose an unambiguous time.",
    );
  return date.toUTC().toISO()!;
}
export function dayBounds(day: string, zone: string) {
  const start = DateTime.fromISO(day, { zone }).startOf("day");
  if (!start.isValid || start.toISODate() !== day)
    throw new Error("Invalid calendar date");
  return {
    from: start.toUTC().toISO()!,
    to: start.plus({ days: 1 }).toUTC().toISO()!,
  };
}
