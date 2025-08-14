# 📅 Timeline

[![npm version](https://img.shields.io/npm/v/tmln?style=flat-square)](https://www.npmjs.com/package/tmln)
[![bundle size](https://img.shields.io/bundlephobia/minzip/tmln?style=flat-square)](https://bundlephobia.com/result?p=tmln)
[![npm license](https://img.shields.io/npm/l/tmln?style=flat-square)](https://www.npmjs.com/package/tmln)
[![typescript](https://img.shields.io/npm/types/tmln?style=flat-square)](#)

High-performance, lightweight, in-memory timeline data structure to manage items on dates and within ranges.

Built for speed and ease of use. Perfect for applications like schedulers, calendars, event managers, or any system that needs to query objects based on their position in time efficiently.

## ✨ Features

-   🚀 **High Performance**: AVL tree-based implementation for O(log n) operations.
-   📅 **Two Timeline Types**: Manage items on a single point in time (`Timeline`) or across a date range (`RangeTimeline`).
-   🎯 **Event-driven Architecture**: Listen to changes on the timeline's boundaries, specific dates, or individual items.
-   🔍 **Flexible & Rich Queries**: Get items, days, or ranges with advanced options like pagination, sorting, and including empty days.
-   🧠 **Smart Caching**: Configurable global or local cache for date parsing to boost performance.
-   🔄 **Batch Operations**: Blazing fast bulk `addMany`, `updateMany`, and `deleteMany` operations.
-   📦 **Lean & Fully Typed**: A focused library with minimal dependencies, completely type-safe.

## 🛠️ Installation

```bash
npm install tmln
```

## 🚀 Quick Start

### Timeline for Single-Date Items

Perfect for events, tasks, or anything that occurs on a specific day.

```typescript
import { Timeline } from "tmln";


type Event = {
  id: string;
  title: string;
  at: Date;
};

// Initialize with the name of the date property ("at")
const timeline = new Timeline<Event>("at");

timeline.add({ id: "1", title: "Team Meeting", at: new Date("2025-10-20") });
timeline.add({ id: "2", title: "Submit Report", at: new Date("2025-10-20") });

// Get all events for a specific date
const events = timeline.get("2025-10-20");
console.log(events); // -> [{id: "1", ...}, {id: "2", ...}]

// Get all events within a date range
const monthEvents = timeline.get("2025-10-01", "2025-10-31");
```

### RangeTimeline for Date-Range Items

Ideal for projects, vacations, or anything that spans multiple days.

```typescript
import { RangeTimeline } from "tmln";


type Task = {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
};

// Initialize with start and end date property names
const timeline = new RangeTimeline<Task>("startAt", "endAt");

timeline.add({ id: "A", name: "Project Alpha", startAt: new Date("2025-11-10"), endAt: new Date("2025-11-20") });
timeline.add({ id: "B", name: "Project Beta", startAt: new Date("2025-11-15"), endAt: new Date("2025-11-25") });

// Get tasks active on a specific date
const activeTasks = timeline.get(new Date("2025-11-18"));
console.log(activeTasks); // -> [{id: "A", ...}, {id: "B", ...}]

// Get all tasks that overlap with a date range
const overlappingTasks = timeline.get("2025-11-01", "2025-11-16");
```

## 🧠 Caching Strategy

To maximize performance, Timeline uses an internal cache for date parsing. By default, all instances share a **global cache**. This is highly efficient if your application creates many timelines that use similar dates.

#### Using an Isolated (Local) Cache

If you need an isolated cache for a specific instance, you can opt-out of the global cache during initialization.

```typescript
import { Timeline } from "tmln";


const isolatedTimeline = new Timeline("at", [], {
  cache: {
    useGlobalCache: false,
    dateCacheLimit: 200 // Optionally provide local limits
  }
});
```

#### Configuring the Global Cache

You can configure the limits of the global cache or clear it entirely using the static `configGlobalCache` method. This should be done once at the application's entry point.

```typescript
import { Timeline } from "tmln";


// Configure global cache limits for all timeline instances
Timeline.configGlobalCache({
  dateCacheLimit: 2000,
  dateSetHoursCacheLimit: 1000,
});

// You can also clear all global caches
Timeline.configGlobalCache({ clear: true });
```

## 📋 API Reference

### Common Methods & Properties

The following members are available on both `Timeline` and `RangeTimeline`.

| Member                  | Description                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `constructor(...)`      | Creates a new timeline instance. Accepts property names, initial items, and cache options.                    |
| **`size`**              | (`get`) Returns the total number of items in the timeline.                                                    |
| **`startAt`** / **`endAt`** | (`get`) Returns the earliest/latest date timestamp in the timeline, or `null`.                                |
| **`daysCount`**         | (`get`) Returns the total number of unique days that contain items.                                           |
| `add(item)`             | Adds a new item or updates an existing one. Returns `true` if added, `false` if updated.                        |
| `addMany(items)`        | Efficiently adds or updates multiple items. Returns a `{ added, updated, removed }` result object.            |
| `update(item)`          | An alias for `.add(item)`.                                                                                    |
| `updateMany(items)`     | An alias for `.addMany(items)`.                                                                               |
| `delete(item)`          | Deletes an item. Returns `true` if deletion was successful.                                                   |
| `deleteMany(items)`     | Efficiently deletes multiple items. Returns the number of items deleted.                                      |
| `has(item)`             | Checks if an item exists in the timeline.                                                                     |
| `find(predicate)`       | Finds the first item that satisfies the predicate function, or `undefined`.                                   |
| `get(date, options?)`   | Gets an array of items on a specific date.                                                                    |
| `get(start, end, options?)`| Gets an array of all unique items active within a date range.                                                 |
| `getDates(start?, end?)`  | Gets an array of all dates (timestamps) that contain items, sorted chronologically.                           |
| `getDay(date)`          | Gets a single Day object (`{at, items}`) for a date, or `null` if the day is empty.                           |
| `getDays(start, end?, options?)` | Gets an array of Day objects within a range. Supports including empty days.                           |
| `getClosestDay(date, direction?)` | Finds the closest Day with items relative to a date. `direction` can be `before`, `after`, or `either`. |
| `iterate(date/range)`   | Returns a memory-efficient iterator for items on a date or in a range.                                        |
| `iterateDays(start, end?, options?)` | Returns a memory-efficient iterator for Day objects.                                            |
| `clear()`               | Removes all items from the timeline.                                                                          |
| `isEmpty()`             | Returns `true` if the timeline has no items.                                                                  |
| `on(event, ...)`        | Subscribes to an event (`bounds`, `date`, or `item`). Returns a `Subscription` object.                          |
| `once(event, ...)`      | Subscribes to an event for a single invocation.                                                               |
| `off(event, ...)`       | Unsubscribes a listener.                                                                                      |

### `RangeTimeline`-Specific API

| Member                  | Description                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `getRange(item)`        | Returns the stored `{ startAt, endAt }` range for an item, or `null`.                                         |
| `getStartsOn(date)`     | Gets all items whose range *starts* on the specified date.                                                    |
| `getEndsOn(date)`       | Gets all items whose range *ends* on the specified date.                                                      |
| `getRanges(start, end?, options?)` | Retrieves items with their full range and their intersection with the query range.                  |
| `iterateRanges(...)`    | Returns a memory-efficient iterator for the range objects described above.                                    |

### Event System

Subscribe to changes using `on(eventType, ...args)`:

| `eventType` | Additional Arguments                  | Event Payload (`event`)                                 |
| ----------- | ------------------------------------- | ------------------------------------------------------- |
| `"bounds"`  | `listener`                            | `{ type: "bounds", startAt: Midnight \| null, endAt: Midnight \| null }` |
| `"date"`    | `date`, `listener`                    | `{ type: "date", at: Midnight }`                        |
| `"item"`    | `item`, `listener`                    | **`Timeline`**:<br />`{ type: "item", item: Item, at: Midnight, prevAt: Midnight \| null }` <br /><br />**`RangeTimeline`**:<br />`{ type: "item", item: Item, startAt: Midnight, endAt: Midnight, prevStartAt: Midnight \| null, prevEndAt: Midnight \| null }` |

## 🎯 Usage Examples

### Event-driven Updates

React to changes in real-time to update UI or trigger logic.

```typescript
const timeline = new Timeline<Event>("at");

// Listen for item changes
timeline.on("item", myEvent, (event) => {
  console.log(`Item moved from ${event.prevAt} to ${event.at}`);
});

// Listen for bounds changes
timeline.on("bounds", () => {
  console.log(`Timeline bounds changed: ${timeline.startAt} - ${timeline.endAt}`);
});
```

### Advanced Queries with `getDays` and `getRanges`

Retrieve structured data, including empty days, perfect for building a calendar UI.

```typescript
// Get all days in a month, including empty ones
const calendarDays = timeline.getDays("2025-12-01", "2025-12-31", { includeEmpty: true });

for (const day of calendarDays) {
  console.log(`Date: ${new Date(day.at).toLocaleDateString()}, Items: ${day.items.length}`);
}

// For RangeTimeline, get items and how they intersect with a specific week
const weeklyRanges = rangeTimeline.getRanges("2025-11-17", "2025-11-23");
for (const r of weeklyRanges) {
    console.log(`Item ${r.item.id} intersects from ${r.intersection.startAt} to ${r.intersection.endAt}`);
}
```

### Batch Operations

For large datasets, batch operations are significantly faster than calling methods in a loop.

```typescript
const events = [
  { id: "1", at: new Date("2025-01-10") },
  { id: "2", at: new Date("2025-01-11") },
];

// Efficient batch insertion
const { added } = timeline.addMany(events);
console.log(`Added ${added} new events`);

// Batch deletion
const deleted = timeline.deleteMany(events);
console.log(`Deleted ${deleted} events`);
```

### Pagination and Sorting

Easily implement pagination for large result sets.

```typescript
const options = { sorted: true, limit: 10 };

// Get sorted events with pagination
const page1 = timeline.get("2025-01-01", "2025-01-31", { ...options, offset: 0 });
const page2 = timeline.get("2025-01-01", "2025-01-31", { ...options, offset: 10 });
```

## 🔧 Performance

The underlying data structures (AVL tree, hash map) ensure both efficient and predictable performance. `addMany`, `updateMany`, and `deleteMany` are highly optimized for bulk operations.

-   **Get items (single date)**: `O(k)` where `k` is the number of items on that date.
-   **Get items (date range)**: `O(log D + M*k)` where `D` is unique days, `M` is days in range.
-   **Add/Update/Delete item**: `O(k + log D)`.
-   **Check for item (`has`)**: `O(1)`.
-   **Memory Usage**: `O(N + D)` where `N` is total items, `D` is unique days.

## 🤝 Contributing

Contributions are welcome! Please feel free to open an issue or submit a Pull Request.

## 📄 License

[MIT](./LICENSE)
