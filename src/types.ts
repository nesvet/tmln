/**
 * Represents a generic object that can be stored in the timeline.
 * Any object can be an item.
 */
export type Item = {
	[key: PropertyKey]: unknown;
};

/**
 * A flexible type representing a date, which can be a `Date` object,
 * a Unix timestamp (number), or a date string parsable by `new Date()`.
 */
export type RawDate = Date | number | string;

/**
 * Represents a Unix timestamp (in milliseconds) precisely at midnight (00:00:00.000).
 * All date calculations in the timeline are normalized to this for day-based grouping.
 */
export type Midnight = number;

/**
 * Options for item retrieval methods like `get()`.
 */
export type GetOptions = {
	
	/**
	 * The maximum number of items to return.
	 */
	limit?: number;
	
	/**
	 * The number of items to skip from the beginning of the result set, for pagination.
	 */
	offset?: number;
	
	/**
	 * If `true`, the returned items will be sorted chronologically.
	 * This may incur a performance cost.
	 */
	sorted?: boolean;
};

/**
 * Options for date cache configuration.
 */
export type CacheOptions = {
	
	/**
	 * The maximum size of the cache for converting dates from strings/numbers.
	 * Applies to the global or local cache depending on `useGlobalCache`.
	 * @default 1000
	 */
	dateCacheLimit?: number;
	
	/**
	 * The maximum size of the cache for dates that require time truncation (setHours(0,0,0,0)).
	 * Applies to the global or local cache depending on `useGlobalCache`.
	 * @default 500
	 */
	dateSetHoursCacheLimit?: number;
};

/**
 * Configuration options for a timeline instance.
 */
export type TimelineOptions = {
	
	/**
	 * Options for date caching behavior.
	 */
	cache?: CacheOptions & {
		
		/**
		 * If `true` (default), the instance will use a shared, global cache.
		 * This is most efficient when many timelines in an application handle overlapping dates.
		 * If `false`, the instance will create its own isolated cache.
		 * @default true
		 */
		useGlobalCache?: boolean;
	};
};

/**
 * Defines the types of events that can be emitted by a timeline.
 */
export type EventType = "bounds" | "date" | "item";

/**
 * Event emitted when the timeline's start or end date boundaries change.
 */
export type BoundsChangeEvent = {
	
	/**
	 * The type of the event.
	 */
	type: "bounds";
};

/**
 * Event emitted when the collection of items for a specific date changes
 * (e.g., an item is added, removed, or moved to/from this date).
 */
export type DateChangeEvent = {
	
	/**
	 * The type of the event.
	 */
	type: "date";
	
	/**
	 * The timestamp of the date that was changed.
	 */
	at: Midnight;
};

/**
 * Event emitted when a specific item is added or its date is updated in a `Timeline`.
 */
export type ItemChangeEvent<I extends Item> = {
	
	/**
	 * The type of the event.
	 */
	type: "item";
	
	/**
	 * The item that was affected.
	 */
	item: I;
	
	/**
	 * The new date for the item.
	 */
	at: Midnight;
	
	/**
	 * The previous date for the item, or `null` if the item is new.
	 */
	prevAt: Midnight | null;
};

/**
 * Event emitted when a specific item is added or its date range is updated in a `RangeTimeline`.
 */
export type RangeItemChangeEvent<I extends Item> = {
	
	/**
	 * The type of the event.
	 */
	type: "item";
	
	/**
	 * The item that was affected.
	 */
	item: I;
	
	/**
	 * The new start date of the item's range.
	 */
	startAt: Midnight;
	
	/**
	 * The new end date of the item's range.
	 */
	endAt: Midnight;
	
	/**
	 * The previous start date of the range, or `null` if the item is new.
	 */
	prevStartAt: Midnight | null;
	
	/**
	 * The previous end date of the range, or `null` if the item is new.
	 */
	prevEndAt: Midnight | null;
};

/**
 * A union of all possible event types for the `Timeline` class.
 */
export type TimelineEvent<I extends Item> = BoundsChangeEvent | DateChangeEvent | ItemChangeEvent<I>;

/**
 * A union of all possible event types for the `RangeTimeline` class.
 */
export type RangeTimelineEvent<I extends Item> = BoundsChangeEvent | DateChangeEvent | RangeItemChangeEvent<I>;

/**
 * Defines the signature for an event listener function.
 * @param event The event object that was emitted.
 */
export type Listener<I extends Item, T extends RangeTimelineEvent<I> | TimelineEvent<I> = RangeTimelineEvent<I> | TimelineEvent<I>> = (event: T) => void;

/**
 * Represents an active event subscription, allowing it to be cancelled.
 */
export type Subscription = {
	
	/**
	 * Detaches the listener from the event, preventing future calls.
	 */
	unsubscribe(): void;
};

/**
 * Internal configuration for storing a listener and its `once` flag.
 */
export type ListenerConfig<I extends Item> = {
	
	/**
	 * The listener function.
	 */
	listener: Listener<I>;
	
	/**
	 * A flag indicating if the listener should be removed after its first invocation.
	 */
	once: boolean;
};

/**
 * Internal data structure for storing items on a specific day.
 */
export type StorageNode<I extends Item> = {
	
	/**
	 * The array holding items. Its length can be larger than the actual item count for performance.
	 */
	items: I[];
	
	/**
	 * The actual number of items stored in the `items` array.
	 */
	count: number;
};

/**
 * Represents a date range with a start and end timestamp.
 */
export type ItemRange = {
	
	/**
	 * The start of the range as a midnight timestamp.
	 */
	startAt: Midnight;
	
	/**
	 * The end of the range as a midnight timestamp.
	 */
	endAt: Midnight;
};

/**
 * Summarizes the result of a batch operation like `addMany` or `updateMany`.
 */
export type BatchResult = {
	
	/**
	 * The number of items that were newly added.
	 */
	added: number;
	
	/**
	 * The number of items that were updated (e.g., moved to a new date or range).
	 */
	updated: number;
	
	/**
	 * The number of items that were removed (e.g., due to receiving an invalid date).
	 */
	removed: number;
};
