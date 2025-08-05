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
	ItemRange,
	Listener,
	ListenerConfig,
	Midnight,
	RangeItemChangeEvent,
	RangeTimelineEvent,
	RawDate,
	Subscription,
	TimelineOptions
} from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any, no-bitwise */


const ONE_DAY = 86_400_000;


export class RangeTimeline<I extends Item = Item> extends BaseTimeline<I, RangeTimelineEvent<I>> {
	
	/**
	 * Creates an instance of RangeTimeline.
	 * @param startAtPropName The property name on item objects that holds the start date.
	 * @param endAtPropName The property name on item objects that holds the end date.
	 * @param items An optional initial collection of items to add.
	 * @param options Optional settings for cache behavior.
	 */
	constructor(startAtPropName: string = "startAt", endAtPropName: string = "endAt", items?: Iterable<I>, options?: TimelineOptions) {
		super(options);
		
		this.#startAtPropName = startAtPropName;
		this.#endDatePropName = endAtPropName;
		
		if (items)
			this.addMany(items);
		
	}
	
	#startAtPropName: string;
	#endDatePropName: string;
	#itemRangeArray: [I, ItemRange][] = [];
	#itemIndexMap = new Map<I, number>();
	
	protected _getListeners(event: RangeTimelineEvent<I>): ListenerConfig<I>[] | undefined {
		switch (event.type) {
			case "date":
				return this._dateListeners.get(event.at);
			case "item":
				return this._itemListeners.get(event.item);
			default:
				return this._listeners[event.type];
		}
	}
	
	#addItem(item: I, startAt: Midnight, endAt: Midnight): { isAdded: boolean; isUpdated: boolean; events: RangeTimelineEvent<I>[] } {
		if (startAt > endAt)
			[ startAt, endAt ] = [ endAt, startAt ];
		
		const existingIndex = this.#itemIndexMap.get(item);
		
		const prevRange = existingIndex === undefined ? null : this.#itemRangeArray[existingIndex][1];
		
		tempEventBuffer.length = 0;
		
		if (prevRange && prevRange.startAt === startAt && prevRange.endAt === endAt)
			return { isAdded: false, isUpdated: false, events: EMPTY_ARRAY as RangeTimelineEvent<I>[] };
		
		let isAdded = false;
		let isUpdated = false;
		
		if (prevRange) {
			isUpdated = true;
			
			for (const at of this.#generateDayRange(prevRange.startAt, prevRange.endAt)) {
				if (at >= startAt && at <= endAt)
					continue;
				
				const dayStorage = this._storage.get(at)!;
				
				const itemIndex = dayStorage.items.indexOf(item);
				
				if (itemIndex !== -1) {
					const lastIndex = dayStorage.count - 1;
					
					if (itemIndex !== lastIndex)
						dayStorage.items[itemIndex] = dayStorage.items[lastIndex];
					
					dayStorage.items[lastIndex] = undefined as any;
					dayStorage.count--;
					
					tempEventBuffer.push({ type: "date", at });
				}
				
				if (dayStorage.count === 0) {
					this._storage.delete(at);
					this._dateTree.remove(at);
					this._dateListeners.delete(at);
				} else
					this._cleanupStorageNode(dayStorage);
			}
			
			for (const at of this.#generateDayRange(startAt, endAt)) {
				if (at >= prevRange.startAt && at <= prevRange.endAt)
					continue;
				
				let dayStorage = this._storage.get(at);
				
				if (!dayStorage) {
					dayStorage = { items: [], count: 0 };
					
					this._storage.set(at, dayStorage);
					this._dateTree.insert(at);
				}
				
				if (dayStorage.count >= dayStorage.items.length)
					dayStorage.items.length = Math.max(dayStorage.items.length << 1, 8);
				
				dayStorage.items[dayStorage.count++] = item;
				
				tempEventBuffer.push({ type: "date", at });
			}
			
			this.#itemRangeArray[existingIndex!][1] = { startAt, endAt };
		} else {
			isAdded = true;
			
			const newIndex = this.#itemRangeArray.length;
			
			this.#itemRangeArray.push([ item, { startAt, endAt } ]);
			
			this.#itemIndexMap.set(item, newIndex);
			
			for (const at of this.#generateDayRange(startAt, endAt)) {
				let dayStorage = this._storage.get(at);
				
				if (!dayStorage) {
					dayStorage = { items: [], count: 0 };
					
					this._storage.set(at, dayStorage);
					this._dateTree.insert(at);
				}
				
				if (dayStorage.count >= dayStorage.items.length)
					dayStorage.items.length = Math.max(dayStorage.items.length << 1, 8);
				
				dayStorage.items[dayStorage.count++] = item;
				
				tempEventBuffer.push({ type: "date", at });
			}
		}
		
