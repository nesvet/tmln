import { AVLTree } from "avl";
import type {
	BatchResult,
	CacheOptions,
	EventType,
	Item,
	Listener,
	ListenerConfig,
	Midnight,
	RangeTimelineEvent,
	RawDate,
	StorageNode,
	Subscription,
	TimelineEvent,
	TimelineOptions
} from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any, no-bitwise */


export const EMPTY_ARRAY: any[] = [];
export const tempEventBuffer: any[] = [];
export const tempItemBuffer: any[] = [];

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
	
	protected _storage = new Map<Midnight, StorageNode<I>>();
	protected _dateTree = new AVLTree<Midnight>((a, b) => a - b);
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
	
	protected *_rangeKeys(startKey: Midnight, endKey: Midnight): IterableIterator<Midnight> {
		if (startKey > endKey)
			return;
		
		tempItemBuffer.length = 0;
		
		this._dateTree.range(startKey, endKey, node => { tempItemBuffer.push(node.key); });
		
		yield* tempItemBuffer;
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
	 * Gets an array of all dates (as timestamps) that contain items, sorted chronologically.
	 */
	getDays(): Midnight[];
	
	/**
	 * Gets an array of dates (as timestamps) within a specified range, sorted chronologically.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	getDays(start: RawDate, end: RawDate): Midnight[];
	
	getDays(start?: RawDate, end?: RawDate): Midnight[] {
		if (start !== undefined && end !== undefined) {
			const startAt = this._resolveTs(start);
			const endAt = this._resolveTs(end);
			
			if (startAt > endAt)
				return EMPTY_ARRAY as Midnight[];
			
			tempItemBuffer.length = 0;
			
			this._dateTree.range(startAt, endAt, node => { tempItemBuffer.push(node.key); });
			
			return tempItemBuffer.slice();
		}
		
		return Array.from(this._dateTree.keys());
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
