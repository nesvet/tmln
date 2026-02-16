import {
	BaseTimeline,
	EMPTY_ARRAY,
	ONE_DAY,
	tempEventBuffer
} from "./BaseTimeline";
import type {
	BatchResult,
	BoundsChangeEvent,
	DateChangeEvent,
	Day,
	DayOptions,
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


/* eslint-disable @typescript-eslint/no-explicit-any */


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
		if (!item || item[this.#atPropName] === undefined)
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
		
		const addMap = new Map<Midnight, I[]>();
		const removeMap = new Map<Midnight, I[]>();
		
		let added = 0;
		let updated = 0;
		let removed = 0;
		
		for (const item of items) {
			if (!item || item[this.#atPropName] === undefined)
				continue;
			
			const at = this._toTs(item[this.#atPropName] as RawDate);
			const existingIndex = this.#itemIndexMap.get(item);
			
			const prevAt = existingIndex === undefined ? null : this.#itemDateArray[existingIndex][1];
			
			if (at === null) {
				if (prevAt !== null) {
					removeMap.get(prevAt)?.push(item) ??
					removeMap.set(prevAt, [ item ]);
					
					const lastItemIndex = this.#itemDateArray.length - 1;
					
					if (existingIndex !== lastItemIndex) {
						const lastItem = this.#itemDateArray[lastItemIndex];
						
						this.#itemDateArray[existingIndex!] = lastItem;
						this.#itemIndexMap.set(lastItem[0], existingIndex!);
					}
					
					this.#itemDateArray.pop();
					this.#itemIndexMap.delete(item);
					this._itemListeners.delete(item);
					
					removed++;
					tempEventBuffer.push({ type: "item", item, at: prevAt, prevAt });
				}
				
				continue;
			}
			
			if (prevAt === at)
				continue;
			
			if (prevAt === null) {
				addMap.get(at)?.push(item) ??
				addMap.set(at, [ item ]);
				
				const newIndex = this.#itemDateArray.length;
				
				this.#itemDateArray.push([ item, at ]);
				this.#itemIndexMap.set(item, newIndex);
				
				added++;
			} else {
				removeMap.get(prevAt)?.push(item) ??
				removeMap.set(prevAt, [ item ]);
				
				addMap.get(at)?.push(item) ??
				addMap.set(at, [ item ]);
				
				this.#itemDateArray[existingIndex!][1] = at;
				
				updated++;
			}
			
			tempEventBuffer.push({ type: "item", item, at, prevAt });
		}
		
		if (added === 0 && updated === 0 && removed === 0)
			return { added, updated, removed };
		
		const allAffectedDates = new Set([ ...addMap.keys(), ...removeMap.keys() ]);
		
		for (const at of allAffectedDates) {
			let dayStorage = this._storage.get(at);
			const toRemove = removeMap.get(at);
			
			if (dayStorage && toRemove) {
				const toRemoveSet = new Set(toRemove);
				let writeIndex = 0;
				
				for (let readIndex = 0; readIndex < dayStorage.count; readIndex++)
					if (!toRemoveSet.has(dayStorage.items[readIndex])) {
						if (writeIndex !== readIndex)
							dayStorage.items[writeIndex] = dayStorage.items[readIndex];
						
						writeIndex++;
					}
				
				dayStorage.count = writeIndex;
			}
			
			const toAdd = addMap.get(at);
			
			if (toAdd) {
				if (!dayStorage) {
					dayStorage = { items: [], count: 0 };
					
					this._storage.set(at, dayStorage);
					this._dateTree.insert(at);
				}
				
				for (const item of toAdd) {
					if (dayStorage.count >= dayStorage.items.length)
						dayStorage.items.length = Math.max(dayStorage.items.length << 1, 8);
					
					dayStorage.items[dayStorage.count++] = item;
				}
			}
			
			if (dayStorage) {
				if (dayStorage.count === 0) {
					this._storage.delete(at);
					this._dateTree.remove(at);
					this._dateListeners.delete(at);
				} else
					this._cleanupStorageNode(dayStorage);
				
				tempEventBuffer.push({ type: "date", at });
			}
		}
		
		this._updateBounds();
		this._emit(...tempEventBuffer);
		
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
	 * Finds the first item in the timeline that satisfies the provided testing function.
	 * @param predicate A function to execute for each item. It should return `true` if the item is a match.
	 * @returns The first item that satisfies the predicate, or `undefined` if no such item is found.
	 */
	find(predicate: (item: I) => boolean): I | undefined {
		
		for (let i = 0; i < this.#itemDateArray.length; i++) {
			const [ item ] = this.#itemDateArray[i];
			
			if (predicate(item))
				return item;
		}
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
				return [];
			
			const items = dayStorage.items.slice(0, dayStorage.count);
			
			if (sorted && items.length > 1)
				items.sort((a, b) => this.#itemDateArray[this.#itemIndexMap.get(a)!][1] - this.#itemDateArray[this.#itemIndexMap.get(b)!][1]);
			
			return items.slice(offset, offset + limit);
		}
		
		const startAt = this._resolveTs(start);
		const endAt = this._resolveTs(end);
		
		if (startAt > endAt)
			return [];
		
		const result: I[] = [];
		let skipped = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (result.length >= limit)
				break;
			
			const { items, count } = this._storage.get(at)!;
			
			for (let i = 0; i < count; i++) {
				if (skipped < offset) {
					skipped++;
					
					continue;
				}
				
				if (result.length >= limit)
					break;
				
				result.push(items[i]);
			}
		}
		
		if (sorted && result.length > 1)
			result.sort((a, b) => this.#itemDateArray[this.#itemIndexMap.get(a)!][1] - this.#itemDateArray[this.#itemIndexMap.get(b)!][1]);
		
		return result;
	}
	
	/**
	 * Gets an array of all items in the timeline.
	 * Note: The order is not guaranteed.
	 */
	getAll(): I[] {
		return this.#itemDateArray.map(([ item ]) => item);
	}
	
	/**
	 * Retrieves a Day object `{ at, items }` for a specific date.
	 * @param date The date to retrieve.
	 * @returns A Day object, or `null` if there are no items on that date.
	 * @throws {DateError} if the date is invalid.
	 */
	getDay(date: RawDate): Day<I> | null {
		const at = this._resolveTs(date);
		
		const dayStorage = this._storage.get(at);
		
		if (!dayStorage || dayStorage.count === 0)
			return null;
		
		return {
			at,
			items: dayStorage.items.slice(0, dayStorage.count)
		};
	}
	
	/**
	 * Retrieves all Day objects that contain items for a specific date.
	 * @param start The date to retrieve.
	 * @param options Configuration for the retrieval.
	 * @returns An array of Day objects.
	 * @throws {DateError} if the date is invalid.
	 */
	getDays(start: RawDate, options?: DayOptions): Day<I>[];
	
	/**
	 * Retrieves all Day objects that contain items within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for the retrieval.
	 * @returns An array of Day objects.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	getDays(start: RawDate, end: RawDate, options?: DayOptions): Day<I>[];
	
	getDays(start: RawDate, endOrOptions?: DayOptions | RawDate, options?: DayOptions): Day<I>[] {
		const { end, includeEmpty, limit, offset } = this._parseDayArgs(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return [];
		
		const { startAt, endAt } = range;
		
		if (includeEmpty)
			return this.#getDaysWithEmpty(startAt, endAt, limit, offset);
		
		return this.#getDaysExistingOnly(startAt, endAt, limit, offset);
	}
	
	#getDaysWithEmpty(startAt: Midnight, endAt: Midnight, limit: number, offset: number): Day<I>[] {
		const existingDates = this._collectExistingDates(startAt, endAt);
		const { actualLimit } = this._calculateDayLimits(startAt, endAt, limit, offset);
		
		if (actualLimit <= 0)
			return [];
		
		const result: Day<I>[] = Array.from({ length: actualLimit });
		
		let existingIndex = 0;
		let resultIndex = 0;
		let skipCount = 0;
		
		for (let currentAt = startAt; currentAt <= endAt && resultIndex < actualLimit; currentAt += ONE_DAY) {
			if (skipCount < offset) {
				skipCount++;
				
				while (existingIndex < existingDates.length && existingDates[existingIndex] < currentAt)
					existingIndex++;
				
				continue;
			}
			
			if (existingIndex < existingDates.length && existingDates[existingIndex] === currentAt) {
				const dayStorage = this._storage.get(currentAt)!;
				
				result[resultIndex] = {
					at: currentAt,
					items: dayStorage.items.slice(0, dayStorage.count)
				};
				
				existingIndex++;
			} else
				result[resultIndex] = { at: currentAt, items: [] };
			
			resultIndex++;
		}
		
		if (resultIndex < result.length)
			result.length = resultIndex;
		
		return result;
	}
	
	#getDaysExistingOnly(startAt: Midnight, endAt: Midnight, limit: number, offset: number): Day<I>[] {
		
		const result: Day<I>[] = [];
		let skippedCount = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (result.length >= limit)
				break;
			
			if (skippedCount < offset) {
				skippedCount++;
				
				continue;
			}
			
			const dayStorage = this._storage.get(at)!;
			
			result.push({
				at,
				items: dayStorage.items.slice(0, dayStorage.count)
			});
		}
		
		return result;
	}
	
	/**
	 * Returns a memory-efficient iterator for Day objects on a specific date.
	 * @param start The date to retrieve.
	 * @param options Configuration for the retrieval.
	 * @returns An iterator for Day objects.
	 * @throws {DateError} if the date is invalid.
	 */
	iterateDays(start: RawDate, options?: DayOptions): IterableIterator<Day<I>>;
	
	/**
	 * Returns a memory-efficient iterator for Day objects within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for the retrieval.
	 * @returns An iterator for Day objects.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	iterateDays(start: RawDate, end: RawDate, options?: DayOptions): IterableIterator<Day<I>>;
	
	*iterateDays(start: RawDate, endOrOptions?: DayOptions | RawDate, options?: DayOptions): IterableIterator<Day<I>> {
		const { end, includeEmpty, limit, offset } = this._parseDayArgs(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return;
		
		const { startAt, endAt } = range;
		
		yield* includeEmpty ?
			this.#iterateDaysWithEmpty(startAt, endAt, limit, offset) :
			this.#iterateDaysExistingOnly(startAt, endAt, limit, offset);
	}
	
	*#iterateDaysWithEmpty(startAt: Midnight, endAt: Midnight, limit: number, offset: number): IterableIterator<Day<I>> {
		const existingDates = this._collectExistingDates(startAt, endAt);
		
		let existingIndex = 0;
		let yieldedCount = 0;
		let skipCount = 0;
		
		for (let currentAt = startAt; currentAt <= endAt && yieldedCount < limit; currentAt += ONE_DAY) {
			if (skipCount < offset) {
				skipCount++;
				
				while (existingIndex < existingDates.length && existingDates[existingIndex] < currentAt)
					existingIndex++;
				
				continue;
			}
			
			if (existingIndex < existingDates.length && existingDates[existingIndex] === currentAt) {
				const dayStorage = this._storage.get(currentAt)!;
				
				yield {
					at: currentAt,
					items: dayStorage.items.slice(0, dayStorage.count)
				};
				
				existingIndex++;
			} else
				yield { at: currentAt, items: [] };
			
			yieldedCount++;
		}
		
	}
	
	*#iterateDaysExistingOnly(startAt: Midnight, endAt: Midnight, limit: number, offset: number): IterableIterator<Day<I>> {
		
		let yieldedCount = 0;
		let skipCount = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (skipCount < offset) {
				skipCount++;
				
				continue;
			}
			
			if (yieldedCount >= limit)
				break;
			
			const dayStorage = this._storage.get(at)!;
			
			yield {
				at,
				items: dayStorage.items.slice(0, dayStorage.count)
			};
			
			yieldedCount++;
		}
		
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
