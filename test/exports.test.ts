import { describe, expect, it } from "bun:test";
import {
	DateError,
	RangeTimeline,
	Timeline,
	type Day,
	type Midnight,
	type Range,
	type RawDate
} from "../src/index";


describe("exports", () => {
	it("Timeline is defined", () => {
		expect(Timeline).toBeDefined();
	});
	it("RangeTimeline is defined", () => {
		expect(RangeTimeline).toBeDefined();
	});
	it("DateError is defined", () => {
		expect(DateError).toBeDefined();
		expect(new DateError("x")).toBeInstanceOf(DateError);
	});
	it("types are usable", () => {
		const _day: Day<{ id: string }> = { at: 0, items: [] };
		expect(_day.at).toBe(0);
		const _midnight: Midnight = 0;
		expect(_midnight).toBe(0);
		const _range: Range<{ id: string }> = {
			item: { id: "1" },
			range: { startAt: 0, endAt: 0 },
			intersection: { startAt: 0, endAt: 0 }
		};
		expect(_range.item.id).toBe("1");
		const _rawDate: RawDate = "2025-01-01";
		expect(_rawDate).toBe("2025-01-01");
	});
});