		tempEventBuffer.push({ type: "item", item, startAt, endAt, prevStartAt: prevRange?.startAt ?? null, prevEndAt: prevRange?.endAt ?? null });
		
		return { isAdded, isUpdated, events: tempEventBuffer.slice() };
	}
	
	#removeItem(item: I): { isRemoved: boolean; events: RangeTimelineEvent<I>[] } {
		const index = this.#itemIndexMap.get(item);
		
		if (index === undefined)
			return { isRemoved: false, events: EMPTY_ARRAY as RangeTimelineEvent<I>[] };
		
		const [ , range ] = this.#itemRangeArray[index];
		
		tempEventBuffer.length = 0;
		
		let isDeleted = false;
		
		for (const at of this._rangeKeys(range.startAt, range.endAt)) {
			const dayStorage = this._storage.get(at)!;
			
			const itemIndex = dayStorage.items.indexOf(item);
			
			if (itemIndex !== -1) {
				const lastIndex = dayStorage.count - 1;
				
				if (itemIndex !== lastIndex)
					dayStorage.items[itemIndex] = dayStorage.items[lastIndex];
				
				dayStorage.items[lastIndex] = undefined as any;
				dayStorage.count--;
				
				isDeleted = true;
				
				tempEventBuffer.push({ type: "date", at });
			}
			
			if (dayStorage.count === 0) {
				this._storage.delete(at);
				this._dateListeners.delete(at);
				this._dateTree.remove(at);
			} else
				this._cleanupStorageNode(dayStorage);
		}
		
		if (isDeleted) {
			const lastItemIndex = this.#itemRangeArray.length - 1;
			
			if (index !== lastItemIndex) {
				const lastItem = this.#itemRangeArray[lastItemIndex];
				
				this.#itemRangeArray[index] = lastItem;
				this.#itemIndexMap.set(lastItem[0], index);
			}
			
			this.#itemRangeArray.pop();
			this.#itemIndexMap.delete(item);
			this._itemListeners.delete(item);
			
			tempEventBuffer.push({ type: "item", item, startAt: range.startAt, endAt: range.endAt, prevStartAt: range.startAt, prevEndAt: range.endAt });
		}
		
		return { isRemoved: isDeleted, events: tempEventBuffer.slice() };
	}
	
	*#generateDayRange(startAt: Midnight, endAt: Midnight): IterableIterator<Midnight> {
		for (let at = startAt; at <= endAt; at += ONE_DAY)
			yield at;
	}
	
	/**
	 * Adds or updates an item in the timeline based on its start and end date properties.
	 * If an item's date properties become invalid, it will be removed.
	 * @returns `true` if the item was newly added, `false` if it was updated or not added.
	 */
	add(item: I): boolean {
		if (!item || !Object.hasOwn(item, this.#startAtPropName) || !Object.hasOwn(item, this.#endDatePropName))
			return false;
		
		const startAt = this._toTs(item[this.#startAtPropName] as RawDate);
		const endAt = this._toTs(item[this.#endDatePropName] as RawDate);
		
		if (startAt === null || endAt === null) {
			if (this.has(item)) {
				const { isRemoved, events } = this.#removeItem(item);
				
				if (isRemoved) {
					this._updateBounds();
					this._emit(...events);
				}
			}
			
			return false;
		}
		
		const { isAdded, events } = this.#addItem(item, startAt, endAt);
		
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
		
		const addMap = new Map<Midnight, I[]>();
		const removeMap = new Map<Midnight, I[]>();
		
		tempEventBuffer.length = 0;
		
		let added = 0;
		let updated = 0;
		let removed = 0;
		
		for (const item of items) {
			if (!item || !Object.hasOwn(item, this.#startAtPropName) || !Object.hasOwn(item, this.#endDatePropName))
				continue;
			
			let startAt = this._toTs(item[this.#startAtPropName] as RawDate);
			let endAt = this._toTs(item[this.#endDatePropName] as RawDate);
			
			const existingIndex = this.#itemIndexMap.get(item);
			
			const prevRange = existingIndex === undefined ? null : this.#itemRangeArray[existingIndex][1];
			
			if (!prevRange) {
				if (startAt === null || endAt === null)
					continue;
				
				if (startAt > endAt)
					[ startAt, endAt ] = [ endAt, startAt ];
				
				for (let at = startAt; at <= endAt; at += ONE_DAY)
					addMap.get(at)?.push(item) ??
					addMap.set(at, [ item ]);
				
				const newIndex = this.#itemRangeArray.length;
				
				this.#itemRangeArray.push([ item, { startAt, endAt } ]);
				
				this.#itemIndexMap.set(item, newIndex);
				
				added++;
				
				tempEventBuffer.push({ type: "item", item, startAt, endAt, prevStartAt: null, prevEndAt: null });
			} else
				if (startAt === null || endAt === null) {
					for (let at = prevRange.startAt; at <= prevRange.endAt; at += ONE_DAY)
						removeMap.get(at)?.push(item) ??
						removeMap.set(at, [ item ]);
					
					const lastItemIndex = this.#itemRangeArray.length - 1;
					
					if (existingIndex !== lastItemIndex) {
						const lastItem = this.#itemRangeArray[lastItemIndex];
						
						this.#itemRangeArray[existingIndex!] = lastItem;
						
						this.#itemIndexMap.set(lastItem[0], existingIndex!);
					}
					
					this.#itemRangeArray.pop();
					this.#itemIndexMap.delete(item);
					this._itemListeners.delete(item);
					
					removed++;
				} else {
					if (startAt > endAt)
						[ startAt, endAt ] = [ endAt, startAt ];
					
					if (prevRange.startAt === startAt && prevRange.endAt === endAt)
						continue;
					
					for (let at = prevRange.startAt; at <= prevRange.endAt; at += ONE_DAY)
						if (at < startAt || at > endAt)
							removeMap.get(at)?.push(item) ??
							removeMap.set(at, [ item ]);
					
					for (let at = startAt; at <= endAt; at += ONE_DAY)
						if (at < prevRange.startAt || at > prevRange.endAt)
							addMap.get(at)?.push(item) ??
							addMap.set(at, [ item ]);
					
					this.#itemRangeArray[existingIndex!][1] = { startAt, endAt };
					
					updated++;
					
					tempEventBuffer.push({ type: "item", item, startAt, endAt, prevStartAt: prevRange.startAt, prevEndAt: prevRange.endAt });
				}
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
				if (!dayStorage || dayStorage.count === 0)
					if (this._storage.has(at))
						dayStorage = this._storage.get(at)!;
					else {
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
	 * Gets all items active on a specific date.
	 * @throws {DateError} if the date is invalid.
	 */
	get(date: RawDate, options?: GetOptions): I[];
	
	/**
	 * Gets all unique items active within a date range.
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
				items.sort((a, b) => {
					const [ , rangeA ] = this.#itemRangeArray[this.#itemIndexMap.get(a)!];
					const [ , rangeB ] = this.#itemRangeArray[this.#itemIndexMap.get(b)!];
					
					return rangeA.startAt - rangeB.startAt || rangeA.endAt - rangeB.endAt;
				});
			
			return items.slice(offset, offset + limit);
		}
		
		const startAt = this._resolveTs(start);
		const endAt = this._resolveTs(end);
		
		if (startAt > endAt)
			return EMPTY_ARRAY as I[];
		
		tempItemBuffer.length = 0;
		
		const seen = new Set<I>();
		let skipped = 0;
		
		this._dateTree.range(startAt, endAt, node => {
			if (tempItemBuffer.length >= limit)
				return false;
			
			const { items, count } = this._storage.get(node.key)!;
			
			for (let i = 0; i < count; i++) {
				const item = items[i];
				
				if (seen.has(item))
					continue;
				
				seen.add(item);
				
				if (skipped < offset) {
					skipped++;
					
					continue;
				}
				
				if (tempItemBuffer.length >= limit)
					break;
				
				tempItemBuffer.push(item);
			}
			
			return tempItemBuffer.length < limit;
		});
		
		if (sorted && tempItemBuffer.length > 1)
			tempItemBuffer.sort((a, b) => {
				const [ , rangeA ] = this.#itemRangeArray[this.#itemIndexMap.get(a)!];
				const [ , rangeB ] = this.#itemRangeArray[this.#itemIndexMap.get(b)!];
				
				return rangeA.startAt - rangeB.startAt || rangeA.endAt - rangeB.endAt;
			});
		
		return tempItemBuffer.slice();
	}
	
	/**
	 * Gets the stored date range for a specific item.
	 * @returns An object with `startAt` and `endAt` timestamps, or `null` if the item is not found.
	 */
	getRange(item: I): ItemRange | null {
		const index = this.#itemIndexMap.get(item);
		
		return index === undefined ? null : this.#itemRangeArray[index][1];
	}
	
	/**
	 * Gets an array of all items in the timeline.
	 * Note: The order is not guaranteed.
	 */
	getAll(): I[] {
		return this.#itemRangeArray.map(([ item ]) => item);
	}
	
	/**
	 * Returns an iterator for all items active on a specific date.
	 * @throws {DateError} if the date is invalid.
	 */
	iterate(date: RawDate): IterableIterator<I>;
	
	/**
	 * Returns an iterator for all unique items active within a date range.
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
		
		const seen = new Set<I>();
		
		for (const at of this._rangeKeys(startAt, endAt))
			for (let i = 0, { items, count } = this._storage.get(at)!; i < count; i++) {
				const item = items[i];
				
				if (!seen.has(item)) {
					seen.add(item);
					
					yield item;
				}
			}
	}
	
	/**
	 * Returns an iterator for traversing all items in the timeline.
	 * The order of items is not guaranteed.
	 */
	*[Symbol.iterator](): IterableIterator<I> {
		
		for (let i = 0; i < this.#itemRangeArray.length; i++)
			yield this.#itemRangeArray[i][0];
	}
	
	/**
	 * The total number of items in the timeline.
	 */
	get size(): number {
		return this.#itemRangeArray.length;
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
	on(eventType: "item", item: I, listener: Listener<RangeItemChangeEvent<I>>, once?: boolean): Subscription;
	
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
	once(eventType: "item", item: I, listener: Listener<RangeItemChangeEvent<I>>): Subscription;
	
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
	off(eventType: "item", item: I, listener?: Listener<RangeItemChangeEvent<I>>): void;
	
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
	 * This method performs one collective update and event emission after all items are processed.
	 * @returns The number of items that were successfully deleted.
	 */
	deleteMany(items: Iterable<I>): number {
		
		const removeMap = new Map<Midnight, I[]>();
		
		tempEventBuffer.length = 0;
		
		let deletedCount = 0;
		
		for (const item of items) {
			const index = this.#itemIndexMap.get(item);
			
			if (index === undefined)
				continue;
			
			const [ , range ] = this.#itemRangeArray[index];
			
			for (let at = range.startAt; at <= range.endAt; at += ONE_DAY)
				removeMap.get(at)?.push(item) ??
				removeMap.set(at, [ item ]);
			
			const lastItemIndex = this.#itemRangeArray.length - 1;
			
			if (index !== lastItemIndex) {
				const lastItem = this.#itemRangeArray[lastItemIndex];
				
				this.#itemRangeArray[index] = lastItem;
				
				this.#itemIndexMap.set(lastItem[0], index);
			}
			
			this.#itemRangeArray.pop();
			this.#itemIndexMap.delete(item);
			this._itemListeners.delete(item);
			
			deletedCount++;
			
			tempEventBuffer.push({ type: "item", item, startAt: range.startAt, endAt: range.endAt, prevStartAt: range.startAt, prevEndAt: range.endAt });
		}
		
		if (deletedCount === 0)
			return 0;
		
		for (const [ at, toRemove ] of removeMap.entries()) {
			const dayStorage = this._storage.get(at)!;
			const toRemoveSet = new Set(toRemove);
			
			let writeIndex = 0;
			
			for (let readIndex = 0; readIndex < dayStorage.count; readIndex++)
				if (!toRemoveSet.has(dayStorage.items[readIndex])) {
					if (writeIndex !== readIndex)
						dayStorage.items[writeIndex] = dayStorage.items[readIndex];
					
					writeIndex++;
				}
			
			dayStorage.count = writeIndex;
			
			if (dayStorage.count === 0) {
				this._storage.delete(at);
				this._dateTree.remove(at);
				this._dateListeners.delete(at);
			} else
				this._cleanupStorageNode(dayStorage);
			
			tempEventBuffer.push({ type: "date", at });
		}
		
		this._updateBounds();
		this._emit(...tempEventBuffer);
		
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
		this.#itemRangeArray.length = 0;
		this.#itemIndexMap.clear();
		
		this._emit(...tempEventBuffer);
		
	}
	
}
