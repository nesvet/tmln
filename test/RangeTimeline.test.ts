import { describe, expect, it } from "bun:test";
import { RangeTimeline } from "../src/RangeTimeline";
import { midnight } from "./helpers";


type Task = { id: string; startAt: Date; endAt: Date };

describe("RangeTimeline", () => {
	describe("constructor", () => {
		it("creates empty timeline", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			expect(timeline.size).toBe(0);
			expect(timeline.isEmpty()).toBe(true);
		});
		
		it("creates timeline with initial items", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				}
			]);
			expect(timeline.size).toBe(1);
		});
		
		it("accepts custom prop names", () => {
			const timeline = new RangeTimeline<
				{ id: string; from: Date; to: Date }
			>("from", "to", [
				{
					id: "1",
					from: new Date(midnight(2025, 10, 10)),
					to: new Date(midnight(2025, 10, 20))
				}
			]);
			expect(timeline.size).toBe(1);
		});
	});
	
	describe("add, get", () => {
		it("adds item with range", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const task = {
				id: "1",
				startAt: new Date(midnight(2025, 10, 10)),
				endAt: new Date(midnight(2025, 10, 20))
			};
			timeline.add(task);
			expect(timeline.size).toBe(1);
		});
		
		it("get returns items active on date", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				},
				{
					id: "2",
					startAt: new Date(midnight(2025, 10, 15)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			]);
			const active = timeline.get(new Date(midnight(2025, 10, 18)));
			expect(active).toHaveLength(2);
		});
		
		it("get returns overlapping items in range", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				}
			]);
			const result = timeline.get(midnight(2025, 10, 5), midnight(2025, 10, 15));
			expect(result).toHaveLength(1);
		});
		
		it("returns false for item with invalid date", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			expect(timeline.add({
				id: "1",
				startAt: new Date(Number.NaN),
				endAt: new Date(midnight(2025, 10, 20))
			})).toBe(false);
			expect(timeline.size).toBe(0);
		});
		
		it("includes item on range boundaries", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				}
			]);
			expect(timeline.get(new Date(midnight(2025, 10, 10)))).toHaveLength(1);
			expect(timeline.get(new Date(midnight(2025, 10, 20)))).toHaveLength(1);
		});
	});
	
	describe("getRange", () => {
		it("returns stored range for item", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const task = {
				id: "1",
				startAt: new Date(midnight(2025, 10, 10)),
				endAt: new Date(midnight(2025, 10, 20))
			};
			timeline.add(task);
			const range = timeline.getRange(task);
			expect(range).toEqual({
				startAt: midnight(2025, 10, 10),
				endAt: midnight(2025, 10, 20)
			});
		});
		
		it("returns null for non-existing item", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const task = {
				id: "1",
				startAt: new Date(midnight(2025, 10, 10)),
				endAt: new Date(midnight(2025, 10, 20))
			};
			expect(timeline.getRange(task)).toBeNull();
		});
	});
	
	describe("getStartsOn, getEndsOn", () => {
		it("getStartsOn returns items starting on date", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				},
				{
					id: "2",
					startAt: new Date(midnight(2025, 10, 15)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			]);
			const starts = timeline.getStartsOn(midnight(2025, 10, 10));
			expect(starts).toHaveLength(1);
			expect(starts[0].id).toBe("1");
		});
		
		it("getEndsOn returns items ending on date", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				},
				{
					id: "2",
					startAt: new Date(midnight(2025, 10, 15)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			]);
			const ends = timeline.getEndsOn(midnight(2025, 10, 20));
			expect(ends).toHaveLength(1);
			expect(ends[0].id).toBe("1");
		});
	});
	
	describe("getRanges", () => {
		it("returns items with intersection", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			]);
			const ranges = timeline.getRanges(midnight(2025, 10, 15), midnight(2025, 10, 20));
			expect(ranges).toHaveLength(1);
			expect(ranges[0].item.id).toBe("1");
			expect(ranges[0].intersection.startAt).toBe(midnight(2025, 10, 15));
			expect(ranges[0].intersection.endAt).toBe(midnight(2025, 10, 20));
		});
	});
	
	describe("iterateRanges", () => {
		it("yields range objects", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt", [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				}
			]);
			const ranges = [ ...timeline.iterateRanges(midnight(2025, 10, 1), midnight(2025, 10, 31)) ];
			expect(ranges).toHaveLength(1);
			expect(ranges[0].item.id).toBe("1");
		});
	});
	
	describe("Events", () => {
		it("item event has prevStartAt and prevEndAt for update", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const task = {
				id: "1",
				startAt: new Date(midnight(2025, 10, 10)),
				endAt: new Date(midnight(2025, 10, 20))
			};
			const captured: Array<{ prevStartAt: number | null; prevEndAt: number | null }> = [];
			timeline.on("item", task, eventPayload => {
				captured.push({
					prevStartAt: (eventPayload as { prevStartAt: number | null }).prevStartAt,
					prevEndAt: (eventPayload as { prevEndAt: number | null }).prevEndAt
				});
			});
			timeline.add(task);
			expect(captured[0]?.prevStartAt).toBeNull();
			expect(captured[0]?.prevEndAt).toBeNull();
			
			task.startAt = new Date(midnight(2025, 10, 15));
			task.endAt = new Date(midnight(2025, 10, 25));
			timeline.add(task);
			expect(captured[1]?.prevStartAt).toBe(midnight(2025, 10, 10));
			expect(captured[1]?.prevEndAt).toBe(midnight(2025, 10, 20));
		});
	});
	
	describe("addMany, deleteMany", () => {
		it("addMany returns BatchResult", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const result = timeline.addMany([
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				},
				{
					id: "2",
					startAt: new Date(midnight(2025, 10, 15)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			]);
			expect(result).toEqual({ added: 2, updated: 0, removed: 0 });
		});
		
		it("deleteMany returns count", () => {
			const timeline = new RangeTimeline<Task>("startAt", "endAt");
			const tasks = [
				{
					id: "1",
					startAt: new Date(midnight(2025, 10, 10)),
					endAt: new Date(midnight(2025, 10, 20))
				},
				{
					id: "2",
					startAt: new Date(midnight(2025, 10, 15)),
					endAt: new Date(midnight(2025, 10, 25))
				}
			];
			timeline.addMany(tasks);
			expect(timeline.deleteMany(tasks)).toBe(2);
		});
	});
});
