import {
	BaseTimeline,
	EMPTY_ARRAY,
	tempEventBuffer,
	tempItemBuffer
} from "./BaseTimeline";
import type {
	BatchResult,
	BoundsChangeEvent,
	DateChangeEvent,
	EventType,
	GetOptions,
	Item,
	ItemChangeEvent,
	Listener,
	ListenerConfig,
	Midnight,
	RawDate,
	Subscription,
	TimelineEvent,
	TimelineOptions
} from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any, no-bitwise */


export class Timeline<I extends Item = Item> extends BaseTimeline<I, TimelineEvent<I>> {
	
	/**
	 * Creates an instance of Timeline.
	 * @param atPropName The property name on item objects that holds the date.
	 * @param items An optional initial collection of items to add.
	 * @param options Optional settings for cache behavior.
	 */
	constructor(atPropName: string = "at", items?: Iterable<I>, options?: TimelineOptions) {
		super(options);
		
		this.#atPropName = atPropName;
		
		if (items)
			this.addMany(items);
		
	}
	
	#atPropName: string;
	#itemDateArray: [I, Midnight][] = [];
	#itemIndexMap = new Map<I, number>();
	
	protected _getListeners(event: TimelineEvent<I>): ListenerConfig<I>[] | undefined {
		switch (event.type) {
			case "date":
				return this._dateListeners.get(event.at);
			case "item":
				return this._itemListeners.get(event.item);
			default:
				return this._listeners[event.type];
		}
	}
	
	#addItem(item: I, at: Midnight): { isAdded: boolean; isUpdated: boolean; events: TimelineEvent<I>[] } {
		const existingIndex = this.#itemIndexMap.get(item);
		
		const prevAt = existingIndex === undefined ? null : this.#itemDateArray[existingIndex][1];
		
		tempEventBuffer.length = 0;
		
		if (prevAt === at)
			return { isAdded: false, isUpdated: false, events: EMPTY_ARRAY as TimelineEvent<I>[] };
		
		let isAdded = false;
		let isUpdated = false;
		
		if (prevAt === null) {
			isAdded = true;
			
			const newIndex = this.#itemDateArray.length;
			
			this.#itemDateArray.push([ item, at ]);
			this.#itemIndexMap.set(item, newIndex);
		} else {
			isUpdated = true;
			
			const prevDayStorage = this._storage.get(prevAt)!;
			
			const itemIndex = prevDayStorage.items.indexOf(item);
			
			if (itemIndex !== -1) {
				const lastIndex = prevDayStorage.count - 1;
				
				if (itemIndex !== lastIndex)
					prevDayStorage.items[itemIndex] = prevDayStorage.items[lastIndex];
				
				prevDayStorage.items[lastIndex] = undefined as any;
				prevDayStorage.count--;
				
				tempEventBuffer.push({ type: "date", at: prevAt });
				
				if (prevDayStorage.count === 0) {
					this._storage.delete(prevAt);
					this._dateTree.remove(prevAt);
					this._dateListeners.delete(prevAt);
				} else
					this._cleanupStorageNode(prevDayStorage);
			}
			
			this.#itemDateArray[existingIndex!][1] = at;
		}
		
		let dayStorage = this._storage.get(at);
		
		if (!dayStorage) {
			dayStorage = { items: [], count: 0 };
			
			this._storage.set(at, dayStorage);
			this._dateTree.insert(at);
		}
		
		if (dayStorage.count >= dayStorage.items.length)
			dayStorage.items.length = Math.max(dayStorage.items.length << 1, 8);
		
		dayStorage.items[dayStorage.count++] = item;
		
		tempEventBuffer.push({ type: "date", at }, { type: "item", item, at, prevAt });
		
