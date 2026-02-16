import { describe, expect, it } from "bun:test";
import { DateError } from "../src/BaseTimeline";
import { Timeline } from "../src/Timeline";
import { midnight } from "./helpers";


type Event = { id: string; at: Date };

describe("Timeline", () => {
	describe("constructor", () => {
		it("creates empty timeline", () => {
			const timeline = new Timeline<Event>("at");
			expect(timeline.size).toBe(0);
			expect(timeline.isEmpty()).toBe(true);
			expect(timeline.startAt).toBeNull();
			expect(timeline.endAt).toBeNull();
		});
		
		it("creates timeline with initial items", () => {
			const d = new Date(midnight(2025, 10, 20));
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: d },
				{ id: "2", at: d }
			]);
			expect(timeline.size).toBe(2);
			expect(timeline.get(d)).toHaveLength(2);
		});
		
		it("accepts custom atPropName", () => {
			const d = new Date(midnight(2025, 10, 20));
			const timeline = new Timeline<{ id: string; when: Date }>("when", [
				{ id: "1", when: d }
			]);
			expect(timeline.size).toBe(1);
			expect(timeline.get(d)).toHaveLength(1);
		});
	});
	
	describe("add", () => {
		it("returns true when adding new item", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			expect(timeline.add(item)).toBe(true);
			expect(timeline.has(item)).toBe(true);
			expect(timeline.get(midnight(2025, 10, 20))).toContainEqual(item);
		});
		
		it("returns false when updating existing item", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			item.at = new Date(midnight(2025, 10, 21));
			expect(timeline.add(item)).toBe(false);
			expect(timeline.get(midnight(2025, 10, 21))).toContainEqual(item);
			expect(timeline.get(midnight(2025, 10, 20))).not.toContainEqual(item);
		});
		
		it("repeated add with same date does not duplicate", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			timeline.add(item);
			expect(timeline.size).toBe(1);
		});
		
		it("returns false for item with invalid date", () => {
			const timeline = new Timeline<Event>("at");
			expect(timeline.add({ id: "1", at: new Date(Number.NaN) })).toBe(false);
			expect(timeline.add({ id: "2", at: null as unknown as Date })).toBe(false);
			expect(timeline.size).toBe(0);
		});
		
		it("stores different objects with same date as separate items", () => {
			const timeline = new Timeline<Event>("at");
			const date = new Date(midnight(2025, 10, 20));
			timeline.add({ id: "1", at: date });
			timeline.add({ id: "2", at: new Date(midnight(2025, 10, 20)) });
			expect(timeline.size).toBe(2);
			expect(timeline.get(date)).toHaveLength(2);
		});
	});
	
	describe("get (single date)", () => {
		it("returns items by Date", () => {
			const d = new Date(midnight(2025, 10, 20));
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: d },
				{ id: "2", at: d }
			]);
			expect(timeline.get(d)).toHaveLength(2);
		});
		
		it("returns items by string", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date("2025-10-20") }
			]);
			expect(timeline.get("2025-10-20")).toHaveLength(1);
		});
		
		it("returns items by number timestamp", () => {
			const ts = midnight(2025, 10, 20);
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(ts) }
			]);
			expect(timeline.get(ts)).toHaveLength(1);
		});
		
		it("returns empty array for empty day", () => {
			const timeline = new Timeline<Event>("at");
			expect(timeline.get(midnight(2025, 10, 20))).toEqual([]);
		});
	});
	
	describe("get (range)", () => {
		it("returns items within date range", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) },
				{ id: "3", at: new Date(midnight(2025, 10, 25)) }
			]);
			const result = timeline.get(midnight(2025, 10, 18), midnight(2025, 10, 22));
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("2");
		});
		
		it("includes items on range boundaries", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "a", at: new Date(midnight(2025, 10, 18)) },
				{ id: "b", at: new Date(midnight(2025, 10, 22)) }
			]);
			const result = timeline.get(midnight(2025, 10, 18), midnight(2025, 10, 22));
			expect(result).toHaveLength(2);
		});
		
		it("respects limit and offset options", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) },
				{ id: "3", at: new Date(midnight(2025, 10, 25)) }
			]);
			const result = timeline.get(midnight(2025, 10, 1), midnight(2025, 10, 31), {
				limit: 1,
				offset: 1,
				sorted: true
			});
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("2");
		});
		
		it("supports sorted option", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "3", at: new Date(midnight(2025, 10, 25)) },
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) }
			]);
			const result = timeline.get(midnight(2025, 10, 1), midnight(2025, 10, 31), { sorted: true });
			expect(result[0].id).toBe("1");
			expect(result[1].id).toBe("2");
			expect(result[2].id).toBe("3");
		});
		
		it("returns empty array when start > end", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			expect(timeline.get(midnight(2025, 10, 25), midnight(2025, 10, 15))).toEqual([]);
		});
	});
	
	describe("delete", () => {
		it("removes item and returns true", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			expect(timeline.delete(item)).toBe(true);
			expect(timeline.size).toBe(0);
		});
		
		it("returns false when item not found", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			expect(timeline.delete(item)).toBe(false);
		});
		
		it("has returns false after delete", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			timeline.delete(item);
			expect(timeline.has(item)).toBe(false);
		});
	});
	
	describe("addMany / deleteMany", () => {
		it("addMany returns BatchResult", () => {
			const timeline = new Timeline<Event>("at");
			const result = timeline.addMany([
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 21)) }
			]);
			expect(result).toEqual({ added: 2, updated: 0, removed: 0 });
		});
		
		it("addMany with update counts updated", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			item.at = new Date(midnight(2025, 10, 21));
			const result = timeline.addMany([ item ]);
			expect(result).toEqual({ added: 0, updated: 1, removed: 0 });
		});
		
		it("deleteMany returns count", () => {
			const timeline = new Timeline<Event>("at");
			const items = [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 21)) }
			];
			timeline.addMany(items);
			expect(timeline.deleteMany(items)).toBe(2);
		});
	});
	
	describe("has, find", () => {
		it("has returns true for existing item", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			expect(timeline.has(item)).toBe(true);
		});
		
		it("has returns false for non-existing item", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			expect(timeline.has(item)).toBe(false);
		});
		
		it("find returns first matching item", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) }
			]);
			const found = timeline.find(item => item.id === "2");
			expect(found?.id).toBe("2");
		});
		
		it("find returns undefined when no match", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			expect(timeline.find(item => item.id === "x")).toBeUndefined();
		});
	});
	
	describe("clear", () => {
		it("removes all items", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			timeline.clear();
			expect(timeline.isEmpty()).toBe(true);
			expect(timeline.size).toBe(0);
		});
	});
	
	describe("size, startAt, endAt, daysCount", () => {
		it("size reflects item count", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) }
			]);
			expect(timeline.size).toBe(2);
		});
		
		it("startAt and endAt reflect bounds", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 25)) }
			]);
			expect(timeline.startAt).toBe(midnight(2025, 10, 15));
			expect(timeline.endAt).toBe(midnight(2025, 10, 25));
		});
		
		it("daysCount returns unique days with items", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) },
				{ id: "3", at: new Date(midnight(2025, 10, 21)) }
			]);
			expect(timeline.daysCount).toBe(2);
		});
	});
	
	describe("getDates, getDay, getDays", () => {
		it("getDates returns sorted dates", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 25)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) }
			]);
			const dates = timeline.getDates();
			expect(dates[0]).toBe(midnight(2025, 10, 20));
			expect(dates[1]).toBe(midnight(2025, 10, 25));
		});
		
		it("getDay returns Day or null", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			const day = timeline.getDay(midnight(2025, 10, 20));
			expect(day).not.toBeNull();
			expect(day!.at).toBe(midnight(2025, 10, 20));
			expect(day!.items).toHaveLength(1);
		});
		
		it("getDay returns null for empty day", () => {
			const timeline = new Timeline<Event>("at");
			expect(timeline.getDay(midnight(2025, 10, 20))).toBeNull();
		});
		
		it("getDays with includeEmpty includes empty days", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			const days = timeline.getDays(midnight(2025, 10, 19), midnight(2025, 10, 21), { includeEmpty: true });
			expect(days).toHaveLength(3);
		});
		
		it("getDates with range returns dates within range", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) },
				{ id: "3", at: new Date(midnight(2025, 10, 25)) }
			]);
			const dates = timeline.getDates(midnight(2025, 10, 18), midnight(2025, 10, 22));
			expect(dates).toEqual([ midnight(2025, 10, 20) ]);
		});
		
		it("getDates returns empty array when start > end", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			expect(timeline.getDates(midnight(2025, 10, 25), midnight(2025, 10, 15))).toEqual([]);
		});
	});
	
	describe("getClosestDay", () => {
		it("before returns closest day before date", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 25)) }
			]);
			const day = timeline.getClosestDay(midnight(2025, 10, 20), "before");
			expect(day?.at).toBe(midnight(2025, 10, 15));
		});
		
		it("after returns closest day after date", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 25)) }
			]);
			const day = timeline.getClosestDay(midnight(2025, 10, 20), "after");
			expect(day?.at).toBe(midnight(2025, 10, 25));
		});
		
		it("either returns closest in either direction", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) }
			]);
			const day = timeline.getClosestDay(midnight(2025, 10, 20), "either");
			expect(day?.at).toBe(midnight(2025, 10, 15));
		});
		
		it("either returns one of equidistant days when query between two", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 15)) },
				{ id: "2", at: new Date(midnight(2025, 10, 25)) }
			]);
			const day = timeline.getClosestDay(midnight(2025, 10, 20), "either");
			expect(day?.at).toBe(midnight(2025, 10, 15));
		});
	});
	
	describe("iterate, iterateDays", () => {
		it("iterate yields items in range", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 21)) }
			]);
			const items = [ ...timeline.iterate(midnight(2025, 10, 19), midnight(2025, 10, 22)) ];
			expect(items).toHaveLength(2);
		});
		
		it("yields nothing for empty range", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			const items = [ ...timeline.iterate(midnight(2025, 10, 1), midnight(2025, 10, 10)) ];
			expect(items).toHaveLength(0);
		});
		
		it("iterateDays yields Day objects", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) }
			]);
			const days = [ ...timeline.iterateDays(midnight(2025, 10, 20), midnight(2025, 10, 20)) ];
			expect(days).toHaveLength(1);
			expect(days[0].at).toBe(midnight(2025, 10, 20));
		});
	});
	
	describe("entries, getAll", () => {
		it("entries yields date-item pairs", () => {
			const timeline = new Timeline<Event>("at", [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 20)) }
			]);
			const entries = [ ...timeline.entries(true) ];
			expect(entries).toHaveLength(1);
			expect(entries[0][0]).toBe(midnight(2025, 10, 20));
			expect(entries[0][1]).toHaveLength(2);
		});
		
		it("getAll returns all items", () => {
			const items = [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 21)) }
			];
			const timeline = new Timeline<Event>("at", items);
			const all = timeline.getAll();
			expect(all).toHaveLength(2);
			expect(all).toEqual(expect.arrayContaining(items));
		});
		
		it("Symbol.iterator yields all items", () => {
			const items = [
				{ id: "1", at: new Date(midnight(2025, 10, 20)) },
				{ id: "2", at: new Date(midnight(2025, 10, 21)) }
			];
			const timeline = new Timeline<Event>("at", items);
			const iterated = [ ...timeline ];
			expect(iterated).toHaveLength(2);
			expect(iterated).toEqual(expect.arrayContaining(items));
		});
	});
	
	describe("Events", () => {
		it("on bounds fires when bounds change", () => {
			const timeline = new Timeline<Event>("at");
			let fired = false;
			timeline.on("bounds", () => {
				fired = true;
			});
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			expect(fired).toBe(true);
		});
		
		it("on date fires when date changes", () => {
			const timeline = new Timeline<Event>("at");
			const received: number[] = [];
			timeline.on("date", midnight(2025, 10, 20), eventPayload => {
				if (eventPayload.type === "date")
					received.push(eventPayload.at);
			});
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			expect(received).toContain(midnight(2025, 10, 20));
		});
		
		it("on item fires with prevAt null for new item", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			let captured: { type: string; at: number; prevAt: number | null } | null = null;
			timeline.on("item", item, payload => {
				if (payload.type === "item" && "at" in payload)
					captured = { type: payload.type, at: payload.at, prevAt: payload.prevAt };
			});
			timeline.add(item);
			expect(captured).not.toBeNull();
			expect(captured!.type).toBe("item");
			expect(captured!.at).toBe(midnight(2025, 10, 20));
			expect(captured!.prevAt).toBeNull();
		});
		
		it("on item fires with prevAt when updating item date", () => {
			const timeline = new Timeline<Event>("at");
			const item = { id: "1", at: new Date(midnight(2025, 10, 20)) };
			timeline.add(item);
			let captured: { at: number; prevAt: number | null } | null = null;
			timeline.on("item", item, payload => {
				if (payload.type === "item" && "at" in payload)
					captured = { at: payload.at, prevAt: payload.prevAt };
			});
			item.at = new Date(midnight(2025, 10, 21));
			timeline.add(item);
			expect(captured).not.toBeNull();
			expect(captured!.at).toBe(midnight(2025, 10, 21));
			expect(captured!.prevAt).toBe(midnight(2025, 10, 20));
		});
		
		it("once fires only once", () => {
			const timeline = new Timeline<Event>("at");
			let count = 0;
			timeline.once("bounds", () => {
				count++;
			});
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			timeline.add({ id: "2", at: new Date(midnight(2025, 10, 21)) });
			expect(count).toBe(1);
		});
		
		it("subscription.unsubscribe removes listener", () => {
			const timeline = new Timeline<Event>("at");
			let count = 0;
			const listener = () => {
				count++;
			};
			timeline.on("bounds", listener);
			const sub = timeline.on("bounds", listener);
			sub.unsubscribe();
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			expect(count).toBe(1);
		});
		
		it("off removes listener by reference", () => {
			const timeline = new Timeline<Event>("at");
			let count = 0;
			const listener = () => {
				count++;
			};
			timeline.on("bounds", listener);
			timeline.off("bounds", listener);
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			expect(count).toBe(0);
		});
	});
	
	describe("RawDate", () => {
		it("accepts Date", () => {
			const timeline = new Timeline<Event>("at");
			timeline.add({ id: "1", at: new Date("2025-10-20") });
			expect(timeline.size).toBe(1);
		});
		
		it("accepts number timestamp", () => {
			const timeline = new Timeline<{ id: string; at: Date | number }>("at");
			timeline.add({ id: "1", at: midnight(2025, 10, 20) });
			expect(timeline.size).toBe(1);
		});
		
		it("accepts string", () => {
			const timeline = new Timeline<{ id: string; at: Date | string }>("at");
			timeline.add({ id: "1", at: "2025-10-20" });
			expect(timeline.size).toBe(1);
		});
	});
	
	describe("DateError", () => {
		it("throws DateError for invalid date in get", () => {
			const timeline = new Timeline<Event>("at");
			expect(() => timeline.get("invalid")).toThrow(DateError);
		});
		
		it("DateError has correct name", () => {
			const error = new DateError("invalid");
			expect(error.name).toBe("DateError");
		});
	});
	
	describe("Cache", () => {
		it("useGlobalCache false instantiates without error", () => {
			const timeline = new Timeline<Event>("at", [], {
				cache: { useGlobalCache: false }
			});
			timeline.add({ id: "1", at: new Date(midnight(2025, 10, 20)) });
			expect(timeline.size).toBe(1);
		});
	});
});
