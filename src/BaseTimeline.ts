import { AVLTree } from "avl";
import type {
	BatchResult,
	CacheOptions,
	Day,
	DayOptions,
	EventType,
	Item,
	Listener,
	ListenerConfig,
	Midnight,
	ParsedDayArgs,
	RangeDayOptions,
	RangeTimelineEvent,
	RawDate,
	StorageNode,
	Subscription,
	TimelineEvent,
	TimelineOptions
} from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any, no-bitwise */


export const ONE_DAY = 86_400_000;


export const EMPTY_ARRAY: any[] = [];
export const tempEventBuffer: any[] = [];


/**
 * Custom error thrown for invalid date inputs.
 */
export class DateError extends TypeError {
	constructor(rawDate: RawDate) {
		super(`Invalid date: ${rawDate.toString()}`);
		
		this.name = "DateError";
	}
}


export abstract class BaseTimeline<I extends Item, E extends RangeTimelineEvent<I> | TimelineEvent<I>> implements Iterable<I> {
	constructor(options: TimelineOptions = {}) {
		
		const {
			useGlobalCache = true,
			dateCacheLimit,
			dateSetHoursCacheLimit
		} = options.cache ?? {};
		
		this.#dateCache = useGlobalCache ? BaseTimeline.#globalDateCache : new Map();
		this.#dateSetHoursCache = useGlobalCache ? BaseTimeline.#globalDateSetHoursCache : new Map();
		this.#dateCacheLimit = (useGlobalCache || dateCacheLimit === undefined) ? BaseTimeline.#globalDateCacheLimit : dateCacheLimit;
		this.#dateSetHoursCacheLimit = (useGlobalCache || dateSetHoursCacheLimit === undefined) ? BaseTimeline.#globalDateSetHoursCacheLimit : dateSetHoursCacheLimit;
		
	}
	
	#comparator = (a: Midnight, b: Midnight) => a - b;
	