		return { isAdded, isUpdated, events: tempEventBuffer.slice() };
	}
	
	#removeItem(item: I): { isRemoved: boolean; events: TimelineEvent<I>[] } {
		const index = this.#itemIndexMap.get(item);
		
		if (index === undefined)
			return { isRemoved: false, events: EMPTY_ARRAY as TimelineEvent<I>[] };
		
		const [ , at ] = this.#itemDateArray[index];
		
		const dayStorage = this._storage.get(at)!;
		
		tempEventBuffer.length = 0;
		
		const itemIndex = dayStorage.items.indexOf(item);
		
		if (itemIndex === -1)
			return { isRemoved: false, events: EMPTY_ARRAY as TimelineEvent<I>[] };
		
		const lastIndex = dayStorage.count - 1;
		
		if (itemIndex !== lastIndex)
			dayStorage.items[itemIndex] = dayStorage.items[lastIndex];
		
		dayStorage.items[lastIndex] = undefined as any;
		dayStorage.count--;
		
		tempEventBuffer.push({ type: "date", at });
		
		const lastItemIndex = this.#itemDateArray.length - 1;
		
		if (index !== lastItemIndex) {
			const lastItem = this.#itemDateArray[lastItemIndex];
			
			this.#itemDateArray[index] = lastItem;
			this.#itemIndexMap.set(lastItem[0], index);
		}
		
		this.#itemDateArray.pop();
		this.#itemIndexMap.delete(item);
		this._itemListeners.delete(item);
		
		if (dayStorage.count === 0) {
			this._storage.delete(at);
			this._dateListeners.delete(at);
			this._dateTree.remove(at);
		} else
			this._cleanupStorageNode(dayStorage);
		
		tempEventBuffer.push({ type: "item", item, at, prevAt: at });
		
		return { isRemoved: true, events: tempEventBuffer.slice() };
	}
	
	/**
	 * Adds or updates an item in the timeline based on its date property.
	 * If an item's date property becomes invalid, it will be removed.
	 * @returns `true` if the item was newly added, `false` if it was updated or not added.
	 */
	add(item: I): boolean {
		if (!item || !Object.hasOwn(item, this.#atPropName))
			return false;
		
		const at = this._toTs(item[this.#atPropName] as RawDate);
		
		if (at === null) {
			if (this.has(item)) {
				const { isRemoved, events } = this.#removeItem(item);
				
				if (isRemoved) {
					this._updateBounds();
					this._emit(...events);
				}
			}
			
			return false;
		}
		
		const { isAdded, events } = this.#addItem(item, at);
		
		if (events.length > 0) {
			this._updateBounds();
			this._emit(...events);
		}
		
		return isAdded;
	}
	
	/**
	 * Efficiently adds or updates multiple items. This method performs one collective update
	 * and event emission after processing all items, making it much faster than calling `add` in a loop.
	 * @returns An object with counts of added, updated, and removed items.
	 */
	addMany(items: Iterable<I>): BatchResult {
		
		tempEventBuffer.length = 0;
		
		let added = 0;
		let updated = 0;
		let removed = 0;
		
		for (const item of items) {
			if (!item || !Object.hasOwn(item, this.#atPropName))
				continue;
			
			const at = this._toTs(item[this.#atPropName] as RawDate);
			
			if (at === null) {
				if (this.has(item)) {
					const { isRemoved, events } = this.#removeItem(item);
					
					if (isRemoved) {
						removed++;
						tempEventBuffer.push(...events);
					}
				}
				
				continue;
			}
			
			const { isAdded, isUpdated, events } = this.#addItem(item, at);
			
			if (isAdded)
				added++;
			else if (isUpdated)
				updated++;
			
			tempEventBuffer.push(...events);
		}
		
		if (tempEventBuffer.length > 0) {
			this._updateBounds();
			this._emit(...tempEventBuffer);
		}
		
		return { added, updated, removed };
	}
	
	/**
	 * An alias for `add`. Adds or updates an item.
	 * @returns `true` if the item was added, `false` if it was updated.
	 */
	update = this.add;
	
	/**
	 * An alias for `addMany`. Efficiently adds or updates multiple items.
	 * @returns An object with counts of added, updated, and removed items.
	 */
	updateMany = this.addMany;
	
	/**
	 * Checks if an item exists in the timeline.
	 * @returns `true` if the item exists, `false` otherwise.
	 */
	has(item: I): boolean {
		return this.#itemIndexMap.has(item);
	}
	
	/**
	 * Gets all items for a specific date.
	 * @throws {DateError} if the date is invalid.
	 */
	get(date: RawDate, options?: GetOptions): I[];
	
	/**
	 * Gets all items within a date range.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	get(start: RawDate, end: RawDate, options?: GetOptions): I[];
	
	get(start: RawDate, end?: GetOptions | RawDate, options?: GetOptions): I[] {
		if (typeof end === "object" && !(end instanceof Date)) {
			options = end;
			end = undefined;
		}
		
		const { limit = Infinity, offset = 0, sorted = false } = options ?? {};
		
		if (end === undefined) {
			const at = this._resolveTs(start);
			
			const dayStorage = this._storage.get(at);
			
			if (!dayStorage || dayStorage.count === 0)
				return EMPTY_ARRAY as I[];
			
			const items = dayStorage.items.slice(0, dayStorage.count);
			
			if (sorted && items.length > 1)
				items.sort((a, b) => this.#itemDateArray[this.#itemIndexMap.get(a)!][1] - this.#itemDateArray[this.#itemIndexMap.get(b)!][1]);
			
			return items.slice(offset, offset + limit);
		}
		
		const startAt = this._resolveTs(start);
		const endAt = this._resolveTs(end);
		
		if (startAt > endAt)
			return EMPTY_ARRAY as I[];
		
		tempItemBuffer.length = 0;
		
		let skipped = 0;
		
		this._dateTree.range(startAt, endAt, node => {
			
			if (tempItemBuffer.length >= limit)
				return false;
			
			const { items, count } = this._storage.get(node.key)!;
			
			for (let i = 0; i < count; i++) {
				if (skipped < offset) {
					skipped++;
					
					continue;
				}
				
				if (tempItemBuffer.length >= limit)
					break;
				
				tempItemBuffer.push(items[i]);
			}
			
			return tempItemBuffer.length < limit;
		});
		
		if (sorted && tempItemBuffer.length > 1)
			tempItemBuffer.sort((a, b) => this.#itemDateArray[this.#itemIndexMap.get(a)!][1] - this.#itemDateArray[this.#itemIndexMap.get(b)!][1]);
		
		return tempItemBuffer.slice();
	}
	
	/**
	 * Gets an array of all items in the timeline.
	 * Note: The order is not guaranteed.
	 */
	getAll(): I[] {
		return this.#itemDateArray.map(([ item ]) => item);
	}
	
	/**
	 * Returns an iterator for all items on a specific date.
	 * @throws {DateError} if the date is invalid.
	 */
	iterate(date: RawDate): IterableIterator<I>;
	
	/**
	 * Returns an iterator for all items within a date range.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	iterate(start: RawDate, end: RawDate): IterableIterator<I>;
	
	*iterate(start: RawDate, end?: RawDate): IterableIterator<I> {
		if (end === undefined) {
			const at = this._resolveTs(start);
			
			const dayStorage = this._storage.get(at);
			
			if (dayStorage)
				for (let i = 0, { items, count } = dayStorage; i < count; i++)
					yield items[i];
			
			return;
		}
		
		const startAt = this._resolveTs(start);
		const endAt = this._resolveTs(end);
		
		if (startAt > endAt)
			return;
		
		for (const at of this._rangeKeys(startAt, endAt))
			for (let i = 0, { items, count } = this._storage.get(at)!; i < count; i++)
				yield items[i];
	}
	
	/**
	 * Returns an iterator for traversing all items in the timeline.
	 * The order of items is not guaranteed.
	 */
	*[Symbol.iterator](): IterableIterator<I> {
		for (let i = 0; i < this.#itemDateArray.length; i++)
			yield this.#itemDateArray[i][0];
	}
	
	/**
	 * The total number of items in the timeline.
	 */
	get size(): number {
		return this.#itemDateArray.length;
	}
	
	/**
	 * Subscribes to timeline-wide boundary changes.
	 * @param eventType The type of event (`bounds`).
	 * @param listener The function to call when the event occurs.
	 * @param once If `true`, the listener will be automatically removed after the first call.
	 * @returns A subscription object with an `unsubscribe` method.
	 */
	on(eventType: "bounds", listener: Listener<BoundsChangeEvent>, once?: boolean): Subscription;
	
	/**
	 * Subscribes to changes for a specific date.
	 * @param eventType The type of event (`date`).
	 * @param date The date to listen for changes on.
	 * @param listener The function to call when the event occurs.
	 * @param once If `true`, the listener will be automatically removed after the first call.
	 * @returns A subscription object with an `unsubscribe` method.
	 * @throws {DateError} if the date is invalid.
	 */
	on(eventType: "date", date: RawDate, listener: Listener<DateChangeEvent>, once?: boolean): Subscription;
	
	/**
	 * Subscribes to changes for a specific item.
	 * @param eventType The type of event (`item`).
	 * @param item The item instance to listen for changes on.
	 * @param listener The function to call when the event occurs.
	 * @param once If `true`, the listener will be automatically removed after the first call.
	 * @returns A subscription object with an `unsubscribe` method.
	 */
	on(eventType: "item", item: I, listener: Listener<ItemChangeEvent<I>>, once?: boolean): Subscription;
	
	on(eventType: EventType, ...args: any[]): Subscription {
		const once = args.at(-1) === true;
		const listener = args[once ? args.length - 2 : args.length - 1] as Listener<I>;
		
		if (typeof listener !== "function")
			throw new TypeError("Listener must be a function");
		
		switch (eventType) {
			case "bounds":
				return this._addListener(this._listeners, eventType, listener, once);
			case "date": {
				const [ date ] = args;
				const at = this._resolveTs(date);
				
				return this._addListener(this._dateListeners, at, listener, once);
			}
			case "item":
				return this._addListener(this._itemListeners, args[0], listener, once);
			default:
				throw new TypeError(`Invalid event type: ${eventType as string}`);
		}
	}
	
	/**
	 * Subscribes to a single timeline-wide boundary change.
	 * @param eventType The type of event (`bounds`).
	 * @param listener The function to call when the event occurs.
	 * @returns A subscription object with an `unsubscribe` method.
	 */
	once(eventType: "bounds", listener: Listener<BoundsChangeEvent>): Subscription;
	
	/**
	 * Subscribes to a single change for a specific date.
	 * @param eventType The type of event (`date`).
	 * @param date The date to listen for changes on.
	 * @param listener The function to call when the event occurs.
	 * @returns A subscription object with an `unsubscribe` method.
	 * @throws {DateError} if the date is invalid.
	 */
	once(eventType: "date", date: RawDate, listener: Listener<DateChangeEvent>): Subscription;
	
	/**
	 * Subscribes to a single change for a specific item.
	 * @param eventType The type of event (`item`).
	 * @param item The item instance to listen for changes on.
	 * @param listener The function to call when the event occurs.
	 * @returns A subscription object with an `unsubscribe` method.
	 */
	once(eventType: "item", item: I, listener: Listener<ItemChangeEvent<I>>): Subscription;
	
	once(eventType: EventType, ...args: any[]): Subscription {
		return (this.on as any)(eventType, ...args, true);
	}
	
	/**
	 * Removes a listener for timeline-wide boundary changes.
	 * @param eventType The type of event (`bounds`).
	 * @param listener The specific listener to remove. If omitted, all listeners for this event are removed.
	 */
	off(eventType: "bounds", listener?: Listener<BoundsChangeEvent>): void;
	
	/**
	 * Removes a listener for a specific date.
	 * @param eventType The type of event (`date`).
	 * @param date The date to stop listening for changes on.
	 * @param listener The specific listener to remove. If omitted, all listeners for this date are removed.
	 * @throws {DateError} if the date is invalid.
	 */
	off(eventType: "date", date: RawDate, listener?: Listener<DateChangeEvent>): void;
	
	/**
	 * Removes a listener for a specific item.
	 * @param eventType The type of event (`item`).
	 * @param item The item instance to stop listening for changes on.
	 * @param listener The specific listener to remove. If omitted, all listeners for this item are removed.
	 */
	off(eventType: "item", item: I, listener?: Listener<ItemChangeEvent<I>>): void;
	
	off(eventType: EventType, ...args: any[]): void {
		const listener = args.at(-1) as Listener<I> | undefined;
		
		if (listener && typeof listener !== "function")
			throw new TypeError("Listener must be a function");
		
		switch (eventType) {
			case "bounds":
				this._removeListener(this._listeners, eventType, listener);
				break;
			case "date": {
				const [ date ] = args;
				
				const at = this._resolveTs(date);
				
				this._removeListener(this._dateListeners, at, listener);
				break;
			}
			case "item":
				this._removeListener(this._itemListeners, args[0], listener);
				break;
			default:
				throw new TypeError(`Invalid event type: ${eventType as string}`);
		}
	}
	
	/**
	 * Deletes an item from the timeline.
	 * @returns `true` if the item was successfully deleted, `false` otherwise.
	 */
	delete(item: I): boolean {
		const { isRemoved, events } = this.#removeItem(item);
		
		if (isRemoved) {
			this._updateBounds();
			this._emit(...events);
		}
		
		return isRemoved;
	}
	
	/**
	 * Efficiently deletes multiple items from the timeline.
	 * This method performs one update and event emission after all items are processed.
	 * @returns The number of items that were successfully deleted.
	 */
	deleteMany(items: Iterable<I>): number {
		
		tempEventBuffer.length = 0;
		
		let deletedCount = 0;
		
		for (const item of items) {
			const { isRemoved, events } = this.#removeItem(item);
			
			if (isRemoved) {
				deletedCount++;
				tempEventBuffer.push(...events);
			}
		}
		
		if (deletedCount > 0) {
			this._updateBounds();
			this._emit(...tempEventBuffer);
		}
		
		return deletedCount;
	}
	
	/**
	 * Removes all items from the timeline.
	 */
	clear(): void {
		
		if (this.size === 0)
			return;
		
		tempEventBuffer.length = 0;
		
		for (const at of this._storage.keys())
			tempEventBuffer.push({ type: "date", at });
		
		tempEventBuffer.push({ type: "bounds", startAt: null, endAt: null });
		
		this._clearBase();
		this.#itemDateArray.length = 0;
		this.#itemIndexMap.clear();
		
		this._emit(...tempEventBuffer);
		
	}
	
}
