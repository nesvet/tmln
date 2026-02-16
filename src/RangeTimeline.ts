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
	EventType,
	GetOptions,
	Item,
	ItemRange,
	Listener,
	ListenerConfig,
	Midnight,
	ParsedRangeOptions,
	Range,
	RangeDayOptions,
	RangeItemChangeEvent,
	RangeOptions,
	RangeTimelineEvent,
	RawDate,
	Subscription,
	TimelineOptions
} from "./types";


/* eslint-disable @typescript-eslint/no-explicit-any */


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
		if (!item || item[this.#startAtPropName] === undefined || item[this.#endDatePropName] === undefined)
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
			if (!item || item[this.#startAtPropName] === undefined || item[this.#endDatePropName] === undefined)
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
			} else if (startAt === null || endAt === null) {
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
	 * Finds the first item in the timeline that satisfies the provided testing function.
	 * @param predicate A function to execute for each item. It should return `true` if the item is a match.
	 * @returns The first item that satisfies the predicate, or `undefined` if no such item is found.
	 */
	find(predicate: (item: I) => boolean): I | undefined {
		
		for (let i = 0; i < this.#itemRangeArray.length; i++) {
			const [ item ] = this.#itemRangeArray[i];
			
			if (predicate(item))
				return item;
		}
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
				return [];
			
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
			return [];
		
		const result: I[] = [];
		const seen = new Set<I>();
		let skipped = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (result.length >= limit)
				break;
			
			const { items, count } = this._storage.get(at)!;
			
			for (let i = 0; i < count; i++) {
				const item = items[i];
				
				if (seen.has(item))
					continue;
				seen.add(item);
				
				if (skipped < offset) {
					skipped++;
					
					continue;
				}
				
				if (result.length >= limit)
					break;
				
				result.push(item);
			}
		}
		
		if (sorted && result.length > 1)
			result.sort((a, b) => {
				const [ , rangeA ] = this.#itemRangeArray[this.#itemIndexMap.get(a)!];
				const [ , rangeB ] = this.#itemRangeArray[this.#itemIndexMap.get(b)!];
				
				return rangeA.startAt - rangeB.startAt || rangeA.endAt - rangeB.endAt;
			});
		
		return result;
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
	 * Gets all items whose date range *starts* on the specified date.
	 * @param date The exact start date to match.
	 * @returns An array of items.
	 * @throws {DateError} if the date is invalid.
	 */
	getStartsOn(date: RawDate): I[] {
		const at = this._resolveTs(date);
		
		const itemsOnDate = this.get(at);
		
		if (itemsOnDate.length === 0)
			return [];
		
		const result: I[] = [];
		
		for (const item of itemsOnDate)
			if (this.getRange(item)!.startAt === at)
				result.push(item);
		
		return result;
	}
	
	/**
	 * Gets all items whose date range *ends* on the specified date.
	 * @param date The exact end date to match.
	 * @returns An array of items.
	 * @throws {DateError} if the date is invalid.
	 */
	getEndsOn(date: RawDate): I[] {
		const at = this._resolveTs(date);
		
		const itemsOnDate = this.get(at);
		
		if (itemsOnDate.length === 0)
			return [];
		
		const result: I[] = [];
		
		for (const item of itemsOnDate)
			if (this.getRange(item)!.endAt === at)
				result.push(item);
		
		return result;
	}
	
	/**
	 * Gets an array of all items in the timeline.
	 * Note: The order is not guaranteed.
	 */
	getAll(): I[] {
		return this.#itemRangeArray.map(([ item ]) => item);
	}
	
	#deduplicateItems(items: I[], uniqueOnly: boolean): I[] {
		if (!uniqueOnly || items.length <= 1)
			return items;
		
		const seen = new Map<I, boolean>();
		const result: I[] = [];
		
		for (const item of items)
			if (!seen.has(item)) {
				seen.set(item, true);
				result.push(item);
			}
		
		return result;
	}
	
	/**
	 * Retrieves a Day object `{ at, items }` for a specific date.
	 * @param date The date to retrieve.
	 * @param options Configuration for the retrieval, such as `uniqueOnly`.
	 * @returns A Day object, or `null` if there are no items on that date.
	 * @throws {DateError} if the date is invalid.
	 */
	getDay(date: RawDate, options?: { uniqueOnly?: boolean }): Day<I> | null {
		const at = this._resolveTs(date);
		
		const dayStorage = this._storage.get(at);
		
		if (!dayStorage || dayStorage.count === 0)
			return null;
		
		const rawItems = dayStorage.items.slice(0, dayStorage.count);
		
		const items = this.#deduplicateItems(rawItems, options?.uniqueOnly ?? false);
		
		return { at, items };
	}
	
	/**
	 * Retrieves all Day objects that contain items for a specific date.
	 * @param start The date to retrieve.
	 * @param options Configuration for the retrieval.
	 * @returns An array of Day objects.
	 * @throws {DateError} if the date is invalid.
	 */
	getDays(start: RawDate, options?: RangeDayOptions): Day<I>[];
	
	/**
	 * Retrieves all Day objects that contain items within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for the retrieval.
	 * @returns An array of Day objects.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	getDays(start: RawDate, end: RawDate, options?: RangeDayOptions): Day<I>[];
	
	getDays(start: RawDate, endOrOptions?: RangeDayOptions | RawDate, options?: RangeDayOptions): Day<I>[] {
		const { end, includeEmpty, limit, offset, uniqueOnly = false } = this._parseDayArgs(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return [];
		
		const { startAt, endAt } = range;
		
		if (includeEmpty)
			return this.#getDaysWithEmpty(startAt, endAt, limit, offset, uniqueOnly);
		
		return this.#getDaysExistingOnly(startAt, endAt, limit, offset, uniqueOnly);
	}
	
	#getDaysWithEmpty(startAt: Midnight, endAt: Midnight, limit: number, offset: number, uniqueOnly: boolean): Day<I>[] {
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
				
				const rawItems = dayStorage.items.slice(0, dayStorage.count);
				
				const items = this.#deduplicateItems(rawItems, uniqueOnly);
				
				result[resultIndex] = { at: currentAt, items };
				
				existingIndex++;
			} else
				result[resultIndex] = { at: currentAt, items: [] };
			
			resultIndex++;
		}
		
		if (resultIndex < result.length)
			result.length = resultIndex;
		
		return result;
	}
	
	#getDaysExistingOnly(startAt: Midnight, endAt: Midnight, limit: number, offset: number, uniqueOnly: boolean): Day<I>[] {
		
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
			
			const rawItems = dayStorage.items.slice(0, dayStorage.count);
			
			const items = this.#deduplicateItems(rawItems, uniqueOnly);
			
			result.push({ at, items });
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
	iterateDays(start: RawDate, options?: RangeDayOptions): IterableIterator<Day<I>>;
	
	/**
	 * Returns a memory-efficient iterator for Day objects within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for the retrieval.
	 * @returns An iterator for Day objects.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	iterateDays(start: RawDate, end: RawDate, options?: RangeDayOptions): IterableIterator<Day<I>>;
	
	*iterateDays(start: RawDate, endOrOptions?: RangeDayOptions | RawDate, options?: RangeDayOptions): IterableIterator<Day<I>> {
		const { end, includeEmpty, limit, offset, uniqueOnly = false } = this._parseDayArgs(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return;
		
		const { startAt, endAt } = range;
		
		yield* includeEmpty ?
			this.#iterateDaysWithEmpty(startAt, endAt, limit, offset, uniqueOnly) :
			this.#iterateDaysExistingOnly(startAt, endAt, limit, offset, uniqueOnly);
	}
	
	*#iterateDaysWithEmpty(startAt: Midnight, endAt: Midnight, limit: number, offset: number, uniqueOnly: boolean): IterableIterator<Day<I>> {
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
				
				const rawItems = dayStorage.items.slice(0, dayStorage.count);
				
				const items = this.#deduplicateItems(rawItems, uniqueOnly);
				
				yield { at: currentAt, items };
				
				existingIndex++;
			} else
				yield { at: currentAt, items: [] };
			
			yieldedCount++;
		}
		
	}
	
	*#iterateDaysExistingOnly(startAt: Midnight, endAt: Midnight, limit: number, offset: number, uniqueOnly: boolean): IterableIterator<Day<I>> {
		
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
			
			const rawItems = dayStorage.items.slice(0, dayStorage.count);
			
			const items = this.#deduplicateItems(rawItems, uniqueOnly);
			
			yield { at, items };
			
			yieldedCount++;
		}
		
	}
	
	#parseRangeOptions(endOrOptions?: RangeOptions | RawDate, options?: RangeOptions): ParsedRangeOptions {
		return (endOrOptions && typeof endOrOptions === "object" && !(endOrOptions instanceof Date)) ?
			{
				end: endOrOptions.end,
				limit: endOrOptions.limit ?? Infinity,
				offset: endOrOptions.offset ?? 0
			} :
			{
				end: endOrOptions as RawDate | undefined,
				limit: options?.limit ?? Infinity,
				offset: options?.offset ?? 0
			};
	}
	
	/**
	 * Retrieves all items and their date ranges that are active on a specific date.
	 * @param start The date to query.
	 * @param options Configuration for pagination.
	 * @returns An array of range results.
	 * @throws {DateError} if the date is invalid.
	 */
	getRanges(start: RawDate, options?: RangeOptions): Range<I>[];
	
	/**
	 * Retrieves all items and their date ranges that are active within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for pagination.
	 * @returns An array of range results.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	getRanges(start: RawDate, end: RawDate, options?: RangeOptions): Range<I>[];
	
	getRanges(start: RawDate, endOrOptions?: RangeOptions | RawDate, options?: RangeOptions): Range<I>[] {
		const { end, limit, offset } = this.#parseRangeOptions(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return [];
		
		const { startAt, endAt } = range;
		
		const result: Range<I>[] = [];
		const seen = new Set<I>();
		let skippedCount = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (result.length >= limit)
				break;
			
			const dayStorage = this._storage.get(at)!;
			
			for (let i = 0; i < dayStorage.count; i++) {
				if (result.length >= limit)
					break;
				
				const item = dayStorage.items[i];
				
				if (seen.has(item))
					continue;
				
				seen.add(item);
				
				if (skippedCount < offset) {
					skippedCount++;
					
					continue;
				}
				
				const [ , itemRange ] = this.#itemRangeArray[this.#itemIndexMap.get(item)!];
				
				result.push({
					item,
					range: itemRange,
					intersection: {
						startAt: Math.max(itemRange.startAt, startAt),
						endAt: Math.min(itemRange.endAt, endAt)
					}
				});
			}
		}
		
		return result;
	}
	
	/**
	 * Returns a memory-efficient iterator for item ranges active on a specific date.
	 * @param start The date to query.
	 * @param options Configuration for pagination.
	 * @returns An iterator for range results.
	 * @throws {DateError} if the date is invalid.
	 */
	iterateRanges(start: RawDate, options?: RangeOptions): IterableIterator<Range<I>>;
	
	/**
	 * Returns a memory-efficient iterator for item ranges active within a given date range.
	 * @param start The start of the date range.
	 * @param end The end of the date range.
	 * @param options Configuration for pagination.
	 * @returns An iterator for range results.
	 * @throws {DateError} if the start or end date is invalid.
	 */
	iterateRanges(start: RawDate, end: RawDate, options?: RangeOptions): IterableIterator<Range<I>>;
	
	*iterateRanges(start: RawDate, endOrOptions?: RangeOptions | RawDate, options?: RangeOptions): IterableIterator<Range<I>> {
		const { end, limit, offset } = this.#parseRangeOptions(endOrOptions, options);
		
		const range = this._resolveTsRange(start, end);
		
		if (!range)
			return;
		
		const { startAt, endAt } = range;
		
		const seen = new Set<I>();
		let yieldedCount = 0;
		let skippedCount = 0;
		
		for (const at of this._rangeKeys(startAt, endAt)) {
			if (yieldedCount >= limit)
				break;
			
			const dayStorage = this._storage.get(at)!;
			
			for (let i = 0; i < dayStorage.count; i++) {
				const item = dayStorage.items[i];
				
				if (seen.has(item))
					continue;
				
				seen.add(item);
				
				if (skippedCount < offset) {
					skippedCount++;
					
					continue;
				}
				
				if (yieldedCount >= limit)
					return;
				
				const [ , itemRange ] = this.#itemRangeArray[this.#itemIndexMap.get(item)!];
				
				yield {
					item,
					range: itemRange,
					intersection: {
						startAt: Math.max(itemRange.startAt, startAt),
						endAt: Math.min(itemRange.endAt, endAt)
					}
				};
				
				yieldedCount++;
			}
		}
		
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