	protected _storage = new Map<Midnight, StorageNode<I>>();
	protected _dateTree = new AVLTree<Midnight>(this.#comparator);
	protected _listeners: { [key in EventType]?: ListenerConfig<I>[] } = {};
	protected _dateListeners = new Map<Midnight, ListenerConfig<I>[]>();
	protected _itemListeners = new Map<I, ListenerConfig<I>[]>();
	
	#startAt: Midnight | null = null;
	#endAt: Midnight | null = null;
	
	#eventProcessingActive = false;
	
	#dateCache: Map<number | string, Midnight>;
	#dateSetHoursCache: Map<number, number>;
	#dateCacheLimit: number;
	#dateSetHoursCacheLimit: number;
	
	protected _toTs(rawDate: RawDate): Midnight | null {
		if (!rawDate && rawDate !== 0)
			return null;
		
		if (rawDate instanceof Date) {
			const rawAt = rawDate.getTime();
			
			if (Number.isNaN(rawAt))
				return null;
			
			const cachedAt = this.#dateSetHoursCache.get(rawAt);
			
			if (cachedAt !== undefined)
				return cachedAt;
			
			if (rawDate.getHours() | rawDate.getMinutes() | rawDate.getSeconds() | rawDate.getMilliseconds()) {
				const at = new Date(rawAt).setHours(0, 0, 0, 0);
				
				if (this.#dateSetHoursCache.size < this.#dateSetHoursCacheLimit)
					this.#dateSetHoursCache.set(rawAt, at);
				
				return at;
			}
			
			return rawAt;
		}
		
		const cachedAt = this.#dateCache.get(rawDate);
		
		if (cachedAt !== undefined)
			return cachedAt;
		
		const date = new Date(rawDate);
		let at = date.getTime();
		
		if (Number.isNaN(at))
			return null;
		
		if (date.getHours() | date.getMinutes() | date.getSeconds() | date.getMilliseconds())
			at = date.setHours(0, 0, 0, 0);
		
		if (this.#dateCache.size < this.#dateCacheLimit)
			this.#dateCache.set(rawDate, at);
		
		return at;
	}
	
	protected _resolveTs(rawDate: RawDate): Midnight {
		const at = this._toTs(rawDate);
		
		if (at === null)
			throw new DateError(rawDate);
		
		return at;
	}
	
	protected _resolveTsRange(start: RawDate, end?: RawDate) {
		const startAt = this._resolveTs(start);
		const endAt = end === undefined ? this.#endAt : this._resolveTs(end);
		
		if (endAt === null || startAt > endAt)
			return null;
		
		return { startAt, endAt };
	}
	
	protected _parseDayArgs(endOrOptions?: DayOptions | RangeDayOptions | RawDate, options?: DayOptions | RangeDayOptions): ParsedDayArgs {
		return (endOrOptions && typeof endOrOptions === "object" && !(endOrOptions instanceof Date)) ?
			{
				end: endOrOptions.end,
				includeEmpty: endOrOptions.includeEmpty === true,
				limit: endOrOptions.limit ?? Infinity,
				offset: endOrOptions.offset ?? 0,
				uniqueOnly: (endOrOptions as RangeDayOptions).uniqueOnly
			} :
			{
				end: endOrOptions as RawDate | undefined,
				includeEmpty: options?.includeEmpty === true,
				limit: options?.limit ?? Infinity,
				offset: options?.offset ?? 0,
				uniqueOnly: (options as RangeDayOptions)?.uniqueOnly
			};
	}
	
	private _findCeilingNode(key: Midnight): ReturnType<typeof this._dateTree.find> {
		
		let currentNode = this._dateTree.root;
		let ceilingNode = null;
		
		while (currentNode) {
			const order = this.#comparator(key, currentNode.key);
			
			if (order === 0)
				return currentNode;
			
			if (order < 0) {
				ceilingNode = currentNode;
				currentNode = currentNode.left;
			} else
				currentNode = currentNode.right;
		}
		
		return ceilingNode;
	}
	
	protected *_rangeKeys(startKey: Midnight, endKey: Midnight): IterableIterator<Midnight> {
		if (startKey > endKey)
			return;
		
		let currentNode = this._findCeilingNode(startKey);
		
		while (currentNode && this.#comparator(currentNode.key, endKey) <= 0) {
			yield currentNode.key;
			
			currentNode = this._dateTree.next(currentNode);
		}
		
	}
	
	protected _collectExistingDates(startAt: Midnight, endAt: Midnight): Midnight[] {
		return [ ...this._rangeKeys(startAt, endAt) ];
	}
	
	protected _calculateDayLimits(startAt: Midnight, endAt: Midnight, limit: number, offset: number) {
		const dayCount = Math.floor((endAt - startAt) / ONE_DAY) + 1;
		
		const actualLimit = Math.min(dayCount - offset, limit);
		
		return { dayCount, actualLimit };
	}
	
	protected _addListener(
		map: Map<I | Midnight, ListenerConfig<I>[]> | { [key in EventType]?: ListenerConfig<I>[] },
		key: EventType | I | Midnight,
		listener: Listener<I>,
		once: boolean
	): Subscription {
		
		let listeners: ListenerConfig<I>[] | undefined;
		
		if (map instanceof Map) {
			listeners = map.get(key as I | Midnight);
			
			if (!listeners) {
				listeners = [];
				map.set(key as I | Midnight, listeners);
			}
		} else {
			listeners = map[key as EventType];
			
			if (!listeners) {
				listeners = [];
				map[key as EventType] = listeners;
			}
		}
		
		listeners.push({ listener, once });
		
		return { unsubscribe: () => this._removeListener(map, key, listener) };
	}
	
	protected _removeListener(
		map: Map<I | Midnight, ListenerConfig<I>[]> | { [key in EventType]?: ListenerConfig<I>[] },
		key: EventType | I | Midnight,
		listener?: Listener<I>
	): void {
		
		const listeners: ListenerConfig<I>[] | undefined = map instanceof Map ? map.get(key as I | Midnight) : map[key as EventType];
		
		if (listeners) {
			if (listener) {
				const index = listeners.findIndex(config => config.listener === listener);
				
				if (index !== -1)
					listeners.splice(index, 1);
			} else
				listeners.length = 0;
			
			if (!listeners.length)
				if (map instanceof Map)
					map.delete(key as I | Midnight);
				else
					delete map[key as EventType];
		}
		
	}
	
	protected abstract _getListeners(event: E): ListenerConfig<I>[] | undefined;
	
	protected _emit(...events: E[]): void {
		if (events.length === 0 || this.#eventProcessingActive)
			return;
		
		this.#eventProcessingActive = true;
		
		try {
			for (const event of events) {
				const listeners = this._getListeners(event);
				
				if (listeners && listeners.length > 0)
					for (let i = listeners.length - 1; i >= 0; i--) {
						const config = listeners[i];
						
						try {
							config.listener(event);
						} catch (error) {
							console.error("Timeline event listener error:", error);
						}
						
						if (config.once)
							listeners.splice(i, 1);
					}
			}
		} finally {
			this.#eventProcessingActive = false;
		}
		
	}
	
	protected _updateBounds(): void {
		
		const startAt = this._dateTree.min();
		const endAt = this._dateTree.max();
		
		if (startAt !== this.#startAt || endAt !== this.#endAt) {
			this.#startAt = startAt;
			this.#endAt = endAt;
			
			this._emit({ type: "bounds", startAt, endAt } as E);
		}
		
	}
	
	protected _cleanupStorageNode({ count, items }: StorageNode<I>): void {
		if (count < items.length)
			items.fill(undefined as any, count);
		
	}
	
	protected _clearBase(): void {
		
		this._storage.clear();
		this._itemListeners.clear();
		this._dateListeners.clear();
		this._dateTree.clear();
		this.#startAt = this.#endAt = null;
		this.#eventProcessingActive = false;
		
		if (this.#dateCache !== BaseTimeline.#globalDateCache)
			this.#dateCache.clear();
		
		if (this.#dateSetHoursCache !== BaseTimeline.#globalDateSetHoursCache)
			this.#dateSetHoursCache.clear();
		
	}
	
	/**
	 * Adds or updates an item in the timeline.
	 * @returns `true` if the item was added, `false` otherwise (e.g., if it was updated or had invalid date properties).
	 */
	abstract add(item: I): boolean;
	
	/**
	 * Efficiently adds or updates multiple items.
	 * @returns An object with counts of added, updated, and removed items.
	 */
	abstract addMany(items: Iterable<I>): BatchResult;
	
	/**
	 * An alias for `add`. Adds or updates an item.
	 * @returns `true` if the item was added, `false` if it was updated.
	 */
	abstract update(item: I): boolean;
	
	/**
	 * An alias for `addMany`. Efficiently adds or updates multiple items.
	 * @returns An object with counts of added, updated, and removed items.
	 */
	abstract updateMany(items: Iterable<I>): BatchResult;
	
	/**
	 * Checks if an item exists in the timeline.
	 * @returns `true` if the item exists, `false` otherwise.
	 */
	abstract has(item: I): boolean;
	
	/**
	 * Finds the first item in the timeline that satisfies the provided testing function.
	 * @param predicate A function to execute for each item. It should return `true` if the item is a match.
	 * @returns The first item that satisfies the predicate, or `undefined` if no such item is found.
	 */
	abstract find(predicate: (item: I) => boolean): I | undefined;
	
	/**
	 * Retrieves a Day object `{ at, items }` for a specific date.
	 * @param date The date to retrieve.
	 * @returns A Day object, or `null` if there are no items on that date.
	 * @throws {DateError} if the date is invalid.
	 */
	abstract getDay(date: RawDate): Day<I> | null;
	
	/**
	 * Deletes an item from the timeline.
	 * @returns `true` if the item was successfully deleted, `false` otherwise.
	 */
	abstract delete(item: I): boolean;
	
	/**
	 * Efficiently deletes multiple items from the timeline.
	 * @returns The number of items that were successfully deleted.
	 */
	abstract deleteMany(items: Iterable<I>): number;
	
	/**
	 * Removes all items from the timeline. If using local caches, they will be cleared as well.
	 */
	abstract clear(): void;
	
	/**
	 * Returns an iterator for traversing all items in the timeline.
	 */
	abstract [Symbol.iterator](): IterableIterator<I>;
	
	/**
	 * The earliest date (as a timestamp) in the timeline, or `null` if empty.
	 */
	get startAt(): Midnight | null {
		return this.#startAt;
	}
	
	/**
	 * The latest date (as a timestamp) in the timeline, or `null` if empty.
	 */
	get endAt(): Midnight | null {
		return this.#endAt;
	}
	
	/**
	 * The total number of days that contain items.
	 */
	get daysCount(): number {
		return this._dateTree.size;
	}
	
	/**
	 * Checks if the timeline is empty.
	 * @returns `true` if the timeline contains no items, `false` otherwise.
	 */
	isEmpty(): boolean {
		return this._dateTree.size === 0;
	}
	
	/**
	 * Finds the closest Day with items relative to a given date.
	 * @param date The date to search from.
	 * @param direction The direction to search: 'before', 'after', or 'either' (closest). Defaults to 'either'.
	 * @returns A Day object `{ at, items }` for the closest date, or `null` if the timeline is empty.
	 * @throws {DateError} if the date is invalid.
	 */
	getClosestDay(date: RawDate, direction: "after" | "before" | "either" = "either"): Day<I> | null {
		
		if (this.isEmpty())
			return null;
		
		const at = this._resolveTs(date);
		
		const existingNode = this._dateTree.find(at);
		
		let floorNode: ReturnType<typeof this._dateTree.find>;
		let ceilNode: ReturnType<typeof this._dateTree.find>;
		
		if (existingNode)
			floorNode = ceilNode = existingNode;
		else {
			this._dateTree.insert(at);
			
			const tempNode = this._dateTree.find(at)!;
			
			floorNode = this._dateTree.prev(tempNode);
			ceilNode = this._dateTree.next(tempNode);
			
			this._dateTree.remove(at);
		}
		
		let closestNode: typeof floorNode | null = null;
		
		switch (direction) {
			case "before":
				closestNode = floorNode;
				break;
			
			case "after":
				closestNode = ceilNode;
				break;
			
			case "either":
				if (floorNode && ceilNode)
					closestNode = (at - floorNode.key) <= (ceilNode.key - at) ? floorNode : ceilNode;
				else
					closestNode = floorNode ?? ceilNode;
				break;
		}
		
		if (!closestNode)
			return null;
		
		const dayStorage = this._storage.get(closestNode.key)!;
		
		return {
			at: closestNode.key,
			items: dayStorage.items.slice(0, dayStorage.count)
		};
	}
	
	/**
	 * Gets an array of all dates (as timestamps) that contain items, sorted chronologically.
	 */
	getDates(): Midnight[];
	
	/**
	 * Gets an array of dates (as timestamps) within a specified range, sorted chronologically.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	getDates(start: RawDate, end: RawDate): Midnight[];
	
	getDates(start?: RawDate, end?: RawDate): Midnight[] {
		if (start !== undefined && end !== undefined) {
			const startAt = this._resolveTs(start);
			const endAt = this._resolveTs(end);
			
			if (startAt > endAt)
				return [] as Midnight[];
			
			return [ ...this._rangeKeys(startAt, endAt) ];
		}
		
		return this._dateTree.keys();
	}
	
	/**
	 * Returns an iterator for `[date, items]` pairs.
	 * @param sorted If `true`, entries will be sorted by date. Defaults to `false` for better performance.
	 */
	*entries(sorted = false): IterableIterator<[Midnight, I[]]> {
		for (const at of sorted ? this._dateTree.keys() : this._storage.keys()) {
			const storage = this._storage.get(at)!;
			
			yield [ at, storage.items.slice(0, storage.count) ];
		}
	}
	
	
	static #globalDateCache = new Map<number | string, Midnight>();
	static #globalDateSetHoursCache = new Map<number, number>();
	static #globalDateCacheLimit = 1000;
	static #globalDateSetHoursCacheLimit = 500;
	
	/**
	 * Configures the global caches used by all timeline instances by default.
	 * @param options New limits and/or a flag to clear the caches.
	 */
	static configGlobalCache(options: CacheOptions & { clear?: boolean }): void {
		if (options.dateCacheLimit !== undefined)
			this.#globalDateCacheLimit = options.dateCacheLimit;
		
		if (options.dateSetHoursCacheLimit !== undefined)
			this.#globalDateSetHoursCacheLimit = options.dateSetHoursCacheLimit;
		
		if (options.clear) {
			this.#globalDateCache.clear();
			this.#globalDateSetHoursCache.clear();
		}
		
	}
	
}
